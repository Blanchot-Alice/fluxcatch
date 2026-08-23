import { humanBytes } from "../lib/media.js";
import { loadPrivacySafeThumbnail } from "../lib/thumbnail.js";
import { HOST_MISMATCH_MESSAGE } from "../lib/build-profile.js";

const state = {
  tabId: null,
  tabTitle: "当前页面",
  tabUrl: "",
  items: [],
  settings: {},
  jobs: [],
  hostStatus: {},
  refreshToken: 0,
  toastTimer: null
};

const $ = (selector) => document.querySelector(selector);
const port = chrome.runtime.connect({ name: "fluxcatch-sidepanel" });

function isStreamKind(value) {
  const kind = typeof value === "string" ? value : value?.kind;
  return kind === "hls" || kind === "dash" || kind === "dash_pair";
}

function streamTypeLabel(item) {
  return item?.kind === "hls" ? "HLS" : isStreamKind(item) ? "DASH" : String(item?.kind || "MEDIA").toUpperCase();
}

port.onMessage.addListener((message) => {
  if (message?.type === "MEDIA_UPDATED" && message.tabId === state.tabId) {
    void refreshMedia().catch(showError);
  }
  if (message?.type === "HOST_EVENT") updateHost(message.hostStatus || {});
  if (message?.type === "JOB_UPDATED" && message.job?.jobId) {
    const index = state.jobs.findIndex((job) => job.jobId === message.job.jobId);
    const previous = index >= 0 ? state.jobs[index] : null;
    if (index >= 0) state.jobs[index] = message.job;
    else state.jobs.unshift(message.job);
    announceJobChange(previous, message.job);
    sortJobs();
    renderJobs();
  }
  if (message?.type === "JOBS_UPDATED" && Array.isArray(message.jobs)) {
    state.jobs = message.jobs;
    sortJobs();
    renderJobs();
  }
});

port.onDisconnect.addListener(() => {
  showError(chrome.runtime.lastError?.message || "扩展后台已断开，请重新打开工作台");
});

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  await refreshAll();
}

function bindEvents() {
  $("#settingsButton").addEventListener("click", () => {
    void chrome.runtime.openOptionsPage().catch(showError);
  });
  $("#retryButton").addEventListener("click", () => void refreshAll());
  $("#scanButton").addEventListener("click", () => void runAction(async () => {
    if (!Number.isInteger(state.tabId)) throw new Error("当前没有可扫描的页面");
    await call({ type: "SCAN_TAB", tabId: state.tabId });
    showToast("已请求页面重新扫描");
    setTimeout(() => void refreshMedia().catch(showError), 450);
  }));
  $("#pingButton").addEventListener("click", () => void runAction(async () => {
    const result = await call({ type: "PING_HOST" });
    updateHost(result.hostStatus || {});
  }));
  $("#clearCompletedButton").addEventListener("click", () => void runAction(async () => {
    const result = await call({ type: "CLEAR_COMPLETED_JOBS" });
    state.jobs = result.jobs || [];
    sortJobs();
    renderJobs();
    showToast(result.removed ? `已清理 ${result.removed} 个已结束任务` : "没有可清理的已结束任务");
  }));

  chrome.tabs.onActivated?.addListener(() => void refreshAll());
  chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (tabId !== state.tabId) return;
    if (changeInfo.title) {
      state.tabTitle = changeInfo.title;
      renderPageContext();
    }
    if (changeInfo.status === "complete") void refreshAll();
  });
}

async function refreshAll() {
  const token = ++state.refreshToken;
  setLoading(true);
  hideError();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (token !== state.refreshToken) return;
    state.tabId = Number.isInteger(tab?.id) ? tab.id : null;
    state.tabTitle = tab?.title || "当前页面";
    state.tabUrl = tab?.url || "";
    renderPageContext();
    if (!Number.isInteger(state.tabId)) throw new Error("当前窗口没有可读取的活动页面");

    const [mediaResult, jobsResult] = await Promise.all([
      call({ type: "GET_TAB_MEDIA", tabId: state.tabId }),
      call({ type: "GET_JOBS" })
    ]);
    if (token !== state.refreshToken) return;
    state.items = mediaResult.items || [];
    state.settings = mediaResult.settings || {};
    state.jobs = jobsResult.jobs || [];
    state.hostStatus = jobsResult.hostStatus || mediaResult.hostStatus || {};
    sortJobs();
    renderMedia();
    renderJobs();
    updateHost(state.hostStatus);
  } catch (error) {
    if (token === state.refreshToken) showError(error);
  } finally {
    if (token === state.refreshToken) setLoading(false);
  }
}

