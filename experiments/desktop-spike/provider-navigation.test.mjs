import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const {browserDestination} = createRequire(import.meta.url)("./provider-navigation.cjs");
test("CON-001: browser fallback preserves a canonical thread", () => {
  const id = "01234567-89ab-4cde-8fab-0123456789ab";
  assert.deepEqual(browserDestination("chatgpt", "https://chatgpt.com/c/" + id),
    {url: "https://chatgpt.com/c/" + id, preservedConversation: true});
});
