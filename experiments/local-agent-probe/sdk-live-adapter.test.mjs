import test from "node:test";
import assert from "node:assert/strict";
import {
  createApprovalGate,
  runCodexLive,
  runClaudeLive,
  createCanUseToolBridge,
} from "./sdk-live-adapter.mjs";

/* Fixture helpers: injected, CPU-only streams; no network, no process. */

const approvalFrame = (id, method) => ({
  id,
  method,
  params: { threadId: "th-1", turnId: "turn-1", itemId: "item-1" },
});

test("AGENT-005 CON-017: Codex turn is unknown until an explicit turn/completed; never inferred from deltas", async () => {
  const gate = createApprovalGate();
  const frames = [
    { method: "item/started", params: { itemId: "a" } },
    { method: "item/agentMessage/delta", params: { itemId: "a", text: "thinking..." } },
    { method: "item/commandExecution/outputDelta", params: { itemId: "b" } },
    { method: "item/completed", params: { itemId: "b" } },
  ];
  const noTerminal = await runCodexLive({ frames, gate });
  assert.equal(noTerminal.status, "unknown");
  assert.equal(noTerminal.outbox.length, 0);

  const withTerminal = await runCodexLive({
    frames: [...frames, { method: "turn/completed", params: { status: "completed" } }],
    gate,
  });
  assert.equal(withTerminal.status, "completed");
});

test("AGENT-005: documented turn.status allowlist maps interrupted->aborted and failed->failed; out-of-vocabulary stays unknown (no invented stopReason)", async () => {
  const gate = createApprovalGate();
  const run = status => runCodexLive({ frames: [{ method: "turn/completed", params: { status } }], gate });
  assert.equal((await run("completed")).status, "completed");
  assert.equal((await run("interrupted")).status, "aborted");
  assert.equal((await run("failed")).status, "failed");
  // Not part of the documented completed|interrupted|failed vocabulary.
  const out = await run("cancelled");
  assert.equal(out.status, "unknown");
  assert.equal(out.unrecognized.length, 1);
  assert.match(out.unrecognized[0].reason, /turn\.status/);
});

test("AGENT-005: frames outside the documented allowlist are quarantined and cannot force a terminal status", async () => {
  const gate = createApprovalGate();
  const frames = [
    { method: "rogue/method", params: { status: "completed" } }, // must not count as terminal
    "not-even-an-object",
    { id: "x" }, // no method
    { method: "turn/completed", params: { status: "failed" } },
  ];
  const result = await runCodexLive({ frames, gate });
  assert.equal(result.status, "failed");
  assert.ok(result.unrecognized.length >= 3, "quarantine list captures the three malformed frames");
});

test("AGENT-003: Codex approval frames wait for an explicit gate decision and emit exactly one response", async () => {
  const gate = createApprovalGate();
  const frames = (async function* () {
    yield approvalFrame("req-1", "item/commandExecution/requestApproval");
    const pending = gate.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].decision, null);
    gate.decide(pending[0].id, "approve");
    yield { method: "turn/completed", params: { status: "completed" } };
  })();
  const result = await runCodexLive({ frames, gate });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.outbox, [{ id: "req-1", result: { decision: "approve", reason: "owner-approved" } }]);
  assert.equal(result.approvals.length, 1);
  assert.equal(result.approvals[0].kind, "command");
  assert.equal(result.approvals[0].decision, "approve");
});

test("AGENT-003: a fileChange approval that is never decided produces NO response (never auto-approved)", async () => {
  const gate = createApprovalGate();
  const frames = (async function* () {
    yield approvalFrame("req-2", "item/fileChange/requestApproval");
    yield { method: "turn/completed", params: { status: "interrupted" } };
  })();
  const result = await runCodexLive({ frames, gate });
  assert.equal(result.status, "aborted");
  assert.equal(result.outbox.length, 0);
  assert.equal(result.approvals[0].kind, "file-change");
  assert.equal(result.approvals[0].decision, null);
  assert.equal(result.approvals[0].decision !== "approve", true);
});

