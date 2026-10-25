#!/usr/bin/env node
// The design atlas: every audited screen in every theme and UI language, the
// capture from one audit run beside the capture from another (before / after),
// with the identity of each run stated once on the cover (design review v3
// §3.7, §5 step 4). The e2e visual matrix of the "after" build follows.
//
//   node scripts/design-atlas.mjs --before run --after v3-step4 [--out tools/live/out/design-atlas/v3-step4]
//        [--langs en,zh] [--surfaces settings,popup] [--no-e2e]
//        [--e2e-before <dir of DPR-1 matrix captures>] [--chunk 6] [--html-only] [--keep-chunks]
//
// Reads tools/live/out/design-audit/<label>/report.json and shots/ of both
// runs, writes atlas.html next to the images, then prints it to atlas.pdf with
// Chrome for Testing (the renderer the captures came from): a few pages at a
// time, since one document of three hundred full-resolution captures stalls
// the renderer, merged with qpdf (brew install qpdf). Chrome cannot start
// inside the Codex/Claude Bash sandbox; run it from a normal shell.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawn, spawnSync } from "node:child_process";
import { Cdp, discoverChrome, poll, targets } from "./lib/chrome-harness.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const option = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const BEFORE = option("before", "run");
const AFTER = option("after", null);
if (!AFTER) { console.error("--after <audit label> is required"); process.exit(2); }
const LANGS = option("langs", "en,zh").split(",").map((s) => s.trim()).filter(Boolean);
// --surfaces limits the atlas to those sections; --no-e2e leaves the e2e matrix out.
const SURFACES = option("surfaces", null) ? option("surfaces", null).split(",").map((s) => s.trim()).filter(Boolean) : null;
const WITH_E2E = !flag("no-e2e");
const OUT = path.resolve(option("out", path.join(ROOT, "tools", "live", "out", "design-atlas", AFTER)));
const AUDITS = path.join(ROOT, "tools", "live", "out", "design-audit");
const MATRIX = path.join(ROOT, "e2e", "artifacts", "phase-b-matrix");
const E2E_LATEST = path.join(ROOT, "e2e", "artifacts", "latest.json");
const E2E_BEFORE = option("e2e-before", null) ? path.resolve(option("e2e-before", null)) : null;
const CHUNK = Math.max(1, Number(option("chunk", 6)) || 6);

/** Width and height from a PNG's IHDR chunk. */
function pngSize(file) {
  const head = Buffer.alloc(24);
  const fd = fs.openSync(file, "r");
  try { fs.readSync(fd, head, 0, 24, 0); } finally { fs.closeSync(fd); }
  return { width: head.readUInt32BE(16), height: head.readUInt32BE(20) };
}

