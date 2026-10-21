import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setUiLanguage } from "../extension/ui/v2/locale.js";
import { DISPLAY_KEYS, MESSAGES, MODULES } from "../extension/ui/v2/messages.js";
import { dayGroupOf, formatBytes, formatDuration, formatRate, formatRelativeTime } from "../extension/ui/v2/locale.js";
import { planTouches, oklchToRgb } from "../extension/ui/v2/pond.js";
import { splitFilename } from "../extension/ui/v2/components.js";
import { scanColourLiterals } from "../scripts/design-audit.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const tokens = read("extension/ui/v2/tokens.css");
const CJK = /[㐀-鿿　-〿＀-￯]/;

function block(selector) {
  const start = tokens.indexOf(selector);
  assert.ok(start >= 0, `tokens define ${selector}`);
  const body = tokens.slice(tokens.indexOf("{", start) + 1, tokens.indexOf("}", start));
  return Object.fromEntries([...body.matchAll(/(--[\w-]+):\s*(#[0-9A-F]{6})/gi)].map((m) => [m[1], m[2]]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => { const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (h + 0.05) / (l + 0.05); };
const mix = (top, bottom, alpha) => "#" + [1, 3, 5].map((i) => Math.round(Number.parseInt(top.slice(i, i + 2), 16) * alpha + Number.parseInt(bottom.slice(i, i + 2), 16) * (1 - alpha)).toString(16).padStart(2, "0")).join("");

const THEMES = { morning: block(":root,\n[data-theme=\"morning\"]"), dusk: block("[data-theme=\"dusk\"]") };
const SURFACES = ["--sunken", "--canvas", "--surface", "--raised"];

test("v2 value ladders: every text token reaches 4.5:1 on every surface of its theme", () => {
  for (const [theme, vars] of Object.entries(THEMES)) {
    for (const text of ["--text-primary", "--text-secondary", "--text-muted", "--pond-text", "--lilac-text", "--celadon-text", "--ochre-text", "--rose-text", "--vermilion-text", "--harbour-text"]) {
      for (const surface of SURFACES) {
        const ratio = contrast(vars[text], vars[surface]);
        assert.ok(ratio >= 4.5, `${theme} ${text} ${vars[text]} on ${surface} ${vars[surface]} is ${ratio.toFixed(2)}:1`);
      }
    }
    assert.ok(contrast(vars["--text-on-accent"], vars["--primary-fill"]) >= 4.5, `${theme} primary button text`);
    assert.ok(contrast(vars["--text-on-accent"], vars["--primary-fill-pressed"]) >= 4.5, `${theme} pressed primary button text`);
    assert.ok(contrast(vars["--pond-text-on-tint"], mix(vars["--pond"], vars["--canvas"], 0.12)) >= 4.5, `${theme} secondary button text on its tint`);
  }
});

test("ui/v2/tokens.js mirrors the Morning values of tokens.css exactly (the worker's badge colours)", async () => {
  const { MORNING, BADGE_COLORS } = await import("../extension/ui/v2/tokens.js");
  const css = readFileSync(new URL("../extension/ui/v2/tokens.css", import.meta.url), "utf8");
  const start = css.indexOf(':root,\n[data-theme="morning"] {');
  assert.ok(start >= 0, "the Morning block");
  const block = css.slice(start, css.indexOf("}", start));
  assert.deepEqual(Object.keys(MORNING).sort(), ["--primary-fill", "--text-on-accent", "--text-secondary"], "only the badge's three tokens");
  for (const [name, value] of Object.entries(MORNING)) {
    const declared = new RegExp(`${name}:\\s*([^;]+);`).exec(block)?.[1]?.trim();
    assert.equal(value.toLowerCase(), String(declared).toLowerCase(), `${name} drifted from tokens.css`);
  }
  assert.deepEqual({ ...BADGE_COLORS }, { active: MORNING["--primary-fill"], idle: MORNING["--text-secondary"], text: MORNING["--text-on-accent"] });
  const source = readFileSync(new URL("../extension/ui/v2/tokens.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bimport\b|document|window/, "DOM-free, no imports: a service worker can load it");
});

test("v2 value ladders keep the §8 surface steps and never use pure black or white", () => {
  const values = [...tokens.matchAll(/#([0-9A-F]{6})\b/gi)].map((m) => m[1].toUpperCase());
  assert.ok(!values.includes("000000") && !values.includes("FFFFFF"), "no pure black or white");
  const step = (vars, a, b) => Math.abs(luminance(vars[a]) - luminance(vars[b]));
  for (const [theme, vars] of Object.entries(THEMES)) {
    assert.ok(step(vars, "--sunken", "--canvas") > 0 && step(vars, "--canvas", "--surface") > 0 && step(vars, "--surface", "--raised") > 0, `${theme} surfaces are distinct steps`);
  }
  assert.match(tokens, /--font-display:\s*"Fraunces", "Noto Serif SC", "Songti SC", serif/);
  assert.match(tokens, /--font-text:\s*"Instrument Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif/);
  assert.doesNotMatch(tokens, /https?:\/\//, "fonts are bundled, never fetched");
});

test("v2 copy exists in both languages, with no locale leaks inside either table", () => {
  for (const [name, module] of Object.entries(MODULES)) {
    assert.deepEqual(Object.keys(module.zh).sort(), Object.keys(module.en).sort(), `messages/${name}.js: zh and en tables have the same keys`);
  }
  const en = Object.keys(MESSAGES.en).sort();
  const zh = Object.keys(MESSAGES.zh).sort();
  assert.deepEqual(zh, en, "zh and en tables have the same keys");
  assert.equal(en.length, Object.values(MODULES).reduce((sum, module) => sum + Object.keys(module.en).length, 0), "the merged table holds every module's keys");
  const sample = { name: "clip.mp4", count: 3, size: "3 GB", done: 31, total: 50, time: "0:05", now: "5 MB/s", peak: "6 MB/s" };
  const LATIN_OK = new Set(["FluxCatch", "Finder", "Mac", "Chrome", "http", "https", "GB", "MB", "clip", "mp4"]);
  for (const key of en) {
    setUiLanguage("en");
    const english = typeof MESSAGES.en[key] === "function" ? MESSAGES.en[key](sample) : MESSAGES.en[key];
    setUiLanguage("zh");
    const chinese = typeof MESSAGES.zh[key] === "function" ? MESSAGES.zh[key](sample) : MESSAGES.zh[key];
    assert.ok(!CJK.test(english), `en ${key} has no CJK: ${english}`);
    const latin = (chinese.replace(/[\w.-]+\.(mp4|com)/g, "").match(/[A-Za-z]{2,}/g) || []).filter((word) => !LATIN_OK.has(word));
    assert.deepEqual(latin, [], `zh ${key} has no stray Latin: ${chinese}`);
    assert.doesNotMatch(english, /\(s\)/, `en ${key} pluralises properly`);
  }
  setUiLanguage("zh");
});

test("the Chinese Display subset contains every glyph the Display strings use", () => {
  const glyphs = new Set([...read("extension/ui/fonts/NotoSerifSC-display.txt").trim()]);
  for (const key of DISPLAY_KEYS) {
    for (const ch of MESSAGES.zh[key]) {
      if (CJK.test(ch)) assert.ok(glyphs.has(ch), `subset lacks “${ch}” from ${key}; run scripts/build-display-font.mjs`);
    }
  }
});

test("formatters follow the UI language and use decimal units like Finder", () => {
  setUiLanguage("en");
  assert.equal(formatBytes(2.35e9), "2.4 GB");
  assert.equal(formatBytes(812e6), "812 MB");
  assert.equal(formatRate(56.3e6), "56.3 MB/s");
  assert.equal(formatDuration(148), "2:28");
  assert.equal(formatDuration(3480), "58:00");
  const now = new Date(2026, 9, 21, 15, 0).getTime();
  assert.match(formatRelativeTime(now - 3_600_000, now), /^1 hr\.? ago$/);
  assert.equal(dayGroupOf(now - 3_600_000, now), "today");
  assert.equal(dayGroupOf(new Date(2026, 9, 20, 23, 59).getTime(), now), "yesterday");
  assert.equal(dayGroupOf(new Date(2026, 9, 16, 9, 0).getTime(), now), "week");
  assert.equal(dayGroupOf(new Date(2026, 9, 1, 9, 0).getTime(), now), "earlier");
  setUiLanguage("zh");
  assert.ok(!/[A-Za-z]{3,}/.test(formatRelativeTime(now - 3_600_000, now)), "zh relative time is Chinese");
  assert.match(formatRelativeTime(now - 3_600_000, now), /小时/);
  assert.match(formatRelativeTime(new Date(2026, 9, 1, 9, 0).getTime(), now), /10月1日/);
});

test("filenames keep their extension when truncated", () => {
  assert.deepEqual(splitFilename("Lecture 12 · Pharmacokinetics.mp4"), { full: "Lecture 12 · Pharmacokinetics.mp4", head: "Lecture 12 · Pharmaco", tail: "kinetics.mp4" });
  const { head, tail } = splitFilename("a.very.long.name.webm");
  assert.ok(tail.endsWith(".webm") && (head + tail) === "a.very.long.name.webm");
  assert.equal(splitFilename("README").tail.length, 6);
});

test("pond touches are deterministic, within the §6.10 geometry, and equiluminant", () => {
  const options = { seed: 1234, width: 1280, height: 900, lightness: 0.955, hues: [241.8, 295.6, 162.5, 12.1, 56.6], zones: [{ x: 0, y: 0, width: 200, height: 900 }, { x: 1080, y: 0, width: 200, height: 900 }] };
  const a = planTouches(options);
  const b = planTouches(options);
  assert.deepEqual(a, b, "same seed, same pond");
  assert.ok(a.length >= 150 && a.length <= 250, `touch count ${a.length}`);
  for (const touch of a) {
    assert.ok(touch.length >= 6 && touch.length <= 18);
    assert.ok(touch.thickness >= 2 && touch.thickness <= 5);
    assert.ok(Math.abs(touch.angle) <= (12 * Math.PI) / 180 + 1e-9);
    assert.ok(touch.opacity >= 0.35 && touch.opacity <= 0.55);
    assert.ok(Math.abs(touch.L - 0.955) <= 0.01 + 1e-9, "lightness stays within ±0.01 of the canvas");
    assert.ok(touch.x < 200 || touch.x >= 1080, "touches fall in the margins");
  }
  // Composite luminance change over the canvas stays tiny: hue without value.
  const canvas = oklchToRgb(0.955, 0.0103, 81.8);
  const lum = ({ r, g, b }) => [r, g, b].map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
  const base = lum(canvas);
  for (const touch of a) {
    const [r, g, bb] = touch.rgb;
    const blended = { r: r * touch.opacity + canvas.r * (1 - touch.opacity), g: g * touch.opacity + canvas.g * (1 - touch.opacity), b: bb * touch.opacity + canvas.b * (1 - touch.opacity) };
    const lStar = (y) => 116 * Math.cbrt(y) - 16;
    assert.ok(Math.abs(lStar(lum(blended)) - lStar(base)) < 2.5, "a touch moves L* by less than 2.5");
  }
});

test("the Downloads page is built on v2 only, with no copy in its HTML and no colour literals", () => {
  const html = read("extension/downloads/downloads.html");
  const order = ["../ui/v2/tokens.css", "../ui/v2/system.css", "downloads.css"].map((href) => html.indexOf(`href="${href}"`));
  assert.ok(order.every((index) => index >= 0) && order[0] < order[1] && order[1] < order[2], "tokens, system, page in order");
  assert.doesNotMatch(html, /ui\/tokens\.css|ui\/components\.css|ui\/atmosphere\.css/, "no v1 stylesheets");
  assert.ok(!CJK.test(html.replace(/<!--[\s\S]*?-->/g, "")), "copy comes from messages.js, not the HTML");
  const js = read("extension/downloads/downloads.js").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(!/["'`][^"'`\n]*[一-鿿][^"'`\n]*["'`]/.test(js), "no Chinese literals in the controller");
  assert.doesNotMatch(js, /window\.confirm|innerHTML/, "confirmations happen in place; no HTML strings");
  const literals = scanColourLiterals().filter((f) => f.file.startsWith("extension/ui/v2/") || f.file.startsWith("extension/downloads/"));
  assert.deepEqual(literals, [], "no colour literals outside the token file");
  const css = read("extension/downloads/downloads.css") + read("extension/ui/v2/system.css");
  assert.doesNotMatch(css, /text-transform:\s*uppercase|letter-spacing:\s*[1-9.]|font-style:\s*italic/, "no tracked caps, letter-spacing or italics");
  assert.doesNotMatch(css, /border(-top|-bottom|-left|-right)?:\s*1px/, "no 1px rules");
});
