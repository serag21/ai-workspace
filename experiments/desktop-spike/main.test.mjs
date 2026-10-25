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

/** Main-process unit test with a fake Electron implementation.
 * Never launches an actual provider or makes HTTP requests. */
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
    constructor() {
      super();
      this.id = FakeWebContents.nextId++;
      this.loaded = [];
      this.sent = [];
      this.closed = false;
    }
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
      this.contentView = { addChildView: view => {
        assert.ok(views.includes(view));
        this.children.push(view);
      } };
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
  app.quit = () => { app.quitCalled = true; };
  const session = {
    fromPartition(partition) {
      assert.ok(partition.startsWith("persist:ai-workspace-spike-"));
      const item = {
        partition,
        setPermissionRequestHandler(handler) { this.permissionHandler = handler; },
      };
      partitions.push(item);
      return item;
    },
  };
  const openedExternal=[];
  const shell={async openExternal(url){openedExternal.push(url);}};
  const mockElectron = { app, BrowserWindow: FakeWindow, WebContentsView: FakeView, ipcMain, session, shell };
  const sandbox = {
    require(id) {
      if (id === "electron") return mockElectron;
      if (id === "node:path") return path;
      if (id === "./agent-actions.cjs") return { openAgentTerminal: async () => { throw Error("Fake must never start a real agent."); } };
      if (id === "./provider-navigation.cjs") return requireNavigation;
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
  assert.equal(windows.length, 1, "desktop shell bootstrapped one window");
  const window = windows[0];
  return {
    views, partitions, windows, handlers, window,
    sender: { sender: { id: window.webContents.id } },
    otherSender: { sender: { id: -99 } },
    app, openedExternal,
  };
}

test("REL-002 REL-009 REL-013: startup loads one sandboxed native webpage only", async () => {
  const f = await shellFixture();
  assert.equal(f.views.length, 1);
  const chat = f.views[0];
  assert.deepEqual(chat.webContents.loaded, ["https://chatgpt.com/"]);
  assert.equal(chat.options.webPreferences.nodeIntegration, false);
  assert.equal(chat.options.webPreferences.contextIsolation, true);
  assert.equal(chat.options.webPreferences.webSecurity, true);
  assert.equal(chat.options.webPreferences.sandbox, true);
  assert.equal(chat.options.webPreferences.webviewTag, false);
  assert.equal(f.partitions.length, 1);
  assert.equal(f.partitions[0].partition, "persist:ai-workspace-spike-chatgpt");
  let permitted = true;
  f.partitions[0].permissionHandler({}, "camera", value => { permitted = value; });
  assert.equal(permitted, false);
  assert.equal(chat.webContents.popupHandler({url: "https://example.com"}).action, "deny");
  assert.ok([...f.handlers.keys()].every(name => !/sync|history|prompt/i.test(name)),
    "No background web history sync or provider-send IPC may be installed by desktop boot.");
});

test("CON-006 AGENT-004: split creates a second independently isolated native provider view", async () => {
  const f = await shellFixture();
  const layout = await f.handlers.get("spike:set-layout")(f.sender, "split");
  assert.equal(layout, "split");
  assert.equal(f.views.length, 2);
  assert.equal(f.views[1].webContents.loaded[0], "https://claude.ai/");
  assert.deepEqual(f.partitions.map(p => p.partition),
    ["persist:ai-workspace-spike-chatgpt", "persist:ai-workspace-spike-claude"]);
  const left = f.views[0].bounds.at(-1);
  const right = f.views[1].bounds.at(-1);
  assert.equal(left.x, 270);
  assert.equal(right.x, left.x + left.width);
  assert.equal(left.y, right.y);
  assert.equal(left.width + right.width, f.window.width - 270);
  assert.equal(left.height, f.window.height - 64);
});

test("CON-015: switching layouts and providers never loads unused services", async () => {
  const f = await shellFixture();
  await f.handlers.get("spike:set-layout")(f.sender, "single");
  assert.equal(f.views.length, 1);
  await f.handlers.get("spike:select-provider")(f.sender, "gemini", "left");
  assert.equal(f.views.length, 2);
  assert.equal(f.views[1].webContents.loaded[0], "https://gemini.google.com/app");
  await f.handlers.get("spike:set-layout")(f.sender, "split");
  assert.equal(f.views.length, 3);
  assert.equal(f.views[2].webContents.loaded[0], "https://claude.ai/");
  await f.handlers.get("spike:set-layout")(f.sender, "agent");
  const hidden = f.views[2].bounds.at(-1);
  assert.equal(hidden.width, 0);
  assert.equal(hidden.height, 0);
});

test("REL-013: provider view only allows HTTPS navigation, does not grant popup by default", async () => {
  const f = await shellFixture();
  const fview = f.views[0];
  const listeners = fview.webContents.listeners("will-navigate");
  assert.equal(listeners.length, 1);
  let prevented = false;
  listeners[0]({preventDefault(){prevented = true;}}, "file:///C:/Users/test/secret.txt");
  assert.equal(prevented, true);
  prevented = false;
  listeners[0]({preventDefault(){prevented = true;}}, "https://chatgpt.com/c/123");
  assert.equal(prevented, false);
});


test("CON-001 REL-013: native browser fallback opens only canonical provider URLs", async () => {
  const f=await shellFixture();
  const open=f.handlers.get("spike:open-native-browser");
  // A provider conversation URL keeps path, not potentially sensitive query params.
  const threadId = "01234567-89ab-4cde-8fab-0123456789ab";
  f.views[0].webContents.loaded.push("https://chatgpt.com/c/" + threadId + "?token=do-not-leak#fragment");
  const result=await open(f.sender,"left");
  assert.equal(result.opened,true);
  assert.equal(result.provider,"chatgpt");
  assert.equal(result.preservedConversation,true);
  assert.deepEqual(f.openedExternal,["https://chatgpt.com/c/" + threadId]);
  // Navigation to a third-party login service must not leak its URL/parameters.
  f.views[0].webContents.loaded.push("https://accounts.google.com/o/oauth2/v2/auth?secret=private");
  await open(f.sender,"left");
  assert.equal(f.openedExternal.at(-1),"https://chatgpt.com/");
  // A same-origin login callback must never be opened with a code in its path.
  f.views[0].webContents.loaded.push("https://chatgpt.com/auth/callback/code/secret-in-path");
  const fallback = await open(f.sender,"left");
  assert.equal(fallback.preservedConversation,false);
  assert.equal(f.openedExternal.at(-1),"https://chatgpt.com/");
  f.views[0].webContents.loaded.push("https://chatgpt.com/c/not-a-uuid");
  await open(f.sender,"left");
  assert.equal(f.openedExternal.at(-1),"https://chatgpt.com/");
  await assert.rejects(open(f.otherSender,"left"),/Unrecognized pane/);
  await assert.rejects(open(f.sender,"bogus"),/Unrecognized pane/);
});

test("AGENT-003: external agent launch IPC cannot be called by a provider webpage", async () => {
  const f = await shellFixture();
  assert.ok(f.handlers.has("spike:resume-agent"));
  await assert.rejects(
    f.handlers.get("spike:resume-agent")(f.otherSender, "claude-code",
      "11111111-1111-4111-8111-111111111111"),
    /Unknown window/
  );
});

test("REL-013: unrecognized sender, provider, pane, and layout denied before loading", async () => {
  const f = await shellFixture();
  const before = f.views.length;
  await assert.rejects(f.handlers.get("spike:select-provider")(f.otherSender, "gemini", "left"), /Invalid provider/);
  await assert.rejects(f.handlers.get("spike:select-provider")(f.sender, "evil", "left"), /Invalid provider/);
  await assert.rejects(f.handlers.get("spike:select-provider")(f.sender, "gemini", "unrecognized"), /Invalid provider/);
  assert.throws(() => f.handlers.get("spike:set-layout")(f.otherSender, "split"), /Invalid layout/);
  assert.throws(() => f.handlers.get("spike:set-layout")(f.sender, "triple"), /Invalid layout/);
  assert.equal(f.views.length, before);
});

test("CON-015: same provider can show two independent native conversations", async () => {
  const f = await shellFixture();
  await f.handlers.get("spike:set-layout")(f.sender, "split");
  await f.handlers.get("spike:select-provider")(f.sender, "claude", "left");
  const last = f.views.at(-1);
  assert.equal(last.webContents.loaded[0], "https://claude.ai/");
  assert.equal(f.views.filter(view => view.webContents.loaded[0] === "https://claude.ai/").length, 2);
  assert.equal(f.partitions.at(-1).partition, "persist:ai-workspace-spike-claude");
  assert.notEqual(f.views[1].webContents.id, last.webContents.id,
    "Each pane needs an independently navigable WebContents");
});

test("CON-015: stacked layout assigns each conversation half of the available height", async () => {
  const f = await shellFixture();
  assert.equal(await f.handlers.get("spike:set-layout")(f.sender, "stack"), "stack");
  const a = f.views[0].bounds.at(-1);
  const b = f.views[1].bounds.at(-1);
  assert.equal(a.x,270);
  assert.equal(b.x,270);
  assert.equal(a.y,64);
  assert.equal(b.y,64+a.height);
  assert.equal(a.height+b.height,f.window.height-64);
  assert.equal(a.width,b.width);
});

test("REL-013: app quits only when the window-all-closed event occurs; no background sync worker", async () => {
  const f = await shellFixture();
  assert.equal(f.app.quitCalled, undefined);
  f.app.emit("window-all-closed");
  assert.equal(f.app.quitCalled, true);
});

test("REL-013 CON-006: provider diagnostics identify blocked popups and load errors without leaking auth URLs", async () => {
  const f = await shellFixture();
  const view = f.views[0].webContents;
  view.emit("did-start-loading");
  assert.deepEqual(JSON.parse(JSON.stringify(f.window.webContents.sent.at(-1))), {
    channel: "spike:provider-status",
    payload: {provider:"chatgpt", pane:"left", state:"loading", errorCode:null},
  });

  view.emit("did-fail-load", {}, -105, "ERR_NAME_NOT_RESOLVED",
    "https://accounts.example.test/callback?code=DO_NOT_EXPOSE", true);
  const failure = f.window.webContents.sent.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(failure.payload)), {
    provider:"chatgpt", pane:"left", state:"load-failed", errorCode:-105,
  });
  assert.ok(!JSON.stringify(f.window.webContents.sent).includes("DO_NOT_EXPOSE"));
  view.emit("did-finish-load");
  assert.equal(f.window.webContents.sent.at(-1).payload.state, "load-failed",
    "Do not overwrite a failed load with an inaccurate page-loaded status.");

  view.emit("did-start-loading");
  view.emit("did-fail-load", {}, -3, "ERR_ABORTED", "https://chatgpt.com/redirect", true);
  view.emit("did-finish-load");
  assert.equal(f.window.webContents.sent.at(-1).payload.state, "page-loaded",
    "A normal redirect cancellation is not a provider failure.");

  assert.deepEqual(JSON.parse(JSON.stringify(view.popupHandler({url:"https://accounts.example.test/?token=DO_NOT_EXPOSE"}))),
    {action:"deny"});
  assert.equal(f.window.webContents.sent.at(-1).payload.state, "popup-blocked");
  assert.ok(!JSON.stringify(f.window.webContents.sent).includes("DO_NOT_EXPOSE"));
});

test("REL-013: provider diagnostics do not leak subframe URLs or error descriptions", async () => {
  const f = await shellFixture();
  const view = f.views[0].webContents;
  const before = f.window.webContents.sent.length;
  view.emit("did-fail-load", {}, -105, "PRIVATE ERROR",
    "https://other.example.test/SECRET", false);
  assert.equal(f.window.webContents.sent.length, before);
});
