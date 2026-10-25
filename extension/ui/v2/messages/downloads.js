// Copy owned by the Downloads page (extension/downloads/). Keys use the
// downloads. prefix only.
import { plural, formatCount } from "../locale.js";

const en = {
  "downloads.title": "Downloads",
  "downloads.summary": ({ count, size }) => `${formatCount(count)} ${plural(count, { one: "file", other: "files" })}${size ? ` · ${size}` : ""}`,
  "downloads.urlLabel": "Media link",
  "downloads.urlPlaceholder": "Paste a video or audio link",
  "downloads.filterLabel": "Filter downloads",
  "downloads.filter.all": "All",
  "downloads.filter.completed": "Completed",
  "downloads.filter.failed": "Failed & cancelled",
  "downloads.searchLabel": "Search downloads",
  "downloads.searchPlaceholder": "Search",
  "downloads.moreLabel": "More download actions",
  "downloads.showFolder": "Show download folder in Finder",
  "downloads.clearHistory": "Clear history…",
  "downloads.clearConfirm": "Clear all download records? The files stay on your Mac.",
  "downloads.clearAction": "Clear history",
  "downloads.loading": "Loading downloads…",
  "downloads.loadFailed": "Couldn’t read downloads",
  "downloads.disconnected": "Havre stopped responding",
  "downloads.empty.none": "No downloads yet.",
  "downloads.empty.noneBody": "On a video page, click the Havre button in the toolbar, or paste a link above.",
  "downloads.empty.noMatch": "No downloads match.",
  "downloads.empty.noMatchBody": "Try another word or filter.",
  "downloads.notificationsOff": "Notifications are off"
};

const zh = {
  "downloads.title": "下载记录",
  "downloads.summary": ({ count, size }) => `${formatCount(count)} 个文件${size ? ` · ${size}` : ""}`,
  "downloads.urlLabel": "媒体链接",
  "downloads.urlPlaceholder": "粘贴视频或音频链接",
  "downloads.filterLabel": "筛选下载记录",
  "downloads.filter.all": "全部",
  "downloads.filter.completed": "已完成",
  "downloads.filter.failed": "失败与取消",
  "downloads.searchLabel": "搜索下载记录",
  "downloads.searchPlaceholder": "搜索",
  "downloads.moreLabel": "更多下载操作",
  "downloads.showFolder": "在 Finder 中显示下载文件夹",
  "downloads.clearHistory": "清空记录…",
  "downloads.clearConfirm": "清空全部下载记录？文件本身会留在你的 Mac 上。",
  "downloads.clearAction": "清空记录",
  "downloads.loading": "正在读取下载记录…",
  "downloads.loadFailed": "无法读取下载记录",
  "downloads.disconnected": "Havre 未响应",
  "downloads.empty.none": "还没有下载记录。",
  "downloads.empty.noneBody": "在视频页面点击工具栏上的 Havre 按钮开始下载，或在上方粘贴链接。",
  "downloads.empty.noMatch": "没有符合条件的下载记录。",
  "downloads.empty.noMatchBody": "换个关键词，或切换筛选。",
  "downloads.notificationsOff": "通知已关闭"
};

/** Display strings (set in the Display face): their Chinese glyphs must be
 *  in the bundled Noto Serif SC subset (scripts/build-display-font.mjs). */
const display = ["downloads.title", "downloads.empty.none", "downloads.empty.noMatch"];

export default { en, zh, display };
