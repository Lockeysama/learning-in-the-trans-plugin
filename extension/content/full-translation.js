import { isInsideChrome } from "./extract.js";
import { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, FRAGMENT_MAX_CHARS, packBatches, splitFragment } from "../shared/chunks.js";
import { createKeyInfoAnnotator } from "./key-info.js";
import { normalizeTranslationConcurrency } from "../shared/translation-settings.js";

const SKIP = "script,style,noscript,textarea,input,code,pre,kbd,samp,math,svg,button,select,option,[contenteditable],#littp-toolbar-host,#littp-select-host,.littp-gloss";

// Translate text nodes with paragraph context. Only text is written back, so
// links, emphasis, images and code keep their original markup and attributes.
export async function translateFullText(work, targetLanguage, request, { checkCurrent, onBatch, concurrency } = {}) {
  const limits = normalizeTranslationConcurrency(concurrency);
  const walker = work.ownerDocument.createTreeWalker(work, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!/\p{L}/u.test(node.nodeValue || "") || node.parentElement?.closest(SKIP) || isInsideChrome(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const pieces = [];
  const groups = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const context = (node.parentElement.closest("p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th") || node.parentElement).textContent.slice(0, 1400);
    const group = { node, parts: splitFragment(node.nodeValue, FRAGMENT_MAX_CHARS), pending: 0 };
    groups.push(group);
    group.parts.forEach((text, index) => {
      if (/\p{L}/u.test(text)) {
        group.pending += 1;
        pieces.push({ group, index, text, context, id: String(pieces.length) });
      }
    });
  }
  const batches = packBatches(pieces, { maxItems: BATCH_MAX_ITEMS, maxChars: BATCH_MAX_CHARS, textOf: p => p.text + p.context });
  let completed = 0;
  let nextBatch = 0;
  let failed = null;
  const checkActive = () => {
    checkCurrent?.();
    if (failed) throw failed;
  };
  const annotator = createKeyInfoAnnotator(work, groups, request, {
    concurrency: limits.annotation,
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
