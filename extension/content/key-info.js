import { KEY_INFO_MAX_CHARS, keyInfoRanges, keyInfoSegments } from "../shared/key-info.js";
import { isInsideChrome } from "./extract.js";
import { normalizeTranslationConcurrency } from "../shared/translation-settings.js";

const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div,pre";
const PROTECTED = "script,style,noscript,textarea,input,code,pre,kbd,samp,math,svg,button,select,option,[contenteditable]";

function applyRanges(scope, ranges) {
  let offset = 0;
  const parts = scope.nodes.map(node => {
    const start = offset;
    offset += node.nodeValue.length;
    return { node, start, end: offset };
  });
  // If a phrase would require touching code or another protected element,
  // leave the whole scope plain instead of displaying half a relationship.
  if (parts.some(({ node, start, end }) => node.parentElement?.closest(PROTECTED) && ranges.some(range => range.start < end && range.end > start))) {
    throw new Error("重点标注跨越了受保护内容");
  }
  for (const { node, start, end } of parts) {
    const overlaps = ranges.filter(range => range.start < end && range.end > start);
    if (!overlaps.length) continue;
    const fragment = node.ownerDocument.createDocumentFragment();
    const text = node.nodeValue;
    let cursor = 0;
    for (const range of overlaps) {
      const from = Math.max(0, range.start - start);
      const to = Math.min(text.length, range.end - start);
      fragment.appendChild(node.ownerDocument.createTextNode(text.slice(cursor, from)));
      const strong = node.ownerDocument.createElement("strong");
      strong.className = "littp-key-info";
      strong.textContent = text.slice(from, to);
      fragment.appendChild(strong);
      cursor = to;
    }
    fragment.appendChild(node.ownerDocument.createTextNode(text.slice(cursor)));
    node.replaceWith(fragment);
  }
}

export function createKeyInfoAnnotator(work, groups, request, { checkCurrent, onUpdate, concurrency } = {}) {
  const limit = normalizeTranslationConcurrency({ annotation: concurrency }).annotation;
  const byNode = new Map(groups.map(group => [group.node, group]));
  const scopes = [];
  const walker = work.ownerDocument.createTreeWalker(work, NodeFilter.SHOW_TEXT);
  let scope;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const owner = node.parentElement.closest(BLOCKS) || work;
    if (!scope || scope.owner !== owner) {
      scope = { owner, nodes: [], groups: [], queued: false };
      scopes.push(scope);
    }
    scope.nodes.push(node);
    if (byNode.has(node)) scope.groups.push(byNode.get(node));
  }
  const waiting = [];
  const active = new Set();
  let failures = 0;
  async function annotate(scope) {
    checkCurrent?.();
    const text = scope.nodes.map(node => node.nodeValue).join("");
    const ranges = [];
    for (const segment of keyInfoSegments(text)) {
      checkCurrent?.();
      if (!segment.text.trim() || segment.text.length > KEY_INFO_MAX_CHARS) continue;
      const result = await request({ type: "ANNOTATE_KEY_INFO", text: segment.text });
      checkCurrent?.();
      if (result?.error) throw new Error(result.error);
      ranges.push(...keyInfoRanges(segment.text, result?.annotated).map(range => ({
        start: range.start + segment.offset, end: range.end + segment.offset,
      })));
    }
    applyRanges(scope, ranges);
    onUpdate?.();
  }
  function pump() {
    while (waiting.length && active.size < limit) {
      const scope = waiting.shift();
      const job = Promise.resolve().then(() => annotate(scope))
        .catch(() => { failures += 1; })
        .finally(() => { active.delete(job); pump(); });
      active.add(job);
    }
  }
  return {
    flush() {
      for (const scope of scopes) {
        if (scope.queued || !scope.groups.length || scope.groups.some(group => group.pending) || isInsideChrome(scope.owner)) continue;
        scope.queued = true;
        waiting.push(scope);
      }
      // Ready scopes run concurrently with one another and with translation.
      // Apply each result immediately; a slow scope does not hold up later ones.
      pump();
    },
    async finish() {
      while (active.size) await Promise.all([...active]);
      checkCurrent?.();
      return { annotationComplete: failures === 0 };
    },
  };
}
