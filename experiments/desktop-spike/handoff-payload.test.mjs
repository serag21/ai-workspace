import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {
  SCHEMA_VERSION,
  buildHandoffPayload,
  scanLikelySecrets,
  validateHandoffPayload,
} = require("./handoff-payload.cjs");

function baseInput(overrides = {}) {
  return {
    source: {
      provider: "chatgpt",
      conversationId: "thread-123",
      title: "Login bug planning",
      evidence: { provider: "observed", conversationId: "observed", title: "observed" },
    },
    project: {
      name: "ai-workspace",
      repoPath: "C:\\Users\\serag\\source\\repos\\serag21\\ai-workspace",
      branch: "spike/local-agents-desktop",
      commit: null,
      evidence: { name: "observed", repoPath: "observed", branch: "observed", commit: "inferred" },
    },
    sections: [
      { kind: "summary", text: "Fix login bug in src/auth.cjs; keep the existing OAuth flow.", evidence: "observed" },
      { kind: "decisions", text: "Use external terminal resume, not in-app live control.", evidence: "inferred" },
      { kind: "testResults", text: "65/65 local tests pass (synthetic; not provider E2E).", evidence: "observed" },
    ],
    artifacts: [
      { path: "docs/login-plan.md", sizeBytes: 1234, included: true },
      { path: "C:\\secrets\\vault.md", sizeBytes: 90, included: false },
    ],
    destination: { provider: "claude", mode: "external-terminal" },
    ...overrides,
  };
}

test("HAND-001 HAND-005: payload round-trips with explicit source binding and per-field evidence flags", () => {
  const payload = buildHandoffPayload(baseInput());
  assert.equal(payload.schemaVersion, SCHEMA_VERSION);
  assert.equal(payload.source.provider, "chatgpt");
  assert.equal(payload.source.conversationId, "thread-123");
  assert.deepEqual(payload.project.evidence, {
    name: "observed", repoPath: "observed", branch: "observed", commit: "inferred",
  });
  assert.equal(payload.project.bindingComplete, true);
  const verdict = validateHandoffPayload(payload);
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.problems, []);
  assert.deepEqual(verdict.warnings, []);
});

test("HAND-001: unknown or missing source providers are refused before any payload exists", () => {
  assert.throws(() => buildHandoffPayload(baseInput({
    source: {
      provider: "unknown-provider",
      conversationId: "x",
      title: null,
      evidence: { provider: "observed", conversationId: "observed", title: "missing" },
    },
  })), /source\.provider/);
  assert.throws(() => buildHandoffPayload(baseInput({ source: null })), /source provenance/);
});

test("HAND-005 CON-017: evidence flags must be consistent with the values they claim", () => {
  // observed => value present
  assert.throws(() => buildHandoffPayload(baseInput({
    project: {
      name: null, repoPath: "C:\\r", branch: null, commit: null,
      evidence: { name: "observed", repoPath: "observed", branch: "missing", commit: "missing" },
    },
  })), /flagged 'observed' but the value is absent/);
  // missing => no value may be fabricated
  assert.throws(() => buildHandoffPayload(baseInput({
    project: {
      name: "x", repoPath: "C:\\r", branch: "b", commit: null,
      evidence: { name: "missing", repoPath: "observed", branch: "inferred", commit: "missing" },
    },
  })), /flagged 'missing' but a value was supplied/);
});

test("HAND-002: omissions and missing facts are named, never silently dropped", () => {
  const payload = buildHandoffPayload(baseInput({
    source: {
      provider: "gemini",
      conversationId: null,
      title: "Untitled",
      evidence: { provider: "observed", conversationId: "missing", title: "observed" },
    },
    project: {
      name: "ai-workspace", repoPath: null, branch: null, commit: null,
      evidence: { name: "observed", repoPath: "missing", branch: "missing", commit: "missing" },
    },
  }));
  assert.deepEqual(payload.missing.sort(), [
    "project.branch", "project.commit", "project.repoPath", "source.conversationId",
  ]);
  assert.equal(payload.project.bindingComplete, false, "a name without a repo path is not a binding");
  assert.ok(validateHandoffPayload(payload).ok);
});

test("HAND-003: destination is restricted to manual modes and autoSend can never be built", () => {
  const payload = buildHandoffPayload(baseInput());
  assert.equal(payload.destination.autoSend, false);
  assert.equal(payload.destination.mode, "external-terminal");
  assert.throws(() => buildHandoffPayload(baseInput({
    destination: { provider: "claude", mode: "auto-send" },
  })), /automatic send is never constructed/);
  assert.throws(() => buildHandoffPayload(baseInput({
    destination: { provider: "claude", mode: "api-upload" },
  })), /manual-paste\|external-terminal/);
  const tampered = buildHandoffPayload(baseInput());
  tampered.destination.autoSend = true;
  const verdict = validateHandoffPayload(tampered);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join(" "), /autoSend/);
});

