#!/usr/bin/env node
// FluxCatch design audit (design review §10.2). Loads the unpacked extension in
// Chrome for Testing, opens every surface in Morning and Dusk, in English and
// Chinese, at the §0 viewports and device-pixel-ratio 2, and measures:
//   a  distinct text styles      ≤ 6 per screen, ≤ 8 app-wide
//   b  distinct left text edges  ≤ 3 per screen
//   c  container nesting         0
//   d  text contrast             ≥ 4.5:1 (≥ 3:1 at ≥ 24 px or ≥ 18.66 px bold)
//   e  clipped / covered         0
//   f  locale leaks              0
//   g  1px borders and rules     0 (hr.section-rule between Settings sections exempt, v3.1 §3.2)
//   h  colour literals outside the token files   0 (static scan)
// plus: Display face used at most twice per screen outside the BrandMark,
// filenames keep their extension when truncated, the pond layer meets v3 §3.1
// (in the margins of full pages chroma coverage 3% to 12% and p95 |ΔL| ≤ 0.03
// Morning / 0.05 Dusk, measured in OKLCH against the capture without the
// layer; no pond pixel under any text run), and the header is the canvas at
// scroll position 0 (v3 §3.6). Text contrast (d) is measured against the
// composited background: the pond's own pixels over the canvas.
//
// The pond is seeded per install; the audit pins the seed (--pond-seed, default
// the module's built-in 0x5EED1E5) so runs compare, and reports a sweep over
// other seeds on the Downloads page for the spread.
//
//   node scripts/design-audit.mjs [--label v1-baseline] [--surfaces downloads,popup]
//        [--themes morning,dusk] [--langs en,zh] [--screens downloads-1280]
//        [--publish docs/design-audit] [--no-focus] [--pond-seed 0x5EED1E5]
//   node scripts/design-audit.mjs --rejudge v3-step4 [--publish docs/design-audit]
//        recomputes the verdicts of an earlier run's report.json with the current
//        acceptance (no Chrome; captures and measurements stay as they were).
//
// Needs Node 22+ and a Playwright Chrome for Testing (or CHROME_PATH). Chrome
// cannot start inside the Codex/Claude Bash sandbox; run it from a normal shell.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { buildIdentity, extensionDir } from "./lib/build-identity.mjs";
import { decodePng, evaluate, keepDisplayAwake, openPage, poll, session } from "./lib/chrome-harness.mjs";
import { pageAudit } from "./lib/page-audit.mjs";
import { JUDGED_MARGIN_MIN, POND_BAND, headerStrip, parseRgb, pondMetrics, pondVerdict } from "./lib/pond-metrics.mjs";
import { extensionIdFromKey, prepareActiveExtension, registerFakeHost, startFixtureDownloads, writeFakeHostLauncher } from "./lib/active-profile.mjs";
import { MEDIA_FIXTURE_HOST, startMediaFixture } from "./lib/media-fixture.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = extensionDir(ROOT);
const argv = process.argv.slice(2);
const option = (name, fallback) => { const index = argv.indexOf(`--${name}`); return index >= 0 ? argv[index + 1] : fallback; };
const flag = (name) => argv.includes(`--${name}`);
const LABEL = option("label", "run");
const OUT = path.resolve(option("out", path.join(ROOT, "tools", "live", "out", "design-audit", LABEL)));
const PUBLISH = option("publish", null);
const REJUDGE = option("rejudge", null);
const listOption = (name, fallback) => (option(name, null) || fallback).split(",").map((s) => s.trim()).filter(Boolean);
const SURFACES = listOption("surfaces", "popup,sidepanel,downloads,settings,preview");
const THEMES = listOption("themes", "morning,dusk");
const LANGS = listOption("langs", "en,zh");
const SCREEN_FILTER = option("screens", null)?.split(",") || null;
// The per-install pond seed the audit stores before each run (v3 §3.1): the
// module's own fallback seed unless --pond-seed says otherwise.
export const DEFAULT_POND_SEED = 0x5EED1E5;
const POND_SEED = Number(option("pond-seed", DEFAULT_POND_SEED)) >>> 0 || DEFAULT_POND_SEED;
// Seeds for the spread on the Downloads page: the pinned seed, the reference
// script's seed, the five from the step-1 sweep, then nine more.
export const SWEEP_SEEDS = Object.freeze([0x5EED1E5, 0xF1C4C7, 0xB, 0x16, 0x21, 0x2C, 0x1, 0x2, 0x3, 0x7, 0x1234567, 0xABCDEF, 0xC0FFEE, 0xBADC0DE, 0xFACADE, 0x9E3779B9]);
const SWEEP_SCREEN = "downloads-1280";

export const BUDGETS = Object.freeze({
  stylesPerScreen: 6,
  stylesAppWide: 8,
  displayPerScreen: 2,
  edges: 3,
  nesting: 0,
  contrast: 0,
  clipping: 0,
  locale: 0,
  rules: 0,
  literals: 0,
  filenames: 0
});

