#!/usr/bin/env node
// Rasterise the extension icons from their SVG sources with Chrome for Testing
// (the same renderer the extension runs in), at exact size, no post-scaling:
// the marks use feGaussianBlur filters and a mask, which only a browser engine
// renders faithfully (design review v3.2 §3).
//   node scripts/build-icons.mjs [--sizes 16,32,48,128] [--logo] [--sheet <png>]
// 16 px comes from icons/havre-mark-16.svg (the dedicated 16 px mark); the
// other sizes from icons/havre-mark.svg (the 128 mark). --logo also writes
// docs/assets/icon.png (the README logo) from the 128 mark at 256 px. --sheet
// writes a contact sheet of the rasters at 128/48/32/16 on Chrome's light and
// dark toolbars and on both canvases, plus the in-app BrandMark sizes (24 and
// 20 px) on both canvases, at device pixel ratio 2.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const ICONS = path.join(ROOT, "extension", "icons");
const argv = process.argv.slice(2);
const option = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const SIZES = option("sizes", "16,32,48,128").split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0);
const SOURCE = (size) => path.join(ICONS, size === 16 ? "havre-mark-16.svg" : "havre-mark.svg");
const LOGO = flag("logo") ? path.join(ROOT, "docs", "assets", "icon.png") : null;
const LOGO_SIZE = 256;
const SHEET = option("sheet", null) ? path.resolve(option("sheet", null)) : null;

