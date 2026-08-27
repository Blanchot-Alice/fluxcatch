export const UI_CUSTOMIZATION_STORAGE_KEY = "fluxcatch.uiCustomization.v1";

export const DEFAULT_UI_CUSTOMIZATION = Object.freeze({
  firstSecondGap: 12,
  sectionGap: 16,
  contentWidth: 720,
  fontScale: 1,
  radius: 18,
  accentColor: "#466F66",
  pageTitle: "FluxCatch 设置",
  pageDescription: "调整下载体验，并确认当前构建真正可用的能力。",
  runtimeTitle: "运行身份与能力概览",
  runtimeDescription: "先确认浏览器扩展、本地处理程序与当前能力配置是否一致。",
  basicTitle: "基础下载",
  basicDescription: "普通用户最常用的保存方式。",
  performanceTitle: "性能",
  performanceDescription: "先选择稳妥预设，需要时再调整具体并发。",
  detectionTitle: "检测与命名",
  detectionDescription: "控制媒体筛选以及下载文件的可读名称。",
  privacyTitle: "隐私与网络",
  privacyDescription: "固定站点接口，自动行为可随时关闭。",
  localTitle: "本地能力",
  localDescription: "安装状态与当前构建是否开放是两件不同的事。",
  notificationsTitle: "通知",
  notificationsDescription: "开启时立即申请权限；通知偏好仍由保存栏确认。",
  labTitle: "实验室与当前限制",
  labDescription: "以下项目仅说明路线状态，在当前构建中没有可操作开关。"
});

const COPY_FIELDS = Object.freeze({
  pageTitle: [60, "options-title"],
  pageDescription: [180, "options-description"],
  runtimeTitle: [60, "runtime-title"],
  runtimeDescription: [180, "runtime-description"],
  basicTitle: [60, "basic-title"],
  basicDescription: [180, "basic-description"],
  performanceTitle: [60, "performance-title"],
  performanceDescription: [180, "performance-description"],
  detectionTitle: [60, "detection-title"],
  detectionDescription: [180, "detection-description"],
  privacyTitle: [60, "privacy-title"],
  privacyDescription: [180, "privacy-description"],
  localTitle: [60, "local-title"],
  localDescription: [180, "local-description"],
  notificationsTitle: [60, "notifications-title"],
  notificationsDescription: [180, "notifications-description"],
  labTitle: [60, "lab-title"],
  labDescription: [180, "lab-description"]
});

const LIMITS = Object.freeze({
  firstSecondGap: [0, 64],
  sectionGap: [0, 48],
  contentWidth: [560, 920],
  fontScale: [0.85, 1.3],
  radius: [6, 28]
});

function clampNumber(value, fallback, [minimum, maximum]) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeCopy(value, fallback, maximumLength) {
  const text = String(value ?? "").trim().replace(/\s+/g, " ");
  return (text || fallback).slice(0, maximumLength);
}

function normalizeHex(value) {
  const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : DEFAULT_UI_CUSTOMIZATION.accentColor;
}

export function normalizeUiCustomization(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const customization = {
    firstSecondGap: Math.round(clampNumber(source.firstSecondGap, DEFAULT_UI_CUSTOMIZATION.firstSecondGap, LIMITS.firstSecondGap)),
    sectionGap: Math.round(clampNumber(source.sectionGap, DEFAULT_UI_CUSTOMIZATION.sectionGap, LIMITS.sectionGap)),
    contentWidth: Math.round(clampNumber(source.contentWidth, DEFAULT_UI_CUSTOMIZATION.contentWidth, LIMITS.contentWidth)),
    fontScale: Math.round(clampNumber(source.fontScale, DEFAULT_UI_CUSTOMIZATION.fontScale, LIMITS.fontScale) * 100) / 100,
    radius: Math.round(clampNumber(source.radius, DEFAULT_UI_CUSTOMIZATION.radius, LIMITS.radius)),
    accentColor: normalizeHex(source.accentColor)
  };
  for (const [key, [maximumLength]] of Object.entries(COPY_FIELDS)) {
    customization[key] = normalizeCopy(source[key], DEFAULT_UI_CUSTOMIZATION[key], maximumLength);
  }
  return customization;
}

function storageApi(explicitStorage) {
  return explicitStorage || globalThis.chrome?.storage?.local || null;
}