async function refreshMedia() {
  if (!Number.isInteger(state.tabId)) return;
  const result = await call({ type: "GET_TAB_MEDIA", tabId: state.tabId });
  state.items = result.items || [];
  state.settings = result.settings || state.settings;
  renderMedia();
  if (result.hostStatus) updateHost(result.hostStatus);
}

function renderPageContext() {
  $("#pageTitle").textContent = state.tabTitle || "当前页面";
  $("#pageTitle").title = state.tabTitle || "当前页面";
  $("#pageUrl").textContent = compactPageUrl(state.tabUrl) || "此页面暂不提供地址";
  $("#pageUrl").title = state.tabUrl || "";
}

function renderMedia() {
  const focusedMediaId = document.activeElement?.dataset?.mediaId || "";
  const list = $("#mediaList");
  list.replaceChildren();
  const items = state.items.filter((item) => item.kind !== "segment");
  $("#mediaCount").textContent = String(items.length);
  $("#mediaCount").setAttribute("aria-label", `${items.length} 个媒体`);
  $("#mediaEmpty").hidden = items.length > 0;
  list.hidden = items.length === 0;
  for (const item of items) list.append(createMediaRow(item));
  if (focusedMediaId) {
    const target = [...list.querySelectorAll("button[data-media-id]")].find((button) => button.dataset.mediaId === focusedMediaId);
    target?.focus({ preventScroll: true });
  }
}

function createMediaRow(item) {
  const row = document.createElement("li");
  row.className = "media-row";
  const stream = isStreamKind(item);

  const visual = createMediaVisual(item);

  const main = document.createElement("div");
  main.className = "media-main";
  const title = document.createElement("h3");
  title.className = "media-title";
  title.textContent = item.title || item.suggestedFilename || item.pageTitle || fileLabel(item.url);
  title.title = title.textContent;
  const url = document.createElement("p");
  url.className = "media-url";
  url.textContent = compactMediaUrl(item.url);
  url.title = item.url || "";
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const chip of mediaChips(item)) {
    const node = document.createElement("span");
    node.className = `chip ${chip.className}`.trim();
    node.textContent = chip.label;
    chips.append(node);
  }
  main.append(title, url, chips);

  const side = document.createElement("div");
  side.className = "media-side";
  const age = document.createElement("time");
  age.className = "media-age";
  age.dateTime = item.lastSeen ? new Date(item.lastSeen).toISOString() : "";
  age.textContent = relativeTime(item.lastSeen);
  const download = document.createElement("button");
  download.className = "media-download";
  download.dataset.mediaId = item.id || item.url;
  download.type = "button";
  const youtube = item.kind === "youtube";
  download.textContent = youtube ? "打开下载设置" : "快速下载";
  download.setAttribute("aria-label", youtube ? `打开 ${title.textContent} 的下载设置` : `下载 ${title.textContent}`);
  download.addEventListener("click", () => void runAction(async () => {
    download.disabled = true;
    try {
      // YouTube is an opt-in GitHub-build capability. Its full popup flow
      // checks yt-dlp readiness and requests nativeMessaging in the originating
      // user gesture. Never bypass those gates with Side Panel quick download.
      if (youtube) {
        try {
          if (typeof chrome.action?.openPopup !== "function") throw new Error("openPopup unavailable");
          await chrome.action.openPopup();
        } catch {
          showToast("请点击浏览器工具栏中的 FluxCatch 图标打开下载设置");
        }
        return;
      }
      const advanced = stream || item.provenance !== "observed_response" || Boolean(state.settings.useNativeForDirect);
      if (advanced) {
        // Keep request() inside the originating click gesture. Re-requesting an
        // already granted optional permission resolves without another prompt.
        const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
        if (!granted) throw new Error("请先允许使用高速下载功能，再继续下载");
      }
      const result = await call({ type: "DOWNLOAD", tabId: state.tabId, candidate: item, options: {} });
      showToast(result.method === "native" ? "高速下载任务已开始" : "浏览器下载已开始");
      const jobsResult = await call({ type: "GET_JOBS" });
      state.jobs = jobsResult.jobs || state.jobs;
      sortJobs();
      renderJobs();
    } finally {
      download.disabled = false;
    }
  }));
  side.append(age, download);
  row.append(visual, main, side);
  return row;
}

