(() => {
  if (window.top !== window) return;

  const BRIDGE_VERSION = "2026-10-09-v5";
  const previousBridge = window.__AI_WORKSPACE_PROVIDER_BRIDGE__;
  if (previousBridge?.version === BRIDGE_VERSION) return;
  previousBridge?.dispose?.();

  const hostname = location.hostname;
  const provider =
    hostname === "claude.ai"
      ? "claude"
      : hostname === "gemini.google.com"
        ? "gemini"
        : hostname === "chatgpt.com" || hostname === "chat.openai.com"
          ? "chatgpt"
          : null;

  if (!provider) return;

  const MAX_MESSAGES = 100;
  const WORKING_PUBLISH_INTERVAL_MS = 10000;
  let lastSignature = "";
  let lastPublishedStatus = "";
  let lastPublishedTitle = "";
  let pendingPublishKey = "";
  let lastWorking = false;
  let doneTimer = null;
  let publishTimer = null;
  let scanTimer = null;
  let intervalId = null;
  let lastPublishAt = 0;

  function sessionId() {
    return provider + ":" + location.host + (location.pathname.replace(/\/$/, "") || "/");
  }

  function pageTitle() {
    const title = (document.title || "").trim();
    if (!title) return "";
    return title.replace(/\s*[|–-]\s*(ChatGPT|Claude|Gemini).*$/i, "").trim();
  }

  function textOf(element) {
    return (element?.innerText || element?.textContent || "").replace(/\s+/g, " ").trim();
  }

  const configs = {
    chatgpt: {
      user: ['[data-message-author-role="user"]', '[data-role="user"]', '[data-message-author="user"]'],
      assistant: ['[data-message-author-role="assistant"]', '[data-role="assistant"]', '[data-message-author="assistant"]', ".agent-turn"],
      input: ['#prompt-textarea', 'textarea[name="prompt-textarea"]', '[contenteditable="true"][aria-label*="ChatGPT"]'],
      send: ['#composer-submit-button', 'button[data-testid*="send-button"]', 'button[aria-label*="Send"]'],
    },
    claude: {
      user: ['[data-testid="human-message"]', ".font-user-message", '[data-testid="message-human"]', ".user-message"],
      assistant: ['.font-claude-response', '[data-testid="ai-message"]', '[data-testid="message-assistant"]', ".assistant-message"],
      input: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Send"]', 'button[type="submit"]'],
    },
    gemini: {
      user: [".user-query", '[data-test-id="user-query"]', ".gemini-user-message"],
      assistant: [".model-response", '[data-test-id="model-response"]', ".gemini-response"],
      input: ['input-area-v2 div[contenteditable="true"]', "textarea", 'div[contenteditable="true"]'],
      send: ['button[aria-label*="Send"]', 'button[data-test-id*="send"]', 'button[type="submit"]'],
    },
  };

  function collectMessages() {
    const config = configs[provider];
    const entries = [];
    const seen = new Set();

    for (const role of ["user", "assistant"]) {
      for (const selector of config[role]) {
        for (const element of Array.from(document.querySelectorAll(selector))) {
          if (seen.has(element)) continue;
          seen.add(element);
          entries.push({ element, role });
        }
      }
    }

    entries.sort((a, b) => {
      if (a.element === b.element) return 0;
      const position = a.element.compareDocumentPosition(b.element);
      return position & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
    });

    // Only extract text from a bounded recent window. Querying selectors still
    // finds existing message nodes, but long histories no longer require reading
    // every old message's innerText on each explicit snapshot.
    const recentEntries = entries.slice(-MAX_MESSAGES * 4);
    const messages = [];

    for (const entry of recentEntries) {
      const text = textOf(entry.element);
      if (!text) continue;
      const previous = messages[messages.length - 1];
      if (previous && previous.role === entry.role && previous.text === text) continue;
      messages.push({ id: provider + "-msg-" + messages.length, role: entry.role, text, observedAt: Date.now() });
    }

    return messages.slice(-MAX_MESSAGES);
  }

  function latestMessageElement(selectors) {
    const candidates = new Set();
    for (const selector of selectors) {
      for (const element of Array.from(document.querySelectorAll(selector))) candidates.add(element);
    }

    let latest = null;
    for (const element of candidates) {
      if (!latest || (latest.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING)) latest = element;
    }
    return latest;
  }

  function extractSnapshot(statusOverride, includeMessages = true) {
    const messages = includeMessages ? collectMessages() : [];
    let latestUser = "";
    let latestAssistant = "";
    let lastRole = null;

    if (includeMessages) {
      const users = messages.filter((message) => message.role === "user");
      const assistants = messages.filter((message) => message.role === "assistant");
      latestUser = users[users.length - 1]?.text || "";
      latestAssistant = assistants[assistants.length - 1]?.text || "";
      lastRole = messages[messages.length - 1]?.role || null;
    } else {
      const userElement = latestMessageElement(configs[provider].user);
      const assistantElement = latestMessageElement(configs[provider].assistant);
      latestUser = textOf(userElement);
      latestAssistant = textOf(assistantElement);

      if (userElement && assistantElement) {
        lastRole = (userElement.compareDocumentPosition(assistantElement) & Node.DOCUMENT_POSITION_FOLLOWING)
          ? "assistant"
          : "user";
      } else if (assistantElement) {
        lastRole = "assistant";
      } else if (userElement) {
        lastRole = "user";
      }
    }

    return {
      title: pageTitle(),
      status: statusOverride || (lastWorking ? "working" : "idle"),
      latestUser,
      latestAssistant,
      lastRole,
      messages,
      timestamp: Date.now(),
    };
  }

  function isStopControl(element) {
    const value = [element.getAttribute("aria-label") || "", element.getAttribute("title") || "", element.textContent || ""].join(" ").toLowerCase();
    return /stop( generating| response| assistant| output)?|cancel response|stop streaming/.test(value);
  }

  function isWorking() {
    return Array.from(document.querySelectorAll("button[aria-label],button[title],[role='button'][aria-label],[role='button'][title]")).some(isStopControl);
  }

  function publish(status, title, includeMessages = true) {
    const snapshot = extractSnapshot(status, includeMessages);
    const latestUser = snapshot.latestUser.slice(0, 8000);
    const latestAssistant = snapshot.latestAssistant.slice(0, 12000);
    const now = Date.now();
    if (status === "working" && lastPublishedStatus === "working" &&
        now - lastPublishAt < WORKING_PUBLISH_INTERVAL_MS) return;
    const signature = status + "|" + title + "|" + latestUser + "|" + latestAssistant + "|" + (includeMessages ? snapshot.messages.length : "preview") + "|" + snapshot.lastRole;
    if (signature === lastSignature) return;
    lastSignature = signature;
    lastPublishAt = now;
    lastPublishedStatus = status;
    lastPublishedTitle = title;

    try {
      chrome.runtime.sendMessage({
        type: "ai-workspace:provider-state",
        sessionId: sessionId(),
        provider,
        url: location.href,
        title,
        status,
        latestUser,
        latestAssistant,
        messages: includeMessages ? snapshot.messages : undefined,
        timestamp: snapshot.timestamp,
      });
    } catch {}
  }

  function queuePublish(status, title, includeMessages = true) {
    const key = status + "|" + title + "|" + includeMessages;
    // A burst of DOM mutations must not continually push the same pending
    // state transition farther into the future.
    if (publishTimer && pendingPublishKey === key) return;
    if (publishTimer) clearTimeout(publishTimer);
    pendingPublishKey = key;
    publishTimer = setTimeout(() => {
      publishTimer = null;
      pendingPublishKey = "";
      publish(status, title, includeMessages);
    }, 250);
  }

  function scheduleScan() {
    if (scanTimer !== null) return;
    scanTimer = setTimeout(() => {
      scanTimer = null;
      scan();
    }, 300);
  }

  function scan() {
    const working = isWorking();
    const title = pageTitle();

    if (working) {
      if (doneTimer) {
        clearTimeout(doneTimer);
        doneTimer = null;
      }
      const justStarted = !lastWorking;
      lastWorking = true;
      const heartbeatDue = lastPublishedStatus === "working" &&
        Date.now() - lastPublishAt >= WORKING_PUBLISH_INTERVAL_MS;
      // Publish immediately on a status transition, then at most once every
      // 10 seconds while streaming. Intermediate mutation scans stay local.
      if (justStarted || heartbeatDue) queuePublish("working", title, false);
      return;
    }

    if (lastWorking) {
      lastWorking = false;
      queuePublish("done", title, true);
      if (doneTimer) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => {
        doneTimer = null;
        const next = extractSnapshot(undefined, false);
        const nextStatus = next.lastRole === "assistant" && findInput() ? "needs-you" : "idle";
        queuePublish(nextStatus, pageTitle(), false);
      }, 15000);
      return;
    }

    // Keep the just-finished state visible for its settling window rather than
    // reverting to Idle on the next periodic scan.
    if (doneTimer) return;

    const includeMessages = lastSignature === "";
    const snapshot = extractSnapshot(undefined, includeMessages);
    const nextStatus = snapshot.lastRole === "assistant" && findInput() ? "needs-you" : "idle";
    const shouldPublish = includeMessages || nextStatus !== lastPublishedStatus || title !== lastPublishedTitle;
    if (shouldPublish) queuePublish(nextStatus, title, includeMessages);
  }

  function findInput() {
    for (const selector of configs[provider].input) {
      const element = document.querySelector(selector);
      if (element && !element.closest('[aria-hidden="true"]')) return element;
    }
    return null;
  }

  function setInputValue(element, text) {
    element.focus();

    if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
      const prototype = Object.getPrototypeOf(element);
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(element, text);
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    element.textContent = "";
    document.execCommand("insertText", false, text);
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
  }

  function sendPrompt(text) {
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Prompt is empty." };

    const input = findInput();
    if (!input) return { ok: false, error: "Chat input was not found." };

    setInputValue(input, trimmed);

    for (const selector of configs[provider].send) {
      const candidate = document.querySelector(selector);
      if (candidate && !candidate.hasAttribute("disabled")) {
        candidate.click();
        queuePublish("working", pageTitle());
        return { ok: true };
      }
    }

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    queuePublish("working", pageTitle());
    return { ok: true };
  }

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  scan();
  intervalId = setInterval(scan, 5000);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ai-workspace:request-snapshot") {
      const working = isWorking();
      const state = extractSnapshot(working ? "working" : doneTimer ? "done" : undefined);
      if (!working && !doneTimer) {
        state.status = state.lastRole === "assistant" && findInput() ? "needs-you" : "idle";
      }
      publish(state.status, state.title, true);
      sendResponse({ ok: true, state });
      return true;
    }

    if (message?.type === "ai-workspace:send-prompt") {
      try {
        sendResponse(sendPrompt(String(message.text || "")));
      } catch (error) {
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
      }
      return true;
    }

    return false;
  });

  function dispose() {
    observer.disconnect();
    if (doneTimer) clearTimeout(doneTimer);
    if (publishTimer) clearTimeout(publishTimer);
    pendingPublishKey = "";
    if (scanTimer !== null) clearTimeout(scanTimer);
    if (intervalId !== null) clearInterval(intervalId);
  }

  window.__AI_WORKSPACE_PROVIDER_BRIDGE__ = { version: BRIDGE_VERSION, dispose };
  window.addEventListener("unload", dispose);
})();