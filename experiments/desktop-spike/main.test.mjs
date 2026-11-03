import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { fileURLToPath } from "node:url";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
const requireNavigation = createRequire(import.meta.url)("./provider-navigation.cjs");
const requireTail = createRequire(import.meta.url)("./agent-tail.cjs");
const requireAcceptance = createRequire(import.meta.url)("./acceptance-report.cjs");

const DIR = path.dirname(fileURLToPath(import.meta.url));
const script = await readFile(path.join(DIR, "main.cjs"), "utf8");

/** Main-process unit test with a fake Electron implementation.
 * Never launches an actual provider or makes HTTP requests. */
async function shellFixture(options = {}) {
  const argv = options.argv || ["electron", "main.cjs"];
  const views = [];
  const partitions = [];
  const windows = [];
  const handlers = new Map();
  const dialog = {
    calls: [],
    showErrorBox(title, message) { dialog.calls.push(String(title) + "\n" + String(message)); },
  };
  // Memory-backed file fakes: the report writer and the startup-failure log
  // are tested without touching the owner's real filesystem.
  const memory = { files: new Map(), logLines: [] };
  const osFake = {
    tmpdir: () => "C:\\fake-tmp",
    release: () => "10.0.fake-release",
    homedir: () => "C:\\fake-home",
  };
  const fsFake = {
    readFileSync(file) {
      if (path.basename(file).toLowerCase() === "build-info.json") {
        if (!options.buildInfo) {
          const error = new Error("ENOENT (fake) build-info.json");
          error.code = "ENOENT";
          throw error;
        }
        return JSON.stringify(options.buildInfo);
      }
      const error = new Error("ENOENT (fake) " + path.basename(file));
      error.code = "ENOENT";
      throw error;
    },
    appendFileSync(file, text) { memory.logLines.push({ file: String(file), text: String(text) }); },
    mkdirSync() { /* fake */ },
  };
  const fspFake = {
    async mkdir() { /* fake */ },
    async writeFile(file, data) { memory.files.set(String(file), String(data)); },
    async readFile(file) {
      const hit = memory.files.get(String(file));
      if (hit === undefined) {
        const error = new Error("ENOENT (fake) " + path.basename(String(file)));
        error.code = "ENOENT";
        throw error;
      }
      return hit;
    },
    async rm(file) { memory.files.delete(String(file)); },
  };
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
    executeJavaScript(expression, _gesture) {
      // The smoke verify checks only that the acceptance bridge functions
      // exist; the fake asserts the probe was aimed at that contract.
      if (typeof expression === "string" &&
          expression.includes("saveAcceptanceReport") &&
          expression.includes("acceptanceItems") &&
          expression.includes("buildInfo")) return Promise.resolve(true);
      // Smoke verify round trip: the fake answers the owner build-info
      // channel with the same honest fallback (no fake commit invented).
      if (expression === "window.aiWorkspace.buildInfo()") {
        return Promise.resolve({
          buildCommit: options.buildInfo &&
            typeof options.buildInfo.buildCommit === "string"
            ? options.buildInfo.buildCommit : null,
          appVersion: null,
          builtAt: null,
          channel: "unverified-preview",
        });
      }
      return Promise.resolve(false);
    }
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
    constructor(windowOptions = {}) {
      super();
      if (options.failWindow) throw new Error("Simulated window failure (fake)");
      this.options = windowOptions;
      this.webContents = new FakeWebContents();
      this.contentView = { addChildView: view => {
        assert.ok(views.includes(view));
        this.children.push(view);
      } };
      this.children = [];
      this.width = windowOptions.width;
      this.height = windowOptions.height;
      windows.push(this);
    }
    getContentSize() { return [this.width, this.height]; }
    isDestroyed() { return this.closed; }
    async loadFile(file) { this.file = file; }
    close() { this.closed = true; }
  }

  const app = new EventEmitter();
  app.whenReady = async () => {};
  app.quit = () => { app.quitCalled = true; };
  app.exit = (code) => { app.lastExit = code; };
  app.getPath = (name) => path.join("C:\\fake-home", "AppData", "Local", String(name));
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
  const mockElectron = { app, BrowserWindow: FakeWindow, WebContentsView: FakeView, ipcMain, session, shell, dialog };
  const stdout = [];
  const sandbox = {
    require(id) {
      if (id === "electron") return mockElectron;
      if (id === "node:path") return path;
      if (id === "node:os") return osFake;
      if (id === "node:fs") return fsFake;
      if (id === "node:fs/promises") return fspFake;
      if (id === "./acceptance-report.cjs") return requireAcceptance;
      if (id === "./agent-actions.cjs") return { openAgentTerminal: async () => { throw Error("Fake must never start a real agent."); } };
      if (id === "./cli-provenance.cjs") return { resolveCliOnPath: async (program) => program === "claude" ? "C:\\bin\\claude.cmd" : null };
      if (id === "./provider-navigation.cjs") return requireNavigation;
      if (id === "./agent-tail.cjs") return requireTail;
      throw Error("Unexpected native module: " + id);
    },
    __dirname: DIR,
    URL,
    console,
    process: {
      argv,
      stdout: {
        // Mirrors Node stream semantics: the write callback reports
        // completion, which main.cjs awaits before app.exit().
        write(text, callback) {
          stdout.push(String(text));
          if (typeof callback === "function") callback();
        },
      },
      versions: { electron: "44.9.3" },
      platform: "win32",
    },
  };
  vm.runInNewContext(script, sandbox, { filename: "main.cjs" });
  for (let i = 0; i < 30; i++) {
    const settled = options.failWindow
      ? app.lastExit !== undefined
      : windows.length > 0;
    if (settled) break;
    await new Promise(resolve => setImmediate(resolve));
  }
  if (!options.failWindow) {
    assert.equal(windows.length, 1, "desktop shell bootstrapped one window");
  }
  const window = windows[0];
  return {
    views, partitions, windows, handlers, window,
    sender: { sender: { id: window ? window.webContents.id : -1 } },
    otherSender: { sender: { id: -99 } },
    app, openedExternal, dialog, memory, argv,
    stdoutText: () => stdout.join(""),
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

test("AGENT-002: CLI provenance IPC is owner-window-only and read-only", async () => {
  const f = await shellFixture();
  const result = await f.handlers.get("spike:cli-provenance")(f.sender);
  assert.equal(result["claude-code"], "C:\\bin\\claude.cmd");
  assert.equal(result["codex"], null);
  assert.ok(!/sync|history|prompt/i.test("spike:cli-provenance"),
    "A provenance channel must not imply background provider work.");
  await assert.rejects(f.handlers.get("spike:cli-provenance")(f.otherSender), /Unknown window/);
});

test("AGENT-004 CON-017: transcript tail IPC is owner-window-only and validates arguments", async () => {
  const f = await shellFixture();
  assert.ok(f.handlers.has("spike:agent-tail"), "the read-only tail channel must be installed");
  await assert.rejects(
    f.handlers.get("spike:agent-tail")(f.otherSender, "claude-code", "11111111-1111-4111-8111-111111111111"),
    /Unknown window/,
    "a provider webpage must not be able to read local session transcripts");
  await assert.rejects(
    f.handlers.get("spike:agent-tail")(f.sender, "claude-code"),
    /Invalid session selection/);
  await assert.rejects(
    f.handlers.get("spike:agent-tail")(f.sender, "evil", {}),
    /Invalid session selection/);
  assert.ok(!/sync|history|prompt/i.test("spike:agent-tail"),
    "the tail channel must not imply background provider work or prompt sending.");
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

test("CON-017 TRUST-005: owner-only acceptance report save is validated, redacted and local only", async () => {
  const f = await shellFixture();
  const save = f.handlers.get("spike:save-acceptance-report");
  assert.ok(save, "the local report save channel must be installed");
  await assert.rejects(
    save(f.otherSender, [{ id: "app-launches", result: "pass" }]),
    /Unknown window/,
    "a provider webpage must not be able to write acceptance reports");
  await assert.rejects(save(f.sender, "pass"), /check result/);
  await assert.rejects(
    save(f.sender, [{ id: "root-canary", result: "pass" }]),
    /Unknown acceptance check id/);
  const note = "popup denied; see https://accounts.example.test/oauth2/callback?code=LEAKCANARY&state=abc" +
    " ask owner@example.test token AAAA-BBBB-CCCC-DDDD-EEEE-FFFF-GGGG-HHHH";
  const saved = await save(f.sender, [
    { id: "app-launches", result: "pass" },
    { id: "chatgpt-signin", result: "blocked", note },
  ]);
  assert.ok(saved.markdownPath.endsWith(".md"));
  assert.ok(saved.jsonPath.endsWith(".json"));
  assert.ok(saved.summary.startsWith("AI Workspace acceptance"),
    "the returned summary must be copy-pasteable");
  const markdown = f.memory.files.get(saved.markdownPath);
  const json = f.memory.files.get(saved.jsonPath);
  assert.ok(markdown.includes("AI Workspace — owner acceptance report"));
  assert.ok(!markdown.includes("LEAKCANARY"), "OAuth callback values must not reach the saved report");
  assert.ok(!markdown.includes("owner@example.test"), "e-mail addresses must not reach the saved report");
  assert.match(markdown, /\[link removed\]/);
  assert.match(markdown, /\[address removed\]/);
  assert.match(markdown, /\[opaque value removed\]/);
  assert.match(markdown, /1 pass · 0 fail · 1 blocked · 17 not tested/);
  const parsed = JSON.parse(json);
  assert.equal(parsed.schema, "ai-workspace.acceptance/1");
  assert.equal(parsed.environment.commit, null,
    "a source-tree build must report no commit, not a fake one");
});

test("TRUST-006 CON-017: in-app checklist and build identity are served owner-window-only", async () => {
  const f = await shellFixture();
  const items = await f.handlers.get("spike:acceptance-items")(f.sender);
  assert.ok(items.length >= 15, "the owner checklist must stay substantial");
  assert.equal(items[0].id, "app-launches");
  for (const item of items) {
    assert.match(item.id, /^[a-z0-9-]+$/);
    assert.ok(item.label.length >= 4 && item.check.length >= 20,
      "each item needs a label and a plain-language step: " + item.id);
  }
  await assert.rejects(f.handlers.get("spike:acceptance-items")(f.otherSender), /Unknown window/);
  const info = await f.handlers.get("spike:build-info")(f.sender);
  assert.equal(info.buildCommit, null, "missing build-info must fall back honestly");
  assert.equal(info.channel, "unverified-preview");
  await assert.rejects(f.handlers.get("spike:build-info")(f.otherSender), /Unknown window/);
});

test("REL-013 CON-017: startup failure is reported honestly, logged privately and exits non-zero", async () => {
  const f = await shellFixture({ failWindow: true });
  assert.equal(f.windows.length, 0, "no window may be reported on failure");
  assert.equal(f.app.lastExit, 1, "the app must exit with a failure code");
  assert.equal(f.dialog.calls.length, 1, "an honest native dialog must be shown");
  assert.match(f.dialog.calls[0], /could not start/i);
  const logLine = f.memory.logLines[0];
  assert.ok(logLine, "a private startup-failure log must be recorded");
  assert.match(logLine.file, /startup-failure\.log$/);
  assert.match(logLine.text, /Simulated window failure \(fake\)/);
  assert.equal(f.memory.files.size, 0, "no report files may appear before a valid save");
});

test("CON-017 TRUST-005: smoke verify passes offline with embedded build identity and leaves no report behind", async () => {
  const buildCommit = "11111112222233333333444444444455555566aa";
  const f = await shellFixture({
    argv: ["electron", "main.cjs", "--smoke-verify"],
    buildInfo: { version: "0.1.0", buildCommit, builtAt: "2026-11-03T00:00:00.000Z", channel: "unverified-preview" },
  });
  assert.equal(f.app.lastExit, 0, "smoke verify must exit successfully");
  assert.ok(f.stdoutText().includes(
    "AI_WORKSPACE_SMOKE_VERIFY_OK buildCommit=" + buildCommit),
    "the running build must report its exact embedded commit");
  assert.equal(f.windows.length, 1, "only the local UI probe window may open");
  assert.equal(f.views.length, 0, "smoke verify must not load provider pages");
  assert.equal(f.openedExternal.length, 0, "smoke verify must not open external browser");
  assert.equal(f.memory.files.size, 0, "smoke verify must clean up its temporary reports");
});

test("CON-017: smoke verify without embedded identity still passes and claims no commit", async () => {
  const f = await shellFixture({ argv: ["electron", "main.cjs", "--smoke-verify"] });
  assert.equal(f.app.lastExit, 0);
  assert.match(f.stdoutText(), /AI_WORKSPACE_SMOKE_VERIFY_OK/);
  assert.ok(!f.stdoutText().includes("buildCommit="),
    "no commit must be claimed when none was embedded");
});

test("CON-017: smoke verify's probe window is an owner-window, a foreign sender still is not", async () => {
  const f = await shellFixture({ argv: ["electron", "main.cjs", "--smoke-verify"] });
  // f.window is the probe window (smoke verify opens exactly one).
  const info = await f.handlers.get("spike:build-info")(f.sender);
  assert.equal(info.buildCommit, null, "a source-tree build must report no commit, not a fake one");
  const items = await f.handlers.get("spike:acceptance-items")(f.sender);
  assert.ok(items.length >= 15, "the probe window may read the shared checklist");
  await assert.rejects(f.handlers.get("spike:build-info")(f.otherSender), /Unknown window/);
  await assert.rejects(f.handlers.get("spike:acceptance-items")(f.otherSender), /Unknown window/);
  await assert.rejects(
    f.handlers.get("spike:save-acceptance-report")(f.otherSender, [{ id: "app-launches", result: "pass" }]),
    /Unknown window/,
    "a foreign page must never write reports even in smoke-verify mode");
});
