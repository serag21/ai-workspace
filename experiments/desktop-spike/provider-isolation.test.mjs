/*
 * AW-005 bounded CPU-only proof: the isolation / non-control contract that the
 * provider-compliance comparison (docs/provider-compliance-alternatives.md)
 * hinges on.
 *
 * Proven here (synthetic, CPU-only, fake Electron — no provider traffic):
 *   1. Same-provider panes share exactly ONE persistent partition key (the
 *      login-persistence contract), while different providers never share a
 *      session key.
 *   2. Untrusted provider strings cannot allocate a view, partition, or
 *      session, and cannot perturb pane state.
 *   3. A blocked login popup has ZERO side effects outside the app: the app
 *      never auto-opens the user's browser for it, never navigates the pane,
 *      and retains no reopenable state. The only external open remains
 *      owner-initiated and canonical.
 *
 * NOT proven here (live-host only): that a provider's real sign-in form
 * renders inline in the embedded pane. That remains G1 step 2. Nothing in
 * this file clears a live P0 gate.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const requireNavigation = createRequire(import.meta.url)("./provider-navigation.cjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const script = await readFile(path.join(DIR, "main.cjs"), "utf8");

/** Minimal fake Electron; mirrors the main.test.mjs fixture surface. */
async function shellFixture() {
  const views = [];
  const partitions = [];
  const windows = [];
  const handlers = new Map();
  const ipcMain = { handle(name, handler) {
    assert.equal(handlers.has(name), false, "IPC registered twice: " + name);
    handlers.set(name, handler);
  } };

  class FakeWebContents extends EventEmitter {
    constructor() { super(); this.id = FakeWebContents.nextId++; this.loaded = []; this.sent = []; this.closed = false; }
    static nextId = 1;
    setWindowOpenHandler(handler) { this.popupHandler = handler; }
    send(channel, payload) { this.sent.push({channel, payload}); }
    getURL() { return this.loaded.at(-1) || ""; }
    async loadURL(url) { this.loaded.push(url); }
    isDestroyed() { return this.closed; }
    close() { this.closed = true; }
  }

  class FakeView {
    constructor(options) {
      this.options = options;
      this.webContents = new FakeWebContents();
      this.bounds = [];
      views.push(this);
    }
    setBounds(value) { this.bounds.push({ ...value }); }
  }

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.webContents = new FakeWebContents();
      this.contentView = { addChildView: view => { assert.ok(views.includes(view)); this.children.push(view); } };
      this.children = [];
      this.width = options.width;
      this.height = options.height;
      windows.push(this);
    }
    getContentSize() { return [this.width, this.height]; }
    isDestroyed() { return false; }
    async loadFile(file) { this.file = file; }
  }

  const app = new EventEmitter();
  app.whenReady = async () => {};
  app.quit = () => {};
  const session = {
    fromPartition(partition) {
      assert.ok(partition.startsWith("persist:ai-workspace-spike-"),
        "A session may only be allocated from the registered allowlist prefix: " + partition);
      const item = { partition, setPermissionRequestHandler(handler) { this.permissionHandler = handler; } };
      partitions.push(item);
      return item;
    },
  };
  const openedExternal = [];
  const shell = { async openExternal(url) { openedExternal.push(url); } };
  const mockElectron = { app, BrowserWindow: FakeWindow, WebContentsView: FakeView, ipcMain, session, shell };
  const sandbox = {
    require(id) {
      if (id === "electron") return mockElectron;
      if (id === "node:path") return path;
      if (id === "./agent-actions.cjs") return { openAgentTerminal: async () => { throw Error("Fake must never start a real agent."); } };
      if (id === "./cli-provenance.cjs") return { resolveCliOnPath: async () => null };
      if (id === "./provider-navigation.cjs") return requireNavigation;
      if (id === "./agent-tail.cjs") return createRequire(import.meta.url)("./agent-tail.cjs");
      throw Error("Unexpected native module: " + id);
    },
    __dirname: DIR,
    URL,
    console,
    process: { argv: ["electron", "main.cjs"], stdout: { write() {} } },
  };
  vm.runInNewContext(script, sandbox, { filename: "main.cjs" });
  for (let i = 0; i < 10 && windows.length === 0; i++)
    await new Promise(resolve => setImmediate(resolve));
  const window = windows[0];
  return {
    views, partitions, handlers, window, openedExternal,
    sender: { sender: { id: window.webContents.id } },
    otherSender: { sender: { id: -99 } },
  };
}

