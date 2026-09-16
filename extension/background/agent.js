import { chatJson } from "./deepseek.js";
import { recordBehavior, recordCall } from "./debug.js";
import { bandsFromModel, clampExtraLemmas, lexiconOverview, loadJson, mergeKnownLemmas } from "./seed.js";
import {
  MODEL,
  STORAGE_KEYS,
} from "../shared/constants.js";
import { normalizeLemmaList, selectionToDraft } from "../shared/draft.js";
import { bandsForDifficulty, fallbackBands, normalizeBands } from "../shared/difficulty.js";
import { injectContentScript, dispatchInTab } from "../shared/inject.js";
import { mergeExtraUnknowns, mergeSeedExtras } from "../shared/lexicon-view.js";
import { shouldQueueMessage } from "../shared/messages.js";
import { mergePrompts, promptOverrides, PROMPT_META, validatePrompts } from "../shared/prompts.js";
import { pageHost, shouldAutoLearnPage } from "../shared/site.js";
import { sendToTab } from "../shared/tab-bridge.js";
import { normalizeGlossStyle } from "../shared/gloss-style.js";
import { emptyUsage, readUsage } from "../shared/usage.js";

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "littp-toggle-learning",
      title: "切换学习视图",
      contexts: ["all"],
      documentUrlPatterns: ["http://*/*", "https://*/*"],
    });
  });
}

ensureContextMenu();

async function reinjectOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["http://*/*", "https://*/*"] });
  await Promise.all(
    tabs.map((tab) => (tab.id ? injectContentScript(tab.id).catch(() => {}) : Promise.resolve())),
  );
}

chrome.runtime.onInstalled.addListener((details) => {
  ensureContextMenu();
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("lexicon/index.html#init") });
  }
  reinjectOpenTabs().catch(() => {});
});

chrome.runtime.onStartup.addListener(ensureContextMenu);

let queue = Promise.resolve();

function enqueue(work) {
  const run = queue.then(work, work);
  queue = run.catch(() => {});
  return run;
}

async function getStore(keys) {
  return chrome.storage.local.get(keys);
}

async function getApiKey() {
  const { apiKey } = await getStore([STORAGE_KEYS.apiKey]);
  return apiKey || "";
}

async function lexiconParts() {
  const data = await getStore([
    STORAGE_KEYS.coverageBands,
    STORAGE_KEYS.extraLemmas,
    STORAGE_KEYS.extraUnknowns,
    STORAGE_KEYS.removedLemmas,
    STORAGE_KEYS.unknownDrafts,
  ]);
  const extraUnknowns = mergeExtraUnknowns(data);
  if ((data.removedLemmas || []).length || (data.unknownDrafts || []).length) {
    await chrome.storage.local.set({
      [STORAGE_KEYS.extraUnknowns]: extraUnknowns,
      [STORAGE_KEYS.removedLemmas]: [],
      [STORAGE_KEYS.unknownDrafts]: [],
    });
  }
  return {
    coverageBands: data.coverageBands || [],
    extraLemmas: data.extraLemmas || [],
    extraUnknowns,
    removedLemmas: [],
  };
}

async function knownFromParts(parts, difficulty) {
  const activeBands = bandsForDifficulty(parts.coverageBands, difficulty);
  return mergeKnownLemmas({
    coverageBands: activeBands,
    extraLemmas: parts.extraLemmas,
    extraUnknowns: parts.extraUnknowns,
    removedLemmas: parts.removedLemmas,
  });
}