// Section and screen names, in the audit's order.
const SECTIONS = [
  { surface: "popup", en: "Popup", zh: "弹出窗口", screens: [["popup-media", "Media list", "媒体列表"], ["popup-results", "Detected media", "检测结果"], ["popup-jobs", "Downloads view", "下载任务"], ["popup-downloads-active", "Downloads in progress", "进行中的下载"], ["popup-link-dialog", "Download a link", "下载链接对话框"], ["popup-media-dialog", "Media download dialog", "媒体下载对话框"]] },
  { surface: "sidepanel", en: "Side panel", zh: "侧边栏", screens: [["sidepanel", "Media and downloads", "媒体与下载"], ["sidepanel-results", "Detected media", "检测结果"], ["sidepanel-active", "Downloads in progress", "进行中的下载"], ["sidepanel-link-dialog", "Download a link", "下载链接对话框"]] },
  { surface: "downloads", en: "Downloads page", zh: "下载记录页", screens: [["downloads-1280", "History · 1280", "历史记录 · 1280"], ["downloads-960", "History · 960", "历史记录 · 960"], ["downloads-empty-1280", "Empty state · 1280", "空状态 · 1280"], ["downloads-empty-960", "Empty state · 960", "空状态 · 960"], ["downloads-active-1280", "Downloads in progress · 1280", "进行中的下载 · 1280"], ["downloads-active-960", "Downloads in progress · 960", "进行中的下载 · 960"]] },
  { surface: "settings", en: "Settings", zh: "设置页", screens: [["settings-1280", "First screen · 1280", "首屏 · 1280"], ["settings-960", "First screen · 960", "首屏 · 960"], ["settings-full-1280", "Whole page · 1280", "完整页面 · 1280"], ["settings-active-1280", "Engine connected, whole page · 1280", "引擎已连接，完整页面 · 1280"]] },
  { surface: "preview", en: "Component preview", zh: "组件预览", screens: [["preview", "Type and brand", "字体与品牌"], ["preview-text", "Text", "文字"], ["preview-controls", "Controls", "控件"], ["preview-rows", "Rows", "行"], ["preview-feedback", "Feedback", "反馈"], ["preview-overlays", "Overlays", "浮层"], ["preview-overlays-item", "Overlays · item dialog", "浮层 · 单项"]] }
];
const E2E_STATES = [
  ["options-light-980x900", "Settings · Morning · 980 × 900", "设置页 · 清晨 · 980 × 900"], ["options-dark-980x900", "Settings · Dusk · 980 × 900", "设置页 · 黄昏 · 980 × 900"],
  ["options-narrow-390x844", "Settings · narrow · 390 × 844", "设置页 · 窄屏 · 390 × 844"], ["options-autosaved", "Settings · autosaved", "设置页 · 自动保存提示"],
  ["options-validation", "Settings · validation error", "设置页 · 校验错误"], ["options-private-network-confirm", "Settings · home-network confirm", "设置页 · 家庭网络确认框"],
  ["options-engine-api-unavailable", "Settings · engine finishing setup", "设置页 · 引擎正在完成设置"], ["options-native-host-missing", "Settings · engine not installed", "设置页 · 引擎未安装"],
  ["options-native-host-ready", "Settings · engine ready", "设置页 · 引擎就绪"], ["reduced-motion", "Settings · reduced motion", "设置页 · 减少动态效果"],
  ["popup-372x600", "Popup · 372 × 600", "弹出窗口 · 372 × 600"], ["popup-manifest-loading", "Popup · reading the manifest", "弹出窗口 · 正在读取清单"],
  ["download-dialog", "Popup · download dialog", "弹出窗口 · 下载对话框"], ["sidepanel-420x820", "Side panel · 420 × 820", "侧边栏 · 420 × 820"], ["sidepanel-download-dialog", "Side panel · download dialog", "侧边栏 · 下载对话框"]
];
const THEME = { morning: ["Morning", "清晨"], dusk: ["Dusk", "黄昏"] };
const LANG = { en: ["English", "英文"], zh: ["Chinese", "中文"] };

function loadRun(label) {
  const dir = path.join(AUDITS, label);
  const file = path.join(dir, "report.json");
  if (!fs.existsSync(file)) throw new Error(`no audit run "${label}" (${path.relative(ROOT, file)})`);
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  const screens = new Map();
  for (const s of report.screens) screens.set(`${s.id}-${s.theme}-${s.lang}`, { ...s, file: path.join(dir, s.screenshot) });
  return { label, dir, report, screens };
}

const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));
const rel = (file) => path.relative(OUT, file).split(path.sep).join("/");
const identity = (run) => `${run.report.startedAt.slice(0, 16).replace("T", " ")} UTC · commit ${run.report.commit} · extension ${run.report.extensionDir || "extension"}${run.report.pondSeed ? ` · pond seed 0x${(run.report.pondSeed >>> 0).toString(16).toUpperCase()}` : ""}${run.report.note ? ` · ${run.report.note}` : ""}`;
const line = (en, zh) => `<p class="en">${en}</p><p class="zh">${zh}</p>`;

// Layout per pair: narrow surfaces side by side; wide short screens stacked;
// tall full pages side by side, scaled to the page height.
function layoutFor(width, height) {
  if (width <= 600) return "side";
  if (height <= 1000) return "stack";
  return "tall";
}

