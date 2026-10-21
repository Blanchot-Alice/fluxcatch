import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COPY_FIELDS,
  DEFAULT_UI_CUSTOMIZATION,
  DEVELOPER_TOOLS_STORAGE_KEY,
  UI_CUSTOMIZATION_STORAGE_KEY,
  applyUiCustomization,
  bindUiCustomization,
  clearUiCustomization,
  customizationExportPayload,
  loadDeveloperTools,
  loadUiCustomization,
  normalizeUiCustomization,
  parseCustomizationJson,
  saveDeveloperTools,
  saveUiCustomization
} from "../extension/ui/customization.js";

function memoryStorage() {
  const records = {};
  const listeners = [];
  return {
    records,
    listeners,
    async get(key) { return { [key]: records[key] }; },
    async set(value) {
      const changes = {};
      for (const [key, next] of Object.entries(value)) { changes[key] = { oldValue: records[key], newValue: next }; records[key] = next; }
      for (const listener of listeners) listener(changes, "local");
    },
    onChanged: { addListener(listener) { listeners.push(listener); }, removeListener() {} }
  };
}

function fakeRoot() {
  const props = new Map();
  return { props, style: { setProperty(name, value) { props.set(name, value); }, removeProperty(name) { props.delete(name); } } };
}

function fakeCopyRoot(ids) {
  const nodes = Object.fromEntries(ids.map((id) => [id, { textContent: `default ${id}` }]));
  return { nodes, querySelectorAll(selector) { const id = selector.match(/data-ui-copy="([^"]+)"/)?.[1]; return nodes[id] ? [nodes[id]] : []; } };
}

test("defaults equal the v2 tokens and carry no colour literal", () => {
  assert.equal(DEFAULT_UI_CUSTOMIZATION.accentColor, "", "the default accent is the theme's --pond, read at runtime");
  assert.equal(DEFAULT_UI_CUSTOMIZATION.contentWidth, 680);
  assert.equal(DEFAULT_UI_CUSTOMIZATION.radius, 10);
  for (const key of Object.keys(COPY_FIELDS)) assert.equal(DEFAULT_UI_CUSTOMIZATION[key], "", `${key} has no default copy`);
  const source = readFileSync(new URL("../extension/ui/customization.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["'`]#[0-9a-f]{3,8}["'`]/i, "no hex colour strings");
});

test("normalization bounds layout values, validates the accent and keeps copy only with its language", () => {
  const normalized = normalizeUiCustomization({
    firstSecondGap: -4, sectionGap: 999, contentWidth: 1200, fontScale: 0.2, radius: 60,
    accentColor: "#abcdef", language: "en", pageTitle: "  My   settings  "
  });
  assert.equal(normalized.firstSecondGap, 0);
  assert.equal(normalized.sectionGap, 96);
  assert.equal(normalized.contentWidth, 920);
  assert.equal(normalized.fontScale, 0.85);
  assert.equal(normalized.radius, 28);
  assert.equal(normalized.accentColor, "#ABCDEF");
  assert.equal(normalized.pageTitle, "My settings");
  assert.equal(normalizeUiCustomization({ accentColor: "not-a-colour" }).accentColor, "");
  const legacy = normalizeUiCustomization({ pageTitle: "v1 title", radius: 14 });
  assert.equal(legacy.pageTitle, "", "a v1 record (no language) loses its copy");
  assert.equal(legacy.radius, 14, "but keeps its layout values");
});

test("records and the Developer tools switch persist under their own keys; Developer tools is off by default", async () => {
  const storage = memoryStorage();
  assert.equal(await loadDeveloperTools(storage), false);
  await saveDeveloperTools(true, storage);
  assert.equal(storage.records[DEVELOPER_TOOLS_STORAGE_KEY], true);
  const saved = await saveUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, radius: 22, pageTitle: "Prefs" }, storage, { language: "en" });
  assert.equal(saved.language, "en");
  assert.deepEqual(storage.records[UI_CUSTOMIZATION_STORAGE_KEY], saved);
  assert.deepEqual(await loadUiCustomization(storage), saved);
});

test("applying sets only changed layout properties, never touches copy in any language, and clears cleanly", () => {
  const root = fakeRoot();
  const copy = fakeCopyRoot(["settings-title", "status-title"]);
  applyUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, sectionGap: 25, accentColor: "#F4D35E", language: "zh", pageTitle: "Custom" }, { root, copyRoot: copy, language: "zh" });
  assert.equal(root.props.get("--settings-section-gap"), "25px");
  assert.equal(root.props.get("--pond"), "#F4D35E");
  assert.match(root.props.get("--tint-pond"), /^color-mix\(in srgb, #F4D35E 12%, transparent\)$/);
  assert.equal(root.props.has("--content-max"), false, "an unchanged width leaves the token alone");
  applyUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, language: "en", pageTitle: "Custom" }, { root, copyRoot: copy, language: "en" });
  assert.equal(copy.nodes["settings-title"].textContent, "default settings-title", "saved copy never replaces v2 copy, in its own language either");
  assert.equal(root.props.has("--pond"), false, "re-applying clears the previous accent");
  clearUiCustomization({ root });
  assert.equal(root.props.size, 0);
  const source = readFileSync(new URL("../extension/ui/customization.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /data-ui-copy="\$\{/, "no copy is written into the page");
});

test("a font scale also reaches the Chinese line heights that tokens.css sets under :lang(zh)", () => {
  const appended = [];
  const removed = [];
  const head = { append(node) { appended.push(node); } };
  const doc = {
    head,
    createElement(tag) {
      const node = { tag, attributes: {}, setAttribute(k, v) { this.attributes[k] = v; }, remove() { removed.push(this); }, hidden: false, textContent: "" };
      return node;
    }
  };
  const attributes = {};
  const root = { ...fakeRoot(), ownerDocument: doc, append() {}, setAttribute(k, v) { attributes[k] = v; }, removeAttribute(k) { delete attributes[k]; } };
  const previous = globalThis.getComputedStyle;
  globalThis.getComputedStyle = (element) => ({
    getPropertyValue(name) {
      const zh = element.attributes?.lang === "zh";
      const table = { "--row-size": "13px", "--row-line": zh ? "22px" : "20px", "--body-size": "13px", "--body-line": zh ? "22px" : "20px", "--meta-size": "12px", "--meta-line": zh ? "20px" : "18px" };
      return table[name] || "";
    }
  });
  try {
    applyUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, fontScale: 1.3 }, { root });
  } finally {
    globalThis.getComputedStyle = previous;
  }
  const style = appended.find((node) => node.tag === "style");
  assert.ok(style, "one generated rule");
  const id = attributes["data-ui-type-scale"];
  assert.ok(id);
  assert.match(style.textContent, new RegExp(`\\[data-ui-type-scale="${id}"\\] \\{[^}]*--row-size: 17px;[^}]*--row-line: 26px;`));
  assert.match(style.textContent, new RegExp(`\\[data-ui-type-scale="${id}"\\] :lang\\(zh\\) \\{[^}]*--row-line: 29px;[^}]*--meta-line: 26px;`));
  assert.equal(root.props.has("--row-line"), false, "type tokens are not set inline, where :lang(zh) would undo them");
  clearUiCustomization({ root });
  assert.ok(removed.includes(style), "clearing removes the rule");
  assert.equal(attributes["data-ui-type-scale"], undefined);
});

test("binding applies the record only while Developer tools is on", async () => {
  const storage = memoryStorage();
  await saveUiCustomization({ ...DEFAULT_UI_CUSTOMIZATION, sectionGap: 30 }, storage);
  const root = fakeRoot();
  const seen = [];
  const binding = await bindUiCustomization({ root, copyRoot: fakeCopyRoot([]), storage, changeSource: storage.onChanged, language: () => "en", onChange: (state) => seen.push(state.enabled) });
  assert.equal(binding.isEnabled(), false);
  assert.equal(root.props.size, 0, "off: nothing applied");
  await saveDeveloperTools(true, storage);
  assert.deepEqual(seen, [true]);
  binding.refresh();
  assert.equal(root.props.get("--settings-section-gap"), "30px");
  await saveDeveloperTools(false, storage);
  binding.refresh();
  assert.equal(root.props.size, 0);
});

test("JSON export wraps the record; import accepts wrapped and bare records and rejects anything else by code", () => {
  const payload = customizationExportPayload({ ...DEFAULT_UI_CUSTOMIZATION, contentWidth: 800 });
  assert.equal(payload.schemaVersion, 2);
  assert.equal(parseCustomizationJson(JSON.stringify(payload)).contentWidth, 800);
  assert.equal(parseCustomizationJson(JSON.stringify({ radius: 11 })).radius, 11);
  assert.throws(() => parseCustomizationJson("[]"), (error) => error.code === "invalid_customization");
  assert.throws(() => parseCustomizationJson("{nope"), (error) => error.code === "invalid_customization");
});

test("the UI editor is on v2, edits layout only, keeps preview, storage, import and export, and links back to Settings", () => {
  const html = readFileSync(new URL("../extension/designer/designer.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../extension/designer/designer.js", import.meta.url), "utf8");
  assert.match(html, /id="previewCanvas"/);
  assert.match(html, /href="\.\.\/options\/options\.html"/);
  assert.match(html, /id="importButton"/);
  assert.match(html, /id="exportButton"/);
  assert.match(html, /id="jsonFileInput"/);
  assert.match(html, /id="accentColorInput"/);
  for (const name of ["saveUiCustomization", "applyUiCustomization", "parseCustomizationJson", "URL.createObjectURL", "readTokenHex(\"--pond\")", "loadDeveloperTools"]) {
    assert.ok(js.includes(name), `designer.js uses ${name}`);
  }
  for (const key of ["firstSecondGap", "sectionGap", "contentWidth", "fontScale", "radius"]) {
    assert.ok(js.includes(key), `designer edits ${key}`);
  }
  assert.doesNotMatch(html, /data-ui-copy|id="copyFields"/, "copy is no longer editable: v2 copy is never overridden");
  assert.doesNotMatch(js, /unit: "(?:px|×)"/, "units come from the message module");
  assert.equal((html.match(/btn-primary/g) || []).length, 1, "one primary button: Save and apply");
  assert.doesNotMatch(html + js, /t-label|fieldStack/, "no label role: the page keeps six text styles");
});
