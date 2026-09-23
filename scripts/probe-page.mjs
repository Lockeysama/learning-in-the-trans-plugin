// Probe a real page with the extension's own extraction code.
//
// Run: node scripts/probe-page.mjs <url>
//
// Prints what content/content.js would pick as the reading target, plus the
// reasons the heuristics rejected other candidates.

import { resolve } from "node:path";
import { ChromeHarness, CdpClient, sleep } from "./lib/cdp.mjs";

const extensionPath = resolve(import.meta.dirname, "..", "extension");
const url = process.argv[2];
if (!url) {
  console.error("usage: node scripts/probe-page.mjs <url>");
  process.exit(2);
}

// Executed in the service worker; the `func` below is injected into the page's
// isolated world by chrome.scripting, exactly like shared/inject.js does.
const RUN_PROBE = `(async () => {
  const tabs = await chrome.tabs.query({});
  const tab = tabs.find((t) => t.id != null && !String(t.url || "").startsWith("chrome-extension://") && t.url !== "about:blank");
  if (!tab) return "no page tab: " + JSON.stringify(tabs.map((t) => t.url));

  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id, allFrames: false },
    world: "ISOLATED",
    func: async () => {
      const extract = await import(chrome.runtime.getURL("content/extract.js"));
      const summarize = (el) => el ? ({
        tag: el.tagName,
        id: el.id || "",
        cls: String(el.className || "").slice(0, 80),
        role: el.getAttribute?.("role") || "",
        textLen: (el.innerText || el.textContent || "").trim().length,
        paragraphs: el.querySelectorAll("p").length,
        chromeDescendant: extract.hasChromeDescendant(el),
        likelyChrome: extract.isLikelyChrome(el),
        unsafeRoot: extract.isUnsafeRoot(el, document),
      }) : null;

      const targets = extract.extractTargets(document, location.hostname);
      const preferred = [];
      for (const sel of ["article", "[role='main']", "main", "#content", ".content", ".post", ".entry-content", ".article-content", ".markdown-body", "[itemprop='articleBody']"]) {
        for (const node of document.querySelectorAll(sel)) {
          preferred.push({ selector: sel, ...summarize(node) });
        }
      }
      const root = extract.extractRoot(document);
      const bodyChildren = [...(document.body?.children || [])].slice(0, 25).map(summarize);

      // Replicate peelChrome/bestContentChild (they are not exported) to see why the
      // walk left the real article body.
      const text = (el) => String(el?.innerText || el?.textContent || "").trim();
      const score = (el) => {
        const ps = [...(el.querySelectorAll?.("p") || [])].filter((p) => text(p).length > 40);
        const sum = ps.reduce((acc, p) => acc + text(p).length, 0);
        return Math.max(sum + ps.length * 120, text(el).length);
      };
      const kids = (el) => [...(el?.children || [])].filter((c) => {
        const tag = String(c.tagName || "");
        if (extract.isLikelyChrome(c)) return false;
        if (/^(SCRIPT|STYLE|LINK|META|NOSCRIPT|TEMPLATE|SVG|PATH|BR|HR)$/i.test(tag)) return false;
        return /^(DIV|SECTION|ARTICLE|MAIN|FORM)$/i.test(tag) || tag.includes("-");
      });
      const LAYOUT = "aside, nav, [role='navigation'], [role='complementary'], [role='directory']";
      const trace = [];
      let cur = document.querySelector("article") || root;
      for (let depth = 0; depth < 10 && cur; depth += 1) {
        const chromeEl = cur.querySelector?.(LAYOUT);
        const scored = kids(cur)
          .map((c) => ({
            tag: c.tagName,
            cls: String(c.className || "").slice(0, 60),
            len: text(c).length,
            score: score(c),
          }))
          .sort((a, b) => b.score - a.score);
        trace.push({
          depth,
          tag: cur.tagName,
          cls: String(cur.className || "").slice(0, 60),
          len: text(cur).length,
          paragraphs: cur.querySelectorAll("p").length,
          hasChromeDescendant: extract.hasChromeDescendant(cur),
          firstChrome: chromeEl ? {
            tag: chromeEl.tagName,
            cls: String(chromeEl.className || "").slice(0, 70),
            role: chromeEl.getAttribute("role") || "",
            label: chromeEl.getAttribute("aria-label") || "",
            len: text(chromeEl).length,
          } : null,
          children: scored.slice(0, 4),
          allChildren: [...(cur.children || [])].map((c) => ({
            tag: c.tagName,
            cls: String(c.className || "").slice(0, 70),
            id: c.id || "",
            len: text(c).length,
            score: score(c),
            likelyChrome: extract.isLikelyChrome(c),
            keptByContentChildren: kids(cur).includes(c),
          })),
        });
        const best = scored[0];
        if (!best || best.score < 80) break;
        cur = kids(cur).find((c) => score(c) === best.score) || null;
      }

      return {
        href: location.href,
        readyState: document.readyState,
        bodyTextLen: (document.body?.innerText || "").trim().length,
        targetCount: targets.length,
        targets: targets.map(summarize),
        extractRoot: summarize(root),
        blockCount: targets.length ? extract.blockElements(targets[0]).length : 0,
        preferred: preferred.slice(0, 14),
        bodyChildren,
        peelTrace: trace,
      };
    },
  });
  return JSON.stringify(results.map((r) => r.result), null, 2);
})()`;

const harness = new ChromeHarness({ extensionPath, port: 9333, headless: process.env.HEADFUL !== "1" });
let page = null;
let sw = null;

try {
  await harness.launch();
  await harness.loadExtension(extensionPath);
  await sleep(1200);

  const worker = await harness.findExtensionWorker("Littp");
  if (!worker) throw new Error("Littp service worker never appeared");
  sw = worker.client;

  const opened = await harness.openTarget("about:blank");
  page = opened.client;
  const exceptions = [];
  const logs = [];
  await page.send("Runtime.enable");
  await page.send("Log.enable");
  await page.send("Page.enable");
  page.on("Runtime.exceptionThrown", (p) => {
    exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text);
  });
  page.on("Log.entryAdded", (p) => {
    if (p.entry.level === "error") logs.push(p.entry.text);
  });

  console.log(`navigating to ${url} …`);
  page.send("Page.navigate", { url }).catch(() => {});
  await sleep(12000);

  const title = await page.evaluate("document.title");
  const finalUrl = await page.evaluate("location.href");
  console.log(`title: ${title}\nfinal url: ${finalUrl}\n`);

  console.log(await sw.evaluate(RUN_PROBE));

  const errors = [...exceptions, ...logs];
  if (errors.length) {
    console.log(`\npage errors (${errors.length}):`);
    for (const e of errors.slice(0, 5)) console.log("  - " + String(e).split("\n")[0]);
  }
} catch (error) {
  console.error("probe failed:", error?.message || error);
  process.exitCode = 1;
} finally {
  page?.close();
  sw?.close();
  harness.close();
}
