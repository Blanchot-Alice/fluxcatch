// The language preference (Settings → Language) after the v1 DOM translator
// was retired: one locale source, ui/v2/locale.js. The key, the Auto rule and
// the storage round trip are unchanged from v1, so stored choices survive.
// Every page follows a switch live through bootLocale's storage listener, and
// no surface carries copy outside the v2 message modules.
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import {
  UI_LANGUAGE_STORAGE_KEY,
  bootLocale,
  getUiLanguage,
  loadUiLanguage,
  onLocaleChange,
  resolveUiLanguage,
  saveUiLanguage,
  setUiLanguage,
  uiLanguage,
  uiLocale
} from "../extension/ui/v2/locale.js";

const EXTENSION = new URL("../extension/", import.meta.url);
const read = (file) => readFileSync(new URL(file, EXTENSION), "utf8");
const CJK = /[㐀-鿿　-〿＀-￯]/;

test("the stored key is unchanged from v1, so a saved choice survives the update", () => {
  assert.equal(UI_LANGUAGE_STORAGE_KEY, "havre.uiLanguage.v1");
  assert.equal(existsSync(new URL("ui/i18n.js", EXTENSION)), false, "the v1 translator is retired");
});

test("resolveUiLanguage follows the preference, then Chrome's UI language", () => {
  assert.equal(resolveUiLanguage("en", "zh-CN"), "en");
  assert.equal(resolveUiLanguage("zh", "en-US"), "zh");
  assert.equal(resolveUiLanguage("auto", "zh-CN"), "zh");
  assert.equal(resolveUiLanguage("auto", "zh_TW"), "zh");
  assert.equal(resolveUiLanguage("auto", "en-US"), "en");
  assert.equal(resolveUiLanguage("auto", "ja"), "en");
  assert.equal(resolveUiLanguage(undefined, "en-US"), "en");
  assert.equal(resolveUiLanguage("bogus", "zh-CN"), "zh");
});

test("language preference persists through a storage-like client", async () => {
  const backed = {};
  const storage = {
    async get(key) { return key in backed ? { [key]: backed[key] } : {}; },
    async set(patch) { Object.assign(backed, patch); }
  };
  assert.equal(await loadUiLanguage(storage), "auto");
  assert.equal(await saveUiLanguage("en", storage), "en");
  assert.equal(backed[UI_LANGUAGE_STORAGE_KEY], "en");
  assert.equal(await loadUiLanguage(storage), "en");
  assert.equal(await saveUiLanguage("weird", storage), "auto");
  assert.equal(await loadUiLanguage({}), "auto", "no storage: Auto");
});

test("active language is reported and switchable", () => {
  const original = getUiLanguage();
  try {
    setUiLanguage("en");
    assert.equal(getUiLanguage(), "en");
    assert.equal(uiLanguage(), "en");
    setUiLanguage("zh");
    assert.equal(getUiLanguage(), "zh");
    assert.equal(uiLocale(), "zh-CN");
    setUiLanguage("nonsense");
    assert.equal(getUiLanguage(), "zh");
  } finally {
    setUiLanguage(original);
  }
});

test("bootLocale: Auto follows Chrome, <html lang> is set, and a switch in Settings reaches every page live", async () => {
  const listeners = [];
  const backed = { [UI_LANGUAGE_STORAGE_KEY]: "auto" };
  const storage = { async get(key) { return { [key]: backed[key] }; } };
  const savedChrome = globalThis.chrome;
  const savedDocument = globalThis.document;
  globalThis.chrome = { i18n: { getUILanguage: () => "en-GB" } };
  globalThis.document = { documentElement: { lang: "" } };
  try {
    assert.equal(await bootLocale({ storage, onChanged: { addListener: (fn) => listeners.push(fn) } }), "en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(uiLocale(), "en-GB", "Intl follows Chrome's own English");
    const heard = [];
    const stop = onLocaleChange((language) => heard.push(language));
    listeners[0]({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "zh" } }, "local");
    assert.equal(uiLanguage(), "zh");
    assert.equal(document.documentElement.lang, "zh-CN");
    listeners[0]({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "en" } }, "sync");
    assert.equal(uiLanguage(), "zh", "only chrome.storage.local carries the preference");
    listeners[0]({ unrelated: { newValue: 1 } }, "local");
    stop();
    listeners[0]({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "auto" } }, "local");
    assert.equal(uiLanguage(), "en", "Auto again follows Chrome");
    assert.deepEqual(heard, ["zh"], "listeners hear real switches until they unsubscribe");
  } finally {
    globalThis.chrome = savedChrome;
    globalThis.document = savedDocument;
    setUiLanguage("zh");
  }
});

test("Settings saves the preference through locale.js; no page or module loads the v1 translator", () => {
  const options = read("options/options.js");
  assert.match(options, /import \{[^}]*loadUiLanguage[^}]*saveUiLanguage[^}]*\} from "\.\.\/ui\/v2\/locale\.js"/);
  for (const file of ["popup/popup.js", "sidepanel/sidepanel.js", "options/options.js", "downloads/downloads.js", "preview/preview.js", "designer/designer.js", "ui/customization.js", "background.js", "ui/v2/errors.js", "ui/v2/locale.js", "ui/v2/media.js"]) {
    assert.doesNotMatch(read(file), /ui\/i18n\.js|\.\.\/i18n\.js|applyDomI18n|bindUiI18n|translateMessage/, `${file} loads no v1 translator`);
  }
});

test("no surface HTML or JS carries copy outside the v2 message modules", () => {
  for (const file of ["popup/popup.html", "sidepanel/sidepanel.html", "options/options.html", "downloads/downloads.html", "preview/preview.html", "designer/designer.html"]) {
    assert.ok(!CJK.test(read(file).replace(/<!--[\s\S]*?-->/g, "")), `${file}: copy comes from data-msg keys`);
  }
  for (const file of ["popup/popup.js", "sidepanel/sidepanel.js", "sidepanel/refresh-guard.js", "options/options.js", "options/form-state.js", "options/native-recovery.js", "downloads/downloads.js", "preview/preview.js", "designer/designer.js", "ui/customization.js"]) {
    const source = read(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    assert.ok(!CJK.test(source), `${file}: no CJK outside messages/*.js`);
  }
});
