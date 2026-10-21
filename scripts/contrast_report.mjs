#!/usr/bin/env node
// Contrast report for the v2 value ladders (extension/ui/v2/tokens.css):
// every text token against every surface of Morning and Dusk, plus the filled
// primary button. Prints a Markdown table; exits 1 when a pair is below its
// floor. tests/ui-v2.test.js asserts the same floors, and the design audit
// measures the rendered pages; this script is for reading the numbers.
//
//   node scripts/contrast_report.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = path.join(ROOT, "extension", "ui", "v2", "tokens.css");

const SURFACES = ["--sunken", "--canvas", "--surface", "--raised"];
const TEXT = ["--text-primary", "--text-secondary", "--text-muted", "--pond-text", "--lilac-text", "--celadon-text", "--ochre-text", "--rose-text", "--vermilion-text", "--harbour-text"];
const FILLED = [
  ["--text-on-accent", "--primary-fill"],
  ["--text-on-accent", "--primary-fill-hover"],
  ["--text-on-accent", "--primary-fill-pressed"]
];
const FLOOR = 4.5;

function block(css, selector) {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`missing ${selector}`);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return Object.fromEntries([...css.slice(open, close).matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})/gi)].map((m) => [m[1], m[2].toUpperCase()]));
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [h, l] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (h + 0.05) / (l + 0.05);
}

const css = fs.readFileSync(TOKENS, "utf8");
const themes = { Morning: block(css, ':root,\n[data-theme="morning"] {'), Dusk: block(css, '[data-theme="dusk"] {') };
const lines = [];
let failures = 0;
const cell = (ratio) => {
  const ok = ratio >= FLOOR;
  if (!ok) failures += 1;
  return `${ratio.toFixed(2)}${ok ? "" : " (below 4.5)"}`;
};
for (const [name, vars] of Object.entries(themes)) {
  lines.push(`### ${name}`, "", `| Text | ${SURFACES.map((s) => `${s} ${vars[s]}`).join(" | ")} |`, `| --- | ${SURFACES.map(() => "---").join(" | ")} |`);
  for (const token of TEXT) lines.push(`| \`${token}\` ${vars[token]} | ${SURFACES.map((surface) => cell(contrast(vars[token], vars[surface]))).join(" | ")} |`);
  lines.push("", "| Filled control | ratio |", "| --- | --- |");
  for (const [text, fill] of FILLED) lines.push(`| \`${text}\` ${vars[text]} on \`${fill}\` ${vars[fill]} | ${cell(contrast(vars[text], vars[fill]))} |`);
  lines.push("");
}
lines.push(`Pairs below ${FLOOR}:1: ${failures}.`, "");
process.stdout.write(lines.join("\n"));
process.exit(failures ? 1 : 0);
