import assert from "node:assert/strict";
import test from "node:test";
import { validateFullTranslation } from "../extension/shared/full-translation.js";
import { snapshot, saveLearning, showLearning, showTranslation, saveTranslation, restore, clearTargetCache, refreshSource, sourceHtml } from "../extension/content/original.js";

test("full translation aligns reordered outputs and rejects missing, duplicate or empty items", () => {
  const input = [{ id: "0", text: "first" }, { id: "1", text: "second" }];
  assert.deepEqual(validateFullTranslation({ items: [{ id: "1", translation: "第二" }, { id: "0", translation: "第一" }] }, input), ["第一", "第二"]);
  for (const items of [[], [{ id: "0", translation: "第一" }, { id: "0", translation: "重复" }], [{ id: "0", translation: "" }, { id: "1", translation: "第二" }], [{ id: "0", translation: "第一" }, { id: "2", translation: "错位" }]]) {
    assert.throws(() => validateFullTranslation({ items }, input), /全文翻译/);
  }
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
