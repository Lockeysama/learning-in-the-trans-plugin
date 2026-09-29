import { applyGlossStyle } from "../content/render.js";
import { DEFAULT_GLOSS_STYLE, normalizeGlossStyle } from "../shared/gloss-style.js";
import { formatTokens } from "../shared/usage.js";
import { validatePrompts } from "../shared/prompts.js";
import { applyKeyInfoStyle } from "../content/key-info-style.js";
import { DEFAULT_KEY_INFO_STYLE, DEFAULT_TRANSLATION_CONCURRENCY, normalizeKeyInfoStyle, normalizeTranslationConcurrency } from "../shared/translation-settings.js";

const apiKey = document.getElementById("apiKey");
const keyStatus = document.getElementById("keyStatus");
const usageRoot = document.getElementById("usage");
const promptList = document.getElementById("promptList");
const promptStatus = document.getElementById("promptStatus");
const glossSize = document.getElementById("glossSize");
const glossSizeValue = document.getElementById("glossSizeValue");
const glossColor = document.getElementById("glossColor");
const glossStatus = document.getElementById("glossStatus");
let promptDefaults = {};
let glossSaveTimer = 0;
const translationConcurrency = document.getElementById("translationConcurrency");
const annotationConcurrency = document.getElementById("annotationConcurrency");
const concurrencyStatus = document.getElementById("concurrencyStatus");
const keyInfoBold = document.getElementById("keyInfoBold");
const keyInfoColor = document.getElementById("keyInfoColor");
const keyInfoNoBackground = document.getElementById("keyInfoNoBackground");
const keyInfoBackground = document.getElementById("keyInfoBackground");
const keyInfoStatus = document.getElementById("keyInfoStatus");
let keyInfoSaveTimer = 0;
let keyInfoSaveQueue = Promise.resolve();

function paintConcurrency(raw) {
  const next = normalizeTranslationConcurrency(raw);
  translationConcurrency.value = next.translation;
  annotationConcurrency.value = next.annotation;
}

async function saveConcurrency(value) {
  try {
    const result = await chrome.runtime.sendMessage({ type: "SAVE_TRANSLATION_CONCURRENCY", translationConcurrency: value });
    if (result?.error) throw new Error(result.error);
    paintConcurrency(result.translationConcurrency);
    concurrencyStatus.className = "status";
    concurrencyStatus.textContent = "已保存，下一轮全文翻译生效";
  } catch (error) {
    concurrencyStatus.className = "status error";
    concurrencyStatus.textContent = error.message || "保存失败，请重试";
  }
}

function paintKeyInfoStyle(raw) {
  const next = normalizeKeyInfoStyle(raw);
  keyInfoBold.checked = next.bold;
  keyInfoColor.value = next.color;
  keyInfoNoBackground.checked = next.backgroundColor === "transparent";
  keyInfoBackground.disabled = keyInfoNoBackground.checked;
  if (!keyInfoNoBackground.checked) keyInfoBackground.value = next.backgroundColor;
  applyKeyInfoStyle(next);
}

function saveKeyInfoStyle(style) {
  // Preserve save order while the color picker emits rapid changes.
  keyInfoSaveQueue = keyInfoSaveQueue.then(async () => {
    try {
      const result = await chrome.runtime.sendMessage({ type: "SAVE_KEY_INFO_STYLE", keyInfoStyle: style });
      if (result?.error) throw new Error(result.error);
      keyInfoStatus.className = "status";
      keyInfoStatus.textContent = "已保存，打开中的全文译文已生效";
    } catch (error) {
      keyInfoStatus.className = "status error";
      keyInfoStatus.textContent = error.message || "保存失败，请重试";
    }
  });
}

function scheduleKeyInfoSave() {
  const next = normalizeKeyInfoStyle({
    bold: keyInfoBold.checked,
    color: keyInfoColor.value,
    backgroundColor: keyInfoNoBackground.checked ? "transparent" : keyInfoBackground.value,
  });
  paintKeyInfoStyle(next);
  clearTimeout(keyInfoSaveTimer);
  keyInfoSaveTimer = setTimeout(() => saveKeyInfoStyle(next), 150);
}

function renderPrompts(prompts = {}, defaults = {}, meta = []) {
  promptDefaults = defaults;
  promptList.innerHTML = meta
    .map(
      (item) => `
      <div class="item">
        <h3>${escapeHtml(item.title)}</h3>
        <p class="hint">${escapeHtml(item.hint)}</p>
        <textarea class="prompt-editor" id="prompt-${item.id}" spellcheck="false">${escapeHtml(prompts[item.id] || "")}</textarea>
        <div class="actions">
          <button type="button" class="secondary" data-reset-prompt="${item.id}">恢复这条默认</button>
        </div>
      </div>
    `,
    )
    .join("");
}

