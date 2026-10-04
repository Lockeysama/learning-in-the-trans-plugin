import { normalizeKeyInfoStyle } from "../shared/translation-settings.js";

// Presentation stays outside cached HTML, so both new and cached annotations
// follow the latest preferences without another model request.
export function applyKeyInfoStyle(raw) {
  const next = normalizeKeyInfoStyle(raw);
  let style = document.getElementById("littp-key-info-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "littp-key-info-style";
    document.documentElement.appendChild(style);
  }
  style.textContent = `strong.littp-key-info {
    font-weight: ${next.bold ? "700" : "inherit"} !important;
    color: ${next.color} !important;
    background-color: ${next.backgroundColor} !important;
  }`;
}
