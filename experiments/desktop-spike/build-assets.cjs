// Stage reviewed, read-only agent discovery modules inside the Electron app.
// This runs at startup/package time; it never reads a user's actual sessions.
const { copyFileSync, existsSync, mkdirSync } = require("node:fs");
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
console.log("Staged read-only local agent modules for desktop app.");
