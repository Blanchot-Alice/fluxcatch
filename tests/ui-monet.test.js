import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { DEFAULT_UI_CUSTOMIZATION } from "../extension/ui/customization.js";
import { pushSpeedSample, segmentsFromMessage, formatRate } from "../extension/ui/speed-graph.js";

const read = (relative) => readFileSync(new URL(`../extension/${relative}`, import.meta.url), "utf8");
const tokensCss = read("ui/tokens.css");
const componentsCss = read("ui/components.css");
const atmosphereCss = read("ui/atmosphere.css");
const pages = {
  "popup/popup.html": "popup.css",
  "sidepanel/sidepanel.html": "sidepanel.css",
  "options/options.html": "options.css",
  "downloads/downloads.html": "downloads.css",
  "designer/designer.html": "designer.css",
  "preview/preview.html": "preview.css"
};

test("the Monet tokens contain no pure black, pure white or neutral grey shadows", () => {
  const colourValues = [...tokensCss.matchAll(/#([\da-f]{3,8})\b/gi)].map((match) => match[1].toUpperCase());
  for (const value of colourValues) {
    assert.notEqual(value, "000000", "pure black is never a token");
    assert.notEqual(value, "000", "pure black is never a token");
    assert.notEqual(value, "FFFFFF", "pure white is never a token");
    assert.notEqual(value, "FFF", "pure white is never a token");
  }
  for (const shadow of tokensCss.matchAll(/--shadow-[\w-]+:\s*([^;]+);/g)) {
    assert.doesNotMatch(shadow[1], /rgba\(0,\s*0,\s*0/, `${shadow[0].trim()} is a coloured shadow, not neutral black`);
  }
  for (const name of ["--pond", "--lilac", "--celadon", "--ochre", "--apricot", "--rose", "--vermilion", "--harbour", "--progress-gradient", "--font-display"]) {
    assert.match(tokensCss, new RegExp(`${name}:`), `${name} is defined`);
  }
  assert.match(tokensCss, /\[data-density="compact"\]/);
  assert.match(tokensCss, /prefers-contrast:\s*more/);
});

test("the atmosphere and primitives are procedural: no raster or painted assets anywhere in the shared styles", () => {
  for (const [name, css] of [["atmosphere.css", atmosphereCss], ["components.css", componentsCss], ["tokens.css", tokensCss]]) {
    assert.doesNotMatch(css, /\.(?:png|jpe?g|gif|webp|avif)\b/i, `${name} references no raster image`);
  }
  assert.match(atmosphereCss, /feTurbulence/, "grain comes from an SVG turbulence filter");
  assert.match(atmosphereCss, /radial-gradient/, "light fields are gradients");
  assert.match(atmosphereCss, /\.fc-atmosphere::before/);
  assert.match(atmosphereCss, /prefers-reduced-motion/);
  assert.match(componentsCss, /--progress-gradient/);
  assert.match(componentsCss, /fc-ripple/);
  assert.match(componentsCss, /\.fc-reflection-copy/);
  assert.match(componentsCss, /\.fc-segments/);
  assert.match(componentsCss, /font-family:var\(--font-display\)/);
});

test("every surface loads tokens, components, atmosphere and its own sheet in that order", () => {
  for (const [page, sheet] of Object.entries(pages)) {
    const html = read(page);
    const order = ["../ui/tokens.css", "../ui/components.css", "../ui/atmosphere.css", sheet].map((href) => html.indexOf(`href="${href}"`));
    assert.ok(order.every((index) => index >= 0), `${page} loads all four stylesheets`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${page} keeps the cascade order`);
  }
});

test("the preview shows every component the brief names, in both themes, with density and motion toggles", () => {
  const html = read("preview/preview.html");
  for (const component of ["sidebar", "list-row", "active-card", "speed-graph", "add-dialog", "toasts", "empty-state", "settings", "app-icon"]) {
    assert.match(html, new RegExp(`data-component="${component}"`), `preview includes ${component}`);
  }
  assert.match(html, /data-theme="light"/);
  assert.match(html, /data-theme="dark"/);
  assert.match(html, /id="densitySelect"/);
  assert.match(html, /id="motionSelect"/);
  assert.match(html, /The pond is still\./);
  const js = read("preview/preview.js");
  assert.match(js, /fc-theme-fading/);
  assert.match(js, /dataset\.density = "compact"/);
  assert.match(js, /dataset\.motion = "reduced"/);
});

test("display and UI fonts ship with the extension under their OFL licences", () => {
  for (const file of ["ui/fonts/Fraunces-latin.woff2", "ui/fonts/IBMPlexSans-latin.woff2", "ui/fonts/IBMPlexSans-latin-ext.woff2", "ui/fonts/OFL-Fraunces.txt", "ui/fonts/OFL-IBMPlexSans.txt"]) {
    const path = new URL(`../extension/${file}`, import.meta.url);
    assert.ok(existsSync(path), `${file} is bundled`);
    assert.ok(statSync(path).size > 0, `${file} is not empty`);
  }
  assert.match(tokensCss, /@font-face\s*\{[^}]*Fraunces[^}]*fonts\/Fraunces-latin\.woff2/s);
  assert.match(tokensCss, /@font-face\s*\{[^}]*IBM Plex Sans[^}]*font-stretch: 85% 100%[^}]*fonts\/IBMPlexSans-latin\.woff2/s);
  assert.doesNotMatch(tokensCss, /https?:\/\//, "no font is fetched from the network");
});

test("the designer defaults and the shared mark follow the palette", () => {
  assert.equal(DEFAULT_UI_CUSTOMIZATION.radius, 14);
  assert.equal(DEFAULT_UI_CUSTOMIZATION.accentColor, "#3E6E92");
  const mark = read("icons/fluxcatch-mark.svg");
  for (const colour of ["#FAF7F2", "#4E7FA2", "#8FB8A3", "#E3AFB4"]) assert.match(mark, new RegExp(colour), `mark uses ${colour}`);
  for (const page of ["popup/popup.html", "sidepanel/sidepanel.html", "options/options.html", "downloads/downloads.html"]) {
    assert.match(read(page), /class="c-celadon"/, `${page} carries the lily-pad mark`);
  }
});

test("speed graph helpers keep a bounded ring and read the engine's segment messages", () => {
  const ring = [];
  for (let index = 0; index < 60; index += 1) pushSpeedSample(ring, index * 1000);
  assert.equal(ring.length, 48);
  assert.equal(ring[ring.length - 1], 59_000);
  assert.deepEqual(segmentsFromMessage("分片 12/48"), { done: 12, total: 48 });
  assert.equal(segmentsFromMessage("正在合并"), null);
  assert.equal(formatRate(2.5 * 1024 * 1024), "2.5 MB/s");
  assert.equal(formatRate(512 * 1024), "512 KB/s");
});
