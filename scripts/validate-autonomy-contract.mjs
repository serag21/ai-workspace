/**
 * Deterministic, CPU-only validation of AI Workspace's four-file autonomy
 * contract. No model invocation, GPU, network, timers, scheduling or file writes.
 *
 * CI enforces that "self-continuing" always has an explicit durable NEXT task,
 * finite budgets and a disabled activation state until approved integration.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const VALID_STATUSES = new Set(["DONE", "READY", "BLOCKED", "IN PROGRESS", "LATER", "CANCELLED"]);
const VALID_RUN_STATUSES = new Set(["idle", "in-progress", "paused", "blocked", "completed"]);
const EXPECTED_BRANCH = "spike/local-agents-desktop";
const REQUIRED_FILES = ["PROJECT_CHARTER.md", "BACKLOG.md", "DECISIONS.md", "RUN_STATE.json"];

function validTaskId(value) {
  return typeof value === "string" && /^AW-\d{3}$/.test(value);
}
function present(value) {
  return typeof value === "string" && value.trim().length > 0;
}
function finiteInt(value, lo, hi) {
  return Number.isSafeInteger(value) && value >= lo && value <= hi;
}

/**
 * @param {{charter:string, backlog:string, decisions:string, state:unknown, command?:string}} parts
 * @returns {{ok:boolean, errors:string[], taskCount:number, readyCount:number, activation:string}}
 */