const SCREENS = [
  // The plain popup and side panel screens look at a page with no media (BLANK_FIXTURE_PATH).
  { id: "popup-media", surface: "popup", page: "popup/popup.html", width: 372, height: 600, fixture: true, targetFixture: "blank" },
  { id: "popup-jobs", surface: "popup", page: "popup/popup.html", width: 372, height: 600, fixture: true, targetFixture: "blank", prepare: "(document.querySelector('[data-view=\"downloads\"]') || document.querySelector('#jobsTab'))?.click()" },
  { id: "popup-link-dialog", surface: "popup", page: "popup/popup.html", width: 372, height: 600, fixture: true, targetFixture: "blank", prepare: "document.querySelector('#urlButton')?.click(); const i = document.querySelector('dialog[open] input[type=url]'); if (i) { i.value = 'https://example.com/clip.mp4'; i.dispatchEvent(new Event('input', { bubbles: true })); }" },
  { id: "sidepanel", surface: "sidepanel", page: "sidepanel/sidepanel.html", width: 420, height: 900, fixture: true, targetFixture: "blank" },
  // Populated states: a local media page (scripts/lib/media-fixture.mjs) is open
  // in another tab, and the page under audit treats that tab as the active one.
  // "View" hooks: v2 marks the popup's view switch with data-view; v1 used #jobsTab.
  { id: "popup-results", surface: "popup", page: "popup/popup.html", width: 372, height: 600, fixture: true, targetFixture: true, settleMs: 2500 },
  { id: "popup-media-dialog", surface: "popup", page: "popup/popup.html", width: 372, height: 600, fixture: true, targetFixture: true, settleMs: 2500, prepareWaitMs: 2500, prepare: "document.querySelector('[data-media-action=\"download\"]')?.click()" },
  { id: "sidepanel-link-dialog", surface: "sidepanel", page: "sidepanel/sidepanel.html", width: 420, height: 900, fixture: true, targetFixture: "blank", prepare: "document.querySelector('#urlButton')?.click(); const i = document.querySelector('dialog[open] input[type=url]'); if (i) { i.value = 'https://example.com/clip.mp4'; i.dispatchEvent(new Event('input', { bubbles: true })); }" },
  { id: "sidepanel-results", surface: "sidepanel", page: "sidepanel/sidepanel.html", width: 420, height: 900, fixture: true, targetFixture: true, settleMs: 2500 },
  { id: "popup-downloads-active", surface: "popup", page: "popup/popup.html", width: 372, height: 600, profile: "active", fixture: true, targetFixture: true, settleMs: 3000, prepare: "(document.querySelector('[data-view=\"downloads\"]') || document.querySelector('#jobsTab'))?.click()" },
  { id: "sidepanel-active", surface: "sidepanel", page: "sidepanel/sidepanel.html", width: 420, height: 900, profile: "active", fixture: true, targetFixture: true, settleMs: 3000 },
  { id: "downloads-1280", surface: "downloads", page: "downloads/downloads.html", width: 1280, height: 900 },
  { id: "downloads-960", surface: "downloads", page: "downloads/downloads.html", width: 960, height: 900 },
  { id: "downloads-empty-1280", surface: "downloads", page: "downloads/downloads.html", width: 1280, height: 900, profile: "empty" },
  { id: "downloads-empty-960", surface: "downloads", page: "downloads/downloads.html", width: 960, height: 900, profile: "empty" },
  // Live downloads through a stand-in engine (scripts/lib/fake-native-host.mjs).
  { id: "downloads-active-1280", surface: "downloads", page: "downloads/downloads.html", width: 1280, height: 900, profile: "active", settleMs: 6000, prepare: "document.querySelector('.focus-details')?.setAttribute('open', '')" },
  { id: "downloads-active-960", surface: "downloads", page: "downloads/downloads.html", width: 960, height: 900, profile: "active", settleMs: 6000 },
  { id: "settings-1280", surface: "settings", page: "options/options.html", width: 1280, height: 900 },
  { id: "settings-960", surface: "settings", page: "options/options.html", width: 960, height: 900 },
  // The whole page, with the engine not set up and with it connected.
  { id: "settings-full-1280", surface: "settings", page: "options/options.html", width: 1280, height: 900, fullPage: true },
  { id: "settings-active-1280", surface: "settings", page: "options/options.html", width: 1280, height: 900, profile: "active", fullPage: true },
  { id: "preview", surface: "preview", page: "preview/preview.html?demo=static", width: 1440, height: 900, fullPage: true },
  // v2 splits the gallery into views, each within the budgets on its own ("preview" opens the type view).
  { id: "preview-text", surface: "preview", page: "preview/preview.html?demo=static&view=text", width: 1440, height: 900, fullPage: true },
  { id: "preview-controls", surface: "preview", page: "preview/preview.html?demo=static&view=controls", width: 1440, height: 900, fullPage: true },
  { id: "preview-rows", surface: "preview", page: "preview/preview.html?demo=static&view=rows", width: 1440, height: 900, fullPage: true },
  { id: "preview-feedback", surface: "preview", page: "preview/preview.html?demo=static&view=feedback", width: 1440, height: 900, fullPage: true },
  { id: "preview-overlays", surface: "preview", page: "preview/preview.html?demo=static&view=overlays", width: 1440, height: 900, fullPage: true },
  { id: "preview-overlays-item", surface: "preview", page: "preview/preview.html?demo=static&view=overlays&dialog=item", width: 1440, height: 900, fullPage: true }
];

// Same records as tools/live/shots.mjs, so screens match the review set:
// two completed, one long completed, one failed with a raw engine message, one cancelled.
export function historyFixture(now = Date.now()) {
  const record = (id, status, filename, size, media, sourceUrl, sourceTitle, daysAgo, message) => {
    const endedAt = now - daysAgo * 86_400_000 - 3_600_000;
    return {
      jobId: `audit:${id}`, status, method: "native",
      kind: filename.endsWith(".m3u8") ? "hls" : filename.endsWith(".m4a") ? "audio" : "video",
      filename, size, bytes: size, total: size, media, sourceUrl, sourceTitle, pageTitle: sourceTitle,
      createdAt: endedAt - 120_000, startedAt: endedAt - 118_000, finishedAt: endedAt,
      sourceHost: new URL(sourceUrl).hostname, elapsedMs: 118_000,
      path: status === "completed" ? `/Users/you/Downloads/FluxCatch/${filename}` : null,
      message: message || null, error: status === "failed" ? message : null, retryable: status !== "completed"
    };
  };
  return [
    record("h1", "completed", "Interstellar Trailer 4K.mp4", 2.35e9, { duration: 148, width: 3840, height: 2160, container: "mp4", videoCodec: "hevc", audioCodec: "aac" }, "https://www.youtube.com/watch?v=zSWdZVtXT7E", "YouTube", 0),
    record("h2", "completed", "Keynote Highlights.m4a", 48_300_000, { duration: 1860, container: "m4a", audioCodec: "aac" }, "https://developer.apple.com/videos/play/wwdc2025/101/", "Apple Developer", 1),
    record("h3", "completed", "Lecture 12 · Pharmacokinetics.mp4", 812_000_000, { duration: 3480, width: 1920, height: 1080, container: "mp4", videoCodec: "h264", audioCodec: "aac" }, "https://www.ucl.ac.uk/", "UCL Lecturecast", 1),
    // A real engine failure chain (host.py wraps HTTP errors per segment; the worker redacts the URL).
    record("h4", "failed", "Live Session.m3u8", 0, null, "https://example.tv/live/42", "example.tv", 2, "HLS media segment 11 failed: HTTP 403 for https://example.tv/…"),
    record("h5", "cancelled", "Behind the Scenes.webm", 0, null, "https://vimeo.com/1234567", "Vimeo", 9)
  ];
}

// Two live downloads: a plain file (a row) and, started last so it leads, a
// stream reporting parts (the focus panel). The engine holds them mid-way.
const ACTIVE_SCENARIO = {
  rampMs: 6000,
  holdIntervalMs: 1000,
  jobs: [
    { total: 1_200_000_000, hold: 0.31, segments: 0 },
    { total: 0, hold: 0.62, segments: 120 }
  ]
};
const ACTIVE_ITEMS = [
  { url: "https://example.com/media/keynote-2026.mp4", filename: "Keynote 2026.mp4" },
  { url: "https://example.com/talks/lecture-12.mp4", filename: "Lecture 12 · Pharmacokinetics.mp4" }
];