function readPromptDrafts() {
  const prompts = {};
  for (const textarea of promptList.querySelectorAll("textarea[id^='prompt-']")) {
    prompts[textarea.id.replace("prompt-", "")] = textarea.value;
  }
  return prompts;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function readGlossDraft() {
  return normalizeGlossStyle({
    size: glossSize.value,
    color: glossColor.value,
  });
}

function paintGlossStyle(style) {
  const next = normalizeGlossStyle(style);
  glossSize.value = String(next.size);
  glossSizeValue.textContent = `${next.size}%`;
  glossColor.value = next.color;
  applyGlossStyle(next);
}

function scheduleGlossSave() {
  const next = readGlossDraft();
  paintGlossStyle(next);
  clearTimeout(glossSaveTimer);
  glossSaveTimer = setTimeout(() => {
    saveGlossStyle(next);
  }, 150);
}

async function saveGlossStyle(style, message = "已保存，打开中的学习视图会马上生效") {
  const result = await chrome.runtime.sendMessage({
    type: "SAVE_GLOSS_STYLE",
    glossStyle: style,
  });
  if (result?.error) {
    glossStatus.className = "status error";
    glossStatus.textContent = result.error;
    return;
  }
  paintGlossStyle(result.glossStyle || style);
  glossStatus.className = "status";
  glossStatus.textContent = message;
}

function renderUsage(usage = {}) {
  const items = [
    ["调用次数", usage.calls],
    ["Prompt tokens", usage.promptTokens],
    ["Completion tokens", usage.completionTokens],
    ["合计", usage.totalTokens],
  ];
  usageRoot.innerHTML = items
    .map(
      ([label, value]) => `
      <div class="stat">
        <b>${formatTokens(value)}</b>
        <span>${label}</span>
      </div>
    `,
    )
    .join("");
}

async function refresh() {
  const [stats, stored, promptData] = await Promise.all([
    chrome.runtime.sendMessage({ type: "GET_STATS" }),
    chrome.storage.local.get(["apiKey", "glossStyle", "translationConcurrency", "keyInfoStyle"]),
    chrome.runtime.sendMessage({ type: "GET_PROMPTS" }),
  ]);
  if (stored.apiKey) apiKey.value = stored.apiKey;
  paintGlossStyle(stored.glossStyle);
  paintConcurrency(stored.translationConcurrency);
  paintKeyInfoStyle(stored.keyInfoStyle);
  renderUsage(stats.usage || {});
  if (promptData?.prompts) {
    renderPrompts(promptData.prompts, promptData.defaults || {}, promptData.meta || []);
  }
}

document.getElementById("saveKey").onclick = async () => {
  const value = apiKey.value.trim();
  if (!value) {
    keyStatus.textContent = "请填写 API Key";
    keyStatus.className = "status error";
    return;
  }
  await chrome.runtime.sendMessage({ type: "SAVE_KEY", apiKey: value });
  keyStatus.className = "status";
  keyStatus.textContent = "已保存";
};

glossSize.addEventListener("input", scheduleGlossSave);
glossColor.addEventListener("input", scheduleGlossSave);

document.getElementById("saveConcurrency").onclick = () => {
  if (!translationConcurrency.reportValidity() || !annotationConcurrency.reportValidity()) return;
  saveConcurrency({ translation: translationConcurrency.valueAsNumber, annotation: annotationConcurrency.valueAsNumber });
};
document.getElementById("resetConcurrency").onclick = () => saveConcurrency(DEFAULT_TRANSLATION_CONCURRENCY);
for (const input of [keyInfoBold, keyInfoColor, keyInfoNoBackground, keyInfoBackground]) {
  input.addEventListener("input", scheduleKeyInfoSave);
}
document.getElementById("resetKeyInfoStyle").onclick = () => {
  clearTimeout(keyInfoSaveTimer);
  paintKeyInfoStyle(DEFAULT_KEY_INFO_STYLE);
  saveKeyInfoStyle(DEFAULT_KEY_INFO_STYLE);
};

document.getElementById("resetGlossStyle").onclick = async () => {
  clearTimeout(glossSaveTimer);
  await saveGlossStyle(DEFAULT_GLOSS_STYLE, "已恢复默认外观");
};

document.getElementById("savePrompts").onclick = async () => {
  const drafts = readPromptDrafts();
  const check = validatePrompts(drafts);
  if (!check.ok) {
    promptStatus.className = "status error";
    promptStatus.textContent = check.error;
    return;
  }
  const result = await chrome.runtime.sendMessage({
    type: "SAVE_PROMPTS",
    prompts: drafts,
  });
  if (result?.error) {
    promptStatus.className = "status error";
    promptStatus.textContent = result.error;
    return;
  }
  const fresh = await chrome.runtime.sendMessage({ type: "GET_PROMPTS" });
  renderPrompts(fresh.prompts || {}, fresh.defaults || {}, fresh.meta || []);
  promptStatus.className = "status";
  promptStatus.textContent = "已保存，下一轮翻译会用新 Prompt";
};

promptList.addEventListener("click", (event) => {
  const button = event.target.closest("[data-reset-prompt]");
  if (!button) return;
  const id = button.dataset.resetPrompt;
  const textarea = document.getElementById(`prompt-${id}`);
  if (textarea) textarea.value = promptDefaults[id] || "";
});

document.getElementById("resetPrompts").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "RESET_PROMPTS" });
  const fresh = await chrome.runtime.sendMessage({ type: "GET_PROMPTS" });
  renderPrompts(fresh.prompts || {}, fresh.defaults || {}, fresh.meta || []);
  promptStatus.className = "status";
  promptStatus.textContent = "已恢复默认 Prompt";
};

document.getElementById("clearStats").onclick = async () => {
  await chrome.runtime.sendMessage({ type: "CLEAR_STATS" });
  await refresh();
};

refresh().catch((error) => {
  keyStatus.textContent = error.message || "无法读取设置";
  keyStatus.className = "status error";
});
