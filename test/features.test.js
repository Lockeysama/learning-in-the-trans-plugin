import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { MOTTO } from "../extension/shared/constants.js";
import { draftSet, isDraftUnknown, selectionToDraft } from "../extension/shared/draft.js";
import { extractRoot, isLikelyChrome, isMailHost, queryEmailBodies } from "../extension/content/extract.js";
import { commitLearning, copyProcessedHtml, snapshot, workingCopy, cacheFits, clearTargetCache, hashText, hydratePageCache, lexiconFingerprint, persistPageCache, pageViewId, readStoredPageCache, rememberCache, showLearning } from "../extension/content/original.js";
import {
  groupLemmas,
  mergeExtraUnknowns,
  mergeSeedExtras,
  wordsForDisplay,
} from "../extension/shared/lexicon-view.js";
import { eventFromWidget, initialViewMode, isAutoLearnHost, isSiteEnabled, pageHost, shouldAutoLearnPage } from "../extension/shared/site.js";
import { explainRuntimeError, shouldQueueMessage } from "../extension/shared/messages.js";
import { mergePrompts, promptOverrides, DEFAULT_PROMPTS, validatePrompts } from "../extension/shared/prompts.js";
import { fallbackIfSkipped, pickFrameResult } from "../extension/shared/tab-bridge.js";
import { DEFAULT_GLOSS_STYLE, glossStyleToCss, normalizeGlossStyle } from "../extension/shared/gloss-style.js";
import { upgradeCachedGlosses } from "../extension/content/render.js";
import { indexMwes, tokenize } from "../extension/shared/tokenize.js";
import { addUsage, emptyUsage, readUsage } from "../extension/shared/usage.js";

test("selection becomes a draft lemma or phrase", () => {
  assert.equal(selectionToDraft("  Regardless of  "), "regardless of");
  assert.equal(selectionToDraft("eased,"), "eased");
  assert.equal(selectionToDraft("I"), "i");
  assert.equal(selectionToDraft("a"), "a");
  assert.equal(selectionToDraft("to"), "to");
  assert.equal(selectionToDraft("河堤"), "");
});

test("draft words stay unknown even if they are in the known set", () => {
  const known = new Set(["weather", "pause", "regardless", "of"]);
  const drafts = draftSet(["pause", "regardless of"]);
  const tokens = tokenize("a pause regardless of the weather", {
    known,
    mweIndex: indexMwes(["regardless of"]),
    drafts,
  });
  const unknown = tokens.filter((token) => token.type === "unknown").map((token) => token.span);
  assert.ok(isDraftUnknown("pause", drafts));
  assert.ok(unknown.includes("pause"));
  assert.ok(unknown.includes("regardless of"));
  assert.equal(unknown.includes("weather"), false);
});

test("token usage accumulates prompt and completion", () => {
  const first = addUsage(emptyUsage(), { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 });
  const second = addUsage(first, readUsage({ promptTokens: 2, completionTokens: 3 }));
  assert.equal(second.promptTokens, 12);
  assert.equal(second.completionTokens, 8);
  assert.equal(second.totalTokens, 20);
  assert.equal(second.calls, 2);
});

test("keeps the placement motto exact", () => {
  assert.equal(MOTTO, "莫问当下（什么水平），只求前程！");
});

test("new sites stay enabled by default", () => {
  assert.equal(isSiteEnabled("example.com", []), true);
  assert.equal(isSiteEnabled("", ["x.com"]), true);
  assert.equal(isSiteEnabled("x.com", ["x.com"]), false);
});

test("auto learning view is off unless the host is opted in and enabled", () => {
  assert.equal(isAutoLearnHost("example.com", [], []), false);
  assert.equal(isAutoLearnHost("example.com", ["example.com"], []), true);
  assert.equal(isAutoLearnHost("example.com", ["example.com"], ["example.com"]), false);
  assert.equal(isAutoLearnHost("", ["example.com"], []), false);
  assert.equal(pageHost("https://www.example.com/news"), "www.example.com");
  assert.equal(pageHost("chrome://extensions"), "extensions");
  assert.equal(
    shouldAutoLearnPage({
      host: "example.com",
      autoLearnHosts: ["example.com"],
      apiKeyPresent: true,
      onboardingDone: true,
    }),
    true,
  );
  assert.equal(
    shouldAutoLearnPage({
      host: "example.com",
      autoLearnHosts: ["example.com"],
      apiKeyPresent: true,
      onboardingDone: false,
    }),
    false,
  );
});

