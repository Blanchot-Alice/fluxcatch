#!/usr/bin/env node
// Build the Chinese Display subset (design review §4): Noto Serif SC cut down to
// the glyphs of fixed Display strings only (page titles, empty-state sentences).
// Dynamic content never uses the Display face, so the subset stays complete.
//
//   NOTO_SERIF_SC_SRC=/path/NotoSerifSC[wght].ttf PYFTSUBSET=/path/pyftsubset \
//     node scripts/build-display-font.mjs
//
// Source font: https://github.com/google/fonts/tree/main/ofl/notoserifsc (OFL).
// pyftsubset comes from `pip install fonttools brotli`.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DISPLAY_KEYS, MESSAGES } from "../extension/ui/v2/messages.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FONTS = path.join(ROOT, "extension", "ui", "fonts");
const OUTPUT = path.join(FONTS, "NotoSerifSC-display.woff2");
const GLYPHS = path.join(FONTS, "NotoSerifSC-display.txt");
const CJK = /[　-〿一-鿿＀-￯]/u;

export function displayGlyphs() {
  const chars = new Set();
  for (const key of DISPLAY_KEYS) {
    const value = MESSAGES.zh[key];
    if (typeof value !== "string") throw new Error(`Display string ${key} must be a fixed string`);
    for (const ch of value) if (CJK.test(ch)) chars.add(ch);
  }
  return [...chars].sort().join("");
}

function main() {
  const source = process.env.NOTO_SERIF_SC_SRC || path.join(process.env.TMPDIR || os.tmpdir(), "fontsrc", "NotoSerifSC-wght.ttf");
  const tool = process.env.PYFTSUBSET || "pyftsubset";
  if (!fs.existsSync(source)) throw new Error(`Noto Serif SC source not found at ${source}; set NOTO_SERIF_SC_SRC`);
  const glyphs = displayGlyphs();
  const textFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "fc-display-")), "glyphs.txt");
  fs.writeFileSync(textFile, glyphs);
  const result = spawnSync(tool, [
    source,
    `--text-file=${textFile}`,
    `--output-file=${OUTPUT}`,
    "--flavor=woff2",
    "--layout-features=*",
    "--no-hinting",
    "--desubroutinize",
    "--name-IDs=*",
    "--name-legacy",
    "--name-languages=*"
  ], { stdio: "inherit" });
  if (result.status !== 0) throw new Error(`pyftsubset failed (${result.status ?? result.error?.message})`);
  fs.writeFileSync(GLYPHS, `${glyphs}\n`);
  console.log(`wrote ${path.relative(ROOT, OUTPUT)} (${fs.statSync(OUTPUT).size} bytes, ${[...glyphs].length} glyphs)`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
