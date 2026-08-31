import { humanBytes } from "../lib/media.js";
import { loadPrivacySafeThumbnail } from "../lib/thumbnail.js";
import { BUILD_PROFILE, HOST_MISMATCH_MESSAGE } from "../lib/build-profile.js";
import { friendlyDashMessage } from "../lib/job-presentation.js";
import { createToastController, restoreFocus, withPendingAction } from "../ui/interactions.js";
import { captureMediaRefresh, isMediaRefreshCurrent } from "./refresh-guard.js";
import { bindUiI18n } from "../ui/i18n.js";

let domContentLoadedFired = false;
document.addEventListener("DOMContentLoaded", () => { domContentLoadedFired = true; }, { once: true });
await bindUiI18n();

const state = {
  tabId: null,
  tabTitle: "当前页面",
  tabUrl: "",
  items: [],
  settings: {},
  jobs: [],
  hostStatus: {},
  refreshToken: 0,
  lastJobAnnouncementKey: ""
};

const $ = (selector) => document.querySelector(selector);
const port = chrome.runtime.connect({ name: "fluxcatch-sidepanel" });
const toastController = createToastController($("#toast"));

function isStreamKind(value) {
  const kind = typeof value === "string" ? value : value?.kind;
  return kind === "hls" || kind === "dash" || kind === "dash_pair";
}

function isTrustedInstagramBrowserItem(item) {
  if (item?.site !== "instagram"
      || item?.kind !== "video"
      || !["site_payload", "dom_metadata", "observed_response"].includes(item?.provenance)) return false;
  try {
    const url = new URL(item.displayUrl);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (hostname === "cdninstagram.com" || hostname.endsWith(".cdninstagram.com") || hostname === "fbcdn.net" || hostname.endsWith(".fbcdn.net"))
      && /\.mp4$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function isTrustedXBrowserItem(item) {
  if (item?.site !== "twitter" || item?.kind !== "video" || !["site_payload", "observed_response"].includes(item?.provenance)) return false;
  const hinted = item.provenance === "observed_response"
    || item.source === "x-api-response"
    || item.source === "site-payload"
    || item.sources?.includes("x-api-response")
    || item.sources?.includes("site-payload");
  if (!hinted) return false;
  try {
    const url = new URL(item.displayUrl);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "video.twimg.com";
  } catch {
    return false;
  }
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
  $("#settingsButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "sidepanel:open-settings", () => chrome.runtime.openOptionsPage(), {
    labelElement: event.currentTarget.querySelector("[data-action-label]")
  }));
  $("#downloadSettingsButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "sidepanel:download-settings", () => chrome.runtime.openOptionsPage(), {
    pendingText: "打开中…", successText: "已打开"
  }));
  $("#retryButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "sidepanel:retry", () => refreshAll({ propagateError: true }), {
    pendingText: "", successText: "完成"
  }));
  $("#scanButton").addEventListener("click", (event) => {
    const trigger = event.currentTarget;
    void runUiAction(trigger, `sidepanel:scan:${state.tabId}`, async () => {
      if (!Number.isInteger(state.tabId)) throw new Error("当前没有可扫描的页面");
      await call({ type: "SCAN_TAB", tabId: state.tabId });
      await new Promise((resolve) => setTimeout(resolve, 450));
      await refreshMedia();
      showToast("页面扫描结果已更新", "success");
    }, { pendingText: "", successText: "已扫描" });
  });
  $("#pingButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "sidepanel:ping-host", async () => {
    const host = await refreshNativeHost();
    requireNativeHostReady(host);
    showToast("本地下载引擎状态已更新", "success");
  }, { pendingText: "", successText: "完成" }));
  $("#clearCompletedButton").addEventListener("click", async (event) => {
    const result = await runUiAction(event.currentTarget, "sidepanel:clear-completed", () => call({ type: "CLEAR_COMPLETED_JOBS" }), {
      pendingText: "", successText: "已清理"
    });
    if (!result) return;
    state.jobs = result.jobs || [];
    sortJobs();
    renderJobs();
    showToast(result.removed ? `已清理 ${result.removed} 个已结束任务` : "没有可清理的已结束任务", result.removed ? "success" : "warning");
    if ($("#clearCompletedButton").disabled) restoreFocus($("#scanButton"));
  });

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