const PAGE_CONFIG = {
  displayFamily: "Fraunces",
  brandSelector: "[data-brandmark]",
  rowMax: 160,
  controlRootSelector: ".field, button, a, input, select, textarea, summary, label, [role=button], [role=tab], [role=tablist], [role=switch], [role=menuitem], [role=option], [role=radiogroup], [role=checkbox], [role=link], [role=combobox], [role=searchbox], .segmented",
  // A .field is the visible box of one input (fill, focus ring): part of the control.
  controlSelector: ".field, button, input, select, textarea, summary, a[href], label.opt-check, [role=button], [role=tab], [role=tablist], [role=switch], [role=menuitem], [role=slider], [role=checkbox], [role=radio], [role=option], [role=progressbar], progress, meter, .segmented, .switch",
  indicatorSelector: "[role=progressbar], progress, meter, .progress, .switch, .spinner, .status-dot, .dot, .unsaved-dot, .fc-segments, [data-indicator]",
  exemptContainerSelector: "[data-pond], img, svg, video, canvas, picture, iframe, dialog > form, [role=progressbar], progress, meter, .progress, .switch, .spinner, .status-dot, .dot, .unsaved-dot, .fc-segments, [data-indicator], .radar, .radar *",
  dialogActionSelector: ".dialog-actions button, [data-dialog-actions] button, button[type=submit]",
  // User content only: filenames, page titles and URLs, source links, paths and build ids.
  // Never whole lines that also carry UI copy (relative times live next to source links).
  // v2 marks user content with data-user-content (filenames, hosts, paths, build ids).
  userContentSelector: "[data-user-content], [translate=no]",
  filenameSelector: "[data-filename], .job-title, .media-title",
  latinAllowlist: [
    "FluxCatch", "Finder", "Chrome", "Mac", "macOS", "Windows", "Linux", "MP4", "MKV", "WebM", "MP3", "M4A", "AAC", "FLAC", "WAV", "OGG", "Opus",
    "HLS", "DASH", "MPD", "MOV", "TS", "HTTP", "KB", "MB", "GB", "TB", "Instagram", "YouTube", "Bilibili", "Vimeo", "Twitter", "X", "yt-dlp"
  ]
};