function checksSummary(screen) {
  if (!screen?.checks) return "";
  const failing = Object.entries(screen.checks).filter(([, c]) => !c.pass).map(([k, c]) => `${k} ${c.value}`);
  const pond = screen.pond?.metrics ? ` · pond ${screen.pond.metrics.coverage}% · p95 ${screen.pond.metrics.p95DeltaL}${screen.pond.judged ? "" : " (reported)"}` : "";
  return `${failing.length ? `fails ${failing.join(", ")}` : "every budget met"}${pond}`;
}

function figure(run, key, label) {
  const screen = run.screens.get(key);
  if (!screen || !fs.existsSync(screen.file)) return `<figure class="missing"><figcaption>${esc(label)}</figcaption><div class="none">${line("No capture in this run.", "本次运行没有这张截图。")}</div></figure>`;
  return `<figure><figcaption><b>${esc(label)}</b> · ${esc(run.label)} · ${screen.width} × ${screen.height} · ${esc(checksSummary(screen))}</figcaption><img src="${esc(rel(screen.file))}" alt="${esc(key)} ${esc(label)}"></figure>`;
}

function build(before, after) {
  const pages = [];
  const date = after.report.startedAt.slice(0, 10);
  const judged = after.report.screens.filter((s) => s.pond?.judged);
  const pondOk = judged.filter((s) => s.pond.verdict?.pass).length;
  const headerScreens = after.report.screens.filter((s) => s.checks?.header);
  const headerOk = headerScreens.filter((s) => s.checks.header.pass).length;
  const allOk = after.report.screens.filter((s) => Object.values(s.checks || {}).every((c) => c.pass)).length;
  let e2e = null;
  try { e2e = JSON.parse(fs.readFileSync(E2E_LATEST, "utf8")); } catch { e2e = null; }
  pages.push(`<section class="cover">
    <h1>FluxCatch design atlas <span class="zh">FluxCatch 设计图集</span></h1>
    ${line(`Every audited screen, Morning and Dusk, English and Chinese: the capture before the v3 work beside the capture after it. ${date}.`, `每一屏审计过的界面，清晨与黄昏、英文与中文：v3 改动前的截图与改动后的截图并排。${date}。`)}
    <dl>
      <dt>${line("Before", "改动前")}</dt><dd>${esc(identity(before))}</dd>
      <dt>${line("After", "改动后")}</dt><dd>${esc(identity(after))}</dd>
      <dt>${line("Captures", "截图")}</dt><dd>${line(`Design audit (scripts/design-audit.mjs), Chrome for Testing headless, device pixel ratio 2, the pond layer settled before each shot. ${after.report.screens.length} screens per run.`, `设计审计（scripts/design-audit.mjs），Chrome for Testing 无头模式，设备像素比 2，每张截图前等池塘图层画完。每次运行 ${after.report.screens.length} 屏。`)}</dd>
      <dt>${line("After, the audit", "改动后的审计")}</dt><dd>${line(`${allOk} of ${after.report.screens.length} screens meet every budget; pond acceptance (v3 §3.1) ${pondOk} of ${judged.length} judged screens; header at scroll 0 (v3 §3.6) ${headerOk} of ${headerScreens.length} screens.`, `${after.report.screens.length} 屏中 ${allOk} 屏满足全部预算；池塘验收（v3 第 3.1 节）${judged.length} 个判定屏中 ${pondOk} 个通过；滚动位置 0 的页眉（v3 第 3.6 节）${headerScreens.length} 屏中 ${headerOk} 屏通过。`)}</dd>
      ${e2e ? `<dt>${line("e2e matrix", "e2e 矩阵")}</dt><dd>${line(`${e2e.startedAt?.slice(0, 16).replace("T", " ")} UTC · commit ${e2e.extension?.buildIdentity?.commit || "?"} · extension ${e2e.extension?.extensionDir || "?"} · device pixel ratio 2.`, `${e2e.startedAt?.slice(0, 16).replace("T", " ")} UTC · commit ${e2e.extension?.buildIdentity?.commit || "?"} · extension ${e2e.extension?.extensionDir || "?"} · 设备像素比 2。`)}</dd>` : ""}
    </dl>
    ${line("Captions name the run, the viewport, and the audit's verdict for that capture; the pond numbers are chroma coverage and p95 |ΔL| in the measured region (v3 §3.1).", "每张图的说明写明运行标签、视口和审计对这张截图的判定；池塘两个数字是度量区域里的色度覆盖率和 p95 |ΔL|（v3 第 3.1 节）。")}
  </section>`);
  for (const section of SECTIONS) {
    if (SURFACES && !SURFACES.includes(section.surface)) continue;
    const ids = section.screens.filter(([id]) => after.report.screens.some((s) => s.id === id));
    if (!ids.length) continue;
    pages.push(`<section class="divider"><h2>${esc(section.en)} <span class="zh">${esc(section.zh)}</span></h2><ol>${ids.map(([, en, zh]) => `<li>${esc(en)} <span class="zh">${esc(zh)}</span></li>`).join("")}</ol></section>`);
    for (const [id, en, zh] of ids) {
      for (const theme of ["morning", "dusk"]) {
        for (const lang of LANGS) {
          const key = `${id}-${theme}-${lang}`;
          const sample = after.screens.get(key) || before.screens.get(key);
          if (!sample) continue;
          const layout = layoutFor(sample.width, sample.height);
          const title = `${esc(section.en)} · ${esc(en)} · ${THEME[theme][0]} · ${LANG[lang][0]} <span class="zh">${esc(section.zh)} · ${esc(zh)} · ${THEME[theme][1]} · ${LANG[lang][1]}</span>`;
          const pair = [figure(before, key, "Before · 改动前"), figure(after, key, "After · 改动后")];
          pages.push(`<section class="pair ${layout}"><h3>${title}</h3><div class="two">${pair.join("")}</div></section>`);
        }
      }
    }
  }
  const states = WITH_E2E ? E2E_STATES.filter(([name]) => fs.existsSync(path.join(MATRIX, `${name}.png`))) : [];
  if (states.length) {
    const beforeNote = E2E_BEFORE
      ? line("The states the e2e suite captures. Before: the matrix of 2026-10-23 at device pixel ratio 1, recovered from that day's atlas. After: the matrix of this build at device pixel ratio 2.", "e2e 套件截下的状态。改动前：2026-10-23 的矩阵，设备像素比 1，从当天的图集里恢复。改动后：本构建的矩阵，设备像素比 2。")
      : line("The states the e2e suite captures from the same build (after only: the earlier matrix was captured at device pixel ratio 1 and not kept).", "e2e 套件从同一构建截下的状态（只有改动后：早先的矩阵以设备像素比 1 截取，未保留）。");
    pages.push(`<section class="divider"><h2>e2e visual matrix <span class="zh">e2e 视觉矩阵</span></h2>${beforeNote}</section>`);
    for (const [name, en, zh] of states) {
      const afterFile = path.join(MATRIX, `${name}.png`);
      const beforeFile = E2E_BEFORE ? path.join(E2E_BEFORE, `${name}.png`) : null;
      const after = `<figure><figcaption><b>After · 改动后</b> · e2e · device pixel ratio 2 · ${esc(name)}.png</figcaption><img src="${esc(rel(afterFile))}" alt="${esc(name)}"></figure>`;
      const title = `${esc(en)} <span class="zh">${esc(zh)}</span>`;
      if (beforeFile && fs.existsSync(beforeFile)) {
        const size = pngSize(afterFile);
        const layout = layoutFor(size.width / 2, size.height / 2);
        const before = `<figure><figcaption><b>Before · 改动前</b> · e2e · device pixel ratio 1 · ${esc(name)}.png</figcaption><img src="${esc(rel(beforeFile))}" alt="${esc(name)} before"></figure>`;
        pages.push(`<section class="pair ${layout}"><h3>${title}</h3><div class="two">${before}${after}</div></section>`);
      } else {
        pages.push(`<section class="pair single"><h3>${title}</h3>${after}</section>`);
      }
    }
  }
  const css = `
    @page { size: 1536px 2100px; margin: 0; }
    :root { color-scheme: light; }
    html, body { margin: 0; background: #F4F0E9; color: #1C1C1E; font: 15px/1.45 "Instrument Sans", -apple-system, "PingFang SC", "Hiragino Sans GB", sans-serif; }
    section { box-sizing: border-box; width: 1536px; height: 2100px; overflow: hidden; padding: 56px 64px 72px; break-after: page; page-break-after: always; position: relative; }
    .zh { color: #5B5B60; font-weight: 400; }
    h1, h2, h3 { margin: 0 0 12px; font-weight: 600; letter-spacing: -0.01em; }
    h1 { font-size: 44px; line-height: 1.15; } h1 .zh { display: block; font-size: 30px; margin-top: 8px; }
    h2 { font-size: 36px; } h2 .zh { display: block; font-size: 26px; margin-top: 6px; }
    h3 { font-size: 22px; line-height: 1.3; padding-bottom: 14px; border-bottom: 1px solid #CDCCC8; margin-bottom: 20px; } h3 .zh { display: block; font-size: 17px; margin-top: 4px; }
    p { margin: 0 0 4px; } p.zh { margin-bottom: 14px; }
    .cover dl { margin: 28px 0; display: grid; grid-template-columns: 200px 1fr; gap: 10px 24px; } .cover dt p { margin: 0; } .cover dt { font-weight: 600; } .cover dd { margin: 0; }
    .divider ol { font-size: 20px; line-height: 1.7; columns: 2; }
    figure { margin: 0; } figcaption { font-size: 14px; color: #5B5B60; margin: 0 0 8px; } figcaption b { color: #1C1C1E; }
    img { display: block; box-shadow: 0 0 0 1px #CDCCC8; }
    .two { display: grid; gap: 28px; }
    .side .two { grid-template-columns: 1fr 1fr; } .side img { width: 100%; max-height: 1700px; object-fit: contain; object-position: top left; }
    .stack .two { grid-template-columns: 1fr; } .stack img { width: 100%; max-height: 850px; object-fit: contain; object-position: top left; }
    .tall .two { grid-template-columns: 1fr 1fr; } .tall img { width: 100%; max-height: 1760px; object-fit: contain; object-position: top left; }
    .single img { width: 100%; max-height: 1760px; object-fit: contain; object-position: top left; }
    .missing .none { border: 1px dashed #CDCCC8; padding: 24px; color: #5B5B60; }
    .folio { position: absolute; left: 64px; right: 64px; bottom: 28px; font-size: 13px; color: #5B5B60; display: flex; justify-content: space-between; }
  `;
  const numbered = pages.map((page, index) => page.replace(/<\/section>$/, `<div class="folio"><span>FluxCatch design atlas · ${esc(date)} · before ${esc(before.label)} / after ${esc(after.label)}</span><span>${index + 1}</span></div></section>`));
  return { css, pages: numbered, title: `FluxCatch design atlas ${esc(date)}` };
}

