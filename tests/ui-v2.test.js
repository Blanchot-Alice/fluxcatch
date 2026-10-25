import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setUiLanguage } from "../extension/ui/v2/locale.js";
import { DISPLAY_KEYS, MESSAGES, MODULES } from "../extension/ui/v2/messages.js";
import { dayGroupOf, formatBytes, formatDuration, formatRate, formatRelativeTime } from "../extension/ui/v2/locale.js";
import { planPond, maskFactor, maskContent, contentBoxes, rgbToOklch, parseCssColor, oklchToRgb } from "../extension/ui/v2/pond.js";
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
  const LATIN_OK = new Set(["Havre", "Finder", "Mac", "Chrome", "http", "https", "GB", "MB", "clip", "mp4", "yt", "dlp"]);
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

// The v3 layer (design review v3 §3.1): docs/design-review/pond-reference/pond_layer.py is the spec.
test("the v3 pond layer is deterministic, scales with area, gathers into drifts, and sits below the Morning ground and above the Dusk water", () => {
  const seed = 0xf1c4c7;
  const morning = planPond({ seed, width: 1280, height: 900, theme: "morning", canvasL: 0.955 });
  assert.deepEqual(planPond({ seed, width: 1280, height: 900, theme: "morning", canvasL: 0.955 }), morning, "same seed, same layer");
  assert.equal(morning.drifts.length, 6, "six drifts per 1280 × 900");
  const scales = [
    { count: 420, length: [30, 84], width: [6, 11], alpha: [0.1, 0.24], dl: -0.03, chroma: [0.022, 0.04] },
    { count: 2600, length: [10, 30], width: [3, 6.5], alpha: [0.22, 0.48], dl: -0.06, chroma: [0.028, 0.052] },
    { count: 3800, length: [4, 11], width: [2, 3.4], alpha: [0.26, 0.55], dl: -0.075, chroma: [0.03, 0.058] }
  ];
  const mean = (list, pick) => list.reduce((sum, item) => sum + pick(item), 0) / list.length;
  scales.forEach((scale, k) => {
    const touches = morning.touches.filter((touch) => touch.scale === k);
    assert.ok(touches.length > 0.8 * scale.count && touches.length <= scale.count, `scale ${k}: ${touches.length} of ${scale.count} placed`);
    for (const touch of touches) {
      assert.ok(touch.x >= 0 && touch.x < 1280 && touch.y >= 0 && touch.y < 900);
      assert.ok(touch.length >= scale.length[0] && touch.length <= scale.length[1]);
      assert.ok(touch.width >= scale.width[0] && touch.width <= scale.width[1]);
      assert.ok(touch.alpha >= scale.alpha[0] && touch.alpha <= scale.alpha[1]);
      assert.ok(touch.C <= scale.chroma[1] + 1e-9, "chroma never above the range (the gamut clamp can only lower it)");
      assert.ok(touch.hue >= 0 && touch.hue < 360);
    }
    assert.ok(Math.abs(mean(touches, (t) => t.L) - (0.955 + scale.dl)) < 0.004, `scale ${k} sits ${scale.dl} below the ground`);
    assert.ok(Math.abs(mean(touches, (t) => t.angle)) < 1 && mean(touches, (t) => Math.abs(t.angle)) < 8, "angles ~ N(0°, 7°)");
  });
  // Touches gather: a tenth of the page (its ten densest 128 × 90 cells) holds well over a tenth of them.
  const cells = new Map();
  for (const touch of morning.touches) {
    const key = `${Math.floor(touch.x / 128)},${Math.floor(touch.y / 90)}`;
    cells.set(key, (cells.get(key) || 0) + 1);
  }
  const densest = [...cells.values()].sort((a, b) => b - a).slice(0, 10).reduce((sum, n) => sum + n, 0);
  assert.ok(densest / morning.touches.length >= 0.2, `the densest tenth holds ${Math.round((densest / morning.touches.length) * 100)}%`);
  // Dusk: the same drifts and the same touch positions from the same seed, lightness above the water.
  const dusk = planPond({ seed, width: 1280, height: 900, theme: "dusk", canvasL: 0.25 });
  assert.deepEqual(dusk.drifts, morning.drifts);
  assert.deepEqual(dusk.touches.map((t) => [t.x, t.y]), morning.touches.map((t) => [t.x, t.y]), "one seed, one structure on every surface");
  [0.07, 0.135, 0.165].forEach((dl, k) => {
    const touches = dusk.touches.filter((touch) => touch.scale === k);
    assert.ok(Math.abs(mean(touches, (t) => t.L) - (0.25 + dl)) < 0.004, `Dusk scale ${k} sits ${dl} above the water`);
  });
  // Counts follow the area: the popup gets three drifts and a fraction of the touches.
  const popup = planPond({ seed, width: 372, height: 600, theme: "morning", canvasL: 0.955 });
  assert.equal(popup.drifts.length, 3);
  assert.ok(popup.touches.length < 0.25 * morning.touches.length && popup.touches.length > 400, `popup touches ${popup.touches.length}`);
});

