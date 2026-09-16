const LAYOUT_CHROME =
  "aside, nav, [role='navigation'], [role='complementary'], [role='directory']";
const STRUCTURAL_CHROME =
  `${LAYOUT_CHROME}, footer, header, form, [role='menu'], [role='menubar'], [role='tree'], [role='tablist'], summary`;
const SKIP_CHROME = `${STRUCTURAL_CHROME}, #littp-toolbar-host, #littp-select-host`;
const HOST_SKIP = "#littp-toolbar-host, #littp-select-host, [data-littp-work]";
const PREFERRED_SELECTORS = [
  "article",
  "[role='main']",
  "main",
  "#content",
  ".content",
  ".post",
  ".entry-content",
  ".article-content",
  ".markdown-body",
  "[itemprop='articleBody']",
];
const UNSAFE_IDS = new Set(["app", "root", "__next", "__nuxt", "__layout"]);
const CHROME_TOKENS = [
  "sidebar",
  "side-bar",
  "sidenav",
  "side-nav",
  "toc",
  "catalog",
  "docnav",
  "docs-nav",
  "table-of-contents",
  "doc-outline",
];
const CHROME_SEGMENTS = new Set(["sidebar", "sidenav", "catalog", "docnav"]);

export const EMAIL_BODY_SELECTORS = [
  ".a3s.aiL",
  ".a3s",
  ".ii.gt",
  '[aria-label="Message body"]',
  '[aria-label="邮件正文"]',
  ".allowTextSelection",
  '[role="document"] .allowTextSelection',
  "#mailContentContainer",
  "#contentDiv",
  ".mail-content",
  ".message-body",
  ".email-body",
  ".readhtmlmail",
  ".netease-mail-content",
  "#mailContent",
];

export function isMailHost(hostname = "") {
  const host = String(hostname).toLowerCase();
  if (!host) return false;
  return (
    /(^|\.)(mail\.google\.com|inbox\.google\.com|outlook\.live\.com|outlook\.office\.com|outlook\.office365\.com|mail\.qq\.com|wx\.mail\.qq\.com|mail\.163\.com|mail\.126\.com|mail\.yeah\.net|mail\.aliyun\.com|mail\.sina\.com\.cn|mail\.sohu\.com|icloud\.com)$/.test(
      host,
    ) ||
    host.includes("outlook.") ||
    /(^|\.)mail\./.test(host)
  );
}

export function queryEmailBodies(querySelectorAll) {
  const seen = new Set();
  const out = [];
  for (const selector of EMAIL_BODY_SELECTORS) {
    let nodes = [];
    try {
      nodes = [...(querySelectorAll(selector) || [])];
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      if (!node || seen.has(node)) continue;
      if (node.closest?.("#littp-toolbar-host, #littp-select-host, [data-littp-work]")) continue;
      const text = String(node.innerText || node.textContent || "").trim();
      if (text.length < 8) continue;
      seen.add(node);
      out.push(node);
    }
  }
  return out.filter(
    (node) => !out.some((other) => other !== node && node.contains?.(other)),
  );
}

export function isLikelyChrome(el) {
  if (!el) return false;
  try {
    if (el.matches?.(SKIP_CHROME)) return true;
  } catch {
    /* ignore invalid matches */
  }
  const role = String(el.getAttribute?.("role") || "").toLowerCase();
  if (["navigation", "complementary", "directory", "menu", "menubar", "tree", "tablist"].includes(role)) {
    return true;
  }
  const names = `${el.id || ""} ${el.className?.baseVal ?? el.className ?? ""}`
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return names.some((name) => {
    if (
      CHROME_TOKENS.some(
        (key) => name === key || name.startsWith(`${key}-`) || name.endsWith(`-${key}`),
      )
    ) {
      return true;
    }
    return name.split(/[_-]+/).some((part) => CHROME_SEGMENTS.has(part));
  });
}

export function isInsideChrome(el) {
  for (let node = el; node; node = node.parentElement) {
    if (isLikelyChrome(node)) return true;
  }
  return false;
}

export function hasChromeDescendant(el) {
  try {
    if (el.querySelector?.(LAYOUT_CHROME)) return true;
  } catch {
    /* ignore */
  }
  const stack = [...(el.children || [])];
  let seen = 0;
  while (stack.length && seen < 2500) {
    const node = stack.pop();
    seen += 1;
    if (isLikelyChrome(node)) return true;
    const kids = node.children;
    if (!kids?.length) continue;
    for (let i = 0; i < kids.length; i += 1) stack.push(kids[i]);
  }
  return false;
}

export function isUnsafeRoot(el, doc = el?.ownerDocument) {
  if (!el) return true;
  const tag = String(el.tagName || "").toUpperCase();
  if (tag === "BODY" || tag === "HTML") return true;
  if (doc && (el === doc.body || el === doc.documentElement)) return true;
  return UNSAFE_IDS.has(String(el.id || "").toLowerCase());
}

function contentChildren(current) {
  return [...(current?.children || [])].filter((child) => {
    if (!child || isLikelyChrome(child)) return false;
    const tag = String(child.tagName || "");
    if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|SVG|PATH|BR|HR)$/i.test(tag)) return false;
    return /^(DIV|SECTION|ARTICLE|MAIN|FORM)$/i.test(tag) || tag.includes("-");
  });
}

