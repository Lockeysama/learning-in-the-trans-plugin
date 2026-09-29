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
    ${`<p>${paragraph}</p>`.repeat(req.url.includes('concurrency') ? 45 : 10)}<pre id="code">const value = 42;</pre>
    </article><aside id="sidebar">Related pages</aside></body></html>`);
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}`;
const harness = new ChromeHarness({ extensionPath, port: 9335 });
let page, popup, sw, settings;
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
    globalThis.__held = [];
    globalThis.__activeTranslations = 0;
    globalThis.__maxTranslations = 0;
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('api.deepseek.com')) return original(url, init);
      const body = JSON.parse(init.body);
      if (!body.response_format) {
        const user = body.messages.at(-1).content;
        const source = body.messages[0].content.includes('输入是 JSON：text') ? JSON.parse(user).text : user;
        __calls.push({ annotation: true, text: source });
        if (globalThis.__delayAnnotation) {
          globalThis.__delayAnnotation = false;
          await new Promise(resolve => { globalThis.__releaseAnnotation = resolve; });
        }
        const content = globalThis.__badAnnotations ? '改写后的错误内容' : source.replace('自然通顺的中文译文', '**自然通顺的中文译文**').replace('English translation', '**English translation**');
        return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: {} }), { status: 200 });
      }
      const input = JSON.parse(body.messages.at(-1).content);
      __calls.push(input);
      if (input.targetLanguage && globalThis.__holdTranslations) {
        __activeTranslations++;
        __maxTranslations = Math.max(__maxTranslations, __activeTranslations);
        await new Promise(resolve => __held.push(() => { __activeTranslations--; resolve(); }));
      }
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
  await sw.evaluate("globalThis.__delayAtFull = 2; globalThis.__delayAnnotation = true");
  await popupClick("translate");
  await until(sw, "Boolean(globalThis.__release)");
  check("first batch is visible while next batch is still pending", await page.evaluate("document.querySelector('article').textContent.includes('中文译文') && document.querySelector('article').textContent.includes('reliable internet')"));
  await sw.evaluate("globalThis.__release(); globalThis.__release = null; globalThis.__delayAtFull = null");
  await until(sw, "Boolean(globalThis.__releaseAnnotation)");
  check("translation is visible before delayed annotation finishes", await page.evaluate("document.querySelector('article').textContent.includes('中文译文')"));
  await until(page, "Boolean(document.querySelector('p strong.littp-key-info'))");
  check("later annotation is displayed while the first annotation is still pending", await sw.evaluate("Boolean(globalThis.__releaseAnnotation)") && await page.evaluate("!document.querySelector('h1 strong.littp-key-info')"));
  await sw.evaluate("globalThis.__releaseAnnotation(); globalThis.__releaseAnnotation = null");
  await mode("translated");
  check("key phrases render as bold without literal Markdown markers", await page.evaluate("Boolean(document.querySelector('strong.littp-key-info')) && !document.querySelector('article').textContent.includes('**')"));
  const highlightedText = await page.evaluate("document.querySelector('article').textContent");
  await until(popup, "document.getElementById('translate').getAttribute('aria-pressed') === 'true'");
  check("English article translates into Chinese", await page.evaluate("document.querySelector('article').textContent.includes('中文译文')") && await sw.evaluate("__calls.filter(c => c.targetLanguage).every(c => c.targetLanguage === 'zh')"));
  check("full translation contains no learning glosses", await page.evaluate("document.querySelectorAll('.littp-gloss').length === 0"));
  check("links, emphasis and code survive", await page.evaluate(`document.getElementById('link').getAttribute('href') === '/reference' && document.getElementById('emphasis').tagName === 'EM' && document.getElementById('code').textContent === 'const value = 42;'`));
  check("navigation and sidebar retain their nodes", await page.evaluate("navigation === document.getElementById('navigation') && sidebar === document.getElementById('sidebar')"));
  const firstCount = await callCount();
  const firstAnnotationCount = await sw.evaluate("__calls.filter(c => c.annotation).length");
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
  check("key-info annotations reuse persistent cache", await sw.evaluate("__calls.filter(c => c.annotation).length") === firstAnnotationCount);
  check("annotations preserve translated text across reload and cache", await page.evaluate("document.querySelector('article').textContent") === highlightedText);
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
  await popupClick("clearCache");
  await until(popup, "document.getElementById('message').textContent.includes('已清除本页缓存')");
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

  await popupClick("clearCache");
  await mode("original");
  await sw.evaluate("globalThis.__badAnnotations = true");
  await popupClick("translate");
  await mode("translated");
  check("invalid annotations leave the complete translation visible", await page.evaluate("!document.querySelector('strong.littp-key-info') && !document.querySelector('article').textContent.includes('改写后的错误内容')") && await page.evaluate("document.querySelector('article').textContent") === highlightedText);
  const beforeRetry = await callCount();
  await sw.evaluate("globalThis.__badAnnotations = false");
  await click("translated");
  await until(page, "Boolean(document.querySelector('strong.littp-key-info'))");
  await until(page, `${bar}.getElementById('status').textContent === '全文 · 中文'`);
  check("retrying annotation does not repeat translation", await callCount() === beforeRetry);

  await popupClick("clearCache");
  await mode("original");
  await sw.evaluate("globalThis.__delayAnnotation = true");
  await popupClick("translate");
  await until(sw, "Boolean(globalThis.__releaseAnnotation)");
  await click("original");
  await sw.evaluate("globalThis.__releaseAnnotation(); globalThis.__releaseAnnotation = null");
  await sleep(250);
  check("late annotations cannot overwrite restored original", await page.evaluate("document.querySelector('article').innerHTML") === originalHtml);

  await page.send("Page.navigate", { url: `${url}/zh` });
  await until(page, "location.pathname === '/zh' && Boolean(document.getElementById('littp-toolbar-host'))");
  // The floating bar callback exercises the same action without the popup.
  await click("translated");
  await mode("translated");
  check("Chinese article translates into English", await page.evaluate("document.querySelector('article').textContent.includes('English translation')") && await sw.evaluate("__calls.filter(c => c.targetLanguage).at(-1).targetLanguage === 'en'"));
  await click("original");
  check("Chinese original is restored", await page.evaluate("document.querySelector('article').textContent.includes('沿着河堤')"));
  const inline = await page.evaluate(`(async () => {
    const { createKeyInfoAnnotator } = await import('chrome-extension://${worker.id}/content/key-info.js');
    const work = document.createElement('div');
    work.innerHTML = '<p>如果网络<a href="/status">断开</a>，请暂停上传；恢复后再继续。</p>';
    const before = work.textContent;
    const walker = document.createTreeWalker(work, NodeFilter.SHOW_TEXT);
    const groups = [];
    while (walker.nextNode()) groups.push({ node: walker.currentNode, pending: 0 });
    const annotator = createKeyInfoAnnotator(work, groups, async () => ({ annotated: '**如果网络断开**，请**暂停上传**；恢复后再继续。' }));
    annotator.flush();
    const result = await annotator.finish();
    const protectedWork = document.createElement('div');
    protectedWork.innerHTML = '<p>请执行 <code>npm test</code>，然后继续。</p>';
    const savedHtml = protectedWork.innerHTML;
    const codeAnnotator = createKeyInfoAnnotator(protectedWork, [{ node: protectedWork.firstChild.firstChild, pending: 0 }], async () => ({ annotated: '请**执行 npm test**，然后继续。' }));
    codeAnnotator.flush();
    await codeAnnotator.finish();
    return { unchanged: before === work.textContent, link: work.querySelector('a').getAttribute('href'),
      bold: [...work.querySelectorAll('strong')].map(node => node.textContent).join('|'), complete: result.annotationComplete,
      codeUnchanged: savedHtml === protectedWork.innerHTML };
  })()`);
  check("bold spans align across links without changing text or link targets", inline.unchanged && inline.link === '/status' && inline.bold === '如果网络|断开|暂停上传' && inline.complete);
  check("annotations never partially bold a phrase crossing protected code", inline.codeUnchanged);
  const concurrency = await page.evaluate(`(async () => {
    const { createKeyInfoAnnotator } = await import('chrome-extension://${worker.id}/content/key-info.js');
    const work = document.createElement('div');
    work.innerHTML = Array.from({ length: 7 }, (_, i) => '<p>第' + i + '段，请保存文件后继续。</p>').join('');
    const groups = [...work.children].map(p => ({ node: p.firstChild, pending: 0 }));
    let active = 0, maxActive = 0;
    const requests = [];
    const updates = [];
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    const annotator = createKeyInfoAnnotator(work, groups, ({ text }) => {
      active++; maxActive = Math.max(maxActive, active);
      return new Promise(resolve => requests.push({ text, done: false, finish(error = false) {
        if (this.done) return;
        this.done = true; active--;
        resolve(error ? { error: 'annotation failed' } : { annotated: text.replace('保存文件', '**保存文件**') });
      } }));
    }, { onUpdate: () => updates.push(work.querySelectorAll('strong').length) });
    annotator.flush();
    await tick();
    const initially = requests.length;
    requests[1].finish();
    await tick();
    const laterVisibleFirst = !work.children[0].querySelector('strong') && Boolean(work.children[1].querySelector('strong'));
    const refilled = requests.length === 6;
    requests[2].finish(true);
    for (let i = 0; i < 10; i++) {
      for (const request of requests) request.finish();
      await tick();
    }
    const result = await annotator.finish();
    return { initially, maxActive, laterVisibleFirst, refilled, count: requests.length,
      bold: work.querySelectorAll('strong').length, complete: result.annotationComplete, updates: updates.length };
  })()`);
  check("annotation runs five requests concurrently and refills freed slots", concurrency.initially === 5 && concurrency.maxActive === 5 && concurrency.refilled && concurrency.count === 7);
  check("out-of-order completion renders immediately; one failure does not stop other scopes", concurrency.laterVisibleFirst && concurrency.bold === 6 && !concurrency.complete && concurrency.updates === 6);
  await page.send("Page.navigate", { url: `${url}/concurrency` });
  await until(page, "location.pathname === '/concurrency' && Boolean(document.getElementById('littp-toolbar-host'))");
  await sw.evaluate("globalThis.__holdTranslations = true; globalThis.__held = []; globalThis.__maxTranslations = 0;");
  await click("translated");
  await until(sw, "__held.length === 5");
  check("five translation calls reach the model concurrently", await sw.evaluate("__activeTranslations === 5 && __maxTranslations === 5"));
  await sw.evaluate("__held[1](); __held[1] = null;");
  await until(sw, "__held.length === 6");
  await until(page, "document.querySelector('article').textContent.includes('中文译文')");
  check("out-of-order translation displays and refills its slot without waiting for first batch", await sw.evaluate("Boolean(__held[0]) && __activeTranslations === 5 && __maxTranslations === 5"));
  await sw.evaluate("globalThis.__holdTranslations = false; for (const release of __held) release?.(); globalThis.__held = [];");
  await mode("translated");
  check("concurrent translation completes within the five-request limit", await sw.evaluate("__activeTranslations === 0 && __maxTranslations === 5"));

  settings = (await harness.openTarget(`chrome-extension://${worker.id}/settings/index.html`, { background: true })).client;
  await until(settings, "document.querySelector('#promptList textarea') !== null");
  check("settings default to independent five-worker limits and bold green without background", await settings.evaluate(`
    document.getElementById('translationConcurrency').value === '5' && document.getElementById('annotationConcurrency').value === '5' &&
    document.getElementById('keyInfoBold').checked && document.getElementById('keyInfoColor').value === '#15803d' &&
    document.getElementById('keyInfoNoBackground').checked && document.getElementById('keyInfoBackground').disabled
  `));
  check("default annotation appearance is bold green and transparent", await page.evaluate(`(() => {
    const css = getComputedStyle(document.querySelector('strong.littp-key-info'));
    return css.fontWeight === '700' && css.color === 'rgb(21, 128, 61)' && css.backgroundColor === 'rgba(0, 0, 0, 0)';
  })()`));
  const callsBeforeStyle = await sw.evaluate("__calls.length");
  const textBeforeStyle = await page.evaluate("document.querySelector('article').textContent");
  await settings.evaluate(`(() => {
    document.getElementById('keyInfoBold').checked = false;
    document.getElementById('keyInfoColor').value = '#7c3aed';
    document.getElementById('keyInfoNoBackground').checked = false;
    document.getElementById('keyInfoBackground').value = '#fef3c7';
    document.getElementById('keyInfoBackground').dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  const customAppearance = `(() => {
    const css = getComputedStyle(document.querySelector('p strong.littp-key-info'));
    return css.fontWeight === '400' && css.color === 'rgb(124, 58, 237)' && css.backgroundColor === 'rgb(254, 243, 199)';
  })()`;
  await until(page, customAppearance);
  check("style controls update both preview and live translation without text changes", await settings.evaluate(customAppearance) && await page.evaluate("document.querySelector('article').textContent") === textBeforeStyle);
  await click("original");
  await click("translated");
  await mode("translated");
  check("cached translation uses current appearance without model calls", await page.evaluate(customAppearance) && await sw.evaluate("__calls.length") === callsBeforeStyle);
  await settings.evaluate(`(() => {
    document.getElementById('translationConcurrency').value = '2';
    document.getElementById('annotationConcurrency').value = '3';
    document.getElementById('saveConcurrency').click();
  })()`);
  await until(settings, "document.getElementById('concurrencyStatus').textContent.includes('已保存')");
  const configuredConcurrency = await settings.evaluate("(async () => (await chrome.runtime.sendMessage({type: 'GET_STATE', includeLemmas: false, includeCounts: false})).translationConcurrency)()");
  check("settings persist distinct limits for translation and annotation", configuredConcurrency.translation === 2 && configuredConcurrency.annotation === 3);
  await settings.evaluate("globalThis.__settingsLoaded = true");
  await settings.send("Page.reload");
  await until(settings, "!globalThis.__settingsLoaded && document.getElementById('keyInfoColor').value === '#7c3aed'");
  check("saved settings survive reopening", await settings.evaluate("document.getElementById('translationConcurrency').value === '2' && document.getElementById('annotationConcurrency').value === '3' && !document.getElementById('keyInfoBold').checked && !document.getElementById('keyInfoNoBackground').checked && document.getElementById('keyInfoBackground').value === '#fef3c7'"));
  const settingsScreenshot = await settings.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  writeFileSync(join(tmpdir(), "littp-translation-settings.png"), Buffer.from(settingsScreenshot.data, "base64"));

  // A fresh page exercises storage -> background state -> content worker limits.
  await page.send("Page.navigate", { url: `${url}/concurrency-custom` });
  await until(page, "location.pathname === '/concurrency-custom' && Boolean(document.getElementById('littp-toolbar-host'))");
  await sw.evaluate("globalThis.__holdTranslations = true; globalThis.__held = []; globalThis.__maxTranslations = 0;");
  await click("translated");
  await until(sw, "__held.length === 2");
  await sleep(150);
  check("saved translation limit reaches the model with only two active requests", await sw.evaluate("__held.length === 2 && __activeTranslations === 2 && __maxTranslations === 2"));
  await sw.evaluate("__held[1](); __held[1] = null;");
  await until(sw, "__held.length === 3");
  check("custom translation limit refills a slot without exceeding two", await sw.evaluate("__activeTranslations === 2 && __maxTranslations === 2"));
  await sw.evaluate("globalThis.__holdTranslations = false; for (const release of __held) release?.(); globalThis.__held = [];");
  await mode("translated");
  check("saved appearance applies on newly opened pages", await page.evaluate(customAppearance));

  // Hold distinct scopes to verify the pipeline passes the independent annotation limit.
  const customAnnotation = await page.evaluate(`(async () => {
    const { translateFullText } = await import('chrome-extension://${worker.id}/content/full-translation.js');
    const work = document.createElement('div');
    work.innerHTML = Array.from({ length: 8 }, (_, i) => '<p>Paragraph ' + i + ': please save files before continuing.</p>').join('');
    const requests = [];
    let active = 0, maxActive = 0;
    const job = translateFullText(work, 'zh', async request => {
      if (request.type === 'TRANSLATE_FULL_TEXT') return request.items.map(item => item.text);
      active++; maxActive = Math.max(maxActive, active);
      return new Promise(resolve => requests.push({ done: false, finish() {
        if (this.done) return;
        this.done = true; active--;
        resolve({ annotated: request.text.replace('save files', '**save files**') });
      } }));
    }, { concurrency: ${JSON.stringify(configuredConcurrency)} });
    const tick = () => new Promise(resolve => setTimeout(resolve, 0));
    await tick();
    const initially = requests.length;
    requests[1].finish();
    await tick();
    const refilled = requests.length;
    for (let i = 0; i < 10; i++) {
      for (const request of requests) request.finish();
      await tick();
    }
    const result = await job;
    return { initially, refilled, maxActive, complete: result.annotationComplete, bold: work.querySelectorAll('strong').length };
  })()`);
  check("full translation pipeline honors the independent three-worker annotation limit", customAnnotation.initially === 3 && customAnnotation.refilled === 4 && customAnnotation.maxActive === 3 && customAnnotation.complete && customAnnotation.bold === 8);
  await settings.evaluate("document.getElementById('resetKeyInfoStyle').click(); document.getElementById('resetConcurrency').click();");
  await until(page, "getComputedStyle(document.querySelector('p strong.littp-key-info')).color === 'rgb(21, 128, 61)'");
  await until(settings, "document.getElementById('translationConcurrency').value === '5'");
  check("reset restores bold green without background and both five-worker defaults", await settings.evaluate("document.getElementById('annotationConcurrency').value === '5' && document.getElementById('keyInfoBold').checked && document.getElementById('keyInfoNoBackground').checked") && await page.evaluate("getComputedStyle(document.querySelector('p strong.littp-key-info')).fontWeight === '700' && getComputedStyle(document.querySelector('p strong.littp-key-info')).backgroundColor === 'rgba(0, 0, 0, 0)'"));
  assert.deepEqual(failures, [], "full translation regression failures");
  console.log("ALL FULL TRANSLATION CHECKS PASSED");
} finally {
  settings?.close(); popup?.close(); page?.close(); sw?.close(); harness.close();
  await new Promise(resolve => server.close(resolve));
}
