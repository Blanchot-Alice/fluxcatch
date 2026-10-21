// Copy owned by the background worker: system notifications, the toolbar
// button's tooltip and the few labels the worker builds for pages. Keys use
// the worker. prefix only; en and zh hold identical key sets.
//
// The service worker reads this module directly (background.js workerText),
// without messages.js, locale.js or the v1 translator, so it imports nothing.
// Functions take their numbers raw and format them in their own language;
// `locale` (a BCP 47 tag) may refine the English variant. Failure reasons are
// not here: they come from lib/job-failure.js describeJobFailure.

const EN_PLURAL = new Intl.PluralRules("en");

function count(value, locale) {
  return new Intl.NumberFormat(locale).format(Number(value) || 0);
}

function percent(fraction, locale) {
  const value = Math.max(0, Math.min(1, Number(fraction) || 0));
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(value);
}

function englishLocale(locale) {
  return /^en\b/i.test(String(locale || "")) ? locale : "en";
}

function pluralEn(n, one, other) {
  return EN_PLURAL.select(Number(n) || 0) === "one" ? one : other;
}

const en = {
  // Notifications. The file name (user content) is the first body line.
  "worker.notify.completedTitle": "Download finished",
  "worker.notify.failedTitle": "Download failed",
  "worker.notify.showInFinder": "Show in Finder",
  "worker.notify.showInFolder": "Show in folder",
  "worker.notify.open": "Open",
  "worker.notify.retry": "Retry",
  "worker.notify.engineReadyTitle": "Local engine is ready",
  "worker.notify.engineNotReadyTitle": "Local engine isn’t set up",
  "worker.notify.engineNotConnectedTitle": "Local engine isn’t connected",
  "worker.notify.engineNotReadyBody": "Check it in Settings → Local engine.",
  "worker.notify.resumed": "Your download has continued.",
  "worker.notify.downloadAgain": "Go back to the page and download again.",
  "worker.notify.readyToDownload": "You can download now.",
  "worker.notify.setUp": "Set up",

  // Toolbar button tooltip (chrome.action.setTitle).
  "worker.action.downloading": ({ count: n, fraction, locale } = {}) => {
    const tag = englishLocale(locale);
    return `FluxCatch · ${count(n, tag)} ${pluralEn(n, "download", "downloads")} in progress · ${percent(fraction, tag)}`;
  },
  "worker.action.found": ({ count: n, locale } = {}) => `FluxCatch · ${count(n, englishLocale(locale))} media ${pluralEn(n, "item", "items")} on this page`,
  "worker.action.none": "FluxCatch · No downloadable media on this page yet",

  // Labels the worker builds for pages.
  "worker.qualityRank": ({ rank, size, locale } = {}) => `Quality ${count(rank || 1, englishLocale(locale))}${size ? ` · ${size}` : ""}`,
  "worker.untitledMedia": "Media"
};

const zh = {
  "worker.notify.completedTitle": "下载完成",
  "worker.notify.failedTitle": "下载失败",
  "worker.notify.showInFinder": "在 Finder 中显示",
  "worker.notify.showInFolder": "在文件夹中显示",
  "worker.notify.open": "打开",
  "worker.notify.retry": "重试",
  "worker.notify.engineReadyTitle": "本地引擎已就绪",
  "worker.notify.engineNotReadyTitle": "本地引擎尚未设置",
  "worker.notify.engineNotConnectedTitle": "本地引擎未连接",
  "worker.notify.engineNotReadyBody": "请到“设置 → 本地引擎”查看。",
  "worker.notify.resumed": "刚才的下载已自动继续。",
  "worker.notify.downloadAgain": "请回到页面重新下载。",
  "worker.notify.readyToDownload": "现在可以下载了。",
  "worker.notify.setUp": "设置",

  "worker.action.downloading": ({ count: n, fraction } = {}) => `FluxCatch · 正在下载 ${count(n, "zh-CN")} 项 · ${percent(fraction, "zh-CN")}`,
  "worker.action.found": ({ count: n } = {}) => `FluxCatch · 此页面有 ${count(n, "zh-CN")} 项媒体`,
  // Same wording as media.empty.none (messages/media.js), without the full stop.
  "worker.action.none": "FluxCatch · 此页还没有可下载的媒体",

  "worker.qualityRank": ({ rank, size } = {}) => `清晰度 ${count(rank || 1, "zh-CN")}${size ? ` · ${size}` : ""}`,
  "worker.untitledMedia": "媒体"
};

const display = [];

export default { en, zh, display };
