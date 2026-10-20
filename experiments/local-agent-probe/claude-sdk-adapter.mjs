/**
 * Optional, read-only adapter for Anthropic's official Claude Agent SDK session API.
 *
 * Important:
 *  - Uses listSessions/getSessionMessages only, which read LOCAL transcripts.
 *  - Does not import query(), execute an agent, create/fork/rename/delete sessions,
 *    send user messages, or call the Claude API.
 *  - sdk can be injected by tests. If SDK is not installed, callers may
 *    safely fall back to bounded raw-file inventory.
 *
 * Official docs: https://platform.claude.com/cookbook/claude-agent-sdk-05-building-a-session-browser
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function compact(value, max) {
  return typeof value === "string"
    ? value.replace(/\s+/g, " ").trim().slice(0, max)
    : "";
}
function safeLimit(limit, max = 200) {
  return Number.isFinite(limit) ? Math.max(1, Math.min(max, Math.trunc(limit))) : 50;
}

export async function loadClaudeSessionSdk() {
  // Dynamic import occurs only on explicit user request to refresh local inventory.
  const sdk = await import("@anthropic-ai/claude-agent-sdk");
  if (typeof sdk.listSessions !== "function" || typeof sdk.getSessionMessages !== "function")
    throw new Error("Installed Claude Agent SDK lacks read-only session methods.");
  return sdk;
}

export async function listClaudeSessionsReadOnly({sdk, limit = 100, dir} = {}) {
  if (!sdk || typeof sdk.listSessions !== "function") throw new TypeError("Read-only Claude SDK is required.");
  const safe = safeLimit(limit);
  const options = { limit: safe, offset: 0 };
  if (typeof dir === "string" && dir.trim()) options.dir = dir;
  const records = await sdk.listSessions(options);
  if (!Array.isArray(records)) throw new TypeError("Unexpected listSessions response.");
  const byId = new Map();
  for (const record of records.slice(0, safe)) {
    const id = record?.sessionId;
    if (typeof id !== "string" || !UUID_RE.test(id)) continue;
    const modifiedAt = Number(record.lastModified);
    if (!Number.isFinite(modifiedAt) || modifiedAt < 0) continue;
    const normalized = {
      id: "claude:" + id,
      provider: "claude-code",
      sessionId: id,
      title: compact(record.customTitle, 120) ||
        compact(record.summary, 120) || compact(record.firstPrompt, 120) || "Claude Code session",
      cwd: compact(record.cwd, 4096) || null,
      branch: compact(record.gitBranch, 200) || null,
      modifiedAt,
      file: null, // Official SDK does not expose a validated absolute transcript path.
      state: "unknown", // SDK list is historical metadata, NOT a live process state.
      source: "official-sdk",
    };
    const previous = byId.get(normalized.id);
    if (!previous || normalized.modifiedAt > previous.modifiedAt) byId.set(normalized.id, normalized);
  }
  return [...byId.values()].sort((a,b)=>b.modifiedAt-a.modifiedAt);
}

function safeText(blocks, limit) {
  if (typeof blocks === "string") return compact(blocks, limit);
  if (!Array.isArray(blocks)) return "";
  return compact(blocks.filter(x => x && typeof x === "object" && x.type === "text" && typeof x.text === "string")
    .map(x => x.text).join("\n"), limit);
}

/** Read a limited, user-requested page. No SDK API calls other than getSessionMessages. */
export async function readClaudeMessagesReadOnly({sdk, sessionId, limit = 20, offset = 0} = {}) {
  if (!sdk || typeof sdk.getSessionMessages !== "function") throw new TypeError("Read-only Claude SDK is required.");
  if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) throw new TypeError("Invalid Claude session ID.");
  if (!Number.isSafeInteger(offset) || offset < 0) throw new TypeError("Invalid offset.");
  const safe = safeLimit(limit, 50);
  const records = await sdk.getSessionMessages(sessionId, {
    limit: safe, offset, includeSystemMessages: false,
  });
  if (!Array.isArray(records)) throw new TypeError("Unexpected getSessionMessages response.");
  return records.slice(0, safe).filter(x=>x?.type==="user" || x?.type==="assistant")
    .map((record) => ({
      id: compact(record.uuid, 100) || null,
      role: record.type,
      text: safeText(record.message?.content, 12000),
    }))
    .filter(x=>x.text);
}
