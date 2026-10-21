// Copy owned by popup and side panel (detected media rows, the media list
// header, the media download dialog, the engine status line and the shared
// downloads list). Keys use the media. prefix only. Format names (MP4, MKV …)
// are not copy: ui/v2/media.js writes them as they are in both languages.
import { formatCount, plural } from "../locale.js";

const en = {
  "media.listTitle": "Media on this page",
  "media.rescan": "Rescan",
  "media.scanDone": "Scan finished",
  "media.downloadAll": "Download all",
  "media.moreActions": "More media actions",
  "media.downloadFor": ({ name = "" }) => `Download ${name}`,
  "media.downloadLink": "Download a link",
  "media.allDownloads": "All downloads",
  "media.untitled": "Untitled media",
  "media.kind.stream": "Stream",
  "media.kind.audioOnly": "Audio only",
  "media.best": "Best",
  "media.reading": "Reading qualities…",
  "media.loading": "Looking for media…",
  "media.loadFailed": "Couldn’t read this page",
  "media.empty.none": "No downloadable media on this page yet.",
  "media.empty.noneBody": "Play the video, then rescan.",
  "media.empty.noMatch": "No media of this type.",
  "media.empty.noMatchBody": "Choose another type, or rescan.",
  "media.empty.unreadable": "FluxCatch can’t read this page.",
  "media.empty.unreadableBody": "Open a web page with video or audio.",
  "media.filter.label": "Media type",
  "media.filter.all": "All types",
  "media.filter.video": "Video",
  "media.filter.audio": "Audio",
  "media.filter.stream": "Streams",
  "media.batchStarted": ({ count = 0, failed = 0 }) => {
    const started = `Started ${formatCount(count)} ${plural(count, { one: "download", other: "downloads" })}`;
    return failed ? `${started}; ${formatCount(failed)} didn’t start` : started;
  },
  "media.nothingToDownload": "Nothing to download",
  "media.clearResults": "Clear results",
  "media.clearConfirm": "Clear this page’s results and finished downloads? Your download history stays.",
  "media.cleared": "Results cleared",

  "media.dialog.link": "Link",
  "media.dialog.linkPlaceholder": "Paste a video or audio link",
  "media.dialog.name": "File name",
  "media.dialog.namePlaceholder": "Leave blank to name it automatically",
  "media.dialog.format": "Format",
  "media.dialog.quality": "Quality",
  "media.format.original": "Original format",
  "media.format.audioOnly": "audio only",
  "media.format.unavailable": "not available",
  "media.quality.best": "Best available",
  "media.quality.rank": ({ count = 1 }) => `Quality ${formatCount(count)}`,
  "media.block.drm": "Copy-protected video can’t be saved.",
  "media.block.live": "Live streams can’t be saved yet.",
  "media.block.discontinuous": "This kind of stream can’t be saved yet.",
  "media.probeFailed": "Couldn’t read qualities; the best one will be used.",

  "media.engine.finishing": "Finishing setup…",
  "media.engine.restart": "Quit and reopen Chrome to finish setup",
  "media.engine.recover": "Setup isn’t finished yet",
  "media.engine.missing": "Local engine isn’t installed",
  "media.engine.noResponse": "Local engine isn’t responding",
  "media.engine.update": "Local engine needs an update",
  "media.engine.noConvert": "Merging & converting isn’t available",
  "media.engine.ready": "Local engine is ready",
  "media.disconnected": "FluxCatch stopped responding",

  "media.downloads.empty": "No downloads yet.",
  "media.downloads.emptyBody": "Choose Download beside any media, or paste a link.",
  "media.downloads.noMatch": "No downloads of this type.",
  "media.downloads.noMatchBody": "Choose another type.",
  "media.downloads.loading": "Loading downloads…",
  "media.downloads.loadFailed": "Couldn’t read downloads",
  "media.notificationsOff": "Notifications are off",
  "media.announce": ({ name = "", status = "" }) => `${name}: ${status}`
};

