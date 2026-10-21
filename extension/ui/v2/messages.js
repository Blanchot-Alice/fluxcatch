// Copy for v2 surfaces, both languages side by side. Keys are stable ids;
// entries are strings or functions of params. One verb per action (§7):
// Download · Retry · Open · Show in Finder · Set up · Cancel.
//
// Ownership convention: one module per surface under ./messages/, each
// default-exporting { en, zh, display } with identical key sets in en and zh.
//   common.js    brand. action. status. job. toast. group. time.   (shared; change with care)
//   downloads.js downloads.*   media.js media.* (popup + side panel)
//   popup.js popup.*   sidepanel.js sidepanel.*   settings.js settings.*
//   preview.js preview.*   worker.js worker.*
// A surface edits only its own module. A key may live in one module only:
// this file throws at load when two modules define the same key.
import { uiLanguage } from "./locale.js";
import common from "./messages/common.js";
import downloads from "./messages/downloads.js";
import media from "./messages/media.js";
import popup from "./messages/popup.js";
import sidepanel from "./messages/sidepanel.js";
import settings from "./messages/settings.js";
import preview from "./messages/preview.js";
import worker from "./messages/worker.js";

/** Every message module by name, in merge order (read-only). */
export const MODULES = Object.freeze({ common, downloads, media, popup, sidepanel, settings, preview, worker });

/** Merge modules into one { en, zh } table and one Display list. Throws on a
 *  key defined by two modules, so parallel work can never shadow a string. */
export function mergeModules(modules) {
  const en = {};
  const zh = {};
  const display = [];
  const owner = new Map();
  for (const [name, module] of Object.entries(modules)) {
    for (const key of new Set([...Object.keys(module.en || {}), ...Object.keys(module.zh || {})])) {
      if (owner.has(key)) throw new Error(`v2 messages: duplicate key "${key}" in ${owner.get(key)} and ${name}`);
      owner.set(key, name);
    }
    Object.assign(en, module.en);
    Object.assign(zh, module.zh);
    display.push(...(module.display || []));
  }
  return { en, zh, display };
}

const MERGED = mergeModules(MODULES);
const EN = MERGED.en;
const ZH = MERGED.zh;

export const MESSAGES = Object.freeze({ en: Object.freeze(EN), zh: Object.freeze(ZH) });

/** Strings set in the Display face. Their Chinese glyphs must be in the
 *  bundled Noto Serif SC subset (scripts/build-display-font.mjs). */
export const DISPLAY_KEYS = Object.freeze(MERGED.display);

export function msg(key, params = {}) {
  const table = uiLanguage() === "en" ? EN : ZH;
  const entry = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : EN[key];
  if (entry === undefined) return key;
  return typeof entry === "function" ? entry(params) : entry;
}
