/**
 * Explicit, one-click, external-terminal agent resume for verified LOCAL sessions.
 * This does not try to attach to another running CLI process, does not inject a
 * prompt, and does not change permission/sandbox policy for the agent.
 *
 * The renderer NEVER provides a cwd or command: main process re-discovers a
 * canonical local session record by UUID and verifies the directory.
 */
const { spawn } = require("node:child_process");
const { stat, realpath } = require("node:fs/promises");
const path = require("node:path");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMANDS = Object.freeze({
  "claude-code": {program: "claude", args: id => ["--resume", id]},
  "codex": {program: "codex", args: id => ["resume", id]},
});

async function prepareAgentResume(session, {platform = process.platform, statFn = stat, realpathFn = realpath} = {}) {
  if (platform !== "win32") throw new Error("External terminal resume is currently supported on Windows only.");
  if (!session || !Object.hasOwn(COMMANDS,session.provider) ||
      typeof session.sessionId !== "string" || !UUID.test(session.sessionId)) {
    throw new TypeError("Unrecognized local coding agent session.");
  }
  if (typeof session.cwd !== "string" || !session.cwd.trim() || session.cwd.length > 4096) {
    throw new Error("This session has no verified working directory. Cannot launch safely.");
  }
  // Only permit a real, existing folder; never execute in shell-defined PATH
  // or a guessed repository when the original working directory is missing.
  const cwd = await realpathFn(session.cwd);
  const info = await statFn(cwd);
  if (!info.isDirectory()) throw new Error("The session's working directory is not a folder.");
  const entry = COMMANDS[session.provider];
  return {
    executable: process.env.ComSpec || "cmd.exe",
    args: ["/k", entry.program, ...entry.args(session.sessionId)],
    options: {cwd, windowsHide: false, detached: true, stdio: "ignore", shell: false},
  };
}

async function openAgentTerminal(session, {spawnFn = spawn, ...deps} = {}) {
  const {executable,args,options} = await prepareAgentResume(session,deps);
  // Main process sends no prompt; the real CLI handles login and permissions.
  const child = spawnFn(executable, args, options);
  child.unref?.();
  return {launched:true, mode:"external-terminal", provider:session.provider,
    sessionId:session.sessionId, cwd:options.cwd};
}

module.exports = {prepareAgentResume,openAgentTerminal};