// ---------- h: colour literals outside the token files ----------
// tokens.js mirrors three Morning tokens for the toolbar badge (the worker cannot read CSS); a test keeps it in step.
const TOKEN_FILES = new Set(["extension/ui/v2/tokens.css", "extension/ui/v2/tokens.js"]);
const NAMED_COLORS = "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen".split(" ");
const NAMED_RE = new RegExp(`(?<![\\w-])(${NAMED_COLORS.join("|")})(?![\\w-])`, "i");
const COLOR_PROPS = /^(--[\w-]+|color|background(-color|-image)?|border(-[a-z]+)*|outline(-color)?|box-shadow|text-shadow|fill|stroke|stop-color|flood-color|caret-color|accent-color|column-rule(-color)?|text-decoration(-color)?|mask(-image)?|filter|scrollbar-color)$/i;
const HEX_RE = /(?<![\w&])#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w-])/i;
const ENCODED_HEX_RE = /%23([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})(?![\w])/i;
const FUNC_RE = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(\s*[-\d.]/i;

function cssValueLiterals(value) {
  const found = [];
  const hex = value.match(HEX_RE); if (hex) found.push(hex[0]);
  const enc = value.match(ENCODED_HEX_RE); if (enc) found.push(enc[0]);
  const fn = value.match(FUNC_RE); if (fn) found.push(fn[0] + "…");
  return found;
}

function scanCss(text, file, offsetLine = 0) {
  const findings = [];
  const clean = text
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    // Semicolons inside quoted url(...) payloads are not declaration ends.
    .replace(/url\(\s*(["'])[\s\S]*?\1\s*\)/g, (m) => m.replace(/;/g, ","));
  const blockRe = /\{([^{}]*)\}/g;
  let block;
  while ((block = blockRe.exec(clean))) {
    const body = block[1];
    const startLine = clean.slice(0, block.index).split("\n").length;
    const declRe = /([-\w]+)\s*:\s*([^;]+)/g;
    let decl;
    while ((decl = declRe.exec(body))) {
      const [, prop, value] = decl;
      const line = startLine + body.slice(0, decl.index).split("\n").length - 1 + offsetLine;
      for (const literal of cssValueLiterals(value)) findings.push({ file, line, literal, where: prop });
      if (COLOR_PROPS.test(prop)) {
        const named = value.replace(/url\([^)]*\)/g, "").replace(/["'][^"']*["']/g, "").match(NAMED_RE);
        if (named) findings.push({ file, line, literal: named[0], where: prop });
      }
    }
  }
  return findings;
}

function scanJs(text, file) {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((lineText, index) => {
    const strings = lineText.match(/(["'`])(?:\\.|(?!\1).)*\1/g) || [];
    for (const raw of strings) {
      const inner = raw.slice(1, -1);
      if (/^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(inner)) findings.push({ file, line: index + 1, literal: inner, where: "string" });
      else if (FUNC_RE.test(inner) && !inner.includes("${")) findings.push({ file, line: index + 1, literal: inner.match(FUNC_RE)[0] + "…", where: "string" });
      else if (/[:;]\s*#([0-9a-f]{3}|[0-9a-f]{6})\b/i.test(inner)) findings.push({ file, line: index + 1, literal: inner.match(/#[0-9a-f]{3,6}/i)[0], where: "inline style string" });
    }
  });
  return findings;
}

function scanHtml(text, file) {
  const findings = [];
  const lines = text.split("\n");
  lines.forEach((lineText, index) => {
    for (const m of lineText.matchAll(/\b(fill|stroke|stop-color|color|bgcolor|flood-color)\s*=\s*["']([^"']+)["']/gi)) {
      const value = m[2];
      if (/^(none|currentcolor|transparent|inherit)$/i.test(value) || value.startsWith("url(")) continue;
      findings.push({ file, line: index + 1, literal: value, where: `${m[1]} attribute` });
    }
    for (const m of lineText.matchAll(/\bstyle\s*=\s*"([^"]*)"/gi)) {
      for (const decl of m[1].split(";")) {
        const [prop, ...rest] = decl.split(":");
        const value = rest.join(":");
        if (!prop || !value) continue;
        for (const literal of cssValueLiterals(value)) findings.push({ file, line: index + 1, literal, where: `style ${prop.trim()}` });
        if (COLOR_PROPS.test(prop.trim()) && NAMED_RE.test(value)) findings.push({ file, line: index + 1, literal: value.match(NAMED_RE)[0], where: `style ${prop.trim()}` });
      }
    }
  });
  for (const m of text.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
    const offset = text.slice(0, m.index).split("\n").length - 1;
    findings.push(...scanCss(m[1], file, offset));
  }
  return findings;
}

export function scanColourLiterals(root = ROOT) {
  const findings = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join("/");
      if (entry.isDirectory()) {
        if (["icons", "fonts", "_locales"].includes(entry.name)) continue;
        walk(full);
        continue;
      }
      if (TOKEN_FILES.has(rel)) continue;
      const text = fs.readFileSync(full, "utf8");
      if (rel.endsWith(".css")) findings.push(...scanCss(text, rel));
      else if (rel.endsWith(".js") || rel.endsWith(".mjs")) findings.push(...scanJs(text, rel));
      else if (rel.endsWith(".html")) findings.push(...scanHtml(text, rel));
    }
  };
  walk(path.join(root, "extension"));
  return findings;
}

// ---------- pond seed sweep (v3 §3.1) ----------
// The layer the shipped module renders for other seeds on this page, unmasked,
// measured in the page's margins: how the acceptance band moves with the
// per-install seed. Runs once per theme on the Downloads page.
async function pondSweep(page, theme, seeds) {
  return evaluate(page, `(async () => {
    const mod = await import(chrome.runtime.getURL("ui/v2/pond.js"));
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const main = document.querySelector("main")?.getBoundingClientRect();
    if (!main) return { error: "no main column" };
    const left = Math.floor(main.left), right = Math.ceil(main.right);
    const style = getComputedStyle(document.documentElement);
    const canvasRgb = mod.parseCssColor(style.getPropertyValue("--canvas"));
    const canvasL = mod.rgbToOklch(...canvasRgb).L;
    const toLab = (r, g, b) => { const { L, C, h } = mod.rgbToOklch(r, g, b); const rad = h * Math.PI / 180; return [L, C * Math.cos(rad), C * Math.sin(rad)]; };
    const [Lc, ac, bc] = toLab(...canvasRgb);
    const out = [];
    for (const seed of ${JSON.stringify(seeds)}) {
      const layer = new mod.PondLayer({ seed });
      const bitmap = layer.bitmap(${JSON.stringify(theme)}, width, height, canvasL, 1);
      const off = new OffscreenCanvas(width, height);
      const ctx = off.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, width, height).data;
      const dls = [];
      let covered = 0;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          if (x >= left && x < right) continue;
          const i = (y * width + x) * 4;
          const a = data[i + 3] / 255;
          if (a === 0) { dls.push(0); continue; }
          const r = Math.round(data[i] * a + canvasRgb[0] * (1 - a));
          const g = Math.round(data[i + 1] * a + canvasRgb[1] * (1 - a));
          const b = Math.round(data[i + 2] * a + canvasRgb[2] * (1 - a));
          const [L, A, B] = toLab(r, g, b);
          if (Math.hypot(A - ac, B - bc) > ${POND_BAND.chromaStep}) covered += 1;
          dls.push(Math.abs(L - Lc));
        }
      }
      dls.sort((p, q) => p - q);
      out.push({ seed, coverage: Math.round((covered / dls.length) * 1000) / 10, p95DeltaL: Math.round(dls[Math.floor(0.95 * dls.length)] * 1000) / 1000 });
    }
    return { width, height, margins: { left, right }, seeds: out };
  })()`, 120_000);
}

// ---------- browser run ----------
async function seed(browser, http, pageUrl, values) {
  const handle = await openPage(browser, http, "about:blank");
  try {
    await handle.navigate(pageUrl("options/options.html"));
    await evaluate(handle.page, `chrome.storage.local.set(${JSON.stringify(values)})`);
  } finally {
    await handle.close();
  }
}

// Make the popup or side panel treat the fixture tab as the active tab.
// Product code is untouched: only this page's chrome.tabs.query is wrapped.
function activeTabOverride(tabId) {
  return `(() => {
    const tabs = globalThis.chrome && globalThis.chrome.tabs;
    if (!tabs || typeof tabs.query !== "function") return;
    const original = tabs.query.bind(tabs);
    const patched = (query, callback) => {
      if (query && query.active) {
        const result = tabs.get(${Number(tabId)}).then((tab) => [tab]);
        if (typeof callback === "function") { result.then(callback); return undefined; }
        return result;
      }
      return original(query, callback);
    };
    try { tabs.query = patched; } catch { /* read-only binding */ }
    if (tabs.query !== patched) Object.defineProperty(tabs, "query", { value: patched, configurable: true, writable: true });
  })();`;
}

async function auditScreen({ browser, http, pageUrl, fixtureTabs }, screen, theme, lang) {
  const handle = await openPage(browser, http, "about:blank");
  const { page } = handle;
  if (screen.targetFixture) {
    const tabId = fixtureTabs?.[screen.targetFixture === "blank" ? "blank" : "media"];
    if (!Number.isInteger(tabId)) throw new Error(`${screen.id} needs the ${screen.targetFixture} fixture tab, which is not open`);
    await page.send("Page.addScriptToEvaluateOnNewDocument", { source: activeTabOverride(tabId) });
  }
  page.on("Page.javascriptDialogOpening", () => { page.send("Page.handleJavaScriptDialog", { accept: false }).catch(() => {}); });
  try {
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme === "dusk" ? "dark" : "light" }, { name: "prefers-contrast", value: "no-preference" }] });
    await page.send("Emulation.setDeviceMetricsOverride", { width: screen.width, height: screen.height, deviceScaleFactor: 2, mobile: false });
    // macOS overlay scrollbars fade in after any scroll and out a second later,
    // so two captures of one page disagree at the right edge. Hide them: at rest
    // they are hidden on macOS anyway.
    await page.send("Emulation.setScrollbarsHidden", { hidden: true }).catch(() => {});
    await handle.navigate(pageUrl(screen.page));
    await evaluate(page, "document.fonts.ready.then(() => true)").catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, screen.settleMs || 1200));
    let height = screen.height;
    if (screen.surface === "popup") {
      // Chrome sizes a toolbar popup to its document (capped at 800 × 600), so
      // audit at the height the popup actually opens with.
      const natural = await evaluate(page, "Math.ceil(Math.max(document.documentElement.getBoundingClientRect().height, document.body.getBoundingClientRect().height))");
      height = Math.max(200, Math.min(600, natural || 600));
      if (height !== screen.height) {
        await page.send("Emulation.setDeviceMetricsOverride", { width: screen.width, height, deviceScaleFactor: 2, mobile: false });
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    }
    if (screen.prepare) {
      await evaluate(page, `(() => { ${screen.prepare} })()`).catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, screen.prepareWaitMs || 700));
    }
    if (screen.fullPage) {
      // The report carries the height actually captured (the atlas lays pages out by it).
      height = await evaluate(page, "Math.min(9000, document.scrollingElement.scrollHeight)");
      await page.send("Emulation.setDeviceMetricsOverride", { width: screen.width, height, deviceScaleFactor: 2, mobile: false });
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    // The pond paints asynchronously and repaints on theme, size and empty-state
    // changes; measure and capture only a settled background.
    const pondSettled = () => poll(() => evaluate(page, "(() => { const p = document.querySelector('[data-pond]'); return !p || p.dataset.pondState === 'ready'; })()"), 8000, "the pond layer to paint").catch(() => {});
    await pondSettled();
    const config = { ...PAGE_CONFIG, lang, checkFocus: !flag("no-focus"), prefersContrastMore: false };
    const result = await evaluate(page, `(${pageAudit.toString()})(${JSON.stringify(config)})`, 60_000);
    // Screenshot after the focus pass has reset scroll and focus.
    await new Promise((resolve) => setTimeout(resolve, 300));
    await pondSettled();
    const shot = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 60_000);
    const base = `${screen.id}-${theme}-${lang}`;
    const shotFile = path.join(OUT, "shots", `${base}.png`);
    fs.writeFileSync(shotFile, Buffer.from(shot.data, "base64"));
    result.screenshot = path.relative(OUT, shotFile);
    if (result.pond?.present) {
      await evaluate(page, "document.querySelector('[data-pond]').style.visibility = 'hidden'");
      await new Promise((resolve) => setTimeout(resolve, 250));
      const without = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 60_000);
      await evaluate(page, "document.querySelector('[data-pond]').style.visibility = ''");
      const layout = await evaluate(page, `(() => {
        const width = document.documentElement.clientWidth;
        const main = document.querySelector("main")?.getBoundingClientRect();
        const margins = main ? Math.min(main.left, width - main.right) : 0;
        const shown = (el) => el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
        const volatile = [...document.querySelectorAll("[data-live], .focus-panel, [role=progressbar], .progress, [aria-live], .toast-region, .speed-chart, .segment-map")]
          .filter(shown).map((el) => { const r = el.getBoundingClientRect(); return { l: r.left - 4, t: r.top - 4, r: r.right + 4, b: r.bottom + 4 }; });
        return {
          column: main && margins >= ${JUDGED_MARGIN_MIN} ? { left: main.left, right: main.right } : null,
          margins: Math.round(margins),
          volatile,
          viewportRight: width,
          canvas: [document.body, document.documentElement].map((el) => getComputedStyle(el).backgroundColor)
        };
      })()`);
      const withPixels = decodePng(Buffer.from(shot.data, "base64"));
      const withoutPixels = decodePng(Buffer.from(without.data, "base64"));
      // §3.1: full pages are judged in their margins; the popup, the side panel
      // and 960-wide pages (40 px gutters, inside the feather) are reported only.
      const judged = Boolean(layout.column) && !["popup", "sidepanel"].includes(screen.surface);
      const metrics = pondMetrics(withPixels, withoutPixels, { column: layout.column, skip: layout.volatile, right: layout.viewportRight }, { dpr: 2 });
      const underText = result.contrast?.pondUnderText?.length || 0;
      result.pond = { ...result.pond, judged, margins: layout.margins, metrics, underText, verdict: pondVerdict(metrics, { theme, judged, underText }) };
      if (result.header?.present && !result.header.modal) {
        // §3.6, pixel for pixel: without the layer, the header outside its content box is the canvas.
        const canvasColour = layout.canvas.map(parseRgb).find((c) => c && c.a >= 0.99) || null;
        result.header.strip = headerStrip(withoutPixels, { header: result.header.rect, content: result.header.content, canvas: canvasColour, dpr: 2, right: layout.viewportRight });
      }
      const grey = path.join(OUT, "shots", `${base}.no-pond.png`);
      fs.writeFileSync(grey, Buffer.from(without.data, "base64"));
      if (screen.id === SWEEP_SCREEN && lang === "en") result.pond.sweep = await pondSweep(page, theme, SWEEP_SEEDS).catch((error) => ({ error: error.message }));
    }
    return { id: screen.id, surface: screen.surface, theme, lang, width: screen.width, height, ...result };
  } finally {
    await handle.close();
  }
}

