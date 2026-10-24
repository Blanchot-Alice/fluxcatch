// The Monet palette and its assets on the v2 system (design review §4, §8,
// §6.10). Ported from the v1 checks that guarded behaviour and privacy:
// coloured (never neutral) shadows, no pure black or white, procedural
// atmosphere with no raster art, fonts bundled with their licences and never
// fetched, the mark's palette, and the engine's parts-progress reading. The v1
// sheets, preview markup and inline marks they also pinned are retired.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { DEFAULT_UI_CUSTOMIZATION } from "../extension/ui/customization.js";
import { segmentsFromActivity } from "../extension/lib/job-failure.js";
import { formatRate, setUiLanguage } from "../extension/ui/v2/locale.js";
import { SPEED_SAMPLES, recordSpeedSample } from "../extension/ui/v2/jobs.js";

const read = (relative) => readFileSync(new URL(`../extension/${relative}`, import.meta.url), "utf8");
const tokensCss = read("ui/v2/tokens.css");
const sharedCss = [["tokens.css", tokensCss], ["system.css", read("ui/v2/system.css")], ["media.css", read("ui/v2/media.css")]];

test("the Monet tokens contain no pure black, pure white or neutral grey shadows", () => {
  for (const match of tokensCss.matchAll(/#([\da-f]{3,8})\b/gi)) {
    const value = match[1].toUpperCase();
    assert.ok(!["000", "000000", "FFF", "FFFFFF"].includes(value), `#${value} is never a token`);
  }
  for (const shadow of tokensCss.matchAll(/--shadow-[\w-]+:\s*([^;]+);/g)) {
    assert.doesNotMatch(shadow[1], /rgba\(0,\s*0,\s*0/, `${shadow[0].trim()} is a coloured shadow, not neutral black`);
  }
  for (const name of ["--pond", "--lilac", "--celadon", "--ochre", "--apricot", "--rose", "--vermilion", "--harbour", "--font-display"]) {
    assert.match(tokensCss, new RegExp(`${name}:`), `${name} is defined`);
  }
  assert.match(tokensCss, /\[data-density="compact"\]/);
  assert.match(read("ui/v2/system.css"), /prefers-contrast:\s*more/);
});

test("the atmosphere is procedural: no raster or painted assets in the shared styles", () => {
  for (const [name, css] of sharedCss) {
    assert.doesNotMatch(css, /\.(?:png|jpe?g|gif|webp|avif)\b/i, `${name} references no raster image`);
  }
  const pond = read("ui/v2/pond.js");
  assert.match(pond, /export function planPond/, "the pond is drawn from planned touches");
  assert.doesNotMatch(pond, /\.(?:png|jpe?g|gif|webp|avif)\b|fetch\(/i, "and never loads an image");
});

test("display and UI fonts ship with the extension under their OFL licences and are never fetched", () => {
  const fonts = ["Fraunces-latin.woff2", "OFL-Fraunces.txt", "InstrumentSans-latin.woff2", "InstrumentSans-latin-ext.woff2", "OFL-InstrumentSans.txt", "NotoSerifSC-display.woff2", "OFL-NotoSerifSC.txt"];
  for (const file of fonts) {
    const path = new URL(`../extension/ui/fonts/${file}`, import.meta.url);
    assert.ok(existsSync(path), `${file} is bundled`);
    assert.ok(statSync(path).size > 0, `${file} is not empty`);
  }
  assert.match(tokensCss, /@font-face\s*\{[^}]*"Fraunces"[^}]*fonts\/Fraunces-latin\.woff2/s);
  assert.match(tokensCss, /@font-face\s*\{[^}]*"Instrument Sans"[^}]*fonts\/InstrumentSans-latin\.woff2/s);
  assert.match(tokensCss, /@font-face\s*\{[^}]*"Noto Serif SC"[^}]*fonts\/NotoSerifSC-display\.woff2/s);
  for (const file of readdirSync(new URL("../extension/ui/fonts/", import.meta.url))) {
    assert.doesNotMatch(file, /IBMPlex/, `${file}: the v1 face is retired`);
  }
  // No surface asks a font service for anything.
  for (const page of ["popup/popup.html", "sidepanel/sidepanel.html", "options/options.html", "downloads/downloads.html", "preview/preview.html", "designer/designer.html"]) {
    assert.doesNotMatch(read(page), /https?:\/\/|fonts\.googleapis|fonts\.gstatic/, `${page} loads nothing remote`);
  }
  for (const [name, css] of sharedCss) assert.doesNotMatch(css, /https?:\/\//, `${name}: no font is fetched from the network`);
});

test("the designer defaults follow the v2 shape and the shared mark keeps the palette", () => {
  assert.equal(DEFAULT_UI_CUSTOMIZATION.radius, 10, "the v2 panel radius");
  assert.equal(DEFAULT_UI_CUSTOMIZATION.accentColor, "", "the accent defaults to the theme's own --pond");
  const mark = read("icons/fluxcatch-mark.svg");
  const morning = (name) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokensCss)?.[1];
  for (const colour of ["#FAF7F2", morning("--pond"), morning("--celadon"), morning("--rose")]) assert.match(mark, new RegExp(colour), `mark uses ${colour}`);
  // The BrandMark draws the same lily pad from classes, never colour literals.
  const components = read("ui/v2/components.js");
  assert.match(components, /class="logo-pad"/);
  assert.doesNotMatch(components, /#[0-9A-Fa-f]{6}\b/);
});

test("the speed graph keeps a bounded ring of the newest samples, fed only while downloading", () => {
  assert.equal(SPEED_SAMPLES, 48);
  const ring = [];
  for (let i = 1; i <= 60; i += 1) recordSpeedSample(ring, { status: "downloading", speed: i });
  assert.equal(ring.length, 48);
  assert.equal(ring.at(-1), 60, "the newest sample is kept");
  assert.equal(ring[0], 13, "the oldest samples are dropped first");
  recordSpeedSample(ring, { status: "paused", speed: 99 });
  assert.equal(ring.at(-1), 60, "no sample while paused");
  recordSpeedSample(ring, { status: "downloading", speed: -5 });
  assert.equal(ring.at(-1), 0, "a negative speed is clamped");
  // Both speed graphs feed through the one helper; neither keeps its own cap.
  for (const file of ["downloads/downloads.js", "ui/v2/media.js"]) {
    const source = read(file);
    assert.match(source, /recordSpeedSample\(/, `${file} records speed through jobs.js`);
    assert.doesNotMatch(source, /ring\.push|SPEED_SAMPLES/, `${file} keeps no ring of its own`);
  }
});

test("the engine's parts progress is read from its activity text; rates are decimal", () => {
  assert.deepEqual(segmentsFromActivity("分片 12/48"), { done: 12, total: 48 });
  assert.equal(segmentsFromActivity("正在合并"), null);
  assert.equal(segmentsFromActivity("分片 49/48"), null, "never more parts done than exist");
  setUiLanguage("en");
  globalThis.chrome = { i18n: { getUILanguage: () => "en-US" } };
  try {
    assert.equal(formatRate(2.5e6), "2.5 MB/s");
    assert.equal(formatRate(512e3), "512 kB/s");
  } finally {
    delete globalThis.chrome;
  }
});
