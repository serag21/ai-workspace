import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdtemp, rm, writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const require=createRequire(import.meta.url);
const {parseAgentTail, readTranscriptTail, DEFAULT_MAX_BYTES} = require("./agent-tail.cjs");

const TWO_MIB = 2 * 1024 * 1024;
function assistantLine(content) {
  return JSON.stringify({type:"assistant",message:{role:"assistant",content}});
}
function userLine(content) {
  return JSON.stringify({type:"user",message:{role:"user",content}});
}

const CLAUDE_FIXTURE = [
  JSON.stringify({type:"user",message:{role:"user",content:"Fix the login bug"}}),
  JSON.stringify({type:"assistant",message:{role:"assistant",content:[
    {type:"thinking",thinking:"thinking hidden"},
    {type:"text",text:"I will inspect the auth module."},
    {type:"tool_use",name:"Read"},
  ]}}),
  JSON.stringify({type:"user",message:{role:"user",content:[
    {type:"tool_result",content:"line1"},
    {type:"text",text:"tool output"},
  ]}}),
  JSON.stringify({type:"assistant",message:{role:"assistant",content:"Done: patched src/auth.cjs"}}),
].join("\n") + "\n";

const CODEX_FIXTURE = [
  JSON.stringify({type:"session_meta",payload:{id:"11111111-1111-4111-8111-111111111111",cwd:"C:\\proj"}}),
  JSON.stringify({type:"response_item",payload:{role:"user",content:[{type:"input_text",text:"Write the parser"}]}}),
  JSON.stringify({type:"response_item",payload:{role:"developer",content:"system noise must not surface"}}),
  JSON.stringify({type:"response_item",payload:{role:"assistant",content:[{type:"output_text",text:"Parser written."}]}}),
  JSON.stringify({type:"event_msg",payload:{type:"agent_message",message:"Parser written."}}),
].join("\n") + "\n";

test("AGENT-004 CON-004: Claude Code tail shows user/assistant turns and tool markers, in order", () => {
  const result = parseAgentTail(CLAUDE_FIXTURE, "claude-code");
  assert.equal(result.unreadable, false);
  assert.equal(result.droppedLines, 0);
  assert.equal(result.messages.length, 4);
  assert.deepEqual(result.messages.map(m => m.role), ["user","assistant","user","assistant"]);
  assert.match(result.messages[1].text, /I will inspect the auth module\./);
  assert.match(result.messages[1].text, /\[tool use: Read\]/);
  assert.ok(!/thinking hidden/.test(result.messages[1].text), "thinking blocks must not surface");
  assert.equal(result.messages[3].text, "Done: patched src/auth.cjs");
  assert.equal(result.elidedEarlier, 0);
});

test("AGENT-004: Codex tail uses role items, drops developer/system items, dedups event echoes", () => {
  const result = parseAgentTail(CODEX_FIXTURE, "codex");
  assert.equal(result.unreadable, false);
  assert.equal(result.messages.length, 2);
  assert.deepEqual(result.messages.map(m => m.role), ["user","assistant"]);
  assert.equal(result.messages[0].text, "Write the parser");
  assert.ok(result.messages[1].textTruncated === false);
  assert.ok(!/system noise/.test(result.messages.map(m => m.text).join(" ")),
    "developer/system content must not appear in the preview");
});

test("CON-004: oversized single record is capped textually and flagged, nothing else lost", () => {
  const big = "x".repeat(9000);
  const fixture = JSON.stringify({type:"assistant",message:{role:"assistant",content:big}}) + "\n";
  const result = parseAgentTail(fixture, "claude-code", {maxMessageChars: 4000});
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text.length, 4000);
  assert.equal(result.messages[0].textTruncated, true, "truncation must be reported, never silent");
});

test("CON-005: cut-off first and last lines are dropped, complete middle turns survive", () => {
  const middle = JSON.stringify({type:"user",message:{role:"user",content:"complete turn"}});
  const raw = '{"type":"assistant","message":{"role":"assistant","content":"c' // cut off at window start
    + "\n" + middle + "\n"
    + '{"type":"user","messag';                                            // file still appending
  const result = parseAgentTail(raw, "claude-code");
  assert.equal(result.droppedLines, 2);
  assert.equal(result.messages.length, 1);
  assert.equal(result.messages[0].text, "complete turn");
});

