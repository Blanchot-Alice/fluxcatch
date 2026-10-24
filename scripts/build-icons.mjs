#!/usr/bin/env node
// Rasterise the extension icons from their SVG sources with Chrome for Testing
// (the same renderer the extension runs in), transparent outside the disc.
//   node scripts/build-icons.mjs [--sizes 16,32,48,128]
// 16 px comes from icons/fluxcatch-mark-16.svg (the pad and the blossom only,
// design review v3 §3.10); the other sizes from icons/fluxcatch-mark.svg.
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
const sizesArg = argv.indexOf("--sizes") >= 0 ? argv[argv.indexOf("--sizes") + 1] : "16,32,48,128";
const SIZES = sizesArg.split(",").map((n) => Number(n.trim())).filter((n) => Number.isInteger(n) && n > 0);
const SOURCE = (size) => path.join(ICONS, size === 16 ? "fluxcatch-mark-16.svg" : "fluxcatch-mark.svg");

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
  try {
    for (const size of SIZES) {
      const svg = fs.readFileSync(SOURCE(size), "utf8");
      const html = `<!doctype html><meta charset="utf-8"><style>html,body{margin:0;background:transparent}img{display:block;width:${size}px;height:${size}px}</style><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}" width="${size}" height="${size}">`;
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
      await page.send("Emulation.setDeviceMetricsOverride", { width: size, height: size, deviceScaleFactor: 1, mobile: false });
      await page.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
      await delay(300);
      const shot = await page.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: size, height: size, scale: 1 }, captureBeyondViewport: false });
      const file = path.join(ICONS, `icon${size}.png`);
      fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
      console.log(`${path.relative(ROOT, file)} from ${path.basename(SOURCE(size))}`);
      await browser.send("Target.closeTarget", { targetId });
    }
  } finally {
    child.kill("SIGKILL");
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error); process.exit(1); });
