import {
  DEFAULT_UI_CUSTOMIZATION,
  applyUiCustomization,
  customizationExportPayload,
  loadUiCustomization,
  normalizeUiCustomization,
  parseCustomizationJson,
  saveUiCustomization
} from "../ui/customization.js";

const form = document.querySelector("#designerForm");
const preview = document.querySelector("#previewCanvas");
const status = document.querySelector("#designerStatus");
const jsonInput = document.querySelector("#jsonInput");
const jsonError = document.querySelector("#jsonError");
const fields = Object.freeze({
  pageTitle: document.querySelector("#pageTitleInput"),
  pageDescription: document.querySelector("#pageDescriptionInput"),
  runtimeTitle: document.querySelector("#runtimeTitleInput"),
  runtimeDescription: document.querySelector("#runtimeDescriptionInput"),
  basicTitle: document.querySelector("#basicTitleInput"),
  basicDescription: document.querySelector("#basicDescriptionInput"),
  performanceTitle: document.querySelector("#performanceTitleInput"),
  performanceDescription: document.querySelector("#performanceDescriptionInput"),
  detectionTitle: document.querySelector("#detectionTitleInput"),
  detectionDescription: document.querySelector("#detectionDescriptionInput"),
  privacyTitle: document.querySelector("#privacyTitleInput"),
  privacyDescription: document.querySelector("#privacyDescriptionInput"),
  localTitle: document.querySelector("#localTitleInput"),
  localDescription: document.querySelector("#localDescriptionInput"),
  notificationsTitle: document.querySelector("#notificationsTitleInput"),
  notificationsDescription: document.querySelector("#notificationsDescriptionInput"),
  labTitle: document.querySelector("#labTitleInput"),
  labDescription: document.querySelector("#labDescriptionInput"),
  firstSecondGap: document.querySelector("#firstSecondGapInput"),
  sectionGap: document.querySelector("#sectionGapInput"),
  contentWidth: document.querySelector("#contentWidthInput"),
  fontScale: document.querySelector("#fontScaleInput"),
  radius: document.querySelector("#radiusInput"),
  accentColor: document.querySelector("#accentColorInput")
});

document.addEventListener("DOMContentLoaded", initialize, { once: true });

async function initialize() {
  bindEvents();
  try {
    writeFields(await loadUiCustomization());
    setStatus("界面配置已读取。预览中的更改需保存后才会应用到设置页。", "");
  } catch (error) {
    writeFields(DEFAULT_UI_CUSTOMIZATION);
    setStatus(error?.message || "读取界面配置失败，已显示默认值。", "error");
  }
}

function bindEvents() {
  form.addEventListener("input", renderPreview);
  form.addEventListener("submit", (event) => void save(event));
  document.querySelector("#resetButton").addEventListener("click", () => void resetDefaults());
  document.querySelector("#importButton").addEventListener("click", importJson);
  document.querySelector("#exportButton").addEventListener("click", exportJson);
  document.querySelector("#jsonFileInput").addEventListener("change", (event) => void readJsonFile(event));
}

function collectFields() {
  return normalizeUiCustomization(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
}

function writeFields(value) {
  const customization = normalizeUiCustomization(value);
  for (const [key, field] of Object.entries(fields)) field.value = String(customization[key]);
  renderPreview();
}

function renderPreview() {
  const customization = collectFields();
  applyUiCustomization(customization, { root: preview, copyRoot: preview });
  for (const input of form.querySelectorAll('input[type="range"],input[type="color"]')) {
    const output = form.querySelector(`output[for="${input.id}"]`);
    if (!output) continue;
    output.value = input.name === "fontScale" ? `${Number(input.value).toFixed(2)}×` : input.name === "accentColor" ? input.value.toUpperCase() : `${input.value}px`;
  }
}

async function save(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  setStatus("正在保存…", "");
  try {
    const saved = await saveUiCustomization(collectFields());
    writeFields(saved);
    setStatus("已保存并应用到 FluxCatch 设置页。", "success");
  } catch (error) {
    setStatus(error?.message || "保存界面配置失败。", "error");
  }
}

async function resetDefaults() {
  setStatus("正在恢复默认值…", "");
  try {
    const saved = await saveUiCustomization(DEFAULT_UI_CUSTOMIZATION);
    writeFields(saved);
    setStatus("已恢复默认界面并保存。", "success");
  } catch (error) {
    setStatus(error?.message || "恢复默认值失败。", "error");
  }
}

function importJson() {
  clearJsonError();
  try {
    const customization = parseCustomizationJson(jsonInput.value);
    writeFields(customization);
    setStatus("JSON 已导入预览。检查后请点击“保存并应用”。", "success");
  } catch (error) {
    showJsonError(error?.message || "JSON 格式不正确。");
  }
}

function exportJson() {
  clearJsonError();
  const text = `${JSON.stringify(customizationExportPayload(collectFields()), null, 2)}\n`;
  jsonInput.value = text;
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
  setStatus("界面配置 JSON 已导出。", "success");
}

async function readJsonFile(event) {
  clearJsonError();
  const file = event.target.files?.[0];
  if (!file) return;
  try {
    jsonInput.value = await file.text();
    importJson();
  } catch (error) {
    showJsonError(error?.message || "读取 JSON 文件失败。");
  } finally {
    event.target.value = "";
  }
}

function setStatus(message, type) {
  status.textContent = message;
  if (type) status.dataset.state = type;
  else delete status.dataset.state;
}

function showJsonError(message) {
  jsonError.textContent = message;
  jsonError.hidden = false;
}

function clearJsonError() {
  jsonError.textContent = "";
  jsonError.hidden = true;
}
