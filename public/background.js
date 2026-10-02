const PROVIDER_HOSTS = {
  "chatgpt.com": "chatgpt",
  "chat.openai.com": "chatgpt",
  "claude.ai": "claude",
  "gemini.google.com": "gemini",
};

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
    return provider + ":" + parsed.host + (parsed.pathname.replace(/\\/$/, "") || "/");
  } catch {
    return provider + ":" + url;
  }
}

async function readRegistry() {
  const result = await chrome.storage.local.get("sessionRegistry");
  return result.sessionRegistry || {};
}

async function writeRegistry(registry) {
  await chrome.storage.local.set({ sessionRegistry: registry });
}

async function upsertTab(tab, patch = {}) {
  if (!tab?.id || !tab.url) return;
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
  };

  await writeRegistry(registry);
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.tabs.onCreated.addListener((tab) => {
  void upsertTab(tab);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!tab.url && !changeInfo.url) return;
  void upsertTab({ ...tab, url: changeInfo.url || tab.url }, {});
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
  if (message?.type !== "ai-workspace:provider-state" || !sender.tab?.id) return;

  void (async () => {
    const provider = providerFromUrl(message.url);
    if (!provider) return;

    const registry = await readRegistry();
    const id = message.sessionId || sessionId(provider, message.url);
    const previous = registry[id] || {};

    const observedAt = message.timestamp || Date.now();

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
      latestUser: message.latestUser || previous.latestUser || "",
      latestAssistant: message.latestAssistant || previous.latestAssistant || "",
      snapshotAt: observedAt,
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
      });
    } catch {
      // Side panel may not currently be open.
    }
  })();
});