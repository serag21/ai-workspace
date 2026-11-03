// Owner acceptance report — AW-009 (schema ai-workspace.acceptance/1).
//
// PURE module: no Electron, no network, no filesystem. It validates a tiny,
// strongly-typed payload from the main process and renders a local-first
// report (Markdown + JSON + 30-second summary).
//
// Privacy contract (TRUST-005):
//  - Only whitelisted item ids and the four honest states pass.
//  - Free text is length-capped and redacted: URLs, e-mail addresses and
//    long opaque values are replaced before any rendering; the original
//    values never appear in the output.
//  - Diagnostics are restricted to state words, numeric network codes and
//    counts. Session ids, transcript paths, titles, project paths and CLI
//    locations must never be part of a report.
"use strict";

const ACCEPTANCE_SCHEMA = "ai-workspace.acceptance/1";
const RESULT_STATES = Object.freeze(["pass", "fail", "blocked", "not-tested"]);
const RESULT_LABELS = Object.freeze({
  pass: "Pass",
  fail: "Fail",
  blocked: "Blocked",
  "not-tested": "Not tested",
});

// The checklist is the single source of truth for both the in-app test
// panel and the report validator. "check" is the plain-language step the
// owner follows; it doubles as the first-run guide entry.
const ACCEPTANCE_ITEMS = Object.freeze([
  {
    id: "app-launches",
    label: "App launches from the downloaded zip",
    check: "Extract the zip, double-click the .exe. The window appears with a left sidebar, and the build chip near the title shows a commit matching the Actions run you downloaded.",
  },
  {
    id: "chatgpt-loads",
    label: "ChatGPT webpage renders in a pane",
    check: "Pick One chat and select ChatGPT. The genuine ChatGPT page appears (the signed-out view is fine). Read the status line under Left native website and record what it says.",
  },
  {
    id: "chatgpt-signin",
    label: "ChatGPT sign-in inside the pane (or honestly blocked)",
    check: "Only with a disposable account: sign in the normal way on the page. If the provider requires a popup/OAuth page and the pane says popup was blocked, record Blocked — recording it IS the test, don't look for a workaround.",
  },
  {
    id: "chatgpt-threads",
    label: "ChatGPT threads, harmless message, model picker",
    check: "If signed in: open one existing thread, switch to another and back, send one harmless prompt (a joke or a math question), confirm the reply. Check the model picker only if your account actually shows one.",
  },
  {
    id: "claude-loads",
    label: "Claude webpage renders in a pane",
    check: "Select Claude. The genuine claude.ai page appears. Record the sidebar status line.",
  },
  {
    id: "claude-signin",
    label: "Claude sign-in inside the pane (or honestly blocked)",
    check: "Only with a disposable account: sign in the normal way. If a popup/OAuth block is reported, record Blocked.",
  },
  {
    id: "claude-threads",
    label: "Claude threads, harmless message, model picker",
    check: "If signed in: open an existing thread, navigate threads, send one harmless prompt, confirm the reply and the model picker if visible.",
  },
  {
    id: "gemini-loads",
    label: "Gemini webpage renders in a pane",
    check: "Select Gemini. The genuine Gemini app page appears. Record the sidebar status line.",
  },
  {
    id: "gemini-signin",
    label: "Gemini sign-in inside the pane (or honestly blocked)",
    check: "Only with a disposable account: sign in the normal way. If a popup/OAuth block is reported, record Blocked.",
  },
  {
    id: "gemini-threads",
    label: "Gemini threads, harmless message, model picker",
    check: "If signed in: open an existing conversation, send one harmless prompt, confirm the reply and the model picker if visible.",
  },
  {
    id: "attachments",
    label: "Harmless attachment works in at least one provider",
    check: "In any signed-in conversation, attach the file SAFE-TEST-ATTACHMENT.txt (it sits next to the .exe). Confirm the attachment is accepted. Never attach private files.",
  },
  {
    id: "two-panes",
    label: "Two independent panes stay independent",
    check: "Pick Two chats. Put a different thread in each pane (same provider is allowed). Scroll/navigate each one; an action in one pane must never replace the other.",
  },
  {
    id: "layouts",
    label: "All four layouts switch cleanly",
    check: "Cycle One chat, Two chats, Stack chats, Chat + local agents and back. Each switch applies immediately with no blank or stuck panes.",
  },
  {
    id: "browser-coexistence",
    label: "Your normal browser chats are unaffected",
    check: "Keep one normal provider conversation open in your regular browser the whole time. Before, during and after this test it must remain fully usable (send, receive, no error pages).",
  },
  {
    id: "restart",
    label: "Restart returns what the provider persists",
    check: "Close the app completely and launch it again. Where the provider persists sessions, your login state and current thread should return. Record what does not return — that is a valid result.",
  },
  {
    id: "local-discovery",
    label: "Local Claude Code/Codex sessions discovered (read-only)",
    check: "Pick Chat + local agents. Your known local sessions should appear with provider, project and last updated. The count should match what claude/codex list locally. Refresh must not send anything to any agent.",
  },
  {
    id: "local-tail",
    label: "Read-only last-message preview is honest",
    check: "Select one session and click View last messages (read-only). Latest user/assistant turns appear; if the transcript is long, truncation indicators are visible. No agent process should start.",
  },
  {
    id: "local-resume",
    label: "Resume (optional) opens the CLI without auto-sending",
    check: "ONLY for a session you personally know is inactive and disposable: click Resume in Windows terminal. The official CLI opens in the right folder and identifies the session; nothing is sent automatically. If in doubt, leave it Not tested.",
  },
  {
    id: "no-survivors",
    label: "No leftover processes after quit",
    check: "Quit the app, then check Task Manager (Processes) for unexpected AI Workspace or Electron preview processes. There should be none.",
  },
]);