function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  const found = [];
  const walk = (dir, depth) => {
    if (depth > 6) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, depth + 1);
      else if (full.endsWith("/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")) found.push(full);
    }
  };
  walk(cache, 0);
  found.push("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome");
  const usable = found.find((candidate) => { try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; } });
  if (!usable) throw new Error("Chrome for Testing was not found. Set CHROME_PATH.");
  return usable;
}

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map(); }
  open() {
    this.ws = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      this.ws.addEventListener("open", () => resolve(), { once: true });
      this.ws.addEventListener("error", () => reject(new Error("CDP socket error")), { once: true });
      this.ws.addEventListener("message", (event) => {
        const message = JSON.parse(String(event.data));
        if (!message.id) return;
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        clearTimeout(pending.timer);
        if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
        else pending.resolve(message.result || {});
      });
    });
  }
  send(method, params = {}, timeoutMs = 20_000) {
    const id = this.id++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`timeout ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
    });
  }
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const dataUrl = (mime, buffer) => `data:${mime};base64,${Buffer.from(buffer).toString("base64")}`;

// The sheet's contexts: Chrome's light and dark toolbars, and the two canvases
// (the --canvas tokens of Morning and Dusk).
const CONTEXTS = [
  { label: "Chrome light toolbar", bg: "#FFFFFF", fg: "#202124" },
  { label: "Chrome dark toolbar", bg: "#35363A", fg: "#E8EAED" },
  { label: "Morning canvas", bg: "#F4F0E9", fg: "#2B2E4A" },
  { label: "Dusk canvas", bg: "#1A1E3D", fg: "#EFE9E0" }
];

async function main() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fc-icons-"));
  const child = spawn(chromePath(), ["--headless=new", "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const wsUrl = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start\n${text}`)), 25_000);
    child.stderr.on("data", (chunk) => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const origin = `http://${new URL(wsUrl).host}`;
  const browser = new Cdp(wsUrl);
  await browser.open();
  // One page per capture: a data: document, an exact viewport, a transparent background.
  const capture = async (html, width, height, dpr = 1, transparent = true) => {
    const { targetId } = await browser.send("Target.createTarget", { url: "data:text/html;charset=utf-8," + encodeURIComponent(html), background: true });
    let target;
    for (let i = 0; i < 100 && !target; i += 1) {
      const list = await (await fetch(`${origin}/json/list`)).json();
      target = list.find((candidate) => candidate.id === targetId && candidate.type === "page");
      if (!target) await delay(100);
    }
    const page = new Cdp(target.webSocketDebuggerUrl);
    await page.open();
    await page.send("Page.enable");
    await page.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile: false });
    if (transparent) await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await delay(400);
    const shot = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width, height, scale: 1 }, captureBeyondViewport: false });
    await browser.send("Target.closeTarget", { targetId });
    return Buffer.from(shot.data, "base64");
  };
  const rasterise = async (svgFile, size) => {
    const svg = fs.readFileSync(svgFile, "utf8");
    const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="${dataUrl("image/svg+xml", svg)}" width="${size}" height="${size}">`;
    return capture(html, size, size, 1, true);
  };
  try {
    const rasters = new Map();
    for (const size of SIZES) {
      const png = await rasterise(SOURCE(size), size);
      const file = path.join(ICONS, `icon${size}.png`);
      fs.writeFileSync(file, png);
      rasters.set(size, png);
      console.log(`${path.relative(ROOT, file)} from ${path.basename(SOURCE(size))}`);
    }
    if (LOGO) {
      fs.mkdirSync(path.dirname(LOGO), { recursive: true });
      fs.writeFileSync(LOGO, await rasterise(SOURCE(128), LOGO_SIZE));
      console.log(`${path.relative(ROOT, LOGO)} from ${path.basename(SOURCE(128))} at ${LOGO_SIZE} px`);
    }
    if (SHEET) {
      // Every raster the sheet shows is read back from disk at its exact size.
      const icon = (size) => `<img src="${dataUrl("image/png", fs.readFileSync(path.join(ICONS, `icon${size}.png`)))}" width="${size}" height="${size}" alt="">`;
      const mark128 = dataUrl("image/svg+xml", fs.readFileSync(SOURCE(128), "utf8"));
      const mark16 = dataUrl("image/svg+xml", fs.readFileSync(SOURCE(16), "utf8"));
      const rows = CONTEXTS.map((context) => `
        <section style="background:${context.bg};color:${context.fg}">
          <h2>${context.label}</h2>
          <div class="sizes">${[128, 48, 32, 16].map((size) => `<figure>${icon(size)}<figcaption>${size}</figcaption></figure>`).join("")}</div>
        </section>`).join("");
      const brand = CONTEXTS.slice(2).map((context) => `
        <section style="background:${context.bg};color:${context.fg}">
          <h2>BrandMark on the ${context.label.toLowerCase()}</h2>
          <div class="sizes">
            <figure><img src="${mark128}" width="24" height="24" alt=""><figcaption>128 mark at 24</figcaption></figure>
            <figure><img src="${mark128}" width="20" height="20" alt=""><figcaption>128 mark at 20</figcaption></figure>
            <figure><img src="${mark16}" width="24" height="24" alt=""><figcaption>16 mark at 24</figcaption></figure>
            <figure><img src="${mark16}" width="20" height="20" alt=""><figcaption>16 mark at 20</figcaption></figure>
          </div>
        </section>`).join("");
      const html = `<!doctype html><meta charset="utf-8"><style>
        html,body{margin:0;background:#FAF7F2;font:13px/1.4 -apple-system,"Helvetica Neue",sans-serif}
        body{width:960px}
        section{padding:18px 28px 22px}
        h2{margin:0 0 12px;font-size:13px;font-weight:600;letter-spacing:.01em}
        .sizes{display:flex;align-items:flex-end;gap:40px}
        figure{margin:0;display:flex;flex-direction:column;align-items:center;gap:10px}
        figcaption{font-size:11px;opacity:.8}
        img{display:block}
      </style>${rows}${brand}`;
      const height = CONTEXTS.length * 230 + 2 * 120;
      fs.mkdirSync(path.dirname(SHEET), { recursive: true });
      fs.writeFileSync(SHEET, await capture(html, 960, height, 2, false));
      console.log(`${path.relative(ROOT, SHEET)} (contact sheet, device pixel ratio 2)`);
    }
  } finally {
    child.kill("SIGKILL");
    await new Promise((resolve) => { const timer = setTimeout(resolve, 3000); child.once("exit", () => { clearTimeout(timer); resolve(); }); });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await delay(300); }
    }
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