async function refreshAll({ propagateError = false } = {}) {
  const token = ++state.refreshToken;
  let succeeded = false;
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
    state.items = (mediaResult.items || []).filter((item) => item.kind !== "youtube" || BUILD_PROFILE.features.externalToolNetwork);
    state.settings = mediaResult.settings || {};
    state.jobs = jobsResult.jobs || [];
    state.hostStatus = jobsResult.hostStatus || mediaResult.hostStatus || {};
    sortJobs();
    updateHost(state.hostStatus);
    succeeded = true;
  } catch (error) {
    if (token !== state.refreshToken) return;
    showError(error);
    if (propagateError) throw error;
  } finally {
    if (token === state.refreshToken) setLoading(false, { render: succeeded });
  }
}

async function refreshMedia() {
  const request = captureMediaRefresh(state);
  if (!Number.isInteger(request.tabId)) return;
  const result = await call({ type: "GET_TAB_MEDIA", tabId: request.tabId });
  if (!isMediaRefreshCurrent(request, state)) return;
  state.items = (result.items || []).filter((item) => item.kind !== "youtube" || BUILD_PROFILE.features.externalToolNetwork);
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
    restoreFocus(target || $("#scanButton"));
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
  title.textContent = readableMediaTitle(item);
  title.title = title.textContent;
  const url = document.createElement("p");
  url.className = "media-url";
  url.textContent = compactMediaUrl(item.displayUrl);
  url.title = item.displayUrl || "";
  const chips = document.createElement("div");
  chips.className = "chips";
  for (const chip of mediaChips(item)) {
    const node = document.createElement("span");
    node.className = `chip ${chip.className}`.trim();
    node.textContent = chip.label;
    chips.append(node);
  }
  main.append(title, url, chips);

  const variantSelect = createVariantSelect(item);
  if (variantSelect) main.append(variantSelect);

  const side = document.createElement("div");
  side.className = "media-side";
  const age = document.createElement("time");
  age.className = "media-age";
  age.dateTime = item.lastSeen ? new Date(item.lastSeen).toISOString() : "";
  age.textContent = relativeTime(item.lastSeen);
  const download = document.createElement("button");
  download.className = "media-download";
  download.dataset.mediaId = item.id || item.displayUrl;
  download.type = "button";
  const advanced = mediaNeedsLocalEngine(item);
  download.textContent = advanced ? "检查并下载" : "按默认设置下载";
  download.setAttribute("aria-label", `${download.textContent}：${title.textContent}`);
  if (advanced) download.setAttribute("aria-describedby", "localEngineBoundary");
  download.addEventListener("click", () => void runUiAction(download, `sidepanel:quick-download:${item.id || item.displayUrl}`, async () => {
    if (advanced) {
      // Keep request() inside the originating click gesture. Re-requesting an
      // already granted optional permission resolves without another prompt.
      const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
      if (!granted) throw new Error("请先允许使用本地下载引擎，再继续下载");
      // Probe after the gesture-bound grant. When Chrome has not refreshed
      // the API binding yet, direct the user to the settings-owned recovery
      // flow instead of exposing a runtime TypeError or starting a doomed job.
      const host = await refreshNativeHost();
      requireNativeHostReady(host);
    }
    const options = stream ? {} : { outputContainer: "original", outputFormat: "original", convert: false, extractAudio: false };
    const result = await call({ type: "DOWNLOAD", tabId: state.tabId, candidate: candidateReference(item), options });
    showToast(result.method === "native" ? "本地下载任务已开始" : "浏览器下载已开始", "success");
    const jobsResult = await call({ type: "GET_JOBS" });
    state.jobs = jobsResult.jobs || state.jobs;
    sortJobs();
    renderJobs();
  }, { pendingText: "", successText: "已开始" }));
  side.append(age, download);
  row.append(visual, main, side);
  return row;
}

