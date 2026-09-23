// End-to-end reading-view harness for the Littp extension.
//
// Reproduces the user's action — open a page, click 学习视图 in the extension
// popup — against a real Chrome with the unpacked extension loaded, and asserts
// that the page ends up in the reading view.
//
// The DeepSeek call is stubbed inside the service worker, so the harness is
// hermetic: no API key, no network.
//
// Run: node scripts/diagnose-reading-view.mjs [url]
// Defaults to the local demo page, which needs:
//   python3 -m http.server 8767 --directory demo
// Pass any http(s) URL to check a real site instead. Bot-protected pages need a
// headful run: HEADFUL=1 node scripts/diagnose-reading-view.mjs <url>

import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { ChromeHarness, CdpClient, sleep } from "./lib/cdp.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "..");
const extensionPath = resolve(repo, "extension");
const TARGET_URL = process.argv[2] || `http://127.0.0.1:${process.env.DEMO_PORT || "8767"}/en.html`;
const HOST_ID = "littp-toolbar-host";

const failures = [];
function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  if (!ok) failures.push(name);
}

// Installed in the service worker: answers both DeepSeek JSON endpoints with a
// canned payload derived from the request.
const STUB_FETCH = `(() => {
  if (globalThis.__stubInstalled) return "already";
  globalThis.__stubInstalled = true;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    if (!String(url).includes("api.deepseek.com")) return realFetch(url, init);
    let payload = {};
    try { payload = JSON.parse(init.body); } catch {}
    const user = payload?.messages?.at(-1)?.content || "{}";
    let parsed = {};
    try { parsed = JSON.parse(user); } catch {}
    let content;
    if (Array.isArray(parsed.items)) {
      content = JSON.stringify({
        items: parsed.items.map((item) => ({
          span: typeof item === "string" ? item : (item && item.span) || "",
          gloss: "测试释义",
        })),
      });
    } else if (Array.isArray(parsed.paragraphs)) {
      content = JSON.stringify({ paragraphs: parsed.paragraphs.map((p) => "Stub paragraph.") });
    } else {
      content = JSON.stringify({ coverageBands: ["primary"], extraLemmas: [] });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content } }], usage: {} }), {
      status: 200, headers: { "Content-Type": "application/json" },
    });
  };
  return "installed";
})()`;

async function pickLittpWorker(harness) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const targets = await harness.targets();
    for (const t of targets) {
      if (t.type !== "service_worker" || !String(t.url).startsWith("chrome-extension://")) continue;
      const client = await CdpClient.attach(t.webSocketDebuggerUrl);
      try {
        await client.send("Runtime.enable");
        if ((await client.evaluate("chrome.runtime.getManifest().name")) === "Littp") {
          return { target: t, client, id: new URL(t.url).host };
        }
      } catch {}
      client.close();
    }
    await sleep(150);
  }
  return null;
}

async function barState(page) {
  return page.evaluate(`(() => {
    const host = document.getElementById(${JSON.stringify(HOST_ID)});
    if (!host) return { present: false };
    const root = host.shadowRoot;
    return {
      present: true,
      visible: host.style.display !== 'none',
      status: root?.getElementById('status')?.textContent ?? null,
      learningActive: root?.getElementById('learning')?.dataset.active ?? null,
      hasHideButton: Boolean(root?.getElementById('hide')),
    };
  })()`);
}

async function glossCount(page) {
  return page.evaluate(`document.querySelectorAll('span.littp-gloss').length`);
}

const harness = new ChromeHarness({
  extensionPath,
  port: 9333,
  headless: process.env.HEADFUL !== "1",
});
let pageClient = null;
let popupClient = null;
let sw = null;

