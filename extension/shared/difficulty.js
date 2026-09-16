import { BAND_ORDER } from "./constants.js";

export function normalizeBands(bands) {
  const allowed = new Set(BAND_ORDER);
  const out = [];
  for (const band of bands || []) {
    if (allowed.has(band) && !out.includes(band)) out.push(band);
  }
  out.sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b));
  return out;
}

export function maxBandIndex(bands) {
  const normalized = normalizeBands(bands);
  if (normalized.length === 0) return -1;
  return Math.max(...normalized.map((band) => BAND_ORDER.indexOf(band)));
}

export function bandsForDifficulty(selected, difficulty) {
  const chosen = normalizeBands(selected);
  const maxIdx = maxBandIndex(chosen);
  if (difficulty === "easy") return [];
  if (difficulty === "hard") {
    const until = Math.min(BAND_ORDER.length - 1, Math.max(maxIdx + 1, 0));
    return BAND_ORDER.slice(0, until + 1);
  }
  return chosen;
}

export function fallbackBands(profile = {}, answers = []) {
  const education = profile.education || "bachelor";
  let max = "cet4";
  if (education === "junior") max = "junior";
  else if (education === "senior") max = "senior";
  else if (education === "bachelor") max = "cet4";
  else if (education === "graduate") max = "cet6";

  const levels = new Set(profile.levels || []);
  if ([...levels].some((item) => /六级|雅思|托福|ielts|toefl|cet-?6/i.test(item))) {
    max = "cet6";
  } else if ([...levels].some((item) => /四级|cet-?4/i.test(item))) {
    if (BAND_ORDER.indexOf(max) < BAND_ORDER.indexOf("cet4")) max = "cet4";
  } else if ([...levels].some((item) => /高考|中考/.test(item))) {
    if (BAND_ORDER.indexOf(max) < BAND_ORDER.indexOf("senior")) max = "senior";
  }

  if (profile.workFrequency === "often") {
    const idx = Math.min(BAND_ORDER.length - 1, BAND_ORDER.indexOf(max) + 1);
    max = BAND_ORDER[idx];
  } else if (profile.workFrequency === "never") {
    const idx = Math.max(0, BAND_ORDER.indexOf(max) - 1);
    max = BAND_ORDER[idx];
  }

  const filled = answers.filter((item) => String(item.answer || "").trim());
  if (filled.length >= 4) {
    const weak = filled.filter((item) => String(item.answer || "").trim().length < 4).length;
    if (weak >= filled.length / 2) {
      const idx = Math.max(0, BAND_ORDER.indexOf(max) - 1);
      max = BAND_ORDER[idx];
    }
  }

  const until = BAND_ORDER.indexOf(max);
  return BAND_ORDER.slice(0, until + 1);
}
