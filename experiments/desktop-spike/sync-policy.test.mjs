import test from "node:test";
import assert from "node:assert/strict";
import { SyncGate } from "./sync-policy.mjs";

const CHAT = "chatgpt";
const C1 = "account-one";
function context(maxRequestsPerWindow = 3) {
  let time = 0;
  const gate = new SyncGate({ now: () => time, maxRequestsPerWindow,
    windowMs: 60_000, defaultCooldownMs: 60_000 });
  return { gate, clock: { advance(ms) { time += ms; }, get now() { return time; } } };
}
const ok = () => Promise.resolve({ status: 200 });
function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}
const read = (transport = ok) => ({ operation: "history-list", transport });

test("REL-002 REL-007: merely choosing a provider does not connect, sync, or schedule network work", async () => {
  const { gate, clock } = context();
  let calls = 0;
  const transport = async () => { calls++; return { status: 200 }; };
  assert.deepEqual(gate.connect(CHAT, C1), {ok:false,reason:"consent-required"});
  assert.deepEqual(gate.getState(CHAT,C1), {mode:"disconnected"});
  clock.advance(7_200_000);
  assert.equal((await gate.run(CHAT, C1, read(transport))).reason, "not-connected");
  assert.equal(calls,0);
  assert.equal(gate.connect(CHAT, C1, {explicitConsent:true}).ok, true);
  clock.advance(7_200_000);
  assert.equal(calls,0);
  assert.equal(gate.getState(CHAT,C1).mode,"idle");
});

test("REL-003: honors Retry-After seconds, never retries by itself", async () => {
  const {gate,clock}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  let calls=0;
  const transport=async()=>{calls++; return {status:429,headers:{"retry-after":"120"}};};
  const first=await gate.run(CHAT,C1,read(transport));
  assert.equal(first.reason,"rate-limited");
  assert.equal(first.retryAt,120_000);
  clock.advance(119_999);
  assert.equal((await gate.run(CHAT,C1,read(transport))).reason,"cooldown");
  assert.equal(calls,1);
  clock.advance(1);
  assert.equal(calls,1,"clock advance must never trigger another request");
  assert.equal((await gate.run(CHAT,C1,read(ok))).ok,true);
});

test("REL-003: Retry-After HTTP dates honored; malformed values use safe fallback", async()=>{
  const {gate,clock}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  const date=new Date(clock.now+180000).toUTCString();
  const reply=await gate.run(CHAT,C1,read(async()=>({status:429,headers:new Headers({"Retry-After":date})})));
  assert.equal(reply.retryAt,180000);
  const {gate:other}=context();
  other.connect(CHAT,C1,{explicitConsent:true});
  const bad=await other.run(CHAT,C1,read(async()=>({status:429,headers:{"retry-after":"invalid"}})));
  assert.equal(bad.retryAt,60000);
});

test("REL-003: reconnect cannot erase a provider rate-limit cooldown",async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  await gate.run(CHAT,C1,read(async()=>({status:429,headers:{"Retry-After":"200"}})));
  gate.pause(CHAT,C1);
  assert.equal(gate.connect(CHAT,C1,{explicitConsent:true}).ok,true);
  assert.equal((await gate.run(CHAT,C1,read())).reason,"cooldown");
});

test("REL-004 REL-014: hard pause aborts an in-flight request, blocks further requests", async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  const wait=deferred();
  let abortSeen=false,calls=0;
  const pending=gate.run(CHAT,C1,read(({signal})=>{
    calls++;
    signal.addEventListener("abort",()=>{abortSeen=true;wait.resolve({status:200});},{once:true});
    return wait.promise;
  }));
  assert.equal(gate.pause(CHAT,C1),true);
  assert.equal(abortSeen,true);
  assert.equal((await pending).reason,"cancelled");
  assert.equal((await gate.run(CHAT,C1,read(()=>{calls++;return ok();}))).reason,"paused");
  assert.equal(calls,1);
});