function createMediaVisual(item) {
  const stream = isStreamKind(item);
  const fallback = document.createElement("span");
  fallback.className = `kind-icon ${stream ? "stream" : item.kind || "video"}`;
  fallback.textContent = stream ? streamTypeLabel(item) : item.kind === "audio" ? "AUDIO" : "VIDEO";
  fallback.setAttribute("aria-hidden", "true");
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
    if (!restoreFocus(target || $("#clearCompletedButton"))) restoreFocus($("#settingsButton"));
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
    cancel.addEventListener("click", () => void runUiAction(cancel, `sidepanel:cancel-job:${job.jobId}`, async () => {
      await call({ type: "CANCEL_JOB", jobId: job.jobId });
      showToast("已发送取消请求", "success");
    }, { pendingText: "", successText: "✓" }));
    foot.append(cancel);
  }
  row.append(head, progress, foot);
  return row;
}

function nativeFailureReasonFromMessage(message) {
  const raw = String(message || "");
  if (/connectNative(?:\s+is not a function)?|chrome\.runtime\.connectNative|尚未加载连接接口|连接接口.*(?:待恢复|尚未就绪)/i.test(raw)) return "api_unavailable";
  if (/specified native messaging host not found|native messaging host.*not found|未安装或未注册/i.test(raw)) return "host_missing";
  return "connection_failed";
}

function nativeStatusFromError(error) {
  const raw = String(error?.message || error || "");
  if (/尚未授权|未获授权|nativeMessaging.*(?:permission|权限)|请先允许使用(?:本地下载引擎|高速下载功能)/i.test(raw)) {
    return { connected: false, needsPermission: true, failureReason: null, lastError: null };
  }
  const failureReason = nativeFailureReasonFromMessage(raw);
  return { connected: false, needsPermission: false, failureReason, lastError: nativeHostIssueMessage({ failureReason }) };
}

function normalizeNativeHostStatus(status = {}) {
  status = status && typeof status === "object" ? status : {};
  if (status.needsPermission) return { ...status, failureReason: null, lastError: null };
  if (status.connected || ["api_unavailable", "host_missing", "connection_failed"].includes(status.failureReason)) return status;
  if (!status.lastError) return status;
  const failureReason = nativeFailureReasonFromMessage(status.lastError);
  return { ...status, failureReason, lastError: nativeHostIssueMessage({ failureReason }) };
}

function nativeHostIssueMessage(status = {}) {
  if (status.needsPermission) return "请先允许使用本地下载引擎，再继续操作";
  if (status.failureReason === "api_unavailable") {
    return status.recoveryBlocked || status.restartRequired
      ? "Chrome 尚未恢复本地下载引擎连接接口；请完全退出并重新启动 Chrome 后重试"
      : "授权已生效，但 Chrome 的本地下载引擎连接接口尚未就绪；请打开设置页完成自动恢复后重试";
  }
  if (status.failureReason === "host_missing") return "本地下载引擎程序尚未安装或未注册；请打开设置页查看安装步骤";
  if (status.failureReason === "connection_failed") return "本地下载引擎程序连接失败；请重试，仍失败时打开设置页检查";
  if (status.connected && status.compatible !== true) return HOST_MISMATCH_MESSAGE;
  return "本地下载引擎暂未就绪；媒体检测与预览仍可用，多数保存需先开启引擎";
}

function requireNativeHostReady(status = {}) {
  if (!status.connected || status.needsPermission) throw new Error(nativeHostIssueMessage(status));
  if (status.compatible !== true) throw new Error(HOST_MISMATCH_MESSAGE);
  return status;
}

async function refreshNativeHost() {
  try {
    const result = await call({ type: "PING_HOST" });
    const host = normalizeNativeHostStatus(result.hostStatus || {});
    updateHost(host);
    return host;
  } catch (error) {
    const host = nativeStatusFromError(error);
    updateHost(host);
    throw new Error(nativeHostIssueMessage(host));
  }
}

