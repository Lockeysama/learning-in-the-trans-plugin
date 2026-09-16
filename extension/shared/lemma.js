const APOSTROPHE = /['’]s$/i;

export function normalizeToken(word) {
  return String(word || "")
    .toLowerCase()
    .replace(APOSTROPHE, "")
    .trim();
}

export function variants(word) {
  const w = normalizeToken(word);
  const set = new Set();
  if (!w) return [];
  set.add(w);
  if (w.length > 4 && w.endsWith("ies")) set.add(`${w.slice(0, -3)}y`);
  if (w.length > 5 && w.endsWith("ing")) {
    const stem = w.slice(0, -3);
    set.add(stem);
    set.add(`${stem}e`);
    if (/([a-z])\1$/.test(stem)) set.add(stem.slice(0, -1));
  }
  if (w.length > 4 && w.endsWith("ed")) {
    set.add(w.slice(0, -2));
    set.add(w.slice(0, -1));
    const stem = w.slice(0, -2);
    if (/([a-z])\1$/.test(stem)) set.add(stem.slice(0, -1));
  }
  if (w.length > 4 && w.endsWith("es")) set.add(w.slice(0, -2));
  if (
    w.length > 4 &&
    w.endsWith("s") &&
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    !w.endsWith("is")
  ) {
    set.add(w.slice(0, -1));
  }
  return [...set];
}

export function isKnownWord(word, known) {
  if (!known || known.size === 0) return false;
  return variants(word).some((item) => known.has(item));
}
