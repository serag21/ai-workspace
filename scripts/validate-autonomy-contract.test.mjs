import test from "node:test";
import assert from "node:assert/strict";
import { validateProjectState } from "./validate-autonomy-contract.mjs";

function fixture() {
  const backlog = Array.from({length: 10}, (_, i) =>
    "| AW-" + String(i+1).padStart(3,"0") +
    " | QW-001 | P0 | " + (i === 0 ? "**READY**" : "**BLOCKED**") +
    " | Acceptance evidence | Dependency |").join("\n");
  const state = {
    schemaVersion:1,projectId:"ai-workspace",
    sourceBranch:"spike/local-agents-desktop",
    automation:{
      isActivated:false,ownerApprovalToActivate:false,
      controllerContract:"not-published-or-not-verified",
      controllerIntegration:"not-implemented",
      recurringJobsCreatedByThisRepo:false,
      externalPaidCallsEnabled:false
    },
    resources:{
      maxUnattendedMinutesPerCycle:60,
      checkpointIntervalMinutes:30,
      maxDeterministicRetriesPerStep:2,
      maxConcurrentLocalModels:1,
      maxPaidProviderCalls:0,
      allowDesktopControl:false,
      allowArbitraryExternalPublication:false,
      leaseRequiredForNewGpuWork:true
    },
    run:{status:"idle",activeTaskId:null,runId:null},
    next:{readyTaskId:"AW-001",otherReadyTaskIds:[],ownerGatedTaskIds:["AW-002"],
      checkpointOnNextRun:"Inspect git and select next safe task"}
  };
  return {
    charter:"# Vision\nDefinition of success\nChatGPT, Claude, Gemini. See BACKLOG.md DECISIONS.md RUN_STATE.json",
    backlog, decisions:"# Decisions\nD-001: owner authority",
    state, command:"Read PROJECT_CHARTER.md BACKLOG.md RUN_STATE.json. No automatic recurrence."
  };
}
test("AUTO-001: valid bounded idle state with next READY task passes",()=>{
  const r=validateProjectState(fixture());
  assert.equal(r.ok,true,r.errors.join("\n"));
  assert.equal(r.readyCount,1);
  assert.equal(r.taskCount,10);
  assert.equal(r.activation,"disabled");
});
test("AUTO-001: missing/reassigned task ID cannot hide an unfinished cycle",()=>{
  const f=fixture();
  f.state.next.readyTaskId="AW-999";
  assert.equal(validateProjectState(f).ok,false);
});
test("AUTO-002: activation without central GPU contract and owner approval fails closed",()=>{
  const f=fixture();
  f.state.automation.isActivated=true;
  assert.match(validateProjectState(f).errors.join(" "),/Autonomous activation is forbidden/);
});
test("AUTO-002: no project-specific scheduler or paid work may be smuggled in",()=>{
  const f=fixture();
  f.state.automation.recurringJobsCreatedByThisRepo=true;
  f.state.automation.externalPaidCallsEnabled=true;
  const text=validateProjectState(f).errors.join(" ");
  assert.match(text,/may not create its own recurring scheduler/);
  assert.match(text,/Paid AI services/);
});
test("AUTO-002: no unbounded runtime, retries, extra models or unauthorized desktop work",()=>{
  const f=fixture();
  f.state.resources.maxUnattendedMinutesPerCycle=100000;
  f.state.resources.maxDeterministicRetriesPerStep=999;
  f.state.resources.maxConcurrentLocalModels=2;
  f.state.resources.allowDesktopControl=true;
  const errors=validateProjectState(f).errors.join(" ");
  assert.match(errors,/bounded positive maximum/);
  assert.match(errors,/retry limit/);
  assert.match(errors,/single-model/);
});
test("AUTO-001: duplicate backlog IDs are detected rather than silently overwritten",()=>{
  const f=fixture();
  f.backlog+="\n| AW-001 | QW-002 | P0 | **DONE** | Duplicate | ignored |";
  assert.match(validateProjectState(f).errors.join(" "),/Duplicate backlog task ID/);
});
test("AUTO-001: active runs cannot claim a nonexistent task or omit run ID",()=>{
  const f=fixture();
  f.state.run.status="in-progress";
  f.state.run.activeTaskId="AW-002";
  f.state.run.runId=null;
  assert.match(validateProjectState(f).errors.join(" "),/Active run must have/);
});
test("AUTO-001: owner-gated human verification cannot be mislabeled READY",()=>{
  const f=fixture();
  f.state.next.ownerGatedTaskIds=["AW-001"];
  assert.match(validateProjectState(f).errors.join(" "),/Owner-gated tasks/);
});
test("AUTO-001: native OpenCode command may not lose its no-schedule guard",()=>{
  const f=fixture();
  f.command="Only read BACKLOG.md";
  assert.match(validateProjectState(f).errors.join(" "),/Native OpenCode advance command/);
});
