import { KEY_INFO_MAX_CHARS, keyInfoRanges } from "../shared/key-info.js";
import { sentenceBatches } from "../shared/chunks.js";
import { normalizeBatchSizes } from "../shared/translation-settings.js";
import { isInsideChrome } from "./extract.js";
import { normalizeTranslationConcurrency } from "../shared/translation-settings.js";

const BLOCKS = "p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th,figcaption,div,pre";
const PROTECTED = "script,style,noscript,textarea,input,code,pre,kbd,samp,math,svg,button,select,option,[contenteditable]";
const SKIP = `${PROTECTED},#littp-toolbar-host,#littp-select-host,.littp-gloss`;

// Mark source text with the same scope validation and concurrency as translated text.
export async function highlightKeyInfo(work, request, options = {}) {
  const groups = [];
  const walker = work.ownerDocument.createTreeWalker(work, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      return /\p{L}/u.test(node.nodeValue || "") && !node.parentElement?.closest(SKIP) && !isInsideChrome(node.parentElement)
        ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    },
  });
  while (walker.nextNode()) groups.push({ node: walker.currentNode, pending: 0 });
  const annotator = createKeyInfoAnnotator(work, groups, request, options);
  annotator.flush();
  return annotator.finish();
}

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

export function createKeyInfoAnnotator(work, groups, request, { checkCurrent, onUpdate, concurrency, batchSizes } = {}) {
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
  let finished = false;
  return {
    // Collect the full ordered text before batching, including translated scopes.
    flush() {},
    async finish() {
      if (finished) throw new Error("重点标记已经完成");
      finished = true;
      checkCurrent?.();
      let text = "";
      const selected = scopes.filter(scope => scope.groups.length && !isInsideChrome(scope.owner));
      for (const scope of selected) {
        if (text) text += "\n";
        scope.offset = text.length;
        scope.text = scope.nodes.map(node => node.nodeValue).join("");
        text += scope.text;
      }
      const batches = sentenceBatches(text, normalizeBatchSizes(batchSizes).annotation, KEY_INFO_MAX_CHARS);
      const ranges = [];
      let next = 0, failures = 0, annotationError = "";
      async function worker() {
        while (next < batches.length) {
          const segment = batches[next++];
          try {
            checkCurrent?.();
            if (!segment.text.trim()) continue;
            if (segment.text.length > KEY_INFO_MAX_CHARS) throw new Error("单句过长，无法标记重点");
            const result = await request({ type: "ANNOTATE_KEY_INFO", text: segment.text });
            checkCurrent?.();
            if (result?.error) throw new Error(result.error);
            ranges.push(...keyInfoRanges(segment.text, result?.annotated).map(range => ({
              start: range.start + segment.offset, end: range.end + segment.offset,
            })));
          } catch (error) { failures++; annotationError ||= error.message || "重点标记失败"; }
        }
      }
      await Promise.all(Array.from({ length: Math.min(limit, batches.length) }, worker));
      checkCurrent?.();
      ranges.sort((a, b) => a.start - b.start);
      for (const scope of selected) {
        try {
          applyRanges(scope, ranges.filter(range => range.start < scope.offset + scope.text.length && range.end > scope.offset)
            .map(range => ({ start: Math.max(0, range.start - scope.offset), end: Math.min(scope.text.length, range.end - scope.offset) })));
        } catch (error) { failures++; annotationError ||= error.message; }
      }
      onUpdate?.();
      return { annotationComplete: failures === 0, annotationError };
    },
  };
}
