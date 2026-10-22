// Only known conversation paths may be opened in the user's regular browser.
// Authentication callbacks, queries, fragments and arbitrary pages are not forwarded.
const HOMES = Object.freeze({
  chatgpt: "https://chatgpt.com/",
  claude: "https://claude.ai/",
  gemini: "https://gemini.google.com/app",
});
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROUTES = {
  chatgpt: [new RegExp("^/c/" + UUID + "/?$", "i"),
    new RegExp("^/g/g-[A-Za-z0-9_-]{6,128}/c/" + UUID + "/?$", "i")],
  claude: [new RegExp("^/chat/" + UUID + "/?$", "i"),
    new RegExp("^/project/" + UUID + "/chat/" + UUID + "/?$", "i")],
  gemini: [/^\/app\/[A-Za-z0-9_-]{8,128}\/?$/],
};
function browserDestination(provider, currentUrl) {
  if (!Object.hasOwn(HOMES, provider)) throw new TypeError("Unrecognized provider.");
  const fallback = {url: HOMES[provider], preservedConversation: false};
  if (typeof currentUrl !== "string") return fallback;
  try {
    const current = new URL(currentUrl);
    const home = new URL(HOMES[provider]);
    if (current.protocol !== "https:" || current.hostname !== home.hostname ||
        current.port || current.username || current.password ||
        !ROUTES[provider].some(pattern => pattern.test(current.pathname))) return fallback;
    return {url: current.origin + current.pathname, preservedConversation: true};
  } catch { return fallback; }
}
module.exports = {browserDestination};