test("AGENT-003 CON-008: gate decisions are exactly-once and the gate refuses unknown ids and closed-state requests", async () => {
  const gate = createApprovalGate();
  const record = gate.request("command", { threadId: "t" });
  gate.decide(record.id, "approve");
  await assert.rejects(async () => { gate.decide(record.id, "deny"); }, /exactly-once/);
  await assert.rejects(async () => { gate.cancel(record.id); }, /exactly-once/);
  await assert.rejects(async () => { gate.resolve("APR-9999"); }, /Unknown approval request/);
  await assert.rejects(async () => { gate.request("bogus-kind", {}); }, /documented kind/);
  gate.close();
  await assert.rejects(async () => { gate.request("command", {}); }, /closed/);
});

test("AGENT-003: serverRequest/resolved settles a pending approval as denied with provenance, never as approved", async () => {
  const gate = createApprovalGate();
  const frames = [
    approvalFrame("req-3", "item/commandExecution/requestApproval"),
    // Untrusted server-side resolution; even a lying `approved` flag cannot approve.
    { id: "res-1", method: "serverRequest/resolved", params: { id: "req-3", approved: true } },
    { method: "turn/completed", params: { status: "completed" } },
  ];
  const result = await runCodexLive({ frames, gate });
  assert.equal(result.status, "completed");
  assert.equal(result.approvals[0].decision, "deny");
  assert.match(result.approvals[0].reason, /server-resolved/);
  assert.deepEqual(result.outbox, [{ id: "req-3", result: { decision: "deny", reason: "server-resolved; not owner-approved" } }]);

  // Owner-approved decisions stay intact (exactly-once); a later
  // serverRequest/resolved is quarantined, not overwritten.
  const gate2 = createApprovalGate();
  const frames2 = (async function* () {
    yield approvalFrame("req-4", "item/fileChange/requestApproval");
    const pending = gate2.pending();
    gate2.decide(pending[0].id, "approve");
    yield { id: "res-2", method: "serverRequest/resolved", params: { id: "req-4" } };
    yield { method: "turn/completed", params: { status: "completed" } };
  })();
  const result2 = await runCodexLive({ frames: frames2, gate: gate2 });
  assert.equal(result2.approvals[0].decision, "approve");
  assert.deepEqual(result2.outbox, [{ id: "req-4", result: { decision: "approve", reason: "owner-approved" } }]);
  assert.ok(result2.unrecognized.some(entry => /server-resolved/.test(entry.reason)));
});

test("AGENT-005 CON-017: a mid-stream Codex transport error is failed; a terminal frame already received is never clobbered", async () => {
  const gate = createApprovalGate();
  const errorStream = (async function* () {
    yield { method: "item/started", params: { itemId: "a" } };
    throw new Error("app-server connection lost");
  })();
  const errored = await runCodexLive({ frames: errorStream, gate });
  assert.equal(errored.status, "failed");
  assert.ok(errored.unrecognized.some(entry => /stream-error/.test(entry.reason ?? "")));

  const gate2 = createApprovalGate();
  const terminalFirst = (async function* () {
    yield { method: "turn/completed", params: { status: "completed" } };
    throw new Error("late disconnect");
  })();
  const preserved = await runCodexLive({ frames: terminalFirst, gate: gate2 });
  assert.equal(preserved.status, "completed");
});

test("AGENT-005: Codex timeline is bounded; oversized streams degrade, they do not balloon", async () => {
  const gate = createApprovalGate();
  const frames = [];
  for (let i = 0; i < 1500; i += 1) frames.push({ method: "item/agentMessage/delta", params: { itemId: "a" } });
  frames.push({ method: "turn/completed", params: { status: "completed" } });
  const result = await runCodexLive({ frames, gate });
  assert.equal(result.status, "completed");
  assert.ok(result.timeline.length <= 1000);
  assert.ok(result.timelineDropped >= 500);
});

