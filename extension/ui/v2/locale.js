// One locale source for v2 surfaces (design review §7): the extension's UI
// language decides every string and every Intl formatter. "Auto" follows
// Chrome's UI language. Nothing here reads the system locale. This module also
// owns the stored language preference (Settings → Language).
import { formatBytes as formatDecimalBytes, formatRate as formatDecimalRate } from "../../lib/format.js";
// msg is used only at call time (formatRelativeTime), so the import cycle with
// messages.js (which reads uiLanguage) is safe in either load order.
import { msg } from "./messages.js";

/** chrome.storage.local key of the language preference: "auto" | "en" | "zh".
 *  The background worker reads the same key (tests/worker-i18n.test.js). */
export const UI_LANGUAGE_STORAGE_KEY = "havre.uiLanguage.v1";
import { readWithLegacy } from "../../lib/legacy-storage.js";

const listeners = new Set();
let activeLanguage = "zh";

function chromeUiLanguage() {
  try { return globalThis.chrome?.i18n?.getUILanguage?.() || "zh-CN"; } catch { return "zh-CN"; }
}

function normalizePref(value) {
  return value === "en" || value === "zh" || value === "auto" ? value : "auto";
}

/** "en" | "zh" for a stored preference; Auto (or anything unknown) follows
 *  Chrome's UI language: Chinese Chrome gets Chinese, every other language English. */
export function resolveUiLanguage(pref, chromeLanguage = "zh-CN") {
  if (pref === "en" || pref === "zh") return pref;
  return /^zh/i.test(String(chromeLanguage || "")) ? "zh" : "en";
}

/** Make `language` ("en" | "zh") the UI language in force; returns it. */
export function setUiLanguage(language) {
  activeLanguage = language === "en" ? "en" : "zh";
  return activeLanguage;
}

/** The UI language in force: "en" | "zh" (Chinese until bootLocale resolves). */
export function getUiLanguage() {
  return activeLanguage;
}

/** The stored preference: "auto" | "en" | "zh" ("auto" when nothing valid is stored). */
export async function loadUiLanguage(storage) {
  const store = storage || globalThis.chrome?.storage?.local;
  if (!store?.get) return "auto";
  return normalizePref(await readWithLegacy(store, UI_LANGUAGE_STORAGE_KEY));
}

/** Store a preference (normalised to "auto" | "en" | "zh"); returns what was stored.
 *  Every open page follows through bootLocale's storage listener. */
export async function saveUiLanguage(pref, storage) {
  const store = storage || globalThis.chrome?.storage?.local;
  const value = normalizePref(pref);
  if (store?.set) await store.set({ [UI_LANGUAGE_STORAGE_KEY]: value });
  return value;
}

/** "en" | "zh" — the UI language currently in force. */
export function uiLanguage() {
  return getUiLanguage() === "en" ? "en" : "zh";
}

/** BCP 47 tag for Intl: Chrome's own English variant when it is English, else zh-CN. */
export function uiLocale() {
  if (uiLanguage() === "zh") return "zh-CN";
  const chrome = chromeUiLanguage();
  return /^en\b/i.test(chrome) ? chrome : "en";
}

/** Resolve the stored preference, activate it, mark <html lang>, and keep it live. */
export async function bootLocale({ storage, onChanged } = {}) {
  let pref = "auto";
  try { pref = await loadUiLanguage(storage); } catch { /* auto */ }
  apply(resolveUiLanguage(pref, chromeUiLanguage()));
  const source = onChanged ?? globalThis.chrome?.storage?.onChanged;
  source?.addListener?.((changes, area) => {
    if (area && area !== "local") return;
    const change = changes?.[UI_LANGUAGE_STORAGE_KEY];
    if (!change) return;
    apply(resolveUiLanguage(change.newValue, chromeUiLanguage()));
    for (const listener of listeners) listener(uiLanguage());
  });
  return uiLanguage();
}

function apply(language) {
  setUiLanguage(language);
  const root = globalThis.document?.documentElement;
  if (root) root.lang = language === "en" ? "en" : "zh-CN";
}

/** Re-render when the user switches language in Settings. */
export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// ---------- formatters (decimal units, so sizes match Finder: lib/format.js) ----------
export function formatBytes(bytes) {
  return formatDecimalBytes(bytes, uiLocale());
}

export function formatRate(bytesPerSecond) {
  return formatDecimalRate(bytesPerSecond, uiLocale());
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatCount(n) {
  return new Intl.NumberFormat(uiLocale()).format(Number(n) || 0);
}

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

// Chinese copy puts a space between a numeral and the Han characters around
// it (group.week, job.left); Intl's Chinese relative times do not, so the
// minute, hour and day forms get the same spacing. Absolute dates keep
// Intl's own form.
const DIGIT_BEFORE_HAN = /(\d)(?=[\u4e00-\u9fff])/g;
const HAN_BEFORE_DIGIT = /([\u4e00-\u9fff])(?=\d)/g;

function relative(rtf, value, unit) {
  const text = rtf.format(value, unit);
  return uiLanguage() === "zh" ? text.replace(DIGIT_BEFORE_HAN, "$1 ").replace(HAN_BEFORE_DIGIT, "$1 ") : text;
}

/** "just now" · "5 min. ago" · "3 hr. ago" · "yesterday" · "2 days ago" · "Oct 18" (in the UI locale);
 *  in Chinese the same steps, with time.justNow and spaced numerals. */
export function formatRelativeTime(timestamp, now = Date.now()) {
  const value = Number(timestamp) || 0;
  if (!value) return "";
  const diff = Math.max(0, now - value);
  const rtf = new Intl.RelativeTimeFormat(uiLocale(), { numeric: "auto", style: "short" });
  // Intl's "now" reads as a status; a record seen a moment ago was "just now".
  if (diff < 60_000) return msg("time.justNow");
  if (diff < 3_600_000) return relative(rtf, -Math.floor(diff / 60_000), "minute");
  const date = new Date(value);
  const today = new Date(now);
  if (sameDay(date, today)) return relative(rtf, -Math.floor(diff / 3_600_000), "hour");
  const days = calendarDaysBetween(date, today);
  if (days < 7) return relative(rtf, -days, "day");
  const options = { month: "short", day: "numeric" };
  if (date.getFullYear() !== today.getFullYear()) options.year = "numeric";
  return new Intl.DateTimeFormat(uiLocale(), options).format(date);
}

function calendarDaysBetween(earlier, later) {
  const a = Date.UTC(earlier.getFullYear(), earlier.getMonth(), earlier.getDate());
  const b = Date.UTC(later.getFullYear(), later.getMonth(), later.getDate());
  return Math.round((b - a) / 86_400_000);
}

/** Calendar buckets for the history list: today · yesterday · week (2–6 days) · earlier. */
export function dayGroupOf(timestamp, now = Date.now()) {
  const value = Number(timestamp) || 0;
  const days = calendarDaysBetween(new Date(value), new Date(now));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return "week";
  return "earlier";
}

export function plural(count, forms) {
  const rule = new Intl.PluralRules(uiLocale()).select(Number(count) || 0);
  return forms[rule] ?? forms.other;
}
