import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";

const providersSource = await readFile("src/providers.ts", "utf8");
const transpiled = ts.transpileModule(providersSource, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    strict: true,
  },
}).outputText;

const exportsObject = {};
const sandbox = { exports: exportsObject, module: { exports: exportsObject }, URL };
vm.runInNewContext(transpiled, sandbox, { filename: "src/providers.ts" });
const { getProvider, getProviderLabel, getSessionId, isNewChatRoute } = sandbox.module.exports;

assert.equal(getProvider("https://chatgpt.com/"), "chatgpt");
assert.equal(getProvider("https://chat.openai.com/c/example"), "chatgpt");
assert.equal(getProvider("https://claude.ai/chat/abc123"), "claude");
assert.equal(getProvider("https://gemini.google.com/app/abc123"), "gemini");
assert.equal(getProvider("https://chatgpt.com.evil.example/"), null);
assert.equal(getProvider("https://evil-chatgpt.com/"), null);
assert.equal(getProviderLabel("claude"), "Claude");

assert.equal(isNewChatRoute("chatgpt", "https://chatgpt.com/"), true);
assert.equal(isNewChatRoute("claude", "https://claude.ai/new"), true);
assert.equal(isNewChatRoute("claude", "https://claude.ai/"), true);
assert.equal(isNewChatRoute("gemini", "https://gemini.google.com/app"), true);
assert.equal(isNewChatRoute("chatgpt", "https://chatgpt.com/c/conversation-1"), false);
assert.equal(isNewChatRoute("claude", "https://claude.ai/chat/conversation-1"), false);
assert.equal(isNewChatRoute("gemini", "https://gemini.google.com/app/conversation-1"), false);

assert.equal(getSessionId("chatgpt", "https://chatgpt.com/", 11), "chatgpt:draft:11");
assert.equal(getSessionId("chatgpt", "https://chatgpt.com/", 12), "chatgpt:draft:12");
assert.equal(
  getSessionId("chatgpt", "https://chatgpt.com/c/conversation-1", 11),
  getSessionId("chatgpt", "https://chatgpt.com/c/conversation-1", 12),
  "real conversations should have stable provider URL IDs independent of tab",
);

for (const file of ["public/background.js", "public/content.js", "public/session-db.js"]) {
  execFileSync(process.execPath, ["--check", file], { stdio: "inherit" });
}

const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
assert.equal(manifest.manifest_version, 3);
for (const host of ["https://chatgpt.com/*", "https://claude.ai/*", "https://gemini.google.com/*"]) {
  assert.ok(manifest.host_permissions.includes(host), "missing host permission: " + host);
}

console.log("Smoke tests passed: provider matching, new-chat IDs, stable conversation IDs, manifest hosts, and provider-script syntax.");