test("AGENT-005 CON-017: Claude stream that ends without a result reports unknown (no fake terminal success)", async () => {
  const gate = createApprovalGate();
  const stream = (async function* () {
    yield { type: "system", subtype: "init" };
    yield { type: "assistant", message: { content: [{ type: "text", text: "working" }] } };
  })();
  const result = await runClaudeLive({ stream, gate });
  assert.equal(result.status, "unknown");
  assert.equal(result.terminalKind, null);
});

test("AGENT-005 CON-017: Claude result message decides honestly: isError failed, success completed, unverified shape unknown", async () => {
  const gate = createApprovalGate();
  const streamOf = (...messages) => (async function* () { for (const message of messages) yield message; })();
  const failed = await runClaudeLive({ stream: streamOf({ type: "result", isError: true }), gate });
  assert.equal(failed.status, "failed");
  const completed = await runClaudeLive({ stream: streamOf({ type: "result", subtype: "success" }), gate });
  assert.equal(completed.status, "completed");
  const otherSubtype = await runClaudeLive({ stream: streamOf({ type: "result", subtype: "error_max_turns" }), gate });
  assert.equal(otherSubtype.status, "failed");
  const unverified = await runClaudeLive({ stream: streamOf({ type: "result", someUnknownField: true }), gate });
  assert.equal(unverified.status, "unknown");
});

test("AGENT-005 CON-017: a Claude stream error surfaces as failed, distinct from unknown", async () => {
  const gate = createApprovalGate();
  const stream = (async function* () {
    yield { type: "assistant", message: { content: "partial" } };
    throw new Error("transport dropped mid-stream");
  })();
  const result = await runClaudeLive({ stream, gate });
  assert.equal(result.status, "failed");
  assert.match(result.terminalKind, /^stream-error/);
});

test("AGENT-003 INV-1: canUseTool bridge never approves on its own; cancel/timeout settle deny and explicit approve works", async () => {
  const deniedByCancel = createApprovalGate();
  const cancelBridge = createCanUseToolBridge(deniedByCancel);
  const cancelled = cancelBridge("Bash", { command: "rm -rf /tmp/x" });
  const pendingCancel = deniedByCancel.pending();
  assert.equal(pendingCancel.length, 1);
  assert.equal(pendingCancel[0].kind, "sdk-tool");
  deniedByCancel.cancel(pendingCancel[0].id);
  assert.deepEqual(await cancelled, { decision: "deny", reason: "cancelled-by-owner", requestId: pendingCancel[0].id });

  const expired = createApprovalGate();
  const timeoutBridge = createCanUseToolBridge(expired);
  const timedOut = timeoutBridge("Edit", {});
  expired.expire(expired.pending()[0].id);
  assert.equal((await timedOut).decision, "deny");
  assert.match((await timedOut).reason, /expired/);

  const approved = createApprovalGate();
  const approveBridge = createCanUseToolBridge(approved);
  const decision = approveBridge("Read", {});
  approved.decide(approved.pending()[0].id, "approve");
  assert.equal((await decision).decision, "approve");
});

test("AGENT-005 CON-017: abort discards post-abort messages and reports aborted instead of the discarded success", async () => {
  const gate = createApprovalGate();
  const controller = new AbortController();
  const stream = (async function* () {
    yield { type: "assistant", message: { content: "partial" } };
    controller.abort();
    yield { type: "result", subtype: "success" }; // must be discarded
  })();
  const result = await runClaudeLive({ stream, gate, signal: controller.signal });
  assert.equal(result.status, "aborted");
  assert.ok(!result.timeline.includes("result"), "post-abort terminal message was not processed");
});

test("AGENT-003: both runners refuse to run without an approval gate (approvals must never be auto-decided)", async () => {
  await assert.rejects(runCodexLive({ frames: [] }), /approval gate/);
  await assert.rejects(runClaudeLive({ stream: (async function* () {})() }), /approval gate/);
  assert.throws(() => createCanUseToolBridge({}), /approval gate/);
});
