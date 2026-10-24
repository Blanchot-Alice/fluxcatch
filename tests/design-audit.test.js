// The design audit's pure parts (scripts/design-audit.mjs and
// scripts/lib/pond-metrics.mjs): the v3 §3.1 pond acceptance, the §3.6 header
// strip, the per-screen verdict and the report.
import test from "node:test";
import assert from "node:assert/strict";
import { JUDGED_MARGIN_MIN, POND_BAND, headerStrip, parseRgb, pondMetrics, pondVerdict } from "../scripts/lib/pond-metrics.mjs";
import { DEFAULT_POND_SEED, SWEEP_SEEDS, judge, markdown } from "../scripts/design-audit.mjs";
import { pageAudit } from "../scripts/lib/page-audit.mjs";

const CANVAS = [244, 240, 233]; // Morning --canvas
function image(width, height, fill = CANVAS) {
  const pixels = new Uint8Array(width * height * 4);
  for (let i = 0; i < width * height; i += 1) pixels.set([...fill, 255], i * 4);
  return { width, height, pixels };
}
function paint(img, x0, y0, x1, y1, rgb) {
  for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) img.pixels.set([...rgb, 255], (y * img.width + x) * 4);
}

test("pondMetrics: the canvas alone is 0% coverage and 0 ΔL", () => {
  const a = image(200, 100);
  const b = image(200, 100);
  const m = pondMetrics(a, b, { column: null, right: 100 }, { dpr: 2, step: 1 });
  assert.equal(m.region, "frame");
  assert.equal(m.coverage, 0);
  assert.equal(m.p95DeltaL, 0);
  assert.equal(m.footprint, 0);
  assert.equal(m.sampled, 200 * 100);
});

test("pondMetrics: coverage counts chroma over the step inside the margins only, p95 is over the region", () => {
  // 100 CSS px wide at DPR 2 = 200 device px; column 30..70 CSS px; margins 60 CSS px.
  const a = image(200, 100);
  const b = image(200, 100);
  // A celadon wash on the left margin's top half (device px 0..60 × 0..50): same L as the canvas, more chroma.
  paint(a, 0, 0, 60, 50, [214, 246, 226]);
  // Chroma inside the column must not count.
  paint(a, 80, 0, 120, 100, [214, 246, 226]);
  const m = pondMetrics(a, b, { column: { left: 30, right: 70 }, right: 100 }, { dpr: 2, step: 1 });
  assert.equal(m.region, "margins");
  // Margin device px: x in [0, 60) and (140, 200), so 60 + 59 columns × 100 rows.
  assert.equal(m.sampled, (60 + 59) * 100);
  assert.ok(Math.abs(m.coverage - (3000 / 11900) * 100) < 0.2, `coverage ${m.coverage}`);
  assert.equal(m.footprint, m.coverage);
  assert.ok(m.p95DeltaL < POND_BAND.p95.morning, `p95 ${m.p95DeltaL}`);
});

test("pondMetrics: a lightness change shows in p95 |ΔL| and volatile rects are skipped", () => {
  const a = image(100, 100);
  const b = image(100, 100);
  paint(a, 0, 0, 100, 100, [200, 196, 190]); // darker everywhere
  const whole = pondMetrics(a, b, { column: null, right: 50 }, { dpr: 2, step: 1 });
  assert.ok(whole.p95DeltaL > 0.1, `p95 ${whole.p95DeltaL}`);
  const skipped = pondMetrics(a, b, { column: null, right: 50, skip: [{ l: 0, t: 0, r: 49.5, b: 49.5 }] }, { dpr: 2, step: 1 });
  assert.equal(skipped.sampled, 0);
  assert.equal(pondMetrics(a, image(90, 100), {}), null);
});

