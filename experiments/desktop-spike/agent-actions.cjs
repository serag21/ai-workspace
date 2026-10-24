/**
 * Explicit, one-click, external-terminal agent resume for verified LOCAL sessions.
 * This does not try to attach to another running CLI process, does not inject a
 * prompt, and does not change permission/sandbox policy for the agent.
 *
 * The renderer NEVER provides a cwd or command: main process re-discovers a
 * canonical local session record by UUID and verifies the directory.
 */
const { spawn } = require("node:child_process");
const { stat, realpath, readdir } = require("node:fs/promises");
const path = require("node:path");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COMMANDS = Object.freeze({
  "claude-code": {program: "claude", args: id => ["--resume", id]},
  "codex": {program: "codex", args: id => ["resume", id]},
});

async function prepareAgentResume(session, {platform = process.platform, statFn = stat, realpathFn = realpath, readdirFn = readdir} = {}) {
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
  // cmd.exe searches its working directory before PATH. A project checkout
  // containing e.g. claude.cmd or codex.exe could otherwise hijack a resume.
  // Fail closed if a matching executable is present, including custom PATHEXT.
  const extensions = new Set([".com", ".exe", ".bat", ".cmd"]);
  for (const ext of (process.env.PATHEXT || "").split(";")) {
    if (/^\.[a-z0-9]{1,8}$/i.test(ext)) extensions.add(ext.toLowerCase());
  }
  const shadowNames = new Set([entry.program, "cmd.exe",
    ...[...extensions].map(ext => entry.program + ext)]);
  const names = await readdirFn(cwd);
  if (names.some(name => typeof name === "string" && shadowNames.has(name.toLowerCase()))) {
    throw new Error("Project folder contains a command that could shadow the installed CLI. Resume refused.");
  }
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
