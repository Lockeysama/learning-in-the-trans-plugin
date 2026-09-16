const HAN = /[\u4e00-\u9fff]/g;
const LATIN = /[A-Za-z]/g;

export function detectLang(text) {
  const sample = String(text || "").slice(0, 4000);
  const han = sample.match(HAN)?.length || 0;
  const latin = sample.match(LATIN)?.length || 0;
  if (han === 0 && latin === 0) return "en";
  if (han > 20 && han >= latin * 0.35) return "zh";
  if (latin > 40 && latin >= han) return "en";
  return han > latin ? "zh" : "en";
}
