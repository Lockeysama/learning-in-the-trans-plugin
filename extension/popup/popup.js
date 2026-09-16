import { injectContentScript, dispatchInTab } from "../shared/inject.js";
import { isAutoLearnHost, initialViewMode, isSiteEnabled } from "../shared/site.js";
import { sendToTab as sendToTabWithInject } from "../shared/tab-bridge.js";

const setupStatus = document.getElementById("setupStatus");
const setupCard = document.getElementById("setupCard");
const message = document.getElementById("message");
const hostEl = document.getElementById("host");
const siteEnabled = document.getElementById("siteEnabled");
const autoLearn = document.getElementById("autoLearn");
const originalBtn = document.getElementById("original");
const learnBtn = document.getElementById("learn");

let refreshToken = 0;
let autoLearnBusy = false;

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function hostFromUrl(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

async function send(tabId, payload, frameId) {
  return chrome.tabs.sendMessage(
    tabId,
    payload,
    Number.isInteger(frameId) ? { frameId } : {},
  );
}

async function sendToTab(tabId, url, payload) {
  return sendToTabWithInject({
    tabId,
    url,
    payload,
    send,
    inject: injectContentScript,
    dispatch: dispatchInTab,
  });
}

function setViewSwitch(mode) {
  const learning = mode === "learning";
  originalBtn.setAttribute("aria-pressed", String(!learning));
  learnBtn.setAttribute("aria-pressed", String(learning));
}

function applyAutoLearn(host, state) {
  const enabled = isSiteEnabled(host, state.disabledHosts || []);
  autoLearn.checked = isAutoLearnHost(host, state.autoLearnHosts || [], state.disabledHosts || []);
  autoLearn.disabled = !host || !enabled;
}

async function refresh() {
  const token = ++refreshToken;
  const state = await chrome.runtime.sendMessage({
    type: "GET_STATE",
    includeLemmas: false,
    includeCounts: false,
  });
  if (token !== refreshToken) return;
  const tab = await getActiveTab();
  const host = hostFromUrl(tab?.url);
  hostEl.textContent = host || "当前页无法处理";
  const ready = state.apiKeyPresent && state.onboardingDone;
  setupCard.hidden = ready;
  setupStatus.textContent = ready
    ? ""
    : "还没有完成初始化（词表页）或未填写 Key（翻译器设置）";
  const enabled = isSiteEnabled(host, state.disabledHosts || []);
  siteEnabled.checked = enabled;
  siteEnabled.disabled = !host;
  window.__tabId = tab?.id;
  window.__tabUrl = tab?.url || "";
  window.__host = host;
  if (!autoLearnBusy) applyAutoLearn(host, state);
  const difficulty = state.difficulty || "default";
  for (const input of document.querySelectorAll("input[name='difficulty']")) {
    input.checked = input.value === difficulty;
  }
  setViewSwitch(
    initialViewMode({
      host,
      autoLearnHosts: state.autoLearnHosts || [],
      disabledHosts: state.disabledHosts || [],
      apiKeyPresent: state.apiKeyPresent,
      onboardingDone: state.onboardingDone,
    }),
  );
  if (tab?.id && ready && enabled) {
    const status = await sendToTab(tab.id, tab.url, { type: "CONTENT_STATUS" });
    if (token !== refreshToken) return;
    if (status?.mode) setViewSwitch(status.mode);
  }
}

document.getElementById("openSettings").onclick = () => {
  chrome.runtime.openOptionsPage();
};

siteEnabled.onchange = async () => {
  if (!window.__host) return;
  await chrome.runtime.sendMessage({
    type: "TOGGLE_HOST",
    host: window.__host,
    disabled: !siteEnabled.checked,
  });
  autoLearn.disabled = !siteEnabled.checked;
  if (!siteEnabled.checked) {
    autoLearn.checked = false;
    if (window.__tabId) {
      await sendToTab(window.__tabId, window.__tabUrl, { type: "RESTORE_PAGE" });
      setViewSwitch("original");
    }
  }
};

autoLearn.onchange = async () => {
  const host = window.__host;
  const enabled = autoLearn.checked;
  if (!host || !siteEnabled.checked) {
    autoLearn.checked = false;
    return;
  }
  autoLearnBusy = true;
  try {
    const result = await chrome.runtime.sendMessage({
      type: "TOGGLE_AUTO_LEARN",
      host,
      enabled,
    });
    if (result?.error) throw new Error(result.error);
    autoLearn.checked = (result.autoLearnHosts || []).includes(host);
    if (autoLearn.checked && window.__tabId) {
      const processed = await sendToTab(window.__tabId, window.__tabUrl, { type: "PROCESS_PAGE" });
      message.textContent = processed?.error || "";
      if (!processed?.error) setViewSwitch("learning");
    }
  } catch (error) {
    autoLearn.checked = !enabled;
    message.textContent = error.message || "默认学习视图保存失败";
  } finally {
    autoLearnBusy = false;
  }
};

for (const input of document.querySelectorAll("input[name='difficulty']")) {
  input.onchange = async () => {
    if (!input.checked) return;
    await chrome.runtime.sendMessage({ type: "SET_DIFFICULTY", difficulty: input.value });
  };
}

learnBtn.onclick = async () => {
  message.textContent = "";
  if (!window.__tabId) return;
  setViewSwitch("learning");
  const result = await sendToTab(window.__tabId, window.__tabUrl, { type: "PROCESS_PAGE" });
  message.textContent = result?.error || "";
  if (result?.error) setViewSwitch("original");
};

originalBtn.onclick = async () => {
  message.textContent = "";
  if (!window.__tabId) return;
  setViewSwitch("original");
  const result = await sendToTab(window.__tabId, window.__tabUrl, { type: "RESTORE_PAGE" });
  message.textContent = result?.error || "";
};

document.getElementById("clearCache").onclick = async () => {
  message.textContent = "";
  if (!window.__tabId) return;
  const result = await sendToTab(window.__tabId, window.__tabUrl, { type: "CLEAR_PAGE_CACHE" });
  message.textContent = result?.error || "已清除本页缓存";
  if (!result?.error) setViewSwitch("original");
};

refresh().catch(() => {
  setupCard.hidden = false;
  setupStatus.textContent = "无法读取扩展状态";
});