function bestContentChild(current, { allowSingle = false } = {}) {
  const kids = contentChildren(current);
  if (!kids.length) return null;
  let best = null;
  let bestScore = 0;
  for (const child of kids) {
    const score = contentScore(child);
    if (score > bestScore) {
      best = child;
      bestScore = score;
    }
  }
  if (best && bestScore >= 80) return best;
  if (allowSingle && kids.length === 1) return kids[0];
  return null;
}

export function peelChrome(root) {
  let current = root;
  for (let i = 0; i < 8; i += 1) {
    if (!current || !hasChromeDescendant(current)) return current;
    const best = bestContentChild(current);
    if (!best || best === current) return current;
    current = best;
  }
  return current;
}

export function peelToArticle(root, doc = root?.ownerDocument) {
  let current = peelChrome(root) || root;
  for (let i = 0; i < 8; i += 1) {
    if (!current) return null;
    if (!isUnsafeRoot(current, doc) && !isLikelyChrome(current)) {
      if (!hasChromeDescendant(current)) return current;
      const peeled = peelChrome(current);
      if (peeled && peeled !== current && !isUnsafeRoot(peeled, doc)) return peeled;
      return current;
    }
    const next = bestContentChild(current, { allowSingle: true });
    if (!next || next === current) return null;
    current = peelChrome(next) || next;
  }
  return isUnsafeRoot(current, doc) || isLikelyChrome(current) ? null : current;
}

export function extractRoot(doc = document) {
  for (const node of preferredCandidates(doc)) {
    const peeled = peelToArticle(node, doc);
    if (peeled && textOf(peeled).length > 80 && !isUnsafeRoot(peeled, doc)) return peeled;
  }

  let best = null;
  let bestScore = 0;
  for (const el of collectCandidates(doc)) {
    const peeled = peelToArticle(el, doc) || el;
    if (!peeled || isLikelyChrome(peeled) || isUnsafeRoot(peeled, doc)) continue;
    const score = contentScore(peeled);
    if (score > bestScore) {
      best = peeled;
      bestScore = score;
    }
  }
  if (best && textOf(best).length > 80) return best;
  for (const el of [...(doc.body?.children || [])]) {
    if (!isUnsafeRoot(el, doc) || isLikelyChrome(el)) continue;
    if (textOf(el).length > 80) return el;
  }
  return null;
}

function preferredCandidates(doc) {
  const seen = new Set();
  const out = [];
  for (const selector of PREFERRED_SELECTORS) {
    let nodes = [];
    try {
      nodes = [...(doc.querySelectorAll(selector) || [])];
    } catch {
      nodes = [];
    }
    for (const node of nodes) {
      if (!node || seen.has(node) || !usablePreferred(node)) continue;
      seen.add(node);
      out.push(node);
    }
  }
  return out;
}

function usablePreferred(node) {
  if (!node || textOf(node).length <= 80) return false;
  try {
    if (node.closest?.(HOST_SKIP) || node.closest?.(LAYOUT_CHROME)) return false;
  } catch {
    /* ignore */
  }
  return !isLikelyChrome(node);
}

function collectCandidates(doc) {
  const seeds = [doc.body, doc.querySelector("main"), doc.querySelector("[role='main']")].filter(Boolean);
  const out = [];
  const seen = new Set();
  const queue = [];
  for (const seed of seeds) {
    for (const child of seed.children || []) queue.push(child);
  }
  let hops = 0;
  while (queue.length && hops < 60) {
    const el = queue.shift();
    hops += 1;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    if (el.closest?.(HOST_SKIP)) continue;
    const tag = String(el.tagName || "").toUpperCase();
    if (isUnsafeRoot(el, doc) || tag === "FORM") {
      for (const child of el.children || []) queue.push(child);
      continue;
    }
    if (isLikelyChrome(el)) continue;
    if (/^(DIV|SECTION|ARTICLE|MAIN)$/i.test(tag)) out.push(el);
  }
  return out;
}

export function extractTargets(doc = document, hostname = "") {
  const host = hostname || doc.defaultView?.location?.hostname || "";
  if (isMailHost(host)) {
    const mail = queryEmailBodies((selector) => doc.querySelectorAll(selector));
    if (mail.length) return mail;
  }
  const article = extractRoot(doc);
  return article ? [article] : [];
}

export function blockElements(root) {
  const tagged = [...root.querySelectorAll("p, h1, h2, h3, h4, h5, li, blockquote, figcaption")].filter(
    usableBlock,
  );
  if (tagged.length) return tagged;
  const leaves = [...root.querySelectorAll("div")].filter((el) => usableBlock(el) && isLeafText(el));
  if (leaves.length) return leaves;
  return textOf(root) ? [root] : [];
}

function contentScore(el) {
  const paragraphs = [...(el.querySelectorAll?.("p") || [])].filter((p) => textOf(p).length > 40);
  const textLen = paragraphs.reduce((sum, p) => sum + textOf(p).length, 0);
  return Math.max(textLen + paragraphs.length * 120, textOf(el).length);
}

function textOf(node) {
  return String(node?.innerText || node?.textContent || "").trim();
}

function usableBlock(el) {
  if (isInsideChrome(el)) return false;
  if (el.closest?.("script, style, noscript, code, pre")) return false;
  return textOf(el).length > 0;
}

function isLeafText(el) {
  return ![...el.querySelectorAll("div, p, h1, h2, h3, h4, h5, li, blockquote")].some(
    (child) => textOf(child).length > 0,
  );
}
