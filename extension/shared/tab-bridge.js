const RESTRICTED = /^(chrome|chrome-extension|edge|about|devtools|view-source|brave|opera):/i;

export function describeTabBlocker(url) {
  if (!url) return "没有可处理的标签页";
  if (RESTRICTED.test(url)) {
    return "请打开一个普通网页（http/https）后再点学习视图";
  }
  if (url.startsWith("file:")) {
    return "本地文件页默认不能处理，请用 http 打开演示页";
  }
  if (
    url.startsWith("https://chrome.google.com/") ||
    url.startsWith("https://chromewebstore.google.com/")
  ) {
    return "Chrome 商店页不能注入脚本";
  }
  return null;
}

export function pickFrameResult(results = []) {
  const values = results
    .map((item) => (item && typeof item === "object" && "result" in item ? item.result : item))
    .filter(Boolean);
  return (
    values.find((item) => item.ok) ||
    values.find((item) => item.error && !item.skipped) ||
    values.find((item) => !item.skipped) ||
    { skipped: true, error: "没有找到可阅读正文" }
  );
}

export function fallbackIfSkipped(primary, fallback) {
  if (primary?.ok) return primary;
  if (fallback?.ok) return fallback;
  if (primary?.skipped) return fallback || primary;
  return primary || fallback || { skipped: true, error: "没有找到可阅读正文" };
}

export async function sendToTab({ tabId, url, payload, send, inject, frameId, dispatch }) {
  const blocked = describeTabBlocker(url);
  if (blocked) return { error: blocked };
  if (dispatch) {
    try {
      await inject?.(tabId, frameId);
    } catch {
      return { error: "当前页无法注入脚本" };
    }
    try {
      return (await dispatch(tabId, payload, frameId)) || {
        error: "无法连接到页面，请换一个 http/https 网页再试",
      };
    } catch {
      return { error: "无法连接到页面，请换一个 http/https 网页再试" };
    }
  }
  try {
    return await send(tabId, payload, frameId);
  } catch {
    try {
      await inject(tabId, frameId);
    } catch {
      return { error: "当前页无法注入脚本" };
    }
    try {
      return await send(tabId, payload, frameId);
    } catch {
      return { error: "无法连接到页面，请换一个 http/https 网页再试" };
    }
  }
}