function judge(screen) {
  const edges = screen.edges.length;
  const clipping = screen.clipping.clipped.length + screen.clipping.coveredAtRest.length + screen.clipping.focusObscured.length + screen.clipping.dialogActions.length;
  const checks = {
    a: { value: screen.textStyles.length, budget: BUDGETS.stylesPerScreen },
    display: { value: screen.display.excludingBrand, budget: BUDGETS.displayPerScreen },
    b: { value: edges, budget: BUDGETS.edges },
    c: { value: screen.nesting.violations.length, budget: BUDGETS.nesting },
    d: { value: screen.contrast.failures.length, budget: BUDGETS.contrast },
    e: { value: clipping, budget: BUDGETS.clipping },
    f: { value: screen.locale.leaks.length, budget: BUDGETS.locale },
    g: { value: screen.rules.length, budget: BUDGETS.rules },
    names: { value: screen.filenames.endTruncated.length, budget: BUDGETS.filenames }
  };
  for (const check of Object.values(checks)) check.pass = check.value <= check.budget;
  if (screen.pond?.verdict) checks.pond = { value: screen.pond.verdict.reasons.length, budget: 0, pass: screen.pond.verdict.pass };
  if (screen.header?.present) {
    const problems = screen.header.problems.length + (screen.header.strip?.stray ? 1 : 0);
    checks.header = { value: problems, budget: 0, pass: problems === 0 };
  }
  return checks;
}
export { judge };

const hexSeed = (seed) => `0x${(Number(seed) >>> 0).toString(16).toUpperCase()}`;

