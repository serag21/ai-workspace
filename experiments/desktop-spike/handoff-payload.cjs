/**
 * Provenance-aware HANDOFF PAYLOAD builder for AI Workspace (schema v1).
 *
 * This module only CONSTRUCTS and VALIDATES a structured, bounded snapshot
 * of conversation context + local repo evidence. It never sends anything,
 * uploads files, calls providers, or writes to disk (HAND-003: no automatic
 * send without consent — the destination mode is restricted to explicitly
 * manual handoffs).
 *
 * Evidence integrity (HAND-005): every factual claim carries an evidence
 * flag: "observed" (read from a local verifiable source), "inferred"
 * (derived, not directly verified) or "missing" (unknown, never guessed).
 * A section that carries text can only claim observed|inferred; "missing"
 * is expressed by naming the fact in the `missing` list, never by a text
 * section (the same consistency rule the per-field flags enforce).
 *
 * Omissions are explicit (HAND-002): when a field is absent or a size cap
 * is reached, the payload names the omission instead of silently dropping
 * content.
 *
 * Secret scanning (HAND-007) is high-precision by design: only strong,
 * distinctive token shapes are reported, with matched location indices but
 * NO secret preview text, to keep false positives low and to make the
 * outgoing manifest honest without leaking secrets into reports.
 */

const SCHEMA_VERSION = "ai-workspace.handoff/1";

const SOURCE_PROVIDERS = new Set(["chatgpt", "claude", "gemini"]);
const MANUAL_DESTINATION_MODES = new Set(["manual-paste", "external-terminal"]);
const SECTION_KINDS = new Set([
  "summary", "decisions", "constraints", "openQuestions", "testResults", "requirements",
]);
const EVIDENCE_FLAGS = new Set(["observed", "inferred", "missing"]);
const PROJECT_FIELDS = ["name", "repoPath", "branch", "commit"];

const DEFAULT_MAX_TEXT_BYTES = 128 * 1024;
const DEFAULT_MAX_ARTIFACTS = 50;

/**
 * High-precision secret patterns only. Each is anchored to a distinctive
 * token shape so ordinary code or prose is not reported.
 */
const SECRET_PATTERNS = [
  { id: "aws-access-key-id", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "pem-private-key", regex: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g },
  { id: "jwt-bearer", regex: /\bBearer\s+eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9._-]{8,}/g },
  { id: "openai-api-key", regex: /\bsk-(?:proj-)?[A-Za-z0-9]{20,}\b/g },
  { id: "github-token", regex: /\bgh[pousgh]_[A-Za-z0-9]{20,}\b/g },
  { id: "slack-token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
];

function assertObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(label + " must be an object.");
  }
  return value;
}

function assertString(value, label, { required = false, allowEmpty = false } = {}) {
  if (value === null || value === undefined) {
    if (required) throw new TypeError(label + " is required.");
    return null;
  }
  if (typeof value !== "string") throw new TypeError(label + " must be a string or null.");
  if (!allowEmpty && value.trim() === "") throw new TypeError(label + " must not be blank.");
  return value;
}

function assertEvidenceFlag(value, label) {
  if (!EVIDENCE_FLAGS.has(value)) {
    throw new TypeError(label + " must be one of observed|inferred|missing (never guessed).");
  }
  return value;
}

/**
 * Validate and normalize a per-field evidence map. The caller must declare an
 * evidence flag for EVERY field (no silent fabrication). Consistency rules
 * keep the claims honest (CON-017: no false states):
 *   "observed"  => the value must be present (we claim to have seen it).
 *   "missing"   => the value must be null (we do not guess a value).
 *   "inferred"  => the value may be present or null (a derivation).
 */
function resolveEvidence(evidence, values, fields, label) {
  assertObject(evidence, label);
  const out = {};
  for (const field of fields) {
    const flag = assertEvidenceFlag(evidence[field], label + "." + field);
    const present = values[field] !== null && values[field] !== undefined;
    if (flag === "observed" && !present) {
      throw new TypeError(label + "." + field + " is flagged 'observed' but the value is absent.");
    }
    if (flag === "missing" && present) {
      throw new TypeError(label + "." + field + " is flagged 'missing' but a value was supplied; " +
        "declare it observed|inferred or omit the value.");
    }
    out[field] = flag;
  }
  return out;
}

/**
 * @returns {{id:string, index:number}[]} Match locations; secret text is
 *   deliberately not included in the result.
 */