test("a new page starts in original view unless auto-learn is on", () => {
  assert.equal(
    initialViewMode({
      host: "example.com",
      autoLearnHosts: [],
      apiKeyPresent: true,
      onboardingDone: true,
    }),
    "original",
  );
  assert.equal(
    initialViewMode({
      host: "example.com",
      autoLearnHosts: ["example.com"],
      apiKeyPresent: true,
      onboardingDone: true,
    }),
    "learning",
  );
  assert.equal(pageViewId("https://example.com/a?q=1#x"), "https://example.com/a?q=1#x");
  assert.notEqual(pageViewId("https://example.com/a"), pageViewId("https://example.com/b"));
});

test("clicking the widget does not count as outside mouseup", () => {
  const host = { contains: () => false };
  const inside = { composedPath: () => [host] };
  const outside = { composedPath: () => [{}], target: {} };
  assert.equal(eventFromWidget(inside, host), true);
  assert.equal(eventFromWidget(outside, host), false);
});

test("re-init merges extras instead of wiping them", () => {
  assert.deepEqual(mergeSeedExtras(["keep", "old"], ["new", "keep"]), ["keep", "old", "new"]);
});

test("legacy draft and removed known words merge into extraUnknowns", () => {
  assert.deepEqual(
    mergeExtraUnknowns({
      extraUnknowns: ["pause"],
      removedLemmas: ["eased"],
      unknownDrafts: ["pause", "regardless of"],
    }),
    ["pause", "eased", "regardless of"],
  );
});

test("lexicon groups run from common to rare", () => {
  const view = groupLemmas({
    functionWords: ["the", "pause"],
    frequent: ["weather", "pause"],
    bands: { primary: ["apple"], academic: ["hypothesis"] },
    extraLemmas: ["nonetheless"],
    extraUnknowns: [],
  });
  assert.deepEqual(
    view.groups.map((group) => group.id),
    ["function", "frequent", "primary", "junior", "senior", "cet4", "cet6", "academic", "extra"],
  );
  assert.ok(view.groups[0].words.includes("the"));
  assert.equal(view.groups[0].words.includes("pause"), true);
  assert.equal(view.groups[1].words.includes("pause"), false);
  assert.ok(view.groups.find((group) => group.id === "academic").words.includes("hypothesis"));
  assert.equal(view.knownCount, 6);
  assert.equal(view.unknownCount, 0);
});

test("extra unknowns stay out of seed and count as 补充生词", () => {
  const view = groupLemmas({
    functionWords: ["the", "pause"],
    frequent: [],
    extraLemmas: ["pause", "keep"],
    extraUnknowns: ["pause"],
  });
  assert.equal(view.groups[0].words.includes("pause"), false);
  assert.ok(view.groups.find((group) => group.id === "extra").words.includes("keep"));
  assert.equal(view.groups.find((group) => group.id === "extra").words.includes("pause"), false);
  assert.equal(view.unknownCount, 1);
});

test("gloss size is a percent of the original word", () => {
  assert.deepEqual(normalizeGlossStyle({}), DEFAULT_GLOSS_STYLE);
  assert.deepEqual(normalizeGlossStyle({ size: 40, color: "#ABCDEF" }), { size: 40, color: "#abcdef" });
  assert.equal(normalizeGlossStyle({ size: 12 }).size, 40);
  assert.equal(normalizeGlossStyle({ size: 180 }).size, 100);
  assert.equal(normalizeGlossStyle({ color: "red" }).color, DEFAULT_GLOSS_STYLE.color);
  assert.equal(glossStyleToCss({ size: 72 }).fontSize, "0.72em");
  assert.equal(glossStyleToCss({ size: 100 }).fontSize, "1em");
});

test("cached glosses drop wrapping parentheses", () => {
  const mark = { textContent: "（驻足）", dataset: {} };
  const untouched = { textContent: "河堤", dataset: { full: "河堤" } };
  const root = { querySelectorAll: () => [mark, untouched] };
  assert.equal(upgradeCachedGlosses(root), true);
  assert.equal(mark.textContent, "驻足");
  assert.equal(mark.dataset.full, "驻足");
  assert.equal(untouched.textContent, "河堤");
});