const zh = {
  "media.listTitle": "本页媒体",
  "media.rescan": "重新扫描",
  "media.scanDone": "扫描完成",
  "media.downloadAll": "全部下载",
  "media.moreActions": "更多媒体操作",
  "media.downloadFor": ({ name = "" }) => `下载“${name}”`,
  "media.downloadLink": "粘贴链接下载",
  "media.allDownloads": "全部下载记录",
  "media.untitled": "未命名媒体",
  "media.kind.stream": "流媒体",
  "media.kind.audioOnly": "仅音频",
  "media.best": "最佳",
  "media.reading": "正在读取清晰度…",
  "media.loading": "正在查找媒体…",
  "media.loadFailed": "无法读取此页面",
  "media.empty.none": "此页还没有可下载的媒体。",
  "media.empty.noneBody": "先播放视频，再重新扫描。",
  "media.empty.noMatch": "没有这一类媒体。",
  "media.empty.noMatchBody": "换一种类型，或重新扫描。",
  "media.empty.unreadable": "FluxCatch 无法读取此页面。",
  "media.empty.unreadableBody": "请打开带有视频或音频的网页。",
  "media.filter.label": "媒体类型",
  "media.filter.all": "全部类型",
  "media.filter.video": "视频",
  "media.filter.audio": "音频",
  "media.filter.stream": "流媒体",
  "media.batchStarted": ({ count = 0, failed = 0 }) => {
    const started = `已开始 ${formatCount(count)} 个下载`;
    return failed ? `${started}，${formatCount(failed)} 个未能开始` : started;
  },
  "media.nothingToDownload": "没有可下载的媒体",
  "media.clearResults": "清空结果",
  "media.clearConfirm": "清空本页的检测结果和已结束的下载？下载记录不受影响。",
  "media.cleared": "已清空结果",

  "media.dialog.link": "链接",
  "media.dialog.linkPlaceholder": "粘贴视频或音频链接",
  "media.dialog.name": "文件名",
  "media.dialog.namePlaceholder": "留空则自动命名",
  "media.dialog.format": "格式",
  "media.dialog.quality": "清晰度",
  "media.format.original": "原格式",
  "media.format.audioOnly": "仅音频",
  "media.format.unavailable": "暂不可用",
  "media.quality.best": "最高清晰度",
  "media.quality.rank": ({ count = 1 }) => `清晰度 ${formatCount(count)}`,
  "media.block.drm": "受版权保护的视频无法保存。",
  "media.block.live": "暂时还不能保存直播。",
  "media.block.discontinuous": "暂时还不能保存这类流媒体。",
  "media.probeFailed": "未能读取清晰度，将使用最高清晰度。",

  "media.engine.finishing": "正在完成设置…",
  "media.engine.restart": "请完全退出并重新打开 Chrome，以完成设置",
  "media.engine.recover": "设置尚未完成",
  "media.engine.missing": "本地引擎尚未安装",
  "media.engine.noResponse": "本地引擎没有响应",
  "media.engine.update": "本地引擎需要更新",
  "media.engine.noConvert": "合并与转换暂不可用",
  "media.engine.ready": "本地引擎已就绪",
  "media.disconnected": "FluxCatch 未响应",

  "media.downloads.empty": "还没有下载。",
  "media.downloads.emptyBody": "点媒体旁的“下载”，或粘贴链接。",
  "media.downloads.noMatch": "没有这一类下载。",
  "media.downloads.noMatchBody": "换一种类型。",
  "media.downloads.loading": "正在读取下载记录…",
  "media.downloads.loadFailed": "无法读取下载记录",
  "media.notificationsOff": "通知已关闭",
  "media.announce": ({ name = "", status = "" }) => `${name}：${status}`
};

/** Display strings (empty-state sentences, set in the Display face): their
 *  Chinese glyphs must be in the bundled Noto Serif SC subset. */
const display = ["media.empty.none", "media.empty.noMatch", "media.empty.unreadable", "media.downloads.empty", "media.downloads.noMatch"];

export default { en, zh, display };
