// Minimal Chrome DevTools Protocol harness for the design audit and screenshot
// tools: finds Chrome for Testing, launches it with the unpacked extension in a
// disposable profile, and speaks CDP over the global WebSocket (Node 22+).
// Same approach as tools/live/shots.mjs and e2e/run.mjs; no npm dependencies.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { inflateSync } from "node:zlib";

export const START_TIMEOUT_MS = 25_000;

/**
 * On macOS, headless Chrome paces frames on the display's vsync; once the
 * display sleeps because the user is idle, no frame arrives and
 * Page.captureScreenshot never resolves. The default launch flags below
 * (software compositing without vsync or a frame-rate limit) avoid that without
 * touching the display. HAVRE_CAFFEINATE=1 additionally holds a
 * "user is active" power assertion for the lifetime of this process.
 */
export const RENDER_FLAGS = ["--disable-gpu", "--disable-gpu-vsync", "--disable-frame-rate-limit"];

export function keepDisplayAwake() {
  if (process.platform !== "darwin" || !process.env.HAVRE_CAFFEINATE) return null;
  try {
    const child = spawn("/usr/bin/caffeinate", ["-d", "-i", "-u", "-w", String(process.pid)], { stdio: "ignore", detached: false });
    child.on("error", () => {});
    return child;
  } catch {
    return null;
  }
}

export function discoverChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const stack = [cache];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory() && dir.split(path.sep).length - cache.split(path.sep).length < 8) stack.push(full);
      else if (full.endsWith("/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")) candidates.push(full);
    }
  }
  candidates.push("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
  const usable = candidates.filter((file) => { try { fs.accessSync(file, fs.constants.X_OK); return true; } catch { return false; } });
  if (!usable.length) throw new Error("Chrome for Testing not found; set CHROME_PATH");
  usable.sort((a, b) => b.localeCompare(a));
  return usable[0];
}

export function launch(executable, { profile, extensionDir, lang = "en-US", args: extraArgs = [] }) {
  const args = [
    "--headless=new", `--lang=${lang}`, "--window-size=1280,900", "--remote-debugging-port=0", "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, `--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
    "--disable-default-apps", "--disable-sync", "--metrics-recording-only", "--password-store=basic", "--use-mock-keychain",
    ...RENDER_FLAGS,
    ...(process.env.HAVRE_CHROME_FLAGS ? process.env.HAVRE_CHROME_FLAGS.split(" ").filter(Boolean) : []),
    ...extraArgs,
    "about:blank"
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not expose DevTools\n${buffer.slice(-2000)}`)), START_TIMEOUT_MS);
    child.stderr.on("data", (chunk) => {
      buffer += chunk.toString();
      const match = buffer.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve({ child, ws: match[1], http: `http://${new URL(match[1]).host}` });
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited early (${code})${code === 21 ? " — profile still locked by the previous session" : ""}\n${buffer.slice(-2000)}`));
    });
  });
}

export class Cdp {
  static async connect(url) { const client = new Cdp(url); await client.open(); return client; }
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); this.listeners = new Map(); }
  open() {
    this.socket = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error(`CDP error ${this.url}`)), { once: true });
      this.socket.addEventListener("message", (event) => {
        let message; try { message = JSON.parse(String(event.data)); } catch { return; }
        if (message.method) {
          for (const listener of this.listeners.get(message.method) || []) listener(message.params || {});
          return;
        }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(`${pending.method}: ${message.error.message}`)) : pending.resolve(message.result || {});
      });
    });
  }
  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }
  send(method, params = {}, timeoutMs = START_TIMEOUT_MS) {
    const id = this.id++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); }, method });
    });
  }
  close() { try { this.socket.close(); } catch { /* closed */ } }
}

export async function evaluate(client, expression, timeoutMs = START_TIMEOUT_MS) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }, timeoutMs);
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
  return result.result?.value;
}

export async function poll(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`timed out waiting for ${label}`);
}

export async function targets(http) {
  const response = await fetch(`${http}/json/list`, { cache: "no-store" });
  return response.json();
}

/** One browser session: launch, find the extension id, run, then shut down
 *  and wait for the profile lock to be released so a later session can reuse it. */
export async function session({ profile, extensionDir, lang, args = [] }, run) {
  const chrome = discoverChrome();
  const { child, ws, http } = await launch(chrome, { profile, extensionDir, lang, args });
  const browser = await Cdp.connect(ws);
  try {
    const worker = await poll(async () => (await targets(http)).find((t) => t.type === "service_worker" && t.url.includes("/background.js")), START_TIMEOUT_MS, "service worker");
    const extensionId = new URL(worker.url).host;
    await run({ browser, http, worker, extensionId, pageUrl: (page) => `chrome-extension://${extensionId}/${page}` });
  } finally {
    browser.close();
    child.kill("SIGTERM");
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) fs.rmSync(path.join(profile, lock), { force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

export async function openPage(browser, http, url) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", background: true });
  const target = await poll(async () => (await targets(http)).find((t) => t.id === targetId && t.type === "page"), START_TIMEOUT_MS, url);
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  await page.send("Page.enable");
  return {
    page,
    targetId,
    async close() {
      page.close();
      await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    },
    async navigate(nextUrl) {
      const loaded = new Promise((resolve) => page.on("Page.loadEventFired", resolve));
      await page.send("Page.navigate", { url: nextUrl });
      await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 8000))]);
    }
  };
}

/** Decode an 8-bit, non-interlaced PNG (colour type 2 or 6) to RGBA. */
export function decodePng(buffer) {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => buffer[index] === byte)) throw new Error("not a PNG");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = 6;
  const chunks = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8) throw new Error("only 8-bit PNG supported");
      colorType = data[9];
      if (colorType !== 2 && colorType !== 6) throw new Error(`unsupported PNG colour type ${colorType}`);
      if (data[12] !== 0) throw new Error("interlaced PNG not supported");
    } else if (type === "IDAT") chunks.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  const channels = colorType === 6 ? 4 : 3;
  const stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks));
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[source++];
    for (let column = 0; column < stride; column += 1) {
      const value = raw[source++];
      const left = column >= channels ? line[column - channels] : 0;
      const up = prev[column];
      const upLeft = column >= channels ? prev[column - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const pa = Math.abs(estimate - left);
        const pb = Math.abs(estimate - up);
        const pc = Math.abs(estimate - upLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft;
      }
      line[column] = (value + predictor) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const target = (row * width + x) * 4;
      out[target] = line[x * channels];
      out[target + 1] = line[x * channels + 1];
      out[target + 2] = line[x * channels + 2];
      out[target + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
}

/** sRGB 8-bit to CIE L*a*b* (D65). */
export function srgbToLab(r, g, b) {
  const lin = [r, g, b].map((v) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; });
  const x = (0.4124564 * lin[0] + 0.3575761 * lin[1] + 0.1804375 * lin[2]) / 0.95047;
  const y = 0.2126729 * lin[0] + 0.7151522 * lin[1] + 0.072175 * lin[2];
  const z = (0.0193339 * lin[0] + 0.119192 * lin[1] + 0.9503041 * lin[2]) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