async function getState({ includeLemmas = true, includeCounts = true } = {}) {
  const data = await getStore([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.onboardingDone,
    STORAGE_KEYS.difficulty,
    STORAGE_KEYS.disabledHosts,
    STORAGE_KEYS.autoLearnHosts,
    STORAGE_KEYS.debugEnabled,
    STORAGE_KEYS.usage,
  ]);
  const parts = await lexiconParts();
  const difficulty = data.difficulty || "default";
  const needLemmas = includeLemmas;
  const needCounts = includeLemmas || includeCounts;
  const seedLemmas = needCounts
    ? data.onboardingDone
      ? await mergeKnownLemmas(parts)
      : await mergeKnownLemmas({ coverageBands: [], extraLemmas: [] })
    : [];
  const knownLemmas = needLemmas
    ? data.onboardingDone
      ? await knownFromParts(parts, difficulty)
      : seedLemmas
    : [];
  const packagedMwes = needLemmas ? await loadJson("lexicon/mwe.json") : [];
  const unknownPhrases = needLemmas
    ? parts.extraUnknowns.filter((item) => String(item).includes(" "))
    : [];
  return {
    apiKeyPresent: Boolean(data.apiKey),
    onboardingDone: Boolean(data.onboardingDone),
    difficulty,
    coverageBands: parts.coverageBands,
    extraLemmas: parts.extraLemmas,
    extraUnknowns: parts.extraUnknowns,
    removedLemmas: parts.removedLemmas,
    activeBands: bandsForDifficulty(parts.coverageBands, difficulty),
    disabledHosts: data.disabledHosts || [],
    autoLearnHosts: data.autoLearnHosts || [],
    debugEnabled: Boolean(data.debugEnabled),
    usage: readUsage(data.usage),
    knownCount: seedLemmas.length,
    readingCount: needLemmas ? knownLemmas.length : seedLemmas.length,
    knownLemmas,
    mwes: [...packagedMwes, ...unknownPhrases],
  };
}

async function loadPrompts() {
  const data = await getStore([STORAGE_KEYS.prompts]);
  return mergePrompts(data.prompts);
}

async function callModel(action, args) {
  try {
    const result = await chatJson(args);
    await recordCall({
      action,
      request: result.request,
      rawContent: result.rawContent,
      usage: result.usage,
    });
    return result.json;
  } catch (error) {
    await recordCall({
      action,
      request: {
        model: MODEL,
        system: args.system,
        user: args.user,
      },
      rawContent: "",
      usage: emptyUsage(),
      error: error.message,
    });
    throw error;
  }
}

async function generateSeed({ profile, answers, skipped }) {
  const apiKey = await getApiKey();
  const existing = await lexiconParts();
  let coverageBands = fallbackBands(profile, answers);
  let extraLemmas = existing.extraLemmas || [];
  if (apiKey) {
    try {
      const prompts = await loadPrompts();
      const payload = await callModel("seed", {
        apiKey,
        system: prompts.seed,
        user: JSON.stringify({ profile, answers: skipped ? [] : answers, skipped: Boolean(skipped) }),
        maxTokens: 800,
      });
      coverageBands = bandsFromModel(payload, profile, answers);
      extraLemmas = mergeSeedExtras(existing.extraLemmas, clampExtraLemmas(payload.extraLemmas));
    } catch {
      coverageBands = fallbackBands(profile, answers);
    }
  }
  const stored = await getStore([STORAGE_KEYS.difficulty]);
  const patch = {
    [STORAGE_KEYS.profile]: profile,
    [STORAGE_KEYS.coverageBands]: coverageBands,
    [STORAGE_KEYS.extraLemmas]: extraLemmas,
    [STORAGE_KEYS.skipPlacement]: Boolean(skipped),
    [STORAGE_KEYS.onboardingDone]: true,
  };
  if (!stored.difficulty) patch[STORAGE_KEYS.difficulty] = "default";
  await chrome.storage.local.set(patch);
  const overview = await lexiconOverview({
    coverageBands,
    extraLemmas,
    extraUnknowns: existing.extraUnknowns,
    removedLemmas: existing.removedLemmas,
  });
  return {
    coverageBands,
    extraLemmas,
    knownCount: overview.knownCount,
    unknownCount: overview.unknownCount,
  };
}

async function getLexicon() {
  const parts = await lexiconParts();
  const overview = await lexiconOverview(parts);
  return {
    ...parts,
    ...overview,
    onboardingDone: Boolean((await getStore([STORAGE_KEYS.onboardingDone])).onboardingDone),
  };
}

