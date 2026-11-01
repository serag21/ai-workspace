/**
 * AW-008 (QW-006): CPU-only safety contract for OFFICIAL live agent event streams.
 *
 * What this module is:
 *  - A provider-independent approval gate and two stream contract runners that
 *    pin the safety behavior the desktop app MUST have before it may ever
 *    consume a live Codex App Server or Claude Agent SDK `query()` stream.
 *  - Pure functions over caller-injected frame/message streams. It imports
 *    nothing executable, spawns no process, opens no handle, makes no network
 *    call, and contains no timers. Nothing in this module can reach a provider.
 *
 * What this module is NOT:
 *  - No live acceptance evidence (AGENT-002/003/005 and CON-017 remain
 *    real-host gates until an owner-verified run passes).
 *  - No app wiring: nothing in the desktop spike imports this module yet.
 *  - No Codex installation, no `@anthropic-ai/claude-agent-sdk` import,
 *    no agent execution, no session mutation.
 *
 * Protocol source (authoritative, owner-supplied 2026-11-01):
 *  - Codex App Server (official docs): https://learn.chatgpt.com/docs/app-server
 *    Documented server-initiated methods (allowlist; nothing else is trusted):
 *      item/started
 *      item/agentMessage/delta
 *      item/commandExecution/outputDelta
 *      item/completed
 *      turn/completed
 *      item/commandExecution/requestApproval
 *      item/fileChange/requestApproval
 *      serverRequest/resolved
 *    Documented terminal `turn.status` values are exactly:
 *      "completed" | "interrupted" | "failed"
 *    No `stopReason` enum or other status vocabulary is invented here.
 *  - Claude Agent SDK: the live message schema is versioned by the SDK and is
 *    NOT pinned by fixtures in this repo, so runClaudeLive() consumes only a
 *    minimal conservative subset (the `result` terminal message) and reports
 *    `unknown` for any shape it cannot verify. Deferred/unverified shapes are
 *    recorded in DECISIONS.md (D-013) instead of being guessed.
 *
 * Safety invariants (enforced by code, covered by sdk-live-adapter.test.mjs):
 *  INV-1 Approvals (commands, file changes, SDK tool use) are answered only by
 *        an explicit owner decision through the gate. Cancellation and
 *        timeout paths exist ONLY as denial — there is no code path in this
 *        module that produces "approve" without an explicit decision
 *        (AGENT-003, CON-008).
 *  INV-2 An approval decision is exactly-once: the second decision on a
 *        settled record is refused and the first decision is preserved
 *        (CON-008).
 *  INV-3 Terminal status exists only from an explicit terminal frame/message of
 *        the documented vocabulary; a disconnect mid-turn is reported
 *        "unknown", never inferred (AGENT-005, CON-017).
 *  INV-4 Frames/messages outside the documented allowlist are quarantined as
 *        unrecognized; they are never trusted and never change status.
 *  INV-5 Server-side resolution of a pending approval (serverRequest/resolved)
 *        settles it DENIED with provenance — never approved — because the
 *        resolution content is untrusted and unverified.
 *  INV-6 All collected history is bounded (caps below); oversized streams
 *        degrade to a bounded view, they do not balloon memory.
 */

const TIMELINE_CAP = 1000;      // bounded event history (INV-6)
const UNRECOGNIZED_CAP = 100;   // bounded quarantine list (INV-6)
const ID_MAX = 200;             // bounded ids copied into records

/* ---------- small helpers (pure, no I/O) ---------- */

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function strOf(value, max = ID_MAX) {
  return typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : null;
}

function makeCappedList(cap) {
  const entries = [];
  let dropped = 0;
  return {
    entries,
    get dropped() { return dropped; },
    push(entry) { if (entries.length < cap) entries.push(entry); else dropped += 1; },
  };
}

function asyncFrames(frames) {
  if (frames == null)
    throw new TypeError("A frame stream must be an array, iterable, or async iterable.");
  if (typeof frames[Symbol.asyncIterator] === "function") return frames[Symbol.asyncIterator]();
  if (Array.isArray(frames) || typeof frames[Symbol.iterator] === "function")
    return (async function* (f) { for (const value of f) yield value; })(frames);
  throw new TypeError("A frame stream must be an array, iterable, or async iterable.");
}

const APPROVAL_KINDS = Object.freeze({
  command: "command",
  "file-change": "file-change",
  "sdk-tool": "sdk-tool",
});

/* ---------- provider-independent approval gate (INV-1, INV-2) ---------- */

