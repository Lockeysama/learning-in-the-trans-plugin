import assert from "node:assert/strict";
import test from "node:test";
import { translationInput, translationResult, MAX_SELECTION_CONTEXT } from "../extension/shared/selection-translation.js";
import { shouldQueueMessage } from "../extension/shared/messages.js";
import { DEFAULT_PROMPTS, mergePrompts, validatePrompts } from "../extension/shared/prompts.js";
import { recordCall } from "../extension/background/debug.js";

test("selection translation preserves case, punctuation and Chinese; bounds context without silently truncating selections", () => {
  assert.equal(translationInput("  US revenue isn't up 12%.  ").text, "US revenue isn't up 12%.");
  assert.equal(translationInput("可靠的网络接入").text, "可靠的网络接入");
  assert.equal(translationInput("word", "x".repeat(5000)).context.length, MAX_SELECTION_CONTEXT);
  assert.throws(() => translationInput("a".repeat(2001)), /过长/);
  assert.throws(() => translationInput("...123"), /先选中/);
  assert.throws(() => translationInput("word", "", "invalid"), /未知/);
});

test("translation response validation rejects incomplete responses and allows no meaningful literal difference", () => {
  assert.throws(() => translationResult({ translation: "meaning" }, "natural"), /有效译文/);
  assert.throws(() => translationResult({ kind: "word", translation: {} }, "natural"), /有效译文/);
  assert.deepEqual(translationResult({ kind: "word", translation: "银行", partOfSpeech: "名词" }, "natural"), {
    kind: "word", translation: "银行", partOfSpeech: "名词", note: "",
  });
  assert.deepEqual(translationResult({ translation: "", note: "与自然译文一致" }, "literal"), {
    translation: "", note: "与自然译文一致",
  });
  assert.throws(() => translationResult({}, "literal"), /贴近原文/);
  assert.throws(() => translationResult({ units: [] }, "analysis"), /完整的词句解析/);
  const word = translationResult({ units: [{ source: "bank", meaning: "银行", role: "名词" }], usage: "此处指金融机构" }, "analysis");
  assert.equal(word.structure, "");
  assert.equal(word.units[0].meaning, "银行");
});

test("old prompt settings gain selection defaults; all three contracts are checked", () => {
  const merged = mergePrompts({ gloss: "existing prompt" });
  assert.equal(merged.gloss, "existing prompt");
  for (const id of ["selectionTranslate", "selectionLiteral", "selectionAnalysis"]) {
    assert.equal(merged[id], DEFAULT_PROMPTS[id]);
    assert.equal(validatePrompts({ [id]: "no JSON" }).ok, false);
  }
  assert.equal(validatePrompts(DEFAULT_PROMPTS).ok, true);
  assert.equal(shouldQueueMessage("TRANSLATE_SELECTION"), false);
});

test("concurrent model completions do not lose token usage", async () => {
  const original = globalThis.chrome;
  let store = {};
  globalThis.chrome = { storage: { local: {
    get: async () => structuredClone(store),
    set: async (patch) => { Object.assign(store, patch); },
  } } };
  try {
    await Promise.all(Array.from({ length: 3 }, () => recordCall({
      action: "selectionTranslate", usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
    })));
    assert.equal(store.usage.calls, 3);
    assert.equal(store.usage.totalTokens, 45);
  } finally {
    globalThis.chrome = original;
  }
});