test("HAND-002 HAND-003: size caps keep the summary, name omitted sections and flag overflow", () => {
  const big = "y".repeat(60_000);
  const cap = 60_200;
  const payload = buildHandoffPayload(baseInput({
    sections: [
      { kind: "summary", text: "Complete summary that must survive the cap.", evidence: "observed" },
      { kind: "decisions", text: big, evidence: "inferred" },
      { kind: "testResults", text: "More detail that may be omitted honestly.", evidence: "observed" },
    ],
  }), { maxTextBytes: cap });
  const kinds = payload.sections.map(s => s.kind);
  assert.deepEqual(kinds, ["summary", "decisions"], "summary is the minimum contract; the next section fits; the last is cut");
  assert.equal(payload.manifest.overflow, true);
  assert.ok(payload.omissions.some(o => o.startsWith("section:testResults")), "the dropped section must be named honestly");
  assert.equal(validateHandoffPayload(payload).ok, true);
});

test("HAND-006: the artifact manifest separates included from not-included files", () => {
  const payload = buildHandoffPayload(baseInput());
  assert.equal(payload.manifest.includedArtifactCount, 1);
  assert.deepEqual(payload.artifacts.map(a => a.included), [true, false]);
  assert.equal(payload.artifacts[1].included, false, "vault.md must NOT travel with the handoff");
  const verdict = validateHandoffPayload(payload);
  assert.equal(verdict.ok, true);
});

test("HAND-006: invalid artifact identity fields are refused before the payload exists", () => {
  assert.throws(() => buildHandoffPayload(baseInput({
    artifacts: [{ path: "a.md", sizeBytes: 10, included: true, sha256: "not-a-hash" }],
  })), /sha256/);
  assert.throws(() => buildHandoffPayload(baseInput({ artifacts: [{ path: null, included: true }] })), /path/);
});

test("HAND-007: high-precision secret patterns are flagged with location, without leaking the text", () => {
  const samples = {
    "aws-access-key-id": "key=AKIAIOSFODNN7EXAMPLE",
    "pem-private-key": "-----BEGIN PRIVATE KEY-----base64-----END PRIVATE KEY-----",
    "jwt-bearer": "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHc0lZ5d3mVZP0Jfjwn5W-7q1_FY",
    "openai-api-key": "sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "github-token": "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345",
    "slack-token": "xoxb--AbCd-Ef12-Hi34-Jk56-Lm78",
  };
  for (const [id, text] of Object.entries(samples)) {
    const findings = scanLikelySecrets(text);
    assert.ok(findings.length >= 1, "pattern " + id + " must be detected");
    assert.ok(findings.some(f => f.id === id), "detected as " + id);
    assert.ok(findings.every(f => Number.isSafeInteger(f.index)), "only location is reported");
  }
});

test("HAND-007: ordinary prose and code must NOT produce secret findings (precision over recall)", () => {
  const benign = [
    "Use OAuth for login; the provider handles sessions and credentials.",
    "const apiKey = process.env.LLM_API_KEY; // read from env, never hardcode",
    "sklearn.ensemble.RandomForest worked; the sklearn docs were useful.",
    "git push origin feature/login-fix && CI ran 76/76 green.",
    "'Bearer' is a header name here, but no token follows in this sentence.",
  ];
  for (const text of benign) {
    assert.deepEqual(scanLikelySecrets(text), [], "false positive on: " + text);
  }
});

test("HAND-007: a payload containing a flagged token is marked, and validation warns without hiding it", () => {
  const payload = buildHandoffPayload(baseInput({
    sections: [
      { kind: "summary", text: "Note: the API key AKIAIOSFODNN7EXAMPLE was in the thread.", evidence: "observed" },
    ],
  }));
  assert.equal(payload.secretScan.flagged, true);
  assert.ok(payload.secretScan.findings.length >= 1);
  assert.equal(payload.secretScan.findings[0].section, "summary");
  assert.ok(payload.secretScan.findings.every(f => f.text === undefined),
    "findings must never embed the secret text itself");
  const verdict = validateHandoffPayload(payload);
  assert.equal(verdict.ok, true, "schema itself is intact; the flag is a review warning");
  assert.match(verdict.warnings.join(" "), /secrets?/);
});

test("HAND-005 HAND-001: schema version is explicit and foreign versions fail validation, not crash", () => {
  const payload = buildHandoffPayload(baseInput());
  assert.equal(payload.schemaVersion, "ai-workspace.handoff/1");
  const future = JSON.parse(JSON.stringify(payload));
  future.schemaVersion = "ai-workspace.handoff/2";
  const verdict = validateHandoffPayload(future);
  assert.equal(verdict.ok, false);
  assert.match(verdict.problems.join(" "), /schemaVersion/);
});

