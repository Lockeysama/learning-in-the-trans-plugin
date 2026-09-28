// Run: node scripts/check-full-translation.mjs. Isolated Chrome; no real API calls.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChromeHarness, sleep } from "./lib/cdp.mjs";

const extensionPath = new URL("../extension", import.meta.url).pathname;
const server = createServer((req, res) => {
  const zh = req.url.startsWith("/zh");
  const paragraph = zh ? "周二傍晚，我关掉电脑，沿着河堤慢慢走。天色渐暗，路灯一盏盏亮起。我想在阅读时保持专注，也希望理解新的知识。" : "We take reliable internet access for granted. This article explains how researchers investigate unfamiliar phenomena and evaluate evidence before reaching a conclusion.";
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(`<!doctype html><html><meta charset="utf-8"><title>Full translation</title><body style="font:18px/1.8 system-ui;background:#fffcf6;margin:40px">
    <nav id="navigation"><a href="/">Home</a></nav><article style="max-width:820px;margin:auto"><h1>${zh ? "阅读与理解" : "Reading and understanding"}</h1>
    <p>${paragraph} <a id="link" href="/reference"><em id="emphasis">${zh ? "参考资料" : "Read the reference"}</em></a></p>
    ${`<p>${paragraph}</p>`.repeat(10)}<pre id="code">const value = 42;</pre>
    </article><aside id="sidebar">Related pages</aside></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const harness = new ChromeHarness({ extensionPath, port: 9335 });
let page, popup, sw;
const bar = "document.getElementById('littp-toolbar-host').shadowRoot";
const failures = [];
const check = (name, condition) => { if (!condition) failures.push(name); console.log(`${condition ? "PASS" : "FAIL"} ${name}`); };
async function until(client, expression) {
  for (let i = 0; i < 160; i++) { if (await client.evaluate(expression)) return; await sleep(50); }
  throw new Error(`Timeout: ${expression}`);
}
async function mode(expected) { await until(page, `${bar}.getElementById(${JSON.stringify(expected)}).dataset.active === 'true'`); }
async function click(id) { await page.evaluate(`${bar}.getElementById(${JSON.stringify(id)}).click()`); }
async function popupClick(id) { await popup.evaluate(`document.getElementById(${JSON.stringify(id)}).click()`); }
async function callCount() { return sw.evaluate("__calls.filter(c => c.targetLanguage).length"); }

try {
  await harness.launch();
  await harness.loadExtension(extensionPath);
  const worker = await harness.findExtensionWorker("Littp");
  assert.ok(worker);
  sw = worker.client;
  await sw.evaluate(`(async () => {
    await chrome.storage.local.set({ apiKey: 'sk-stub', onboardingDone: true, coverageBands: ['primary'], autoLearnHosts: [] });
    globalThis.__calls = [];
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('api.deepseek.com')) return original(url, init);
      const input = JSON.parse(JSON.parse(init.body).messages.at(-1).content);
      __calls.push(input);
      if (globalThis.__delayNext || (input.targetLanguage && __calls.filter(c => c.targetLanguage).length === globalThis.__delayAtFull)) {
        globalThis.__delayNext = false;
        await new Promise(resolve => { globalThis.__release = resolve; });
      }
      let payload;
      if (input.targetLanguage) payload = { items: input.items.map(item => ({ id: item.id, translation: input.targetLanguage === 'zh' ? '这是自然通顺的中文译文，完整保留了原文的含义，并帮助读者理解文章中的重要信息。' : 'This is the English translation of the original Chinese article, preserving its meaning and information.' })) };
      else if (input.items) payload = { items: input.items.map(item => ({ span: item.span, gloss: '测试释义' })) };
      else payload = { paragraphs: input.paragraphs.map(() => 'An English paragraph with unfamiliar phenomena.') };
      if (globalThis.__invalidNext) { globalThis.__invalidNext = false; payload = { items: [] }; }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(payload) } }], usage: {} }), { status: 200 });
    };
  })()`);
  const target = await harness.openTarget(`${url}/en`);
  page = target.client;
  await until(page, "Boolean(document.getElementById('littp-toolbar-host'))");
  const originalHtml = await page.evaluate("document.querySelector('article').innerHTML");
  await page.evaluate("globalThis.navigation = document.getElementById('navigation'); globalThis.sidebar = document.getElementById('sidebar');");
  popup = (await harness.openTarget(`chrome-extension://${worker.id}/popup/popup.html`, { background: true })).client;
  await harness.activateTarget(target.target.id);
  await until(popup, `window.__tabUrl === ${JSON.stringify(`${url}/en`)}`);
  check("popup has three view choices in order", await popup.evaluate(`[...document.querySelectorAll('.switch button')].map(b => b.textContent).join(',') === '原文,学习视图,全文翻译'`));
  await sw.evaluate("globalThis.__delayAtFull = 2");
  await popupClick("translate");
  await until(sw, "Boolean(globalThis.__release)");
  check("first batch is visible while next batch is still pending", await page.evaluate("document.querySelector('article').textContent.includes('中文译文') && document.querySelector('article').textContent.includes('reliable internet')"));
  await sw.evaluate("globalThis.__release(); globalThis.__release = null; globalThis.__delayAtFull = null");
  await mode("translated");
  await until(popup, "document.getElementById('translate').getAttribute('aria-pressed') === 'true'");
  check("English article translates into Chinese", await page.evaluate("document.querySelector('article').textContent.includes('中文译文')") && await sw.evaluate("__calls.filter(c => c.targetLanguage).every(c => c.targetLanguage === 'zh')"));
  check("full translation contains no learning glosses", await page.evaluate("document.querySelectorAll('.littp-gloss').length === 0"));
  check("links, emphasis and code survive", await page.evaluate(`document.getElementById('link').getAttribute('href') === '/reference' && document.getElementById('emphasis').tagName === 'EM' && document.getElementById('code').textContent === 'const value = 42;'`));
  check("navigation and sidebar retain their nodes", await page.evaluate("navigation === document.getElementById('navigation') && sidebar === document.getElementById('sidebar')"));
  const firstCount = await callCount();
  await click("original");
  await mode("original");
  check("original HTML is restored exactly", await page.evaluate("document.querySelector('article').innerHTML") === originalHtml);
  await popupClick("translate");
  await mode("translated");
  check("full translation cache is reused", await callCount() === firstCount);
  await click("learning");
  await mode("learning");
  check("learning view starts from English source", await page.evaluate("document.querySelectorAll('.littp-gloss').length > 0 && !document.querySelector('article').textContent.includes('中文译文')"));
  await click("translated");
  await mode("translated");
  check("learning does not overwrite full translation cache", await callCount() === firstCount);
  check("translation never receives generated glosses", await sw.evaluate("__calls.filter(c => c.targetLanguage).every(c => c.items.every(i => !i.text.includes('测试释义')))"));
  const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(tmpdir(), "littp-full-translation.png"), Buffer.from(screenshot.data, "base64"));
  console.log(`Screenshot: ${join(tmpdir(), "littp-full-translation.png")}`);

  async function reload() {
    await page.evaluate("globalThis.__beforeReload = true");
    await page.send("Page.reload");
    await until(page, "!globalThis.__beforeReload && Boolean(document.getElementById('littp-toolbar-host'))");
  }
  let before = await callCount();
  await reload();
  await click("translated");
  await mode("translated");
  check("full translation survives a page reload without model calls", await callCount() === before);
  await click("learning");
  await mode("learning");
  before = await sw.evaluate("__calls.length");
  await reload();
  await click("learning");
  await mode("learning");
  check("learning view survives a page reload without model calls", await sw.evaluate("__calls.length") === before);
  const savedPage = page;
  const reopened = await harness.openTarget(`${url}/en`);
  page = reopened.client;
  await until(page, "Boolean(document.getElementById('littp-toolbar-host'))");
  before = await sw.evaluate("__calls.length");
  await click("learning");
  await mode("learning");
  check("learning cache survives reopening the same page", await sw.evaluate("__calls.length") === before);
  before = await callCount();
  await click("translated");
  await mode("translated");
  check("full translation cache survives reopening the same page", await callCount() === before);
  page.close();
  page = savedPage;
  await harness.activateTarget(target.target.id);

  await popupClick("clearCache");
  await mode("original");
  await sw.evaluate("globalThis.__delayNext = true");
  await popupClick("translate");
  await until(sw, "Boolean(globalThis.__release)");
  await click("original");
  await sw.evaluate("globalThis.__release(); globalThis.__release = null");
  await sleep(400);
  check("late translation cannot overwrite original view", await page.evaluate("document.querySelector('article').innerHTML") === originalHtml);
  await mode("original");
  await sw.evaluate("globalThis.__invalidNext = true");
  await popupClick("translate");
  await until(popup, "document.getElementById('message').textContent.includes('全文翻译结果不完整')");
  check("invalid translation reports an error and restores source", await page.evaluate("document.querySelector('article').innerHTML") === originalHtml);
  await popupClick("translate");
  await mode("translated");
  check("retry after failure succeeds", true);

  await popupClick("clearCache");
  await mode("original");
  await sw.evaluate("globalThis.__delayNext = true");
  await popupClick("learn");
  await until(sw, "Boolean(globalThis.__release)");
  await popupClick("translate");
  await sw.evaluate("globalThis.__release(); globalThis.__release = null");
  await mode("translated");
  await sleep(200);
  check("switching during learning finishes in full translation", await page.evaluate("!document.querySelector('.littp-gloss') && document.querySelector('article').textContent.includes('中文译文')"));
  await until(popup, "document.getElementById('translate').getAttribute('aria-pressed') === 'true' && document.getElementById('learn').getAttribute('aria-pressed') === 'false'");

  await page.send("Page.navigate", { url: `${url}/zh` });
  await until(page, "location.pathname === '/zh' && Boolean(document.getElementById('littp-toolbar-host'))");
  // The floating bar callback exercises the same action without the popup.
  await click("translated");
  await mode("translated");
  check("Chinese article translates into English", await page.evaluate("document.querySelector('article').textContent.includes('English translation')") && await sw.evaluate("__calls.at(-1).targetLanguage === 'en'"));
  await click("original");
  check("Chinese original is restored", await page.evaluate("document.querySelector('article').textContent.includes('沿着河堤')"));
  assert.deepEqual(failures, [], "full translation regression failures");
  console.log("ALL FULL TRANSLATION CHECKS PASSED");
} finally {
  popup?.close(); page?.close(); sw?.close(); harness.close();
  await new Promise(resolve => server.close(resolve));
}
