/**
 * EXPERIMENT ONLY. Electron shell with genuine isolated provider pages and
 * read-only local Claude Code / Codex session discovery.
 * No background sync, DOM scraping, injection into providers or agent execution.
 *
 * Limitations: provider login/OAuth/popup flows are NOT validated on Windows;
 * provider UI may block embedded web clients. No live terminal/resume support.
 */
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell, dialog } = require("electron");
const path = require("node:path");
const os = require("node:os");
const fsp = require("node:fs/promises");
const { readFileSync, appendFileSync, mkdirSync } = require("node:fs");
const { openAgentTerminal } = require("./agent-actions.cjs");
const { resolveCliOnPath } = require("./cli-provenance.cjs");
const { parseAgentTail, readTranscriptTail } = require("./agent-tail.cjs");
const { browserDestination } = require("./provider-navigation.cjs");
const {
  ACCEPTANCE_SCHEMA,
  ACCEPTANCE_ITEMS,
  buildAcceptanceReport,
} = require("./acceptance-report.cjs");

const URLS = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/",
  gemini: "https://gemini.google.com/app",
});
const LAYOUTS = new Set(["single", "split", "stack", "agent"]);
const LEFT_RAIL = 270;
const TOP_BAR = 64;

let windowRef = null;
// AW-009: the hidden smoke-verify probe is the only other first-party window.
// ownsSender() accepts its bridge calls so the real page's on-load invokes
// succeed in --smoke-verify mode instead of being rejected as foreign.
let acceptanceProbeWindow = null;
let layout = "agent";
const selected = { left: "chatgpt", right: "claude" };
const views = new Map();

// Build identity: written to build-info.json by build-assets.cjs at package
// time (commit + version + builtAt). When it is missing the app says "not
// embedded" instead of inventing one.
function loadBuildInfo() {
  try {
    const raw = JSON.parse(readFileSync(path.join(__dirname, "build-info.json"), "utf8"));
    return {
      buildCommit: typeof raw.buildCommit === "string" && /^[a-f0-9]{7,64}$/i.test(raw.buildCommit)
        ? raw.buildCommit : null,
      appVersion: typeof raw.version === "string" ? raw.version.slice(0, 60) : null,
      builtAt: typeof raw.builtAt === "string" ? raw.builtAt.slice(0, 40) : null,
      channel: typeof raw.channel === "string" ? raw.channel.slice(0, 40) : "unverified-preview",
    };
  } catch {
    return { buildCommit: null, appVersion: null, builtAt: null, channel: "unverified-preview" };
  }
}

// G1 diagnostics are deliberately coarse: never transmit provider URLs,
// authentication codes, cookies, titles or page content to the app shell.
// The main process also keeps the latest state per pane so the owner
// acceptance report can include it — states only, never URLs or codes' text.
const providerStatusLog = new Map();
let lastInventory = null;
let lastCliProbe = null;

function reportProviderStatus(provider, pane, state, errorCode = null) {
  const cleanCode = Number.isSafeInteger(errorCode) ? errorCode : null;
  providerStatusLog.set(provider + ":" + pane, { state, errorCode: cleanCode });
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send("spike:provider-status", {
    provider, pane, state,
    errorCode: cleanCode,
  });
}

// Diagnostics for the owner acceptance report: pane state words, numeric
// network codes and session counts only. No paths, ids, titles or text.
function collectDiagnostics() {
  const diagnostics = {};
  if (providerStatusLog.size) {
    diagnostics.providerStatus = Object.fromEntries(
      [...providerStatusLog.entries()].map(([key, value]) => [key, {
        state: value.state,
        errorCode: value.errorCode === null ? null : Number(value.errorCode),
      }]));
  }
  if (Array.isArray(lastInventory) && lastInventory.length) {
    const counts = {};
    for (const item of lastInventory) {
      if (item && typeof item.provider === "string" && item.provider) {
        counts[item.provider] = (counts[item.provider] || 0) + 1;
      }
    }
    if (Object.keys(counts).length) diagnostics.sessionCounts = counts;
  }
  if (lastCliProbe && typeof lastCliProbe === "object") {
    diagnostics.cliAvailability = Object.fromEntries(
      Object.entries(lastCliProbe).map(([key, value]) => [key, Boolean(value)]));
  }
  return diagnostics;
}