test("the content mask is 0 under a box and feathers to 1 over 64 px outside its edge, corners rounded, overlaps multiplied", () => {
  const box = [{ x: 100, y: 60, width: 100, height: 40 }];
  assert.equal(maskFactor(box, 150, 80), 0, "inside the box");
  assert.equal(maskFactor(box, 100, 60), 0, "on its edge");
  assert.equal(maskFactor(box, 150, 132), 0.5, "halfway through the feather below");
  assert.equal(maskFactor(box, 68, 80), 0.5, "halfway through the feather to the left");
  assert.equal(maskFactor(box, 150, 164), 1, "64 px out the layer is whole again");
  assert.equal(maskFactor(box, 0, 0), 1);
  assert.ok(maskFactor(box, 90, 50) > 0 && maskFactor(box, 90, 50) < 0.3, "corners are rounded: the distance to the box counts, not the two axes");
  assert.equal(maskFactor([{ x: 20, y: 20, width: 40, height: 40 }, { x: 20, y: 100, width: 40, height: 40 }], 40, 80), (20 / 64) ** 2, "between two boxes the factors multiply");
  assert.equal(maskFactor([{ x: 0, y: 0, width: 0, height: 10 }], 1, 1), 1, "an empty box masks nothing");
  // The painted mask: the box itself, four sides and four corners, cut out with destination-out.
  const calls = [];
  const ctx = {
    globalCompositeOperation: "source-over", fillStyle: "#000000",
    save() { calls.push("save"); }, restore() { calls.push("restore"); },
    fillRect(x, y, w, h) { calls.push(["fill", x, y, w, h, typeof this.fillStyle === "string" ? "solid" : this.fillStyle.kind]); },
    createLinearGradient(x0, y0, x1, y1) { return { kind: "linear", from: [x0, y0], to: [x1, y1], stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; },
    createRadialGradient(x, y, r0, _x, _y, r1) { return { kind: "radial", at: [x, y], r: [r0, r1], stops: [], addColorStop(at, color) { this.stops.push([at, color]); } }; }
  };
  maskContent(ctx, [{ x: 10, y: 20, width: 30, height: 40 }], { dpr: 2 });
  assert.equal(ctx.globalCompositeOperation, "destination-out", "cut out of the layer (restore() is a stub here)");
  const fills = calls.filter((call) => call[0] === "fill");
  assert.equal(fills.length, 9, "the box, four sides, four corners");
  assert.deepEqual(fills[0], ["fill", 20, 40, 60, 80, "solid"], "the box in device px");
  assert.deepEqual(fills.slice(1, 5).map((f) => f[5]), ["linear", "linear", "linear", "linear"]);
  assert.deepEqual(fills.slice(5).map((f) => f[5]), ["radial", "radial", "radial", "radial"]);
  assert.deepEqual(fills[1].slice(1, 5), [20 - 128, 40, 128, 80], "the left feather reaches 64 CSS px (128 device px)");
  assert.deepEqual(fills[4].slice(1, 5), [20, 120, 60, 128], "the bottom feather");
  assert.deepEqual(fills[8].slice(1, 5), [80, 120, 128, 128], "the bottom-right corner");
  assert.deepEqual(calls[0], "save");
  assert.deepEqual(calls[calls.length - 1], "restore");
});

test("contentBoxes lists the rendered elements' boxes and leaves out hidden ones and empty status lines", () => {
  const node = (id, rect, extra = {}) => ({ id, hidden: false, textContent: "text", classList: { contains: (name) => name === extra.className }, getClientRects: () => (extra.detached ? [] : [1]), getBoundingClientRect: () => rect, ...extra });
  const nodes = [
    node("a", { left: 10, top: 20, width: 100, height: 30 }),
    node("b", { left: 0, top: 0, width: 50, height: 10 }, { hidden: true }),
    node("c", { left: 5, top: 5, width: 20, height: 20 }, { detached: true }),
    node("d", { left: 0, top: 0, width: 200, height: 44 }, { className: "status-line", textContent: "  " }),
    node("e", { left: 0, top: 0, width: 200, height: 44 }, { className: "status-line", textContent: "Local engine isn’t set up" }),
    node("f", { left: 0, top: 0, width: 0, height: 44 })
  ];
  const root = { querySelectorAll: (selector) => { assert.match(selector, /^#a, #b, dialog\[open\], \.menu-layer:not\(\[hidden\]\) > \.menu, \.toast-region > \.toast$/); return nodes; } };
  assert.deepEqual(contentBoxes(["#a", "#b"], root), [{ x: 10, y: 20, width: 100, height: 30 }, { x: 0, y: 0, width: 200, height: 44 }]);
  assert.deepEqual(contentBoxes(["#a"], null), []);
});

test("pond colour helpers: the canvas tokens read as the lightness the spec assumes", () => {
  assert.deepEqual(parseCssColor("#F4F0E9"), [244, 240, 233]);
  assert.deepEqual(parseCssColor("rgb(26, 30, 61)"), [26, 30, 61]);
  assert.equal(parseCssColor("transparent"), null);
  assert.ok(Math.abs(rgbToOklch(244, 240, 233).L - 0.955) < 0.005, "Morning canvas L 0.955");
  assert.ok(Math.abs(rgbToOklch(26, 30, 61).L - 0.25) < 0.02, "Dusk canvas L about 0.25");
  for (const [hex, hue] of [["#8FB8A3", 163], ["#7FA6C4", 242], ["#9A8CC4", 296], ["#E3AFB4", 12], ["#E7B089", 57]]) {
    const [r, g, b] = parseCssColor(hex);
    assert.ok(Math.abs(rgbToOklch(r, g, b).h - hue) < 1, `${hex} is the ${hue}° family`);
  }
});

// The v2 planner stays for the popup, side panel and Settings until v3 §5 step 2.
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
