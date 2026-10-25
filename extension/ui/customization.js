// UI editor overrides (a developer tool, Lab -> Developer in Settings).
// Saved per Chrome profile under havre.uiCustomization.v1 and applied to
// the Settings page only while Developer tools is on. Overrides never carry a
// colour literal of their own: an empty accent means "the theme's --pond".
// Only layout values apply: copy saved by older editors (its fields are still
// read and kept, per UI language) never replaces v2 copy, as the rename table
// asks once the editor moved behind Lab -> Developer.

export const UI_CUSTOMIZATION_STORAGE_KEY = "havre.uiCustomization.v1";
export const DEVELOPER_TOOLS_STORAGE_KEY = "havre.developerTools.v1";
import { readWithLegacy } from "../lib/legacy-storage.js";

// Layout defaults equal the v2 tokens, so a default record changes nothing.
export const DEFAULT_UI_CUSTOMIZATION = Object.freeze({
  firstSecondGap: 0,
  sectionGap: 48,
  contentWidth: 680,
  fontScale: 1,
  radius: 10,
  accentColor: "",
  language: "",
  pageTitle: "",
  pageDescription: "",
  runtimeTitle: "",
  localTitle: "",
  basicTitle: "",
  performanceTitle: "",
  detectionTitle: "",
  privacyTitle: "",
  notificationsTitle: "",
  generalTitle: "",
  labTitle: ""
});

/** Copy fields kept in the record: [maximum length, the v1 data-ui-copy target]. Never applied. */
export const COPY_FIELDS = Object.freeze({
  pageTitle: [60, "settings-title"],
  pageDescription: [180, "settings-description"],
  runtimeTitle: [60, "status-title"],
  localTitle: [60, "local-engine-title"],
  basicTitle: [60, "saving-title"],
  performanceTitle: [60, "speed-title"],
  detectionTitle: [60, "finding-title"],
  privacyTitle: [60, "privacy-title"],
  notificationsTitle: [60, "notifications-title"],
  generalTitle: [60, "general-title"],
  labTitle: [60, "lab-title"]
});

export const LAYOUT_LIMITS = Object.freeze({
  firstSecondGap: [0, 64],
  sectionGap: [0, 96],
  contentWidth: [560, 920],
  fontScale: [0.85, 1.3],
  radius: [6, 28]
});

// The type-role size and line tokens a font scale multiplies (tokens.css).
const TYPE_TOKENS = Object.freeze([
  "--wordmark-size", "--wordmark-line", "--display-size", "--display-line", "--empty-size", "--empty-line",
  "--title-size", "--title-line", "--row-size", "--row-line", "--body-size", "--body-line",
  "--meta-size", "--meta-line", "--label-size", "--label-line"
]);
// tokens.css redeclares these under :lang(zh) on every Chinese element, so an
// inline value on the root alone would not reach them.
const ZH_LINE_TOKENS = Object.freeze(["--row-line", "--body-line", "--meta-line"]);

const LAYOUT_PROPERTIES = Object.freeze([
  "--settings-first-gap", "--settings-section-gap", "--content-max",
  "--r-control", "--r-panel", "--r-float",
  "--pond", "--primary-fill", "--primary-fill-hover", "--primary-fill-pressed", "--tint-pond", "--text-on-accent"
]);

const TYPE_SCALE_ATTRIBUTE = "data-ui-type-scale";
const typeScales = new WeakMap();
let typeScaleCount = 0;


function clampNumber(value, fallback, [minimum, maximum]) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(maximum, Math.max(minimum, number));
}

function normalizeCopy(value, maximumLength) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, maximumLength);
}

/** "#RRGGBB" in upper case, or "" (the theme's accent). */
export function normalizeHex(value) {
  const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
  return match ? `#${match[1].toUpperCase()}` : "";
}

function normalizeLanguage(value) {
  if (value === "en" || value === "zh") return value;
  return "";
}