test("reprocess builds on a copy so the live page does not flash back to original", () => {
  const live = {
    innerHTML: "<p>hello</p>",
    ownerDocument: {
      createElement() {
        return { innerHTML: "", style: {}, setAttribute() {}, remove() {} };
      },
      body: { appendChild() {} },
    },
  };
  snapshot(live);
  live.innerHTML = "<p>hello（你好）</p>";
  const work = workingCopy(live);
  work.innerHTML = "<p>pause</p>";
  assert.equal(live.innerHTML, "<p>hello（你好）</p>");
  commitLearning(live, work);
  assert.equal(live.innerHTML, "<p>pause</p>");
});

test("unchanged pages reuse the learning cache until it is cleared", () => {
  const root = { innerHTML: "<p>weather</p>" };
  snapshot(root);
  root.innerHTML = "<p>weather（天气）</p>";
  rememberCache(root, lexiconFingerprint({ difficulty: "default" }));
  root._littpLearning = "<p>weather（天气）</p>";
  const key = lexiconFingerprint({ difficulty: "default" });
  assert.equal(cacheFits(root, { lexiconKey: key, viewingLearning: true }), true);
  assert.equal(cacheFits(root, { lexiconKey: lexiconFingerprint({ difficulty: "easy" }), viewingLearning: true }), false);
  const store = new Map();
  const memory = {
    getItem: (name) => store.get(name) ?? null,
    setItem: (name, value) => store.set(name, value),
    removeItem: (name) => store.delete(name),
  };
  persistPageCache(memory, "https://example.com/a", root, key);
  const fresh = { innerHTML: "<p>weather</p>" };
  assert.equal(hydratePageCache(fresh, readStoredPageCache(memory, "https://example.com/a"), key, fresh.innerHTML), true);
  assert.equal(showLearning(fresh), true);
  assert.equal(fresh.innerHTML, "<p>weather（天气）</p>");
  clearTargetCache(fresh);
  assert.equal(fresh.innerHTML, "<p>weather</p>");
  assert.equal(hashText("a"), hashText("a"));
  assert.notEqual(hashText("a"), hashText("b"));
});

test("mail views prefer message body over the app chrome", () => {
  assert.equal(isMailHost("mail.google.com"), true);
  assert.equal(isMailHost("outlook.live.com"), true);
  assert.equal(isMailHost("mail.qq.com"), true);
  assert.equal(isMailHost("news.ycombinator.com"), false);
  const body = { innerText: "请查收合同附件，谢谢。" };
  const chrome = { innerText: `Inbox Starred Sent ${"x".repeat(120)}` };
  const bodies = queryEmailBodies((selector) => {
    if (selector.includes("a3s")) return [body];
    if (selector.includes("role='main'") || selector.includes('role="main"')) return [chrome];
    return [];
  });
  assert.equal(bodies.length, 1);
  assert.equal(bodies[0], body);
});

test("layout wrappers with a sidebar are not chosen as the reading root", () => {
  assert.equal(isLikelyChrome(el("aside", { className: "sidebar" })), true);
  assert.equal(isLikelyChrome(el("div", { className: "theme-doc-sidebar-container" })), true);
  assert.equal(isLikelyChrome(el("div", { className: "post-body" })), false);
  const paragraph = () => el("p", { text: "The rain had eased, so I decided to go out regardless of the weather. " });
  const sidebar = el("aside", { className: "sidebar" }, [el("a", { text: "Introduction" })]);
  const post = el("div", { className: "post-body" }, [paragraph(), paragraph()]);
  const layout = el("div", { className: "layout" }, [sidebar, post]);
  const body = el("body", {}, [layout]);
  assert.equal(extractRoot(docOf(body)), post);
});

test("replacing learning html leaves the live sidebar node in place", () => {
  const sidebar = el("aside", { className: "sidebar" });
  const post = el("div", { className: "post-body" });
  post.innerHTML = "<p>old</p>";
  const live = el("div", { className: "layout" }, [sidebar, post]);
  const workSidebar = el("aside", { className: "sidebar" });
  const workPost = el("div", { className: "post-body" });
  workPost.innerHTML = "<p>new</p>";
  const work = el("div", {}, [workSidebar, workPost]);
  copyProcessedHtml(live, work);
  assert.equal(live.children[0], sidebar);
  assert.equal(post.innerHTML, "<p>new</p>");
});

test("page shells are never chosen as the reading root", () => {
  const paragraph = () =>
    el("p", { text: "The rain had eased, so I decided to go out regardless of the weather. " });
  const post = el("div", { className: "article-wrap" }, [paragraph(), paragraph()]);
  const app = el("div", { id: "__next" }, [post]);
  const body = el("body", {}, [app]);
  const root = extractRoot(docOf(body));
  assert.equal(root, post);
  assert.notEqual(root?.id, "__next");
  assert.notEqual(root?.tagName, "BODY");
});

