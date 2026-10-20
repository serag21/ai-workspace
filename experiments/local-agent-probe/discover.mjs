/**
 * Read-only Windows/macOS/Linux inventory of LOCAL Claude Code and Codex transcripts.
 * Feasibility probe only: no API calls, agent execution, prompt sending, or writes.
 * This uses filesystem evidence; "active/working" cannot be inferred reliably from it.
 */
import { readdir, open, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_FILES = 2500;
const MAX_HEAD_BYTES = 192 * 1024;
const MAX_TITLE = 120;

function compact(value) {
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE) : "";
}

function textFromContent(content) {
  if (typeof content === "string") return compact(content);
  if (!Array.isArray(content)) return "";
  return compact(content.filter((b) => b && typeof b === "object" && (b.type === "text" || b.type === "input_text"))
    .map((b) => b.text).filter((s) => typeof s === "string").join(" "));
}

/** Bounded read avoids loading hundreds of megabytes of complete transcripts. */
async function headRecords(file) {
  let fd;
  try {
    fd = await open(file, "r");
    const buffer = Buffer.allocUnsafe(MAX_HEAD_BYTES);
    const { bytesRead } = await fd.read(buffer, 0, buffer.length, 0);
    const raw = buffer.toString("utf8", 0, bytesRead);
    // Drop the last incomplete JSONL line if the bounded read cut through it.
    const lines = raw.slice(0, raw.lastIndexOf("\n") + 1).split("\n").filter(Boolean);
    return lines.slice(0, 120).flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {
    return [];
  } finally {
    await fd?.close().catch(() => {});
  }
}

/** Limits traversal; never follows symlinks or visits directories outside the supplied root. */
async function findFiles(root, depth, accepts) {
  const output = [];
  async function visit(dir, remainingDepth) {
    if (output.length >= MAX_FILES || remainingDepth < 0) return;
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (output.length >= MAX_FILES) break;
      if (entry.isSymbolicLink()) continue;
      const full = path.join(dir, entry.name);
      if (entry.isFile() && accepts(entry.name)) output.push(full);
      else if (entry.isDirectory() && remainingDepth > 0) await visit(full, remainingDepth - 1);
    }
  }
  await visit(root, depth);
  return output;
}

function metadataForClaude(file, records, modifiedAt) {
  const id = path.basename(file, ".jsonl");
  if (!UUID_RE.test(id)) return null; // Excludes sidecars and subagent session files.
  let cwd = "", branch = "", title = "";
  for (const record of records) {
    if (typeof record.cwd === "string" && !cwd) cwd = record.cwd;
    if (typeof record.gitBranch === "string" && !branch) branch = record.gitBranch;
    if (record.type === "summary" && !title) title = compact(record.summary);
    if (record.type === "custom-title") title = compact(record.customTitle) || title;
    if (record.type === "user" && !title) {
      const candidate = textFromContent(record.message?.content);
      if (candidate && !candidate.startsWith("<") && !candidate.startsWith("/")) title = candidate;
    }
  }
  return { id: "claude:" + id, provider: "claude-code", sessionId: id,
    title: title || "Claude Code session", cwd: cwd || null, branch: branch || null,
    modifiedAt, file, state: "unknown" };
}

function metadataForCodex(file, records, modifiedAt) {
  let id = "", cwd = "", title = "", branch = "";
  for (const record of records) {
    if (record.type === "session_meta") {
      const m = record.payload ?? {};
      id = typeof m.id === "string" ? m.id : id;
      cwd = typeof m.cwd === "string" ? m.cwd : cwd;
      branch = typeof m.git?.branch === "string" ? m.git.branch : branch;
    }
    if (record.type === "event_msg" && record.payload?.type === "user_message" && !title) {
      const candidate = compact(record.payload.message);
      if (candidate && !candidate.startsWith("<") && !candidate.startsWith("# AGENTS")) title = candidate;
    }
    if (record.type === "response_item" && record.payload?.role === "user" && !title) {
      title = textFromContent(record.payload.content);
    }
  }
  if (!UUID_RE.test(id)) return null;
  return { id: "codex:" + id, provider: "codex", sessionId: id,
    title: title || "Codex session", cwd: cwd || null, branch: branch || null,
    modifiedAt, file, state: "unknown" };
}

export async function discoverLocalAgents({
  claudeRoot = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude"),
  codexRoot = process.env.CODEX_HOME || path.join(os.homedir(), ".codex"),
  limit = 200,
} = {}) {
  const [claudeFiles, codexFiles] = await Promise.all([
    findFiles(path.join(claudeRoot, "projects"), 2, (n) => UUID_RE.test(path.basename(n, ".jsonl")) && n.endsWith(".jsonl")),
    findFiles(path.join(codexRoot, "sessions"), 4, (n) => n.startsWith("rollout-") && n.endsWith(".jsonl")),
  ]);
  const candidates = await Promise.all([
    ...claudeFiles.map(async (file) => {
      try { const s = await stat(file); return metadataForClaude(file, await headRecords(file), s.mtimeMs); } catch { return null; }
    }),
    ...codexFiles.map(async (file) => {
      try { const s = await stat(file); return metadataForCodex(file, await headRecords(file), s.mtimeMs); } catch { return null; }
    }),
  ]);
  const byId = new Map();
  for (const candidate of candidates) {
    if (!candidate) continue;
    const previous = byId.get(candidate.id);
    if (!previous || candidate.modifiedAt > previous.modifiedAt) byId.set(candidate.id, candidate);
  }
  const boundedLimit = Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.trunc(limit))) : 200;
  return [...byId.values()].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, boundedLimit);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const sessions = await discoverLocalAgents();
  process.stdout.write(JSON.stringify({
    generatedAt: new Date().toISOString(),
    note: "Read-only local metadata. Working/idle/approval state is NOT detected.",
    sessions,
  }, null, 2) + "\n");
}
