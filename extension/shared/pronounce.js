export function formatIpa(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/\s+/g, " ");
  if (!text) return "";
  if (/^[\/\[].+[\/\]]$/.test(text)) return text;
  return `/${text}/`;
}

export function formatHint(raw) {
  const text = String(raw || "")
    .trim()
    .replace(/\s+/g, "");
  if (!text) return "";
  const inner = text
    .replace(/^(约读?[:：]?)/, "")
    .replace(/^[「『“"‘'(\[【]+/, "")
    .replace(/[」』”"’)\]】]+$/, "");
  if (!inner) return "";
  return `约「${inner}」`;
}

function withHint(ipa, hint) {
  const note = formatHint(hint);
  return note ? `${ipa}  ${note}` : ipa;
}

export function formatPronunciation({ text, ipa, ipaUk, hint, hintUk } = {}) {
  const word = String(text || "").trim();
  const us = formatIpa(ipa);
  const uk = formatIpa(ipaUk);
  if (!us) return "";
  if (uk && uk !== us) {
    const usPart = withHint(us, hint);
    const ukPart = withHint(uk, hintUk);
    const body = `美 ${usPart}  英 ${ukPart}`;
    return word ? `${word}  ${body}` : body;
  }
  const body = withHint(us, hint);
  return word ? `${word}  ${body}` : body;
}