export function markdown(report) {
  const lines = [];
  const mark = (c) => (c ? (c.pass ? `${c.value}` : `**${c.value} ✗**`) : "–");
  lines.push(`# FluxCatch design audit — ${report.label}`, "");
  lines.push(`Run ${report.startedAt} · commit ${report.commit} · extension ${report.extensionDir} · Chrome for Testing · DPR 2 · pond seed ${hexSeed(report.pondSeed)}`, "");
  if (report.rejudgedAt) lines.push(`Verdicts recomputed ${report.rejudgedAt} with the acceptance in force then (captures and measurements unchanged).`, "");
  lines.push(`Pond (v3 §3.1): seed ${hexSeed(report.pondSeed)} stored before each run; margins of full pages with ≥ ${JUDGED_MARGIN_MIN} px gutters: chroma coverage ${POND_BAND.coverageMin}% to ${POND_BAND.coverageMax}% (ΔC > ${POND_BAND.chromaStep} in OKLCH against the capture without the layer), p95 |ΔL| ≤ ${POND_BAND.p95.morning} Morning / ${POND_BAND.p95.dusk} Dusk; no pond pixel under any text run on any screen. Cells read "coverage · p95", in parentheses where the screen is reported but not judged (popup, side panel, 960 wide). Header (v3 §3.6): at scroll 0 the top bar is the canvas (background alpha 0, no shadow, band at opacity 0, and the capture without the layer is canvas pixel for pixel outside the content box). Contrast (d) is measured against the composited background: the pond's pixels over the canvas.`, "");
  lines.push("Budgets: a ≤ 6 text styles per screen (≤ 8 app-wide) · Display ≤ 2 per screen outside the BrandMark · b ≤ 3 left edges · c 0 nested containers · d 0 contrast failures · e 0 clipped/covered · f 0 locale leaks · g 0 rules (hr.section-rule between Settings sections exempt) · names 0 end-truncated filenames · h 0 colour literals.", "");
  lines.push(`## Summary`, "");
  lines.push(`- Screens audited: ${report.screens.length}; screens meeting every budget: ${report.screens.filter((s) => Object.values(s.checks).every((c) => c.pass)).length}.`);
  const perLang = Object.entries(report.appWidePerLanguage || {}).map(([lang, n]) => `${lang} ${n}${n > BUDGETS.stylesAppWide ? " ✗" : ""}`).join(", ");
  lines.push(`- App-wide text styles (a), per UI language: ${perLang} (budget ${BUDGETS.stylesAppWide}); ${report.appWideStyles.length} across both languages.`);
  lines.push(`- Colour literals outside the token files (h): ${report.literals.length}${report.literals.length ? " ✗" : ""}.`);
  lines.push("", "| Screen | Theme | Lang | a styles | Display | b edges | c nesting | d contrast | e clip | f locale | g rules | names | pond | header |", "|---|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  const pondCell = (s) => {
    const p = s.pond;
    if (!p?.metrics) return "–";
    const text = `${p.metrics.coverage}% · ${p.metrics.p95DeltaL}`;
    if (!p.verdict?.pass) return `**${text} ✗**`;
    return p.judged ? text : `(${text})`;
  };
  const headerCell = (s) => (s.checks.header ? (s.checks.header.pass ? "✓" : `**${s.checks.header.value} ✗**`) : "–");
  for (const s of report.screens) {
    const c = s.checks;
    lines.push(`| ${s.id} | ${s.theme} | ${s.lang} | ${mark(c.a)} | ${mark(c.display)} | ${mark(c.b)} | ${mark(c.c)} | ${mark(c.d)} | ${mark(c.e)} | ${mark(c.f)} | ${mark(c.g)} | ${mark(c.names)} | ${pondCell(s)} | ${headerCell(s)} |`);
  }
  lines.push("", "## App-wide text styles", "");
  for (const style of report.appWideStyles) lines.push(`- \`${style.family.split(",").slice(0, 2).join(", ")}\` ${style.size} / ${style.lineHeight} · ${style.weight} — on ${style.screens} screen(s), e.g. “${style.sample}”`);
  lines.push("", "## Details per screen (Morning, English)", "");
  for (const s of report.screens.filter((x) => x.theme === "morning" && x.lang === "en")) {
    lines.push(`### ${s.id}`, "");
    lines.push(`- a: ${s.textStyles.length} styles — ${s.textStyles.map((t) => `${t.family.split(",")[0]} ${t.size}/${t.lineHeight} ${t.weight}`).join(" · ")}`);
    lines.push(`- Display outside BrandMark: ${s.display.excludingBrand} — ${s.display.samples.join("; ") || "none"}`);
    lines.push(`- b: ${s.edges.length} left edges — ${s.edges.map((e) => `x=${e.x} (${e.n}: ${e.samples.slice(0, 2).join(" | ")})`).join(" · ")}`);
    lines.push(`- c: ${s.nesting.violations.length} nested containers (max depth ${s.nesting.maxDepth})${s.nesting.violations.slice(0, 6).map((v) => `\n  - ${v.outer} ⊃ ${v.inner}`).join("")}`);
    lines.push(`- d: ${s.contrast.failures.length} contrast failures of ${s.contrast.checked}${s.contrast.failures.slice(0, 6).map((f) => `\n  - ${f.ratio}:1 < ${f.required} — ${f.where} (${f.fg} on ${f.bg}, ${f.size} ${f.weight})`).join("")}`);
    const e = s.clipping;
    lines.push(`- e: clipped ${e.clipped.length}, covered at rest ${e.coveredAtRest.length}, focus obscured ${e.focusObscured.length}, dialog actions ${e.dialogActions.length}${[...e.clipped, ...e.coveredAtRest, ...e.focusObscured, ...e.dialogActions].slice(0, 6).map((x) => `\n  - ${x.where} — ${x.reason || `under ${x.by}`}`).join("")}`);
    lines.push(`- g: ${s.rules.length} rules${s.rules.slice(0, 6).map((r) => `\n  - ${r.where}: ${r.what}`).join("")}`);
    lines.push(`- names: ${s.filenames.endTruncated.length} end-truncated filenames${s.filenames.endTruncated.slice(0, 3).map((n) => `\n  - ${n.where}`).join("")}`);
    const p = s.pond;
    if (p?.metrics) lines.push(`- pond (§3.1, ${p.judged ? "judged in the margins" : p.metrics.region === "margins" ? "margins, reported only" : "whole frame, reported only"}${p.margins ? `, ${p.margins} px gutters` : ""}): coverage ${p.metrics.coverage}% (ΔC > ${POND_BAND.chromaStep}) · p95 |ΔL| ${p.metrics.p95DeltaL} · mean |ΔL| ${p.metrics.meanDeltaL} · footprint ${p.metrics.footprint}% · under text ${p.underText} → ${p.verdict.pass ? "ok" : p.verdict.reasons.join("; ")}`);
    const h = s.header;
    if (h?.present) lines.push(`- header at scroll 0 (§3.6): background alpha ${h.backgroundAlpha}, box-shadow ${h.boxShadow}, band opacity ${h.band.opacity}${h.strip ? `, capture without the layer: ${h.strip.stray} of ${h.strip.sampled} px off the canvas` : h.modal ? ", pixels not checked under a dialog" : ""} → ${s.checks.header?.pass ? "ok" : h.problems.concat(h.strip?.stray ? [`${h.strip.stray} stray px (worst ${h.strip.worst}/255)`] : []).join("; ")}`);
    lines.push(`- screenshot: ${s.screenshot}`, "");
  }
  const leakScreens = report.screens.filter((s) => s.locale.leaks.length);
  lines.push("## Locale leaks (f)", "");
  for (const s of leakScreens) {
    lines.push(`- ${s.id} · ${s.theme} · ${s.lang}: ${s.locale.leaks.slice(0, 8).map((l) => `“${l.text}”`).join(", ")}${s.locale.leaks.length > 8 ? ` … (+${s.locale.leaks.length - 8})` : ""}`);
  }
  if (!leakScreens.length) lines.push("- none");
  lines.push("", "## Dusk contrast failures (d)", "");
  const dusk = report.screens.filter((s) => s.theme === "dusk" && s.lang === "en" && s.contrast.failures.length);
  for (const s of dusk) lines.push(`- ${s.id}: ${s.contrast.failures.slice(0, 6).map((f) => `${f.ratio}:1 ${f.where}`).join("; ")}`);
  if (!dusk.length) lines.push("- none");
  lines.push("", "## Pond acceptance (§3.1), judged screens", "");
  lines.push("| Screen | Theme | Lang | gutters | coverage | p95 \|ΔL\| | mean \|ΔL\| | under text | verdict |", "|---|---|---|---|---|---|---|---|---|");
  for (const s of report.screens.filter((x) => x.pond?.judged)) {
    const p = s.pond;
    lines.push(`| ${s.id} | ${s.theme} | ${s.lang} | ${p.margins} px | ${p.metrics.coverage}% | ${p.metrics.p95DeltaL} | ${p.metrics.meanDeltaL} | ${p.underText} | ${p.verdict.pass ? "ok" : p.verdict.reasons.join("; ")} |`);
  }
  const underTextScreens = report.screens.filter((s) => s.pond?.underText);
  lines.push("", `Pond under text: ${underTextScreens.length ? underTextScreens.map((s) => `${s.id} · ${s.theme} · ${s.lang}: ${s.contrast.pondUnderText.slice(0, 4).map((u) => `${u.where} (α ${u.pondAlpha})`).join(", ")}`).join("; ") : "none on any screen"}.`);
  lines.push("", "## Pond seed sweep (§3.1)", "");
  const sweeps = report.screens.filter((s) => s.pond?.sweep?.seeds);
  if (sweeps.length) {
    const first = sweeps[0].pond.sweep;
    lines.push(`The shipped module's layer for ${first.seeds.length} seeds on ${SWEEP_SCREEN} (${first.width} × ${first.height}, margins x < ${first.margins.left} and x ≥ ${first.margins.right}), unmasked, English; the audit's pinned seed is first, the reference script's second. Masking takes the feather's share off these numbers; the judged table above has the pinned seed as seen.`, "");
    lines.push(`| Seed | ${sweeps.map((s) => `${s.theme} coverage`).join(" | ")} | ${sweeps.map((s) => `${s.theme} p95 \|ΔL\|`).join(" | ")} |`, `|---|${sweeps.map(() => "---").join("|")}|${sweeps.map(() => "---").join("|")}|`);
    first.seeds.forEach((entry, index) => {
      const cells = sweeps.map((s) => s.pond.sweep.seeds[index]);
      lines.push(`| ${hexSeed(entry.seed)} | ${cells.map((c) => `${c.coverage}%${c.coverage < POND_BAND.coverageMin || c.coverage > POND_BAND.coverageMax ? " ✗" : ""}`).join(" | ")} | ${cells.map((c, i) => `${c.p95DeltaL}${c.p95DeltaL > (POND_BAND.p95[sweeps[i].theme] ?? 1) ? " ✗" : ""}`).join(" | ")} |`);
    });
    for (const s of sweeps) {
      const inBand = s.pond.sweep.seeds.filter((c) => c.coverage >= POND_BAND.coverageMin && c.coverage <= POND_BAND.coverageMax).length;
      lines.push("", `- ${s.theme}: ${inBand} of ${s.pond.sweep.seeds.length} seeds inside the band unmasked.`);
    }
  } else {
    lines.push(`- not run (${SWEEP_SCREEN} in English was not in this run${sweeps.length === 0 && report.screens.some((s) => s.pond?.sweep?.error) ? `: ${report.screens.find((s) => s.pond?.sweep?.error).pond.sweep.error}` : ""}).`);
  }
  lines.push("", "## Header at scroll 0 (§3.6)", "");
  const headerFails = report.screens.filter((s) => s.checks.header && !s.checks.header.pass);
  for (const s of headerFails) lines.push(`- ${s.id} · ${s.theme} · ${s.lang}: ${s.header.problems.concat(s.header.strip?.stray ? [`${s.header.strip.stray} stray px`] : []).join("; ")}`);
  if (!headerFails.length) lines.push(`- every screen with a top bar passes (${report.screens.filter((s) => s.checks.header).length} screens).`);
  lines.push("", "## Colour literals outside the token files (h)", "");
  const byFile = new Map();
  for (const f of report.literals) byFile.set(f.file, [...(byFile.get(f.file) || []), f]);
  for (const [file, items] of byFile) lines.push(`- ${file}: ${items.length} — ${items.slice(0, 5).map((i) => `L${i.line} ${i.literal}`).join(", ")}${items.length > 5 ? " …" : ""}`);
  if (!byFile.size) lines.push("- none");
  lines.push("", "## Definitions", "", "See the header of scripts/lib/page-audit.mjs for the exact definition of each check.", "");
  return lines.join("\n");
}