const ITEM_BY_ID = new Map(ACCEPTANCE_ITEMS.map((item) => [item.id, item]));
const NOTE_LIMIT = 400;
const SAFE_STRING_LIMIT = 120;
const KNOWN_PANE_STATES = Object.freeze([
  "loading", "page-loaded", "load-failed", "popup-blocked", "unknown",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Redact before rendering: remove link/URL values (they can carry callbacks
// or state), e-mail addresses, and long opaque candidates; then cap length.
function redactText(value) {
  if (typeof value !== "string") return "";
  const cleaned = (value + " ")
    .replace(/https?:\/\/[^\s"'<>()]+/gi, "[link removed]")
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[address removed]")
    .replace(/\b[A-Za-z0-9+/=._-]{32,}\b/g, "[opaque value removed]")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length > NOTE_LIMIT ? cleaned.slice(0, NOTE_LIMIT) + "…" : cleaned;
}

function safeLabel(value, limit = SAFE_STRING_LIMIT) {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed.length > limit ? trimmed.slice(0, limit) : trimmed;
}

function validateResultEntry(entry) {
  if (!isPlainObject(entry)) throw new TypeError("Each result must be an object.");
  if (typeof entry.id !== "string" || !ITEM_BY_ID.has(entry.id)) {
    throw new TypeError("Unknown acceptance check id.");
  }
  if (!RESULT_STATES.includes(entry.result)) {
    throw new TypeError("Result must be pass, fail, blocked or not-tested.");
  }
  if (entry.note !== undefined && typeof entry.note !== "string") {
    throw new TypeError("A note must be plain text.");
  }
  return {
    id: entry.id,
    label: ITEM_BY_ID.get(entry.id).label,
    check: ITEM_BY_ID.get(entry.id).check,
    result: entry.result,
    note: redactText(entry.note === undefined ? "" : entry.note),
  };
}

function validateResults(results) {
  if (!Array.isArray(results)) throw new TypeError("Results must be an array.");
  if (!results.length) throw new TypeError("At least one check result is required.");
  const seen = new Set();
  const rows = [];
  for (const entry of results) {
    const row = validateResultEntry(entry);
    if (seen.has(row.id)) throw new TypeError("Duplicate acceptance check id.");
    seen.add(row.id);
    rows.push(row);
  }
  return rows;
}

// Diagnostics: state words + numeric codes + counts only. Any other shape
// (paths, ids, strings) is rejected or dropped, never rendered.
function validateDiagnostics(diagnostics) {
  if (diagnostics === undefined) return {};
  if (!isPlainObject(diagnostics)) throw new TypeError("Diagnostics must be an object.");
  const out = {};

  if (diagnostics.providerStatus !== undefined) {
    if (!isPlainObject(diagnostics.providerStatus)) throw new TypeError("providerStatus must be an object.");
    const clean = {};
    for (const [key, value] of Object.entries(diagnostics.providerStatus)) {
      if (!/^[a-z0-9-]+(:[a-z])?[a-z]*$/i.test(key) || key.length > 40) {
        throw new TypeError("Invalid provider status key.");
      }
      if (!isPlainObject(value) || typeof value.state !== "string") {
        throw new TypeError("Invalid provider status entry.");
      }
      // Only the app's own diagnostic states are renderable. This whitelist is
      // what stops a path, URL fragment or session id from travelling through
      // the "state" field into the report.
      if (!KNOWN_PANE_STATES.includes(value.state)) {
        throw new TypeError("Invalid provider status entry.");
      }
      clean[key] = {
        state: value.state,
        errorCode: Number.isSafeInteger(value.errorCode) ? value.errorCode : null,
      };
    }
    out.providerStatus = clean;
  }

  if (diagnostics.sessionCounts !== undefined) {
    if (!isPlainObject(diagnostics.sessionCounts)) throw new TypeError("sessionCounts must be an object.");
    const clean = {};
    for (const [key, value] of Object.entries(diagnostics.sessionCounts)) {
      if (key.length > 40 || !Number.isSafeInteger(value) || value < 0 || value > 1000000) {
        throw new TypeError("Invalid session count.");
      }
      clean[key] = value;
    }
    out.sessionCounts = clean;
  }

  if (diagnostics.cliAvailability !== undefined) {
    if (!isPlainObject(diagnostics.cliAvailability)) throw new TypeError("cliAvailability must be an object.");
    const clean = {};
    for (const [key, value] of Object.entries(diagnostics.cliAvailability)) {
      if (key.length > 40 || typeof value !== "boolean") {
        throw new TypeError("Invalid CLI availability entry.");
      }
      clean[key] = value;
    }
    out.cliAvailability = clean;
  }

  return out;
}

function validateEnvironment(environment) {
  if (environment === undefined) return {};
  if (!isPlainObject(environment)) throw new TypeError("Environment must be an object.");
  const out = {};
  for (const key of ["commit", "appVersion", "builtAt", "electron", "platform", "osRelease"]) {
    const value = environment[key];
    if (value === undefined || value === null) { out[key] = null; continue; }
    const safe = safeLabel(value, key === "commit" ? 64 : 80);
    if (value !== null && safe === null) throw new TypeError("Invalid environment field: " + key);
    if (key === "commit" && safe !== null && !/^[a-f0-9]{7,64}$/i.test(safe)) {
      throw new TypeError("Commit must be a hexadecimal SHA.");
    }
    out[key] = safe;
  }
  return out;
}

function markdownTableRow(cells) {
  return "| " + cells.map((c) => String(c).replace(/\|/g, "\\|").replace(/\r?\n/g, " ")).join(" | ") + " |";
}

function buildAcceptanceReport(input) {
  if (!isPlainObject(input)) throw new TypeError("Acceptance report payload required.");
  if (input.schema !== ACCEPTANCE_SCHEMA) throw new TypeError("Unsupported acceptance report schema.");

  const results = validateResults(input.results);
  const environment = validateEnvironment(input.environment);
  const diagnostics = validateDiagnostics(input.diagnostics);
  const generatedAt = safeLabel(input.generatedAt === undefined ? "" : String(input.generatedAt), 40);
  if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(generatedAt || "")) {
    throw new TypeError("Generated-at must be a UTC timestamp from the app.");
  }

  // Present in canonical checklist order so reports compare cleanly.
  const ordered = ACCEPTANCE_ITEMS
    .map((item) => results.find((row) => row.id === item.id))
    .filter(Boolean);

  const counts = { pass: 0, fail: 0, blocked: 0, "not-tested": 0 };
  for (const row of ordered) counts[row.result] += 1;
  // Items the app never reported are genuinely untested: count them, do not
  // pretend the checklist was covered.
  counts["not-tested"] += ACCEPTANCE_ITEMS.length - ordered.length;

  const attention = ordered
    .filter((row) => row.result === "fail" || row.result === "blocked")
    .map((row) => row.label);

  const buildLine = environment.commit
    ? environment.commit
    : "not embedded (development run)";

  const md = [
    "# AI Workspace — owner acceptance report",
    "",
    "> Generated locally by the desktop preview. This file contains no credentials,",
    "> cookies, account identifiers, conversation content, URLs, transcript text or",
    "> local paths. Free-text notes had links, addresses and long opaque values removed",
    "> automatically before saving. It is safe to send back as-is.",
    "",
    "## Build identity",
    "",
    markdownTableRow(["Field", "Value"]),
    markdownTableRow(["Build commit", buildLine]),
    markdownTableRow(["App version", environment.appVersion || "unknown"]),
    markdownTableRow(["Electron", environment.electron || "unknown"]),
    markdownTableRow(["Platform", environment.platform || "unknown"]),
    markdownTableRow(["OS release", environment.osRelease || "unknown"]),
    markdownTableRow(["Report generated (UTC)", generatedAt]),
    "",
    "## Results",
    "",
    markdownTableRow(["Check", "Result", "Note"]),
    ...ordered.map((row) =>
      markdownTableRow([row.label, RESULT_LABELS[row.result], row.note || "—"])),
    "",
    "## Diagnostics observed by the app",
    "",
  ];

  if (diagnostics.providerStatus && Object.keys(diagnostics.providerStatus).length) {
    md.push(
      markdownTableRow(["Pane", "Last state", "Network code"]),
      ...Object.entries(diagnostics.providerStatus)
        .map(([key, value]) =>
          markdownTableRow([key, value.state, value.errorCode === null ? "—" : String(value.errorCode)])),
    );
  } else {
    md.push("No provider load events were observed before the report was saved.");
  }
  if (diagnostics.sessionCounts && Object.keys(diagnostics.sessionCounts).length) {
    md.push("");
    md.push(
      "Local session inventory counts (most recent refresh): " +
        Object.entries(diagnostics.sessionCounts).map(([k, v]) => `${k} = ${v}`).join(", ") + "."
    );
  }
  if (diagnostics.cliAvailability && Object.keys(diagnostics.cliAvailability).length) {
    md.push(
      "Official CLI presence (read-only PATH scan): " +
        Object.entries(diagnostics.cliAvailability).map(([k, v]) => `${k} = ${v ? "found" : "not found"}`).join(", ") + "."
    );
  }

  md.push(
    "",
    "## 30-second summary",
    "",
    `build ${buildLine} · ${counts.pass} pass · ${counts.fail} fail · ${counts.blocked} blocked · ${counts["not-tested"]} not tested`,
    attention.length ? `needs attention: ${attention.join("; ")}` : "no fails or blocked items recorded",
    "",
    "## Meaning of the states",
    "",
    "- **Pass** — worked as expected with a disposable account/session.",
    "- **Fail** — it did not work; the note records what actually happened.",
    "- **Blocked** — the provider or platform prevented the step (e.g. embedded popup sign-in). Recording this is a valid, expected outcome.",
    "- **Not tested** — skipped or not applicable; no claim is made.",
    "",
  );
  const markdown = md.join("\n");

  const json = JSON.stringify(
    {
      schema: ACCEPTANCE_SCHEMA,
      generatedAt,
      environment,
      diagnostics,
      results: ordered.map(({ id, label, result, note }) => ({ id, label, result, note })),
      counts: Object.assign({}, counts, { answered: counts.pass + counts.fail + counts.blocked }),
    },
    null,
    2
  );

  const summary =
    `AI Workspace acceptance · build ${buildLine} · ` +
    `${counts.pass} pass, ${counts.fail} fail, ${counts.blocked} blocked, ${counts["not-tested"]} not tested` +
    (attention.length ? ` · needs attention: ${attention.join("; ")}` : "");

  return { schema: ACCEPTANCE_SCHEMA, generatedAt, markdown, json, summary };
}

module.exports = {
  ACCEPTANCE_SCHEMA,
  RESULT_STATES,
  RESULT_LABELS,
  ACCEPTANCE_ITEMS,
  buildAcceptanceReport,
};
