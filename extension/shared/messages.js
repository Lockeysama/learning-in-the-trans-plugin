export const QUEUED_MESSAGE_TYPES = new Set(["GLOSS", "TRANSLATE_PARAS", "GENERATE_SEED"]);

export function shouldQueueMessage(type) {
  return QUEUED_MESSAGE_TYPES.has(type);
}

export function isStaleExtensionError(error) {
  const text = String(error?.message || error || "");
  return /extension context invalidated/i.test(text) || /message port closed/i.test(text);
}

export function explainRuntimeError(error, fallback = "处理失败") {
  if (isStaleExtensionError(error) || (globalThis.chrome?.runtime && !globalThis.chrome.runtime.id)) {
    return "扩展刚更新过，请刷新页面后再试";
  }
  return String(error?.message || error || fallback);
}

export async function sendRuntime(payload) {
  try {
    if (globalThis.chrome?.runtime && !globalThis.chrome.runtime.id) {
      return { error: explainRuntimeError(new Error("Extension context invalidated.")) };
    }
    const result = await chrome.runtime.sendMessage(payload);
    return result ?? { error: "没有收到扩展响应" };
  } catch (error) {
    return { error: explainRuntimeError(error) };
  }
}