function publish(report) {
  const target = path.resolve(ROOT, PUBLISH);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(path.join(target, `${report.label}.md`), markdown(report));
  const slim = { ...report, screens: report.screens.map(({ textStyles, edges, trailingRightEdges, ...rest }) => ({ ...rest, textStyles: textStyles.map(({ samples, ...t }) => t), edges })) };
  fs.writeFileSync(path.join(target, `${report.label}.json`), JSON.stringify(slim, null, 2));
}

function summarise(report) {
  const appWideMax = Math.max(0, ...Object.values(report.appWidePerLanguage || {}));
  const allPass = report.screens.every((s) => Object.values(s.checks).every((c) => c.pass)) && appWideMax <= BUDGETS.stylesAppWide && report.literals.length === 0;
  console.log(`app-wide styles per language ${JSON.stringify(report.appWidePerLanguage)} (budget ${BUDGETS.stylesAppWide}) · colour literals ${report.literals.length} · ${allPass ? "ALL BUDGETS MET" : "budgets not met"}`);
  return allPass;
}

// Re-run only the verdicts of an earlier run against the current acceptance.
function rejudge(label) {
  const dir = path.join(ROOT, "tools", "live", "out", "design-audit", label);
  const file = path.join(dir, "report.json");
  const report = JSON.parse(fs.readFileSync(file, "utf8"));
  for (const screen of report.screens) {
    if (screen.pond?.metrics) screen.pond.verdict = pondVerdict(screen.pond.metrics, { theme: screen.theme, judged: screen.pond.judged, underText: screen.pond.underText || 0 });
    screen.checks = judge(screen);
  }
  report.budgets = { ...report.budgets, pond: POND_BAND };
  report.rejudgedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(dir, "report.md"), markdown(report));
  if (PUBLISH) publish(report);
  console.log(`rejudged ${label}: ${report.screens.filter((s) => Object.values(s.checks).every((c) => c.pass)).length} of ${report.screens.length} screens meet every budget`);
  process.exitCode = summarise(report) ? 0 : 1;
}

