(() => {
  if (window.top !== window) return;
  if (window.__AI_WORKSPACE_PROVIDER_BRIDGE__) return;
  window.__AI_WORKSPACE_PROVIDER_BRIDGE__ = true;

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
  let lastSignature = "";
  let lastWorking = false;
  let doneTimer = null;
  let publishTimer = null;

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

    const messages = [];

    for (const entry of entries) {
      const text = textOf(entry.element);
      if (!text) continue;
      const previous = messages[messages.length - 1];
      if (previous && previous.role === entry.role && previous.text === text) continue;
      messages.push({ id: provider + "-msg-" + messages.length, role: entry.role, text, observedAt: Date.now() });
    }

    return messages.slice(-MAX_MESSAGES);
  }

  function extractSnapshot(statusOverride) {
    const messages = collectMessages();
    const users = messages.filter((message) => message.role === "user");
    const assistants = messages.filter((message) => message.role === "assistant");
    return {
      title: pageTitle(),
      status: statusOverride || (lastWorking ? "working" : "idle"),
      latestUser: users[users.length - 1]?.text || "",
      latestAssistant: assistants[assistants.length - 1]?.text || "",
      messages,
      timestamp: Date.now(),
    };
  }

  function isStopControl(element) {
    const value = [element.getAttribute("aria-label") || "", element.getAttribute("title") || "", element.textContent || ""].join(" ").toLowerCase();
    return /stop( generating| response| assistant| output)?|cancel response|stop streaming/.test(value);
  }

  function isWorking() {
    return Array.from(document.querySelectorAll("button,[role='button'],[aria-label]")).some(isStopControl);
  }

  function publish(status, title) {
    const snapshot = extractSnapshot(status);
    const latestUser = snapshot.latestUser.slice(0, 8000);
    const latestAssistant = snapshot.latestAssistant.slice(0, 12000);
    const signature = status + "|" + title + "|" + latestUser + "|" + latestAssistant + "|" + JSON.stringify(snapshot.messages);
    if (signature === lastSignature) return;
    lastSignature = signature;

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
        messages: snapshot.messages,
        timestamp: snapshot.timestamp,
      });
    } catch {}
  }

  function queuePublish(status, title) {
    if (publishTimer) clearTimeout(publishTimer);
    publishTimer = setTimeout(() => {
      publishTimer = null;
      publish(status, title);
    }, 500);
  }

  function scan() {
    const working = isWorking();
    const title = pageTitle();

    if (working) {
      if (doneTimer) {
        clearTimeout(doneTimer);
        doneTimer = null;
      }
      lastWorking = true;
      queuePublish("working", title);
      return;
    }

    if (lastWorking) {
      lastWorking = false;
      queuePublish("done", title);
      if (doneTimer) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => queuePublish("idle", pageTitle()), 60000);
      return;
    }

    queuePublish("idle", title);
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

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  scan();
  setInterval(scan, 4000);

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === "ai-workspace:request-snapshot") {
      const state = extractSnapshot(isWorking() ? "working" : "idle");
      publish(state.status, state.title);
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

  window.addEventListener("unload", () => {
    observer.disconnect();
    if (doneTimer) clearTimeout(doneTimer);
    if (publishTimer) clearTimeout(publishTimer);
  });
})();