test("AGENT-004 CON-017: binary or unreadable files report unreadable instead of throwing", () => {
  const raw = Buffer.alloc(8 * 8);
  for (let i = 0; i < raw.length; i += 8) {
    raw[i] = 0x00; raw[i + 1] = 0x01; raw[i + 2] = 0x02; raw[i + 3] = 0xFF;
    raw[i + 4] = 0x00; raw[i + 5] = 0x41; raw[i + 6] = 0x42; raw[i + 7] = 0x00;
  }
  const binary = raw.toString("utf8");
  const result = parseAgentTail(binary, "claude-code");
  assert.equal(result.unreadable, true);
  assert.deepEqual(result.messages, []);
  const empty = parseAgentTail("", "codex");
  assert.equal(empty.messages.length, 0);
  assert.equal(empty.unreadable, false);
});

test("AGENT-004 CON-004: many turns keep only the most recent window and report elisions", () => {
  const lines = [];
  for (let i = 0; i < 50; i += 1) {
    lines.push(JSON.stringify({type:"user",message:{role:"user",content:"message number " + i}}));
    lines.push(JSON.stringify({type:"assistant",message:{role:"assistant",content:"reply number " + i}}));
  }
  const result = parseAgentTail(lines.join("\n") + "\n", "claude-code", {maxMessages: 4});
  assert.equal(result.messages.length, 4);
  assert.equal(result.messages.at(-1).text, "reply number 49");
  assert.equal(result.messages[0].text, "message number 48");
  assert.equal(result.elidedEarlier, 100 - 4, "50 exchanges = 100 messages; 4 kept means 96 elided");
});

test("AGENT-004 CON-004: bounded tail reads only a window at the end of a large file", async () => {
  const fileSize = 1_000_000;
  const window = 256; // tiny window keeps the assertion cheap
  const calls = [];
  const fakeFd = {
    read(buffer, offset, length, position) {
      calls.push({length, position});
      Object.assign(buffer, Buffer.from("tail"));
      return {bytesRead: buffer.length};
    },
    close() { return Promise.resolve(); },
  };
  const result = await readTranscriptTail("C:\\fake\\session.jsonl", {
    maxBytes: window,
    statFn: async () => ({size: fileSize}),
    openFn: async () => fakeFd,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].position, fileSize - window, "read must start at the tail window offset");
  assert.equal(calls[0].length, window);
  assert.equal(result.windowLimited, true, "windowing must be reported so the UI can mark truncation");
  assert.equal(result.size, fileSize);
});

test("AGENT-004: a small file is read whole and does not claim window truncation", async () => {
  const body = Buffer.from(CLAUDE_FIXTURE);
  const fakeFd = {
    read(buffer, offset, length, position) {
      const slice = body.subarray(position, Math.min(body.length, position + length));
      buffer.set(slice, 0);
      return {bytesRead: slice.length};
    },
    close() { return Promise.resolve(); },
  };
  const result = await readTranscriptTail("C:\\fake\\small.jsonl", {
    statFn: async () => ({size: body.length}),
    openFn: async () => fakeFd,
  });
  assert.equal(result.windowLimited, false);
  assert.equal(parseAgentTail(result.text, "claude-code").messages.length, 4);
});

test("AGENT-004: missing transcript files propagate a rejection the IPC can surface honestly", async () => {
  await assert.rejects(
    readTranscriptTail("C:\\missing\\no-file.jsonl", {
      statFn: async () => { throw Object.assign(new Error("ENOENT"), {code: "ENOENT"}); },
    }),
    /ENOENT/
  );
});

test("AGENT-004: malformed tail options are rejected before any filesystem use", async () => {
  await assert.rejects(readTranscriptTail("", {
    statFn: async () => { throw Error("must not be consulted"); },
  }), /transcript file path/);
  assert.throws(() => parseAgentTail("{}", "claude-code", {maxMessages: 0}), /maxMessages/);
});