async function main() {
  if (REJUDGE) return rejudge(REJUDGE);
  const awake = keepDisplayAwake();
  process.on("exit", () => { try { awake?.kill(); } catch { /* gone */ } });
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, "shots"), { recursive: true });
  const startedAt = new Date().toISOString();
  // The same identity the e2e matrix stamps (v3 §3.7): short hash, or "uncommitted".
  const identity = buildIdentity(ROOT);
  const commit = identity.commit;
  const screens = SCREENS.filter((s) => SURFACES.includes(s.surface) && (!SCREEN_FILTER || SCREEN_FILTER.includes(s.id)));
  const results = [];
  const fixture = screens.some((s) => s.fixture) ? await startMediaFixture() : null;
  for (const lang of LANGS) {
    const chromeLang = lang === "zh" ? "zh-CN" : "en-US";
    for (const profileKind of ["history", "empty", "active"]) {
      const group = screens.filter((s) => (s.profile || "history") === profileKind);
      if (!group.length) continue;
      const profile = fs.mkdtempSync(path.join(os.tmpdir(), `fluxcatch-audit-${lang}-${profileKind}-`));
      const work = fs.mkdtempSync(path.join(os.tmpdir(), `fluxcatch-audit-work-`));
      let extensionDir = EXTENSION_DIR;
      let expectedId = null;
      try {
        if (profileKind === "active") {
          // A copy with the engine permission granted, plus a stand-in engine registered in this profile only.
          extensionDir = prepareActiveExtension(EXTENSION_DIR, path.join(work, "extension"));
          const manifest = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));
          const launcher = writeFakeHostLauncher(path.join(work, "host"), { scenario: ACTIVE_SCENARIO, extensionDir, downloadDir: "/Users/you/Downloads/FluxCatch", logFile: path.join(work, "fake-host.log") });
          expectedId = extensionIdFromKey(manifest.key);
          registerFakeHost(profile, launcher, expectedId);
        }
        if (profileKind !== "empty") {
          // The worker reads history once at startup: seed, then start a fresh session.
          await session({ profile, extensionDir, lang: chromeLang, args: fixture?.chromeArgs || [] }, async (ctx) => {
            await seed(ctx.browser, ctx.http, ctx.pageUrl, { "downloadHistory.v1": historyFixture(), "fluxcatch.uiLanguage.v1": lang, "fluxcatch.pondSeed.v1": POND_SEED });
          });
        }
        await session({ profile, extensionDir, lang: chromeLang, args: fixture?.chromeArgs || [] }, async (ctx) => {
          if (profileKind === "empty") await seed(ctx.browser, ctx.http, ctx.pageUrl, { "fluxcatch.uiLanguage.v1": lang, "fluxcatch.pondSeed.v1": POND_SEED });
          let control = null;
          let fixtureTab = null;
          let blankTab = null;
          if (profileKind === "active") {
            // The stand-in engine is registered for one extension id; Chrome must load the copy under it.
            if (ctx.extensionId !== expectedId) throw new Error(`extension id ${ctx.extensionId} does not match the engine registration ${expectedId}`);
            // Start the downloads from a tab that stays open for the whole session.
            control = await openPage(ctx.browser, ctx.http, "about:blank");
            await control.navigate(ctx.pageUrl("options/options.html"));
            const replies = await startFixtureDownloads((expression) => evaluate(control.page, expression), ACTIVE_ITEMS);
            // Active screens are meaningless unless the stand-in engine took every download.
            const failed = replies.filter((reply) => !reply?.ok || reply.method !== "native");
            if (failed.length) {
              const log = path.join(work, "fake-host.log");
              throw new Error(`fixture downloads failed: ${JSON.stringify(failed)}${fs.existsSync(log) ? `\n${fs.readFileSync(log, "utf8").slice(-2000)}` : ""}`);
            }
            await new Promise((resolve) => setTimeout(resolve, ACTIVE_SCENARIO.rampMs + 1500));
          }
          if (group.some((s) => s.fixture)) {
            // Open the media page and wait until detection has found all three items.
            control ||= await openPage(ctx.browser, ctx.http, "about:blank");
            if (!(await evaluate(control.page, "location.protocol").catch(() => "")).startsWith("chrome-extension")) await control.navigate(ctx.pageUrl("options/options.html"));
            blankTab = await openPage(ctx.browser, ctx.http, "about:blank");
            await blankTab.navigate(fixture.blankUrl);
            fixtureTab = await openPage(ctx.browser, ctx.http, "about:blank");
            // Chrome defers media loading in tabs that were never in front.
            await fixtureTab.page.send("Page.bringToFront").catch(() => {});
            await fixtureTab.navigate(fixture.pageUrl);
            const tabIdFor = (pathPart) => poll(() => evaluate(control.page, `chrome.tabs.query({ url: "http://${MEDIA_FIXTURE_HOST}/*" }).then((tabs) => tabs.find((tab) => tab.url.includes(${JSON.stringify(pathPart)}))?.id ?? null)`), 10_000, `the ${pathPart} fixture tab`);
            const tabId = await tabIdFor(new URL(fixture.pageUrl).pathname);
            const blankId = await tabIdFor(new URL(fixture.blankUrl).pathname);
            let last = null;
            await poll(async () => {
              last = await evaluate(control.page, `chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: ${tabId} })`);
              return (last?.items?.length || 0) >= 3 ? true : null;
            }, 20_000, "media detection on the fixture page").catch((error) => {
              throw new Error(`${error.message}; detected ${JSON.stringify((last?.items || []).map((item) => ({ kind: item.kind, url: item.url })))}`);
            });
            ctx.fixtureTabs = { media: tabId, blank: blankId };
          }
          for (const theme of THEMES) {
            for (const screen of group) {
              const started = Date.now();
              const result = await auditScreen(ctx, screen, theme, lang);
              result.checks = judge(result);
              results.push(result);
              const failing = Object.entries(result.checks).filter(([, c]) => !c.pass).map(([k, c]) => `${k}=${c.value}`);
              console.log(`${screen.id.padEnd(22)} ${theme.padEnd(8)} ${lang}  ${failing.length ? "✗ " + failing.join(" ") : "✓"}  (${Date.now() - started} ms)`);
            }
          }
          await fixtureTab?.close();
          await blankTab?.close();
          await control?.close();
        });
      } finally {
        fs.rmSync(profile, { recursive: true, force: true });
        fs.rmSync(work, { recursive: true, force: true });
      }
    }
  }
  await fixture?.close();
  // App-wide styles are counted per UI language: §4 gives Chinese text 2 px
  // more line-height, which is the same role in another script, not a new style.
  const appWide = new Map();
  const perLanguage = {};
  for (const s of results) for (const t of s.textStyles) {
    if (!appWide.has(t.key)) appWide.set(t.key, { ...t, screens: 0, sample: t.samples[0] });
    appWide.get(t.key).screens += 1;
    (perLanguage[s.lang] ||= new Set()).add(t.key);
  }
  const appWidePerLanguage = Object.fromEntries(Object.entries(perLanguage).map(([lang, keys]) => [lang, keys.size]));
  const report = {
    label: LABEL, startedAt, commit, extensionDir: identity.extensionDir, packaged: identity.packaged, budgets: { ...BUDGETS, pond: POND_BAND }, pondSeed: POND_SEED, appWidePerLanguage,
    appWideStyles: [...appWide.values()].sort((x, y) => y.screens - x.screens).map(({ samples, n, ...rest }) => rest),
    literals: scanColourLiterals(),
    screens: results
  };
  fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(OUT, "report.md"), markdown(report));
  if (PUBLISH) publish(report);
  console.log(`\nreport: ${path.relative(ROOT, path.join(OUT, "report.md"))}`);
  process.exitCode = summarise(report) ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.stack || error.message); process.exit(2); });
}
