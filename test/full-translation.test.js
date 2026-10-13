import assert from "node:assert/strict";
import test from "node:test";
import { validateFullTranslation } from "../extension/shared/full-translation.js";
import { snapshot, saveLearning, showLearning, showTranslation, saveTranslation, showHighlight, saveHighlight, restore, clearTargetCache, refreshSource, sourceHtml } from "../extension/content/original.js";

test("full translation aligns reordered outputs and rejects missing, duplicate or empty items", () => {
  const input = [{ id: "0", text: "first" }, { id: "1", text: "second" }];
  assert.deepEqual(validateFullTranslation({ items: [{ id: "1", translation: "第二" }, { id: "0", translation: "第一" }] }, input), ["第一", "第二"]);
  for (const items of [[], [{ id: "0", translation: "第一" }, { id: "0", translation: "重复" }], [{ id: "0", translation: "" }, { id: "1", translation: "第二" }], [{ id: "0", translation: "第一" }, { id: "2", translation: "错位" }]]) {
    assert.throws(() => validateFullTranslation({ items }, input), /全文翻译/);
  }
});

test("standalone highlighting caches source markup separately and retries incomplete annotations", () => {
  const root = { innerHTML: "Original article", children: [] };
  snapshot(root);
  saveTranslation(root, { innerHTML: "Translated article", children: [] }, "zh");
  saveHighlight(root, { innerHTML: "Original <strong>article</strong>", children: [] });
  assert.equal(sourceHtml(root), "Original article");
  restore(root);
  assert.equal(showHighlight(root), true);
  assert.equal(root.innerHTML, "Original <strong>article</strong>");
  assert.equal(showTranslation(root, "zh"), true);
  assert.equal(root.innerHTML, "Translated article");
  saveHighlight(root, { innerHTML: "Partly highlighted", children: [] }, { annotationComplete: false });
  assert.equal(root.innerHTML, "Partly highlighted");
  assert.equal(showHighlight(root), false);
  restore(root);
  root.innerHTML = "Changed source";
  refreshSource(root);
  assert.equal(showHighlight(root), false);
  assert.equal(showTranslation(root, "zh"), false);
  saveHighlight(root, { innerHTML: "Changed <strong>source</strong>", children: [] });
  clearTargetCache(root);
  assert.equal(root.innerHTML, "Changed source");
  assert.equal(showHighlight(root), false);
});

test("original, learning and translation caches stay independent and invalidate with the source", () => {
  const root = { innerHTML: "Original article", children: [] };
  snapshot(root);
  root.innerHTML = "Learning annotations";
  saveLearning(root);
  saveTranslation(root, { innerHTML: "中文全文", children: [] }, "zh");
  assert.equal(sourceHtml(root), "Original article");
  refreshSource(root);
  assert.equal(showLearning(root), true);
  assert.equal(root.innerHTML, "Learning annotations");
  assert.equal(showTranslation(root, "en"), false);
  assert.equal(showTranslation(root, "zh"), true);
  restore(root);
  assert.equal(root.innerHTML, "Original article");
  assert.equal(showTranslation(root, "zh"), true);
  clearTargetCache(root);
  assert.equal(root.innerHTML, "Original article");
  assert.equal(showTranslation(root, "zh"), false);
  snapshot(root);
  saveTranslation(root, { innerHTML: "译文", children: [] }, "zh");
  restore(root);
  root.innerHTML = "New article";
  refreshSource(root);
  assert.equal(showTranslation(root, "zh"), false);
  assert.equal(sourceHtml(root), "New article");
});