/**
 * createApprovalGate() — explicit-decision approval ledger.
 *
 * The gate owns the only decision surface. `decide()` accepts exactly
 * "approve" | "deny"; `cancel()` and `expire()` are denial paths (INV-1).
 * Once settled, a record is immutable to decisions (INV-2). Callers that
 * need to know the outcome may await gate.waitForDecision(id); the gate
 * itself holds no timers, so "timeout" is caller-driven (no background work).
 */
export function createApprovalGate() {
  const records = new Map(); // id -> record
  const waiters = new Map(); // id -> resolver
  let seq = 0;
  let closed = false;

  function snapshot(record) {
    return { id: record.id, kind: record.kind, meta: record.meta, decision: record.decision, reason: record.reason };
  }

  function request(kind, meta) {
    if (closed) throw new Error("Approval gate is closed; new approval requests are refused.");
    if (!Object.values(APPROVAL_KINDS).includes(kind))
      throw new TypeError("Approval kind must be a documented kind (command | file-change | sdk-tool).");
    const id = "APR-" + String(++seq).padStart(4, "0");
    const record = {
      id,
      kind,
      meta: isPlainObject(meta) ? meta : {},
      decision: null, // null = pending; never flips to "approve" without decide()
      reason: null,
    };
    records.set(id, record);
    return snapshot(record);
  }

  function settle(record, decision, reason) {
    if (record.decision !== null)
      throw new Error("Approval already decided (exactly-once): " + record.id);
    if (decision !== "approve" && decision !== "deny")
      throw new TypeError("Decision must be \"approve\" or \"deny\"; nothing else is auto-decided.");
    record.decision = decision;
    record.reason = strOf(reason) || (decision === "approve" ? "owner-approved" : "owner-denied");
    const waiter = waiters.get(record.id);
    waiters.delete(record.id);
    if (waiter) waiter(snapshot(record));
    return snapshot(record);
  }

  function lookup(id) {
    const record = records.get(id);
    if (!record) throw new Error("Unknown approval request: " + id);
    return record;
  }

  function decide(id, decision, reason) {
    return settle(lookup(id), decision, reason);
  }

  // Denial-only paths (INV-1): owner cancellation, caller-driven timeout, or
  // untrusted external resolution such as serverRequest/resolved (INV-5).
  function cancel(id, reason) { return settle(lookup(id), "deny", reason || "cancelled-by-owner"); }
  function expire(id, reason) { return settle(lookup(id), "deny", reason || "expired-without-owner-decision"); }

  function resolve(id) {
    const record = records.get(id);
    if (record) return snapshot(record);
    throw new Error("Unknown approval request: " + id);
  }

  function waitForDecision(id) {
    const record = lookup(id);
    if (record.decision !== null) return Promise.resolve(snapshot(record));
    return new Promise((resolve) => waiters.set(id, resolve));
  }

  function pending() {
    return [...records.values()].filter(r => r.decision === null).map(snapshot);
  }

  function close() { closed = true; }

  return { request, decide, cancel, expire, resolve, waitForDecision, pending, close };
}

/* ---------- Codex App Server runner (INV-3, INV-4, INV-5) ---------- */

const CODEX_METHODS = Object.freeze({
  started: "item/started",
  agentMessageDelta: "item/agentMessage/delta",
  outputDelta: "item/commandExecution/outputDelta",
  itemCompleted: "item/completed",
  turnCompleted: "turn/completed",
  commandApproval: "item/commandExecution/requestApproval",
  fileChangeApproval: "item/fileChange/requestApproval",
  serverRequestResolved: "serverRequest/resolved",
});

/**
 * Documented terminal turn.status values ONLY (official App Server docs).
 * "interrupted" is an explicit owner/server interruption and is reported as
 * the canonical "aborted"; the mapping is one-way and total over the
 * documented set. Anything else fails closed to "unknown" (INV-3).
 */
const CODEX_TURN_STATUS = Object.freeze({
  completed: "completed",
  interrupted: "aborted",
  failed: "failed",
});

function frameId(frame) {
  if (!isPlainObject(frame)) return null;
  const value = frame.id;
  return (typeof value === "string" || typeof value === "number") ? String(value) : null;
}

/**
 * runCodexLive({ frames, gate }) — consume a Codex App Server event stream
 * as JSON-RPC notifications/requests {id?, method, params?}.
 *
 * Approval frames register a gate request and, once (and only once) the gate
 * is explicitly settled, emit exactly one JSON-RPC response
 * { id, result: { decision, reason } } into outbox. The runner never emits
 * any response itself, never approves, and refuses frames outside the
 * documented allowlist (quoted in the header) as unrecognized.
 */