try {
  await harness.launch();
  await harness.loadExtension(extensionPath);

  const worker = await pickLittpWorker(harness);
  check("extension loaded", Boolean(worker), worker?.id || "no Littp service worker");
  if (!worker) throw new Error("Littp extension did not load");
  sw = worker.client;
  const extId = worker.id;

  // A configured install: key present and onboarding finished, so the reading
  // view is allowed to mount.
  await sw.evaluate(`(async () => {
    await chrome.storage.local.set({ apiKey: "sk-stub", onboardingDone: true, coverageBands: ["primary", "junior"] });
    return true;
  })()`);
  const stub = await sw.evaluate(STUB_FETCH);
  check("model call stubbed", stub === "installed" || stub === "already", stub);

  const demo = await harness.openTarget("about:blank");
  pageClient = demo.client;
  const exceptions = [];
  await pageClient.send("Runtime.enable");
  await pageClient.send("Log.enable");
  await pageClient.send("Page.enable");
  pageClient.on("Runtime.exceptionThrown", (p) => {
    exceptions.push(p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || "unknown");
  });
  pageClient.send("Page.navigate", { url: TARGET_URL }).catch(() => {});
  await sleep(3000);

  const importErrors = exceptions.filter((e) => /import statement outside a module/i.test(e));
  console.log(`\npage console errors: ${exceptions.length}`);
  for (const e of exceptions.slice(0, 4)) console.log(`  - ${e.split("\n")[0]}`);

  check("declared content script is valid for Chrome content_scripts",
    importErrors.length === 0, importErrors[0]?.split("\n")[0] || "");
  const before = await barState(pageClient);
  check("Littp bar is mounted on page load (no click needed)",
    before.present === true, JSON.stringify(before));
  check("bar stays hidden while the page is in the original view",
    before.visible === false, JSON.stringify(before));
  check("bar offers a temporary-hide button", before.hasHideButton === true);

  // Click 学习视图 in the real popup page, with the demo tab as the active tab.
  const popup = await harness.openTarget(`chrome-extension://${extId}/popup/popup.html`, { background: true });
  popupClient = popup.client;
  await popupClient.send("Runtime.enable");
  await sleep(1200);
  await harness.activateTarget(demo.target.id);
  await sleep(300);

  const popupReady = await popupClient.evaluate(
    `JSON.stringify({ tabId: window.__tabId ?? null, url: window.__tabUrl ?? "", host: window.__host ?? "" })`,
  );
  console.log(`\npopup sees active tab -> ${popupReady}`);

  await popupClient.evaluate(`document.getElementById('learn').click(); true`);
  await sleep(4000);

  const popupMessage = await popupClient.evaluate(`document.getElementById('message').textContent`);
  const after = await barState(pageClient);
  const glosses = await glossCount(pageClient);
  console.log(`popup #message -> ${JSON.stringify(popupMessage)}`);
  console.log(`bar after click -> ${JSON.stringify(after)}`);
  console.log(`gloss spans in document -> ${glosses}`);

  check("popup targeted the page tab", JSON.parse(popupReady).url === TARGET_URL, popupReady);
  check("popup click reports no error", !popupMessage || popupMessage.trim() === "", popupMessage);
  check("reading view is active in the bar", after.learningActive === "true", JSON.stringify(after));
  check("bar shows once the reading view is active", after.visible === true, JSON.stringify(after));
  check("page text gained Chinese glosses", glosses > 0, `${glosses} gloss spans`);

  // The × button hides the bar without leaving the reading view.
  await pageClient.evaluate(
    `document.getElementById(${JSON.stringify(HOST_ID)}).shadowRoot.getElementById('hide').click(); true`,
  );
  await sleep(400);
  const hidden = await barState(pageClient);
  const glossesAfterHide = await glossCount(pageClient);
  console.log(`bar after × -> ${JSON.stringify(hidden)}`);
  check("× hides the bar", hidden.visible === false, JSON.stringify(hidden));
  check("× keeps the reading view active", hidden.learningActive === "true");
  check("× does not undo the processing", glossesAfterHide === glosses, `${glossesAfterHide} vs ${glosses}`);

  // Re-activating from the popup brings the bar back.
  await popupClient.evaluate(`document.getElementById('learn').click(); true`);
  await sleep(2500);
  const reshown = await barState(pageClient);
  console.log(`bar after re-activation -> ${JSON.stringify(reshown)}`);
  check("a new popup activation brings the bar back", reshown.visible === true, JSON.stringify(reshown));
} catch (error) {
  check("harness ran", false, error?.message || String(error));
} finally {
  pageClient?.close();
  popupClient?.close();
  sw?.close();
  harness.close();
}

console.log(`\n${failures.length ? `FAILED (${failures.length}): ${failures.join("; ")}` : "ALL CHECKS PASSED"}`);
process.exit(failures.length ? 1 : 0);