function updateHost(status = {}) {
  status = normalizeNativeHostStatus(status);
  state.hostStatus = status;
  const dot = $("#hostDot");
  const mismatch = status.connected && status.compatible !== true;
  dot.className = `status-dot ${status.connected && !mismatch ? "ok" : status.failureReason || status.lastError || mismatch ? "bad" : ""}`;
  $("#hostTitle").textContent = mismatch ? "本地下载引擎版本不匹配" : status.connected ? "本地下载引擎已就绪" : "本地下载引擎暂未就绪";
  if (mismatch) {
    $("#hostDetail").textContent = HOST_MISMATCH_MESSAGE;
    return;
  }
  if (!status.connected) {
    $("#hostDetail").textContent = status.needsPermission
      ? "尚未开启；需要加速、合并或转换格式时会请你授权"
      : nativeHostIssueMessage(status);
    return;
  }
  const ffmpeg = status.capabilities?.ffmpeg;
  const mediaToolsReady = ffmpeg ? Boolean(ffmpeg.available) : status.ffmpeg !== false;
  $("#hostDetail").textContent = mediaToolsReady
    ? "可加速大文件、合并视频片段并转换格式"
    : "可加速大文件；合并视频片段和转换格式尚未就绪";
}

function setLoading(loading, { render = !loading } = {}) {
  const main = document.querySelector("main");
  if (loading) main.setAttribute("aria-busy", "true");
  else main.removeAttribute("aria-busy");
  $("#mediaLoading").hidden = !loading;
  $("#jobsLoading").hidden = !loading;
  if (loading) {
    $("#mediaList").hidden = true;
    $("#mediaEmpty").hidden = true;
    $("#jobsList").hidden = true;
    $("#jobsEmpty").hidden = true;
  } else if (render) {
    renderMedia();
    renderJobs();
  }
}

function mediaNeedsLocalEngine(item) {
  const trustedBrowserDirect = isTrustedInstagramBrowserItem(item) || isTrustedXBrowserItem(item);
  return isStreamKind(item)
    || !trustedBrowserDirect
    || Boolean(state.settings.useNativeForDirect);
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
  if (!response?.ok) {
    const error = new Error(response?.error || "扩展请求失败");
    if (typeof response?.jobId === "string" && response.jobId) error.jobId = response.jobId;
    throw error;
  }
  return response;
}

async function runUiAction(element, key, action, options = {}) {
  try {
    hideError();
    return await withPendingAction(element, key, action, { successDurationMs: 500, failureDurationMs: 0, ...options });
  } catch (error) {
    let representedByJob = false;
    if (error?.jobId) {
      try {
        const result = await call({ type: "GET_JOBS" });
        state.jobs = result.jobs || state.jobs;
        sortJobs();
        renderJobs();
        const representedJob = state.jobs.find((job) => job.jobId === error.jobId);
        representedByJob = Boolean(representedJob);
        if (representedJob) announceJobChange(null, representedJob);
      } catch { /* Keep the inline error when task refresh is unavailable. */ }
    }
    // A failed job card and a global alert would repeat the same failure.
    // Keep the alert only when no durable task row represents this error.
    if (!representedByJob) showError(error);
    restoreFocus(element);
    return undefined;
  }
}

function showToast(message, type = "success") {
  const method = ["success", "warning", "error"].includes(type) ? type : "error";
  return toastController[method](String(message || "操作完成"));
}

function sortJobs() {
  state.jobs.sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0));
}

function announceJobChange(previous, current) {
  if (!current || previous?.status === current.status) return;
  const key = `${current.jobId || current.updatedAt || current.filename || "media"}:${current.status || ""}`;
  if (state.lastJobAnnouncementKey === key) return;
  state.lastJobAnnouncementKey = key;
  const announcement = `${current.filename || "媒体"}：${statusLabel(current.status)}`;
  const announcer = $("#jobAnnouncer");
  announcer.textContent = "";
  queueMicrotask(() => {
    if (state.lastJobAnnouncementKey === key) announcer.textContent = announcement;
  });
}

