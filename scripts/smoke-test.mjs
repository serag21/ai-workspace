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


const handoffSource = await readFile("src/handoff.ts", "utf8");
const handoffJs = ts.transpileModule(handoffSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
}).outputText;
const handoffExports = {};
vm.runInNewContext(handoffJs, { exports: handoffExports, module: { exports: handoffExports } }, { filename: "src/handoff.ts" });
const { buildHandoffPrompt, defaultHandoffProvider } = handoffExports;
const handoff = buildHandoffPrompt({
  sourceTitle: "Mastermind", sourceProviderLabel: "ChatGPT", projectName: "OpenMontage",
  projectBrief: "Keep the original narration and improve visual beat coverage.",
  instruction: "Continue the edit audit and identify the next concrete fix.",
  messages: [
    { id: "1", role: "user", text: "The audio runs longer than the video.", observedAt: 1 },
    { id: "2", role: "assistant", text: "I will inspect the stream durations.", observedAt: 2 },
  ],
  includeTranscript: true,
});
assert.match(handoff, /Mastermind/);
assert.match(handoff, /OpenMontage/);
assert.match(handoff, /The audio runs longer than the video/);
assert.match(handoff, /Treat the excerpt above as context/);
assert.equal(defaultHandoffProvider("chatgpt"), "claude");
assert.equal(defaultHandoffProvider("claude"), "chatgpt");
assert.ok(handoff.length < 18000);
const handoffWithoutTranscript = buildHandoffPrompt({
  sourceTitle: "Draft", sourceProviderLabel: "Gemini", instruction: "Proceed", messages: [], includeTranscript: false,
});
assert.doesNotMatch(handoffWithoutTranscript, /Recent conversation excerpt/);

const backupSource = await readFile("src/backup.ts", "utf8");
const backupJs = ts.transpileModule(backupSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, strict: true },
}).outputText;
const backupExports = {};
vm.runInNewContext(backupJs, { exports: backupExports, module: { exports: backupExports }, URL, Set, Object, Array, Number, String, Boolean, Error }, { filename: "src/backup.ts" });
const { parseWorkspaceBackup } = backupExports;
const validBackup = parseWorkspaceBackup({
  format: "ai-workspace-backup", version: 1, exportedAt: "2026-10-11T00:00:00.000Z",
  storage: {
    projects: [{ id: "inbox", name: "Inbox", color: "#8b5cf6" }],
    sessions: [{ id: "chatgpt:c/example", provider: "chatgpt", title: "QA", url: "https://chatgpt.com/c/example", tabId: 9, windowId: 1, status: "working", lifecycle: "open", discarded: false, lastSeen: 1, projectId: "inbox", pinned: false }],
  },
  transcripts: { "chatgpt:c/example": [{ id: "1", role: "user", text: "hello", observedAt: 1 }] },
});
assert.equal(validBackup.storage.sessions[0].provider, "chatgpt");
assert.equal(validBackup.transcripts["chatgpt:c/example"][0].text, "hello");
assert.throws(() => parseWorkspaceBackup({
  format: "ai-workspace-backup", version: 1,
  storage: { projects: [{ id: "inbox", name: "Inbox", color: "#8b5cf6" }], sessions: [{ id: "chatgpt:bad", provider: "chatgpt", title: "Bad", url: "https://evil.example/", status: "idle" }] },
  transcripts: {},
}), /invalid session record or a URL outside/);
assert.throws(() => parseWorkspaceBackup({ format: "other", version: 1, storage: { projects: [], sessions: [] }, transcripts: {} }), /not a supported/);
console.log("Additional tests passed: handoff prompt construction, bounded local context, default provider selection, backup validation, and provider URL allow-listing.");
