import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UI_LANGUAGE_STORAGE_KEY,
  getUiLanguage,
  loadUiLanguage,
  resolveUiLanguage,
  saveUiLanguage,
  setUiLanguage,
  translateMessage
} from "../extension/ui/i18n.js";

const EXTENSION = new URL("../extension/", import.meta.url);
const CJK = /[\u4e00-\u9fff]/;

const HTML_FILES = ["popup/popup.html", "sidepanel/sidepanel.html", "options/options.html"];
const JS_FILES = [
  "popup/popup.js",
  "sidepanel/sidepanel.js",
  "options/options.js",
  "background.js",
  "ui/customization.js",
  "ui/interactions.js",
  "lib/build-profile.js",
  "lib/dash.js",
  "lib/hls.js",
  "lib/host-public.js",
  "lib/job-presentation.js",
  "lib/network-policy.js",
  "options/form-state.js"
];

// Strings that are user content or sample data by design, not UI copy.
const TRANSLATION_EXEMPT = new Set([
  "示例视频 - 1080.mp4", // rendered file-name preview (user-content sample)
  "中文" // the language picker names languages in their own language
]);

function htmlUnits(html) {
  const stripped = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/g, "");
  const units = new Set();
  for (const match of stripped.matchAll(/(?:title|placeholder|aria-label|aria-description)="([^"]*[\u4e00-\u9fff][^"]*)"/g)) {
    units.add(match[1].trim());
  }
  for (const match of stripped.matchAll(/>([^<>]*[\u4e00-\u9fff][^<>]*)</g)) {
    const text = match[1].trim();
    if (text) units.add(text);
  }
  return units;
}

function jsLiterals(source) {
  const literals = [];
  const plausible = (value) => !value.includes("`") && !value.includes("${");
  for (const match of source.matchAll(/"([^"\n\\]*[\u4e00-\u9fff][^"\n\\]*)"/g)) {
    if (plausible(match[1])) literals.push(match[1]);
  }
  for (const match of source.matchAll(/'([^'\n\\]*[\u4e00-\u9fff][^'\n\\]*)'/g)) {
    if (plausible(match[1])) literals.push(match[1]);
  }
  for (const match of source.matchAll(/`([^`\n]*[\u4e00-\u9fff][^`\n]*)`/g)) {
    const substituted = match[1].replace(/\$\{[^}]*\}/g, "0");
    // Nested templates truncate at the first backtick and leave a dangling
    // "${" — those fragments are not real runtime strings.
    if (!substituted.includes("${")) literals.push(substituted);
  }
  return literals;
}

function assertEnglishable(literal, origin) {
  if (TRANSLATION_EXEMPT.has(literal)) return;
  if (!CJK.test(literal)) return; // interpolation probe replaced values with "0"
  const translated = translateMessage(literal, "en");
  assert.ok(
    !CJK.test(translated),
    `${origin}: untranslated copy "${literal}" (got "${translated}"); add it to EN_CATALOG or RULES in extension/ui/i18n.js`
  );
}

test("every static HTML string resolves to English", () => {
  setUiLanguage("en");
  try {
    for (const file of HTML_FILES) {
      const html = readFileSync(new URL(file, EXTENSION), "utf8");
      for (const unit of htmlUnits(html)) assertEnglishable(unit, file);
    }
  } finally {
    setUiLanguage("zh");
  }
});

test("every JS string literal resolves to English", () => {
  setUiLanguage("en");
  try {
    for (const file of JS_FILES) {
      const source = readFileSync(new URL(file, EXTENSION), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/^\s*\/\/[^\n]*$/gm, " ");
      for (const literal of jsLiterals(source)) assertEnglishable(literal, file);
    }
  } finally {
    setUiLanguage("zh");
  }
});

test("translateMessage keeps unknown and zh-mode strings untouched", () => {
  setUiLanguage("zh");
  assert.equal(translateMessage("本地下载引擎"), "本地下载引擎");
  setUiLanguage("en");
  try {
    assert.equal(translateMessage("plain english stays"), "plain english stays");
    assert.equal(translateMessage(""), "");
    assert.equal(translateMessage(null), "");
    assert.equal(translateMessage("尚未收录的文案"), "尚未收录的文案");
  } finally {
    setUiLanguage("zh");
  }
});

test("translateMessage preserves surrounding whitespace", () => {
  setUiLanguage("en");
  try {
    assert.equal(translateMessage("  设置\n"), "  Settings\n");
  } finally {
    setUiLanguage("zh");
  }
});

test("interpolation rules translate dynamic strings", () => {
  setUiLanguage("en");
  try {
    assert.equal(translateMessage("已清理 3 个已结束任务"), "Cleared 3 finished job(s)");
    assert.equal(translateMessage("已清空检测结果；2 个进行中任务保留"), "Results cleared; 2 active job(s) kept");
    assert.equal(translateMessage("12 分钟前"), "12m ago");
    assert.equal(translateMessage("3 小时前"), "3h ago");
    assert.equal(translateMessage("FluxCatch — 检测到 5 个媒体"), "FluxCatch — 5 media found");
    assert.equal(translateMessage("某视频.mp4 已保存"), "某视频.mp4 saved");
    assert.equal(translateMessage("清晰度 2"), "Quality 2");
    assert.equal(translateMessage("下载 春季音乐会"), "Download 春季音乐会");
    assert.equal(translateMessage("取消 某文件.mp4"), "Cancel 某文件.mp4");
    assert.equal(translateMessage("某文件.mp4：已完成"), "某文件.mp4: Completed");
    assert.equal(translateMessage("浏览器下载 · 下载中"), "Browser download · Downloading");
    assert.equal(translateMessage("HLS 播放列表超过变体数量上限"), "The HLS playlist exceeds the 变体数量 limit");
    assert.equal(translateMessage("网络策略已阻止 <link>（policy）"), "Blocked by network policy: <link> (policy)");
  } finally {
    setUiLanguage("zh");
  }
});

test("resolveUiLanguage follows preference then browser locale", () => {
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
});

test("active language is reported and switchable", () => {
  const original = getUiLanguage();
  try {
    setUiLanguage("en");
    assert.equal(getUiLanguage(), "en");
    setUiLanguage("zh");
    assert.equal(getUiLanguage(), "zh");
    setUiLanguage("nonsense");
    assert.equal(getUiLanguage(), "zh");
  } finally {
    setUiLanguage(original);
  }
});
