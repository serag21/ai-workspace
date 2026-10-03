const PROVIDER_HOSTS = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
};

const MAX_MESSAGES = 100;

function providerFromUrl(url) {
  try {
    return PROVIDER_HOSTS[new URL(url).hostname] || null;
  } catch {
    return null;
  }
}

function sessionId(provider, url) {
  try {
    const parsed = new URL(url);
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
      text: text.slice(0, 30000),
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

  const id = sessionId(provider, tab.url);
  const registry = await readRegistry();
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
    latestUser: patch.latestUser ?? previous.latestUser ?? "",
    latestAssistant: patch.latestAssistant ?? previous.latestAssistant ?? "",
    snapshotAt: patch.timestamp ?? previous.snapshotAt,
    messages: patch.messages ? normalizeMessages(patch.messages) : previous.messages ?? [],
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
  if (!tab.url && !changeInfo.url) return;
  void upsertTab({ ...tab, url: changeInfo.url || tab.url }, {});
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
    const id = message.sessionId || sessionId(provider, message.url);
    const previous = registry[id] || {};
    const observedAt = message.timestamp || Date.now();
    const messages = normalizeMessages(message.messages);

    registry[id] = {
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
      latestUser: message.latestUser || previous.latestUser || "",
      latestAssistant: message.latestAssistant || previous.latestAssistant || "",
      snapshotAt: observedAt,
      messages: messages.length ? messages : previous.messages || [],
    };

    await writeRegistry(registry);

    const stateResult = await chrome.storage.local.get("sessionStates");
    const states = stateResult.sessionStates || {};
    states[id] = {
      status: registry[id].status,
      title: registry[id].title,
      latestUser: registry[id].latestUser,
      latestAssistant: registry[id].latestAssistant,
      observedAt,
      messages: registry[id].messages,
    };
    await chrome.storage.local.set({ sessionStates: states });

    try {
      await chrome.runtime.sendMessage({
        type: "ai-workspace:session-state",
        sessionId: id,
        status: registry[id].status,
        title: registry[id].title,
        latestUser: registry[id].latestUser,
        latestAssistant: registry[id].latestAssistant,
        observedAt,
        messages: registry[id].messages,
      });
    } catch {}
  })();
});