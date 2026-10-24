import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { discoverLocalAgents, mapBounded } from "./discover.mjs";

const CLAUDE_ID = "11111111-1111-4111-8111-111111111111";
const CODEX_ID = "22222222-2222-4222-8222-222222222222";

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "ai-workspace-probe-"));
  const claudeRoot = path.join(root, "claude");
  const codexRoot = path.join(root, "codex");
  const claudeProject = path.join(claudeRoot, "projects", "C--Users-test-repo");
  const codexDay = path.join(codexRoot, "sessions", "2026", "10", "19");
  await Promise.all([mkdir(claudeProject, { recursive: true }), mkdir(codexDay, { recursive: true })]);

  await writeFile(path.join(claudeProject, CLAUDE_ID + ".jsonl"), [
    JSON.stringify({ type:"user", cwd:"C:\\Users\\test\\repo", gitBranch:"feature/session-bridge",
      message:{ content:[{ type:"text", text:"Implement new session bridge" }] } }),
    JSON.stringify({ type:"assistant", message:{ content:[{type:"text",text:"private details are NOT extracted"}] } }),
  ].join("\n") + "\n");

  await writeFile(path.join(codexDay, "rollout-2026-10-19T17-00-00-" + CODEX_ID + ".jsonl"), [
    JSON.stringify({type:"session_meta",payload:{id:CODEX_ID,cwd:"C:\\Users\\test\\other"}}),
    JSON.stringify({type:"event_msg",payload:{type:"user_message",message:"Review camera driver changes"}}),
  ].join("\n") + "\n");

  await writeFile(path.join(claudeProject, "agent-subagent.jsonl"),
    JSON.stringify({ type:"user", message:{content:"Must never leak into main inventory"} }) + "\n");

  return {root, claudeRoot, codexRoot, claudeProject};
}

test("finds both providers with IDs, branch, cwd and sorted metadata", async () => {
  const f = await fixture();
  try {
    const found = await discoverLocalAgents({claudeRoot:f.claudeRoot,codexRoot:f.codexRoot});
    assert.equal(found.length,2);
    const claude = found.find(s=>s.provider==="claude-code");
    const codex = found.find(s=>s.provider==="codex");
    assert.equal(claude.id,"claude:"+CLAUDE_ID);
    assert.equal(claude.title,"Implement new session bridge");
    assert.equal(claude.branch,"feature/session-bridge");
    assert.equal(codex.id,"codex:"+CODEX_ID);
    assert.equal(codex.title,"Review camera driver changes");
    assert.equal(claude.state,"unknown");
    assert.equal(found.some(s=>s.title.includes("private details")),false);
    assert.equal(found.some(s=>s.title.includes("never leak")),false);
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test("missing config roots return an empty list, not a crash", async () => {
  const f = await fixture();
  try {
    const found = await discoverLocalAgents({claudeRoot:path.join(f.root,"absent"),
      codexRoot:path.join(f.root,"also-absent")});
    assert.deepEqual(found,[]);
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test("does not traverse symlinks outside the configured roots", async () => {
  const f = await fixture();
  try {
    const outside = path.join(f.root,"outside");
    await mkdir(outside);
    await writeFile(path.join(outside, CLAUDE_ID+".jsonl"), 
      JSON.stringify({type:"user", message:{content:"LEAK"}})+"\n");
    try { await symlink(outside,path.join(f.claudeRoot,"projects","linked"),"dir"); }
    catch { return; } // Windows unprivileged symlink creation may be unavailable.
    const found = await discoverLocalAgents({claudeRoot:f.claudeRoot,codexRoot:f.codexRoot});
    assert.equal(found.some(s=>s.title==="LEAK"),false);
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test("limits result count and ignores malformed files", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.claudeProject, "33333333-3333-4333-8333-333333333333.jsonl"),"{bad\n");
    const found = await discoverLocalAgents({claudeRoot:f.claudeRoot,codexRoot:f.codexRoot,limit:1});
    assert.equal(found.length,1);
  } finally { await rm(f.root,{recursive:true,force:true}); }
});

test("REL-009 AGENT-001: inventory worker pool caps simultaneous reads and preserves order", async () => {
  let active = 0;
  let peak = 0;
  const values = Array.from({length: 64}, (_, i) => i);
  const results = await mapBounded(values, 3, async value => {
    active++;
    peak = Math.max(peak, active);
    try {
      // Vary completion order so a Promise.all replacement cannot pass on luck.
      await new Promise(resolve => setTimeout(resolve, (value % 4) + 1));
      return value * 2;
    } finally {
      active--;
    }
  });
  assert.deepEqual(results, values.map(value => value * 2));
  assert.ok(peak > 1, "Worker pool should make progress concurrently.");
  assert.ok(peak <= 3, "Worker pool must never exceed its concurrency budget.");
  assert.equal(active, 0);
});

test("REL-009: bounded inventory handles empty work and rejects invalid limits", async () => {
  assert.deepEqual(await mapBounded([], 3, async () => { throw Error("not called"); }), []);
  await assert.rejects(mapBounded([1], 0, async x => x), /positive concurrency/);
  await assert.rejects(mapBounded([1], 1.5, async x => x), /positive concurrency/);
});
