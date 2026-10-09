import { getProvider, getSessionId } from "./providers";
import type { AISession, Provider, SessionMessage } from "./types";

export interface ProviderSnapshot {
  title: string;
  status: "working" | "needs-you" | "done" | "idle";
  latestUser: string;
  latestAssistant: string;
  messages: SessionMessage[];
  timestamp: number;
}

export async function discoverOpenSessions(): Promise<AISession[]> {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();
  const sessions = new Map<string, { session: AISession; active: boolean }>();

  for (const tab of tabs) {
    if (tab.id === undefined || !tab.url) continue;
    const provider = getProvider(tab.url);
    if (!provider) continue;

    const id = getSessionId(provider, tab.url, tab.id);
    const session: AISession = {
      id,
      provider,
      title: tab.title?.trim() || "Untitled conversation",
      url: tab.url,
      tabId: tab.id,
      windowId: tab.windowId,
      status: tab.discarded ? "idle" : tab.status === "loading" ? "working" : "idle",
      lifecycle: tab.discarded ? "discarded" : "open",
      discarded: Boolean(tab.discarded),
      lastSeen: now,
      projectId: null,
      pinned: false,
    };

    const existing = sessions.get(id);
    if (!existing || (existing.session.discarded && !session.discarded) || (Boolean(tab.active) && !existing.active)) {
      sessions.set(id, { session, active: Boolean(tab.active) });
    }
  }

  return [...sessions.values()].map(({ session }) => session);
}

export async function focusSession(session: AISession): Promise<number | null> {
  if (session.tabId === null) {
    const tab = await chrome.tabs.create({ url: session.url, active: true });
    return tab.id ?? null;
  }

  await chrome.tabs.update(session.tabId, { active: true });
  if (session.windowId !== null) await chrome.windows.update(session.windowId, { focused: true });
  return session.tabId;
}

export async function ensureSessionTab(session: AISession): Promise<number | null> {
  if (session.tabId !== null) return session.tabId;

  const tab = await chrome.tabs.create({ url: session.url, active: false });
  if (tab.id === undefined) return null;
  await waitForTabComplete(tab.id);
  return tab.id;
}

export async function waitForTabComplete(tabId: number): Promise<void> {
  const current = await chrome.tabs.get(tabId);
  if (current.status === "complete") return;

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }, 12000);

    function onUpdated(updatedTabId: number, changeInfo: chrome.tabs.TabChangeInfo) {
      if (updatedTabId !== tabId || changeInfo.status !== "complete") return;
      window.clearTimeout(timeout);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
  });
}

export async function requestSessionSnapshot(tabId: number): Promise<ProviderSnapshot | null> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: "ai-workspace:request-snapshot" });
    if (!response?.ok || !response.state) return null;
    return response.state as ProviderSnapshot;
  } catch {
    return null;
  }
}

export function providerFromSessionId(id: string): Provider | null {
  const provider = id.split(":")[0];
  return provider === "chatgpt" || provider === "claude" || provider === "gemini" ? provider : null;
}
