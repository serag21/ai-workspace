/**
 * Crash-safe, versioned LOCAL workspace state (REL-010, CON-013, CON-007).
 *
 * Holds what a crash must never lose and never duplicate:
 *   - workspace layout, session order, per-session drafts (bounded),
 *   - a ledger of external actions that were DISPATCHED but not yet
 *     acknowledged (exactly-once-attempt support, CON-008 spirit).
 *
 * Crash semantics (synthetic, CPU-only — no real process kill, no network,
 * no timers, no subprocesses; single-writer assumption is documented):
 *   - every generation is written tmp-file -> flush -> atomic rename, and the
 *     previous good generation is kept separately, so a torn or corrupt
 *     current generation falls back to the last COMPLETE one;
 *   - stale tmp files from a crashed writer are removed on recovery;
 *   - recovery SURFACES dispatched-but-unacknowledged actions for human
 *     verification; this module has no dispatch channel of its own, so
 *     nothing is ever resent automatically;
 *   - a NEWER schema version is refused (never silently downgraded, CON-013);
 *   - state exceeding size bounds is refused before any bytes are written.
 *
 * This is NOT a claim that live crash recovery has been verified on a real
 * machine; it is a repeatable synthetic regression of the recovery logic.
 */
import {open, rename, readdir, rm, mkdir, readFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";

export const SUPPORTED_VERSION = 1;
export const MAX_STATE_BYTES = 8 * 1024 * 1024;   // whole persisted envelope
export const MAX_DRAFT_BYTES = 256 * 1024;        // per-draft text bound

const CURRENT = "workspace-state.json";
const PREVIOUS = "workspace-state.previous.json";
const TEMP_PREFIX = "tmp-";

export function defaultState() {
  return {
    layout: {paneCount: 0, split: null, activePane: null},
    sessionOrder: [],
    drafts: {},
    pendingActions: [],
  };
}

/** Cap a UTF-8 string by BYTES without ever ending on a torn codepoint. */
export function capUtf8(text, maxBytes) {
  if (typeof text !== "string") throw new TypeError("Expected draft text.");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new RangeError("maxBytes must be a positive integer.");
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return {text, overflow: false};
  const bytes = Buffer.from(text, "utf8").subarray(0, maxBytes);
  // A tail cut inside a codepoint decodes with a trailing U+FFFD; drop it.
  let end = bytes.toString("utf8");
  while (end.length > 0 && end.charCodeAt(end.length - 1) === 0xFFFD) end = end.slice(0, -1);
  return {text: end, overflow: true};
}

function isValidState(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) return false;
  if (!state.layout || typeof state.layout !== "object" || Array.isArray(state.layout)) return false;
  if (!Array.isArray(state.sessionOrder) ||
      !state.sessionOrder.every(x => typeof x === "string")) return false;
  if (!state.drafts || typeof state.drafts !== "object" || Array.isArray(state.drafts)) return false;
  for (const value of Object.values(state.drafts)) {
    if (!value || typeof value !== "object" ||
        typeof value.text !== "string" || typeof value.overflow !== "boolean") return false;
  }
  if (!Array.isArray(state.pendingActions)) return false;
  return state.pendingActions.every(a => a &&
    typeof a.id === "string" && a.id.length > 0 && a.id.length <= 200 &&
    typeof a.effect === "string" && a.effect.length > 0 && a.effect.length <= 1000 &&
    (a.status === "dispatched" || a.status === "completed"));
}

/** Add a dispatched action to the ledger (pure; returns a new state). */
export function recordAction(state, id, effect) {
  if (!state || typeof state !== "object") throw new TypeError("Expected workspace state.");
  if (typeof id !== "string" || id.length < 1 || id.length > 200)
    throw new RangeError("Action id must be a 1-200 character string.");
  if (typeof effect !== "string" || effect.trim().length < 1 || effect.length > 1000)
    throw new RangeError("Action effect must be a 1-1000 character description.");
  const rest = state.pendingActions.filter(a => a.id !== id);
  return {...state, pendingActions: [...rest, {id, effect, status: "dispatched"}]};
}