function createMediaVisual(item) {
  const stream = isStreamKind(item);
  const fallback = document.createElement("span");
  fallback.className = `kind-icon ${stream ? "stream" : item.kind || "video"}`;
  fallback.textContent = stream ? streamTypeLabel(item) : item.kind === "audio" ? "AUDIO" : "VIDEO";
  return loadPrivacySafeThumbnail(item.thumbnailUrl, fallback, {
    allowedThumbnailOrigins: item.thumbnailAllowedOrigins || [],
    adapterImageHosts: item.thumbnailAdapterImageHosts || [],
    networkScope: state.settings.allowPrivateNetworkMedia ? "private_network_opt_in" : "public_only"
  });
}

function renderJobs() {
  const focusedJobId = document.activeElement?.dataset?.jobId || "";
  const list = $("#jobsList");
  list.replaceChildren();
  const active = state.jobs.filter((job) => !isTerminal(job.status)).length;
  const terminal = state.jobs.filter((job) => isTerminal(job.status)).length;
  $("#activeJobCount").textContent = String(active);
  $("#clearCompletedButton").disabled = terminal === 0;
  $("#jobsEmpty").hidden = state.jobs.length > 0;
  list.hidden = state.jobs.length === 0;
  for (const job of state.jobs) list.append(createJobRow(job));
  if (focusedJobId) {
    const target = [...list.querySelectorAll("button[data-job-id]")].find((button) => button.dataset.jobId === focusedJobId);
    target?.focus({ preventScroll: true });
  }
}

function createJobRow(job) {
  const row = document.createElement("li");
  row.className = `job-row ${job.status || "queued"}`;

  const head = document.createElement("div");
  head.className = "job-head";
  const title = document.createElement("h3");
  title.className = "job-title";
  title.textContent = job.filename || "media";
  title.title = title.textContent;
  const stateText = document.createElement("span");
  stateText.className = `job-state ${job.status === "completed" ? "done" : job.status || "queued"}`;
  stateText.textContent = job.status === "downloading" && Number(job.progress) > 0
    ? `${Math.round(clampProgress(job.progress) * 100)}%`
    : statusLabel(job.status);
  head.append(title, stateText);

  const progress = document.createElement("div");
  progress.className = "progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", `${title.textContent} 下载进度`);
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  progress.setAttribute("aria-valuenow", String(Math.round(clampProgress(job.progress) * 100)));
  progress.setAttribute("aria-valuetext", isTerminal(job.status) ? statusLabel(job.status) : `${Math.round(clampProgress(job.progress) * 100)}%`);
  const bar = document.createElement("span");
  bar.style.width = `${Math.round(clampProgress(job.progress) * 100)}%`;
  progress.append(bar);

  const foot = document.createElement("div");
  foot.className = "job-foot";
  const message = document.createElement("span");
  message.className = "job-message";
  message.textContent = friendlyJobMessage(job);
  message.title = message.textContent;
  const speed = document.createElement("span");
  speed.className = "job-speed";
  speed.textContent = !isTerminal(job.status) && Number(job.speed) > 0 ? `${humanBytes(job.speed)}/s` : byteSummary(job);
  foot.append(message, speed);
  if (!isTerminal(job.status)) {
    const cancel = document.createElement("button");
    cancel.className = "cancel-button";
    cancel.dataset.jobId = job.jobId;
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.setAttribute("aria-label", `取消 ${title.textContent}`);
    cancel.addEventListener("click", () => void runAction(async () => {
      cancel.disabled = true;
      try {
        await call({ type: "CANCEL_JOB", jobId: job.jobId });
        showToast("已发送取消请求");
      } catch (error) {
        cancel.disabled = false;
        throw error;
      }
    }));
    foot.append(cancel);
  }
  row.append(head, progress, foot);
  return row;
}

function updateHost(status = {}) {
  state.hostStatus = status;
  const dot = $("#hostDot");
  const mismatch = status.connected && status.compatible !== true;
  dot.className = `status-dot ${status.connected && !mismatch ? "ok" : status.lastError || mismatch ? "bad" : ""}`;
  $("#hostTitle").textContent = mismatch ? "高速下载功能版本不匹配" : status.connected ? "高速下载功能已就绪" : "高速下载功能暂未就绪";
  if (mismatch) {
    $("#hostDetail").textContent = HOST_MISMATCH_MESSAGE;
    return;
  }
  if (!status.connected) {
    $("#hostDetail").textContent = status.needsPermission
      ? "需要加速、合并或转换格式时会请你授权"
      : status.lastError
        ? "暂时不可用；普通文件仍可直接下载"
        : "普通文件仍可直接下载";
    return;
  }
  const ffmpeg = status.capabilities?.ffmpeg;
  const mediaToolsReady = ffmpeg ? Boolean(ffmpeg.available) : status.ffmpeg !== false;
  $("#hostDetail").textContent = mediaToolsReady
    ? "可加速大文件、合并视频片段并转换格式"
    : "可加速大文件；合并视频片段和转换格式尚未就绪";
}

