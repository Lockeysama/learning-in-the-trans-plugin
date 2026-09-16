import assert from "node:assert/strict";
import test from "node:test";
import { describeTabBlocker, sendToTab } from "../extension/shared/tab-bridge.js";

const REFRESH = "请刷新页面后再试";

test("extension and chrome pages do not ask to refresh", () => {
  const message = describeTabBlocker(
    "chrome-extension://abc/onboarding/index.html",
  );
  assert.match(message, /普通网页/);
  assert.notEqual(message, REFRESH);
  assert.notEqual(describeTabBlocker("chrome://extensions/"), REFRESH);
});

test("injects content script instead of asking to refresh", async () => {
  let injected = false;
  const result = await sendToTab({
    tabId: 1,
    url: "http://127.0.0.1:8767/en.html",
    payload: { type: "PROCESS_PAGE" },
    send: async () => {
      if (!injected) throw new Error("Could not establish connection. Receiving end does not exist.");
      return { ok: true, mode: "learning" };
    },
    inject: async () => {
      injected = true;
    },
  });
  assert.equal(injected, true);
  assert.equal(result.ok, true);
  assert.notEqual(result.error, REFRESH);
});
