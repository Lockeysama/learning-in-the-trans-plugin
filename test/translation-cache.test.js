import assert from "node:assert/strict";
import test from "node:test";
import { createTranslationCache } from "../extension/background/translation-cache.js";

function storage() {
  const data = {};
  return {
    get: async key => ({ [key]: structuredClone(data[key]) }),
    set: async patch => Object.assign(data, structuredClone(patch)),
  };
}
const page = "https://example.com/article";

test("validated batches survive worker recreation and distinguish input, direction and prompt", async () => {
  const store = storage();
  let cache = createTranslationCache(store);
  let calls = 0;
  const model = async () => { calls++; return { text: "译文" }; };
  const signature = ["model", "fullTranslate", "prompt", "English text", "zh"];
  await cache.getOrCreate(cache.ticket(page), signature, model);
  cache = createTranslationCache(store);
  assert.deepEqual(await cache.getOrCreate(cache.ticket(page), signature, model), { text: "译文" });
  assert.equal(calls, 1);
  for (const changed of [[...signature, "new text"], [...signature, "en"], [...signature, "new prompt"]]) {
    await cache.getOrCreate(cache.ticket(page), changed, model);
  }
  assert.equal(calls, 4);
});

test("failures and invalid results are never cached", async () => {
  const cache = createTranslationCache(storage());
  const request = cache.ticket(page);
  await assert.rejects(cache.getOrCreate(request, "key", async () => { throw new Error("offline"); }));
  const cacheable = value => Boolean(value.valid);
  await cache.getOrCreate(request, "key", async () => ({}), cacheable);
  assert.deepEqual(await cache.getOrCreate(request, "key", async () => ({ valid: true }), cacheable), { valid: true });
});

test("clearing a page evicts both modes and stops old in-flight requests from refilling the cache", async () => {
  const store = storage();
  const cache = createTranslationCache(store);
  const request = cache.ticket(page);
  await cache.getOrCreate(request, "learning", async () => "old learning");
  let release;
  const started = new Promise(resolve => {
    release = resolve;
  });
  let signal;
  const running = new Promise(resolve => { signal = resolve; });
  const pending = cache.getOrCreate(request, "full", () => { signal(); return started; });
  await running;
  await cache.clear(page);
  release("old translation");
  await pending;
  const reopened = createTranslationCache(store);
  assert.equal(await reopened.getOrCreate(reopened.ticket(page), "full", async () => "new translation"), "new translation");
  assert.equal(await reopened.getOrCreate(reopened.ticket(page), "learning", async () => "new learning"), "new learning");
});

test("cache is bounded and clearing one page preserves another", async () => {
  const cache = createTranslationCache(storage(), { maxEntries: 2 });
  const ticket = cache.ticket(page);
  const other = cache.ticket(`${page}/other`);
  await cache.getOrCreate(ticket, "first", async () => "first");
  await cache.getOrCreate(ticket, "second", async () => "second");
  await cache.getOrCreate(other, "third", async () => "third");
  await cache.clear(page);
  assert.equal(await cache.getOrCreate(other, "third", async () => "unexpected miss"), "third");
  assert.equal(await cache.getOrCreate(ticket, "first", async () => "fresh"), "fresh");
});

test("unavailable storage does not prevent translation", async () => {
  const cache = createTranslationCache({ get: async () => { throw new Error("blocked"); }, set: async () => {} });
  assert.equal(await cache.getOrCreate(cache.ticket(page), "key", async () => "translated"), "translated");
});
