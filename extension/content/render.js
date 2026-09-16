import { isInsideChrome } from "./extract.js";
import { DEFAULT_GLOSS_STYLE, glossStyleToCss, normalizeGlossStyle } from "../shared/gloss-style.js";

const SKIP_PARENTS =
  "script,style,noscript,textarea,input,code,pre,kbd,samp,math,svg,button,select,option,#littp-toolbar-host,#littp-select-host,#littp-gloss-tip,.littp-unit,.littp-gloss";
const TIP_ID = "littp-gloss-tip";

let currentGlossStyle = DEFAULT_GLOSS_STYLE;
let tipBound = false;

export function walkTextNodes(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue) return NodeFilter.FILTER_REJECT;
      if (!/[A-Za-z]/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
      if (node.parentElement?.closest(SKIP_PARENTS)) return NodeFilter.FILTER_REJECT;
      if (isInsideChrome(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
}

export function applyGlossStyle(raw) {
  currentGlossStyle = normalizeGlossStyle(raw);
  ensureGlossStyle();
}

export function ensureGlossStyle() {
  const css = glossStyleToCss(currentGlossStyle);
  let style = document.getElementById("littp-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "littp-style";
    document.documentElement.appendChild(style);
  }
  style.textContent = `
    span.littp-unit {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      vertical-align: baseline;
      font: inherit;
      line-height: 1.15;
      row-gap: 0.06em;
    }
    span.littp-word {
      white-space: nowrap;
      text-decoration: underline;
      text-decoration-thickness: from-font;
      text-underline-offset: 0.18em;
      text-decoration-color: currentColor;
      text-decoration-skip-ink: auto;
    }
    span.littp-gloss {
      width: 0;
      min-width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: ${css.color};
      font-weight: 400;
      font-size: ${css.fontSize};
      line-height: 1.2;
      text-align: center;
      user-select: none;
    }
    #${TIP_ID} {
      position: fixed;
      z-index: 2147483647;
      max-width: min(16rem, calc(100vw - 24px));
      padding: 6px 10px;
      border-radius: 8px;
      background: #1c1917;
      color: #f5f5f4;
      font: 13px/1.45 ui-sans-serif, system-ui, "PingFang SC", sans-serif;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.28);
      pointer-events: none;
      white-space: normal;
      word-break: break-word;
    }
    #${TIP_ID}[hidden] { display: none; }
  `;
  bindGlossTip();
}

function ensureTip() {
  let tip = document.getElementById(TIP_ID);
  if (tip) return tip;
  tip = document.createElement("div");
  tip.id = TIP_ID;
  tip.hidden = true;
  document.documentElement.appendChild(tip);
  return tip;
}

function hideGlossTip() {
  const tip = document.getElementById(TIP_ID);
  if (tip) tip.hidden = true;
}

function showGlossTip(gloss) {
  if (gloss.scrollWidth <= gloss.clientWidth + 1) {
    hideGlossTip();
    return;
  }
  const tip = ensureTip();
  tip.textContent = gloss.dataset.full || gloss.textContent || "";
  tip.hidden = false;
  const rect = gloss.getBoundingClientRect();
  const pad = 8;
  const tipRect = tip.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - tipRect.width / 2;
  left = Math.max(pad, Math.min(left, window.innerWidth - tipRect.width - pad));
  let top = rect.bottom + 6;
  if (top + tipRect.height + pad > window.innerHeight) {
    top = Math.max(pad, rect.top - tipRect.height - 6);
  }
  tip.style.left = `${Math.round(left)}px`;
  tip.style.top = `${Math.round(top)}px`;
}

function bindGlossTip() {
  if (tipBound) return;
  tipBound = true;
  document.addEventListener("mouseover", (event) => {
    const gloss = event.target?.closest?.("span.littp-gloss");
    if (gloss) showGlossTip(gloss);
  });
  document.addEventListener("mouseout", (event) => {
    const gloss = event.target?.closest?.("span.littp-gloss");
    if (!gloss) return;
    const next = event.relatedTarget;
    if (next && gloss.contains(next)) return;
    hideGlossTip();
  });
  window.addEventListener("scroll", hideGlossTip, true);
}

export function upgradeCachedGlosses(root) {
  const marks = root?.querySelectorAll?.("span.littp-gloss");
  if (!marks?.length) return false;
  let changed = false;
  for (const mark of marks) {
    const text = String(mark.textContent || "");
    const stripped = text.replace(/^（([\s\S]*)）$/, "$1");
    if (stripped !== text) {
      mark.textContent = stripped;
      changed = true;
    }
    if (mark.dataset && !mark.dataset.full) {
      mark.dataset.full = stripped;
      changed = true;
    }
  }
  return changed;
}

export function fragmentFromTokens(tokens, glossMap) {
  const frag = document.createDocumentFragment();
  for (const token of tokens) {
    if (token.type !== "unknown") {
      frag.append(token.text);
      continue;
    }
    const gloss = glossMap[token.span.toLowerCase()];
    if (!gloss) {
      frag.append(token.text);
      continue;
    }
    const unit = document.createElement("span");
    unit.className = "littp-unit";
    const word = document.createElement("span");
    word.className = "littp-word";
    word.textContent = token.text;
    unit.append(word);
    const mark = document.createElement("span");
    mark.className = "littp-gloss";
    mark.textContent = gloss;
    mark.dataset.full = gloss;
    unit.append(mark);
    frag.append(unit);
  }
  return frag;
}

export function replaceTextNode(node, fragment) {
  const parent = node.parentNode;
  if (!parent) return;
  parent.replaceChild(fragment, node);
}
