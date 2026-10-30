/**
 * Bounded read-only tail of a LOCAL Claude Code or Codex JSONL transcript.
 *
 * Read-only by construction: a single bounded window at the END of the file
 * (default 256 KiB) is read and parsed; nothing is written, executed, sent,
 * or opened beyond that one file. The tail view is a preview (CON-004):
 * the latest 2-3 exchanges, with honest "truncated"/"window-limited"
 * indicators rather than claiming completeness.
 *
 * Display text is capped per message (maxMessageChars) so one multi-megabyte
 * record cannot freeze the UI (CON-005). Binary or wrong-type files report
 * `unreadable` instead of throwing garbage.
 */
const { stat } = require("node:fs/promises");
const { open } = require("node:fs/promises");

const DEFAULT_MAX_BYTES = 256 * 1024;
const DEFAULT_MAX_MESSAGES = 30;
const DEFAULT_MAX_MESSAGE_CHARS = 4000;

function clampMessages(value) {
  if (!Number.isInteger(value) || value < 1 || value > 200) {
    throw new RangeError("maxMessages must be an integer in [1, 200].");
  }
  return value;
}

function clampChars(value) {
  if (!Number.isInteger(value) || value < 1 || value > 100000) {
    throw new RangeError("maxMessageChars must be an integer in [1, 100000].");
  }
  return value;
}

/** Extract display text from a Claude-style message content (string or blocks). */
function claudeContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") parts.push(block.text);
    else if (block.type === "tool_use" && typeof block.name === "string")
      parts.push("[tool use: " + block.name + "]");
    else if (block.type === "tool_result") parts.push("[tool result]");
    // thinking / system / image blocks are deliberately not surfaced.
  }
  return parts.join("\n");
}

/** Extract display text from a Codex role-based item content. */
function codexContentText(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts = [];
  for (const block of content) {
    if (typeof block === "string") parts.push(block);
    else if (block && typeof block === "object" &&
             (block.type === "input_text" || block.type === "output_text" || block.type === "text") &&
             typeof block.text === "string") parts.push(block.text);
  }
  return parts.join("\n");
}

function capText(text, limit) {
  if (typeof text !== "string") return { text: "", textTruncated: false };
  if (text.length <= limit) return { text, textTruncated: false };
  return { text: text.slice(0, limit), textTruncated: true };
}

/**
 * Parse a JSONL tail window into bounded display messages.
 *
 * @param {string} raw decoded UTF-8 text from the end of the transcript.
 * @param {"claude-code"|"codex"} provider which record grammar to expect.
 */
function parseAgentTail(raw, provider, options = {}) {
  const maxMessages = clampMessages(options.maxMessages ?? DEFAULT_MAX_MESSAGES);
  const maxMessageChars = clampChars(options.maxMessageChars ?? DEFAULT_MAX_MESSAGE_CHARS);
  const result = {
    provider,
    messages: [],
    parsedRecords: 0,
    droppedLines: 0,
    unreadable: false,
  };

  if (typeof raw !== "string" || raw.trim() === "") return result;
  // A JSONL transcript is UTF-8 text; NUL bytes mark the wrong file type.
  if (raw.includes("\u0000")) { result.unreadable = true; return result; }

  const lines = raw.split("\n");
  const messages = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); }
    catch { result.droppedLines += 1; continue; } // cut-off first/last line etc.
    if (!record || typeof record !== "object") continue;
    result.parsedRecords += 1;

    if (provider === "claude-code") {
      if (record.type !== "user" && record.type !== "assistant") continue;
      const role = (record.message && record.message.role) || record.type;
      if (role !== "user" && role !== "assistant") continue;
      const text = claudeContentText(record.message && record.message.content).trim();
      if (!text) continue;
      messages.push({ role, ...capText(text, maxMessageChars), source: "record" });
    } else if (provider === "codex") {
      let role = null;
      let text = "";
      if (record.type === "response_item" && record.payload) {
        if (record.payload.role === "user" || record.payload.role === "assistant") {
          role = record.payload.role;
          text = codexContentText(record.payload.content);
        }
      } else if (record.type === "event_msg" && record.payload &&
                 record.payload.type === "agent_message") {
        role = "assistant";
        text = typeof record.payload.message === "string" ? record.payload.message : "";
      }
      if (!role) continue;
      text = text.trim();
      if (!text) continue;
      messages.push({ role, ...capText(text, maxMessageChars), source: "record" });
    }
  }

  // Deduplicate exact adjacent duplicates (Codex event_msg echoes response_item).
  const deduped = [];
  for (const message of messages) {
    const previous = deduped[deduped.length - 1];
    if (previous && previous.role === message.role && previous.text === message.text) continue;
    deduped.push(message);
  }

  const kept = deduped.slice(-maxMessages);
  result.elidedEarlier = Math.max(0, deduped.length - kept.length);
  result.messages = kept;
  return result;
}

/**
 * Read a bounded window at the END of a transcript file without loading the
 * whole file. `openFn`/`statFn` are injectable for deterministic tests.
 */
async function readTranscriptTail(file, options = {}) {
  const maxBytes = Number.isInteger(options.maxBytes) && options.maxBytes >= 1 ? options.maxBytes : DEFAULT_MAX_BYTES;
  const statFn = options.statFn || stat;
  const openFn = options.openFn || open;
  if (typeof file !== "string" || !file) throw new TypeError("Expected a transcript file path.");
  const size = (await statFn(file)).size;
  if (!Number.isFinite(size) || size < 0) throw new RangeError("Invalid file size.");
  const windowBytes = Math.min(maxBytes, Math.floor(size));
  const start = size - windowBytes;
  const fd = await openFn(file, "r");
  try {
    if (windowBytes === 0) return { text: "", size, windowLimited: start > 0 };
    const buffer = Buffer.allocUnsafe(windowBytes);
    const { bytesRead } = await fd.read(buffer, 0, windowBytes, start);
    return { text: buffer.toString("utf8", 0, bytesRead), size, windowLimited: start > 0 };
  } finally {
    await fd.close().catch(() => {});
  }
}

module.exports = {
  parseAgentTail,
  readTranscriptTail,
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_MESSAGE_CHARS,
};
