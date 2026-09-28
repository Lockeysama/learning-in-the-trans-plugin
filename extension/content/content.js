import { draftSet } from "../shared/draft.js";
import { detectLang } from "../shared/detect.js";
import { indexMwes, tokenize, uniqueUnknown } from "../shared/tokenize.js";
import { blockElements, extractTargets, isMailHost } from "./extract.js";
import {
  cacheFits,
  clearStoredPageCache,
  clearTargetCache,
  commitLearning,
  copyProcessedHtml,
  discardWork,
  hasOriginal,
  hydratePageCache,
  lexiconFingerprint,
  persistPageCache,
  readStoredPageCache,
  refreshSource,
  restore,
  saveLearning,
  showLearning,
  showTranslation,
  saveTranslation,
  sourceHtml,
  workingCopy,
  pageViewId,
} from "./original.js";
import {
  applyGlossStyle,
  ensureGlossStyle,
  fragmentFromTokens,
  replaceTextNode,
  upgradeCachedGlosses,
  walkTextNodes,
} from "./render.js";
import { STORAGE_KEYS } from "../shared/constants.js";
import { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, FRAGMENT_MAX_CHARS, packBatches, splitFragment } from "../shared/chunks.js";
import { explainRuntimeError, isStaleExtensionError, sendRuntime } from "../shared/messages.js";
import { shouldAutoLearnPage } from "../shared/site.js";
import { mountSelector } from "./select.js";
import { mountToolbar, setToolbar } from "./toolbar.js";
import { translateFullText } from "./full-translation.js";

const alreadyLoaded = Boolean(globalThis.__littpLoaded);
globalThis.__littpLoaded = true;

let root = null;
let tracked = [];
let mode = "original";
let processing = false;
let processWait = null;
let pendingView = null;
let barError = false;
let debugEnabled = false;
let reprocessTimer = 0;
let autoLearnTimer = 0;
let autoLearnAttempts = 0;
let autoLearnWatching = false;
let suppressAutoLearn = false;
let viewEpoch = 0;
let lastViewId = "";
let barDismissed = false;

function log(...args) {
  if (debugEnabled) console.info("[Littp]", ...args);
}

function currentHost() {
  return location.hostname;
}

function frameLooksLikeReadingPane() {
  if (window === window.top) return true;
  const height = document.documentElement?.clientHeight || window.innerHeight || 0;
  const width = document.documentElement?.clientWidth || window.innerWidth || 0;
  return height > 120 && width > 200;
}

async function getState(opts = {}) {
  return sendRuntime({ type: "GET_STATE", ...opts });
}

async function getStateWithRetry(opts = {}) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const state = await getState(opts);
      if (state && !state.error) return state;
      lastError = state?.error;
      if (typeof lastError === "string" && lastError.includes("请刷新页面")) break;
    } catch (error) {
      lastError = error;
      if (isStaleExtensionError(error)) break;
    }
    await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  throw new Error(explainRuntimeError(lastError, lastError?.message || lastError || "无法读取扩展状态"));
}

async function translateChinese(target, { onBatch } = {}) {
  const blocks = blockElements(target)
    .map((el) => ({
      el,
      parts: splitFragment((el.innerText || el.textContent || "").trim(), FRAGMENT_MAX_CHARS),
    }))
    .filter((block) => block.parts.length);
  if (!blocks.length) return;
  const pieces = [];
  for (const block of blocks) {
    block.parts.forEach((text, index) => {
      pieces.push({ block, index, text });
    });
  }
  log("translate paragraphs", pieces.length, "in", blocks.length, "blocks");
  for (const batch of packBatches(pieces, {
    maxItems: BATCH_MAX_ITEMS,
    maxChars: BATCH_MAX_CHARS,
    textOf: (piece) => piece.text,
  })) {
    const translated = await sendRuntime({
      type: "TRANSLATE_PARAS",
      paragraphs: batch.map((piece) => piece.text),
    });
    if (translated?.error) throw new Error(translated.error);
    const dirty = new Set();
    batch.forEach((piece, index) => {
      piece.block.parts[piece.index] = String(translated[index] || "").trim() || piece.text;
      dirty.add(piece.block);
    });
    for (const block of dirty) block.el.textContent = block.parts.join("");
    await onBatch?.();
  }
}

