// Copy owned by the side-panel workspace only. Keys use the sidepanel. prefix
// only. The workspace shares its media rows, dialog and downloads list with
// the popup; that copy lives in media.js.
import { formatCount, plural } from "../locale.js";

const en = {
  "sidepanel.title": "Workspace",
  "sidepanel.downloadsTitle": "Downloads",
  "sidepanel.clearFinished": "Clear finished",
  "sidepanel.clearConfirm": "Clear finished downloads from this list? Your download history stays.",
  "sidepanel.cleared": ({ count = 0 }) => `Cleared ${formatCount(count)} finished ${plural(count, { one: "download", other: "downloads" })}`
};

const zh = {
  "sidepanel.title": "工作台",
  "sidepanel.downloadsTitle": "下载",
  "sidepanel.clearFinished": "清理已结束项",
  "sidepanel.clearConfirm": "从列表中清理已结束的下载？下载记录不受影响。",
  "sidepanel.cleared": ({ count = 0 }) => `已清理 ${formatCount(count)} 个已结束的下载`
};

const display = [];

export default { en, zh, display };
