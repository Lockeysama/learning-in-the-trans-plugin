import { isDraftUnknown } from "./draft.js";
import { isKnownWord, normalizeToken, variants } from "./lemma.js";

const TOKEN_RE = /([A-Za-z]+(?:['’][A-Za-z]+)?|[0-9]+|[^\sA-Za-z0-9]+|\s+)/g;

export function splitTokens(text) {
  const input = String(text || "");
  const tokens = [];
  for (const part of input.match(TOKEN_RE) || []) {
    let kind = "other";
    if (/^\s+$/.test(part)) kind = "space";
    else if (/^[A-Za-z]/.test(part)) kind = "word";
    tokens.push({ text: part, kind });
  }
  return tokens;
}

export function indexMwes(mwes) {
  const index = new Map();
  for (const phrase of mwes || []) {
    const words = normalizeToken(phrase).split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;
    const key = words[0];
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(words);
  }
  for (const list of index.values()) {
    list.sort((a, b) => b.length - a.length);
  }
  return index;
}

function firstWordKeys(token) {
  return new Set(variants(token.text));
}

function matchMwe(raw, start, mweIndex) {
  const first = raw[start];
  if (!first || first.kind !== "word") return null;
  const lists = [];
  for (const key of firstWordKeys(first)) {
    if (mweIndex.has(key)) lists.push(...mweIndex.get(key));
  }
  lists.sort((a, b) => b.length - a.length);
  for (const words of lists) {
    let j = start;
    let wi = 0;
    let text = "";
    while (wi < words.length && j < raw.length) {
      const cur = raw[j];
      if (cur.kind === "space") {
        text += cur.text;
        j += 1;
        continue;
      }
      if (cur.kind !== "word") break;
      const forms = new Set(variants(cur.text));
      if (!forms.has(words[wi])) break;
      text += cur.text;
      wi += 1;
      j += 1;
    }
    if (wi === words.length) {
      return { text, end: j, span: words.join(" ") };
    }
  }
  return null;
}

export function tokenize(text, { known, mweIndex, drafts }) {
  const raw = splitTokens(text);
  const tokens = [];
  let i = 0;
  while (i < raw.length) {
    const mwe = mweIndex ? matchMwe(raw, i, mweIndex) : null;
    if (mwe) {
      const content = splitTokens(mwe.text).filter((item) => item.kind === "word");
      const forced =
        isDraftUnknown(mwe.span, drafts) ||
        isDraftUnknown(mwe.text, drafts) ||
        content.some((item) => isDraftUnknown(item.text, drafts));
      const unknown =
        forced || content.some((item) => !isKnownWord(item.text, known));
      tokens.push({
        type: unknown ? "unknown" : "known",
        text: mwe.text,
        span: mwe.span,
      });
      i = mwe.end;
      continue;
    }
    const cur = raw[i];
    if (cur.kind !== "word") {
      tokens.push({ type: "other", text: cur.text });
    } else {
      const unknown = isDraftUnknown(cur.text, drafts) || !isKnownWord(cur.text, known);
      tokens.push({
        type: unknown ? "unknown" : "known",
        text: cur.text,
        span: cur.text,
      });
    }
    i += 1;
  }
  return tokens;
}

export function uniqueUnknown(tokenGroups) {
  const seen = new Set();
  const items = [];
  for (const group of tokenGroups) {
    for (const token of group.tokens) {
      if (token.type !== "unknown") continue;
      const key = normalizeToken(token.span);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      items.push({
        span: token.span,
        sentence: group.sentence || "",
      });
    }
  }
  return items;
}