export function normalizeUiCustomization(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const customization = {
    firstSecondGap: Math.round(clampNumber(source.firstSecondGap, DEFAULT_UI_CUSTOMIZATION.firstSecondGap, LAYOUT_LIMITS.firstSecondGap)),
    sectionGap: Math.round(clampNumber(source.sectionGap, DEFAULT_UI_CUSTOMIZATION.sectionGap, LAYOUT_LIMITS.sectionGap)),
    contentWidth: Math.round(clampNumber(source.contentWidth, DEFAULT_UI_CUSTOMIZATION.contentWidth, LAYOUT_LIMITS.contentWidth)),
    fontScale: Math.round(clampNumber(source.fontScale, DEFAULT_UI_CUSTOMIZATION.fontScale, LAYOUT_LIMITS.fontScale) * 100) / 100,
    radius: Math.round(clampNumber(source.radius, DEFAULT_UI_CUSTOMIZATION.radius, LAYOUT_LIMITS.radius)),
    accentColor: normalizeHex(source.accentColor),
    language: ""
  };
  for (const [key, [maximumLength]] of Object.entries(COPY_FIELDS)) {
    customization[key] = normalizeCopy(source[key], maximumLength);
  }
  // A record without a language predates v2: its copy targeted v1 sections
  // that no longer exist, so it is dropped rather than guessed at.
  customization.language = normalizeLanguage(source.language);
  if (!customization.language) for (const key of Object.keys(COPY_FIELDS)) customization[key] = "";
  return customization;
}

/** True when any copy override is set (the record then needs a language). */
export function hasCopyOverrides(value) {
  const customization = value && typeof value === "object" ? value : {};
  return Object.keys(COPY_FIELDS).some((key) => Boolean(customization[key]));
}

function storageApi(explicitStorage) {
  return explicitStorage || globalThis.chrome?.storage?.local || null;
}

export async function loadUiCustomization(explicitStorage) {
  const storage = storageApi(explicitStorage);
  if (!storage?.get) return { ...DEFAULT_UI_CUSTOMIZATION };
  return normalizeUiCustomization(await readWithLegacy(storage, UI_CUSTOMIZATION_STORAGE_KEY));
}

/** Save a record. Copy overrides are stamped with `language` (the UI language they were written in). */
export async function saveUiCustomization(value, explicitStorage, { language } = {}) {
  const storage = storageApi(explicitStorage);
  const stamped = { ...(value || {}), language: language || value?.language || "" };
  const customization = normalizeUiCustomization(stamped);
  if (!storage?.set) return customization;
  await storage.set({ [UI_CUSTOMIZATION_STORAGE_KEY]: customization });
  return customization;
}

export async function loadDeveloperTools(explicitStorage) {
  const storage = storageApi(explicitStorage);
  if (!storage?.get) return false;
  return (await readWithLegacy(storage, DEVELOPER_TOOLS_STORAGE_KEY)) === true;
}

export async function saveDeveloperTools(enabled, explicitStorage) {
  const storage = storageApi(explicitStorage);
  const value = enabled === true;
  if (storage?.set) await storage.set({ [DEVELOPER_TOOLS_STORAGE_KEY]: value });
  return value;
}

// ---------- colour helpers (runtime values only: tokens or the user's own pick) ----------

