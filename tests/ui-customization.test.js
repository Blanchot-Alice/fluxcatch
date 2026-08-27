import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_UI_CUSTOMIZATION,
  UI_CUSTOMIZATION_STORAGE_KEY,
  applyUiCustomization,
  customizationExportPayload,
  loadUiCustomization,
  normalizeUiCustomization,
  parseCustomizationJson,
  saveUiCustomization
} from "../extension/ui/customization.js";

test("UI customization normalizes copy, colors and bounded layout values", () => {
  assert.deepEqual(normalizeUiCustomization({
    firstSecondGap: -4,
    sectionGap: 99,
    contentWidth: 1200,
    fontScale: 0.2,
    radius: 60,
    accentColor: "#abcdef",
    pageTitle: "  我的   设置  ",
    pageDescription: "  本机   界面  "
  }), {
    ...DEFAULT_UI_CUSTOMIZATION,
    firstSecondGap: 0,
    sectionGap: 48,
    contentWidth: 920,
    fontScale: 0.85,
    radius: 28,
    accentColor: "#ABCDEF",
    pageTitle: "我的 设置",
    pageDescription: "本机 界面"
  });
  assert.equal(normalizeUiCustomization({ accentColor: "not-a-color" }).accentColor, DEFAULT_UI_CUSTOMIZATION.accentColor);
});

test("UI customization persists only its versioned local-storage record", async () => {
  const records = {};
  const storage = {
    async get(key) { return { [key]: records[key] }; },
    async set(value) { Object.assign(records, value); }
  };
  const saved = await saveUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, radius: 22 }, storage);
  assert.equal(saved.radius, 22);
  assert.deepEqual(records[UI_CUSTOMIZATION_STORAGE_KEY], saved);
  assert.deepEqual(await loadUiCustomization(storage), saved);
});

test("UI customization applies CSS variables and editable Options copy", () => {
  const properties = new Map();
  const title = { textContent: "" };
  const description = { textContent: "" };
  const runtimeTitle = { textContent: "" };
  const root = { style: { setProperty(name, value) { properties.set(name, value); } } };
  const copyRoot = {
    querySelectorAll(selector) {
      if (selector.includes("options-title")) return [title];
      if (selector.includes("options-description")) return [description];
      if (selector.includes("runtime-title")) return [runtimeTitle];
      return [];
    }
  };
  applyUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, sectionGap: 25, accentColor: "#F4D35E", pageTitle: "自定义标题", pageDescription: "自定义说明", runtimeTitle: "自定义运行状态" }, { root, copyRoot });
  assert.equal(properties.get("--ui-section-gap"), "25px");
  assert.equal(properties.get("--primary-action"), "#F4D35E");
  assert.equal(properties.get("--on-primary"), "#000000");
  assert.equal(title.textContent, "自定义标题");
  assert.equal(description.textContent, "自定义说明");
  assert.equal(runtimeTitle.textContent, "自定义运行状态");
});

test("UI customization JSON supports wrapped exports and direct imports", () => {
  const payload = customizationExportPayload({ ...DEFAULT_UI_CUSTOMIZATION, contentWidth: 800 });
  assert.equal(payload.schemaVersion, 1);
  assert.equal(parseCustomizationJson(JSON.stringify(payload)).contentWidth, 800);
  assert.equal(parseCustomizationJson(JSON.stringify({ radius: 11 })).radius, 11);
  assert.throws(() => parseCustomizationJson("[]"), /界面配置对象/);
});

test("designer and Options expose preview, storage sync, import/export and loading recovery", () => {
  const designerHtml = readFileSync(new URL("../extension/designer/designer.html", import.meta.url), "utf8");
  const designerJs = readFileSync(new URL("../extension/designer/designer.js", import.meta.url), "utf8");
  const optionsHtml = readFileSync(new URL("../extension/options/options.html", import.meta.url), "utf8");
  const optionsJs = readFileSync(new URL("../extension/options/options.js", import.meta.url), "utf8");
  for (const name of [
    "firstSecondGap", "sectionGap", "contentWidth", "fontScale", "radius", "accentColor", "pageTitle", "pageDescription",
    "runtimeTitle", "runtimeDescription", "basicTitle", "basicDescription", "performanceTitle", "performanceDescription",
    "detectionTitle", "detectionDescription", "privacyTitle", "privacyDescription", "localTitle", "localDescription",
    "notificationsTitle", "notificationsDescription", "labTitle", "labDescription"
  ]) {
    assert.match(designerHtml, new RegExp(`name="${name}"`));
  }
  assert.match(designerHtml, /id="previewCanvas"/);
  assert.match(designerHtml, /导入并预览/);
  assert.match(designerHtml, /导出 JSON/);
  assert.match(designerJs, /saveUiCustomization/);
  assert.match(designerJs, /applyUiCustomization/);
  assert.match(designerJs, /URL\.createObjectURL/);
  assert.match(optionsHtml, /href="\.\.\/designer\/designer\.html"/);
  assert.match(optionsHtml, /id="optionsLoadState"/);
  assert.match(optionsHtml, /id="retrySettingsButton"/);
  assert.match(optionsHtml, /首次使用：下载方式、站点补全与权限/);
  assert.match(optionsJs, /bindUiCustomization/);
  assert.match(optionsJs, /form\.inert = true/);
  assert.match(optionsJs, /setOptionsLoadState\("error"/);
});