test("pondVerdict: the band and the theme's p95 limit on judged screens, the mask rule everywhere", () => {
  const ok = { coverage: 5, p95DeltaL: 0.02 };
  assert.deepEqual(pondVerdict(ok, { theme: "morning", judged: true }), { judged: true, pass: true, reasons: [] });
  assert.ok(pondVerdict({ coverage: 3.4, p95DeltaL: 0.02 }, { theme: "morning", judged: true }).pass, "3.4% clears the 3% floor");
  assert.ok(!pondVerdict({ coverage: 2.4, p95DeltaL: 0.02 }, { theme: "morning", judged: true }).pass);
  assert.ok(!pondVerdict({ coverage: 12.5, p95DeltaL: 0.02 }, { theme: "morning", judged: true }).pass);
  assert.ok(!pondVerdict({ coverage: 5, p95DeltaL: 0.04 }, { theme: "morning", judged: true }).pass, "0.04 fails Morning");
  assert.ok(pondVerdict({ coverage: 5, p95DeltaL: 0.04 }, { theme: "dusk", judged: true }).pass, "0.04 passes Dusk");
  assert.ok(pondVerdict({ coverage: 0.3, p95DeltaL: 0.01 }, { theme: "morning", judged: false }).pass, "reported screens are not judged on the band");
  const under = pondVerdict(ok, { theme: "morning", judged: false, underText: 2 });
  assert.ok(!under.pass);
  assert.match(under.reasons[0], /under 2 text nodes/);
  assert.equal(JUDGED_MARGIN_MIN, 48);
});

test("headerStrip: the header outside its content box must be the canvas", () => {
  const img = image(200, 60); // 100 × 30 CSS px at DPR 2
  const canvas = { r: 244, g: 240, b: 233 };
  const header = { x: 0, y: 0, width: 100, height: 20 };
  const content = [{ x: 20, y: 0, width: 60, height: 20 }];
  paint(img, 40, 0, 160, 40, [20, 20, 20]); // text inside the inner column
  assert.deepEqual(headerStrip(img, { header, content, canvas, dpr: 2 }), { sampled: 40 * 40 + 40 * 40, stray: 0, worst: 0 });
  paint(img, 0, 36, 200, 40, [236, 232, 225]); // a faint band's lower edge across the whole header
  const strayed = headerStrip(img, { header, content, canvas, dpr: 2 });
  assert.equal(strayed.stray, 4 * 40 * 2);
  assert.equal(strayed.worst, 8);
  assert.equal(headerStrip(img, { header: null, canvas }), null);
});

test("parseRgb reads Chrome's computed colours", () => {
  assert.deepEqual(parseRgb("rgb(244, 240, 233)"), { r: 244, g: 240, b: 233, a: 1 });
  assert.deepEqual(parseRgb("rgba(26, 30, 61, 0.5)"), { r: 26, g: 30, b: 61, a: 0.5 });
  assert.equal(parseRgb("transparent"), null);
});

function screen(overrides = {}) {
  return {
    id: "downloads-1280", surface: "downloads", theme: "morning", lang: "en", width: 1280, height: 900,
    textStyles: [], display: { excludingBrand: 0, samples: [] }, edges: [], nesting: { violations: [], maxDepth: 0 },
    contrast: { checked: 10, failures: [], uncertain: [], pondUnderText: [] },
    clipping: { clipped: [], coveredAtRest: [], focusObscured: [], dialogActions: [] }, locale: { leaks: [] }, rules: [],
    filenames: { endTruncated: [] }, screenshot: "shots/x.png",
    pond: { present: true, judged: true, margins: 200, underText: 0, metrics: { region: "margins", coverage: 5.2, p95DeltaL: 0.021, meanDeltaL: 0.003, footprint: 28, sampled: 1 }, verdict: { judged: true, pass: true, reasons: [] } },
    header: { present: true, scrollY: 0, backgroundAlpha: 0, boxShadow: "none", band: { opacity: 0, backgroundAlpha: 0.75, boxShadow: "none" }, rect: { x: 0, y: 0, width: 1280, height: 64 }, content: [], modal: false, problems: [], strip: { sampled: 100, stray: 0, worst: 0 } },
    ...overrides
  };
}

test("judge: the pond and header checks sit beside the budgets", () => {
  const good = judge(screen());
  assert.deepEqual(good.pond, { value: 0, budget: 0, pass: true });
  assert.deepEqual(good.header, { value: 0, budget: 0, pass: true });
  const bad = judge(screen({
    pond: { present: true, judged: true, margins: 200, underText: 1, metrics: { coverage: 2, p95DeltaL: 0.05 }, verdict: pondVerdict({ coverage: 2, p95DeltaL: 0.05 }, { theme: "morning", judged: true, underText: 1 }) },
    header: { present: true, problems: ["::before shows a band (opacity 1, background alpha 0.75)"], strip: { sampled: 10, stray: 3, worst: 9 } }
  }));
  assert.equal(bad.pond.value, 3);
  assert.equal(bad.pond.pass, false);
  assert.deepEqual(bad.header, { value: 2, budget: 0, pass: false });
  assert.equal(judge(screen({ pond: { present: false }, header: { present: false } })).pond, undefined);
});

