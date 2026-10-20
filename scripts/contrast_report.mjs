#!/usr/bin/env node
// Contrast report for the FluxCatch tokens: every text token against every
// surface in both themes, plus the filled-control pairs. Prints a Markdown
// table and, with --write, replaces the report section in DESIGN.md.
//
//   node scripts/contrast_report.mjs [--write]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = path.join(ROOT, "extension", "ui", "tokens.css");
const DESIGN = path.join(ROOT, "DESIGN.md");

const SURFACES = ["--bg-canvas", "--surface", "--surface-raised", "--surface-cool", "--surface-sunken"];
const TEXT = {
  "--text-primary": 4.5,
  "--text-secondary": 4.5,
  "--text-muted": 4.5,
  "--pond-ink": 4.5,
  "--lilac-ink": 4.5,
  "--celadon-ink": 4.5,
  "--ochre-ink": 4.5,
  "--rose-ink": 4.5,
  "--vermilion-ink": 4.5,
  "--harbour-ink": 4.5,
  "--pond": 3,
  "--control-border": 3
};
const FILLED = [
  ["--text-on-accent", "--pond-deep", 4.5],
  ["--text-on-accent", "--celadon-deep", 4.5],
  ["--text-on-accent", "--vermilion-ink", 4.5],
  ["--text-on-accent", "--ochre-ink", 4.5]
];

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

function report() {
  const css = fs.readFileSync(TOKENS, "utf8");
  const themes = { Morning: block(css, ":root {"), Dusk: block(css, '[data-theme="dark"] {') };
  const lines = [];
  let failures = 0;
  for (const [name, vars] of Object.entries(themes)) {
    lines.push(`### ${name}`, "", `| Text | floor | ${SURFACES.map((s) => `${s} ${vars[s]}`).join(" | ")} |`, `| --- | --- | ${SURFACES.map(() => "---").join(" | ")} |`);
    for (const [token, floor] of Object.entries(TEXT)) {
      const cells = SURFACES.map((surface) => {
        const ratio = contrast(vars[token], vars[surface]);
        const ok = ratio >= floor;
        if (!ok) failures += 1;
        return `${ratio.toFixed(2)}${ok ? "" : " ✗"}`;
      });
      lines.push(`| \`${token}\` ${vars[token]} | ${floor}:1 | ${cells.join(" | ")} |`);
    }
    lines.push("", "| Filled control | ratio |", "| --- | --- |");
    for (const [text, fill, floor] of FILLED) {
      const ratio = contrast(vars[text], vars[fill]);
      const ok = ratio >= floor;
      if (!ok) failures += 1;
      lines.push(`| \`${text}\` ${vars[text]} on \`${fill}\` ${vars[fill]} | ${ratio.toFixed(2)}${ok ? "" : " ✗"} |`);
    }
    lines.push("");
  }
  lines.push(`Pairs below their floor: ${failures}.`, "");
  return { markdown: lines.join("\n"), failures };
}

const { markdown, failures } = report();
if (process.argv.includes("--write")) {
  const design = fs.readFileSync(DESIGN, "utf8");
  const start = "<!-- CONTRAST_REPORT:START -->";
  const end = "<!-- CONTRAST_REPORT:END -->";
  const from = design.indexOf(start);
  const to = design.indexOf(end);
  if (from < 0 || to < 0) throw new Error("DESIGN.md is missing the contrast report markers");
  fs.writeFileSync(DESIGN, `${design.slice(0, from + start.length)}\n${markdown}${design.slice(to)}`);
  console.log(`wrote ${path.relative(ROOT, DESIGN)}`);
}
process.stdout.write(markdown);
process.exit(failures ? 1 : 0);
