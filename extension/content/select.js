import { selectionToDraft } from "../shared/draft.js";
import { explainRuntimeError } from "../shared/messages.js";
import { eventFromWidget } from "../shared/site.js";

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
        min-width: 16rem;
        background: #142523;
        color: #f4f4f1;
        border-radius: 10px;
        overflow: hidden;
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
      .status { padding: 8px 12px; color: #9fe0ce; }
      .status[data-kind="ipa"] {
        color: #ecfccb;
        font-size: 15px;
        line-height: 1.55;
        letter-spacing: 0.01em;
      }
    </style>
    <div class="wrap" id="wrap" hidden>
      <div class="dot" id="dot" title="划词菜单"></div>
      <div class="menu" id="menu">
        <button type="button" id="addDraft">我不知道这个词怎么翻译</button>
        <button type="button" id="addKnown">这个词的意思我很熟悉了</button>
        <button type="button" id="pronounce">这个怎么读</button>
        <div class="status" id="status" hidden></div>
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
  const node = selection.anchorNode;
  if (node?.parentElement?.closest("input, textarea, [contenteditable='true']")) return null;
  const draft = selectionToDraft(selection.toString());
  if (!draft) return null;
  const range = selection.getRangeAt(0);
  const rect = visibleRect(range.getClientRects()) || range.getBoundingClientRect();
  const hasBox = rect && (rect.width || rect.height);
  const x = hasBox ? rect.right : event?.clientX;
  const y = hasBox ? rect.top : event?.clientY;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const sentence = String(node?.parentElement?.innerText || node?.parentElement?.textContent || selection.toString() || "").slice(0, 280);
  return { draft, sentence, x, y };
}

export function mountSelector({ onAddDraft, onAddKnown, onPronounce }) {
  const host = ensureHost();
  const root = host.shadowRoot;
  const wrap = root.getElementById("wrap");
  const menu = root.getElementById("menu");
  const status = root.getElementById("status");
  const dot = root.getElementById("dot");
  let current = { text: "", sentence: "" };
  let pinned = false;

  function hide() {
    wrap.hidden = true;
    menu.classList.remove("open");
    status.hidden = true;
    status.removeAttribute("data-kind");
    pinned = false;
    current = { text: "", sentence: "" };
  }

  function place(anchor) {
    current = { text: anchor.draft, sentence: anchor.sentence || "" };
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
    pinned = true;
    menu.classList.add("open");
  });

  async function runAction(handler, { keepOpen = false, kind = "" } = {}) {
    if (!handler) return;
    const { text, sentence } = current;
    if (!text) return;
    status.hidden = false;
    status.removeAttribute("data-kind");
    status.textContent = "处理中…";
    pinned = true;
    menu.classList.add("open");
    try {
      const result = await handler(text, sentence);
      status.textContent = result?.error ? result.error : result?.message || `已处理：${text}`;
      if (result?.error) return;
      if (kind) status.dataset.kind = kind;
      if (!keepOpen) setTimeout(() => hide(), 700);
    } catch (error) {
      status.textContent = explainRuntimeError(error);
    }
  }

  root.getElementById("addDraft").addEventListener("click", (event) => {
    stopBubble(event);
    runAction(onAddDraft);
  });
  root.getElementById("addKnown").addEventListener("click", (event) => {
    stopBubble(event);
    runAction(onAddKnown);
  });
  root.getElementById("pronounce").addEventListener("click", (event) => {
    stopBubble(event);
    runAction(onPronounce, { keepOpen: true, kind: "ipa" });
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
  return host;
}