export async function runCodexLive({ frames, gate } = {}) {
  if (!gate || typeof gate.request !== "function" || typeof gate.decide !== "function")
    throw new TypeError("An approval gate is required so approvals can never be auto-decided.");
  const iterator = asyncFrames(frames);
  const timeline = makeCappedList(TIMELINE_CAP);
  const unrecognized = makeCappedList(UNRECOGNIZED_CAP);
  const outbox = [];
  const approvalsByFrame = new Map(); // JSON-RPC frame id -> gate record id
  const emitted = new Set();          // gate record ids already answered
  let status = "unknown";             // INV-3: unknown until an explicit terminal frame

  function frameMeta(params) {
    return {
      threadId: strOf(params.threadId),
      turnId: strOf(params.turnId),
      itemId: strOf(params.itemId),
    };
  }

  function emitDecided() {
    for (const [fid, gateId] of approvalsByFrame) {
      if (emitted.has(gateId)) continue;
      const record = gate.resolve(gateId);
      if (record.decision === null) continue; // still pending: no response (INV-1)
      outbox.push({ id: fid === null ? null : fid, result: { decision: record.decision, reason: record.reason } });
      emitted.add(gateId);
    }
  }

  try {
    for (;;) {
      const step = await iterator.next();
      if (step.done) break;
      const frame = step.value;
      if (!isPlainObject(frame) || typeof frame.method !== "string") {
        unrecognized.push({ reason: "not-a-jsonrpc-method-frame" });
        continue;
      }
      const method = frame.method.slice(0, 200);
      const params = isPlainObject(frame.params) ? frame.params : {};
      const fid = frameId(frame);

      if (method === CODEX_METHODS.turnCompleted) {
        const raw = typeof params.status === "string" ? params.status : null;
        if (raw !== null && raw in CODEX_TURN_STATUS) {
          status = CODEX_TURN_STATUS[raw];
        } else {
          status = "unknown"; // documented set is exactly completed|interrupted|failed (INV-3)
          unrecognized.push({ method, reason: "turn.status outside documented vocabulary" });
        }
        timeline.push("turn/completed");
        emitDecided();
        continue;
      }

      if (method === CODEX_METHODS.commandApproval || method === CODEX_METHODS.fileChangeApproval) {
        const kind = method === CODEX_METHODS.commandApproval
          ? APPROVAL_KINDS.command : APPROVAL_KINDS["file-change"];
        const record = gate.request(kind, { ...frameMeta(params), method });
        if (fid !== null) approvalsByFrame.set(fid, record.id);
        timeline.push(method);
        emitDecided(); // normally still pending
        continue;
      }

      if (method === CODEX_METHODS.serverRequestResolved) {
        // Param shape is unverified (D-013); the conservative reading is that
        // this resolves a server-initiated request by its JSON-RPC id.
        // Settlement is DENIED with provenance, never approved (INV-5).
        const ref = strOf(params.id) || strOf(params.serverRequestId) || strOf(params.requestId);
        if (ref !== null) {
          for (const [approvalFid, gateId] of approvalsByFrame) {
            if (approvalFid !== ref && ref !== gateId) continue;
            const record = gate.resolve(gateId);
            if (record.decision === null)
              gate.expire(gateId, "server-resolved; not owner-approved");
            else if (record.decision === "approve") {
              // Owner already approved explicitly; exactly-once keeps that
              // decision intact (INV-2) and the frame is quarantined.
              unrecognized.push({ method, reason: "server-resolved references an owner-approved request" });
            }
            break;
          }
        }
        timeline.push(method);
        emitDecided();
        continue;
      }

      if (method === CODEX_METHODS.started
          || method === CODEX_METHODS.agentMessageDelta
          || method === CODEX_METHODS.outputDelta
          || method === CODEX_METHODS.itemCompleted) {
        timeline.push(method + (strOf(params.itemId) !== null ? ":" + strOf(params.itemId) : ""));
        continue;
      }

      // Not in the documented allowlist: quarantine, do not trust (INV-4).
      unrecognized.push({ method, reason: "method outside documented App Server allowlist" });
    }
  } catch (error) {
    // A transport/iteration error is a genuine failure (CON-017), but a
    // terminal frame already received is authoritative and never clobbered.
    if (status === "unknown") {
      status = "failed";
      unrecognized.push({ reason: "stream-error:" + ((error && typeof error.message === "string") ? error.message.slice(0, 64) : "error") });
    }
  }

  emitDecided();
  return {
    provider: "codex-app-server",
    status,
    timeline: timeline.entries,
    timelineDropped: timeline.dropped,
    unrecognized: unrecognized.entries,
    unrecognizedDropped: unrecognized.dropped,
    outbox,
    approvals: [...approvalsByFrame.values()].map(gateId => gate.resolve(gateId)),
  };
}

