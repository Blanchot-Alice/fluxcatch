// FluxCatch UI editor (a developer tool: Settings -> Lab -> Developer).
// Edits the layout values of the fluxcatch.uiCustomization.v1 record: spacing,
// width, text size, corner radius and accent. Settings applies them only while
// Developer tools is on. Copy is not editable: v2 copy is never overridden
// (rename table, §5 note); copy saved by older editors stays in the record
// untouched. The editor's own words live in ui/v2/messages/settings.js.
import { bootLocale } from "../ui/v2/locale.js";
import { msg } from "../ui/v2/messages.js";
import { brandMark } from "../ui/v2/components.js";
import { controlOf, numberField, textField } from "../ui/v2/controls.js";
import {
  COPY_FIELDS,
  DEFAULT_UI_CUSTOMIZATION,
  LAYOUT_LIMITS,
  applyUiCustomization,
  customizationExportPayload,
  loadDeveloperTools,
  loadUiCustomization,
  normalizeHex,
  normalizeUiCustomization,
  parseCustomizationJson,
  readTokenHex,
  saveUiCustomization
} from "../ui/customization.js";

const $ = (selector) => document.querySelector(selector);

// Units are message keys, so the Chinese UI reads them in Chinese.
const LAYOUT_FIELDS = Object.freeze({
  firstSecondGap: { label: "settings.designer.firstSecondGap", step: 1, unit: "settings.designer.unitPx" },
  sectionGap: { label: "settings.designer.sectionGap", step: 1, unit: "settings.designer.unitPx" },
  contentWidth: { label: "settings.designer.contentWidth", step: 10, unit: "settings.designer.unitPx" },
  fontScale: { label: "settings.designer.fontScale", step: 0.05, unit: "settings.designer.unitScale" },
  radius: { label: "settings.designer.radius", step: 1, unit: "settings.designer.unitPx" }
});

const fields = {};
let accent = "";
let stored = { ...DEFAULT_UI_CUSTOMIZATION };
let started = false;

await bootLocale();
document.addEventListener("DOMContentLoaded", () => void initialize());
if (document.readyState !== "loading") void initialize();

async function initialize() {
  if (started) return;
  started = true;
  document.title = `${msg("settings.editor.name")} · ${msg("brand.name")}`;
  for (const element of document.querySelectorAll("[data-msg]")) element.textContent = msg(element.dataset.msg);
  $("#topbarInner").prepend(brandMark({ size: "m" }));
  buildFields();
  bindEvents();
  try {
    stored = await loadUiCustomization();
    writeFields(stored);
    setStatus(msg("settings.designer.loaded"));
  } catch {
    writeFields(DEFAULT_UI_CUSTOMIZATION);
    setStatus(msg("settings.designer.loadFailed"));
  }
  try {
    $("#devState").textContent = (await loadDeveloperTools()) ? "" : msg("settings.designer.devOff");
  } catch {
    $("#devState").textContent = msg("settings.designer.devOff");
  }
}

// A field under its name. The name takes the row role (as Settings row names
// do), which keeps the page within six text styles: no label role here.
function stackedField(label, control) {
  const stack = document.createElement("div");
  stack.className = "field-stack";
  const name = document.createElement("label");
  name.className = "t-row";
  name.htmlFor = controlOf(control).id;
  name.textContent = label;
  stack.append(name, control);
  return stack;
}

function buildFields() {
  for (const [key, spec] of Object.entries(LAYOUT_FIELDS)) {
    const [min, max] = LAYOUT_LIMITS[key];
    const control = numberField({ id: `${key}Input`, name: key, min, max, step: spec.step, unit: msg(spec.unit), width: "medium" });
    fields[key] = controlOf(control);
    $("#layoutFields").append(stackedField(msg(spec.label), control));
  }
  const file = textField({ id: "jsonInput", name: "json", multiline: true, rows: 8, width: "fill", spellcheck: false, describedBy: "jsonHelp" });
  fields.json = controlOf(file);
  const help = document.createElement("p");
  help.className = "t-meta";
  help.id = "jsonHelp";
  help.textContent = msg("settings.designer.fileHelp");
  $("#fileFields").append(stackedField(msg("settings.designer.fileLabel"), file), help);
}

function bindEvents() {
  $("#designerForm").addEventListener("input", renderPreview);
  $("#designerForm").addEventListener("submit", (event) => void save(event));
  $("#accentColorInput").addEventListener("input", (event) => { accent = normalizeHex(event.target.value); renderPreview(); });
  $("#accentThemeButton").addEventListener("click", () => { accent = ""; writeAccent(); renderPreview(); });
  $("#resetButton").addEventListener("click", () => void resetDefaults());
  $("#importButton").addEventListener("click", importJson);
  $("#exportButton").addEventListener("click", exportJson);
  $("#jsonFileInput").addEventListener("change", (event) => void readJsonFile(event));
}

/** The record to store: this form's layout values; any copy already in the record is kept as it is. */
function collectFields() {
  const values = { language: stored.language || "" };
  for (const key of Object.keys(COPY_FIELDS)) values[key] = stored[key] || "";
  for (const key of Object.keys(LAYOUT_FIELDS)) values[key] = fields[key].value;
  values.accentColor = accent;
  return normalizeUiCustomization(values);
}

function writeFields(value) {
  const customization = normalizeUiCustomization(value);
  for (const key of Object.keys(LAYOUT_FIELDS)) fields[key].value = String(customization[key]);
  accent = customization.accentColor;
  writeAccent();
  renderPreview();
}

function writeAccent() {
  $("#accentColorInput").value = accent || readTokenHex("--pond") || $("#accentColorInput").value;
}

function renderPreview() {
  const preview = $("#previewCanvas");
  for (const element of preview.querySelectorAll("[data-msg]")) element.textContent = msg(element.dataset.msg);
  applyUiCustomization(collectFields(), { root: preview });
}

async function save(event) {
  event.preventDefault();
  setStatus(msg("settings.designer.saving"));
  try {
    const next = collectFields();
    stored = await saveUiCustomization(next, undefined, { language: next.language });
    writeFields(stored);
    setStatus(msg("settings.designer.saved"));
  } catch {
    setStatus(msg("settings.designer.saveFailed"));
  }
}

async function resetDefaults() {
  try {
    stored = await saveUiCustomization(DEFAULT_UI_CUSTOMIZATION);
    writeFields(stored);
    setStatus(msg("settings.designer.resetDone"));
  } catch {
    setStatus(msg("settings.designer.saveFailed"));
  }
}

function importJson() {
  clearJsonError();
  try {
    const customization = parseCustomizationJson(fields.json.value);
    writeFields(customization);
    setStatus(msg("settings.designer.imported"));
  } catch {
    showJsonError(msg("settings.designer.invalidFile"));
  }
}

function exportJson() {
  clearJsonError();
  const text = `${JSON.stringify(customizationExportPayload(collectFields()), null, 2)}\n`;
  fields.json.value = text;
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "fluxcatch-ui.json";
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  setStatus(msg("settings.designer.exported"));
}

async function readJsonFile(event) {
  clearJsonError();
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    fields.json.value = await file.text();
    importJson();
  } catch {
    showJsonError(msg("settings.designer.readFailed"));
  } finally {
    event.target.value = "";
  }
}

function setStatus(text) {
  $("#designerStatus").textContent = text;
}

function showJsonError(text) {
  const node = $("#jsonError");
  node.textContent = text;
  node.hidden = false;
}

function clearJsonError() {
  const node = $("#jsonError");
  node.textContent = "";
  node.hidden = true;
}
