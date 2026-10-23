import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {browserDestination} = createRequire(import.meta.url)("./provider-navigation.cjs");

const CHAT = "01234567-89ab-4cde-8fab-0123456789ab";
const SECOND = "12345678-1234-4234-8234-123456789abc";

test("CON-001: browser fallback preserves recognized native conversation paths", () => {
  const cases = [
    ["chatgpt", "https://chatgpt.com/c/" + CHAT],
    ["chatgpt", "https://chatgpt.com/g/g-project123/c/" + CHAT],
    ["claude", "https://claude.ai/chat/" + CHAT],
    ["claude", "https://claude.ai/project/" + CHAT + "/chat/" + SECOND],
    ["gemini", "https://gemini.google.com/app/abcDEF123456"],
  ];
  for (const [provider, url] of cases) {
    assert.deepEqual(browserDestination(provider, url),
      {url, preservedConversation: true}, provider + ": " + url);
  }
});

test("REL-013 CON-001: never forward credentials, fragments, callbacks or same-origin unknown routes", () => {
  const cases = [
    ["chatgpt", "https://chatgpt.com/c/" + CHAT + "?code=SECRET#access_token=SECRET", "https://chatgpt.com/c/" + CHAT],
    ["chatgpt", "https://chatgpt.com/auth/callback/SECRET?code=SECRET", "https://chatgpt.com/"],
    ["chatgpt", "https://chatgpt.com/c/not-a-uuid", "https://chatgpt.com/"],
    ["chatgpt", "https://chatgpt.com/c/" + CHAT + "/extra/SECRET", "https://chatgpt.com/"],
    ["claude", "https://claude.ai/login?code=SECRET", "https://claude.ai/"],
    ["gemini", "https://gemini.google.com/app?authuser=1&token=SECRET", "https://gemini.google.com/app"],
    ["gemini", "https://gemini.google.com/app/abcDEF123456?authuser=1#SECRET", "https://gemini.google.com/app/abcDEF123456"],
    ["claude", "https://accounts.google.com/o/oauth2/v2/auth?code=SECRET", "https://claude.ai/"],
    ["chatgpt", "https://chatgpt.com.evil.example/c/" + CHAT, "https://chatgpt.com/"],
    ["chatgpt", "http://chatgpt.com/c/" + CHAT, "https://chatgpt.com/"],
    ["chatgpt", "https://user:password@chatgpt.com/c/" + CHAT, "https://chatgpt.com/"],
    ["chatgpt", "https://chatgpt.com:444/c/" + CHAT, "https://chatgpt.com/"],
    ["chatgpt", "https://chatgpt.com/c/%2e%2e/auth/SECRET", "https://chatgpt.com/"],
    ["chatgpt", "file:///C:/Users/test/secret.txt", "https://chatgpt.com/"],
  ];
  for (const [provider, input, expected] of cases) {
    const actual = browserDestination(provider, input);
    assert.equal(actual.url, expected, provider + ": " + input);
    assert.equal(actual.preservedConversation, expected !== {
      chatgpt: "https://chatgpt.com/", claude: "https://claude.ai/",
      gemini: "https://gemini.google.com/app"
    }[provider], provider + ": " + input);
    assert.ok(!actual.url.includes("SECRET"));
  }
});

test("REL-013: untrusted provider selection and malformed URLs fail closed", () => {
  assert.throws(() => browserDestination("unknown", "https://chatgpt.com/"), TypeError);
  for (const url of [null, undefined, 42, "", "not a URL", "javascript:alert(1)"]) {
    assert.deepEqual(browserDestination("chatgpt", url),
      {url: "https://chatgpt.com/", preservedConversation: false});
  }
});
