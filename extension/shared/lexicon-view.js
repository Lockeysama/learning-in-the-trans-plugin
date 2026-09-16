import { BAND_LABELS, BAND_ORDER } from "./constants.js";
import { normalizeLemmaList } from "./draft.js";

export const TIER_ORDER = [
  { id: "function", label: "功能词" },
  { id: "frequent", label: "高频" },
  ...BAND_ORDER.map((id) => ({ id, label: BAND_LABELS[id] })),
  { id: "extra", label: "补充熟词" },
];

export function mergeSeedExtras(existing = [], incoming = []) {
  return normalizeLemmaList([...existing, ...incoming]);
}

export function mergeExtraUnknowns({
  extraUnknowns = [],
  removedLemmas = [],
  unknownDrafts = [],
} = {}) {
  return normalizeLemmaList([...extraUnknowns, ...removedLemmas, ...unknownDrafts]);
}

export function groupLemmas({
  functionWords = [],
  frequent = [],
  bands = {},
  extraLemmas = [],
  extraUnknowns = [],
  removedLemmas = [],
}) {
  const removed = new Set(normalizeLemmaList([...extraUnknowns, ...removedLemmas]));
  const seen = new Set();
  const groups = [];

  const push = (id, label, words) => {
    const source = new Set();
    const list = [];
    for (const raw of words || []) {
      const word = String(raw || "").toLowerCase().trim();
      if (!word) continue;
      source.add(word);
      if (seen.has(word) || removed.has(word)) continue;
      seen.add(word);
      list.push(word);
    }
    groups.push({ id, label, words: list, count: list.length, sourceCount: source.size });
  };

  push("function", "功能词", functionWords);
  push("frequent", "高频", frequent);
  for (const id of BAND_ORDER) {
    push(id, BAND_LABELS[id], bands[id] || []);
  }
  push("extra", "补充熟词", extraLemmas);

  const knownCount = groups.reduce((sum, group) => sum + group.count, 0);
  return {
    groups,
    knownCount,
    unknownCount: normalizeLemmaList(extraUnknowns).length,
  };
}

export const PREVIEW_LIMIT = 80;

export function wordsForDisplay(words, query = "", limit = PREVIEW_LIMIT) {
  const needle = String(query || "").trim().toLowerCase();
  const filtered = (words || []).filter((word) => !needle || word.includes(needle));
  const listed = Number.isFinite(limit) ? filtered.slice(0, limit) : filtered;
  return {
    total: filtered.length,
    words: listed,
    truncated: listed.length < filtered.length,
  };
}
