import { hasChromeDescendant, isLikelyChrome, isUnsafeRoot } from "./extract.js";

const ORIGINAL = "_littpOriginal";
const LEARNING = "_littpLearning";
const CACHE_META = "_littpCacheMeta";
export const SESSION_PREFIX = "littp-cache:";

export function hashText(text) {
  const sample = String(text || "");
  let hash = 2166136261;
  for (let i = 0; i < sample.length; i += 1) {
    hash ^= sample.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function lexiconFingerprint(state = {}) {
  return hashText(
    JSON.stringify([
      state.difficulty || "default",
      state.coverageBands || [],
      state.extraLemmas || [],
      state.extraUnknowns || [],
      state.removedLemmas || [],
    ]),
  );
}

export function pageCacheId(href) {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(href || "");
  }
}

export function pageViewId(href) {
  try {
    const url = new URL(href);
    return `${url.origin}${url.pathname}${url.search}${url.hash}`;
  } catch {
    return String(href || "");
  }
}

export function snapshot(root) {
  if (root[ORIGINAL] == null) root[ORIGINAL] = root.innerHTML;
}

export function hasOriginal(root) {
  return root[ORIGINAL] != null;
}

export function hasLearning(root) {
  return root[LEARNING] != null;
}

export function restore(root) {
  if (root[ORIGINAL] == null) return;
  assignHtml(root, root[ORIGINAL]);
}

export function saveLearning(root) {
  root[LEARNING] = root.innerHTML;
}

export function showLearning(root) {
  if (root[LEARNING] == null) return false;
  assignHtml(root, root[LEARNING]);
  return true;
}

export function clearLearning(root) {
  delete root[LEARNING];
}

export function sourceHtml(root, viewingLearning = false) {
  if (viewingLearning && root[ORIGINAL] != null) return root[ORIGINAL];
  if (root[LEARNING] != null && root.innerHTML === root[LEARNING] && root[ORIGINAL] != null) {
    return root[ORIGINAL];
  }
  return root.innerHTML;
}

export function cacheFits(root, { lexiconKey, viewingLearning = false } = {}) {
  if (root[LEARNING] == null || root[ORIGINAL] == null || !root[CACHE_META]) return false;
  if (root[CACHE_META].lexiconKey !== lexiconKey) return false;
  return root[CACHE_META].sourceHash === hashText(sourceHtml(root, viewingLearning));
}

export function rememberCache(root, lexiconKey) {
  snapshot(root);
  root[CACHE_META] = {
    lexiconKey,
    sourceHash: hashText(root[ORIGINAL]),
  };
}

export function refreshSource(root, viewingLearning = false) {
  if (viewingLearning) return;
  if (root[LEARNING] != null && root.innerHTML === root[LEARNING]) return;
  if (root[ORIGINAL] != null && root.innerHTML === root[ORIGINAL]) return;
  root[ORIGINAL] = root.innerHTML;
  delete root[LEARNING];
  delete root[CACHE_META];
}

export function clearTargetCache(root) {
  if (root[LEARNING] != null && root.innerHTML === root[LEARNING] && root[ORIGINAL] != null) {
    assignHtml(root, root[ORIGINAL]);
  }
  delete root[ORIGINAL];
  delete root[LEARNING];
  delete root[CACHE_META];
}

export function readStoredPageCache(store, href) {
  if (!store?.getItem) return null;
  try {
    const raw = store.getItem(SESSION_PREFIX + pageCacheId(href));
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data?.originalHtml || !data?.learningHtml || !data?.sourceHash) return null;
    return data;
  } catch {
    return null;
  }
}

export function writeStoredPageCache(store, href, data) {
  if (!store?.setItem) return false;
  try {
    store.setItem(SESSION_PREFIX + pageCacheId(href), JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredPageCache(store, href) {
  try {
    store?.removeItem?.(SESSION_PREFIX + pageCacheId(href));
  } catch {
    /* ignore */
  }
}

export function hydratePageCache(root, stored, lexiconKey, liveHtml) {
  if (!stored || stored.lexiconKey !== lexiconKey) return false;
  if (stored.sourceHash !== hashText(liveHtml)) return false;
  root[ORIGINAL] = stored.originalHtml;
  root[LEARNING] = stored.learningHtml;
  root[CACHE_META] = { lexiconKey: stored.lexiconKey, sourceHash: stored.sourceHash };
  return true;
}

export function persistPageCache(store, href, root, lexiconKey) {
  if (root[ORIGINAL] == null || root[LEARNING] == null) return false;
  rememberCache(root, lexiconKey);
  return writeStoredPageCache(store, href, {
    lexiconKey,
    sourceHash: root[CACHE_META].sourceHash,
    originalHtml: root[ORIGINAL],
    learningHtml: root[LEARNING],
  });
}

export function workingCopy(root) {
  if (!root) return null;
  snapshot(root);
  const doc = root.ownerDocument;
  const work = doc?.createElement?.("div") || { innerHTML: "", style: {}, setAttribute() {}, children: [] };
  work.setAttribute?.("data-littp-work", "1");
  if (work.style) {
    work.style.cssText =
      "position:fixed;left:-99999px;top:0;width:800px;visibility:hidden;pointer-events:none;";
  }
  work.innerHTML = root[ORIGINAL];
  return work;
}

export function commitLearning(root, work) {
  if (!root || !work) return;
  copyProcessedHtml(root, work);
  saveLearning(root);
  discardWork(work);
}

export function discardWork(work) {
  work?.remove?.();
}

export function assignHtml(root, html) {
  if (!root || root.innerHTML === html) return;
  const doc = root.ownerDocument;
  if (!doc?.createElement) {
    if (isUnsafeRoot(root, doc)) return;
    root.innerHTML = html;
    return;
  }
  const work = doc.createElement("div");
  work.innerHTML = html;
  copyProcessedHtml(root, work);
}

export function copyProcessedHtml(live, work) {
  if (!live || !work) return;
  const liveKids = [...(live.children || [])];
  const workKids = [...(work.children || [])];
  const preserve =
    isUnsafeRoot(live, live.ownerDocument || work.ownerDocument) ||
    liveKids.some(isLikelyChrome) ||
    hasChromeDescendant(live);
  if (!preserve) {
    live.innerHTML = work.innerHTML;
    return;
  }
  if (liveKids.length !== workKids.length) return;
  liveKids.forEach((child, i) => {
    if (isLikelyChrome(child)) return;
    copyProcessedHtml(child, workKids[i]);
  });
}
