// Shared presentation for download rows across the popup, the Side Panel and
// the downloads page: time/size formatting, the poster tile and the action
// bar. Pure DOM builders; each page wires its own messaging and feedback.
import { humanBytes } from "../lib/media.js";

export const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"]);

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function statusLabel(status) {
  return ({
    queued: "等待中",
    starting: "准备中",
    downloading: "下载中",
    remuxing: "正在合并",
    pausing: "正在暂停",
    paused: "已暂停",
    completed: "已完成",
    failed: "下载失败",
    cancelled: "已取消"
  })[status] || status || "处理中";
}

export function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`
    : `${minutes}:${String(rest).padStart(2, "0")}`;
}

export function formatClock(timestamp) {
  const date = new Date(Number(timestamp) || Date.now());
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Short relative time for list rows: 刚刚 / N 分钟前 / N 小时前 / 昨天 14:02 / 10月14日. */
export function formatRelativeTime(timestamp, now = Date.now()) {
  const value = Number(timestamp) || 0;
  if (!value) return "";
  const diff = Math.max(0, now - value);
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 6 * 3_600_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  const date = new Date(value);
  const today = new Date(now);
  const sameDay = date.toDateString() === today.toDateString();
  if (sameDay) return formatClock(value);
  const yesterday = new Date(now - 86_400_000);
  if (date.toDateString() === yesterday.toDateString()) return `昨天 ${formatClock(value)}`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

/** Bucket a timestamp for grouped lists on the downloads page. */
export function dayGroupOf(timestamp, now = Date.now()) {
  const value = Number(timestamp) || 0;
  const date = new Date(value);
  const today = new Date(now);
  if (date.toDateString() === today.toDateString()) return "今天";
  if (date.toDateString() === new Date(now - 86_400_000).toDateString()) return "昨天";
  if (now - value < 7 * 86_400_000) return "本周";
  return "更早";
}

export function estimateRemaining(job) {
  const speed = Number(job?.speed) || 0;
  const total = Number(job?.total) || 0;
  const bytes = Number(job?.bytes) || 0;
  if (speed <= 0 || total <= 0 || bytes >= total) return "";
  const seconds = (total - bytes) / speed;
  if (!Number.isFinite(seconds) || seconds > 36_000) return "";
  return `剩余 ${formatDuration(seconds)}`;
}

function kindTileLabel(job) {
  const kind = String(job?.kind || "");
  if (kind === "audio") return "AUDIO";
  if (kind === "hls") return "HLS";
  if (kind === "dash" || kind === "dash_pair") return "DASH";
  if (/\.(?:mp3|m4a|aac|flac|wav|ogg|opus)$/i.test(job?.filename || "")) return "AUDIO";
  return "VIDEO";
}

/** Poster frame when the engine produced one, else the media-type tile. */
export function createJobTile(job, { size = 44 } = {}) {
  if (typeof job?.thumbnail === "string" && job.thumbnail.startsWith("data:image/")) {
    const image = document.createElement("img");
    image.className = "job-thumb";
    image.alt = "";
    image.decoding = "async";
    image.src = job.thumbnail;
    image.style.setProperty("--tile-size", `${size}px`);
    return image;
  }
  const label = kindTileLabel(job);
  const tile = document.createElement("span");
  tile.className = `kind-icon job-tile ${label === "AUDIO" ? "audio" : label === "HLS" || label === "DASH" ? "stream" : "video"}`;
  tile.setAttribute("aria-hidden", "true");
  tile.textContent = label;
  tile.style.setProperty("--tile-size", `${size}px`);
  return tile;
}

/** Facts worth a glance for an ended row, in display order. */
export function finishedMetaParts(job, { message = "" } = {}) {
  const parts = [];
  if (job.status === "completed") {
    const size = Number(job.total) || Number(job.size) || Number(job.bytes) || 0;
    if (size > 0) parts.push(humanBytes(size));
    if (job.media?.duration) parts.push(formatDuration(job.media.duration));
    if (job.media?.height) parts.push(`${job.media.height}p`);
    if (job.sourceHost) parts.push(job.sourceHost);
  } else if (message) {
    parts.push(message);
  }
  const when = formatRelativeTime(job.finishedAt || job.updatedAt);
  if (when) parts.push(when);
  return parts;
}

const ICONS = {
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13M16 5.5v13"/></svg>',
  resume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14l11-7z"/></svg>',
  open: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5v15l14-7.5z"/></svg>',
  reveal: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2H19.5A1.5 1.5 0 0 1 21 8.5v9A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z"/></svg>',
  retry: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4v5h-5"/></svg>',
  source: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6"/><path d="M20 4 10 14"/><path d="M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6"/></svg>',
  remove: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  trash: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="M6 7l1 13h10l1-13"/></svg>'
};

function actionButton({ action, label, title, icon, jobId, filename, primary = false, iconOnly = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `job-action${primary ? " primary-action" : ""}${iconOnly ? " icon-only" : ""}`;
  button.dataset.action = action;
  button.dataset.jobId = jobId;
  button.title = title || label;
  button.setAttribute("aria-label", `${label} ${filename}`.trim());
  button.innerHTML = ICONS[icon] || "";
  if (!iconOnly) {
    const text = document.createElement("span");
    text.textContent = label;
    button.append(text);
  }
  return button;
}

/**
 * Controls for a live or paused transfer: pause while the engine (or Chrome)
 * can keep resumable state, resume a paused row, cancel either. Pages wire
 * ``onControl(action, job, button)`` with one of pause · resume · cancel.
 */
export function createTransferControls(job, onControl) {
  const bar = document.createElement("div");
  bar.className = "job-controls";
  bar.setAttribute("role", "group");
  const filename = job.filename || "媒体";
  const buttons = [];
  if (job.status === "paused") {
    if (job.resumable) buttons.push(controlButton({ action: "resume", label: "继续", icon: "resume", jobId: job.jobId, filename, primary: true }));
  } else if (job.pausable) {
    buttons.push(controlButton({ action: "pause", label: "暂停", icon: "pause", jobId: job.jobId, filename }));
  }
  buttons.push(controlButton({ action: "cancel", label: "取消", icon: null, jobId: job.jobId, filename, danger: true }));
  for (const button of buttons) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onControl(button.dataset.action, job, button);
    });
    bar.append(button);
  }
  return bar;
}

function controlButton({ action, label, icon, jobId, filename, primary = false, danger = false }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `job-control${primary ? " primary-control" : ""}${danger ? " danger-control" : ""}`;
  button.dataset.action = action;
  button.dataset.jobId = jobId;
  button.title = label;
  button.setAttribute("aria-label", `${label} ${filename}`.trim());
  if (icon && ICONS[icon]) button.innerHTML = ICONS[icon];
  const text = document.createElement("span");
  text.textContent = label;
  button.append(text);
  return button;
}

/**
 * Buttons for an ended row. ``onAction(action, job, button)`` receives one of
 * open · reveal · retry · source · trash · remove; pages decide the messaging.
 */
export function createJobActions(job, onAction, { allowTrash = false, allowRemove = true } = {}) {
  const bar = document.createElement("div");
  bar.className = "job-actions";
  bar.setAttribute("role", "group");
  const filename = job.filename || "media";
  const buttons = [];
  if (job.status === "completed") {
    if (job.fileMissing) {
      const missing = document.createElement("span");
      missing.className = "job-missing";
      missing.textContent = "文件已移走";
      bar.append(missing);
    } else if (job.hasFile) {
      buttons.push(actionButton({ action: "open", label: "打开", icon: "open", jobId: job.jobId, filename, primary: true }));
      buttons.push(actionButton({ action: "reveal", label: "在 Finder 中显示", title: "在 Finder 中显示", icon: "reveal", jobId: job.jobId, filename }));
      if (allowTrash) buttons.push(actionButton({ action: "trash", label: "移到废纸篓", icon: "trash", jobId: job.jobId, filename, iconOnly: true }));
    }
  } else {
    if (job.retryable) buttons.push(actionButton({ action: "retry", label: "重试", icon: "retry", jobId: job.jobId, filename, primary: true }));
    if (job.hasSource) buttons.push(actionButton({ action: "source", label: "来源页面", icon: "source", jobId: job.jobId, filename }));
  }
  if (job.status === "completed" && job.hasSource && !buttons.some((item) => item.dataset.action === "source")) {
    buttons.push(actionButton({ action: "source", label: "来源页面", icon: "source", jobId: job.jobId, filename, iconOnly: true }));
  }
  if (allowRemove) buttons.push(actionButton({ action: "remove", label: "从记录中移除", icon: "remove", jobId: job.jobId, filename, iconOnly: true }));
  for (const button of buttons) {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      void onAction(button.dataset.action, job, button);
    });
    bar.append(button);
  }
  return bar;
}

/**
 * Open/reveal a finished file. Chrome-saved files use the downloads API from
 * the page (it needs the click's user gesture); engine-saved files go through
 * the background worker, which asks the local engine.
 */
export async function runFileAction(job, action, call) {
  if (job.method === "browser" && Number.isInteger(job.downloadId) && (action === "open" || action === "reveal")) {
    try {
      if (action === "open") await chrome.downloads.open(job.downloadId);
      else await chrome.downloads.show(job.downloadId);
      return { via: "browser" };
    } catch {
      // Fall through: the worker may still know the published path.
    }
  }
  return call({ type: "FILE_ACTION", action, jobId: job.jobId });
}

/** Active jobs first (newest start on top), then ended jobs by end time. */
export function compareJobs(a, b) {
  const aEnded = isTerminalStatus(a.status);
  const bEnded = isTerminalStatus(b.status);
  if (aEnded !== bEnded) return aEnded ? 1 : -1;
  if (!aEnded) return (b.createdAt || 0) - (a.createdAt || 0);
  return (b.updatedAt || 0) - (a.updatedAt || 0) || (b.createdAt || 0) - (a.createdAt || 0);
}
