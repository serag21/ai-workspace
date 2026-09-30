(() => {
  const provider =
    location.hostname === "claude.ai"
      ? "claude"
      : location.hostname === "gemini.google.com"
        ? "gemini"
        : location.hostname === "chatgpt.com" || location.hostname === "chat.openai.com"
          ? "chatgpt"
          : null;

  if (!provider || /\/settings|\/account|\/login|\/help/i.test(location.pathname)) return;

  const sessionId = `${provider}:${location.host}${location.pathname.replace(/\/$/, "") || "/"}`;
  let lastStatus = "idle";
  let responsePending = false;

  function visible(element) {
    const style = window.getComputedStyle(element);
    return style.display !== "none" && style.visibility !== "hidden" && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  }

  function label(element) {
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.textContent,
    ].filter(Boolean).join(" ").trim().toLowerCase();
  }

  function hasWorkingControl() {
    return [...document.querySelectorAll("button,[role=button]")].some((element) => {
      if (!visible(element)) return false;
      return /stop\s+(generating|generation|response)|cancel\s+(response|generation)|abort\s+(response|generation)/i.test(label(element));
    });
  }

  function hasBlockingPrompt() {
    return [...document.querySelectorAll('[role="alertdialog"],[role="dialog"],[role="alert"]')].some((element) => {
      if (!visible(element)) return false;
      const text = element.textContent?.replace(/\s+/g, " ").trim() ?? "";
      return /(verify|sign in|log in|try again|retry|rate limit|usage limit|limit reached|something went wrong)/i.test(text);
    });
  }

  function readStatus() {
    if (hasBlockingPrompt()) return "needs-you";
    if (hasWorkingControl()) return "working";
    if (responsePending) return "done";
    return "idle";
  }

  function emit(status) {
    if (status === lastStatus && status !== "done") return;
    lastStatus = status;
    void chrome.runtime.sendMessage({
      type: "ai-workspace:session-state",
      sessionId,
      provider,
      status,
      title: document.title?.trim() || "Untitled conversation",
      url: location.href,
      observedAt: Date.now(),
    }).catch(() => {});
  }

  function sample() {
    emit(readStatus());
  }

  function markRequestStarted() {
    responsePending = true;
    lastStatus = "idle";
    emit("working");
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const button = target.closest("button,[role=button]");
    if (!button) return;
    const text = label(button);
    if (/send message|send prompt|submit prompt/i.test(text) || /^(send|submit)$/i.test(text)) {
      markRequestStarted();
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches("textarea,[contenteditable=true]")) {
      markRequestStarted();
    }
  }, true);

  sample();
  window.setInterval(sample, 1500);
})();