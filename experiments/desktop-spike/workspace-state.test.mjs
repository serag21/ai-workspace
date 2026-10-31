/*
 * REL-010 crash-recovery regression tests (synthetic, CPU-only).
 *
 * These exercise the recovery LOGIC of the crash-safe workspace state store:
 * torn/current-generation fallback, stale tmp cleanup, exactly-once-attempt
 * surfacing (no automatic resend), byte-capped drafts, newer-version refusal
 * and size-bound refusal. They are NOT proof that live crash recovery was
 * verified on a real machine; that remains a live-host acceptance gate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp, rm, writeFile, readFile, readdir} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WorkspaceStateStore, defaultState, capUtf8,
  recordAction, completeAction, needsVerification,
  normalizeForSave, MAX_DRAFT_BYTES, MAX_STATE_BYTES,
} from "./workspace-state.mjs";

const CURRENT = "workspace-state.json";
const PREVIOUS = "workspace-state.previous.json";

const stateWith = (draftText, session = "s1") => ({
  ...defaultState(),
  layout: {paneCount: 2, split: "horizontal", activePane: "left"},
  sessionOrder: [session, "s2"],
  drafts: {[session]: {text: draftText, overflow: false}},
});

const freshDir = async prefix => {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  return {dir, end: () => rm(dir, {recursive: true, force: true})};
};

const envelope = (state, version = 1) => JSON.stringify({
  v: version,
  savedAt: "2026-10-30T00:00:00.000Z",
  // The store verifies the checksum of the canonical state JSON; mirror that.
  checksum: cryptoCreateChecksum(JSON.stringify(state)),
  state,
});
// Small local mirror of the store's sha256 scheme (canonical state hashing).
import {createHash} from "node:crypto";
function cryptoCreateChecksum(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

test("REL-010 CON-007: save then load round-trips layout, session order and drafts", async () => {
  const {dir, end} = await freshDir("aiw-ws-state-");
  try {
    const store = new WorkspaceStateStore(dir);
    const saved = stateWith("keep this draft after relaunch");
    await store.save(saved);

    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.recovered, false);
    assert.equal(loaded.staleTempsRemoved, 0);
    assert.deepEqual(loaded.state, {
      layout: {paneCount: 2, split: "horizontal", activePane: "left"},
      sessionOrder: ["s1", "s2"],
      drafts: {s1: {text: "keep this draft after relaunch", overflow: false}},
      pendingActions: [],
    });
  } finally {
    await end();
  }
});

test("REL-010 CON-013: a torn current generation recovers from the previous complete one", async () => {
  const {dir, end} = await freshDir("aiw-ws-recover-");
  try {
    const first = stateWith("first complete generation");
    await new WorkspaceStateStore(dir).save(first);
    // Second save: PREVIOUS <- first, CURRENT <- second.
    await new WorkspaceStateStore(dir).save(stateWith("second generation"));

    // Simulate a crash mid-write: CURRENT is now torn garbage.
    await writeFile(path.join(dir, CURRENT), '{"v":1,"che', "utf8");

    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.recoveredFrom, "corrupt-or-missing-current");
    assert.equal(loaded.state.drafts.s1.text, "first complete generation");

    // The store re-asserts the recovered generation as CURRENT, so a second
    // launch sees a consistent store instead of looping through fallback.
    const again = await new WorkspaceStateStore(dir).load();
    assert.equal(again.recovered, false);
    assert.equal(again.state.drafts.s1.text, "first complete generation");
  } finally {
    await end();
  }
});

test("REL-010 CON-013: stale writer tmp files are removed on recovery", async () => {
  const {dir, end} = await freshDir("aiw-ws-stale-");
  try {
    await new WorkspaceStateStore(dir).save(stateWith("draft survives cleanup"));
    // A crashed writer leaves tmp artifacts behind.
    await writeFile(path.join(dir, "tmp-4242-1"), "partial", "utf8");
    await writeFile(path.join(dir, "tmp-4242-2"), "partial", "utf8");

    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.staleTempsRemoved, 2);
    const names = await readdir(dir);
    assert.ok(!names.some(n => n.startsWith("tmp-")), "no stale tmp files may remain");
    assert.equal(loaded.state.drafts.s1.text, "draft survives cleanup");
  } finally {
    await end();
  }
});

test("CON-008 REL-010: a dispatched but unacknowledged action surfaces for manual check and is never redone", async () => {
  const {dir, end} = await freshDir("aiw-ws-once-");
  try {
    let state = stateWith("draft with a pending action");
    state = recordAction(state, "resume-codex-1", "Open external terminal to resume codex-1");
    state = recordAction(state, "resume-codex-1", "Open external terminal to resume codex-1");
    assert.equal(state.pendingActions.length, 1, "re-recording an id must not duplicate the ledger entry");
    await new WorkspaceStateStore(dir).save(state);

    // The owner's machine crashed before acknowledgement. A fresh process
    // loads the same ledger — it must SURFACE the in-flight action, and the
    // module itself must not add, complete, or re-dispatch anything.
    const loaded = await new WorkspaceStateStore(dir).load();
    const pending = needsVerification(loaded.state);
    assert.equal(pending.length, 1);
    assert.deepEqual(pending[0], {
      id: "resume-codex-1",
      effect: "Open external terminal to resume codex-1",
      needsVerification: true,
    });
    assert.equal(loaded.state.pendingActions.length, 1,
      "one in-flight action: surfaced, not duplicated and not silently completed");
  } finally {
    await end();
  }
});

test("CON-008: acknowledgement clears an action from the verification set and never throws for unknown ids", async () => {
  let state = stateWith("draft");
  state = recordAction(state, "a-1", "effect one");
  assert.equal(needsVerification(state).length, 1);

  state = completeAction(state, "a-1");
  assert.equal(needsVerification(state).length, 0);
  assert.equal(state.pendingActions[0].status, "completed");
  state = completeAction(state, "a-1"); // idempotent
  assert.equal(state.pendingActions.length, 1);
  assert.equal(completeAction(state, "never-saw-it") === state, true);
});

test("CON-007 REL-010: an oversized multibyte draft is byte-capped with an honest overflow flag and no torn codepoint", async () => {
  // 100_000 x 3-byte codepoints = 300_000 bytes > MAX_DRAFT_BYTES (262_144).
  const text = "日".repeat(100_000);
  const capped = capUtf8(text, MAX_DRAFT_BYTES);
  assert.equal(capped.overflow, true);
  const expectedChars = Math.floor(MAX_DRAFT_BYTES / 3); // cut lands mid-codepoint
  assert.equal(capped.text.length, expectedChars);
  assert.ok(capped.text.endsWith("日"), "cap must end on a whole codepoint");
  assert.ok(!capped.text.includes("\uFFFD"), "no replacement characters may leak into the draft");
  assert.ok(Buffer.byteLength(capped.text, "utf8") <= MAX_DRAFT_BYTES);

  // Under the boundary the draft is kept verbatim and not flagged.
  const small = capUtf8("日".repeat(expectedChars), MAX_DRAFT_BYTES);
  assert.equal(small.overflow, false);
  assert.equal(small.text.length, expectedChars);

  // Persisting and reloading preserves the honest cap, not the raw overflow.
  const {dir, end} = await freshDir("aiw-ws-cap-");
  try {
    await new WorkspaceStateStore(dir).save(stateWith(text));
    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.state.drafts.s1.overflow, true);
    assert.equal(loaded.state.drafts.s1.text, capped.text);

    const normalized = normalizeForSave(stateWith(text));
    assert.equal(normalized.cappedDrafts, 1);
  } finally {
    await end();
  }
});

test("CON-013 REL-010: a newer schema version is refused, never silently downgraded or clobbered", async () => {
  const {dir, end} = await freshDir("aiw-ws-ver-");
  try {
    const newerState = stateWith("wrote by a newer build");
    // Envelope with a valid shape and correct checksum but v:2.
    await writeFile(path.join(dir, CURRENT), envelope(newerState, 2), "utf8");

    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.state, null, "a newer generation must not be downgraded into the old shape");
    assert.equal(loaded.recoveredFrom, "newer-version");
    assert.equal(loaded.version, 2);

    // Saving must refuse before touching disk, and the newer bytes stay intact.
    const before = await readFile(path.join(dir, CURRENT), "utf8");
    await assert.rejects(new WorkspaceStateStore(dir).save(stateWith("old build data")),
      /newer state schema/);
    assert.equal(await readFile(path.join(dir, CURRENT), "utf8"), before);
  } finally {
    await end();
  }
});

test("REL-010 CON-013: state beyond the byte bound is refused before any file is created", async () => {
  const {dir, end} = await freshDir("aiw-ws-size-");
  try {
    // ~10 MiB of drafts: individually within the draft cap, but the
    // combined envelope exceeds MAX_STATE_BYTES.
    const big = defaultState();
    big.sessionOrder = Array.from({length: 40}, (_, i) => "s" + i);
    for (let i = 0; i < 40; i += 1) {
      big.drafts["s" + i] = {text: "x".repeat(MAX_DRAFT_BYTES), overflow: false};
    }
    await assert.rejects(new WorkspaceStateStore(dir).save(big), /byte bound/);

    const names = await readdir(dir);
    assert.ok(!names.includes(CURRENT), "no current generation may have been written");
    assert.ok(!names.includes(PREVIOUS), "no previous generation may have been written");
    assert.ok(!names.some(n => n.startsWith("tmp-")), "no tmp artifact may have been created");
  } finally {
    await end();
  }
});

test("REL-010 CON-013: both generations corrupt yields an honest fresh state", async () => {
  const {dir, end} = await freshDir("aiw-ws-both-");
  try {
    await writeFile(path.join(dir, CURRENT), "not even json", "utf8");
    await writeFile(path.join(dir, PREVIOUS), "{\"v\":1", "utf8");

    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.recoveredFrom, "no-valid-generation");
    assert.deepEqual(loaded.state, defaultState(),
      "a fresh, empty, valid state must be the honest recovery outcome");
  } finally {
    await end();
  }
});

test("REL-010 CON-013: a same-version envelope with an invalid state shape is treated as corrupt", async () => {
  const {dir, end} = await freshDir("aiw-ws-shape-");
  try {
    // Two good generations first, so the fallback target is well-defined.
    await new WorkspaceStateStore(dir).save(stateWith("good generation one"));
    await new WorkspaceStateStore(dir).save(stateWith("good generation two"));

    // CURRENT now parses and even checksums, but its state violates the
    // shape contract (sessionOrder holds a non-string).
    const invalid = stateWith("good generation two");
    invalid.sessionOrder = [42];
    await writeFile(path.join(dir, CURRENT), envelope(invalid), "utf8");

    const loaded = await new WorkspaceStateStore(dir).load();
    assert.equal(loaded.recovered, true);
    assert.equal(loaded.recoveredFrom, "corrupt-or-missing-current");
    assert.equal(loaded.state.drafts.s1.text, "good generation one",
      "the invalid-shape generation must be skipped, not trusted");
  } finally {
    await end();
  }
});