async function annotateEnglish(target, knownLemmas, mwes, drafts, { onBatch } = {}) {
  const known = new Set(knownLemmas);
  const mweIndex = indexMwes(mwes || []);
  const nodes = walkTextNodes(target);
  const groups = nodes.map((node) => {
    const sentence = (node.parentElement?.innerText || node.parentElement?.textContent || node.nodeValue || "").slice(0, 280);
    return {
      node,
      sentence,
      tokens: tokenize(node.nodeValue, { known, mweIndex, drafts }),
    };
  });
  const batches = packBatches(groups, {
    maxItems: BATCH_MAX_ITEMS,
    maxChars: BATCH_MAX_CHARS,
    textOf: (group) => group.node.nodeValue || "",
    countOf: (group) => group.tokens.filter((token) => token.type === "unknown").length,
  });
  for (const batch of batches) {
    const items = uniqueUnknown(batch);
    log("unknown units", items.length, items.slice(0, 12));
    let glossMap = {};
    if (items.length) {
      const result = await sendRuntime({ type: "GLOSS", items });
      if (result?.error) throw new Error(result.error);
      glossMap = result || {};
    }
    ensureGlossStyle();
    for (const group of batch) {
      replaceTextNode(group.node, fragmentFromTokens(group.tokens, glossMap));
    }
    await onBatch?.();
  }
}

function track(target) {
  if (target && !tracked.includes(target)) tracked.push(target);
}

function connectedTargets() {
  tracked = tracked.filter((node) => node && node.isConnected !== false);
  return tracked;
}

async function waitForTargets(ms = 4000, { minText = 0 } = {}) {
  const started = Date.now();
  let found = [];
  while (Date.now() - started <= ms) {
    found = extractTargets(document, currentHost());
    const text = found.reduce(
      (sum, node) => sum + String(node?.innerText || node?.textContent || "").trim().length,
      0,
    );
    if (found.length && text >= minText) return found;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return found;
}

function sessionStore() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}

function pageHref() {
  return location.href;
}

function hydrateTarget(target, lexiconKey) {
  if (cacheFits(target, { lexiconKey, viewingLearning: mode !== "original" })) return true;
  const live = sourceHtml(target, mode !== "original");
  return hydratePageCache(target, readStoredPageCache(sessionStore(), pageHref()), lexiconKey, live);
}

async function loadGlossStyle() {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.glossStyle);
  applyGlossStyle(stored[STORAGE_KEYS.glossStyle]);
}

function refreshGlossPresentation(target, lexiconKey) {
  ensureGlossStyle();
  if (!upgradeCachedGlosses(target)) return;
  saveLearning(target);
  persistPageCache(sessionStore(), pageHref(), target, lexiconKey);
}

function applyLearningView(target, lexiconKey) {
  if (!showLearning(target)) return false;
  refreshGlossPresentation(target, lexiconKey);
  return true;
}