async function glossItems(items) {
  const apiKey = await getApiKey();
  if (!apiKey || !items?.length) return {};
  const prompts = await loadPrompts();
  const payload = await callModel("gloss", {
    apiKey,
    system: prompts.gloss,
    user: JSON.stringify({ items }),
    maxTokens: Math.min(4000, 180 + items.length * 40),
  });
  const map = {};
  for (const item of payload.items || []) {
    const span = String(item.span || "").trim();
    const gloss = String(item.gloss || "")
      .replace(/[()（）]/g, "")
      .replace(/[A-Za-z]/g, "")
      .trim();
    if (span && gloss) map[span.toLowerCase()] = gloss;
  }
  return map;
}

async function translateParagraphs(paragraphs) {
  const apiKey = await getApiKey();
  if (!apiKey) throw new Error("missing_api_key");
  const prompts = await loadPrompts();
  const payload = await callModel("translate", {
    apiKey,
    system: prompts.translate,
    user: JSON.stringify({ paragraphs }),
    maxTokens: Math.min(4000, 200 + paragraphs.join("").length),
  });
  const translated = payload.paragraphs || [];
  return paragraphs.map((original, index) =>
    String(translated[index] || "").trim() || original,
  );
}

async function addUnknown(text) {
  const key = selectionToDraft(text) || String(text || "").toLowerCase().trim();
  if (!key) throw new Error("没有可用的英文词或短语");
  const parts = await lexiconParts();
  const extraUnknowns = normalizeLemmaList([key, ...parts.extraUnknowns]);
  const extraLemmas = (parts.extraLemmas || []).filter((item) => item !== key);
  const removedLemmas = (parts.removedLemmas || []).filter((item) => item !== key);
  await chrome.storage.local.set({
    [STORAGE_KEYS.extraUnknowns]: extraUnknowns,
    [STORAGE_KEYS.extraLemmas]: extraLemmas,
    [STORAGE_KEYS.removedLemmas]: removedLemmas,
  });
  await recordBehavior("add_unknown", key);
  return { ok: true, text: key, extraUnknowns };
}

async function removeUnknown(text) {
  const key = selectionToDraft(text) || String(text || "").toLowerCase().trim();
  const parts = await lexiconParts();
  const extraUnknowns = (parts.extraUnknowns || []).filter((item) => item !== key);
  await chrome.storage.local.set({
    [STORAGE_KEYS.extraUnknowns]: extraUnknowns,
  });
  return { ok: true, text: key, extraUnknowns };
}

async function addKnown(text) {
  const key = selectionToDraft(text) || String(text || "").toLowerCase().trim();
  if (!key) throw new Error("没有可用的英文词或短语");
  const parts = await lexiconParts();
  const extraLemmas = normalizeLemmaList([key, ...parts.extraLemmas]);
  const extraUnknowns = (parts.extraUnknowns || []).filter((item) => item !== key);
  const removedLemmas = (parts.removedLemmas || []).filter((item) => item !== key);
  await chrome.storage.local.set({
    [STORAGE_KEYS.extraLemmas]: extraLemmas,
    [STORAGE_KEYS.extraUnknowns]: extraUnknowns,
    [STORAGE_KEYS.removedLemmas]: removedLemmas,
  });
  return { ok: true, text: key };
}

async function setBands(bands) {
  const coverageBands = normalizeBands(bands);
  await chrome.storage.local.set({
    [STORAGE_KEYS.coverageBands]: coverageBands,
  });
  return { ok: true, coverageBands };
}

async function sendToActiveTab(tab, payload, frameId) {
  const full = tab?.id ? await chrome.tabs.get(tab.id).catch(() => tab) : tab;
  return sendToTab({
    tabId: full.id,
    url: full.url,
    frameId,
    payload,
    send: (tabId, message, id) =>
      chrome.tabs.sendMessage(tabId, message, Number.isInteger(id) ? { frameId: id } : {}),
    inject: injectContentScript,
    dispatch: dispatchInTab,
  });
}

