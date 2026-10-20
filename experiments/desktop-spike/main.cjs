/**
 * EXPERIMENT ONLY. Electron shell with genuine isolated provider pages and
 * read-only local Claude Code / Codex session discovery.
 * No background sync, DOM scraping, injection into providers or agent execution.
 *
 * Limitations: provider login/OAuth/popup flows are NOT validated on Windows;
 * provider UI may block embedded web clients. No live terminal/resume support.
 */
const { app, BrowserWindow, WebContentsView, ipcMain, session } = require("electron");
const path = require("node:path");

const URLS = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/",
  gemini: "https://gemini.google.com/app",
});
const LAYOUTS = new Set(["single", "split", "agent"]);
const LEFT_RAIL = 270;
const TOP_BAR = 64;

let windowRef = null;
let layout = "agent";
const selected = { left: "chatgpt", right: "claude" };
const views = new Map();

function createProviderView(provider) {
  const existing = views.get(provider);
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
  view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  view.webContents.on("will-navigate", (event, url) => {
    try { if (new URL(url).protocol !== "https:") event.preventDefault(); }
    catch { event.preventDefault(); }
  });
  view.webContents.on("will-attach-webview", (event) => event.preventDefault());
  windowRef.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 0, height: 0 });
  views.set(provider, view);
  void view.webContents.loadURL(URLS[provider]).catch((error) => {
    // Failure is surfaced in the main-process console for this prototype.
    console.error("Provider page failed to load:", provider, error.message);
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

  const first = createProviderView(selected.left);
  if (layout === "single") {
    first.setBounds({ x: LEFT_RAIL, y: TOP_BAR, width: usableWidth, height: usableHeight });
  } else {
    const half = Math.floor(usableWidth / 2);
    first.setBounds({ x: LEFT_RAIL, y: TOP_BAR, width: half, height: usableHeight });
    if (layout === "split") {
      const second = createProviderView(selected.right);
      // Same-provider twin views would represent the SAME live page, not two
      // independently navigable conversations. Require two distinct providers.
      second.setBounds({ x: LEFT_RAIL + half, y: TOP_BAR,
        width: usableWidth - half, height: usableHeight });
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
  layoutViews();
}

app.whenReady().then(async () => {
  ipcMain.handle("spike:select-provider", async (event, provider, pane = "left") => {
    if (!ownsSender(event) || !Object.hasOwn(URLS, provider) || !["left", "right"].includes(pane))
      throw new Error("Invalid provider selection.");
    if (layout === "split" && selected[pane === "left" ? "right" : "left"] === provider)
      throw new Error("Choose two different providers for the split-view prototype.");
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

  ipcMain.handle("spike:list-agents", async (event) => {
    if (!ownsSender(event)) throw new Error("Unknown window.");
    const { discoverLocalAgents } = await import("../local-agent-probe/discover.mjs");
    return discoverLocalAgents({ limit: 100 });
  });

  await createWindow();
}).catch((error) => console.error("Desktop spike failed:", error));

app.on("window-all-closed", () => app.quit());