async function processTarget(target, state, { force = false, lexiconKey, view = "learning", targetLanguage, checkCurrent }) {
  checkCurrent?.();
  track(target);
  refreshSource(target, mode !== "original");
  if (!force) {
    if (view === "translated") return { cached: showTranslation(target, targetLanguage) };
    hydrateTarget(target, lexiconKey);
    if (cacheFits(target, { lexiconKey, viewingLearning: mode !== "original" }) && applyLearningView(target, lexiconKey)) {
      return { cached: true };
    }
    return { cached: false };
  }
  const work = workingCopy(target);
  if (!work) return { cached: false, skipped: true };
  try {
    if (view === "translated") {
      await translateFullText(work, targetLanguage, sendRuntime, {
        checkCurrent,
        onBatch: (done, total) => {
          checkCurrent?.();
          copyProcessedHtml(target, work);
          updateBar({ status: `全文翻译中 ${done}/${total}…` });
        },
      });
      checkCurrent?.();
      saveTranslation(target, work, targetLanguage);
      return { cached: false };
    }
    const lang = detectLang(work.textContent || work.innerText || "");
    log("process", { lang, host: currentHost(), known: state.knownLemmas?.length });
    const flush = () => { checkCurrent?.(); copyProcessedHtml(target, work); };
    if (lang === "zh") await translateChinese(work, { onBatch: flush });
    await annotateEnglish(
      work,
      state.knownLemmas || [],
      state.mwes || [],
      draftSet(state.extraUnknowns),
      { onBatch: flush },
    );
    commitLearning(target, work);
    persistPageCache(sessionStore(), pageHref(), target, lexiconKey);
  } catch (error) {
    discardWork(work);
    checkCurrent?.();
    if (hasOriginal(target)) restore(target);
    throw error;
  }
  return { cached: false };
}

function scheduleReprocess() {
  if (mode !== "learning") return;
  clearTimeout(reprocessTimer);
  reprocessTimer = setTimeout(() => {
    processPage({ force: true });
  }, 400);
}

async function processPageNow({ force = false, wait = false, view = "learning", epoch } = {}) {
  const stillThisPage = () => epoch === viewEpoch;
  const checkCurrent = () => { if (!stillThisPage()) throw new Error("view_changed"); };
  const light = await getStateWithRetry({ includeLemmas: false, includeCounts: false });
  if (!stillThisPage()) return { skipped: true };
  debugEnabled = Boolean(light?.debugEnabled);
  if (light?.error) {
    updateBar({ mode, status: "扩展未就绪" });
    return { error: light.error };
  }
  if (!light.apiKeyPresent || (view === "learning" && !light.onboardingDone)) {
    mountUi();
    updateBar({ mode: "original", status: "请先完成初始设置" });
    return { error: "请先完成初始设置" };
  }
  if ((light.disabledHosts || []).includes(currentHost())) {
    mountUi();
    updateBar({ mode: "original", status: "当前站点已关闭" });
    showOriginal();
    return { error: "当前站点已关闭" };
  }

  let targets = extractTargets(document, currentHost());
  const shouldWait =
    wait ||
    (!targets.length && isMailHost(currentHost()) && frameLooksLikeReadingPane());
  if (shouldWait) {
    mountUi();
    // The reader just asked for the reading view and the body is still settling, so
    // this status is worth showing even though `processing` has not flipped yet.
    updateBar({
      mode,
      status: wait ? (view === "translated" ? "正在进入全文翻译…" : "正在进入学习视图…") : "正在等待邮件正文…",
      visible: !barDismissed,
    });
    const waited = await waitForTargets(wait ? 6000 : 4000, { minText: wait ? 80 : 0 });
    if (!stillThisPage()) return { skipped: true };
    if (waited.length) targets = waited;
  }
  if (!targets.length) {
    if (window !== window.top) return { skipped: true };
    mountUi();
    updateBar({
      mode: "original",
      status: isMailHost(currentHost()) ? "请点开邮件正文后再切换" : "没有找到可阅读正文",
    });
    return { skipped: true, error: "没有找到可阅读正文" };
  }

  const lexiconKey = lexiconFingerprint(light);
  const targetLanguage = view === "translated"
    ? (detectLang(targets.map(target => {
      const work = document.createElement("div");
      work.innerHTML = sourceHtml(target, mode !== "original");
      return work.textContent;
    }).join("\n")) === "zh" ? "en" : "zh") : null;
  if (view === "learning" && !force && mode === "learning") {
    const stillValid = targets.every((target) => {
      track(target);
      return hydrateTarget(target, lexiconKey)
        && cacheFits(target, { lexiconKey, viewingLearning: true });
    });
    if (stillValid) {
      for (const target of targets) refreshGlossPresentation(target, lexiconKey);
      mountUi();
      updateBar({ mode, status: "学习视图" });
      return { ok: true, mode, cached: true };
    }
  }

  processing = true;
  mountUi();
  try {
    let usedCache = true;
    let state = light;
    if (force) {
      usedCache = false;
      updateBar({ mode, status: "处理中…" });
      if (view === "learning") state = await getStateWithRetry();
      if (!stillThisPage()) return { skipped: true };
    }
    for (const target of targets) {
      if (!stillThisPage()) return { skipped: true };
      if (!force && (await processTarget(target, state, { force: false, lexiconKey, view, targetLanguage, checkCurrent })).cached) {
        continue;
      }
      usedCache = false;
      updateBar({ mode, status: "处理中…" });
      if (view === "learning" && state === light) state = await getStateWithRetry();
      if (!stillThisPage()) return { skipped: true };
      await processTarget(target, state, { force: true, lexiconKey, view, targetLanguage, checkCurrent });
    }
    if (!stillThisPage()) return { skipped: true };
    root = targets[0];
    mode = view;
    updateBar({ mode, status: view === "translated" ? (targetLanguage === "zh" ? "全文 · 中文" : "全文 · 英文") : "学习视图" });
    return { ok: true, mode, cached: usedCache };
  } catch (error) {
    if (!stillThisPage()) return { skipped: true };
    showOriginal();
    mode = "original";
    barError = true;
    updateBar({ mode, status: "处理失败，已回原文" });
    log("failed", error?.message || error);
    if (debugEnabled) console.warn("Littp failed", error);
    return { error: error.message || "failed" };
  }
}

