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

  function publish(status, title) {
    const signature = status + "|" + title;
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