import test from "node:test";
import assert from "node:assert/strict";
import { auditRegressionCoverage } from "./regression-report.mjs";

const baseline = Array.from({length:50}, (_,i) => {
  const id = "REL-" + String(i+1).padStart(3,"0");
  return "| " + id + " | " + (i === 0 ? "**P0**" : "P1") + " | U | Test description | test assertion |";
}).join("\n");

test("TRUST-001: generated report explicitly states live-provider checks are NOT verified",()=>{
  const result = auditRegressionCoverage(baseline,['test("REL-001: synthetic gate",()=>{})']);
  assert.equal(result.rows.length,50);
  assert.equal(result.mocked.has("REL-001"),true);
  assert.match(result.report,/0 P0 live-host verified|Real-host gates verified by CI \| \*\*0\*\*/);
  assert.match(result.report,/REL-001 \| Synthetic test only \| \*\*NOT VERIFIED\*\*/);
});

test("REL-001: missing or duplicate release gates fail CI rather than silently disappear",()=>{
  assert.throws(()=>auditRegressionCoverage(baseline.split("\n").slice(1).join("\n"),[]),/lost entries/);
  const duplicate=baseline.replace("REL-002","REL-001");
  assert.throws(()=>auditRegressionCoverage(duplicate,[]),/Duplicate/);
});

test("REL-002: comments and pseudo-tests must not be counted as synthetic test coverage",()=>{
  const report=auditRegressionCoverage(baseline,[
    "// REL-002 is a comment only\nconst irrelevant = 'REL-003';\n",
    'test("REL-004: implemented",()=>{})',
  ]);
  assert.equal(report.mocked.has("REL-002"),false);
  assert.equal(report.mocked.has("REL-003"),false);
  assert.equal(report.mocked.has("REL-004"),true);
});

test("REL-001: unknown regression IDs in test names fail and must be registered explicitly",()=>{
  assert.throws(()=>auditRegressionCoverage(baseline,['test("CON-001: unregistered",()=>{})']),/unknown regression gate/);
});