const document = ({ css, title }, pages) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>${css}</style></head><body>${pages.join("\n")}</body></html>`;

async function printPdfs(jobs) {
  const chrome = discoverChrome();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "fc-atlas-"));
  const child = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", "--remote-allow-origins=*", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--disable-background-networking", "--use-mock-keychain", "--password-store=basic", "--allow-file-access-from-files", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
  const ws = await new Promise((resolve, reject) => {
    let text = "";
    const timer = setTimeout(() => reject(new Error(`Chrome did not start\n${text}`)), 25_000);
    child.stderr.on("data", (chunk) => { text += chunk; const match = text.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
  });
  const http = `http://${new URL(ws).host}`;
  const browser = await Cdp.connect(ws);
  try {
    for (const { htmlFile, pdfFile } of jobs) {
      const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", background: true });
      const target = await poll(async () => (await targets(http)).find((t) => t.id === targetId && t.type === "page"), 25_000, "atlas page");
      const page = await Cdp.connect(target.webSocketDebuggerUrl);
      await page.send("Page.enable");
      await page.send("Runtime.enable");
      const loaded = new Promise((resolve) => page.on("Page.loadEventFired", resolve));
      await page.send("Page.navigate", { url: `file://${htmlFile}` });
      await Promise.race([loaded, new Promise((resolve) => setTimeout(resolve, 60_000))]);
      await page.send("Runtime.evaluate", { expression: "Promise.all([...document.images].map((img) => img.complete ? true : new Promise((resolve) => { img.addEventListener('load', resolve, { once: true }); img.addEventListener('error', resolve, { once: true }); }))).then(() => document.images.length)", awaitPromise: true, returnByValue: true }, 120_000);
      const result = await page.send("Page.printToPDF", { preferCSSPageSize: true, printBackground: true, displayHeaderFooter: false, transferMode: "ReturnAsStream" }, 300_000);
      const pieces = [];
      for (;;) {
        const piece = await page.send("IO.read", { handle: result.stream, size: 4 * 1024 * 1024 }, 120_000);
        pieces.push(Buffer.from(piece.data, piece.base64Encoded ? "base64" : "utf8"));
        if (piece.eof) break;
      }
      await page.send("IO.close", { handle: result.stream }).catch(() => {});
      fs.writeFileSync(pdfFile, Buffer.concat(pieces));
      page.close();
      await browser.send("Target.closeTarget", { targetId }).catch(() => {});
      process.stdout.write(`${path.basename(pdfFile)} `);
    }
    process.stdout.write("\n");
  } finally {
    browser.close();
    child.kill("SIGKILL");
    // Chrome may still be writing its profile as it dies; wait for it, then remove the profile with retries.
    await new Promise((resolve) => { const timer = setTimeout(resolve, 5000); child.once("exit", () => { clearTimeout(timer); resolve(); }); });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { fs.rmSync(profile, { recursive: true, force: true }); break; } catch { await new Promise((resolve) => setTimeout(resolve, 500)); }
    }
  }
}