function processPage(opts = {}) {
  const view = opts.view || "learning";
  if (processWait && pendingView === view) return processWait;
  if (processWait) showOriginal();
  const epoch = ++viewEpoch;
  pendingView = view;
  barError = false;
  clearTimeout(reprocessTimer);
  suppressAutoLearn = true;
  const pending = processPageNow({ ...opts, view, epoch }).catch(error => {
    if (epoch !== viewEpoch) return { skipped: true };
    showOriginal();
    barError = true;
    updateBar({ status: explainRuntimeError(error) });
    return { error: explainRuntimeError(error), mode };
  }).finally(() => {
    if (processWait !== pending) return;
    processWait = null;
    pendingView = null;
    processing = false;
    updateBar();
  });
  processWait = pending;
  return pending;
}

function cancelProcessing() {
  viewEpoch += 1;
  processWait = null;
  pendingView = null;
  processing = false;
  barError = false;
  clearTimeout(reprocessTimer);
}

function showOriginal({ persist = false } = {}) {
  cancelProcessing();
  for (const target of connectedTargets()) {
    if (hasOriginal(target)) restore(target);
  }
  if (!tracked.length) {
    const fallback = extractTargets(document, currentHost())[0];
    if (fallback) {
      track(fallback);
      if (hasOriginal(fallback)) restore(fallback);
    }
  }
  mode = "original";
  if (persist) suppressAutoLearn = true;
  updateBar({ mode, status: "原文" });
  return { ok: true, mode };
}

async function toggleLearning() {
  if (mode === "learning") {
    mountUi();
    return showOriginal({ persist: true });
  }
  suppressAutoLearn = false;
  return processPage({ force: false, wait: true });
}

async function clearPageCache() {
  showOriginal({ persist: true });
  const epoch = viewEpoch;
  const href = pageHref();
  for (const target of connectedTargets()) {
    clearTargetCache(target);
  }
  const fallback = extractTargets(document, currentHost())[0];
  if (fallback) clearTargetCache(fallback);
  clearStoredPageCache(sessionStore(), href);
  mode = "original";
  mountUi();
  const result = await sendRuntime({ type: "CLEAR_TRANSLATION_CACHE" });
  if (epoch !== viewEpoch) return { skipped: true };
  if (result?.error) {
    barError = true;
    updateBar({ mode, status: result.error });
    return result;
  }
  updateBar({ mode, status: "已清除本页缓存" });
  return { ok: true, mode, cleared: true };
}