export function validateProjectState(parts) {
  const errors = [];
  const { charter = "", backlog = "", decisions = "", state = null, command = "" } = parts ?? {};
  if (!present(charter) || !/\b[Vv]ision\b/.test(charter) ||
      !/Definition of success/i.test(charter) ||
      !/ChatGPT/.test(charter) || !/Claude/.test(charter) || !/Gemini/.test(charter)) {
    errors.push("PROJECT_CHARTER.md must preserve original vision, success definition and provider scope.");
  }
  for (const file of REQUIRED_FILES) {
    if (file === "PROJECT_CHARTER.md") continue;
    if (!charter.includes(file)) errors.push("PROJECT_CHARTER.md must link " + file + ".");
  }
  if (!/\bD-001\b/.test(decisions) || !/Owner/i.test(decisions))
    errors.push("DECISIONS.md must retain decision history and owner boundaries.");

  // Only task TABLE rows count; incidental prose references do not establish
  // a backlog task. Parse statuses by the table cell following priority.
  const tasks = new Map();
  for (const line of backlog.split(/\r?\n/)) {
    const cells = line.split("|").map(s => s.trim());
    const id = cells[1];
    if (!validTaskId(id)) continue;
    const status = (cells[4] ?? "").replaceAll("*", "");
    if (tasks.has(id)) errors.push("Duplicate backlog task ID: " + id);
    if (!VALID_STATUSES.has(status)) errors.push("Unsupported status for " + id + ": " + status);
    tasks.set(id, status);
  }
  if (tasks.size < 8) errors.push("BACKLOG.md unexpectedly lost substantial original project scope.");
  const readyCount = [...tasks.values()].filter(x => x === "READY").length;
  if (readyCount === 0) errors.push("Backlog has no independently actionable READY tasks; record reason before a cycle.");

  if (!state || typeof state !== "object" || Array.isArray(state)) {
    errors.push("RUN_STATE.json must be a JSON object.");
    return { ok: false, errors, taskCount: tasks.size, readyCount, activation: "unknown" };
  }
  if (state.schemaVersion !== 1) errors.push("RUN_STATE.json schemaVersion must equal 1.");
  if (state.projectId !== "ai-workspace" || state.sourceBranch !== EXPECTED_BRANCH)
    errors.push("RUN_STATE.json must point to the AI Workspace desktop branch.");

  const automation = state.automation ?? {};
  const run = state.run ?? {};
  const budget = state.resources ?? {};
  const next = state.next ?? {};

  if (automation.isActivated !== false) {
    // Activation changes are a separate approved milestone requiring explicit
    // proof: a published contract, authorization and a quiet 2-cycle smoke.
    if (automation.isActivated !== true ||
        automation.ownerApprovalToActivate !== true ||
        automation.controllerContract !== "verified" ||
        automation.controllerIntegration !== "verified" ||
        state.validation?.twoCycleQuietSmoke !== "passed") {
      errors.push("Autonomous activation is forbidden without owner consent, verified shared controller contract/integration, and a two-cycle quiet smoke.");
    }
  }
  if (automation.recurringJobsCreatedByThisRepo !== false)
    errors.push("AI Workspace may not create its own recurring scheduler.");
  if (automation.externalPaidCallsEnabled !== false)
    errors.push("Paid AI services must not be enabled by the project automation.");

  if (!finiteInt(budget.maxUnattendedMinutesPerCycle, 1, 120))
    errors.push("Unattended cycle time must have a bounded positive maximum <=120 minutes.");
  if (!finiteInt(budget.checkpointIntervalMinutes, 1, 30))
    errors.push("Checkpoint interval must be <=30 minutes.");
  if (!finiteInt(budget.maxDeterministicRetriesPerStep, 0, 2))
    errors.push("Safe retry limit must be <=2.");
  if (budget.maxConcurrentLocalModels !== 1 || budget.maxPaidProviderCalls !== 0 ||
      budget.allowDesktopControl !== false || budget.allowArbitraryExternalPublication !== false ||
      budget.leaseRequiredForNewGpuWork !== true) {
    errors.push("Default no-spend, single-model, no-desktop-control and GPU-lease constraints must remain explicit.");
  }

  if (!VALID_RUN_STATUSES.has(run.status))
    errors.push("Run status is invalid.");
  if (run.status === "idle" && (run.activeTaskId !== null || run.runId !== null)) {
    errors.push("Idle state may not claim a live task or run ID.");
  }
  if (run.status === "in-progress" &&
      (!validTaskId(run.activeTaskId) || !tasks.has(run.activeTaskId) || !present(run.runId))) {
    errors.push("Active run must have a registered task and non-empty unique runId.");
  }
  if (run.activeTaskId && !tasks.has(run.activeTaskId))
    errors.push("Active task is missing from BACKLOG.md.");

  if (!validTaskId(next.readyTaskId) ||
      tasks.get(next.readyTaskId) !== "READY") {
    errors.push("RUN_STATE.next.readyTaskId must be an existing READY task.");
  }
  if (!Array.isArray(next.otherReadyTaskIds)) {
    errors.push("RUN_STATE.next.otherReadyTaskIds must be an array.");
  } else {
    for (const id of next.otherReadyTaskIds) {
      if (!validTaskId(id) || tasks.get(id) !== "READY")
        errors.push("Other ready task is missing or not READY: " + String(id));
    }
  }
  if (!Array.isArray(next.ownerGatedTaskIds) ||
      next.ownerGatedTaskIds.some(id => !validTaskId(id) || tasks.get(id) !== "BLOCKED"))
    errors.push("Owner-gated tasks must be registered BLOCKED tasks.");
  if (!present(next.checkpointOnNextRun))
    errors.push("Next cycle needs a deterministic recovery/checkpoint instruction.");

  if (command && (!/PROJECT_CHARTER\.md/.test(command) ||
                  !/RUN_STATE\.json/.test(command) ||
                  !/No automatic recurrence/i.test(command))) {
    errors.push("Native OpenCode advance command must read durable state and not schedule itself.");
  }
  return {
    ok: errors.length === 0,
    errors,
    taskCount: tasks.size,
    readyCount,
    activation: automation.isActivated === true ? "enabled-verified" : "disabled",
  };
}

export async function validateRepo(root) {
  const [charter, backlog, decisions, rawState, command] = await Promise.all([
    readFile(path.join(root, "PROJECT_CHARTER.md"), "utf8"),
    readFile(path.join(root, "BACKLOG.md"), "utf8"),
    readFile(path.join(root, "DECISIONS.md"), "utf8"),
    readFile(path.join(root, "RUN_STATE.json"), "utf8"),
    readFile(path.join(root, ".opencode/commands/advance.md"), "utf8"),
  ]);
  let state;
  try { state = JSON.parse(rawState); }
  catch { throw new Error("RUN_STATE.json is not parseable JSON; no worker should start."); }
  return validateProjectState({charter,backlog,decisions,state,command});
}

const invokedAsScript = process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedAsScript) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await validateRepo(root);
  process.stdout.write("AI Workspace state contract: " +
    (result.ok ? "PASS" : "FAIL") + " | " +
    result.taskCount + " tasks | " + result.readyCount + " ready | automation " +
    result.activation + "\n");
  for (const error of result.errors) process.stderr.write("ERROR: " + error + "\n");
  if (!result.ok) process.exitCode = 1;
}