function acceptanceEnvironment(info) {
  const environment = {
    commit: info.buildCommit,
    appVersion: info.appVersion,
    electron: (process.versions && process.versions.electron) || null,
    platform: process.platform || null,
    osRelease: typeof os.release === "function" ? os.release() : null,
  };
  for (const key of Object.keys(environment)) {
    if (environment[key] === null) delete environment[key];
  }
  return environment;
}

function createProviderView(provider, pane = "left") {
  const viewKey = pane + ":" + provider;
  const existing = views.get(viewKey);
  if (existing) return existing;

  // These persistent partitions are isolated from each other AND from the
  // user's Chrome profile. NEVER import or read the Chrome cookie database.
  const partition = "persist:ai-workspace-spike-" + provider;
  const isolated = session.fromPartition(partition);
  isolated.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));

  const view = new WebContentsView({
    webPreferences: {
      session: isolated,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  // Popups remain denied until genuine Windows authentication compatibility
  // is established. Show the limitation rather than silently failing login.
  let failedLoad = false;
  let popupBlocked = false;
  view.webContents.setWindowOpenHandler(() => {
    popupBlocked = true;
    reportProviderStatus(provider, pane, "popup-blocked");
    return { action: "deny" };
  });
  view.webContents.on("did-start-loading", () => {
    failedLoad = false;
    popupBlocked = false;
    reportProviderStatus(provider, pane, "loading");
  });
  view.webContents.on("did-fail-load", (_event, errorCode, _description, _url, isMainFrame) => {
    // ERR_ABORTED (-3) is a normal redirect/navigation cancellation, not
    // evidence that provider login failed. Ignore subframe failures as well.
    if (errorCode === -3 || isMainFrame === false) return;
    failedLoad = true;
    reportProviderStatus(provider, pane, "load-failed", errorCode);
  });
  view.webContents.on("did-finish-load", () => {
    if (!failedLoad && !popupBlocked) reportProviderStatus(provider, pane, "page-loaded");
  });
  view.webContents.on("will-navigate", (event, url) => {
    try { if (new URL(url).protocol !== "https:") event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  view.webContents.on("will-attach-webview", (event) => event.preventDefault());
  windowRef.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  views.set(viewKey, view);
  void view.webContents.loadURL(URLS[provider]).catch((error) => {
    // Failure is surfaced in the main-process console for this prototype.
    console.error("Provider page failed to load:", provider, error?.code || "unknown");
    failedLoad = true;
    reportProviderStatus(provider, pane, "load-failed");
  });
  return view;
}

function layoutViews() {
  if (!windowRef || windowRef.isDestroyed()) return;
  const [width, height] = windowRef.getContentSize();
  const usableWidth = Math.max(0, width - LEFT_RAIL);
  const usableHeight = Math.max(0, height - TOP_BAR);
  for (const view of views.values()) {
    view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  }

  const first = createProviderView(selected.left, "left");
  if (layout === "single") {
    first.setBounds({ x: LEFT_RAIL, y: TOP_BAR, width: usableWidth, height: usableHeight });
  } else {
    const half = Math.floor(usableWidth / 2);
    first.setBounds({ x: LEFT_RAIL, y: TOP_BAR, width: half, height: usableHeight });
    if (layout === "split" || layout === "stack") {
      // Separate WebContents instances allow two DIFFERENT chats from the
      // SAME provider to be visible at once, while sharing that provider's
      // isolated login partition. They are not iframe or transcript clones.
      const second = createProviderView(selected.right, "right");
      if (layout === "split") {
        second.setBounds({ x: LEFT_RAIL + half, y: TOP_BAR,
          width: usableWidth - half, height: usableHeight });
      } else {
        const halfHeight = Math.floor(usableHeight / 2);
        first.setBounds({ x: LEFT_RAIL, y: TOP_BAR,
          width: usableWidth, height: halfHeight });
        second.setBounds({ x: LEFT_RAIL, y: TOP_BAR + halfHeight,
          width: usableWidth, height: usableHeight - halfHeight });
      }
    }
    // "agent" mode: right side stays visible as the app's read-only agent pane.
  }
}

function ownsSender(event) {
  const sender = event && event.sender;
  if (!sender) return false;
  if (windowRef && !windowRef.isDestroyed() &&
    sender.id === windowRef.webContents.id) return true;
  return Boolean(acceptanceProbeWindow &&
    !acceptanceProbeWindow.isDestroyed() &&
    sender.id === acceptanceProbeWindow.webContents.id);
}

async function createWindow() {
  windowRef = new BrowserWindow({
    width: 1500,
    height: 900,
    minWidth: 880,
    minHeight: 540,
    title: "AI Workspace · Desktop feasibility spike",
    backgroundColor: "#0d1018",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });
  windowRef.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  windowRef.on("resize", layoutViews);
  windowRef.on("closed", () => {
    for (const view of views.values()) {
      if (!view.webContents.isDestroyed()) view.webContents.close();
    }
    views.clear();
    windowRef = null;
  });

  await windowRef.loadFile(path.join(__dirname, "index.html"));
  // Offline smoke validates startup/packaging without connecting to provider accounts.
  if (!process.argv.includes("--offline-smoke")) layoutViews();
}

async function readLocalAgents() {
    const { discoverLocalAgents } = await import("./agent-discovery/discover.mjs");
    const fallbackInventory = await discoverLocalAgents({ limit: 150 });
    // Prefer official SDK transcript metadata when the optional SDK is present.
    // Neither this nor the fallback executes agents or sends any prompts.
    try {
      const { loadClaudeSessionSdk, listClaudeSessionsReadOnly } =
        await import("./agent-discovery/claude-sdk-adapter.mjs");
      const sdk = await loadClaudeSessionSdk();
      const claudeSessions = await listClaudeSessionsReadOnly({ sdk, limit: 150 });
      const byId = new Map(fallbackInventory.map((item) => [item.id, item]));
      for (const item of claudeSessions) {
        const prior = byId.get(item.id);
        // Official SDK is authoritative for display title/branch when it
        // identifies the same local transcript. Preserve file path for backup.
        byId.set(item.id, { ...prior, ...item, file: prior?.file ?? null });
      }
      const inventory = [...byId.values()].sort((a,b)=>b.modifiedAt-a.modifiedAt).slice(0,100);
      lastInventory = inventory;
      return inventory;
    } catch (error) {
      // An unavailable optional SDK does not break local session discovery.
      // Surface a warning in the developer console only, never private text.
      console.warn("Claude SDK unavailable; using bounded local metadata inventory:", error?.message);
      lastInventory = fallbackInventory.slice(0,100);
      return lastInventory;
    }
}

// Save the owner acceptance report: validate + redact first (throws before
// any write), then write both artifacts to the Downloads folder. No dialog,
// no upload, no telemetry — the owner copies the files back manually.
async function saveAcceptanceReport(results) {
  const info = loadBuildInfo();
  const built = buildAcceptanceReport({
    schema: ACCEPTANCE_SCHEMA,
    results,
    environment: acceptanceEnvironment(info),
    diagnostics: collectDiagnostics(),
    generatedAt: new Date().toISOString(),
  });
  const directory = app.getPath("downloads");
  await fsp.mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = path.join(directory, "AI-Workspace-acceptance-" + stamp);
  const markdownPath = base + ".md";
  const jsonPath = base + ".json";
  await fsp.writeFile(markdownPath, built.markdown, "utf8");
  await fsp.writeFile(jsonPath, built.json, "utf8");
  return { markdownPath, jsonPath, summary: built.summary };
}

// Offline, no provider traffic: proves the packaged preload bridge, the
// in-app report builder and the redaction contract on a real build.
async function runSmokeVerify() {
  let probeWindow = null;
  try {
    const info = loadBuildInfo();
    probeWindow = new BrowserWindow({
      width: 640,
      height: 480,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
      },
    });
    // First-party owner for the page's on-load bridge calls (see ownsSender).
    // The window stays open until the OK marker is flushed; closing it first
    // would fire window-all-closed and race app.quit() against this work.
    acceptanceProbeWindow = probeWindow;
    await probeWindow.loadFile(path.join(__dirname, "index.html"));
    const bridge = await probeWindow.webContents.executeJavaScript(
      "typeof window.aiWorkspace === 'object' && " +
      "typeof window.aiWorkspace.buildInfo === 'function' && " +
      "typeof window.aiWorkspace.acceptanceItems === 'function' && " +
      "typeof window.aiWorkspace.saveAcceptanceReport === 'function'",
      false,
    );
    if (bridge !== true) throw new Error("acceptance bridge missing from preload");

    // Full round trip through the guarded main-side handler: the real page's
    // bridge must actually deliver to the owner-only channel, not merely
    // expose a function surface.
    const roundTrip = await probeWindow.webContents.executeJavaScript(
      "window.aiWorkspace.buildInfo()", false,
    );
    if (roundTrip === null || typeof roundTrip !== "object") {
      throw new Error("acceptance bridge round trip failed");
    }

    // Canary redaction proof inside the real module: a token-shaped value
    // the owner might paste must never survive into the rendered report.
    const canary = "SMOKE_SECRET_AAAA-BBBB-CCCC-DDDD";
    const redacted = buildAcceptanceReport({
      schema: ACCEPTANCE_SCHEMA,
      results: [{ id: "attachments", result: "blocked", note: "canary token " + canary }],
      environment: acceptanceEnvironment(info),
      generatedAt: new Date().toISOString(),
    });
    if (redacted.markdown.includes(canary) || redacted.json.includes(canary)) {
      throw new Error("redaction contract broken in smoke verify");
    }

    // File round-trip, then clean up (no leftover artifacts after verify).
    const saved = await saveAcceptanceReport([{ id: "app-launches", result: "pass" }]);
    if ((await fsp.readFile(saved.markdownPath, "utf8")).length === 0) {
      throw new Error("markdown report empty after save");
    }
    await fsp.rm(saved.markdownPath, { force: true });
    await fsp.rm(saved.jsonPath, { force: true });

    const suffix = info.buildCommit ? " buildCommit=" + info.buildCommit : "";
    // Only exit after the marker write has been flushed: on Windows the
    // stdout pipe is asynchronous, and app.exit() would kill the process
    // before a pending write reaches the CI shell.
    await new Promise((resolve, reject) => {
      process.stdout.write("AI_WORKSPACE_SMOKE_VERIFY_OK" + suffix + "\n",
        (error) => (error ? reject(error) : resolve()));
    });
    app.exit(0);
  } catch (error) {
    acceptanceProbeWindow = null;
    try { if (probeWindow && !probeWindow.isDestroyed()) probeWindow.close(); }
    catch { /* best effort */ }
    try {
      console.error("Smoke verify failed:",
        error && typeof error.message === "string" ? error.message : String(error));
    } catch { /* best effort */ }
    app.exit(1);
  }
}

// Honest startup failure: a native error dialog plus a private log next to
// the app data — no silent blank window and no invented diagnostics.
function reportStartupFailure(error) {
  const message = (error && typeof error.message === "string" ? error.message : String(error))
    .slice(0, 300);
  try { console.error("Desktop spike failed to start:", message); } catch { /* best effort */ }
  try {
    const dir = path.join(os.homedir(), "AppData", "Roaming", "AI Workspace Preview");
    mkdirSync(dir, { recursive: true });
    appendFileSync(path.join(dir, "startup-failure.log"),
      new Date().toISOString() + " " + message + "\n");
  } catch { /* best effort only */ }
  try {
    dialog.showErrorBox("AI Workspace Preview could not start",
      "The desktop preview exited before its window opened.\nDetails: " + message +
      "\nA private log was recorded as startup-failure.log in your app data folder.");
  } catch { /* no dialog surface in a bare test harness */ }
  app.exit(1);
}

app.whenReady().then(async () => {
  ipcMain.handle("spike:select-provider", async (event, provider, pane = "left") => {
    if (!ownsSender(event) || !Object.hasOwn(URLS, provider) || !["left", "right"].includes(pane))
      throw new Error("Invalid provider selection.");
    selected[pane] = provider;
    layoutViews();
    return { provider, pane };
  });

  ipcMain.handle("spike:set-layout", (event, next) => {
    if (!ownsSender(event) || !LAYOUTS.has(next)) throw new Error("Invalid layout.");
    layout = next;
    layoutViews();
    return layout;
  });

  ipcMain.handle("spike:open-native-browser", async (event, pane = "left") => {
    if (!ownsSender(event) || !["left", "right"].includes(pane))
      throw new Error("Unrecognized pane.");
    const provider = selected[pane];
    const view = views.get(pane + ":" + provider);
    // Preserve only explicitly recognized conversation routes. Never pass an
    // OAuth/login path, arbitrary same-origin path, query, or fragment to the
    // external browser. An unsupported route falls back to provider home.
    const destination = browserDestination(provider, view?.webContents.getURL());
    await shell.openExternal(destination.url);
    return { opened: true, provider, preservedConversation: destination.preservedConversation };
  });

  ipcMain.handle("spike:list-agents", async (event) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    return readLocalAgents();
  });

  // Read-only installed-CLI provenance for honest UI state before any resume.
  // stat-on-PATH only: never executes a CLI, sends no prompt, no network.
  ipcMain.handle("spike:cli-provenance", async (event) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    const [claude, codex] = await Promise.all([
      resolveCliOnPath("claude"),
      resolveCliOnPath("codex"),
    ]);
    // Report only booleans into the acceptance diagnostics; the resolved
    // path stays in the UI-side result only and never enters a report.
    lastCliProbe = { "claude-code": Boolean(claude), codex: Boolean(codex) };
    return { platform: process.platform, "claude-code": claude, codex };
  });

  // Bounded read-only tail of a local agent transcript. The transcript PATH
  // always comes from the main-side local inventory, never from the renderer,
  // so a provider page cannot read arbitrary local files through this channel.
  ipcMain.handle("spike:agent-tail", async (event, provider, sessionId) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    if (typeof provider !== "string" || typeof sessionId !== "string")
      throw new Error("Invalid session selection.");
    const sessions = await readLocalAgents();
    const chosen = sessions.find(item => item.provider === provider && item.sessionId === sessionId);
    if (!chosen) throw new Error("Session not found in the local inventory.");
    if (typeof chosen.file !== "string" || !/\.jsonl$/i.test(chosen.file))
      throw new Error("No local transcript file recorded for this session.");
    const tail = await readTranscriptTail(chosen.file);
    const parsed = parseAgentTail(tail.text, chosen.provider);
    return {
      source: "local-transcript-tail",
      provider: chosen.provider,
      sessionId: chosen.sessionId,
      transcriptFile: chosen.file,
      transcriptBytes: tail.size,
      windowLimited: tail.windowLimited,
      ...parsed,
    };
  });

  ipcMain.handle("spike:resume-agent", async (event, provider, sessionId) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    if (typeof provider !== "string" || typeof sessionId !== "string")
      throw new Error("Invalid session selection.");
    // Never accept a renderer-supplied executable or working directory.
    const sessions = await readLocalAgents();
    const chosen = sessions.find(item => item.provider === provider &&
      item.sessionId === sessionId && item.cwd);
    if (!chosen) throw new Error("Session unavailable or without a verified local project folder.");
    return openAgentTerminal(chosen);
  });

  // AW-009: owner acceptance surface. The checklist is the single source of
  // truth in acceptance-report.cjs; the report is validated and redacted in
  // the main process before anything touches disk.
  ipcMain.handle("spike:build-info", async (event) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    return loadBuildInfo();
  });

  ipcMain.handle("spike:acceptance-items", async (event) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    return ACCEPTANCE_ITEMS;
  });

  ipcMain.handle("spike:save-acceptance-report", async (event, results) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    if (!Array.isArray(results) || !results.length) {
      throw new TypeError("At least one check result is required.");
    }
    return saveAcceptanceReport(results);
  });

  if (process.argv.includes("--smoke-verify")) {
    // No provider window: the hidden probe window loads only the local UI.
    void runSmokeVerify();
    return;
  }

  await createWindow();
  if (process.argv.includes("--offline-smoke")) {
    process.stdout.write("AI_WORKSPACE_OFFLINE_SMOKE_OK\n");
    app.quit();
  }
}).catch(reportStartupFailure);

app.on("window-all-closed", () => app.quit());
