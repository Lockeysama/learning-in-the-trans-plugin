import { normalizeLemmaList } from "../shared/draft.js";
import { fallbackBands, normalizeBands } from "../shared/difficulty.js";
import { groupLemmas } from "../shared/lexicon-view.js";

export async function loadJson(path) {
  const url = chrome.runtime.getURL(path);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`missing_${path}`);
  return response.json();
}

let floorCache = null;

async function loadFloor() {
  if (floorCache) return floorCache;
  const [functionWords, frequent] = await Promise.all([
    loadJson("lexicon/function-words.json"),
    loadJson("lexicon/frequent-2000.json"),
  ]);
  floorCache = new Set(
    [...functionWords, ...frequent].map((word) => String(word).toLowerCase()),
  );
  return floorCache;
}

const bandCache = new Map();

async function loadBand(name) {
  if (bandCache.has(name)) return bandCache.get(name);
  const words = await loadJson(`lexicon/bands/${name}.json`);
  const set = new Set(words.map((word) => String(word).toLowerCase()));
  bandCache.set(name, set);
  return set;
}

export async function mergeKnownLemmas({
  coverageBands = [],
  extraLemmas = [],
  extraUnknowns = [],
  removedLemmas = [],
}) {
  const known = new Set(await loadFloor());
  for (const band of normalizeBands(coverageBands)) {
    const words = await loadBand(band);
    for (const word of words) known.add(word);
  }
  for (const extra of extraLemmas || []) {
    const word = String(extra || "").toLowerCase().trim();
    if (word) known.add(word);
  }
  for (const removed of normalizeLemmaList([...(extraUnknowns || []), ...(removedLemmas || [])])) {
    known.delete(removed);
  }
  return [...known];
}

export function clampExtraLemmas(lemmas) {
  const out = [];
  const seen = new Set();
  for (const item of lemmas || []) {
    const word = String(item || "").toLowerCase().trim();
    if (!word || seen.has(word) || !/^[a-z][a-z'-]*$/.test(word)) continue;
    seen.add(word);
    out.push(word);
    if (out.length >= 40) break;
  }
  return out;
}

export function bandsFromModel(payload, profile, answers) {
  const bands = normalizeBands(payload?.coverageBands);
  if (bands.length > 0) return bands;
  return fallbackBands(profile, answers);
}

export async function lexiconOverview({
  coverageBands = [],
  extraLemmas = [],
  extraUnknowns = [],
  removedLemmas = [],
}) {
  const [functionWords, frequent] = await Promise.all([
    loadJson("lexicon/function-words.json"),
    loadJson("lexicon/frequent-2000.json"),
  ]);
  const bands = {};
  for (const name of normalizeBands(coverageBands)) {
    bands[name] = await loadJson(`lexicon/bands/${name}.json`);
  }
  return groupLemmas({
    functionWords,
    frequent,
    bands,
    extraLemmas,
    extraUnknowns,
    removedLemmas,
  });
}
