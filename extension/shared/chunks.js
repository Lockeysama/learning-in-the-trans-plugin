export const FRAGMENT_MAX_CHARS = 720;
export const BATCH_MAX_CHARS = 2200;
export const BATCH_MAX_ITEMS = 8;

const SENTENCE_SPLIT = /(?<=[。！？!?\n])/;

export function splitFragment(text, maxChars = FRAGMENT_MAX_CHARS) {
  const raw = String(text || "");
  if (!raw) return [];
  if (raw.length <= maxChars) return [raw];

  const out = [];
  let buf = "";
  const pushBuf = () => {
    if (!buf) return;
    out.push(buf);
    buf = "";
  };

  for (const part of raw.split(SENTENCE_SPLIT)) {
    if (!part) continue;
    if (part.length > maxChars) {
      pushBuf();
      for (let index = 0; index < part.length; index += maxChars) {
        out.push(part.slice(index, index + maxChars));
      }
      continue;
    }
    if (buf && buf.length + part.length > maxChars) pushBuf();
    buf += part;
  }
  pushBuf();
  return out;
}

export function packBatches(items, {
  maxItems = BATCH_MAX_ITEMS,
  maxChars = BATCH_MAX_CHARS,
  textOf = (item) => String(item ?? ""),
  countOf = () => 1,
} = {}) {
  const batches = [];
  let current = [];
  let chars = 0;
  let count = 0;

  const flush = () => {
    if (!current.length) return;
    batches.push(current);
    current = [];
    chars = 0;
    count = 0;
  };

  for (const item of items || []) {
    const text = textOf(item);
    const extraChars = String(text || "").length;
    const extraCount = Math.max(1, Number(countOf(item)) || 1);
    if (current.length && (count + extraCount > maxItems || chars + extraChars > maxChars)) {
      flush();
    }
    current.push(item);
    chars += extraChars;
    count += extraCount;
  }
  flush();
  return batches;
}
