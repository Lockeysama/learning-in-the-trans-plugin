export const GLOSS_SIZE_MIN = 40;
export const GLOSS_SIZE_MAX = 100;

export const DEFAULT_GLOSS_STYLE = Object.freeze({
  size: 72,
  color: "#94a3b8",
});

const HEX = /^#([0-9a-f]{6})$/i;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeGlossStyle(raw = {}) {
  const sizeNum = Number(raw.size);
  const size = Number.isFinite(sizeNum)
    ? clamp(Math.round(sizeNum), GLOSS_SIZE_MIN, GLOSS_SIZE_MAX)
    : DEFAULT_GLOSS_STYLE.size;
  const color = HEX.test(String(raw.color || ""))
    ? String(raw.color).toLowerCase()
    : DEFAULT_GLOSS_STYLE.color;
  return { size, color };
}

export function glossStyleToCss(style) {
  const normalized = normalizeGlossStyle(style);
  return {
    fontSize: `${normalized.size / 100}em`,
    color: normalized.color,
  };
}
