import { saveSessionMessages } from "./session-db.js";

const PROVIDER_HOSTS = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
};

const MAX_MESSAGES = 100;
const MAX_USER_PREVIEW = 500;
const MAX_ASSISTANT_PREVIEW = 800;
const WORKING_PERSIST_INTERVAL_MS = 10000;

function compactPreview(value, maxLength) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? text.slice(0, maxLength - 1) + "…" : text;
}

function providerFromUrl(url) {
  try {
    return PROVIDER_HOSTS[new URL(url).hostname] || null;
  } catch {
    return null;
  }
}

function isNewChatRoute(provider, url) {
  try {
    const path = new URL(url).pathname.replace(/\/+$/, "") || "/";
    if (provider === "chatgpt") return path === "/";
    if (provider === "claude") return path === "/" || path === "/new";
    if (provider === "gemini") return path === "/" || path === "/app";
    return false;
  } catch {
    return false;
  }
}

function sessionId(provider, url, tabId) {
  try {
    const parsed = new URL(url);
    if (tabId !== undefined && isNewChatRoute(provider, url)) return provider + ":draft:" + tabId;
    return provider + ":" + parsed.host + (parsed.pathname.replace(/\/$/, "") || "/");
  } catch {
    return provider + ":" + url;
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return [];
  const normalized = [];
  for (const message of messages) {
    if (!message || (message.role !== "user" && message.role !== "assistant")) continue;
    const text = String(message.text || "").trim();
    if (!text) continue;
    normalized.push({
      id: String(message.id || (normalized.length + 1)),
      role: message.role,
      text: text.slice(0, 15000),
      observedAt: Number(message.observedAt || Date.now()),
    });
  }
  return normalized.slice(-MAX_MESSAGES);
}

async function readRegistry() {
  const result = await chrome.storage.local.get("sessionRegistry");
  return result.sessionRegistry || {};
}

async function writeRegistry(registry) {
  await chrome.storage.local.set({ sessionRegistry: registry });
}

async function injectBridge(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {}
}

async function syncOpenTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url || !providerFromUrl(tab.url)) continue;
    await injectBridge(tab.id);
  }
}

async function upsertTab(tab, patch = {}) {
  if (tab?.id === undefined || !tab.url) return;

  const provider = providerFromUrl(tab.url);
  if (!provider) return;

  const id = sessionId(provider, tab.url, tab.id);
  const registry = await readRegistry();

  // A draft ID is only a temporary identity for a blank new-chat route.
  // Once the provider creates a real conversation URL, drop the old alias
  // for that same tab so it doesn't linger as a duplicate closed session.
  if (!id.includes(":draft:")) {
    for (const [existingId, existing] of Object.entries(registry)) {
      if (existingId.startsWith(provider + ":draft:") && existing.tabId === tab.id && existingId !== id) {
        delete registry[existingId];
      }
    }
  }

  const previous = registry[id] || {};

  registry[id] = {
    id,
    provider,
    title: patch.title || tab.title || previous.title || "Untitled conversation",
    url: patch.url || tab.url,
    tabId: tab.discarded ? null : tab.id,
    windowId: tab.discarded ? null : tab.windowId,
    status: patch.status || previous.status || "idle",
    lifecycle: tab.discarded ? "discarded" : "open",
    discarded: Boolean(tab.discarded),
    lastSeen: patch.timestamp || Date.now(),
    lastActivityAt: patch.timestamp || previous.lastActivityAt || Date.now(),
    projectId: previous.projectId ?? null,
    pinned: previous.pinned ?? false,
    latestUser: compactPreview(patch.latestUser ?? previous.latestUser ?? "", MAX_USER_PREVIEW),
    latestAssistant: compactPreview(patch.latestAssistant ?? previous.latestAssistant ?? "", MAX_ASSISTANT_PREVIEW),
    snapshotAt: patch.timestamp ?? previous.snapshotAt,
  };

  await writeRegistry(registry);
}

async function configureAndSync() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await syncOpenTabs();
}

chrome.runtime.onInstalled.addListener(() => { void configureAndSync(); });
chrome.runtime.onStartup.addListener(() => { void syncOpenTabs(); });

chrome.tabs.onCreated.addListener((tab) => { void upsertTab(tab); });

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  const hasIdentityChange = changeInfo.url !== undefined || changeInfo.title !== undefined || changeInfo.discarded !== undefined;
  if (hasIdentityChange && (tab.url || changeInfo.url)) {
    void upsertTab({ ...tab, url: changeInfo.url || tab.url }, {});
  }
  if (changeInfo.status === "complete" && tab.url && providerFromUrl(tab.url)) void injectBridge(tabId);
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const registry = await readRegistry();
  let changed = false;

  for (const session of Object.values(registry)) {
    if (session.tabId === tabId) {
      session.tabId = null;
      session.windowId = null;
      session.lifecycle = "closed";
      session.discarded = false;
      session.lastSeen = Date.now();
      changed = true;
    }
  }

  if (changed) await writeRegistry(registry);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "ai-workspace:provider-state" || sender.tab?.id === undefined) return;

  void (async () => {
    const provider = providerFromUrl(message.url);
    if (!provider) return;

    const registry = await readRegistry();
    const id = sessionId(provider, message.url, sender.tab.id);
    const previous = registry[id] || {};
    const observedAt = message.timestamp || Date.now();
    const messages = normalizeMessages(message.messages);
    if (messages.length) await saveSessionMessages(id, messages);

    const currentState = {
      id,
      provider,
      title: message.title || previous.title || sender.tab.title || "Untitled conversation",
      url: message.url || previous.url || "",
      tabId: sender.tab.id,
      windowId: sender.tab.windowId ?? previous.windowId ?? null,
      status: message.status || previous.status || "idle",
      lifecycle: "open",
      discarded: false,
      lastSeen: observedAt,
      lastActivityAt: observedAt,
      projectId: previous.projectId ?? null,
      pinned: previous.pinned ?? false,
      latestUser: compactPreview(message.latestUser || previous.latestUser || "", MAX_USER_PREVIEW),
      latestAssistant: compactPreview(message.latestAssistant || previous.latestAssistant || "", MAX_ASSISTANT_PREVIEW),
      snapshotAt: observedAt,
    };

    // Streaming updates are sent live to the workspace, but don't rewrite the
    // entire registry on every token-like change. Persist a working heartbeat
    // at most once every 10 seconds; persist every status transition immediately.
    const workingHeartbeat = currentState.status === "working" &&
      previous.status === "working" &&
      observedAt - Number(previous.snapshotAt || 0) < WORKING_PERSIST_INTERVAL_MS;

    if (!workingHeartbeat) {
      registry[id] = currentState;
      await writeRegistry(registry);
    }

    try {
      await chrome.runtime.sendMessage({
        type: "ai-workspace:session-state",
        sessionId: id,
        status: currentState.status,
        title: currentState.title,
        latestUser: currentState.latestUser,
        latestAssistant: currentState.latestAssistant,
        observedAt,
      });
    } catch {}
  })();
});