// The bar is an affordance for the reading view, not a resident widget: it stays
// hidden while the page sits in the original view, and the × button hides it for the
// rest of the current activation.
function updateBar({ mode: nextMode = mode, status, visible } = {}) {
  setToolbar({
    mode: nextMode,
    status,
    visible: visible ?? (!barDismissed && (processing || barError || nextMode !== "original")),
  });
}

function hideBar() {
  barDismissed = true;
  updateBar();
}

function mountUi() {
  mountToolbar({
    onOriginal: () => showOriginal({ persist: true }),
    onLearning: () => {
      suppressAutoLearn = false;
      processPage({ force: false });
    },
    onTranslate: () => processPage({ view: "translated" }),
    onHide: hideBar,
  });
}

function currentViewId() {
  return pageViewId(pageHref());
}

function resetForNewPage() {
  lastViewId = currentViewId();
  cancelProcessing();
  suppressAutoLearn = false;
  autoLearnAttempts = 0;
  barDismissed = false;
  for (const target of connectedTargets()) clearTargetCache(target);
  tracked = [];
  root = null;
  mode = "original";
  if (window === window.top) {
    mountUi();
    updateBar({ mode: "original", status: "原文" });
  }
  scheduleAutoLearn();
  return { ok: true, mode };
}

function syncPageView() {
  const id = currentViewId();
  if (!lastViewId) {
    lastViewId = id;
    return false;
  }
  if (id === lastViewId) return false;
  lastViewId = id;
  resetForNewPage();
  return true;
}

function installPageChangeWatch() {
  if (globalThis.__littpPageWatch || window !== window.top) return;
  globalThis.__littpPageWatch = true;
  lastViewId = currentViewId();
  window.addEventListener("popstate", syncPageView);
  window.addEventListener("hashchange", syncPageView);
  for (const method of ["pushState", "replaceState"]) {
    const original = history[method];
    if (typeof original !== "function") continue;
    history[method] = function (...args) {
      const result = original.apply(this, args);
      syncPageView();
      return result;
    };
  }
}

function scheduleAutoLearn() {
  if (suppressAutoLearn || mode !== "original") return;
  clearTimeout(autoLearnTimer);
  autoLearnTimer = setTimeout(() => {
    autoLearnIfNeeded().catch((error) => log("auto learn failed", error?.message || error));
  }, 400);
}