function parseColour(value) {
  const text = String(value || "").trim();
  const hex = text.match(/^#([0-9a-f]{6})$/i);
  if (hex) return [0, 2, 4].map((offset) => Number.parseInt(hex[1].slice(offset, offset + 2), 16));
  const rgb = text.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

function relativeLuminance(channels) {
  const linear = channels.map((channel) => {
    const ratio = channel / 255;
    return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

export function contrastRatio(left, right) {
  const a = parseColour(left);
  const b = parseColour(right);
  if (!a || !b) return 0;
  const values = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

/** A token's computed value as "#RRGGBB", or "" when it cannot be read here. */
export function readTokenHex(name, root = globalThis.document?.documentElement) {
  try {
    const value = globalThis.getComputedStyle?.(root)?.getPropertyValue(name)?.trim();
    const channels = parseColour(value);
    if (!channels) return "";
    return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("").toUpperCase()}`;
  } catch {
    return "";
  }
}

// Text on a custom accent: whichever of the theme's own on-accent and primary
// text colours reads better on it (both are tokens, read at runtime).
function textOnAccent(accent, root) {
  const candidates = [readTokenHex("--text-on-accent", root), readTokenHex("--text-primary", root)].filter(Boolean);
  if (!candidates.length) return "";
  return candidates.sort((a, b) => contrastRatio(accent, b) - contrastRatio(accent, a))[0];
}

// ---------- applying ----------

/** Remove every override this module sets, so the tokens rule again. */
export function clearUiCustomization({ root = globalThis.document?.documentElement } = {}) {
  const style = root?.style;
  if (!style) return;
  for (const name of LAYOUT_PROPERTIES) style.removeProperty?.(name);
  clearTypeScale(root);
}

function readSizes(element, names) {
  const sizes = {};
  try {
    const computed = globalThis.getComputedStyle?.(element);
    for (const name of names) {
      const px = Number.parseFloat(computed?.getPropertyValue(name));
      if (Number.isFinite(px)) sizes[name] = px;
    }
  } catch {
    // No computed style here (tests, detached roots): the scale is skipped.
  }
  return sizes;
}

// The :lang(zh) line values, read from a short-lived Chinese probe inside root.
function zhLineSizes(root) {
  const doc = root?.ownerDocument;
  if (!doc?.createElement || !root.append) return {};
  const probe = doc.createElement("span");
  probe.setAttribute("lang", "zh");
  probe.hidden = true;
  root.append(probe);
  try {
    return readSizes(probe, ZH_LINE_TOKENS);
  } finally {
    probe.remove();
  }
}

function clearTypeScale(root) {
  const entry = typeScales.get(root);
  if (!entry) return;
  entry.style.remove();
  root.removeAttribute?.(TYPE_SCALE_ATTRIBUTE);
  typeScales.delete(root);
}

// One generated rule per root: the scaled tokens on the root, and the scaled
// Chinese line heights on the root's :lang(zh) elements, which outrank the
// tokens.css :lang(zh) rule by one attribute selector.
function applyTypeScale(root, scale) {
  const base = readSizes(root, TYPE_TOKENS);
  if (!Object.keys(base).length) return;
  const zh = zhLineSizes(root);
  const doc = root.ownerDocument;
  const head = doc?.head || doc?.documentElement;
  if (!doc?.createElement || !head?.append || !root.setAttribute) return;
  const id = String((typeScaleCount += 1));
  const scoped = `[${TYPE_SCALE_ATTRIBUTE}="${id}"]`;
  const declarations = (sizes) => Object.entries(sizes).map(([name, px]) => `${name}: ${Math.round(px * scale)}px;`).join(" ");
  const style = doc.createElement("style");
  style.textContent = [
    `${scoped} { ${declarations(base)} }`,
    Object.keys(zh).length ? `${scoped}:lang(zh), ${scoped} :lang(zh) { ${declarations(zh)} }` : ""
  ].filter(Boolean).join("\n");
  head.append(style);
  root.setAttribute(TYPE_SCALE_ATTRIBUTE, id);
  typeScales.set(root, { style, id });
}

/**
 * Apply a record's layout values to `root` (CSS properties). Values equal to
 * the defaults leave the tokens alone. Copy is never applied.
 */
export function applyUiCustomization(value, { root = globalThis.document?.documentElement } = {}) {
  const customization = normalizeUiCustomization(value);
  clearUiCustomization({ root });
  const style = root?.style;
  if (style?.setProperty) {
    const set = (name, next) => style.setProperty(name, next);
    if (customization.firstSecondGap !== DEFAULT_UI_CUSTOMIZATION.firstSecondGap) set("--settings-first-gap", `${customization.firstSecondGap}px`);
    if (customization.sectionGap !== DEFAULT_UI_CUSTOMIZATION.sectionGap) set("--settings-section-gap", `${customization.sectionGap}px`);
    if (customization.contentWidth !== DEFAULT_UI_CUSTOMIZATION.contentWidth) set("--content-max", `${customization.contentWidth}px`);
    if (customization.radius !== DEFAULT_UI_CUSTOMIZATION.radius) {
      set("--r-panel", `${customization.radius}px`);
      set("--r-control", `${Math.max(4, Math.round(customization.radius * 0.6))}px`);
      set("--r-float", `${Math.round(customization.radius * 1.2)}px`);
    }
    if (customization.fontScale !== DEFAULT_UI_CUSTOMIZATION.fontScale) applyTypeScale(root, customization.fontScale);
    const accent = customization.accentColor;
    if (accent) {
      set("--pond", accent);
      set("--primary-fill", accent);
      set("--primary-fill-hover", `color-mix(in srgb, ${accent} 86%, var(--text-primary))`);
      set("--primary-fill-pressed", `color-mix(in srgb, ${accent} 76%, var(--text-primary))`);
      set("--tint-pond", `color-mix(in srgb, ${accent} 12%, transparent)`);
      const onAccent = textOnAccent(accent, root);
      if (onAccent) set("--text-on-accent", onAccent);
    }
  }
  return customization;
}

/**
 * Keep a page in step with the saved record and the Developer tools switch.
 * `refresh()` re-applies (after a rebuild); `unbind()` stops listening.
 * `language` is accepted for older callers and no longer used.
 */
export async function bindUiCustomization({
  root = globalThis.document?.documentElement,
  storage,
  changeSource = globalThis.chrome?.storage?.onChanged,
  onChange
} = {}) {
  let customization = { ...DEFAULT_UI_CUSTOMIZATION };
  let enabled = false;
  try { customization = await loadUiCustomization(storage); } catch { /* defaults */ }
  try { enabled = await loadDeveloperTools(storage); } catch { enabled = false; }
  const refresh = () => {
    if (enabled) applyUiCustomization(customization, { root });
    else clearUiCustomization({ root });
  };
  refresh();
  const listener = (changes, areaName) => {
    if (areaName && areaName !== "local") return;
    let changed = false;
    if (changes?.[UI_CUSTOMIZATION_STORAGE_KEY]) {
      customization = normalizeUiCustomization(changes[UI_CUSTOMIZATION_STORAGE_KEY].newValue);
      changed = true;
    }
    if (changes?.[DEVELOPER_TOOLS_STORAGE_KEY]) {
      enabled = changes[DEVELOPER_TOOLS_STORAGE_KEY].newValue === true;
      changed = true;
    }
    if (changed) onChange ? onChange({ enabled, customization }) : refresh();
  };
  changeSource?.addListener?.(listener);
  return {
    refresh,
    isEnabled: () => enabled,
    unbind: () => changeSource?.removeListener?.(listener)
  };
}

export function customizationExportPayload(value) {
  return { schemaVersion: 2, customization: normalizeUiCustomization(value) };
}

/** Parse an exported or bare record. Throws an Error with code "invalid_customization". */
export function parseCustomizationJson(text) {
  let parsed;
  try {
    parsed = JSON.parse(String(text || ""));
  } catch {
    throw Object.assign(new Error("invalid_customization"), { code: "invalid_customization" });
  }
  const candidate = parsed?.customization && typeof parsed.customization === "object" ? parsed.customization : parsed;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw Object.assign(new Error("invalid_customization"), { code: "invalid_customization" });
  }
  return normalizeUiCustomization(candidate);
}
