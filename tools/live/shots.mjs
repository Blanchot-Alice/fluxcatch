#!/usr/bin/env node
// Havre visual check: open every extension surface in Chrome for Testing
// (headless, fresh profile, no network fixtures) in light and dark mode and
// write PNGs to tools/live/out/shots/. The downloads page is seeded with a few
// history records through the extension's own storage so rows render.
//
//   node tools/live/shots.mjs [--out DIR]
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const EXTENSION_DIR = path.join(ROOT, "extension");
const OUT = path.resolve(process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : path.join(HERE, "out", "shots"));
const START_TIMEOUT_MS = 25_000;

// Selectors follow the v2 surfaces: the popup's views are [data-view] and the
// link field of the shared Download dialog is #mediaLink. The Downloads page's
// #statusLine carries, in priority order, the disconnected line (tone
// "failed"), the engine line (one action, Set up) and the notification prompt
// (two actions, Turn on and Don't notify); HIDE_NOTIFY_PROMPT hides the line
// only when it is the notification prompt, so the engine line stays in shot.
// The preview has one view per screen (?view=type|text|controls|rows|feedback|overlays).
const HIDE_NOTIFY_PROMPT = "{ const l = document.querySelector('#statusLine'); if (l && !l.dataset.tone && l.querySelectorAll('.line-actions .btn').length === 2) l.hidden = true; }";
const SHOTS = [
  { name: "popup-media-empty", page: "popup/popup.html", width: 372, height: 600 },
  { name: "popup-jobs", page: "popup/popup.html", width: 372, height: 600, prepare: "document.querySelector('[data-view=\"downloads\"]').click()" },
  { name: "sidepanel", page: "sidepanel/sidepanel.html", width: 420, height: 820 },
  { name: "downloads", page: "downloads/downloads.html", width: 1100, height: 820, prepare: HIDE_NOTIFY_PROMPT },
  { name: "downloads-narrow", page: "downloads/downloads.html", width: 480, height: 820, prepare: HIDE_NOTIFY_PROMPT },
  { name: "downloads-new-link", page: "downloads/downloads.html", width: 1100, height: 820, prepare: `${HIDE_NOTIFY_PROMPT}; document.querySelector('#urlInput').value = 'https://example.com/talks/keynote-2026.m3u8'` },
  { name: "popup-link-dialog", page: "popup/popup.html", width: 372, height: 600, prepare: "document.querySelector('#urlButton').click(); const input = document.querySelector('#mediaLink'); input.value = 'https://example.com/clip.mp4'; input.dispatchEvent(new Event('input', { bubbles: true }))" },
  { name: "options", page: "options/options.html", width: 1100, height: 900 },
  ...["type", "text", "controls", "rows", "feedback", "overlays"].map((view) => ({ name: `preview-${view}`, page: `preview/preview.html?demo=static&view=${view}`, width: 1440, height: 1600 })),
  { name: "preview-compact-reduced", page: "preview/preview.html?view=rows&density=compact&motion=reduced&demo=static", width: 1440, height: 1600 }
];

const HISTORY = [
  record("h1", "completed", "Interstellar Trailer 4K.mp4", 2.35e9, { duration: 148, width: 3840, height: 2160, container: "mp4", videoCodec: "hevc", audioCodec: "aac" }, "https://www.youtube.com/watch?v=zSWdZVtXT7E", "YouTube", 0),
  record("h2", "completed", "Keynote Highlights.m4a", 48_300_000, { duration: 1860, container: "m4a", audioCodec: "aac" }, "https://developer.apple.com/videos/play/wwdc2025/101/", "Apple Developer", 1),
  record("h3", "completed", "Lecture 12 · Pharmacokinetics.mp4", 812_000_000, { duration: 3480, width: 1920, height: 1080, container: "mp4", videoCodec: "h264", audioCodec: "aac" }, "https://www.ucl.ac.uk/", "UCL Lecturecast", 1),
  record("h4", "failed", "Live Session.m3u8", 0, null, "https://example.tv/live/42", "example.tv", 2, "源站在第 12 个片段后返回 403，已重试 3 次"),
  record("h5", "cancelled", "Behind the Scenes.webm", 0, null, "https://vimeo.com/1234567", "Vimeo", 9)
];

function record(id, status, filename, size, media, sourceUrl, sourceTitle, daysAgo, message) {
  const endedAt = Date.now() - daysAgo * 86_400_000 - 3_600_000;
  return {
    jobId: `shot:${id}`,
    status,
    method: "native",
    kind: filename.endsWith(".m3u8") ? "hls" : filename.endsWith(".m4a") ? "audio" : "video",
    filename,
    size,
    bytes: size,
    total: size,
    media,
    sourceUrl,
    sourceTitle,
    pageTitle: sourceTitle,
    createdAt: endedAt - 120_000,
    startedAt: endedAt - 118_000,
    finishedAt: endedAt,
    sourceHost: new URL(sourceUrl).hostname,
    elapsedMs: 118_000,
    path: status === "completed" ? `/Users/you/Downloads/Havre/${filename}` : null,
    message: message || null,
    error: status === "failed" ? message : null,
    retryable: status !== "completed"
  };
}