function watchForAutoLearn() {
  if (autoLearnWatching || window !== window.top) return;
  autoLearnWatching = true;
  const observer = new MutationObserver(() => {
    if (syncPageView()) return;
    if (suppressAutoLearn || mode !== "original" || processing || processWait) return;
    scheduleAutoLearn();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

async function autoLearnIfNeeded() {
  if (suppressAutoLearn || mode !== "original") return;
  if (processWait) await processWait;
  if (suppressAutoLearn || mode !== "original" || processing) return;
  if (autoLearnAttempts >= 5) return;
  const state = await getStateWithRetry({ includeLemmas: false, includeCounts: false });
  debugEnabled = Boolean(state?.debugEnabled);
  if (
    !shouldAutoLearnPage({
      host: currentHost(),
      autoLearnHosts: state.autoLearnHosts || [],
      disabledHosts: state.disabledHosts || [],
      apiKeyPresent: state.apiKeyPresent,
      onboardingDone: state.onboardingDone,
    })
  ) {
    return;
  }
  if (window !== window.top && !extractTargets(document, currentHost()).length) return;
  autoLearnAttempts += 1;
  await processPage({ force: false, wait: true });
}

async function bootAutoLearn() {
  const state = await getStateWithRetry({ includeLemmas: false, includeCounts: false });
  debugEnabled = Boolean(state?.debugEnabled);
  if (!state?.onboardingDone || !state.apiKeyPresent) return;
  const host = currentHost();
  if ((state.disabledHosts || []).includes(host)) return;
  const hasReading = extractTargets(document, host).length > 0;
  if (window === window.top || hasReading) {
    mountUi();
    updateBar({ mode: "original", status: "原文" });
  }
  installPageChangeWatch();
  watchForAutoLearn();
  if (
    !shouldAutoLearnPage({
      host,
      autoLearnHosts: state.autoLearnHosts || [],
      disabledHosts: state.disabledHosts || [],
      apiKeyPresent: state.apiKeyPresent,
      onboardingDone: state.onboardingDone,
    })
  ) {
    return;
  }
  await autoLearnIfNeeded();
}

async function handleMessage(message) {
  if (message?.type === "PING") return { ok: true, mode };
  if (message?.type === "PROCESS_PAGE" || message?.type === "TRANSLATE_PAGE") {
    // An explicit activation (popup button or context menu) brings the bar back even
    // if the reader hid it earlier; auto-learn does not, so it stays out of the way.
    barDismissed = false;
    return processPage({
      view: message.type === "TRANSLATE_PAGE" ? "translated" : "learning",
      force: Boolean(message.force),
      wait: Boolean(message.wait),
    });
  }
  if (message?.type === "RESTORE_PAGE") return showOriginal({ persist: true });
  if (message?.type === "RESET_PAGE_VIEW") return resetForNewPage();
  if (message?.type === "CLEAR_PAGE_CACHE") return clearPageCache();
  if (message?.type === "TOGGLE_LEARNING") return toggleLearning();
  if (message?.type === "CONTENT_STATUS") return { ok: true, mode, host: currentHost() };
  return { ok: false };
}

globalThis.__littpDispatch ||= handleMessage;

if (!alreadyLoaded) {
  mountSelector({
    onTranslate: (text, sentence, mode, natural) => sendRuntime({
      type: "TRANSLATE_SELECTION", text, sentence, mode, natural,
    }),
    onAddDraft: async (text) => {
      const result = await sendRuntime({ type: "ADD_DRAFT", text });
      log("add draft", text, result);
      if (result?.error) return result;
      return { message: `已记下：还不熟悉「${result.text || text}」` };
    },
    onAddKnown: async (text) => {
      const result = await sendRuntime({ type: "ADD_KNOWN", text });
      log("add known", text, result);
      if (result?.error) return result;
      return { message: `已记下：很熟悉「${result.text || text}」` };
    },
    onPronounce: async (text, sentence) => {
      const result = await sendRuntime({ type: "PRONOUNCE", text, sentence });
      log("pronounce", text, result);
      if (result?.error) return result;
      return { message: result.message || `${result.text}  ${result.ipa}` };
    },
  });

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    handleMessage(message)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message || "failed" }));
    return true;
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.debugEnabled) debugEnabled = Boolean(changes.debugEnabled.newValue);
    if (changes.glossStyle) applyGlossStyle(changes.glossStyle.newValue);
    if (changes.autoLearnHosts) scheduleAutoLearn();
    // Vocabulary edits are saved immediately but applied on the next manual
    // refresh/processing pass, so marking a word does not interrupt reading.
    if (
      changes.difficulty ||
      changes.disabledHosts ||
      changes.coverageBands
    ) {
      scheduleReprocess();
    }
  });

  window.addEventListener("pageshow", (event) => {
    if (event.persisted) {
      suppressAutoLearn = false;
      autoLearnAttempts = 0;
    }
    syncPageView();
    scheduleAutoLearn();
  });

  loadGlossStyle().catch((error) => log("gloss style", error?.message || error));
  bootAutoLearn().catch((error) => log("auto learn boot failed", error?.message || error));
}
