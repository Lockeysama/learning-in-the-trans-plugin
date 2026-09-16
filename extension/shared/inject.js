import { fallbackIfSkipped, pickFrameResult } from "./tab-bridge.js";

function scriptTarget(tabId, frameId) {
  const target = { tabId };
  if (Number.isInteger(frameId) && frameId >= 0) target.frameIds = [frameId];
  else target.allFrames = true;
  return target;
}

export async function injectContentScript(tabId, frameId) {
  const moduleUrl = chrome.runtime.getURL("content/content.js");
  await chrome.scripting.executeScript({
    target: scriptTarget(tabId, frameId),
    world: "ISOLATED",
    func: (url) => import(url),
    args: [moduleUrl],
  });
}

async function dispatchOnce(tabId, payload, frameId) {
  const results = await chrome.scripting.executeScript({
    target: scriptTarget(tabId, frameId),
    world: "ISOLATED",
    func: async (message) => {
      const dispatch = globalThis.__littpDispatch;
      if (typeof dispatch !== "function") return { skipped: true, error: "content_not_ready" };
      return await dispatch(message);
    },
    args: [payload],
  });
  return pickFrameResult(results);
}

export async function dispatchInTab(tabId, payload, frameId) {
  const targeted = Number.isInteger(frameId) && frameId >= 0;
  const primary = await dispatchOnce(tabId, payload, targeted ? frameId : undefined);
  if (!targeted || primary?.ok) return primary;
  const broadcast = await dispatchOnce(tabId, payload);
  return fallbackIfSkipped(primary, broadcast);
}