function discoverChrome() {
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

function launch(executable, profile) {
  const args = [
    "--headless=new", "--lang=zh-CN", "--window-size=1280,900", "--remote-debugging-port=0", "--remote-allow-origins=*",
    `--user-data-dir=${profile}`, `--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`,
    "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--disable-component-update",
    "--disable-default-apps", "--disable-sync", "--metrics-recording-only", "--password-store=basic", "--use-mock-keychain", "about:blank"
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
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Chrome exited early (${code})${code === 21 ? " — profile still locked by the previous session" : ""}\n${buffer.slice(-2000)}`)); });
  });
}

class Cdp {
  static async connect(url) { const client = new Cdp(url); await client.open(); return client; }
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); }
  open() {
    this.socket = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      this.socket.addEventListener("open", () => resolve(), { once: true });
      this.socket.addEventListener("error", () => reject(new Error(`CDP error ${this.url}`)), { once: true });
      this.socket.addEventListener("message", (event) => {
        let message; try { message = JSON.parse(String(event.data)); } catch { return; }
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        message.error ? pending.reject(new Error(`${pending.method}: ${message.error.message}`)) : pending.resolve(message.result || {});
      });
    });
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

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || "evaluation failed");
  return result.result?.value;
}

async function poll(fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await fn().catch(() => null);
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function targets(http) {
  const response = await fetch(`${http}/json/list`, { cache: "no-store" });
  return response.json();
}

async function session(profile, run) {
  const chrome = discoverChrome();
  const { child, ws, http } = await launch(chrome, profile);
  const browser = await Cdp.connect(ws);
  try {
    const worker = await poll(async () => (await targets(http)).find((t) => t.type === "service_worker" && t.url.includes("/background.js")), START_TIMEOUT_MS, "service worker");
    const extensionId = new URL(worker.url).host;
    await run({ browser, http, pageUrl: (page) => `chrome-extension://${extensionId}/${page}` });
  } finally {
    browser.close();
    child.kill("SIGTERM");
    // Wait for the process to actually exit so the next session can reuse the
    // profile; recent Chrome builds take longer than a fixed pause to release
    // the SingletonLock, which otherwise ends the next launch with code 21.
    await new Promise((resolve) => {
      const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 8000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
    for (const lock of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) fs.rmSync(path.join(profile, lock), { force: true });
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
}

async function openPage(browser, http, url) {
  const { targetId } = await browser.send("Target.createTarget", { url, background: true });
  const target = await poll(async () => (await targets(http)).find((t) => t.id === targetId && t.type === "page"), START_TIMEOUT_MS, url);
  const page = await Cdp.connect(target.webSocketDebuggerUrl);
  await page.send("Runtime.enable");
  return { page, targetId };
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "havre-shots-"));
  try {
    // Session 1 seeds history through a trusted extension page. The worker
    // reads history once at startup, so session 2 starts fresh on the same
    // profile and serves the seeded records.
    await session(profile, async ({ browser, http, pageUrl }) => {
      const { page, targetId } = await openPage(browser, http, pageUrl("options/options.html"));
      await evaluate(page, `chrome.storage.local.set({ "downloadHistory.v1": ${JSON.stringify(HISTORY)} })`);
      page.close();
      await browser.send("Target.closeTarget", { targetId }).catch(() => {});
    });
    await session(profile, async ({ browser, http, pageUrl }) => {
      for (const scheme of ["light", "dark"]) {
        for (const shot of SHOTS) {
          const { page, targetId } = await openPage(browser, http, pageUrl(shot.page));
          try {
            await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
            await page.send("Emulation.setDeviceMetricsOverride", { width: shot.width, height: shot.height, deviceScaleFactor: 2, mobile: false });
            await page.send("Page.enable");
            await new Promise((resolve) => setTimeout(resolve, 900));
            if (shot.prepare) await evaluate(page, shot.prepare).catch(() => {});
            await new Promise((resolve) => setTimeout(resolve, 500));
            const data = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
            const file = path.join(OUT, `${shot.name}-${scheme}.png`);
            fs.writeFileSync(file, Buffer.from(data.data, "base64"));
            console.log("wrote", path.relative(ROOT, file));
          } finally {
            page.close();
            await browser.send("Target.closeTarget", { targetId }).catch(() => {});
          }
        }
      }
    });
  } finally {
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
