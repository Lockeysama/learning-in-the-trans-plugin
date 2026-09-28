import { isInsideChrome } from "./extract.js";
import { BATCH_MAX_CHARS, BATCH_MAX_ITEMS, FRAGMENT_MAX_CHARS, packBatches, splitFragment } from "../shared/chunks.js";

const SKIP = "script,style,noscript,textarea,input,code,pre,kbd,samp,math,svg,button,select,option,[contenteditable],#littp-toolbar-host,#littp-select-host,.littp-gloss";

// Translate text nodes with paragraph context. Only text is written back, so
// links, emphasis, images and code keep their original markup and attributes.
export async function translateFullText(work, targetLanguage, request, { checkCurrent, onBatch } = {}) {
  const walker = work.ownerDocument.createTreeWalker(work, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!/\p{L}/u.test(node.nodeValue || "") || node.parentElement?.closest(SKIP) || isInsideChrome(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const pieces = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const context = (node.parentElement.closest("p,li,h1,h2,h3,h4,h5,h6,blockquote,td,th") || node.parentElement).textContent.slice(0, 1400);
    const group = { node, parts: splitFragment(node.nodeValue, FRAGMENT_MAX_CHARS) };
    group.parts.forEach((text, index) => {
      if (/\p{L}/u.test(text)) pieces.push({ group, index, text, context, id: String(pieces.length) });
    });
  }
  const batches = packBatches(pieces, { maxItems: BATCH_MAX_ITEMS, maxChars: BATCH_MAX_CHARS, textOf: p => p.text + p.context });
  for (const [index, batch] of batches.entries()) {
    checkCurrent?.();
    const translated = await request({
      type: "TRANSLATE_FULL_TEXT", targetLanguage,
      items: batch.map(({ id, text, context }) => ({ id, text, context })),
    });
    checkCurrent?.();
    if (translated?.error) throw new Error(translated.error);
    if (!Array.isArray(translated) || translated.length !== batch.length || translated.some(text => typeof text !== "string" || !text.trim())) {
      throw new Error("全文翻译结果不完整，请重试");
    }
    for (let i = 0; i < batch.length; i++) {
      const { group, index: partIndex, text } = batch[i];
      group.parts[partIndex] = (text.match(/^\s*/)?.[0] || "") + translated[i].trim() + (text.match(/\s*$/)?.[0] || "");
      group.node.nodeValue = group.parts.join("");
    }
    onBatch?.(index + 1, batches.length);
  }
}
