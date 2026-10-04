import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_KEY_INFO_STYLE, DEFAULT_TRANSLATION_CONCURRENCY, normalizeKeyInfoStyle, normalizeTranslationConcurrency } from "../extension/shared/translation-settings.js";

test("missing preferences use five workers and bold green with no background", () => {
  for (const raw of [undefined, null, {}]) {
    assert.deepEqual(normalizeTranslationConcurrency(raw), DEFAULT_TRANSLATION_CONCURRENCY);
    assert.deepEqual(normalizeKeyInfoStyle(raw), DEFAULT_KEY_INFO_STYLE);
  }
});

test("worker counts remain independent, bounded integers; malformed values use defaults", () => {
  assert.deepEqual(normalizeTranslationConcurrency({ translation: "2", annotation: 7 }), { translation: 2, annotation: 7 });
  assert.deepEqual(normalizeTranslationConcurrency({ translation: 0, annotation: 100 }), { translation: 1, annotation: 10 });
  assert.deepEqual(normalizeTranslationConcurrency({ translation: 2.8, annotation: "bad" }), { translation: 3, annotation: 5 });
  for (const invalid of ["", null, true, Infinity, NaN]) {
    assert.deepEqual(normalizeTranslationConcurrency({ translation: invalid, annotation: invalid }), DEFAULT_TRANSLATION_CONCURRENCY);
  }
});

test("annotation style preserves false and accepts only safe color values", () => {
  assert.deepEqual(normalizeKeyInfoStyle({ bold: false, color: "#ABCDEF", backgroundColor: "#DCFCE7" }), {
    bold: false, color: "#abcdef", backgroundColor: "#dcfce7",
  });
  assert.deepEqual(normalizeKeyInfoStyle({ bold: "false", color: "red; display:none", backgroundColor: "url(https://example.com)" }), DEFAULT_KEY_INFO_STYLE);
  assert.equal(normalizeKeyInfoStyle({ backgroundColor: "transparent" }).backgroundColor, "transparent");
});