async function tabShouldAutoLearn(url) {
  const host = pageHost(url);
  if (!host) return false;
  const data = await getStore([
    STORAGE_KEYS.apiKey,
    STORAGE_KEYS.onboardingDone,
    STORAGE_KEYS.disabledHosts,
    STORAGE_KEYS.autoLearnHosts,
  ]);
  return shouldAutoLearnPage({
    host,
    autoLearnHosts: data.autoLearnHosts || [],
    disabledHosts: data.disabledHosts || [],
    apiKeyPresent: Boolean(data.apiKey),
    onboardingDone: Boolean(data.onboardingDone),
  });
}

const autoLearnTimers = new Map();

function scheduleTabAutoLearn(tab, { urlChanged = false } = {}) {
  if (!tab?.id || !tab.url) return;
  const tabId = tab.id;
  clearTimeout(autoLearnTimers.get(tabId));
  autoLearnTimers.set(
    tabId,
    setTimeout(async () => {
      autoLearnTimers.delete(tabId);
      try {
        const latest = await chrome.tabs.get(tabId);
        if (await tabShouldAutoLearn(latest.url)) {
          await sendToActiveTab(latest, { type: "PROCESS_PAGE", force: false, wait: true });
          return;
        }
        if (urlChanged) await sendToActiveTab(latest, { type: "RESET_PAGE_VIEW" });
      } catch {
        /* tab closed or cannot inject */
      }
    }, 500),
  );
}

chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
  if (changeInfo.url) {
    scheduleTabAutoLearn(tab, { urlChanged: true });
    return;
  }
  if (changeInfo.status === "complete") scheduleTabAutoLearn(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "littp-toggle-learning") return;
  const run = async () => {
    const current =
      tab?.id != null ? tab : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
    if (!current?.id) return { error: "没有可处理的标签页" };
    await recordBehavior("context_toggle", current.url);
    const frameId = Number.isInteger(info.frameId) ? info.frameId : undefined;
    const status = await sendToActiveTab(current, { type: "CONTENT_STATUS" }, frameId);
    const payload =
      status?.mode === "learning"
        ? { type: "RESTORE_PAGE" }
        : { type: "PROCESS_PAGE", wait: true };
    const result = await sendToActiveTab(current, payload, frameId);
    await chrome.action.setBadgeText({ text: result?.error && !result?.skipped ? "!" : "" });
    if (result?.error && !result?.skipped) {
      await chrome.action.setBadgeBackgroundColor({ color: "#9a3412" });
    }
    return result;
  };
  return run();
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const run = async () => {
    switch (message?.type) {
      case "GET_STATE":
        return getState({
          includeLemmas: message.includeLemmas !== false,
          includeCounts: message.includeCounts !== false,
        });
      case "GET_LEXICON":
        return getLexicon();
      case "GET_STATS": {
        const data = await getStore([STORAGE_KEYS.usage, STORAGE_KEYS.debugLogs, STORAGE_KEYS.debugEnabled]);
        return {
          usage: readUsage(data.usage),
          logs: data.debugLogs || [],
          debugEnabled: Boolean(data.debugEnabled),
        };
      }
      case "GENERATE_SEED":
        return generateSeed(message);
      case "GLOSS":
        await recordBehavior("gloss_request", { count: message.items?.length || 0, url: sender.tab?.url });
        return glossItems(message.items || []);
      case "TRANSLATE_PARAS":
        await recordBehavior("translate_request", { count: message.paragraphs?.length || 0 });
        return translateParagraphs(message.paragraphs || []);
      case "SET_DEBUG":
        await chrome.storage.local.set({ [STORAGE_KEYS.debugEnabled]: Boolean(message.enabled) });
        await recordBehavior("debug", message.enabled ? "on" : "off");
        return { ok: true, debugEnabled: Boolean(message.enabled) };
      case "SET_DIFFICULTY":
        await chrome.storage.local.set({
          [STORAGE_KEYS.difficulty]: message.difficulty || "default",
        });
        return { ok: true, difficulty: message.difficulty || "default" };
      case "TOGGLE_HOST": {
        const { disabledHosts = [], autoLearnHosts = [] } = await getStore([
          STORAGE_KEYS.disabledHosts,
          STORAGE_KEYS.autoLearnHosts,
        ]);
        const host = message.host;
        const nextDisabled = new Set(disabledHosts);
        const nextAuto = new Set(autoLearnHosts);
        if (message.disabled) {
          nextDisabled.add(host);
          nextAuto.delete(host);
        } else {
          nextDisabled.delete(host);
        }
        const disabled = [...nextDisabled];
        const autoLearn = [...nextAuto];
        await chrome.storage.local.set({
          [STORAGE_KEYS.disabledHosts]: disabled,
          [STORAGE_KEYS.autoLearnHosts]: autoLearn,
        });
        return { ok: true, disabledHosts: disabled, autoLearnHosts: autoLearn };
      }
      case "TOGGLE_AUTO_LEARN": {
        const { autoLearnHosts = [], disabledHosts = [] } = await getStore([
          STORAGE_KEYS.autoLearnHosts,
          STORAGE_KEYS.disabledHosts,
        ]);
        const host = message.host;
        const next = new Set(autoLearnHosts);
        if (message.enabled && host && !disabledHosts.includes(host)) next.add(host);
        else next.delete(host);
        const autoLearn = [...next];
        await chrome.storage.local.set({
          [STORAGE_KEYS.autoLearnHosts]: autoLearn,
        });
        return { ok: true, autoLearnHosts: autoLearn };
      }
      case "SAVE_KEY":
        await chrome.storage.local.set({ [STORAGE_KEYS.apiKey]: message.apiKey || "" });
        return { ok: true };
      case "SAVE_GLOSS_STYLE": {
        const glossStyle = normalizeGlossStyle(message.glossStyle);
        await chrome.storage.local.set({ [STORAGE_KEYS.glossStyle]: glossStyle });
        return { ok: true, glossStyle };
      }
      case "GET_PROMPTS": {
        const data = await getStore([STORAGE_KEYS.prompts]);
        return {
          ok: true,
          prompts: mergePrompts(data.prompts),
          defaults: mergePrompts({}),
          meta: PROMPT_META,
        };
      }
      case "SAVE_PROMPTS": {
        const check = validatePrompts(message.prompts);
        if (!check.ok) return { error: check.error };
        const prompts = promptOverrides(message.prompts);
        await chrome.storage.local.set({ [STORAGE_KEYS.prompts]: prompts });
        return { ok: true, prompts: mergePrompts(prompts) };
      }
      case "RESET_PROMPTS": {
        await chrome.storage.local.set({ [STORAGE_KEYS.prompts]: {} });
        return { ok: true, prompts: mergePrompts({}) };
      }
      case "ADD_DRAFT":
      case "ADD_UNKNOWN":
      case "REMOVE_KNOWN":
        return addUnknown(message.text);
      case "REMOVE_DRAFT":
      case "REMOVE_UNKNOWN":
        return removeUnknown(message.text);
      case "ADD_KNOWN":
        return addKnown(message.text);
      case "SET_BANDS":
        return setBands(message.bands);
      case "CLEAR_LOGS":
        await chrome.storage.local.set({ [STORAGE_KEYS.debugLogs]: [] });
        return { ok: true };
      case "CLEAR_STATS":
        await chrome.storage.local.set({ [STORAGE_KEYS.usage]: emptyUsage() });
        return { usage: emptyUsage() };
      default:
        return { error: "unknown_message" };
    }
  };
  const pending = shouldQueueMessage(message?.type) ? enqueue(run) : run();
  pending.then(sendResponse).catch((error) => sendResponse({ error: error.message || "failed" }));
  return true;
});
