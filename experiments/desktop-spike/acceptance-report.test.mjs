import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  ACCEPTANCE_SCHEMA,
  ACCEPTANCE_ITEMS,
  RESULT_STATES,
  buildAcceptanceReport,
} = require("./acceptance-report.cjs");

const NOW = "2026-11-03T08:00:00.000Z";

function payload(overrides = {}) {
  return Object.assign({
    schema: ACCEPTANCE_SCHEMA,
    results: [
      { id: "app-launches", result: "pass" },
      { id: "chatgpt-signin", result: "blocked" },
    ],
    generatedAt: NOW,
  }, overrides);
}

test("CON-017 TRUST-006: report exposes exactly the four honest result states", () => {
  assert.deepEqual([...RESULT_STATES], ["pass", "fail", "blocked", "not-tested"]);
  const built = buildAcceptanceReport(payload());
  assert.match(built.markdown, /\*\*Pass\*\*/);
  assert.match(built.markdown, /\*\*Blocked\*\*/);
  assert.match(built.markdown, /\*\*Fail\*\*/);
  assert.match(built.markdown, /\*\*Not tested\*\*/);
});

test("CON-017: unknown or malformed check ids are refused, not guessed", () => {
  assert.throws(() => buildAcceptanceReport(payload({ results: [{ id: "root-canary", result: "pass" }] })),
    /Unknown acceptance check id/);
  assert.throws(() => buildAcceptanceReport(payload({ results: [{ id: "app-launches" }] })),
    /Result must be pass, fail, blocked or not-tested/);
  assert.throws(() => buildAcceptanceReport(payload({ results: [{ id: "app-launches", result: "PASS" }] })),
    /Result must be pass/);
  assert.throws(() => buildAcceptanceReport(payload({ results: ["app-launches"] })),
    /Each result must be an object/);
});

test("CON-017: duplicate check ids and empty result lists are refused", () => {
  assert.throws(() => buildAcceptanceReport(payload({ results: [
    { id: "app-launches", result: "pass" },
    { id: "app-launches", result: "blocked" },
  ] })), /Duplicate acceptance check id/);
  assert.throws(() => buildAcceptanceReport(payload({ results: [] })),
    /At least one check result/);
  assert.throws(() => buildAcceptanceReport(payload({ results: "pass" })),
    /Results must be an array/);
});

test("TRUST-005: links in free-text notes are removed by value pattern, never rendered", () => {
  const secretUrl = "https://accounts.example.test/oauth2/callback?code=TESTCODE123&state=abc";
  const built = buildAcceptanceReport(payload({
    results: [{ id: "chatgpt-signin", result: "blocked", note: "Callback was " + secretUrl + " as expected." }],
  }));
  assert.ok(!built.markdown.includes("accounts.example.test"), "link host must not survive");
  assert.ok(!built.markdown.includes("TESTCODE123"), "callback parameter must not survive");
  assert.match(built.markdown, /\[link removed\]/);
  const json = JSON.parse(built.json);
  assert.ok(!json.results[0].note.includes("example.test"));
});

test("TRUST-005: e-mail addresses are removed from notes", () => {
  const built = buildAcceptanceReport(payload({
    results: [{ id: "claude-signin", result: "fail", note: "Signed in as owner@example.test was rejected." }],
  }));
  assert.ok(!built.markdown.includes("owner@example.test"));
  assert.match(built.markdown, /\[address removed\]/);
});

test("TRUST-005: long opaque values are removed from notes", () => {
  const opaque = "AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH-IIII-JJJJ";
  const built = buildAcceptanceReport(payload({
    results: [{ id: "gemini-signin", result: "fail", note: "Page showed session " + opaque + " unexpectedly." }],
  }));
  assert.ok(!built.markdown.includes(opaque));
  assert.match(built.markdown, /\[opaque value removed\]/);
});

test("TRUST-005: notes are length-capped so reports stay bounded", () => {
  const sentence = "The layout button worked but the pane did not refresh ";
  const built = buildAcceptanceReport(payload({
    results: [{ id: "layouts", result: "fail", note: sentence.repeat(30) }],
  }));
  const row = JSON.parse(built.json).results.find((r) => r.id === "layouts");
  assert.ok(row.note.length <= 402, "note must be capped near the documented limit");
  assert.ok(row.note.endsWith("…"), "a capped note must carry an elision indicator");
});

test("TRUST-005: diagnostics accept only whitelisted states, numeric codes and counts", () => {
  assert.throws(() => buildAcceptanceReport(payload({
    diagnostics: { providerStatus: { "chatgpt:left": { state: "OK", errorCode: "not-a-number" } } },
  })), /Invalid provider status entry/, "non-whitelisted states must be refused");

  const good = buildAcceptanceReport(payload({
    diagnostics: {
      providerStatus: { "chatgpt:left": { state: "popup-blocked", errorCode: -23 } },
      sessionCounts: { "claude-code": 12, codex: 3 },
      cliAvailability: { "claude-code": true, codex: false },
    },
  }));
  assert.match(good.markdown, /popup-blocked/);
  assert.match(good.markdown, /-23/);
  assert.match(good.markdown, /claude-code = 12/);
  assert.match(good.markdown, /claude-code = found/);
  assert.match(good.markdown, /codex = not found/);
});