test("REL-004 REL-014: stopAll cancels every account; no sends after shutdown",async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  gate.connect("claude","second",{explicitConsent:true});
  let cancelled=0;
  function makeTransport(){
    return ({signal})=>new Promise((resolve)=>{
      signal.addEventListener("abort",()=>{cancelled++;resolve({status:200});},{once:true});
    });
  }
  const p1=gate.run(CHAT,C1,read(makeTransport()));
  const p2=gate.run("claude","second",read(makeTransport()));
  gate.stopAll();
  assert.equal((await p1).reason,"cancelled");
  assert.equal((await p2).reason,"cancelled");
  assert.equal(cancelled,2);
  assert.equal((await gate.run(CHAT,C1,read())).reason,"paused");
  assert.equal((await gate.run("claude","second",read())).reason,"paused");
});

test("REL-005: enforces shared per-provider request budget even across accounts",async()=>{
  const {gate,clock}=context(2);
  gate.connect(CHAT,C1,{explicitConsent:true});
  gate.connect(CHAT,"account-two",{explicitConsent:true});
  assert.equal((await gate.run(CHAT,C1,read())).ok,true);
  assert.equal((await gate.run(CHAT,"account-two",read())).ok,true);
  let calls=0;
  const budget=await gate.run(CHAT,C1,read(()=>{calls++;return ok();}));
  assert.equal(budget.reason,"budget-exhausted");
  assert.equal(calls,0);
  clock.advance(60000);
  assert.equal((await gate.run(CHAT,C1,read(()=>{calls++;return ok();}))).ok,true);
  assert.equal(calls,1);
});

test("REL-005: same-provider concurrency capped at one; no duplicate in-flight fetch",async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  gate.connect(CHAT,"other",{explicitConsent:true});
  const wait=deferred();
  const pending=gate.run(CHAT,C1,read(()=>wait.promise));
  const second=await gate.run(CHAT,"other",read());
  assert.equal(second.reason,"busy");
  wait.resolve({status:200});
  assert.equal((await pending).ok,true);
  assert.equal((await gate.run(CHAT,"other",read())).ok,true);
});

test("REL-008: rate-limiting one account doesn't overwrite status of a different account",async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  gate.connect(CHAT,"other",{explicitConsent:true});
  await gate.run(CHAT,C1,read(async()=>({status:429,headers:{"retry-after":"120"}})));
  assert.equal(gate.getState(CHAT,C1).mode,"cooldown");
  assert.equal(gate.getState(CHAT,"other").mode,"idle");
  assert.equal((await gate.run(CHAT,"other",read())).ok,true);
  assert.equal(gate.getState(CHAT,"other").mode,"idle");
});

test("REL-006 REL-015: auth errors and network errors become terminal visible states, no retry loops",async()=>{
  const {gate,clock}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  const auth=await gate.run(CHAT,C1,read(async()=>({status:401})));
  assert.equal(auth.reason,"auth-required");
  assert.equal(gate.getState(CHAT,C1).mode,"auth-required");
  let count=0;
  for(let i=0;i<2;i++){
    const r=await gate.run(CHAT,C1,read(async()=>{count++;throw Error("offline");}));
    assert.equal(r.reason,"network-error");
  }
  assert.equal(count,2);
  assert.equal(gate.getState(CHAT,C1).mode,"cooldown");
  clock.advance(30000);
  assert.equal((await gate.run(CHAT,C1,read())).reason,"cooldown");
});

test("CON-008: sending prompts and non-read-only operations through sync gate are rejected",async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  let calls=0;
  await assert.rejects(()=>gate.run(CHAT,C1,{operation:"send-prompt",transport:()=>{calls++;return ok();}}),TypeError);
  assert.equal(calls,0);
});

test("REL-007: disconnect cancels active request and removes account identity",async()=>{
  const {gate}=context();
  gate.connect(CHAT,C1,{explicitConsent:true});
  const wait=deferred();
  const pending=gate.run(CHAT,C1,read(({signal})=>{
    signal.addEventListener("abort",()=>wait.resolve({status:200}),{once:true});
    return wait.promise;
  }));
  assert.equal(gate.disconnect(CHAT,C1),true);
  assert.equal((await pending).reason,"cancelled");
  assert.equal(gate.getState(CHAT,C1).mode,"disconnected");
  assert.equal((await gate.run(CHAT,C1,read())).reason,"not-connected");
});

test("REL-002: invalid account keys refused before any operation",()=>{
  const {gate}=context();
  assert.throws(()=>gate.connect(CHAT,""),TypeError);
  assert.throws(()=>gate.connect("invalid/provider","test"),TypeError);
});