test("HAND-002: section kinds are registered and evidence on each section is validated", () => {
  assert.throws(() => buildHandoffPayload(baseInput({
    sections: [{ kind: "rawDump", text: "nope", evidence: "observed" }],
  })), /registered handoff section kind/);
  assert.throws(() => buildHandoffPayload(baseInput({
    sections: [{ kind: "summary", text: "x", evidence: "guessed" }],
  })), /observed\|inferred\|missing/);
  const payload = buildHandoffPayload(baseInput());
  assert.deepEqual(payload.sections.map(s => s.kind), ["summary", "decisions", "testResults"]);
  assert.ok(payload.sections.every(s => ["observed", "inferred", "missing"].includes(s.evidence)));
});

test("HAND-006: artifact metadata is normalized honestly — non-boolean included is excluded, malformed sizes null", () => {
  const payload = buildHandoffPayload(baseInput({
    artifacts: [
      { path: "a.md", included: "yes" },
      { path: "b.md", included: 1 },
      { path: "c.md", included: true, sizeBytes: -5 },
      { path: "d.md", included: true, sizeBytes: 12.5 },
    ],
  }));
  assert.deepEqual(payload.artifacts.map(a => a.included), [false, false, true, true],
    "only an explicit true may include an artifact; truthy strings/numbers do not");
  assert.deepEqual(payload.artifacts.map(a => a.sizeBytes), [null, null, null, null],
    "negative or non-integer sizes are reported as unknown, never coerced");
  assert.equal(payload.manifest.includedArtifactCount, 2);
  assert.equal(validateHandoffPayload(payload).ok, true);
});

test("HAND-007: a token-shaped included artifact path is flagged, while excluded paths are never scanned", () => {
  const included = "exports/ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345-notes.md";
  const excluded = "exports/ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ098765-notes.md";
  const payload = buildHandoffPayload(baseInput({
    artifacts: [
      { path: included, included: true },
      { path: excluded, included: false },
    ],
  }));
  assert.equal(payload.secretScan.flagged, true);
  assert.equal(payload.secretScan.findings.length, 1,
    "only the included path is part of the outgoing manifest; the excluded one is never scanned");
  assert.equal(payload.secretScan.findings[0].id, "github-token");
  assert.equal(payload.secretScan.findings[0].section, "artifact-path");
  assert.ok(Object.keys(payload.secretScan.findings[0]).every(k => k === "id" || k === "index" || k === "section"),
    "artifact-path findings leak no text either");
});

test("HAND-005: source evidence must declare a flag for every field — a partial evidence map is refused", () => {
  assert.throws(() => buildHandoffPayload(baseInput({
    source: {
      provider: "chatgpt",
      conversationId: "t-1",
      title: "tt",
      evidence: { provider: "observed" }, // conversationId/title undeclared
    },
  })), /source\.evidence\.conversationId/);
});

test("HAND-005: a text section can never claim 'missing' evidence, and validation detects a tampered one", () => {
  assert.throws(() => buildHandoffPayload(baseInput({
    sections: [{ kind: "summary", text: "I do not actually know this", evidence: "missing" }],
  })), /missing' but section text is present/);

  const tampered = buildHandoffPayload(baseInput());
  tampered.sections[0] = { ...tampered.sections[0], evidence: "missing" };
  const verdict = validateHandoffPayload(tampered);
  assert.equal(verdict.ok, false, "carrying content behind a 'missing' flag is an integrity problem");
  assert.match(verdict.problems.join(" "), /missing.*text|carrying text/);
});

test("HAND-005: blank section text is refused — a section is a claim, not an empty placeholder", () => {
  assert.throws(() => buildHandoffPayload(baseInput({
    sections: [{ kind: "summary", text: "   ", evidence: "observed" }],
  })), /must not be blank/);
});

test("HAND-002 HAND-003: an oversized summary ships alone with an honest overflow flag and no phantom omission", () => {
  const payload = buildHandoffPayload(baseInput({
    sections: [{ kind: "summary", text: "z".repeat(500), evidence: "observed" }],
  }), { maxTextBytes: 400 });
  const kinds = payload.sections.map(s => s.kind);
  assert.deepEqual(kinds, ["summary"], "the summary is the minimum contract and must survive");
  assert.equal(payload.manifest.overflow, true, "exceeding the cap is flagged, not hidden");
  assert.deepEqual(payload.omissions, [], "with only the summary present nothing was omitted, so none is named");
  assert.equal(validateHandoffPayload(payload).ok, true);
});

test("HAND-007: multiple secret findings are sorted by position and findings carry no token text", () => {
  const text = "token-a ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345 then xoxb--AbCd-Ef12-Hi34-Jk56-Lm78 here";
  const findings = scanLikelySecrets(text);
  assert.equal(findings.length, 2);
  assert.deepEqual(findings.map(f => f.id), ["github-token", "slack-token"]);
  assert.ok(findings[0].index < findings[1].index, "findings must be positioned in document order");
  for (const f of findings) {
    assert.deepEqual(Object.keys(f).sort(), ["id", "index"], "only id and index — never the matched text");
  }
});
