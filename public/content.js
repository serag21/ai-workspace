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
  let generationObserved = false;

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
    if (hasWorkingControl() || document.querySelector('[aria-busy="true"]')) return "working";
    if (generationObserved) return "done";
    return "idle";
  }

  function emit(status) {
    if (status === lastStatus && status !== "done") return;
    lastStatus = status;
    const payload = {
      type: "ai-workspace:session-state",
      sessionId,
      provider,
      status,
      title: document.title?.trim() || "Untitled conversation",
      url: location.href,
      observedAt: Date.now(),
    };
    void chrome.runtime.sendMessage(payload).catch(() => {});
  }

  function sample() {
    const status = readStatus();
    if (status === "working") generationObserved = true;
    if (status === "done") generationObserved = false;
    emit(status);
  }

  document.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    const button = target.closest("button,[role=button]");
    if (!button) return;
    const text = label(button);
    if (/^(send|submit|send message|send prompt)$/i.test(text) || /send message|submit prompt/i.test(text)) {
      generationObserved = true;
      lastStatus = "idle";
      emit("working");
    }
  }, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.matches("textarea,[contenteditable=true]")) {
      generationObserved = true;
      lastStatus = "idle";
      emit("working");
    }
  }, true);

  const observer = new MutationObserver(() => sample());
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["aria-busy", "disabled", "aria-label", "title"] });

  sample();
  window.setInterval(sample, 1000);
})();