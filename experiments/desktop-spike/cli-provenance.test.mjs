import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const {resolveCliOnPath, pathEntries, cliCandidates} = require("./cli-provenance.cjs");

// Windows-style fixture environment; deterministic and independent of the host.
const winEnv = {
  ComSpec: "C:\\WINDOWS\\system32\\cmd.exe",
  PATHEXT: ".COM;.EXE;.BAT;.CMD",
  PATH: "C:\\first;C:\\second; " + "C:\\third",
};

function onlyFiles(...names) {
  return async (candidate) => {
    if (names.includes(candidate)) return {isDirectory: () => false};
    throw Object.assign(new Error("ENOENT"), {code: "ENOENT"});
  };
}

test("AGENT-002: CLI provenance resolves the first match in PATH order, then PATHEXT order", async () => {
  const expected = path.join("C:\\first", "claude.cmd");
  const second = path.join("C:\\second", "claude.exe");
  const statFn = onlyFiles(expected, second);
  const resolved = await resolveCliOnPath("claude", {env: winEnv, statFn});
  assert.equal(resolved, expected);
});

test("AGENT-002: CLI provenance skips folders and keeps searching the PATH", async () => {
  const folder = path.join("C:\\first", "claude.exe");
  const fallback = path.join("C:\\second", "codex");
  const statFn = async (candidate) => {
    if (candidate === folder) return {isDirectory: () => true};
    if (candidate === fallback) return {isDirectory: () => false};
    throw Object.assign(new Error("ENOENT"), {code: "ENOENT"});
  };
  assert.equal(await resolveCliOnPath("claude", {env: winEnv, statFn}), null);
  assert.equal(await resolveCliOnPath("codex", {env: winEnv, statFn}), fallback);
});

test("AGENT-002: CLI provenance returns null for absent CLIs without executing anything", async () => {
  const probed = [];
  const statFn = async (candidate) => {
    probed.push(candidate);
    throw Object.assign(new Error("ENOENT"), {code: "ENOENT"});
  };
  assert.equal(await resolveCliOnPath("claude", {env: winEnv, statFn}), null);
  assert.ok(probed.length > 0, "The PATH scan must actually consult the filesystem (stat only).");
});

test("AGENT-002: CLI provenance refuses unsafe command names and empty PATH values", async () => {
  const statFn = async () => { throw Error("must not be consulted"); };
  for (const bad of ["a/b", "C:\\evil\\claude.exe", "claude.exe & del", "", " "]) {
    assert.equal(await resolveCliOnPath(bad, {env: winEnv, statFn}), null);
  }
  assert.deepEqual(pathEntries({...winEnv, PATH: "  ;  "}), []);
});

test("AGENT-002: CLI provenance follows POSIX PATH separators on non-Windows environments", async () => {
  const env = {PATH: "/usr/local/bin:/opt/cli"};
  const expected = path.join("/opt/cli", "codex");
  assert.equal(await resolveCliOnPath("codex", {
    env,
    statFn: onlyFiles(expected),
  }), expected);
  assert.deepEqual(cliCandidates("claude", env), ["claude"]);
});

test("AGENT-002: CLI provenance PATHEXT expansion ignores malformed entries and lowercases extensions", async () => {
  const names = cliCandidates("claude", {ComSpec: "cmd", PATHEXT: ".EXE;;.cmd;bad!;.BAT"});
  assert.deepEqual(names, ["claude", "claude.exe", "claude.cmd", "claude.bat"]);
});