function setLoading(loading) {
  $("#mediaLoading").hidden = !loading;
  $("#jobsLoading").hidden = !loading;
  if (loading) {
    $("#mediaList").hidden = true;
    $("#mediaEmpty").hidden = true;
    $("#jobsList").hidden = true;
    $("#jobsEmpty").hidden = true;
  } else {
    renderMedia();
    renderJobs();
  }
}

function showError(error) {
  const message = friendlyErrorMessage(error?.message || String(error || "读取失败"));
  $("#errorText").textContent = message;
  $("#globalError").hidden = false;
}

function hideError() {
  $("#globalError").hidden = true;
}

async function call(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "扩展请求失败");
  return response;
}

async function runAction(action) {
  try {
    hideError();
    await action();
  } catch (error) {
    showError(error);
  }
}

function showToast(message) {
  const toast = $("#toast");
  clearTimeout(state.toastTimer);
  toast.textContent = String(message || "操作完成");
  toast.hidden = false;
  state.toastTimer = setTimeout(() => { toast.hidden = true; }, 1800);
}

function sortJobs() {
  state.jobs.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function announceJobChange(previous, current) {
  if (previous?.status === current?.status) return;
  $("#jobAnnouncer").textContent = `${current.filename || "媒体"}：${statusLabel(current.status)}`;
}

function mediaChips(item) {
  const stream = isStreamKind(item);
  const chips = [{ label: streamTypeLabel(item), className: stream ? "stream" : "" }];
  if (item.height) chips.push({ label: `${item.height}p`, className: "quality" });
  if (item.contentLength) chips.push({ label: humanBytes(item.contentLength), className: "" });
  if (item.duration) chips.push({ label: formatDuration(item.duration), className: "" });
  return chips;
}

function byteSummary(job) {
  if (Number(job.total) > 0) return `${humanBytes(job.bytes || 0)} / ${humanBytes(job.total)}`;
  if (Number(job.bytes) > 0) return humanBytes(job.bytes);
  return "";
}

function compactPageUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.hostname : url.protocol.replace(":", "");
  } catch {
    return "";
  }
}

function compactMediaUrl(value) {
  try {
    const url = new URL(value);
    return `${url.hostname}${decodeURIComponent(url.pathname)}`;
  } catch {
    return String(value || "");
  }
}

function fileLabel(value) {
  try { return decodeURIComponent(new URL(value).pathname.split("/").pop()) || "media"; }
  catch { return "media"; }
}

function relativeTime(value) {
  const age = Date.now() - Number(value || 0);
  if (!Number.isFinite(age) || age < 0 || !value) return "刚刚";
  if (age < 60_000) return "刚刚";
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  return `${Math.floor(age / 3_600_000)} 小时前`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}` : `${minutes}:${String(rest).padStart(2, "0")}`;
}

function clampProgress(value) {
  const progress = Number(value);
  return Number.isFinite(progress) ? Math.max(0, Math.min(1, progress)) : 0;
}

function isTerminal(status) {
  return ["completed", "failed", "cancelled"].includes(status);
}

function statusLabel(status) {
  return ({
    queued: "等待中",
    starting: "准备中",
    downloading: "下载中",
    remuxing: "正在合并",
    completed: "已完成",
    failed: "失败",
    cancelled: "已取消"
  })[status] || "处理中";
}

function friendlyJobMessage(job) {
  const raw = String(job.message || job.error || "").trim();
  if (!raw) return `${job.method === "browser" ? "浏览器下载" : "高速下载"} · ${statusLabel(job.status)}`;
  if (/FFmpeg/i.test(raw)) return job.status === "failed" ? "视频处理失败，请确认高速下载功能已就绪后重试" : "正在合并视频片段或转换格式";
  if (/DASH/i.test(raw)) return job.status === "failed" ? "这种流媒体暂不支持下载" : raw.replace(/DASH\s*/gi, "");
  return raw.replace(/本地(?:高速)?引擎/g, "高速下载功能");
}

function friendlyErrorMessage(message) {
  const raw = String(message || "操作失败").trim();
  if (/FFmpeg/i.test(raw)) return "此下载需要合并视频片段或转换格式，请确认高速下载功能已就绪后重试。";
  if (/DASH/i.test(raw)) return "这种流媒体暂时不支持下载。";
  return raw.replace(/本地(?:高速)?引擎/g, "高速下载功能");
}
