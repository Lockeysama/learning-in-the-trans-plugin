// Real Chrome + unpacked extension; DeepSeek is stubbed in the worker.
// Run: node scripts/check-selection-translation.mjs (no API key or server needed).
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ChromeHarness, sleep } from "./lib/cdp.mjs";

const extensionPath = fileURLToPath(new URL("../extension", import.meta.url));
const sentence = "We take reliable internet access for granted.";
const server = createServer((_request, response) => {
  response.setHeader("Content-Type", "text/html; charset=utf-8");
  response.end(`<!doctype html><html><meta charset="utf-8"><title>Instant translation check</title>
    <body style="font:20px/1.8 system-ui;padding:24px;background:#fffcf6">
    <h1>Reading with Littp</h1><p id="sentence">We take reliable <em>internet</em> access for granted.</p>
    <p id="word">The bank approved the loan.</p><p id="chinese">可靠的网络接入</p>
    <p id="long" style="height:20px;overflow:hidden">${"An earlier sentence. ".repeat(230)}The river bank was steep.</p>
    <p id="limit">${"word ".repeat(420)}</p><div contenteditable="true" id="editable">editable text</div>
    </body></html>`);
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const url = `http://127.0.0.1:${server.address().port}/`;
const harness = new ChromeHarness({ extensionPath, port: 9334 });
let page;
let sw;
const root = `document.getElementById('littp-select-host').shadowRoot`;
const resultText = `${root}.getElementById('translation').textContent`;
const check = (name, condition) => { assert.ok(condition, name); console.log(`PASS ${name}`); };

async function until(expression) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await page.evaluate(expression)) return;
    await sleep(50);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function select(id, text = "") {
  await page.evaluate(`(() => {
    const element = document.getElementById(${JSON.stringify(id)});
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    const text = ${JSON.stringify(text)};
    if (!text) range.selectNodeContents(element);
    else {
      const offset = element.textContent.lastIndexOf(text);
      range.setStart(element.firstChild, offset);
      range.setEnd(element.firstChild, offset + text.length);
    }
    selection.addRange(range);
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  })()`);
  await sleep(60);
}

async function click(id) { await page.evaluate(`${root}.getElementById(${JSON.stringify(id)}).click()`); }
async function expand(index) { await page.evaluate(`${root}.querySelectorAll('details')[${index}].open = true`); }
async function calls() { return sw.evaluate("globalThis.__calls"); }

try {
  await harness.launch();
  await harness.loadExtension(extensionPath);
  const worker = await harness.findExtensionWorker("Littp");
  assert.ok(worker, "extension worker loaded");
  sw = worker.client;
  await sw.evaluate(`(() => {
    globalThis.__calls = [];
    const original = fetch;
    globalThis.fetch = async (url, init) => {
      if (!String(url).includes('api.deepseek.com')) return original(url, init);
      const request = JSON.parse(init.body);
      const input = JSON.parse(request.messages.at(-1).content);
      __calls.push(input);
      if (globalThis.__delayNext) {
        globalThis.__delayNext = false;
        await new Promise(resolve => { globalThis.__release = resolve; });
      }
      if (globalThis.__failNext) {
        globalThis.__failNext = false;
        return new Response(JSON.stringify({ error: { message: '测试请求失败' } }), { status: 503 });
      }
      let result;
      if (input.mode === 'natural') {
        const word = input.text === 'bank';
        result = { kind: word ? 'word' : input.text.includes('.') ? 'sentence' : 'phrase',
          translation: word ? '银行' : /[\\u4e00-\\u9fff]/.test(input.text) ? 'Reliable internet access' : '我们觉得，能稳定上网是理所当然的。',
          partOfSpeech: word ? '名词' : '', note: '' };
      } else if (input.mode === 'literal') {
        result = { translation: '我们把可靠的互联网接入视为理所当然。', note: '' };
      } else if (input.mode === 'analysis') {
        result = { units: [{ source: 'We', meaning: '我们', role: '主语' },
          { source: 'take … for granted', meaning: '把……视为理所当然', role: '固定搭配' },
          { source: 'reliable internet access', meaning: '可靠的互联网接入', role: '宾语' }],
          structure: '主语 + take + 宾语 + for granted。', usage: 'take + 某事物 + for granted' };
      } else result = { ipa: '/bæŋk/', hint: '班克' };
      if (globalThis.__invalidNext) { result = {}; globalThis.__invalidNext = false; }
      if (globalThis.__htmlNext) { result.translation = '<img src=x onerror=alert(1)>'; globalThis.__htmlNext = false; }
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(result) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }), { status: 200 });
    };
  })()`);
  page = (await harness.openTarget(url)).client;
  await page.send("Runtime.enable");
  await until("Boolean(document.getElementById('littp-select-host'))");

  await select("sentence");
  await click("dot");
  await click("translate");
  await until(`${resultText}.includes('API Key')`);
  check("missing key offers a retry without a model call", (await calls()).length === 0);
  await sw.evaluate(`chrome.storage.local.set({ apiKey: 'sk-stub', extraLemmas: [], extraUnknowns: [] })`);
  await page.evaluate(`${root}.querySelector('.retry').click()`);
  await until(`${root}.querySelectorAll('details').length === 2`);
  check("first response only requests natural translation", (await calls()).length === 1 && (await calls())[0].mode === "natural");
  check("raw selection keeps punctuation and spans inline elements", (await calls())[0].text === sentence);
  check("learning layers start collapsed", await page.evaluate(`[...${root}.querySelectorAll('details')].every(d => !d.open)`));

  await expand(0);
  await until(`${resultText}.includes('我们把可靠')`);
  await expand(1);
  await until(`${resultText}.includes('固定搭配')`);
  check("each learning layer is fetched independently", (await calls()).map(c => c.mode).join(",") === "natural,literal,analysis");
  await page.evaluate(`${root}.querySelectorAll('details')[1].open = false`);
  await sleep(60);
  await expand(1);
  await sleep(60);
  check("reopening a successful layer reuses its result", (await calls()).length === 3);
  check("lookups do not write to vocabulary", await sw.evaluate(`(async () => {
    const data = await chrome.storage.local.get(['extraLemmas', 'extraUnknowns']);
    return !data.extraLemmas.length && !data.extraUnknowns.length;
  })()`));

  await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 650, deviceScaleFactor: 1, mobile: false });
  await page.evaluate(`(() => { const wrap = ${root}.getElementById('wrap'); wrap.style.left = '380px'; wrap.style.top = '640px'; window.dispatchEvent(new Event('resize')); })()`);
  check("expanded panel fits narrow viewport at bottom-right", await page.evaluate(`(() => {
    const rect = ${root}.getElementById('menu').getBoundingClientRect();
    return rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
  })()`));
  const screenshot = await page.send("Page.captureScreenshot", { format: "png" });
  const screenshotPath = join(tmpdir(), "littp-selection-translation.png");
  writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
  console.log(`Screenshot: ${screenshotPath}`);
  await page.send("Emulation.clearDeviceMetricsOverride");

  await select("word", "bank");
  await click("translate");
  await until(`${resultText}.includes('银行')`);
  check("single words show contextual meaning and only one learning layer", await page.evaluate(`${root}.querySelectorAll('details').length === 1 && ${resultText}.includes('词义与用法') && ${resultText}.includes('名词')`));
  check("word receives surrounding sentence", (await calls()).at(-1).context === "The bank approved the loan.");

  await select("long", "bank");
  await click("translate");
  await until(`${resultText}.includes('银行')`);
  check("context centers on selected occurrence deep in a long block", (await calls()).at(-1).context.includes("The river bank was steep."));

  await select("chinese");
  await click("translate");
  await until(`${resultText}.includes('Reliable internet access')`);
  check("Chinese phrases translate without enabling English vocabulary actions", await page.evaluate(`${root}.getElementById('addKnown').disabled && ${root}.querySelectorAll('details').length === 2`));

  await select("sentence");
  await sw.evaluate("globalThis.__delayNext = true");
  await click("translate");
  for (let i = 0; i < 100 && !(await sw.evaluate("Boolean(globalThis.__release)")); i++) await sleep(30);
  await select("word", "bank");
  await click("translate");
  await until(`${resultText}.includes('银行')`);
  await sw.evaluate("globalThis.__release(); globalThis.__release = null");
  await sleep(150);
  check("late response cannot replace a newer selection", await page.evaluate(`${resultText}.includes('银行') && !${resultText}.includes('我们觉得')`));

  await sw.evaluate("globalThis.__failNext = true");
  await expand(0);
  await until(`${resultText}.includes('测试请求失败')`);
  check("detail failure preserves natural result", await page.evaluate(`${resultText}.includes('银行')`));
  await page.evaluate(`${root}.querySelector('.retry').click()`);
  await until(`${resultText}.includes('固定搭配')`);
  check("detail retry succeeds", !(await page.evaluate(`${resultText}.includes('测试请求失败')`)));

  await select("sentence");
  await sw.evaluate("globalThis.__invalidNext = true");
  await click("translate");
  await until(`${resultText}.includes('没有得到有效译文')`);
  check("malformed model output is surfaced as a retryable error", await page.evaluate(`Boolean(${root}.querySelector('.retry'))`));
  await sw.evaluate("globalThis.__htmlNext = true");
  await page.evaluate(`${root}.querySelector('.retry').click()`);
  await until(`${resultText}.includes('<img')`);
  check("model text is never interpreted as HTML", await page.evaluate(`${root}.querySelectorAll('img').length === 0`));

  const count = (await calls()).length;
  await select("limit");
  await click("translate");
  await until(`${resultText}.includes('过长')`);
  check("oversized selection is rejected without a model call", (await calls()).length === count);

  await select("word", "bank");
  await click("pronounce");
  await until(`${root}.getElementById('status').textContent.includes('/bæŋk/')`);
  check("pronunciation still works", true);
  await click("addKnown");
  await until(`${root}.getElementById('status').textContent.includes('很熟悉')`);
  check("explicit known-word action still saves the word", await sw.evaluate(`(async () => (await chrome.storage.local.get('extraLemmas')).extraLemmas.includes('bank'))()`));

  await select("sentence");
  await sw.evaluate("globalThis.__delayNext = true");
  await click("translate");
  for (let i = 0; i < 100 && !(await sw.evaluate("Boolean(globalThis.__release)")); i++) await sleep(30);
  await page.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
  await sw.evaluate("globalThis.__release(); globalThis.__release = null");
  await sleep(150);
  check("Escape closes pending translation permanently", await page.evaluate(`${root}.getElementById('wrap').hidden && ${root}.getElementById('translation').hidden`));
  await select("editable");
  check("editable fields do not activate the selector", await page.evaluate(`${root}.getElementById('wrap').hidden`));
  console.log("ALL SELECTION TRANSLATION CHECKS PASSED");
} finally {
  page?.close();
  sw?.close();
  harness.close();
  await new Promise(resolve => server.close(resolve));
}