test("markdown: the report names the seed, the band, the sweep and the header column", () => {
  const judged = screen();
  judged.pond.sweep = { width: 1280, height: 900, margins: { left: 200, right: 1080 }, seeds: SWEEP_SEEDS.map((seed, i) => ({ seed, coverage: i === 1 ? 2.9 : 6, p95DeltaL: 0.02 })) };
  const reported = screen({ id: "popup-media", surface: "popup", pond: { present: true, judged: false, margins: 0, underText: 0, metrics: { region: "frame", coverage: 1.1, p95DeltaL: 0.024, meanDeltaL: 0.007, footprint: 12, sampled: 1 }, verdict: { judged: false, pass: true, reasons: [] } } });
  const failing = screen({ id: "settings-1280", theme: "dusk", pond: { present: true, judged: true, margins: 200, underText: 0, metrics: { region: "margins", coverage: 2.4, p95DeltaL: 0.044, meanDeltaL: 0.006, footprint: 29, sampled: 1 }, verdict: pondVerdict({ coverage: 2.4, p95DeltaL: 0.044 }, { theme: "dusk", judged: true }) }, header: { present: true, scrollY: 0, backgroundAlpha: 0, boxShadow: "none", band: { opacity: 1, backgroundAlpha: 0.75, boxShadow: "rgba(0, 0, 0, 0.1) 0px 1px 2px 0px" }, rect: {}, content: [], modal: false, problems: ["::before shows a band (opacity 1, background alpha 0.75)"], strip: { sampled: 10, stray: 10, worst: 12 } } });
  const screens = [judged, reported, failing].map((s) => ({ ...s, checks: judge(s) }));
  const text = markdown({ label: "t", startedAt: "now", commit: "abc1234", extensionDir: "extension", pondSeed: DEFAULT_POND_SEED, budgets: {}, appWidePerLanguage: { en: 7 }, appWideStyles: [], literals: [], screens });
  assert.match(text, /pond seed 0x5EED1E5/);
  assert.match(text, /coverage 3% to 12%/);
  assert.match(text, /\| pond \| header \|/);
  assert.match(text, /\| 5\.2% · 0\.021 \| ✓ \|/, "a judged pass reads coverage · p95");
  assert.match(text, /\| \(1\.1% · 0\.024\) \| ✓ \|/, "a reported screen is in parentheses");
  assert.match(text, /\*\*2\.4% · 0\.044 ✗\*\* \| \*\*2 ✗\*\* \|/, "failures are marked");
  assert.match(text, /## Pond acceptance \(§3\.1\), judged screens/);
  assert.match(text, /\| settings-1280 \| dusk \| en \| 200 px \| 2\.4% \| 0\.044 \| 0\.006 \| 0 \| coverage 2\.4% under 3% \|/);
  assert.match(text, /## Pond seed sweep/);
  assert.match(text, /\| 0xF1C4C7 \| 2\.9% ✗ \| 0\.02 \|/);
  assert.match(text, /morning: 15 of 16 seeds inside the band unmasked/);
  assert.match(text, /## Header at scroll 0 \(§3\.6\)/);
  assert.match(text, /- settings-1280 · dusk · en: ::before shows a band .*; 10 stray px/);
  assert.match(text, /Screens audited: 3; screens meeting every budget: 2\./);
});

test("pageAudit stays self-contained and carries the pond and header measurements", () => {
  const source = pageAudit.toString();
  assert.match(source, /pondUnder\(rect\)/);
  assert.match(source, /pondUnderText/);
  assert.match(source, /result\.header = \{/);
  assert.match(source, /getComputedStyle\(topbar, name\)/);
  // No reference to module scope: every identifier the function uses it defines or gets from the page.
  assert.doesNotMatch(source, /\bPOND_BAND\b|\bJUDGED_MARGIN_MIN\b|\bimport\(/);
});
