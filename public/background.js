chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== "ai-workspace:session-state" || !message.sessionId) return;

  void chrome.storage.local.get("sessionStates").then((saved) => {
    const states = saved.sessionStates ?? {};
    states[message.sessionId] = {
      status: message.status,
      provider: message.provider,
      title: message.title,
      url: message.url,
      tabId: sender.tab?.id ?? null,
      observedAt: message.observedAt ?? Date.now(),
    };
    return chrome.storage.local.set({ sessionStates: states });
  });
});