function mediaChips(item) {
  const stream = isStreamKind(item);
  const chips = [{ label: streamTypeLabel(item), className: stream ? "stream" : "" }];
  if (item.height) chips.push({ label: `${item.height}p`, className: "quality" });
  const grouped = Array.isArray(item.variants) && item.variants.length > 0;
  if (item.trackHints
    && item.trackHints.video === false
    && item.trackHints.audio === true
    && !grouped) {
    chips.push({ label: "仅音频", className: "quality" });
  }
  if (item.contentLength) chips.push({ label: humanBytes(item.contentLength), className: "" });
  if (item.duration) chips.push({ label: formatDuration(item.duration), className: "" });
  return chips;
}

// Mirrors the popup's master-playlist quality labels for rendition groups:
// 「MP4 · 1920×1080」 when a height is known, otherwise the declared bitrate.
function variantOptionLabel(variant) {
  const height = Math.round(Number(variant?.height) || 0);
  if (height > 0) {
    const width = Math.round(Number(variant?.width) || 0);
    return width > 0 ? `MP4 · ${width}×${height}` : `MP4 · ${height}p`;
  }
  const bandwidth = Number(variant?.bandwidth) || 0;
  if (bandwidth > 0) {
    const mbps = bandwidth / 1_000_000;
    return `MP4 · ${mbps >= 10 ? String(Math.round(mbps)) : mbps.toFixed(1)} Mbps`;
  }
  return "MP4 · 自动画质";
}

// Rendition-style group cards carry their quality ladder directly on the
// candidate (same opaque selectors the download dialog uses). The ladder is
// ranked best-first, so leaving the native <select> untouched means "highest".
function createVariantSelect(item) {
  if (item.kind !== "hls" || !Array.isArray(item.variants) || item.variants.length === 0) return null;
  const select = document.createElement("select");
  select.className = "variant-select";
  select.dataset.variantFor = item.id || item.displayUrl;
  select.setAttribute("aria-label", `选择清晰度：${readableMediaTitle(item)}`);
  for (const variant of item.variants) {
    const option = document.createElement("option");
    option.value = variant.url;
    option.textContent = variantOptionLabel(variant);
    select.append(option);
  }
  return select;
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

function candidateReference(item) {
  return { id: item?.id, kind: item?.kind, generation: item?.generation };
}

function readableMediaTitle(item) {
  for (const value of [item.displayTitle, item.title, item.suggestedFilename, item.pageTitle]) {
    const title = String(value || "").trim();
    if (title) return title;
  }
  return fileLabel(item.displayUrl);
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
  if (!raw) return `${job.method === "browser" ? "浏览器下载" : "本地下载"} · ${statusLabel(job.status)}`;
  if (/FFmpeg/i.test(raw)) return job.status === "failed" ? "视频处理失败，请确认本地下载引擎已就绪后重试" : "正在合并视频片段或转换格式";
  const dashMessage = friendlyDashMessage(raw, { failed: job.status === "failed" });
  if (dashMessage) return dashMessage;
  return raw.replace(/高速下载功能|本地(?:高速|下载)?引擎/g, "本地下载引擎");
}

function friendlyErrorMessage(message) {
  const raw = String(message || "操作失败").trim();
  if (/FFmpeg/i.test(raw)) return "此下载需要合并视频片段或转换格式，请确认本地下载引擎已就绪后重试。";
  const dashMessage = friendlyDashMessage(raw, { failed: true });
  if (dashMessage) return dashMessage;
  if (/connectNative|native messaging|尚未授权连接本地引擎|本地(?:高速|下载)?引擎.*(?:安装|注册|连接)|Chrome.*连接接口/i.test(raw)) {
    return nativeHostIssueMessage(nativeStatusFromError(raw));
  }
  return raw.replace(/高速下载功能|本地(?:高速|下载)?引擎/g, "本地下载引擎");
}

// A module script normally finishes before DOMContentLoaded, but the await above
// can suspend evaluation past the event; run initialization now only if it fired.
if (domContentLoadedFired) void init();
