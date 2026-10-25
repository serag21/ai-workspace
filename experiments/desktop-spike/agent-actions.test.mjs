import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {EventEmitter} from "node:events";
const require=createRequire(import.meta.url);
const {prepareAgentResume,openAgentTerminal}=require("./agent-actions.cjs");

const ID="11111111-1111-4111-8111-111111111111";
const ROOT="C:\\Projects\\camera";
const MOCK={
  platform:"win32",
  realpathFn:async value => {
    assert.equal(value,ROOT);
    return ROOT;
  },
  statFn:async () => ({isDirectory:()=>true}),
  readdirFn:async () => [],
};
test("AGENT-002: Claude Code resumes selected UUID without shell interpolation or auto-prompt",async()=>{
  const args=await prepareAgentResume({provider:"claude-code",sessionId:ID,cwd:ROOT},MOCK);
  assert.deepEqual(args.args,["/k","claude","--resume",ID]);
  assert.equal(args.options.cwd,ROOT);
  assert.equal(args.options.shell,false);
  assert.equal(args.options.windowsHide,false);
});
test("AGENT-002: Codex uses interactive resume instead of exec resume",async()=>{
  const args=await prepareAgentResume({provider:"codex",sessionId:ID,cwd:ROOT},MOCK);
  assert.deepEqual(args.args,["/k","codex","resume",ID]);
});
test("AGENT-003 HAND-007: invalid ID, provider or absent cwd refuse execution",async()=>{
  let called=false;
  const launch={...MOCK,spawnFn:()=>{called=true;throw Error("must not launch");}};
  for(const session of [
    {provider:"codex",sessionId:"x & del C:\\",cwd:ROOT},
    {provider:"evil",sessionId:ID,cwd:ROOT},
    {provider:"codex",sessionId:ID,cwd:null},
  ]) await assert.rejects(openAgentTerminal(session,launch));
  assert.equal(called,false);
});
test("AGENT-003: non-Windows and nonexistent paths refuse execution",async()=>{
  const session={provider:"codex",sessionId:ID,cwd:ROOT};
  await assert.rejects(prepareAgentResume(session,{...MOCK,platform:"darwin"}),/Windows only/);
  await assert.rejects(prepareAgentResume(session,{
    ...MOCK,statFn:async()=>({isDirectory:()=>false}),
  }),/not a folder/);
});
test("AGENT-002: external terminal launch happens only after an explicit main-process request",async()=>{
  const events=[];
  const session={provider:"codex",sessionId:ID,cwd:ROOT};
  const response=await openAgentTerminal(session,{...MOCK,spawnFn:(exe,args,options)=>{
    events.push({exe,args,options});
    const child = new EventEmitter();
    child.unref = () => events.push("unref");
    queueMicrotask(() => child.emit("spawn"));
    return child;
  }});
  assert.equal(response.launched,true);
  assert.equal(response.mode,"external-terminal");
  assert.equal(events.length,2);
  assert.deepEqual(events[0].args,["/k","codex","resume",ID]);
  assert.equal(events[0].options.detached,true);
});

test("AGENT-003 REL-013: project-local CLI wrappers cannot hijack Windows resume", async () => {
  for (const [provider, filename] of [
    ["claude-code", "CLAUDE.CMD"],
    ["codex", "codex.exe"],
    ["codex", "cmd.exe"],
  ]) {
    let spawned = false;
    await assert.rejects(
      openAgentTerminal({provider, sessionId:ID, cwd:ROOT}, {
        ...MOCK,
        readdirFn:async () => [filename],
        spawnFn:() => { spawned = true; throw Error("must not spawn"); },
      }),
      /shadow the installed CLI/
    );
    assert.equal(spawned, false);
  }
});

test("AGENT-003: local CLI safety check fails closed if project directory cannot be inspected", async () => {
  await assert.rejects(prepareAgentResume(
    {provider:"codex",sessionId:ID,cwd:ROOT},
    {...MOCK,readdirFn:async () => { throw Object.assign(new Error("denied"),{code:"EACCES"}); }}
  ), /denied/);
});

test("AGENT-002 REL-013: asynchronous spawn failure rejects instead of reporting a false launch", async () => {
  let unrefCalled = false;
  const child = new EventEmitter();
  child.unref = () => { unrefCalled = true; };
  const result = openAgentTerminal({provider:"codex",sessionId:ID,cwd:ROOT}, {
    ...MOCK,
    spawnFn: () => {
      queueMicrotask(() => child.emit("error", Object.assign(new Error("Executable not found"), {code:"ENOENT"})));
      return child;
    },
  });
  await assert.rejects(result, /Executable not found/);
  assert.equal(unrefCalled, false, "A failed child must not be detached or reported as launched.");
});

test("AGENT-002: missing spawn acknowledgement is a bounded failure", async () => {
  const child = new EventEmitter();
  child.unref = () => { throw Error("Must not detach"); };
  await assert.rejects(openAgentTerminal({provider:"codex",sessionId:ID,cwd:ROOT}, {
    ...MOCK, launchTimeoutMs: 10, spawnFn: () => child,
  }), /not acknowledged in time/);
});

test("AGENT-002: premature terminal close before spawn is not success", async () => {
  const child = new EventEmitter();
  child.unref = () => { throw Error("Must not detach"); };
  await assert.rejects(openAgentTerminal({provider:"claude-code",sessionId:ID,cwd:ROOT}, {
    ...MOCK, spawnFn: () => {
      queueMicrotask(() => child.emit("close", 1));
      return child;
    },
  }), /exited before launch confirmation/);
});