test("nested class sidebars are peeled off the reading root", () => {
  const paragraph = () =>
    el("p", { text: "The rain had eased, so I decided to go out regardless of the weather. " });
  const sidebar = el("div", { className: "docs-sidebar" }, [el("a", { text: "Introduction" })]);
  const post = el("div", { className: "doc-content" }, [paragraph(), paragraph()]);
  const inner = el("div", { className: "inner" }, [sidebar, post]);
  const wrap = el("div", { className: "row" }, [inner]);
  const body = el("body", {}, [wrap]);
  assert.equal(extractRoot(docOf(body)), post);
});

test("article nested in a form is still the reading root", () => {
  const paragraph = () =>
    el("p", { text: "The rain had eased, so I decided to go out regardless of the weather. " });
  const article = el("article", {}, [paragraph(), paragraph()]);
  const form = el("form", { id: "aspnetForm" }, [article]);
  const body = el("body", {}, [form]);
  assert.equal(extractRoot(docOf(body)), article);
});

test("spa pages without article tags still have a reading root", () => {
  const text = "The rain had eased, so I decided to go out regardless of the weather. ";
  const markdown = el("div", { className: "markdown-view", text: text.repeat(4) });
  const app = el("div", { id: "app" }, [markdown]);
  const body = el("body", {}, [app]);
  const root = extractRoot(docOf(body));
  assert.equal(root, markdown);
  assert.notEqual(root?.id, "app");
});

test("app shells with only paragraphs still have a reading root", () => {
  const paragraph = () =>
    el("p", { text: "The rain had eased, so I decided to go out regardless of the weather. " });
  const app = el("div", { id: "app" }, [paragraph(), paragraph()]);
  const body = el("body", {}, [app]);
  const root = extractRoot(docOf(body));
  assert.ok(root);
  assert.equal(root.id, "app");
});

test("learning html is not assigned onto the page shell", () => {
  const post = el("div", { className: "article-wrap" });
  post.innerHTML = "<p>old</p>";
  const app = el("div", { id: "__next" }, [post]);
  let replacedShell = false;
  Object.defineProperty(app, "innerHTML", {
    configurable: true,
    get() {
      return this._html;
    },
    set(value) {
      replacedShell = true;
      this._html = String(value);
    },
  });
  const workPost = el("div", { className: "article-wrap" });
  workPost.innerHTML = "<p>new</p>";
  copyProcessedHtml(app, el("div", {}, [workPost]));
  assert.equal(replacedShell, false);
  assert.equal(app.children[0], post);
});

test("working copy stays off the live document", () => {
  let appended = false;
  const live = {
    innerHTML: "<p>hello</p>",
    ownerDocument: {
      createElement() {
        return { innerHTML: "", style: {}, setAttribute() {}, remove() {}, children: [] };
      },
      body: {
        appendChild() {
          appended = true;
        },
      },
    },
  };
  snapshot(live);
  workingCopy(live);
  assert.equal(appended, false);
});

function matchSelector(node, selector) {
  return String(selector)
    .split(",")
    .some((part) => matchOne(node, part.trim()));
}

function matchOne(node, simple) {
  if (!simple) return false;
  const attr = simple.match(/^\[([^=\]]+)=['"]?([^\]'"]+)['"]?\]$/);
  if (attr) return String(node.getAttribute?.(attr[1]) || "").toLowerCase() === attr[2].toLowerCase();
  if (simple.startsWith("#")) return node.id === simple.slice(1);
  if (simple.startsWith(".")) return String(node.className || "").split(/\s+/).includes(simple.slice(1));
  return node.tagName === simple.toUpperCase();
}

function el(tag, props = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(),
    id: props.id || "",
    className: props.className || "",
    children,
    parentElement: null,
    innerText: props.text || "",
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value) {
      this._html = String(value);
    },
    get textContent() {
      if (props.text != null && props.text !== "") return props.text;
      return this.children.map((child) => child.textContent || "").join("");
    },
    getAttribute(name) {
      if (name === "role") return props.role || "";
      if (name === "id") return this.id;
      return props.attrs?.[name] || "";
    },
    matches(selector) {
      return matchSelector(this, selector);
    },
    closest(selector) {
      for (let current = this; current; current = current.parentElement) {
        if (current.matches(selector)) return current;
      }
      return null;
    },
    contains(other) {
      if (other === this) return true;
      return this.children.some((child) => child.contains?.(other));
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] || null;
    },
    querySelectorAll(selector) {
      const out = [];
      const walk = (current) => {
        for (const child of current.children || []) {
          if (child.matches?.(selector)) out.push(child);
          walk(child);
        }
      };
      walk(this);
      return out;
    },
  };
  for (const child of children) child.parentElement = node;
  if (!props.text && children.length) {
    node.innerText = children.map((child) => child.innerText || child.textContent || "").join("");
  }
  return node;
}

