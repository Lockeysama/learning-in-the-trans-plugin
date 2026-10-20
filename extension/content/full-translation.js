import { isInsideChrome } from "./extract.js";
import { FRAGMENT_MAX_CHARS, packBatches, splitFragment, sentenceParts } from "../shared/chunks.js";
import { createKeyInfoAnnotator } from "./key-info.js";
import { normalizeTranslationConcurrency, normalizeBatchSizes } from "../shared/translation-settings.js";

const SKIP = "script,style,noscript,textarea,input,code,pre,kbd,samp,math,svg,button,select,option,[contenteditable],#littp-toolbar-host,#littp-select-host,.littp-gloss";

// Translate text nodes with paragraph context. Only text is written back, so
// links, emphasis, images and code keep their original markup and attributes.
export async function translateFullText(work, targetLanguage, request, { checkCurrent, onBatch, concurrency, batchSizes } = {}) {
  const sizes = normalizeBatchSizes(batchSizes);
  const limits = normalizeTranslationConcurrency(concurrency);
  const walker = work.ownerDocument.createTreeWalker(work, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!/\p{L}/u.test(node.nodeValue || "") || node.parentElement?.closest(SKIP) || isInsideChrome(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const pieces = [];
  const groups = [];
  const scopes = [];
  let scope;
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const owner = node.parentElement.closest("p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th") || node.parentElement;
    if (!scope || scope.owner !== owner) {
      scope = { owner, groups: [] };
      scopes.push(scope);
    }
    const group = { node, parts: [], pending: 0 };
    groups.push(group);
    scope.groups.push(group);
  }
  const sentences = [];
  // Keep source text in serialized markup so progressive updates and cached
  // translations retain the same block-level lookup after nodes are replaced.
  for (const owner of new Set(scopes.map(scope => scope.owner))) {
    if (owner !== work) owner.setAttribute("data-littp-original", owner.textContent);
  }
  for (const scope of scopes.filter(scope => scope.owner === work)) {
    for (const { node } of scope.groups) {
      const wrapper = work.ownerDocument.createElement("span");
      wrapper.setAttribute("data-littp-original", node.nodeValue);
      node.replaceWith(wrapper);
      wrapper.appendChild(node);
    }
  }
  for (const scope of scopes) {
    let offset = 0;
    const nodes = scope.groups.map(group => {
      const start = offset;
      offset += group.node.nodeValue.length;
      return { group, start, end: offset };
    });
    const source = scope.groups.map(group => group.node.nodeValue).join("");
    const context = scope.owner.textContent.slice(0, 1400);
    for (const sentence of sentenceParts(source)) {
      const sentencePieces = [];
      const end = sentence.offset + sentence.text.length;
      for (const { group, start, end: nodeEnd } of nodes) {
        if (start >= end || nodeEnd <= sentence.offset) continue;
        const fragment = source.slice(Math.max(start, sentence.offset), Math.min(nodeEnd, end));
        for (const text of splitFragment(fragment, FRAGMENT_MAX_CHARS)) {
          const index = group.parts.length;
          group.parts.push(text);
          if (!/\p{L}/u.test(text)) continue;
          group.pending++;
          const piece = { group, index, text, context, id: String(pieces.length) };
          pieces.push(piece);
          sentencePieces.push(piece);
        }
      }
      if (sentencePieces.length) sentences.push(sentencePieces);
    }
  }
  // Inline markup may produce several items for one sentence; count that
  // sentence only once, while retaining each node's placement and formatting.
  const batches = packBatches(sentences, {
    maxItems: sizes.translation, maxChars: 12000,
    textOf: sentence => sentence.map(piece => piece.text).join(""),
  }).flatMap(batch => packBatches(batch.flat(), {
    maxItems: 1000, maxChars: 12000, textOf: piece => piece.text,
  }));
  let completed = 0;
  let nextBatch = 0;
  let failed = null;
  const checkActive = () => {
    checkCurrent?.();
    if (failed) throw failed;
  };
  const annotator = createKeyInfoAnnotator(work, groups, request, {
    concurrency: limits.annotation, batchSizes,
    checkCurrent: checkActive, onUpdate: () => onBatch?.(completed, batches.length, "annotation"),
  });
  async function translateBatch(batch) {
    checkActive();
    const translated = await request({
      type: "TRANSLATE_FULL_TEXT", targetLanguage,
      items: batch.map(({ id, text, context }) => ({ id, text, context })),
    });
    checkActive();
    if (translated?.error) throw new Error(translated.error);
    if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(text => typeof text !== "string" || !text.trim())) {
      throw new Error("全文翻译结果不完整，请重试");
    }
    for (let i = 0; i < batch.length; i++) {
      const { group, index: partIndex, text } = batch[i];
      group.parts[partIndex] = (text.match(/^\s*/)?.[0] || "") + translated[i].trim() + (text.match(/\s*$/)?.[0] || "");
      group.node.nodeValue = group.parts.join("");
      group.pending -= 1;
    }
    completed += 1;
    onBatch?.(completed, batches.length);
    annotator.flush();
  }
  async function worker() {
    try {
      while (nextBatch < batches.length) {
        checkActive();
        const batch = batches[nextBatch++];
        await translateBatch(batch);
      }
    } catch (error) {
      failed ||= error;
      throw error;
    }
  }
  await Promise.all(Array.from({ length: Math.min(limits.translation, batches.length) }, worker));
  checkActive();
  onBatch?.(completed, batches.length, "annotation");
  return annotator.finish();
}
