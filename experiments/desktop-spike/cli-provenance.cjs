/**
 * Read-only provenance probe for installed coding-agent CLIs (Claude Code, Codex).
 *
 * Resolves a command the way Windows cmd.exe searches PATH (directory order,
 * then PATHEXT extensions) using filesystem stat ONLY. It never executes the
 * resolved program, sends no prompt, and makes no network calls. Used by the
 * resume action to fail closed when the official CLI is simply missing,
 * instead of opening a terminal that can only report the error later.
 */
const { stat } = require("node:fs/promises");
const path = require("node:path");

const SAFE_COMMAND = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function pathEntries(env) {
  if (!env || typeof env !== "object") return [];
  const raw = typeof env.PATH === "string" ? env.PATH
    : typeof env.Path === "string" ? env.Path
    : "";
  // ComSpec presence marks a Windows-style environment; fall back to POSIX.
  const separator = env.ComSpec ? ";" : ":";
  return raw.split(separator).map(entry => entry.trim()).filter(Boolean);
}

function cliCandidates(program, env) {
  const names = [program];
  if (env && (env.ComSpec || typeof env.PATHEXT === "string")) {
    for (const ext of (env.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";")) {
      if (/^\.[a-z0-9]{1,8}$/i.test(ext)) names.push(program + ext.toLowerCase());
    }
  }
  return names;
}

/**
 * @returns {Promise<string|null>} absolute path of the first match, or null.
 */
async function resolveCliOnPath(program, { env = process.env, statFn = stat } = {}) {
  if (typeof program !== "string" || !SAFE_COMMAND.test(program)) return null;
  for (const dir of pathEntries(env)) {
    for (const name of cliCandidates(program, env)) {
      const candidate = path.join(dir, name);
      try {
        const info = await statFn(candidate);
        if (info.isDirectory()) continue; // A folder is not an executable.
        return candidate;
      } catch {
        /* Missing entry: keep searching the PATH. */
      }
    }
  }
  return null;
}

module.exports = { pathEntries, cliCandidates, resolveCliOnPath };
