export const CONCURRENCY_MIN = 1;
export const CONCURRENCY_MAX = 10;
export const DEFAULT_TRANSLATION_CONCURRENCY = Object.freeze({ translation: 5, annotation: 5 });
export const DEFAULT_KEY_INFO_STYLE = Object.freeze({ bold: true, color: "#15803d", backgroundColor: "transparent" });

function concurrency(value, fallback) {
  if (value === "" || value == null || typeof value === "boolean") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(CONCURRENCY_MAX, Math.max(CONCURRENCY_MIN, Math.round(number))) : fallback;
}

export function normalizeTranslationConcurrency(raw) {
  return {
    translation: concurrency(raw?.translation, DEFAULT_TRANSLATION_CONCURRENCY.translation),
    annotation: concurrency(raw?.annotation, DEFAULT_TRANSLATION_CONCURRENCY.annotation),
  };
}

function color(value, fallback) {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : fallback;
}

export function normalizeKeyInfoStyle(raw) {
  return {
    bold: typeof raw?.bold === "boolean" ? raw.bold : DEFAULT_KEY_INFO_STYLE.bold,
    color: color(raw?.color, DEFAULT_KEY_INFO_STYLE.color),
    backgroundColor: color(raw?.backgroundColor, DEFAULT_KEY_INFO_STYLE.backgroundColor),
  };
}