/** Acknowledge a dispatched action (idempotent; pure; returns a new state). */
export function completeAction(state, id) {
  if (!state || typeof state !== "object") throw new TypeError("Expected workspace state.");
  if (typeof id !== "string" || id.length < 1 || id.length > 200)
    throw new RangeError("Action id must be a 1-200 character string.");
  if (!state.pendingActions.some(a => a.id === id)) return state;
  return {...state, pendingActions: state.pendingActions.map(a =>
    a.id === id ? {...a, status: "completed"} : a)};
}

/**
 * Actions that a crash left dispatched-but-unacknowledged. These MUST be
 * verified by a human; a caller must NEVER re-dispatch them automatically.
 */
export function needsVerification(state) {
  if (!state || typeof state !== "object") throw new TypeError("Expected workspace state.");
  return state.pendingActions
    .filter(a => a.status === "dispatched")
    .map(a => ({id: a.id, effect: a.effect, needsVerification: true}));
}

/** Validate and normalize drafts to the documented byte bound (pure). */
export function normalizeForSave(state) {
  if (!isValidState(state)) throw new TypeError("Invalid workspace state shape.");
  const drafts = {};
  let cappedCount = 0;
  for (const [key, value] of Object.entries(state.drafts)) {
    if (typeof key !== "string" || key.length < 1 || key.length > 300)
      throw new RangeError("Draft key must be a 1-300 character session id.");
    const {text, overflow} = capUtf8(value.text, MAX_DRAFT_BYTES);
    if (overflow) cappedCount += 1;
    drafts[key] = {text, overflow};
  }
  return {
    state: {
      layout: state.layout,
      sessionOrder: [...state.sessionOrder],
      drafts,
      pendingActions: state.pendingActions.map(a => ({...a})),
    },
    cappedDrafts: cappedCount,
  };
}

export class WorkspaceStateStore {
  #root;
  #now;
  #tempSeq = 0;
  #newerVersionSeen = null;

  constructor(root, {now = () => new Date().toISOString()} = {}) {
    if (typeof root !== "string" || !root.trim()) throw new TypeError("Expected a state directory path.");
    if (typeof now !== "function") throw new TypeError("now must be a function.");
    this.#root = root;
    this.#now = now;
  }

  #file(name) {
    return path.join(this.#root, name);
  }

