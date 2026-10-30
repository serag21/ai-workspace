/**
 * EXPERIMENT ONLY. Electron shell with genuine isolated provider pages and
 * read-only local Claude Code / Codex session discovery.
 * No background sync, DOM scraping, injection into providers or agent execution.
 *
 * Limitations: provider login/OAuth/popup flows are NOT validated on Windows;
 * provider UI may block embedded web clients. No live terminal/resume support.
 */
const { app, BrowserWindow, WebContentsView, ipcMain, session, shell } = require("electron");
const path = require("node:path");
const { openAgentTerminal } = require("./agent-actions.cjs");
const { resolveCliOnPath } = require("./cli-provenance.cjs");
const { parseAgentTail, readTranscriptTail } = require("./agent-tail.cjs");
const { browserDestination } = require("./provider-navigation.cjs");

const URLS = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/",
  gemini: "https://gemini.google.com/app",
});
const LAYOUTS = new Set(["single", "split", "stack", "agent"]);
const LEFT_RAIL = 270;
const TOP_BAR = 64;

let windowRef = null;
let layout = "agent";
const selected = { left: "chatgpt", right: "claude" };
const views = new Map();

// G1 diagnostics are deliberately coarse: never transmit provider URLs,
// authentication codes, cookies, titles or page content to the app shell.
function reportProviderStatus(provider, pane, state, errorCode = null) {
  if (!windowRef || windowRef.isDestroyed()) return;
  windowRef.webContents.send("spike:provider-status", {
    provider, pane, state,
    errorCode: Number.isSafeInteger(errorCode) ? errorCode : null,
  });
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
  return Boolean(windowRef && !windowRef.isDestroyed() &&
    event.sender.id === windowRef.webContents.id);
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
      return [...byId.values()].sort((a,b)=>b.modifiedAt-a.modifiedAt).slice(0,100);
    } catch (error) {
      // An unavailable optional SDK does not break local session discovery.
      // Surface a warning in the developer console only, never private text.
      console.warn("Claude SDK unavailable; using bounded local metadata inventory:", error?.message);
      return fallbackInventory.slice(0,100);
    }
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

  await createWindow();
  if (process.argv.includes("--offline-smoke")) {
    process.stdout.write("AI_WORKSPACE_OFFLINE_SMOKE_OK\n");
    app.quit();
  }
}).catch((error) => console.error("Desktop spike failed:", error));

app.on("window-all-closed", () => app.quit());
