import test from "node:test";
import assert from "node:assert/strict";
import { sentenceBatches, sentenceParts } from "../extension/shared/chunks.js";
import { normalizeBatchSizes } from "../extension/shared/translation-settings.js";
import { withOneRetry } from "../extension/shared/model-retry.js";

test("sentence batches include exact boundaries and the final remainder", () => {
  for (const count of [1, 19, 20, 21, 40, 41]) {
    const source = Array.from({ length: count }, (_, i) => `这是第${i}句。`).join("");
    const batches = sentenceBatches(source, 20, 4000);
    assert.equal(batches.length, Math.ceil(count / 20));
    assert.equal(batches.map(batch => batch.text).join(""), source);
    for (const batch of batches) assert.equal(source.slice(batch.offset, batch.offset + batch.text.length), batch.text);
  }
});

test("headings, English sentences and whitespace preserve source offsets", () => {
  const source = "Title\nFirst sentence. Second sentence!\n列表项\n最后一句。";
  const parts = sentenceParts(source);
  assert.equal(parts.length, 5);
  assert.equal(parts.map(part => part.text).join(""), source);
  for (const part of parts) assert.equal(source.slice(part.offset, part.offset + part.text.length), part.text);
  assert.equal(sentenceBatches(source, 5, 25).length > 1, true);
});

test("batch settings default independently and clamp invalid values", () => {
  assert.deepEqual(normalizeBatchSizes(), { translation: 5, annotation: 20 });
  assert.deepEqual(normalizeBatchSizes({ translation: 10, annotation: 30 }), { translation: 10, annotation: 30 });
  assert.deepEqual(normalizeBatchSizes({ translation: 0, annotation: 100 }), { translation: 1, annotation: 50 });
  assert.deepEqual(normalizeBatchSizes({ translation: true, annotation: "bad" }), { translation: 5, annotation: 20 });
});

test("one retry recovers failures and caps attempts", async () => {
  let calls = 0;
  assert.equal(await withOneRetry(() => { if (++calls === 1) throw new Error("invalid"); return "valid"; }), "valid");
  assert.equal(calls, 2);
  calls = 0;
  await assert.rejects(withOneRetry(() => { calls++; throw new Error("invalid"); }), /invalid/);
  assert.equal(calls, 2);
});