function mergePdfs(parts, pdfFile) {
  const result = spawnSync("qpdf", ["--empty", "--pages", ...parts, "--", pdfFile], { stdio: ["ignore", "pipe", "pipe"] });
  if (result.error) throw new Error(`qpdf is needed to merge the pages (brew install qpdf); the chunk PDFs are in ${path.dirname(parts[0])}`);
  if (result.status !== 0) throw new Error(`qpdf failed: ${result.stderr}`);
}

async function main() {
  const before = loadRun(BEFORE);
  const after = loadRun(AFTER);
  fs.mkdirSync(OUT, { recursive: true });
  const atlas = build(before, after);
  const htmlFile = path.join(OUT, "atlas.html");
  fs.writeFileSync(htmlFile, document(atlas, atlas.pages));
  const pairs = atlas.pages.filter((page) => page.startsWith('<section class="pair')).length;
  console.log(`${path.relative(ROOT, htmlFile)}: ${atlas.pages.length} pages, ${pairs} with captures (before ${before.label}: ${before.report.commit}; after ${after.label}: ${after.report.commit})`);
  if (flag("html-only")) return;
  const chunkDir = path.join(OUT, "chunks");
  fs.rmSync(chunkDir, { recursive: true, force: true });
  fs.mkdirSync(chunkDir, { recursive: true });
  const jobs = [];
  for (let start = 0; start < atlas.pages.length; start += CHUNK) {
    const name = String(jobs.length + 1).padStart(3, "0");
    const chunkHtml = path.join(chunkDir, `${name}.html`);
    // Chunk files sit one level down: point their image paths back up.
    fs.writeFileSync(chunkHtml, document(atlas, atlas.pages.slice(start, start + CHUNK)).replace(/src="(?!\/|[a-z]+:)/g, 'src="../'));
    jobs.push({ htmlFile: chunkHtml, pdfFile: path.join(chunkDir, `${name}.pdf`) });
  }
  await printPdfs(jobs);
  const pdfFile = path.join(OUT, "atlas.pdf");
  mergePdfs(jobs.map((job) => job.pdfFile), pdfFile);
  if (!flag("keep-chunks")) fs.rmSync(chunkDir, { recursive: true, force: true });
  console.log(`${path.relative(ROOT, pdfFile)}: ${atlas.pages.length} pages, ${(fs.statSync(pdfFile).size / 1e6).toFixed(1)} MB`);
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
