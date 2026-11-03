// Stage reviewed, read-only agent discovery modules inside the Electron app.
// This runs at startup/package time; it never reads a user's actual sessions.
const { copyFileSync, existsSync, mkdirSync, writeFileSync } = require("node:fs");
const path = require("node:path");

const source = path.resolve(__dirname, "../local-agent-probe");
const destination = path.join(__dirname, "agent-discovery");
const modules = ["discover.mjs", "claude-sdk-adapter.mjs"];
mkdirSync(destination, { recursive: true });
for (const name of modules) {
  const from = path.join(source, name);
  if (!existsSync(from)) throw new Error("Required local agent module missing: " + name);
  copyFileSync(from, path.join(destination, name));
}

// Build identity (AW-009): embed the exact commit that produced this package so
// the UI build chip and the owner acceptance report can name the Actions run.
// CI: GITHUB_SHA is the run's commit; local dev: git HEAD; neither available:
// the app must say "not embedded" rather than invent an identity.
function resolveBuildCommit() {
  if (process.env.GITHUB_SHA && /^[a-f0-9]{7,64}$/i.test(process.env.GITHUB_SHA)) {
    return process.env.GITHUB_SHA;
  }
  try {
    const { execFileSync } = require("node:child_process");
    const sha = execFileSync("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      timeout: 5000,
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (/^[a-f0-9]{40}$/i.test(sha)) return sha;
  } catch {
    // Development run without a usable git repository: stay honest.
  }
  return null;
}

const pkg = require("./package.json");
const buildCommit = resolveBuildCommit();
writeFileSync(
  path.join(__dirname, "build-info.json"),
  JSON.stringify({
    name: pkg.name,
    version: pkg.version,
    buildCommit,
    builtAt: new Date().toISOString(),
    channel: "unverified-preview",
  }, null, 2) + "\n",
);

console.log("Staged read-only local agent modules for desktop app.");
console.log("Wrote build-info.json (commit: " + String(buildCommit) + ").");