  static #checksum(text) {
    return createHash("sha256").update(text, "utf8").digest("hex");
  }

  /** Build the on-disk envelope for a canonical state JSON string. */
  static #envelope(stateText) {
    return JSON.stringify({
      v: SUPPORTED_VERSION,
      savedAt: null,
      checksum: WorkspaceStateStore.#checksum(stateText),
      state: JSON.parse(stateText),
    });
  }

  async #writeAtomic(fileName, text) {
    await mkdir(this.#root, {recursive: true});
    const tmpName = TEMP_PREFIX + process.pid + "-" + (++this.#tempSeq);
    const tmpPath = this.#file(tmpName);
    const handle = await open(tmpPath, "w");
    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpPath, this.#file(fileName));
  }

  async #readText(fileName) {
    try {
      return await readFile(this.#file(fileName), "utf8");
    } catch {
      return null;
    }
  }

  async #clearStaleTemps() {
    let names = [];
    try { names = await readdir(this.#root); } catch { return 0; }
    let removed = 0;
    for (const name of names) {
      if (!name.startsWith(TEMP_PREFIX)) continue;
      await rm(this.#file(name), {force: true}).catch(() => {});
      removed += 1;
    }
    return removed;
  }

  /**
   * Inspect one generation file.
   * @returns {Promise<{kind:"state",state:object}|{kind:"refused",version:number}|null>}
   *   "refused" = parseable but a newer schema version; null = absent, unparseable,
   *   checksum mismatch, or invalid state shape.
   */
  async #inspect(fileName) {
    const text = await this.#readText(fileName);
    if (text === null) return null;
    let envelope;
    try { envelope = JSON.parse(text); } catch { return null; }
    if (!envelope || typeof envelope !== "object") return null;
    if (envelope.v !== SUPPORTED_VERSION) {
      return typeof envelope.v === "number" ? {kind: "refused", version: envelope.v} : null;
    }
    if (typeof envelope.checksum !== "string" || !isValidState(envelope.state)) return null;
    // Re-serialize the parsed state the same way the writer did and verify.
    if (WorkspaceStateStore.#checksum(JSON.stringify(envelope.state)) !== envelope.checksum) return null;
    return {kind: "state", state: envelope.state};
  }

  /**
   * Load the best valid generation. Never throws for on-disk conditions;
   * never returns a torn or checksum-mismatched generation; never
   * re-dispatches anything. A newer schema version is reported, not clobbered.
   */
  async load() {
    await mkdir(this.#root, {recursive: true});
    const stale = await this.#clearStaleTemps();
    const base = {staleTempsRemoved: stale};

    const current = await this.#inspect(CURRENT);
    if (current?.kind === "refused") {
      this.#newerVersionSeen = current.version;
      return {...base, state: null, recovered: true, recoveredFrom: "newer-version", version: current.version};
    }
    if (current?.kind === "state") {
      return {...base, state: current.state, recovered: false, recoveredFrom: null};
    }

    const previous = await this.#inspect(PREVIOUS);
    if (previous?.kind === "refused") {
      this.#newerVersionSeen = previous.version;
      return {...base, state: null, recovered: true, recoveredFrom: "newer-version", version: previous.version};
    }
    if (previous?.kind === "state") {
      const stateText = JSON.stringify(previous.state);
      await this.#writeAtomic(CURRENT,
        JSON.stringify({v: SUPPORTED_VERSION, savedAt: this.#now(),
                        checksum: WorkspaceStateStore.#checksum(stateText),
                        state: JSON.parse(stateText)})).catch(() => {});
      return {...base, state: previous.state, recovered: true, recoveredFrom: "corrupt-or-missing-current"};
    }

    return {...base, state: defaultState(), recovered: true, recoveredFrom: "no-valid-generation"};
  }

  /**
   * Persist a new generation atomically, retaining the previous good one.
   * Refuses (before writing anything) if state is out of shape, exceeds the
   * byte bound, or a newer schema version is on disk.
   */
  async save(state) {
    if (this.#newerVersionSeen !== null) {
      throw new RangeError("Refusing to write over a newer state schema (v" + this.#newerVersionSeen + ").");
    }
    const {state: normalized, cappedDrafts} = normalizeForSave(state);
    const stateText = JSON.stringify(normalized);
    const text = JSON.stringify({
      v: SUPPORTED_VERSION,
      savedAt: this.#now(),
      checksum: WorkspaceStateStore.#checksum(stateText),
      state: JSON.parse(stateText),
    });
    if (Buffer.byteLength(text, "utf8") > MAX_STATE_BYTES) {
      throw new RangeError("Workspace state exceeds the " + MAX_STATE_BYTES + " byte bound; reduce drafts or sessions.");
    }

    const currentText = await this.#readText(CURRENT);
    if (currentText !== null) {
      const currentInspection = await this.#inspect(CURRENT);
      if (currentInspection?.kind === "refused") {
        this.#newerVersionSeen = currentInspection.version;
        throw new RangeError("Refusing to write over a newer state schema (v" + currentInspection.version + ").");
      }
      if (currentInspection?.kind === "state") {
        await this.#writeAtomic(PREVIOUS, currentText); // keep the exact good bytes
      }
      // corrupt current: leave the previous generation untouched
    }
    await this.#writeAtomic(CURRENT, text);
    return {savedAt: this.#now(), cappedDrafts, bytes: Buffer.byteLength(text, "utf8")};
  }
}
