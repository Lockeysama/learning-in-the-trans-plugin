import { selectionToDraft } from "../shared/draft.js";
import { explainRuntimeError } from "../shared/messages.js";
import { eventFromWidget } from "../shared/site.js";
import { MAX_SELECTION_CONTEXT } from "../shared/selection-translation.js";

const HOST_ID = "littp-select-host";

function ensureHost() {
  document.getElementById(HOST_ID)?.remove();
  const host = document.createElement("div");
  host.id = HOST_ID;
  host.style.all = "initial";
  host.style.position = "fixed";
  host.style.zIndex = "2147483647";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = "0";
  host.style.height = "0";
  host.style.overflow = "visible";
  host.style.pointerEvents = "none";
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .wrap { position: fixed; z-index: 2147483647; pointer-events: none; }
      .dot, .menu.open { pointer-events: auto; }
      .dot {
        padding: 0;
        display: block;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 2px solid #fffcf6;
        background: #0f766e;
        box-shadow: 0 4px 12px rgba(15, 23, 42, 0.28);
        cursor: pointer;
      }
      .menu {
        display: none;
        margin-top: 6px;
        width: min(360px, calc(100vw - 16px));
        max-height: calc(100vh - 48px);
        background: #142523;
        color: #f4f4f1;
        border-radius: 10px;
        overflow: auto;
        overscroll-behavior: contain;
        overflow-wrap: anywhere;
        font: 13px/1.4 ui-sans-serif, system-ui, sans-serif;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.3);
      }
      .menu.open { display: block; }
      button {
        display: block;
        width: 100%;
        text-align: left;
        border: 0;
        background: transparent;
        color: inherit;
        padding: 8px 12px;
        cursor: pointer;
      }
      button:hover { background: #1f3d3a; }
      button:disabled { opacity: .5; cursor: default; }
      .menu > button { position: relative; padding-right: 32px; }
      .menu > button[aria-expanded="true"] {
        background: #285046;
        color: #d9f4e5;
        box-shadow: inset 3px 0 #9fe0ce;
        font-weight: 600;
        opacity: 1;
      }
      .menu > button[aria-expanded="true"]::after {
        content: "▾";
        position: absolute;
        right: 12px;
        color: #9fe0ce;
      }
      button:focus-visible, summary:focus-visible { outline: 2px solid #9fe0ce; outline-offset: -2px; }
      [hidden] { display: none !important; }
      .translation, .status {
        background: #f3f7f2;
        color: #243c35;
        border-top: 1px solid #d4e2d8;
      }
      .translation { padding: 12px; line-height: 1.65; }
      .translation p { margin: 6px 0; white-space: pre-wrap; }
      .source { color: #566d63; font-size: 12px; max-height: 5em; overflow: auto; }
      .label { color: #246c59; font-size: 12px; }
      .translation h3 { font-size: 13px; margin: 10px 0 4px; color: #246c59; }
      .translation details { margin-top: 10px; border-top: 1px solid #d4e2d8; padding-top: 8px; }
      .translation summary { cursor: pointer; color: #246c59; }
      .translation dl { margin: 8px 0; }
      .translation dt { font-weight: 600; margin-top: 8px; }
      .translation dd { margin: 2px 0 0; }
      .translation .note, .translation .role { color: #566d63; font-size: 12px; }
      .translation .retry { margin-top: 6px; border: 1px solid #b8cec1; border-radius: 6px; color: #246c59; }
      .translation button:hover { background: #e3eee5; }
      .translation button:focus-visible, .translation summary:focus-visible { outline-color: #246c59; }
      .status { padding: 10px 12px; }
      .status[data-kind="ipa"] {
        color: #246c59;
        font-size: 15px;
        line-height: 1.55;
        letter-spacing: 0.01em;
      }
    </style>
    <div class="wrap" id="wrap" hidden>
      <button type="button" class="dot" id="dot" title="划词菜单" aria-label="划词菜单" aria-expanded="false"></button>
      <div class="menu" id="menu">
        <button type="button" id="translate" aria-expanded="false" aria-controls="translation">马上翻译这个</button>
        <button type="button" id="addDraft" aria-expanded="false" aria-controls="status">下次翻译一下这个</button>
        <button type="button" id="addKnown" aria-expanded="false" aria-controls="status">这个下次不用翻译了</button>
        <button type="button" id="pronounce" aria-expanded="false" aria-controls="status">这个怎么读</button>
        <div class="status" id="status" role="status" hidden></div>
        <section class="translation" id="translation" aria-label="即时翻译结果" hidden></section>
      </div>
    </div>
  `;
  return host;
}

function visibleRect(rects) {
  return [...rects].findLast?.((rect) => rect.width || rect.height)
    || [...rects].reverse().find((rect) => rect.width || rect.height)
    || null;
}

export function selectionAnchor(selection, event) {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  for (const node of [range.startContainer, range.endContainer]) {
    const element = node?.nodeType === 1 ? node : node?.parentElement;
    if (element?.isContentEditable || element?.closest("input, textarea")) return null;
  }
  const text = selection.toString().trim();
  if (!text || !/\p{L}/u.test(text)) return null;
  const draft = selectionToDraft(text);
  const rect = visibleRect(range.getClientRects()) || range.getBoundingClientRect();
  const hasBox = rect && (rect.width || rect.height);
  const x = hasBox ? rect.right : event?.clientX;
  const y = hasBox ? rect.top : event?.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const sentence = selectionContext(range, text);
  return { text, draft, sentence, x, y };
}

// Use the range's document-order start (also for backwards selections), including
// surrounding inline siblings. Center the bounded context on the actual occurrence.
export function selectionContext(range, text) {
  const common = range.commonAncestorContainer;
  const element = common?.nodeType === 1 ? common : common?.parentElement;
  const block = element?.closest("p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, div") || element;
  if (!block) return text.slice(0, MAX_SELECTION_CONTEXT);
  const prefix = range.cloneRange();
  prefix.selectNodeContents(block);
  prefix.setEnd(range.startContainer, range.startOffset);
  const offset = prefix.toString().length;
  const context = block.textContent || text;
  const start = Math.max(0, offset - Math.max(0, Math.floor((MAX_SELECTION_CONTEXT - text.length) / 2)));
  return context.slice(start, start + MAX_SELECTION_CONTEXT);
}

export function mountSelector({ onAddDraft, onAddKnown, onPronounce, onTranslate }) {
  const host = ensureHost();
  const root = host.shadowRoot;
  const wrap = root.getElementById("wrap");
  const menu = root.getElementById("menu");
  const status = root.getElementById("status");
  const dot = root.getElementById("dot");
  const translation = root.getElementById("translation");
  const translateButton = root.getElementById("translate");
  let current = { text: "", draft: "", sentence: "" };
  let pinned = false;
  let revision = 0;
  let naturalResult = null;

  function setActiveAction(id = "") {
    for (const button of menu.querySelectorAll(":scope > button")) {
      button.setAttribute("aria-expanded", String(button.id === id));
    }
  }

  function resetResults() {
    setActiveAction();
    revision += 1;
    naturalResult = null;
    translation.hidden = true;
    translation.replaceChildren();
    translateButton.disabled = false;
    status.hidden = true;
    status.removeAttribute("data-kind");
  }

  function fitMenu() {
    if (wrap.hidden) return;
    const rect = wrap.getBoundingClientRect();
    wrap.style.left = `${Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8))}px`;
    wrap.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - rect.height - 8))}px`;
  }

  function openMenu() {
    pinned = true;
    menu.classList.add("open");
    dot.setAttribute("aria-expanded", "true");
    fitMenu();
  }

  function hide() {
    resetResults();
    wrap.hidden = true;
    menu.classList.remove("open");
    status.hidden = true;
    status.removeAttribute("data-kind");
    pinned = false;
    dot.setAttribute("aria-expanded", "false");
    current = { text: "", draft: "", sentence: "" };
  }

  function place(anchor) {
    resetResults();
    menu.classList.remove("open");
    dot.setAttribute("aria-expanded", "false");
    pinned = false;
    current = { text: anchor.text, draft: anchor.draft, sentence: anchor.sentence || "" };
    for (const id of ["addDraft", "addKnown", "pronounce"]) root.getElementById(id).disabled = !anchor.draft;
    wrap.hidden = false;
    wrap.style.left = `${Math.min(window.innerWidth - 28, Math.max(8, anchor.x + 6))}px`;
    wrap.style.top = `${Math.min(window.innerHeight - 28, Math.max(8, anchor.y - 6))}px`;
  }

  function showDot(event, snapshot) {
    const live = selectionAnchor(window.getSelection(), event);
    const anchor = live || snapshot;
    if (!anchor) {
      if (!pinned) hide();
      return;
    }
    place(anchor);
  }

  function stopBubble(event) {
    event.stopPropagation();
  }

  wrap.addEventListener("pointerdown", (event) => {
    stopBubble(event);
    pinned = true;
  });
  wrap.addEventListener("mousedown", stopBubble);
  wrap.addEventListener("mouseup", stopBubble);
  wrap.addEventListener("click", stopBubble);

  dot.addEventListener("pointerdown", (event) => {
    event.preventDefault();
    stopBubble(event);
    openMenu();
  });
  dot.addEventListener("click", openMenu);

  async function runAction(handler, { keepOpen = false, kind = "", actionId = "" } = {}) {
    if (!handler) return;
    const { draft: text, sentence } = current;
    if (!text) return;
    resetResults();
    setActiveAction(actionId);
    const requestRevision = revision;
    status.hidden = false;
    status.removeAttribute("data-kind");
    status.textContent = "处理中…";
    openMenu();
    try {
      const result = await handler(text, sentence);
      if (requestRevision !== revision) return;
      status.textContent = result?.error ? result.error : result?.message || `已处理：${text}`;
      if (result?.error) return;
      if (kind) status.dataset.kind = kind;
      fitMenu();
      if (!keepOpen) setTimeout(() => { if (requestRevision === revision) hide(); }, 700);
    } catch (error) {
      if (requestRevision !== revision) return;
      status.textContent = explainRuntimeError(error);
      fitMenu();
    }
  }

  function appendText(parent, tag, text, className = "") {
    const element = document.createElement(tag);
    element.textContent = text;
    if (className) element.className = className;
    parent.appendChild(element);
    return element;
  }

  function renderAnalysis(parent, result) {
    const list = document.createElement("dl");
    for (const unit of result.units) {
      appendText(list, "dt", unit.source);
      appendText(list, "dd", unit.meaning);
      if (unit.role) appendText(list, "dd", unit.role, "role");
    }
    parent.appendChild(list);
    if (result.structure) {
      appendText(parent, "h3", "句式与结构");
      appendText(parent, "p", result.structure);
    }
    if (result.usage) {
      appendText(parent, "h3", "用法提示");
      appendText(parent, "p", result.usage);
    }
  }

  function addDetail(mode, label, source, requestRevision) {
    const details = document.createElement("details");
    appendText(details, "summary", label);
    const body = document.createElement("div");
    body.setAttribute("aria-live", "polite");
    details.appendChild(body);
    let pending = false;
    let loaded = false;
    async function load() {
      if (pending || loaded || requestRevision !== revision) return;
      pending = true;
      body.replaceChildren();
      appendText(body, "p", "正在生成…", "note");
      try {
        const result = await onTranslate(source.text, source.sentence, mode, naturalResult.translation);
        if (requestRevision !== revision) return;
        if (result?.error) throw new Error(result.error);
        body.replaceChildren();
        if (mode === "analysis") renderAnalysis(body, result);
        else {
          if (result.translation && result.translation !== naturalResult.translation) appendText(body, "p", result.translation);
          else if (!result.note) appendText(body, "p", "与自然译文一致，无需额外对照。", "note");
          if (result.note) appendText(body, "p", result.note, "note");
        }
        loaded = true;
      } catch (error) {
        if (requestRevision !== revision) return;
        body.replaceChildren();
        appendText(body, "p", explainRuntimeError(error), "note");
        const retry = appendText(body, "button", "重试", "retry");
        retry.type = "button";
        retry.addEventListener("click", load);
      } finally {
        pending = false;
        if (requestRevision === revision) fitMenu();
      }
    }
    details.addEventListener("toggle", () => {
      if (details.open) load();
      fitMenu();
    });
    translation.appendChild(details);
  }

  async function translate() {
    if (!onTranslate || !current.text || translateButton.disabled) return;
    openMenu();
    if (naturalResult) return;
    resetResults();
    setActiveAction("translate");
    const requestRevision = revision;
    const source = { ...current };
    translateButton.disabled = true;
    translation.hidden = false;
    appendText(translation, "p", source.text, "source");
    const output = appendText(translation, "div", "");
    output.setAttribute("aria-live", "polite");
    appendText(output, "p", "正在翻译…", "note");
    fitMenu();
    try {
      const result = await onTranslate(source.text, source.sentence, "natural");
      if (requestRevision !== revision) return;
      if (result?.error) throw new Error(result.error);
      naturalResult = result;
      output.replaceChildren();
      appendText(output, "div", result.kind === "word" ? "语境释义" : "自然译文", "label");
      appendText(output, "p", result.translation);
      if (result.partOfSpeech) appendText(output, "p", result.partOfSpeech, "note");
      if (result.note) appendText(output, "p", result.note, "note");
      if (result.kind !== "word") addDetail("literal", "贴近原文", source, requestRevision);
      addDetail("analysis", result.kind === "word" ? "词义与用法" : "词句解析", source, requestRevision);
    } catch (error) {
      if (requestRevision !== revision) return;
      naturalResult = null;
      output.replaceChildren();
      appendText(output, "p", explainRuntimeError(error), "note");
      const retry = appendText(output, "button", "重试", "retry");
      retry.type = "button";
      retry.addEventListener("click", translate);
    } finally {
      if (requestRevision === revision) {
        translateButton.disabled = false;
        fitMenu();
      }
    }
  }

  translateButton.addEventListener("click", translate);

  root.getElementById("addDraft").addEventListener("click", (event) => {
    stopBubble(event);
    runAction(onAddDraft, { actionId: "addDraft" });
  });
  root.getElementById("addKnown").addEventListener("click", (event) => {
    stopBubble(event);
    runAction(onAddKnown, { actionId: "addKnown" });
  });
  root.getElementById("pronounce").addEventListener("click", (event) => {
    stopBubble(event);
    runAction(onPronounce, { keepOpen: true, kind: "ipa", actionId: "pronounce" });
  });

  document.addEventListener("mouseup", (event) => {
    if (eventFromWidget(event, host)) return;
    const snapshot = selectionAnchor(window.getSelection(), event);
    setTimeout(() => showDot(event, snapshot), 0);
  }, true);
  document.addEventListener("scroll", () => {
    if (!pinned) hide();
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") hide();
  });
  document.addEventListener("mousedown", (event) => {
    if (eventFromWidget(event, host)) return;
    if (pinned && menu.classList.contains("open")) hide();
  });
  window.addEventListener("resize", fitMenu);
  return host;
}
