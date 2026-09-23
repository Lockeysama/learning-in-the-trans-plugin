// Minimal dependency-free Chrome DevTools Protocol client.
// Used by the content-script loading harness; Node 22 ships a global WebSocket.

import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export function chromePath() {
  return process.env.CHROME_BIN || CHROME;
}

async function pollJson(url, { tries = 100, delayMs = 100 } = {}) {
  let lastError;
  for (let i = 0; i < tries; i += 1) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
      lastError = new Error(`${url} -> HTTP ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`CDP endpoint never came up: ${url}: ${lastError?.message}`);
}

export class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id != null) {
        const entry = this.pending.get(msg.id);
        if (!entry) return;
        this.pending.delete(msg.id);
        if (msg.error) entry.reject(new Error(`${msg.error.message} (${JSON.stringify(msg.error.data ?? "")})`));
        else entry.resolve(msg.result);
        return;
      }
      for (const fn of this.listeners.get(msg.method) || []) fn(msg.params);
    });
  }

  static async attach(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", () => reject(new Error(`ws failed: ${wsUrl}`)), { once: true });
    });
    return new CdpClient(ws);
  }

  on(method, fn) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(fn);
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression, { awaitPromise = true } = {}) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      awaitPromise,
      returnByValue: true,
      userGesture: true,
    });
    if (result.exceptionDetails) {
      const text = result.exceptionDetails.exception?.description
        || result.exceptionDetails.text
        || "evaluate failed";
      throw new Error(text);
    }
    return result.result.value;
  }

  close() {
    try { this.ws.close(); } catch {}
  }
}

export class ChromeHarness {
  constructor({ extensionPath, port = 9333, headless = true } = {}) {
    this.extensionPath = extensionPath;
    this.port = port;
    this.headless = headless;
    this.profileDir = mkdtempSync(join(tmpdir(), "littp-chrome-"));
    this.proc = null;
  }

  get httpBase() {
    return `http://127.0.0.1:${this.port}`;
  }

  async launch({ extraArgs = [] } = {}) {
    this.proc = spawn(chromePath(), [
      `--remote-debugging-port=${this.port}`,
      `--user-data-dir=${this.profileDir}`,
      ...(this.headless ? ["--headless=new"] : []),
      // Offscreen so a headful run does not disturb the desktop.
      "--window-position=-4000,-4000",
      "--window-size=1454,979",
      // Required when Chrome runs inside the agent's own file sandbox: without it the
      // crashpad/sandbox helper processes cannot start and Chrome exits immediately.
      "--no-sandbox",
      "--disable-gpu",
      "--disable-crash-reporter",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-background-networking",
      "--disable-component-update",
      "--remote-allow-origins=*",
      ...extraArgs,
      "about:blank",
    ], { stdio: ["ignore", "ignore", "pipe"] });
    this.proc.stderr.on("data", () => {});
    const version = await pollJson(`${this.httpBase}/json/version`);
    this.browserWsUrl = version.webSocketDebuggerUrl;
    return this;
  }

  // Chrome 153 removed the --load-extension command line switch; the supported
  // automation path is the CDP Extensions domain on the browser target.
  async loadExtension(extensionPath) {
    const browser = await this.browser();
    await browser.send("Extensions.loadUnpacked", { path: extensionPath });
    await new Promise((r) => setTimeout(r, 1000));
    return this;
  }

  async browser() {
    this._browserClient ||= await CdpClient.attach(this.browserWsUrl);
    return this._browserClient;
  }

  async targets() {
    return pollJson(`${this.httpBase}/json/list`);
  }

  async waitForTarget(predicate, { tries = 100, delayMs = 100 } = {}) {
    for (let i = 0; i < tries; i += 1) {
      const list = await this.targets();
      const found = list.find(predicate);
      if (found) return found;
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  async extensionId() {
    const sw = await this.waitForTarget(
      (t) => t.type === "service_worker" && String(t.url).startsWith("chrome-extension://"),
    );
    if (!sw) return null;
    return new URL(sw.url).host;
  }

  // A fresh profile also hosts Chrome's own component extensions, so match on the
  // manifest name instead of taking the first service worker.
  async findExtensionWorker(name, { tries = 60, delayMs = 200 } = {}) {
    for (let attempt = 0; attempt < tries; attempt += 1) {
      const targets = await this.targets();
      for (const target of targets) {
        if (target.type !== "service_worker") continue;
        if (!String(target.url).startsWith("chrome-extension://")) continue;
        const client = await CdpClient.attach(target.webSocketDebuggerUrl);
        try {
          await client.send("Runtime.enable");
          if ((await client.evaluate("chrome.runtime.getManifest().name")) === name) {
            return { target, client, id: new URL(target.url).host };
          }
        } catch {
          /* not a worker we can talk to */
        }
        client.close();
      }
      await new Promise((r) => setTimeout(r, delayMs));
    }
    return null;
  }

  async openPage(url) {
    const res = await fetch(`${this.httpBase}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
    if (!res.ok) throw new Error(`/json/new failed: HTTP ${res.status}`);
    const target = await res.json();
    return CdpClient.attach(target.webSocketDebuggerUrl);
  }

  // Creates a tab (optionally in the background) and returns both the target
  // descriptor and an attached CDP client.
  async openTarget(url, { background = false } = {}) {
    const browser = await this.browser();
    const { targetId } = await browser.send("Target.createTarget", { url, background });
    let info = null;
    for (let i = 0; i < 60 && !info; i += 1) {
      const list = await this.targets();
      info = list.find((t) => t.id === targetId) || null;
      if (!info) await new Promise((r) => setTimeout(r, 100));
    }
    if (!info) throw new Error(`target ${targetId} never appeared`);
    const client = await CdpClient.attach(info.webSocketDebuggerUrl);
    return { target: info, client };
  }

  async activateTarget(targetId) {
    const browser = await this.browser();
    await browser.send("Target.activateTarget", { targetId });
  }

  close() {
    try { this._browserClient?.close(); } catch {}
    this.proc?.kill("SIGKILL");
    try { rmSync(this.profileDir, { recursive: true, force: true }); } catch {}
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