test("TRUST-005: diagnostics reject strings that smuggle in paths or identifiers", () => {
  assert.throws(() => buildAcceptanceReport(payload({
    diagnostics: { providerStatus: { "chatgpt:left": { state: "C:\\Users\\owner\\AppData" } } },
  })), /Invalid provider status entry/, "state words must not carry path data");
  assert.throws(() => buildAcceptanceReport(payload({
    diagnostics: { providerStatus: { "chatgpt:left": { state: "https://x.test/cb" } } },
  })), /Invalid provider status entry/, "states must not smuggle URLs");
  assert.throws(() => buildAcceptanceReport(payload({
    diagnostics: { sessionCounts: { "claude-code": "12" } },
  })), /Invalid session count/, "counts must be numeric");
  assert.throws(() => buildAcceptanceReport(payload({
    diagnostics: { cliAvailability: { codex: "C:\\bin\\codex.exe" } },
  })), /Invalid CLI availability/, "CLI locations must stay out of reports");
});

test("TRUST-005: unknown diagnostic sections are dropped, never rendered", () => {
  const built = buildAcceptanceReport(payload({
    diagnostics: { transcript: ["C:\\Users\\owner\\secret-session.jsonl"] },
  }));
  assert.ok(!built.markdown.includes("secret-session"));
  assert.equal(
    JSON.parse(built.json).diagnostics.transcript, undefined,
    "unknown diagnostic sections must not be retained");
});

test("TRUST-005: environment only keeps whitelisted identity fields", () => {
  const built = buildAcceptanceReport(payload({
    environment: {
      commit: "ae3ccdc29e8163303053a05b0bdb021cef4dd36f",
      appVersion: "0.1.0",
      electron: "44.9.3",
      platform: "win32",
      userAgent: "must-not-appear",
      osRelease: "10.0.mock-1234",
    },
  }));
  assert.match(built.markdown, /ae3ccdc29e8163303053a05b0bdb021cef4dd36f/);
  assert.ok(!built.markdown.includes("must-not-appear"));
  const env = JSON.parse(built.json).environment;
  assert.equal(env.userAgent, undefined, "non-whitelisted fields must not be retained");
});

test("TRUST-005: a non-hex or path-shaped commit in the environment is refused", () => {
  assert.throws(() => buildAcceptanceReport(payload({
    environment: { commit: "C:\\Users\\owner\\build" },
  })), /hexadecimal SHA/);
  assert.throws(() => buildAcceptanceReport(payload({
    environment: { commit: "not a sha at all" },
  })), /hexadecimal SHA/);
});

test("TRUST-005: missing generated-at or schema fails closed", () => {
  assert.throws(() => buildAcceptanceReport(payload({ generatedAt: undefined })),
    /timestamp/i);
  assert.throws(() => buildAcceptanceReport(payload({ schema: "ai-workspace.acceptance/9" })),
    /Unsupported acceptance report schema/);
  assert.throws(() => buildAcceptanceReport(null), /payload required/i);
});

test("TRUST-006: summary is a single bounded line with honest counts", () => {
  const built = buildAcceptanceReport(payload({
    results: [
      { id: "app-launches", result: "pass" },
      { id: "chatgpt-loads", result: "pass" },
      { id: "chatgpt-signin", result: "blocked", note: "popup denied by design" },
      { id: "claude-threads", result: "fail", note: "thread list did not refresh" },
    ],
    environment: { commit: "11111112222222333333334444444455555555aa" },
  }));
  assert.match(built.summary, /^AI Workspace acceptance · build 11111112222222333333334444444455555555aa/);
  assert.match(built.summary, /2 pass, 1 fail, 1 blocked, 15 not tested/);
  assert.match(built.summary,
    /needs attention: ChatGPT sign-in inside the pane \(or honestly blocked\); Claude threads, harmless message, model picker/);
  assert.ok(built.summary.length < 600, "summary must stay short enough to paste anywhere");
});

test("CON-017: results are presented in canonical checklist order regardless of input order", () => {
  const built = buildAcceptanceReport(payload({
    results: [
      { id: "no-survivors", result: "pass" },
      { id: "app-launches", result: "pass" },
      { id: "restart", result: "blocked" },
    ],
  }));
  const ids = JSON.parse(built.json).results.map((row) => row.id);
  assert.deepEqual(ids, ["app-launches", "restart", "no-survivors"]);
});

test("TRUST-006: the checklist covers the owner mission areas end to end", () => {
  const ids = new Set(ACCEPTANCE_ITEMS.map((item) => item.id));
  for (const needed of [
    "app-launches",
    "chatgpt-signin", "claude-signin", "gemini-signin",
    "attachments", "two-panes", "layouts",
    "browser-coexistence", "restart",
    "local-discovery", "local-tail", "local-resume", "no-survivors",
  ]) assert.ok(ids.has(needed), "missing required check: " + needed);
  assert.ok(ACCEPTANCE_ITEMS.length >= 15);
  for (const item of ACCEPTANCE_ITEMS) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.label.length >= 4 && item.check.length >= 20,
      "each check needs a plain-language step: " + item.id);
  }
});

test("TRUST-005: pipes in notes are escaped so the Markdown table stays intact", () => {
  const built = buildAcceptanceReport(payload({
    results: [{ id: "layouts", result: "fail", note: "left|right split broken" }],
  }));
  const rows = built.markdown.split("\n").filter((line) => line.includes("left\\|right split broken"));
  assert.equal(rows.length, 1, "piped note must survive in exactly one escaped row");
  const cells = rows[0].split(" | ");
  assert.ok(cells.length >= 3, "the row must keep its three logical cells");
});