function scanLikelySecrets(text) {
  const findings = [];
  if (typeof text !== "string" || !text) return findings;
  for (const pattern of SECRET_PATTERNS) {
    for (const match of text.matchAll(pattern.regex)) {
      findings.push({ id: pattern.id, index: match.index });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

/**
 * Build a bounded, evidence-flagged handoff payload.
 * Never sends, never uploads. Throws on contract violations (fail closed).
 */
function buildHandoffPayload(input, limits = {}) {
  assertObject(input, "handoff input");

  const maxTextBytes = Number.isSafeInteger(limits.maxTextBytes) && limits.maxTextBytes > 0
    ? limits.maxTextBytes : DEFAULT_MAX_TEXT_BYTES;
  const maxArtifacts = Number.isSafeInteger(limits.maxArtifacts) && limits.maxArtifacts > 0
    ? limits.maxArtifacts : DEFAULT_MAX_ARTIFACTS;

  // -- Source provenance (HAND-001: explicit source, unrelated content off) --
  const source = assertObject(input.source, "source provenance");
  const provider = assertString(source.provider, "source.provider", { required: true });
  if (!SOURCE_PROVIDERS.has(provider)) {
    throw new TypeError("source.provider must be chatgpt|claude|gemini; refuse unknown origin.");
  }
  const conversationId = assertString(source.conversationId, "source.conversationId");
  const title = assertString(source.title, "source.title", { allowEmpty: true });
  // provider is a required validated constant -> legitimately "observed".
  const sourceValues = { provider, conversationId, title };
  const sourceEvidence = resolveEvidence(
    source.evidence ?? { provider: "observed" },
    sourceValues,
    ["provider", "conversationId", "title"], "source.evidence");

  // -- Project binding (HAND-001/HAND-004: name AND repo identity) --
  const project = assertObject(input.project, "project");
  const values = {};
  for (const field of PROJECT_FIELDS) {
    values[field] = assertString(project[field], "project." + field, { allowEmpty: true });
  }
  const projectEvidence = resolveEvidence(
    project.evidence, values, PROJECT_FIELDS, "project.evidence");

  // -- Sections with explicit evidence flags (HAND-005) --
  if (!Array.isArray(input.sections)) throw new TypeError("sections must be an array.");
  const sections = input.sections.map((section, i) => {
    assertObject(section, "sections[" + i + "]");
    const kind = assertString(section.kind, "sections[" + i + "].kind", { required: true });
    if (!SECTION_KINDS.has(kind)) {
      throw new TypeError("sections[" + i + "].kind " + kind + " is not a registered handoff section kind.");
    }
    const text = assertString(section.text, "sections[" + i + "].text");
    const evidence = section.evidence ?? "inferred";
    if (!EVIDENCE_FLAGS.has(evidence)) {
      throw new TypeError("sections[" + i + "].evidence must be observed|inferred|missing.");
    }
    if (evidence === "missing") {
      throw new TypeError("sections[" + i + "].evidence is 'missing' but section text is present; " +
        "content sections may only claim observed|inferred (unknowns belong in the missing list).");
    }
    return { kind, text, evidence };
  });

  // -- Artifact manifest (HAND-006: only transfer what is listed and approved) --
  if (!Array.isArray(input.artifacts)) throw new TypeError("artifacts must be an array.");
  const artifacts = input.artifacts.map((artifact, i) => {
    assertObject(artifact, "artifacts[" + i + "]");
    const path = assertString(artifact.path, "artifacts[" + i + "].path", { required: true });
    const included = artifact.included === true;
    const sizeBytes = Number.isSafeInteger(artifact.sizeBytes) && artifact.sizeBytes >= 0
      ? artifact.sizeBytes : null;
    if (artifact.sha256 !== undefined &&
        (typeof artifact.sha256 !== "string" || !/^[a-f0-9]{64}$/i.test(artifact.sha256))) {
      throw new TypeError("artifacts[" + i + "].sha256 must be a 64-char hex string when present.");
    }
    return { path, included, sizeBytes, sha256: artifact.sha256 ?? null };
  });

  // -- Destination (HAND-003: manual modes only, autoSend is never built) --
  const destination = assertObject(input.destination, "destination");
  const destProvider = assertString(destination.provider, "destination.provider", { required: true });
  if (!SOURCE_PROVIDERS.has(destProvider)) {
    throw new TypeError("destination.provider must be chatgpt|claude|gemini.");
  }
  const mode = assertString(destination.mode, "destination.mode", { required: true });
  if (!MANUAL_DESTINATION_MODES.has(mode)) {
    throw new TypeError("destination.mode must be manual-paste|external-terminal; " +
      "automatic send is never constructed by this builder.");
  }

  // -- Bounded size caps with HONEST overflow flags (HAND-002/HAND-003) --
  // Priority is explicit and order-preserving:
  //   1. The "summary" section, if present, is ALWAYS kept — it is the minimum
  //      contract that the destination receives at least a complete marked
  //      summary. If it alone exceeds the cap we still keep it and flag overflow.
  //   2. All other sections are kept in input order while the budget allows.
  // Nothing is silently truncated; a dropped section is named in `omissions`.
  const omissions = [];
  const byteLength = s => Buffer.byteLength(s, "utf8");
  const costOf = s => byteLength(s.kind) + byteLength(s.text) + 64;
  let usedBytes = 0;
  const keptSections = [];

  const summary = sections.find(s => s.kind === "summary");
  const rest = sections.filter(s => s.kind !== "summary");

  if (summary) {
    usedBytes += costOf(summary);
    keptSections.push(summary);
  }
  for (const section of rest) {
    if (usedBytes + costOf(section) > maxTextBytes) {
      omissions.push("section:" + section.kind + " (size cap " + maxTextBytes + " bytes)");
      continue;
    }
    usedBytes += costOf(section);
    keptSections.push(section);
  }

  const allArtifacts = artifacts;
  const keptArtifactCount = allArtifacts.filter(a => a.included).length;
  if (keptArtifactCount > maxArtifacts) {
    omissions.push(keptArtifactCount - maxArtifacts + " artifact(s) (artifact cap " + maxArtifacts + ")");
  }

  const missing = [];
  if (conversationId === null) missing.push("source.conversationId");
  for (const field of PROJECT_FIELDS) {
    if (values[field] === null) missing.push("project." + field);
  }
  if (sections.length === 0) missing.push("sections (none provided)");

  // -- Secret scan over outgoing text (HAND-007) — flag, never redact silently --
  const secretFindings = [];
  for (const section of keptSections) {
    for (const finding of scanLikelySecrets(section.text)) {
      secretFindings.push({ section: section.kind, ...finding });
    }
  }
  const includedArtifactPaths = allArtifacts.filter(a => a.included).map(a => a.path);
  for (const artifact of includedArtifactPaths) {
    for (const finding of scanLikelySecrets(artifact)) {
      secretFindings.push({ section: "artifact-path", ...finding });
    }
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    source: {
      provider,
      conversationId,
      title,
      evidence: sourceEvidence,
    },
    project: {
      ...values,
      evidence: projectEvidence,
      bindingComplete: values.name !== null && values.repoPath !== null,
    },
    sections: keptSections,
    artifacts: allArtifacts,
    destination: { provider: destProvider, mode, autoSend: false },
    omissions,
    missing,
    manifest: {
      sectionCount: sections.length,
      keptSectionCount: keptSections.length,
      includedArtifactCount: keptArtifactCount,
      totalTextBytes: usedBytes,
      maxTextBytes,
      overflow: omissions.some(o => o.startsWith("section:")) ||
        usedBytes > maxTextBytes ||
        keptArtifactCount > maxArtifacts,
    },
    secretScan: {
      flagged: secretFindings.length > 0,
      findings: secretFindings,
      note: "High-precision token-shape matches only; review the matched text manually before any handoff.",
    },
  };
  return payload;
}

/**
 * Validate a handoff payload (round-trip check).
 * @returns {{ok:boolean, problems:string[], warnings:string[]}}
 */
function validateHandoffPayload(payload) {
  const problems = [];
  const warnings = [];
  const p = assertObject(payload, "payload");

  if (p.schemaVersion !== SCHEMA_VERSION) {
    problems.push("schemaVersion must be " + SCHEMA_VERSION + " (got " + String(p.schemaVersion) + ").");
  }
  if (p.source === undefined || p.source === null) problems.push("source provenance block is missing.");
  else {
    if (!SOURCE_PROVIDERS.has(p.source.provider)) problems.push("source.provider is not a supported provider.");
    if (p.source.evidence === undefined ||
        !["observed", "inferred", "missing"].includes(p.source.evidence.conversationId ?? "")) {
      problems.push("source.evidence must flag conversationId with observed|inferred|missing.");
    }
  }
  if (p.project === undefined || p.project === null) problems.push("project block is missing.");
  else {
    for (const field of PROJECT_FIELDS) {
      if (p.project.evidence === undefined || !EVIDENCE_FLAGS.has(p.project.evidence[field])) {
        problems.push("project.evidence." + field + " must be observed|inferred|missing.");
      }
    }
  }
  if (!Array.isArray(p.sections)) problems.push("sections must be an array.");
  else for (const section of p.sections) {
    if (!SECTION_KINDS.has(section.kind)) problems.push("unregistered section kind: " + section.kind);
    if (!EVIDENCE_FLAGS.has(section.evidence)) problems.push("section evidence flag invalid");
    if (section.evidence === "missing" &&
        typeof section.text === "string" && section.text.trim() !== "") {
      problems.push("section claims 'missing' evidence while carrying text; this is inconsistent");
    }
  }
  if (!Array.isArray(p.artifacts)) problems.push("artifacts must be an array.");
  if (p.destination === undefined || p.destination === null) problems.push("destination block is missing.");
  else {
    if (p.destination.autoSend === true) problems.push("destination.autoSend must never be true.");
    if (!MANUAL_DESTINATION_MODES.has(p.destination.mode)) {
      problems.push("destination.mode must be manual-paste|external-terminal.");
    }
  }
  if (p.manifest === undefined || typeof p.manifest.overflow !== "boolean") {
    problems.push("manifest.overflow must be a boolean flag.");
  }
  if (p.secretScan === undefined || !Array.isArray(p.secretScan.findings)) {
    problems.push("secretScan.findings must be an array.");
  } else if (p.secretScan.flagged) {
    warnings.push("Likely secrets flagged in outgoing text; redact or obtain explicit consent before handoff.");
  }
  if (p.omissions === undefined || p.missing === undefined) {
    problems.push("omissions and missing lists are required for honest provenance.");
  }

  return { ok: problems.length === 0, problems, warnings };
}

module.exports = {
  SCHEMA_VERSION,
  buildHandoffPayload,
  scanLikelySecrets,
  validateHandoffPayload,
};
