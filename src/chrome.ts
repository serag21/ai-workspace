import { getProvider } from "./providers";
import type { AISession } from "./types";

export async function discoverOpenSessions(): Promise<AISession[]> {
  const tabs = await chrome.tabs.query({});
  const now = Date.now();

  return tabs
    .filter((tab) => Boolean(tab.id && tab.url))
    .map((tab) => ({ tab, provider: getProvider(tab.url!) }))
    .filter((item): item is { tab: chrome.tabs.Tab; provider: NonNullable<ReturnType<typeof getProvider>> } => Boolean(item.provider))
    .map(({ tab, provider }) => ({
      id: `${provider}:${tab.id}`,
      provider,
      title: tab.title?.trim() || "Untitled conversation",
      url: tab.url!,
      tabId: tab.id!,
      windowId: tab.windowId,
      status: tab.status === "loading" ? "working" : "idle",
      lastSeen: now,
      projectId: null,
      pinned: false,
    }));
}

export async function focusSession(session: AISession): Promise<void> {
  await chrome.tabs.update(session.tabId, { active: true });
  await chrome.windows.update(session.windowId, { focused: true });
}