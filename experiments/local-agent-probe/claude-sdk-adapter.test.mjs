import test from "node:test";
import assert from "node:assert/strict";
import {listClaudeSessionsReadOnly, readClaudeMessagesReadOnly} from "./claude-sdk-adapter.mjs";

const A="11111111-1111-4111-8111-111111111111";
const B="22222222-2222-4222-8222-222222222222";

test("AGENT-001: official local Claude SDK inventory normalizes metadata; no query or writes",async()=>{
  let lists=0;
  const sdk={
    async listSessions(options) {
      lists++;
      assert.deepEqual(options, {limit:50,offset:0});
      return [
        {sessionId:A,summary:"Auto summary",firstPrompt:"The first prompt",customTitle:"Implement video capture",
          lastModified:1720000000000,cwd:"C:\\dev\\camera",gitBranch:"camera-tests"},
        {sessionId:B,summary:"Another project",lastModified:1730000000000,cwd:"C:\\dev\\editor"},
        {sessionId:"invalid",summary:"Should never surface",lastModified:Infinity},
      ];
    },
    query() {throw Error("DO NOT EXECUTE AN AGENT");},
    forkSession() {throw Error("DO NOT MUTATE SESSIONS");},
  };
  const rows=await listClaudeSessionsReadOnly({sdk,limit:50});
  assert.equal(lists,1);
  assert.equal(rows.length,2);
  assert.equal(rows[0].sessionId,B);
  assert.equal(rows[1].title,"Implement video capture");
  assert.equal(rows[1].branch,"camera-tests");
  assert.equal(rows[1].cwd,"C:\\dev\\camera");
  assert.equal(rows[1].source,"official-sdk");
  assert.equal(rows[1].state,"unknown");
  assert.equal(rows[1].file,null);
});

test("AGENT-001: optional SDK session paging never reads more than the caller's bounded request",async()=>{
  const opts=[];
  const sdk={async getSessionMessages(id,options){
    assert.equal(id,A);
    opts.push(options);
    return [
      {type:"user",uuid:"u1",message:{content:[{type:"text",text:"Fix the driver"}]}},
      {type:"assistant",uuid:"a1",message:{content:[{type:"text",text:"Changed the test harness"},{type:"tool_use",name:"Bash"}]}},
      {type:"system",uuid:"s1",message:{content:[{type:"text",text:"Hidden"}]}},
      {type:"assistant",uuid:"a2",message:{content:[{type:"image",url:"secret"}]}},
    ];
  }};
  const messages=await readClaudeMessagesReadOnly({sdk,sessionId:A,limit:12,offset:3});
  assert.deepEqual(opts,[{limit:12,offset:3,includeSystemMessages:false}]);
  assert.deepEqual(messages.map(x=>[x.role,x.text]),
    [["user","Fix the driver"],["assistant","Changed the test harness"]]);
});

test("AGENT-001: malicious/invalid IDs and offsets rejected before any SDK file read",async()=>{
  let calls=0;
  const sdk={async getSessionMessages(){calls++;return []}};
  await assert.rejects(readClaudeMessagesReadOnly({sdk,sessionId:"../private",limit:999}),TypeError);
  await assert.rejects(readClaudeMessagesReadOnly({sdk,sessionId:A,offset:-1}),TypeError);
  assert.equal(calls,0);
});

test("AGENT-001: rejects malformed SDK responses instead of guessing session identities",async()=>{
  await assert.rejects(listClaudeSessionsReadOnly({sdk:{listSessions:async()=>({objects:[]})}}),TypeError);
  await assert.rejects(readClaudeMessagesReadOnly({sdk:{getSessionMessages:async()=>null},sessionId:A}),TypeError);
});

test("REL-009: excessive requested session and message limits are capped",async()=>{
  let listLimit=0,msgLimit=0;
  const sdk={
    async listSessions(options){listLimit=options.limit;return []},
    async getSessionMessages(id,options){msgLimit=options.limit;return []},
  };
  await listClaudeSessionsReadOnly({sdk,limit:999999999});
  await readClaudeMessagesReadOnly({sdk,sessionId:A,limit:999999999});
  assert.equal(listLimit,200);
  assert.equal(msgLimit,50);
});