test("AGENT-004 CON-004: a real on-disk transcript over 2 MiB is read only from its end window", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aiw-tail-large-"));
  const file = path.join(dir, "session.jsonl");
  try {
    // ~2.25 MiB fixture: megabyte-scale earlier turns, then the recent end.
    const body = [
      assistantLine("MARKER-AWAY-1" + "x".repeat(1_300_000)),
      assistantLine("x".repeat(850_000)),
      assistantLine("recent context inside the window is fine"),
      userLine("AW-006 real file final request"),
      assistantLine("AW-006 real file final reply café ✓"),
    ].join("\n") + "\n";
    await writeFile(file, body, "utf8");

    const tail = await readTranscriptTail(file); // real stat/open/read; no injection
    assert.ok(tail.size > TWO_MIB, "fixture must be larger than 2 MiB");
    assert.equal(tail.windowLimited, true, "a >2 MiB file must be reported as window-limited");
    assert.equal(Buffer.byteLength(tail.text, "utf8"), DEFAULT_MAX_BYTES,
      "only the bounded end window may be read from disk");

    const result = parseAgentTail(tail.text, "claude-code");
    assert.equal(result.unreadable, false);
    assert.ok(result.droppedLines >= 1, "the line cut at the window edge must be dropped and reported");
    assert.equal(result.messages.length, 3);
    assert.deepEqual(result.messages.map(m => m.role), ["assistant","user","assistant"]);
    assert.equal(result.messages.at(-1).text, "AW-006 real file final reply café ✓");
    const surfaced = result.messages.map(m => m.text).join("\n");
    assert.ok(!surfaced.includes("MARKER-AWAY"),
      "megabyte-scale earlier content must not be read from disk");
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});

test("AGENT-004 CON-004 CON-005: a >2 MiB real file with a mid-UTF-8 window cut keeps the true tail clean", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "aiw-tail-utf8-"));
  const file = path.join(dir, "session.jsonl");
  try {
    // Deterministic layout: A (early marker), B (a long CJK run that the 256 KiB
    // window cut is forced to land inside, mid-codepoint), C (the exact final
    // turn that must survive the real read byte-intact).
    const finalText = "AW-006 utf8 tail ✓ 日本語";
    const a = assistantLine("MARKER-UTF8-AWAY" + "x".repeat(1_850_000));
    const cjkCount = 102_400;
    const b = assistantLine("P" + "日".repeat(cjkCount));
    const c = userLine(finalText);
    const byteLen = s => Buffer.byteLength(s, "utf8");
    const lenA = byteLen(a);
    const lenB = byteLen(b);
    const lenC = byteLen(c);
    const size = lenA + lenB + lenC + 3; // three newlines
    const cut = size - DEFAULT_MAX_BYTES - (lenA + 1); // byte offset inside record B
    // Derive the record framing from the builder itself (no hand-typed literal):
    // with empty content, lenB'' = prefix + suffix, so the CJK run — placed after
    // a single ASCII "P" — begins at (framing - 1) from the record start.
    const framing = byteLen(assistantLine("")); // = prefix + suffix (empty content), here 64
    const suffixLen = 3; // "}}"
    const prefixLen = framing - suffixLen; // bytes up to the content opening quote, here 61
    const cjkRunStart = prefixLen + 1; // after the leading "P": first 3-byte codepoint, here 62
    assert.ok(size > TWO_MIB, "fixture must be larger than 2 MiB");
    assert.ok(cut > cjkRunStart && cut < lenB - 3, "window cut must land inside record B's CJK run (test precondition)");
    assert.notEqual((cut - cjkRunStart) % 3, 0, "window cut must land mid-codepoint to exercise UTF-8 decoding");

    await writeFile(file, [a, b, c].join("\n") + "\n", "utf8");
    const tail = await readTranscriptTail(file);
    assert.equal(tail.windowLimited, true);
    assert.ok(tail.text.includes("\uFFFD"),
      "an incomplete codepoint at the cut must be honestly decoded, never silently spliced");

    const result = parseAgentTail(tail.text, "claude-code");
    assert.equal(result.unreadable, false);
    assert.ok(result.droppedLines >= 1, "the cut record must be dropped, not half-parsed");
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].role, "user");
    assert.equal(result.messages[0].text, finalText,
      "the final turn must survive the real on-disk read byte-exact");
    const surfaced = result.messages.map(m => m.text).join("|");
    assert.ok(!surfaced.includes("\uFFFD"), "replacement characters must not leak into displayed turns");
    assert.ok(!surfaced.includes("MARKER-UTF8-AWAY"), "content outside the end window must not be read");
  } finally {
    await rm(dir, {recursive: true, force: true});
  }
});
