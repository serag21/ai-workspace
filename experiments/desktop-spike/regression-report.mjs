/**
 * REGRESSION COVERAGE REPORT
 * Ensures canonical quality register retains stable unique IDs, maps actual
 * test case titles (not comments), and never confuses mocks with provider E2E.
 */
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import process from "node:process";

export function auditRegressionCoverage(register, testSources) {
  const rows = register.split("\n")
    .map(line => /^\|\s*((?:REL|CON|HAND|AGENT|TRUST)-\d{3})\s*\|\s*(\*{0,2}P[012]\*{0,2})\s*\|/.exec(line))
    .filter(Boolean).map(matches => ({
      id: matches[1], priority: matches[2].replaceAll("*", ""),
    }));
  if (rows.length < 50) throw new Error("Regression register unexpectedly lost entries: found " + rows.length);
  const unique = new Set(rows.map(row => row.id));
  if (unique.size !== rows.length) throw new Error("Duplicate regression gate IDs in register.");
  if (!unique.has("REL-001")) throw new Error("Provider interference release blocker REL-001 is missing.");

  const mocked = new Set();
  for (const source of testSources) {
    const caseNames = [...source.matchAll(/\btest\(\s*["']([^"']+)["']/g)];
    for (const match of caseNames) {
      const ids = match[1].match(/\b(?:REL|CON|HAND|AGENT|TRUST)-\d{3}\b/g) ?? [];
      for (const id of ids) {
        if (!unique.has(id)) throw new Error("Test refers to unknown regression gate: " + id);
        mocked.add(id);
      }
    }
  }

  const p0Rows = rows.filter(row => row.priority === "P0");
  const report = [
    "# AI Workspace release-gate coverage (CI-generated)",
    "",
    "**NOT A PRODUCT RELEASE APPROVAL.** Mocked test coverage is not proof that a",
    "provider's genuine website, authenticated account, or local coding-agent",
    "process works. No real-provider end-to-end tests were performed by this report.",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    "| Tracked regression gates | " + rows.length + " |",
    "| Gates with at least one named synthetic test | " + mocked.size + " |",
    "| Gates requiring further checks | " + (rows.length - mocked.size) + " |",
    "| Real-host gates verified by CI | **0** |",
    "| P0 gates requiring real-host verification | **" + p0Rows.length + "** |",
    "",
    "## P0 blockers",
    "",
    "| ID | Automated evidence | Live provider / Windows acceptance |",
    "| --- | --- | --- |",
    ...p0Rows.map(row => "| " + row.id + " | " +
      (mocked.has(row.id) ? "Synthetic test only" : "No dedicated synthetic test") +
      " | **NOT VERIFIED** |"),
    "",
    "## Full register",
    "",
    "| ID | Priority | Automated coverage | Real-host verification |",
    "| --- | --- | --- | --- |",
    ...rows.map(row => "| " + row.id + " | " + row.priority + " | " +
      (mocked.has(row.id) ? "Synthetic test only" : "None") + " | Not verified |"),
    "",
    "Canonical register: docs/quality/reliability-regression-register.md.",
    "If real-host tests are later automated, they must be reported separately",
    "with secure logs, explicit opt-in and no unapproved mass provider requests.",
    "",
  ].join("\n");
  return { rows, mocked, p0Rows, report };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const register = await readFile(path.join(root, "docs/quality/reliability-regression-register.md"), "utf8");
  const testPaths = [
    "experiments/local-agent-probe/discover.test.mjs",
    "experiments/local-agent-probe/claude-sdk-adapter.test.mjs",
    "experiments/desktop-spike/main.test.mjs",
    "experiments/desktop-spike/sync-policy.test.mjs",
  ];
  const sources = await Promise.all(testPaths.map(p => readFile(path.join(root, p), "utf8")));
  const { mocked, p0Rows, report } = auditRegressionCoverage(register, sources);
  const dest = path.join(root, "experiments/desktop-spike/regression-status.md");
  await writeFile(dest, report, "utf8");
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY,
      "### AI Workspace regression status\n\n**" + mocked.size +
      " of 50** quality gates have named synthetic tests; **0 P0 live-host verified**; " +
      p0Rows.length + " P0 gates require Windows/provider validation.\n\n" +
      "See the regression-status artifact for the per-gate table.\n");
  }
  process.stdout.write("Mapped " + mocked.size +
    " synthetic-test gates. All " + p0Rows.length + " P0s still need live-host verification.\n");
}