export async function loadUiCustomization(explicitStorage) {
  const storage = storageApi(explicitStorage);
  if (!storage?.get) return { ...DEFAULT_UI_CUSTOMIZATION };
  const stored = await storage.get(UI_CUSTOMIZATION_STORAGE_KEY);
  return normalizeUiCustomization(stored?.[UI_CUSTOMIZATION_STORAGE_KEY]);
}

export async function saveUiCustomization(value, explicitStorage) {
  const storage = storageApi(explicitStorage);
  const customization = normalizeUiCustomization(value);
  if (!storage?.set) return customization;
  await storage.set({ [UI_CUSTOMIZATION_STORAGE_KEY]: customization });
  return customization;
}

function hexRgb(hex) {
  const value = normalizeHex(hex).slice(1);
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function relativeLuminance(hex) {
  const channels = hexRgb(hex).map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left, right) {
  const values = [relativeLuminance(left), relativeLuminance(right)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function textOnAccent(accent) {
  const light = "#FFFFFF";
  const dark = "#000000";
  return contrastRatio(accent, light) >= contrastRatio(accent, dark) ? light : dark;
}

function mixHex(left, right, rightWeight) {
  const a = hexRgb(left);
  const b = hexRgb(right);
  const channels = a.map((channel, index) => Math.round(channel * (1 - rightWeight) + b[index] * rightWeight));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function updateCopy(copyRoot, customization) {
  if (!copyRoot?.querySelectorAll) return;
  for (const [key, [, copyId]] of Object.entries(COPY_FIELDS)) {
    for (const node of copyRoot.querySelectorAll(`[data-ui-copy="${copyId}"]`)) node.textContent = customization[key];
  }
}

export function applyUiCustomization(value, { root = globalThis.document?.documentElement, copyRoot = globalThis.document } = {}) {
  const customization = normalizeUiCustomization(value);
  const style = root?.style;
  if (style?.setProperty) {
    const accent = customization.accentColor;
    const onAccent = textOnAccent(accent);
    const [red, green, blue] = hexRgb(accent);
    style.setProperty("--ui-first-second-gap", `${customization.firstSecondGap}px`);
    style.setProperty("--ui-section-gap", `${customization.sectionGap}px`);
    style.setProperty("--ui-content-width", `${customization.contentWidth}px`);
    style.setProperty("--ui-font-scale", String(customization.fontScale));
    style.setProperty("--ui-radius", `${customization.radius}px`);
    style.setProperty("--r-control", `${Math.max(6, Math.round(customization.radius * 0.5))}px`);
    style.setProperty("--r-row", `${Math.max(8, Math.round(customization.radius * 0.72))}px`);
    style.setProperty("--r-panel", `${customization.radius}px`);
    style.setProperty("--primary-action", accent);
    style.setProperty("--primary", accent);
    style.setProperty("--primaryHover", mixHex(accent, onAccent === "#FFFFFF" ? "#000000" : "#FFFFFF", 0.16));
    style.setProperty("--primary-tint", `rgba(${red},${green},${blue},.14)`);
    style.setProperty("--on-primary", onAccent);
  }
  updateCopy(copyRoot, customization);
  return customization;
}

export async function bindUiCustomization({
  root = globalThis.document?.documentElement,
  copyRoot = globalThis.document,
  storage,
  changeSource = globalThis.chrome?.storage?.onChanged
} = {}) {
  const apply = (value) => applyUiCustomization(value, { root, copyRoot });
  try {
    apply(await loadUiCustomization(storage));
  } catch {
    apply(DEFAULT_UI_CUSTOMIZATION);
  }
  const listener = (changes, areaName) => {
    if (areaName && areaName !== "local") return;
    const change = changes?.[UI_CUSTOMIZATION_STORAGE_KEY];
    if (change) apply(change.newValue || DEFAULT_UI_CUSTOMIZATION);
  };
  changeSource?.addListener?.(listener);
  return () => changeSource?.removeListener?.(listener);
}

export function customizationExportPayload(value) {
  return { schemaVersion: 1, customization: normalizeUiCustomization(value) };
}

export function parseCustomizationJson(text) {
  const parsed = JSON.parse(String(text || ""));
  const candidate = parsed?.customization && typeof parsed.customization === "object" ? parsed.customization : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error("JSON 需要包含界面配置对象");
  return normalizeUiCustomization(candidate);
}