/* ---------- Claude Agent SDK message contract runner (INV-1, INV-3, INV-4) ---------- */

/**
 * runClaudeLive({ stream, gate, signal }) — consume a Claude Agent SDK
 * `query()`-style async message iterable under the minimal verified subset.
 *
 * Terminal status ladder (INV-3, CON-017):
 *   - explicit { type: "result" } message decides the outcome:
 *       isError === true                      -> "failed"
 *       subtype === "success"                 -> "completed"
 *       other string subtype                  -> "failed" (not verified success)
 *       neither field (unverified shape)      -> "unknown" (no fake success)
 *   - stream ends WITHOUT a result message   -> "unknown" (disconnect, AGENT-005)
 *   - stream throws a non-abort error        -> "failed"
 *   - explicit abort with no terminal yet    -> "aborted"; post-abort messages
 *     are discarded and never processed (INV-3/INV-4).
 *
 * Non-`result` messages are informational timeline entries only; they can
 * never establish a terminal state. The exact SDK message schema is versioned
 * and not pinned here (see D-013); everything unverified stays "unknown".
 */
export async function runClaudeLive({ stream, gate, signal } = {}) {
  if (!gate || typeof gate.request !== "function")
    throw new TypeError("An approval gate is required so tool approvals can never be auto-decided.");
  if (stream == null || typeof stream[Symbol.asyncIterator] !== "function")
    throw new TypeError("A Claude Agent SDK message stream (async iterable) is required.");

  const timeline = makeCappedList(TIMELINE_CAP);
  const unrecognized = makeCappedList(UNRECOGNIZED_CAP);
  let status = "unknown";
  let terminalKind = null;
  let aborted = false;

  try {
    for await (const message of stream) {
      if (signal && signal.aborted) { aborted = true; break; }
      if (!isPlainObject(message) || typeof message.type !== "string") {
        unrecognized.push("message is not a typed object");
        continue;
      }
      const type = message.type.slice(0, 64);
      if (type === "result") {
        if (message.isError === true) { status = "failed"; terminalKind = "result-isError"; }
        else if (message.subtype === "success") { status = "completed"; terminalKind = "result-success"; }
        else if (typeof message.subtype === "string") { status = "failed"; terminalKind = "result-" + message.subtype.slice(0, 64); }
        else { status = "unknown"; terminalKind = "result-unverified-shape"; }
        timeline.push("result");
        break; // terminal message ends the run
      }
      timeline.push(type);
    }
  } catch (error) {
    if (signal && signal.aborted) aborted = true;
    else {
      // An error while consuming the stream is a genuine failure, distinct
      // from "unknown" (CON-017: distinguishable terminal states).
      status = "failed";
      terminalKind = "stream-error:" + (error && typeof error.message === "string" ? error.message.slice(0, 64) : "error");
    }
  }

  if (aborted && status === "unknown") {
    status = "aborted";
    terminalKind = terminalKind || "owner-abort";
  }

  return {
    provider: "claude-agent-sdk",
    status,
    terminalKind,
    timeline: timeline.entries,
    timelineDropped: timeline.dropped,
    unrecognized: unrecognized.entries,
    unrecognizedDropped: unrecognized.dropped,
  };
}

/* ---------- canUseTool bridge (INV-1; deferred SDK shape, see D-013) ---------- */

/**
 * createCanUseToolBridge(gate) — neutral decision bridge for SDK tool-call
 * approval. The bridge registers the request on the gate and awaits the
 * OWNER's explicit decision; it can only ever return "approve" if
 * gate.decide(..., "approve") was called. It returns a provider-neutral
 * { decision, reason, requestId } object; mapping that to the SDK's exact
 * canUseTool return shape is deliberately deferred (D-013) until the
 * installed SDK version is verified on a live host.
 */
export function createCanUseToolBridge(gate) {
  if (!gate || typeof gate.request !== "function" || typeof gate.waitForDecision !== "function")
    throw new TypeError("An approval gate is required so tool approvals can never be auto-decided.");
  return async function canUseTool(tool, input, meta) {
    const name = strOf(tool, 120) || "unnamed-tool";
    const record = gate.request(APPROVAL_KINDS["sdk-tool"], {
      tool: name,
      toolMeta: isPlainObject(meta) ? { name: strOf(meta.name) } : null,
      inputKeys: isPlainObject(input) ? Object.keys(input).slice(0, 16) : null,
    });
    const settled = await gate.waitForDecision(record.id);
    return { decision: settled.decision, reason: settled.reason, requestId: settled.id };
  };
}