test("CON-016 REL-008: two panes of the same provider share exactly one partition key", async () => {
  const f = await shellFixture();
  // Startup view: left = chatgpt (boot default). Switch the left pane to
  // claude, then split: both panes now host claude with independent WebContents.
  await f.handlers.get("spike:select-provider")(f.sender, "claude", "left");
  assert.equal(await f.handlers.get("spike:set-layout")(f.sender, "split"), "split");
  assert.equal(f.views.length, 3); // boot chatgpt pane + left/right claude panes
  const leftClaude = f.views[1];
  const rightClaude = f.views[2];
  assert.equal(f.partitions.at(-2).partition, "persist:ai-workspace-spike-claude");
  assert.equal(f.partitions.at(-1).partition, "persist:ai-workspace-spike-claude",
    "both claude panes must resolve the SAME login partition key");
  assert.notEqual(leftClaude.webContents.id, rightClaude.webContents.id,
    "independent navigation states, shared login store");

  // Now the right pane switches provider: the key set must gain exactly one
  // new key and the two providers' keys must never collide.
  await f.handlers.get("spike:select-provider")(f.sender, "gemini", "right");
  assert.equal(f.views.length, 4);
  const keys = [...new Set(f.partitions.map(p => p.partition))].sort();
  assert.deepEqual(keys, [
    "persist:ai-workspace-spike-chatgpt",
    "persist:ai-workspace-spike-claude",
    "persist:ai-workspace-spike-gemini",
  ]);
});

test("REL-013: untrusted provider strings cannot allocate views, partitions, or pane state", async () => {
  const f = await shellFixture();
  const viewsBefore = f.views.length;
  const partitionsBefore = f.partitions.length;
  const hostile = [
    "chatgpt\npersist:evil",           // partition-key injection attempt
    "../evil",                          // relative-path style
    "persist:ai-workspace-spike-chatgpt", // pre-baked partition key
    "chatgpt; DROP TABLE sessions",     // command style
    "ChatGPT",                          // case drift
    "chatgpt ",                         // whitespace drift
    42, null,
  ];
  for (const provider of hostile) {
    await assert.rejects(
      f.handlers.get("spike:select-provider")(f.sender, provider, "right"),
      /Invalid provider selection/,
      "must refuse: " + JSON.stringify(provider));
  }
  assert.equal(f.views.length, viewsBefore, "no view may be created for an untrusted provider");
  assert.equal(f.partitions.length, partitionsBefore, "no session may be allocated for an untrusted provider");
  // Pane state must be unchanged: the fallback for "right" still resolves the
  // boot default (claude) through the normal pipeline, not any hostile value.
  const result = await f.handlers.get("spike:open-native-browser")(f.sender, "right");
  assert.equal(result.provider, "claude");
  assert.equal(f.openedExternal.at(-1), "https://claude.ai/");
});

test("CON-016 REL-013: a blocked login popup has zero side effects outside the app", async () => {
  const f = await shellFixture();
  const view = f.views[0].webContents;
  const paneUrl = view.getURL();

  view.emit("did-start-loading");
  // The provider page attempts the OAuth flow in a popup.
  assert.equal(view.popupHandler({url: "https://accounts.example.test/oauth2?code=DO_NOT_EXPOSE"}).action,
    "deny", "popups remain hard-denied until genuine Windows authentication is established");

  assert.deepEqual(f.openedExternal, [],
    "the app must never auto-open the user's browser in response to a popup request");
  assert.equal(view.getURL(), paneUrl, "a denied popup must not navigate the pane");
  const sent = JSON.stringify(f.window.webContents.sent);
  assert.ok(!sent.includes("DO_NOT_EXPOSE"), "no OAuth URL may remain stored or transmitted");
  assert.equal(f.window.webContents.sent.at(-1).payload.state, "popup-blocked");
  // No stored login state of any kind is available to any IPC channel.
  assert.ok(!f.handlers.has("spike:open-blocked-popup"),
    "no automatic popup-redelivery or login-state channel may exist");

  // The ONLY external open in the app remains owner-initiated and canonical.
  const result = await f.handlers.get("spike:open-native-browser")(f.sender, "left");
  assert.equal(f.openedExternal.length, 1);
  assert.deepEqual(f.openedExternal, ["https://chatgpt.com/"]);
  assert.equal(result.preservedConversation, false, "homepage fallback, never the discarded OAuth URL");
  await assert.rejects(f.handlers.get("spike:open-native-browser")(f.otherSender, "left"),
    /Unrecognized pane/, "an embedded provider page must not open the user's browser");
});
