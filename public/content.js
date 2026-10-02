(() => {
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

  let lastSignature = "";
  let lastWorking = false;
  let doneTimer = null;

  function sessionId() {
    return provider + ":" + location.host + (location.pathname.replace(/\\/$/, "") || "/");
  }

  function pageTitle() {
    const title = (document.title || "").trim();
    if (!title) return "";
    return title.replace(/\\s*[|–-]\\s*(ChatGPT|Claude|Gemini).*$/i, "").trim();
  }

  function isStopControl(element) {
    const value = [
      element.getAttribute("aria-label") || "",
      element.getAttribute("title") || "",
      element.textContent || "",
    ].join(" ").toLowerCase();

    return /stop( generating| response| assistant| output)?|cancel response|stop streaming/.test(value);
  }

  function isWorking() {
    return Array.from(document.querySelectorAll("button,[role='button'],[aria-label]")).some(isStopControl);
  }

  function selectAll(selectorList) {
    for (const selector of selectorList) {
      const nodes = Array.from(document.querySelectorAll(selector));
      if (nodes.length) return nodes;
    }
    return [];
  }

  function textOf(element) {
    return (element?.innerText || element?.textContent || "").replace(/\\s+/g, " ").trim();
  }

  function extractSnapshot() {
    const configs = {
      chatgpt: {
        user: ['[data-message-author-role="user"]', '[data-role="user"]'],
        assistant: ['[data-message-author-role="assistant"]', '[data-role="assistant"]', '.agent-turn'],
      },
      claude: {
        user: ['[data-testid="human-message"]', '.font-user-message', '[data-testid="message-human"]'],
        assistant: ['.font-claude-response', '[data-testid="ai-message"]', '[data-testid="message-assistant"]'],
      },
      gemini: {
        user: ['.user-query', '[data-test-id="user-query"]', '.gemini-user-message'],
        assistant: ['.model-response', '[data-test-id="model-response"]', '.gemini-response'],
      },
    };

    const config = configs[provider];
    const users = selectAll(config.user).map(textOf).filter(Boolean);
    const assistants = selectAll(config.assistant).map(textOf).filter(Boolean);

    return {
      latestUser: users.at(-1) || "",
      latestAssistant: assistants.at(-1) || "",
    };
  }

  function publish(status, title) {
    const snapshot = extractSnapshot();
    const latestUser = snapshot.latestUser.slice(0, 8000);
    const latestAssistant = snapshot.latestAssistant.slice(0, 8000);
    const signature = status + "|" + title + "|" + latestUser + "|" + latestAssistant;
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
        timestamp: Date.now(),
      });
    } catch {
      // Extension context may disappear during an update/reload.
    }
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
      publish("working", title);
      return;
    }

    if (lastWorking) {
      lastWorking = false;
      publish("done", title);
      if (doneTimer) clearTimeout(doneTimer);
      doneTimer = setTimeout(() => publish("idle", pageTitle()), 60000);
      return;
    }

    publish("idle", title);
  }

  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });

  scan();
  setInterval(scan, 4000);

  window.addEventListener("unload", () => {
    observer.disconnect();
    if (doneTimer) clearTimeout(doneTimer);
  });
})();
  function findInput() {
    const selectors = {
      chatgpt: ['#prompt-textarea', 'textarea[name="prompt-textarea"]', '[contenteditable="true"][aria-label*="ChatGPT"]'],
      claude: ['div[contenteditable="true"].ProseMirror', 'div[contenteditable="true"]'],
      gemini: ['input-area-v2 div[contenteditable="true"]', 'textarea', 'div[contenteditable="true"]'],
    };

    for (const selector of selectors[provider]) {
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
    const input = findInput();
    if (!input) return { ok: false, error: "Chat input was not found." };

    setInputValue(input, text);

    const sendSelectors = {
      chatgpt: ['#composer-submit-button', 'button[data-testid*="send-button"]', 'button[aria-label*="Send"]'],
      claude: ['button[aria-label*="Send"]', 'button[type="submit"]'],
      gemini: ['button[aria-label*="Send"]', 'button[data-test-id*="send"]', 'button[type="submit"]'],
    };

    let sendButton = null;
    for (const selector of sendSelectors[provider]) {
      const candidate = document.querySelector(selector);
      if (candidate && !candidate.hasAttribute("disabled")) {
        sendButton = candidate;
        break;
      }
    }

    if (sendButton) {
      sendButton.click();
      return { ok: true };
    }

    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    return { ok: true };
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type !== "ai-workspace:send-prompt") return;
    try {
      sendResponse(sendPrompt(String(message.text || "")));
    } catch (error) {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