function docOf(body) {
  return {
    body,
    querySelector(selector) {
      if (body.matches(selector)) return body;
      return body.querySelector(selector);
    },
    querySelectorAll(selector) {
      const out = body.matches(selector) ? [body] : [];
      return out.concat([...body.querySelectorAll(selector)]);
    },
  };
}

test("a successful mail iframe beats a skipped top frame", () => {
  const result = pickFrameResult([
    { result: { skipped: true } },
    { result: { ok: true, mode: "learning" } },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.mode, "learning");
});

test("right-click toggle falls back when the clicked frame has no article", () => {
  const result = fallbackIfSkipped(
    { skipped: true, error: "没有找到可阅读正文" },
    { ok: true, mode: "learning" },
  );
  assert.equal(result.ok, true);
  assert.equal(result.mode, "learning");
});

test("tier counts keep file size and unique remainder", () => {
  const view = groupLemmas({
    functionWords: ["the"],
    frequent: ["the", "weather"],
    bands: { primary: ["the", "apple", "apple"] },
    extraLemmas: [],
    extraUnknowns: [],
  });
  const primary = view.groups.find((group) => group.id === "primary");
  assert.equal(primary.count, 1);
  assert.equal(primary.sourceCount, 2);
  assert.equal(view.knownCount, 3);
});

test("lexicon panel keeps full counts while previewing a tier", () => {
  const words = Array.from({ length: 120 }, (_, index) => `word${index}`);
  const listed = wordsForDisplay(words, "");
  assert.equal(listed.total, 120);
  assert.equal(listed.words.length, 80);
  assert.equal(listed.truncated, true);
});

test("draft and lexicon reads are not queued behind model calls", () => {
  assert.equal(shouldQueueMessage("ADD_DRAFT"), false);
  assert.equal(shouldQueueMessage("REMOVE_KNOWN"), false);
  assert.equal(shouldQueueMessage("GET_LEXICON"), false);
  assert.equal(shouldQueueMessage("GET_STATE"), false);
  assert.equal(shouldQueueMessage("GLOSS"), true);
});

test("stale extension context asks the user to refresh", () => {
  assert.equal(
    explainRuntimeError({ message: "Extension context invalidated." }),
    "扩展刚更新过，请刷新页面后再试",
  );
  assert.equal(explainRuntimeError({ message: "没有可用的英文词或短语" }), "没有可用的英文词或短语");
});

test("custom prompts fall back to the packaged system text", () => {
  const merged = mergePrompts({ gloss: "  只解释这个单位  " });
  assert.equal(merged.gloss, "只解释这个单位");
  assert.equal(merged.seed, DEFAULT_PROMPTS.seed);
  assert.equal(merged.translate, DEFAULT_PROMPTS.translate);
  assert.deepEqual(promptOverrides({ gloss: DEFAULT_PROMPTS.gloss, seed: "custom seed" }), {
    seed: "custom seed",
  });
});

test("saving prompts rejects a changed output json shape", () => {
  assert.equal(validatePrompts(DEFAULT_PROMPTS).ok, true);
  const broken = validatePrompts({
    ...DEFAULT_PROMPTS,
    gloss: "请用纯文本解释这个词，不要输出 JSON。",
  });
  assert.equal(broken.ok, false);
  assert.match(broken.error, /生词释义/);
  assert.match(broken.error, /JSON/);
});

test("seed unique count matches the union of packaged lists", () => {
  const read = (name) =>
    JSON.parse(readFileSync(new URL(`../extension/lexicon/${name}`, import.meta.url)));
  const functionWords = read("function-words.json");
  const frequent = read("frequent-2000.json");
  const primary = read("bands/primary.json");
  const view = groupLemmas({
    functionWords,
    frequent,
    bands: { primary },
    extraLemmas: ["nonetheless"],
    extraUnknowns: [],
  });
  const union = new Set(
    [...functionWords, ...frequent, ...primary, "nonetheless"]
      .map((word) => String(word).toLowerCase().trim())
      .filter(Boolean),
  );
  assert.equal(view.knownCount, union.size);
});

