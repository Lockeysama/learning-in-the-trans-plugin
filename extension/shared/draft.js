import { normalizeToken, variants } from "./lemma.js";

export function selectionToDraft(text) {
  const cleaned = String(text || "")
    .replace(/[^A-Za-z\s'’-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!cleaned || !/[a-z]/.test(cleaned)) return "";
  return cleaned;
}

export function draftSet(drafts) {
  const set = new Set();
  for (const item of drafts || []) {
    const text = typeof item === "string" ? item : item?.text;
    const key = selectionToDraft(text) || normalizeToken(text);
    if (key) set.add(key);
  }
  return set;
}

export function isDraftUnknown(word, drafts) {
  if (!drafts || drafts.size === 0) return false;
  const n = normalizeToken(word);
  if (drafts.has(n)) return true;
  return variants(word).some((item) => drafts.has(item));
}

export function normalizeLemmaList(list) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const word = String(item || "").toLowerCase().trim();
    if (!word || seen.has(word) || !/^[a-z][a-z'’ -]*[a-z]$|^[a-z]$/.test(word)) continue;
    seen.add(word);
    out.push(word);
  }
  return out;
}
