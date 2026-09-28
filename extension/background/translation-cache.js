const STORAGE_KEY = "translationResultsV1";

async function digest(value) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

// Persist validated model batches, rather than page HTML: new DOM attributes or
// another tab do not force an identical translation to be purchased again.
export function createTranslationCache(storage, { maxEntries = 400, maxBytes = 2 * 1024 * 1024 } = {}) {
  const generations = new Map();
  const pending = new Map();
  let writes = Promise.resolve();
  const serial = work => {
    const next = writes.then(work, work);
    writes = next.catch(() => {});
    return next;
  };
  const ticket = page => ({ page: /^https?:\/\//.test(page || "") ? page : "", generation: generations.get(page) || 0 });
  const current = request => request.generation === (generations.get(request.page) || 0);
  async function read() {
    const data = (await storage.get(STORAGE_KEY))[STORAGE_KEY];
    return Array.isArray(data) ? data.filter(entry => entry && typeof entry.key === "string" && typeof entry.page === "string") : [];
  }
  return {
    ticket,
    async getOrCreate(request, signature, work, cacheable = () => true) {
      if (!request.page) return work();
      const page = await digest(request.page);
      const key = await digest(JSON.stringify([page, signature]));
      const flightKey = `${key}:${request.generation}`;
      if (current(request) && pending.has(flightKey)) return pending.get(flightKey);
      const run = (async () => {
        const entries = await read().catch(() => []);
        const found = entries.find(entry => entry.key === key);
        if (current(request) && found && cacheable(found.value)) return found.value;
        const value = await work();
        if (current(request) && cacheable(value)) {
          await serial(async () => {
            if (!current(request)) return;
            const entries = (await read()).filter(entry => entry.key !== key);
            entries.push({ page, key, value });
            let size = entries.reduce((sum, entry) => sum + new TextEncoder().encode(JSON.stringify(entry)).length, 2);
            while (entries.length && (entries.length > maxEntries || size > maxBytes)) {
              size -= new TextEncoder().encode(JSON.stringify(entries.shift())).length;
            }
            await storage.set({ [STORAGE_KEY]: entries });
          }).catch(() => {}); // Cache quota/availability must not break translation.
        }
        return value;
      })();
      pending.set(flightKey, run);
      try { return await run; }
      finally { if (pending.get(flightKey) === run) pending.delete(flightKey); }
    },
    async clear(pageUrl) {
      generations.set(pageUrl, (generations.get(pageUrl) || 0) + 1);
      const page = await digest(pageUrl);
      await serial(async () => storage.set({ [STORAGE_KEY]: (await read()).filter(entry => entry.page !== page) }));
    },
  };
}
