import { MEDIA_EXTENSIONS, humanBytes, sanitizeFilename } from "../lib/media.js";
import { loadPrivacySafeThumbnail } from "../lib/thumbnail.js";
import { BUILD_PROFILE, HOST_MISMATCH_MESSAGE } from "../lib/build-profile.js";
import { createToastController, isActionPending, restoreFocus, withPendingAction } from "../ui/interactions.js";

const SITE_LABELS = { instagram: "Instagram", twitter: "X" };
const state = { tabId: null, windowId: null, items: [], settings: {}, hostStatus: {}, jobs: new Map(), selected: null, probes: new Map(), filter: "all", refreshSequence: 0, dialogTrigger: null };
const $ = (selector) => document.querySelector(selector);
const mediaList = $("#mediaList");
const emptyState = $("#emptyState");
const jobsList = $("#jobsList");
const jobsEmpty = $("#jobsEmpty");
const dialog = $("#downloadDialog");
const toastController = createToastController($("#toast"));
const port = chrome.runtime.connect({ name: "fluxcatch-popup" });

function isStreamKind(value) {
  const kind = typeof value === "string" ? value : value?.kind;
  return kind === "hls" || kind === "dash" || kind === "dash_pair";
}

function streamTypeLabel(item) {
  return item?.kind === "hls" ? "HLS" : isStreamKind(item) ? "DASH" : String(item?.kind || "MEDIA").toUpperCase();
}

port.onMessage.addListener((message) => {
  if (message?.type === "MEDIA_UPDATED" && message.tabId === state.tabId) void refresh().catch((error) => showToast(error.message));
  if (message?.type === "JOB_UPDATED") consumeJobUpdate(message.job || message.event);
  if (message?.type === "JOBS_UPDATED") replaceJobs(message.jobs || []);
  if (message?.type === "HOST_EVENT") {
    updateHost(message.hostStatus);
    // Older background versions only emit HOST_EVENT. Map-based merging keeps
    // this compatibility path idempotent when JOB_UPDATED is emitted as well.
    consumeJobUpdate(message.event);
  }
});
port.onDisconnect.addListener(() => updateHost(nativeStatusFromError(chrome.runtime.lastError?.message || "扩展后台已断开")));

document.addEventListener("DOMContentLoaded", init);

async function init() {
  bindEvents();
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = tab?.id;
    state.windowId = tab?.windowId;
    await refresh();
    await refreshJobs();
  } catch (error) {
    showToast(error?.message || "读取页面失败");
    emptyState.hidden = false;
  }
  void refreshNativeHost().catch(() => {});
}

function bindEvents() {
  $("#filterSelect").addEventListener("change", (event) => { state.filter = event.target.value; renderMedia(); });
  $("#scanButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, `popup:scan:${state.tabId}`, async () => {
    await call({ type: "SCAN_TAB", tabId: state.tabId });
    await new Promise((resolve) => setTimeout(resolve, 450));
    await refresh();
  }));
  $("#forceButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, `popup:force:${state.tabId}`, async () => {
    await call({ type: "RELOAD_TAB", tabId: state.tabId, bypassCache: true });
    window.close();
  }, { pendingText: "刷新中…", successDurationMs: 0 }));
  $("#clearButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, `popup:clear:${state.tabId}`, async () => {
    const result = await call({ type: "CLEAR_TAB", tabId: state.tabId });
    replaceJobs(result.jobs || []);
    await refresh();
    const active = (result.jobs || []).length;
    showToast(result.removedJobs
      ? `已清空检测结果和 ${result.removedJobs} 个已结束任务${active ? `；${active} 个进行中任务保留` : ""}`
      : `已清空检测结果${active ? `；${active} 个进行中任务保留` : ""}`,
    active ? "warning" : "success");
  }, { pendingText: "清理中…", successText: "已清空 ✓" }));
  $("#folderButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "popup:open-folder", () => call({ type: "SHOW_DOWNLOAD_FOLDER" }), {
    pendingText: "打开中…", successText: "已打开 ✓"
  }));
  $("#workspaceButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, `popup:workspace:${state.windowId}`, async () => {
    if (!Number.isInteger(state.windowId)) throw new Error("当前窗口不可用");
    await chrome.sidePanel.open({ windowId: state.windowId });
    window.close();
  }, { pendingText: "打开中…", successDurationMs: 0 }));
  $("#settingsButton").addEventListener("click", () => void chrome.runtime.openOptionsPage().catch((error) => showToast(error.message)));
  $("#pingButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "popup:ping-host", async () => {
    const host = await refreshNativeHost();
    requireNativeHostReady(host);
  }, { pendingText: "", successText: "✓" }));
  $("#installHelpButton").addEventListener("click", () => void chrome.runtime.openOptionsPage().catch((error) => showToast(error?.message || "无法打开设置页")));
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  for (const [index, button] of tabs.entries()) {
    button.addEventListener("click", () => switchView(button.dataset.view));
    button.addEventListener("keydown", (event) => {
      let nextIndex = null;
      if (event.key === "ArrowRight") nextIndex = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIndex = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIndex = 0;
      else if (event.key === "End") nextIndex = tabs.length - 1;
      if (nextIndex === null) return;
      event.preventDefault();
      const nextTab = tabs[nextIndex];
      switchView(nextTab.dataset.view);
      nextTab.focus();
    });
  }
  $("#downloadForm").addEventListener("submit", submitDownload);
  for (const closeButton of dialog.querySelectorAll("[data-dialog-close]")) {
    closeButton.addEventListener("click", () => dialog.close());
  }
  $("#containerSelect").addEventListener("change", () => {
    $("#filenameInput").value = replaceFilenameExtension($("#filenameInput").value, $("#containerSelect").value);
    syncVariantVisibility();
  });
  dialog.addEventListener("close", () => {
    const trigger = state.dialogTrigger;
    const currentTrigger = findMediaAction(trigger?.dataset?.mediaId, trigger?.dataset?.mediaAction);
    const target = $("#jobsView").hidden ? currentTrigger || trigger || $("#scanButton") : $("#jobsTab");
    state.dialogTrigger = null;
    // Run after the close event finishes without depending on background-page
    // timers, which may be throttled while a synthetic popup loses visibility.
    queueMicrotask(() => restoreFocus(target));
  });
}

async function refresh() {
  if (!Number.isInteger(state.tabId)) return;
  const sequence = ++state.refreshSequence;
  const result = await call({ type: "GET_TAB_MEDIA", tabId: state.tabId });
  if (sequence !== state.refreshSequence) return;
  state.items = (result.items || []).filter((item) => item.kind !== "youtube" || BUILD_PROFILE.features.externalToolNetwork);
  state.settings = result.settings || {};
  $("#mediaCount").textContent = state.items.length;
  updateHost(result.hostStatus || {});
  renderMedia();
}

function renderMedia() {
  const activeAction = document.activeElement?.dataset?.mediaAction || "";
  const activeMediaId = document.activeElement?.dataset?.mediaId || "";
  mediaList.replaceChildren();
  const items = state.items.filter((item) => {
    if (state.filter === "all") return true;
    if (state.filter === "stream") return isStreamKind(item);
    return item.kind === state.filter;
  });
  // 空态只在整体无结果或当前筛选无匹配时出现，避免与可下载卡片同时表达“无媒体”。
  const anyMedia = state.items.length > 0;
  emptyState.hidden = items.length > 0;
  $("#emptyState h2").textContent = anyMedia ? "当前筛选下没有媒体" : "少女祈祷中……";
  $("#emptyState p").textContent = anyMedia ? "尝试切换媒体类型，或强制刷新重新扫描页面。" : "播放视频后自动检测可下载的视频、音频与流媒体";
  for (const item of items) mediaList.append(createMediaCard(item));
  if (activeMediaId && activeAction && !restoreFocus(findMediaAction(activeMediaId, activeAction))) {
    restoreFocus($("#scanButton"));
  }
}

function createMediaCard(item) {
  const card = el("article", "media-card");
  const stream = isStreamKind(item);
  const visual = createMediaVisual(item);
  const info = el("div", "media-info");
  const title = el("h2", "media-title");
  title.textContent = readableMediaTitle(item);
  title.title = title.textContent;
  const url = el("p", "media-url");
  url.textContent = compactUrl(item.displayUrl);
  url.title = item.displayUrl;
  const chips = el("div", "chips");
  for (const { text, cls } of mediaChips(item)) { const chip = el("span", cls ? `chip ${cls}` : "chip"); chip.textContent = text; chips.append(chip); }
  info.append(title, url, chips);
  const actions = el("div", "card-actions");
  const download = el("button", "download-button");
  download.type = "button";
  download.dataset.mediaId = mediaKey(item);
  download.dataset.mediaAction = "download";
  download.textContent = "下载";
  download.setAttribute("aria-label", `下载 ${title.textContent}`);
  download.addEventListener("click", () => void prepareDownload(item, download));
  actions.append(download);
  if (item.copyable === true) {
    const copy = el("button", "more-button");
    copy.type = "button";
    copy.setAttribute("aria-label", `复制 ${title.textContent} 的链接`);
    copy.dataset.mediaId = mediaKey(item);
    copy.dataset.mediaAction = "copy";
    copy.textContent = "复制链接";
    copy.addEventListener("click", () => void runUiAction(
      copy,
      `popup:copy:${mediaKey(item)}`,
      () => navigator.clipboard.writeText(item.displayUrl),
      { pendingText: "", successText: "✓", failureText: "复制失败" }
    ));
    actions.append(copy);
  }
  const manifestStatus = el("div", "manifest-status");
  manifestStatus.setAttribute("role", "status");
  manifestStatus.setAttribute("aria-live", "polite");
  manifestStatus.hidden = true;
  const spinner = el("span", "spinner");
  spinner.setAttribute("aria-hidden", "true");
  const statusText = document.createElement("span");
  statusText.textContent = "正在读取清晰度与流媒体信息…";
  manifestStatus.append(spinner, statusText);
  info.append(manifestStatus);
  card.append(visual, info, actions);
  if (isActionPending(manifestActionKey(item))) setManifestCardLoading(card, download, manifestStatus, true);
  return card;
}

function createMediaVisual(item) {
  const stream = isStreamKind(item);
  const fallback = el("div", `kind-icon ${stream ? "stream" : item.kind || "video"}`);
  fallback.textContent = stream ? streamTypeLabel(item) : item.kind === "audio" ? "♫" : "▶";
  return loadPrivacySafeThumbnail(item.thumbnailUrl, fallback, {
    allowedThumbnailOrigins: item.thumbnailAllowedOrigins || [],
    adapterImageHosts: item.thumbnailAdapterImageHosts || [],
    networkScope: state.settings.allowPrivateNetworkMedia ? "private_network_opt_in" : "public_only"
  });
}

async function prepareDownload(item, button) {
  state.dialogTrigger = button;
  const stream = isStreamKind(item);
  if (!stream) {
    openDownloadDialog(item);
    return;
  }
  const actionKey = manifestActionKey(item);
  if (isActionPending(actionKey)) return;
  const card = button.closest(".media-card");
  const manifestStatus = card?.querySelector(".manifest-status");
  let probeWarning = false;
  try {
    const task = withPendingAction(button, actionKey, async () => {
      const key = mediaKey(item);
      if (!state.probes.has(key)) {
        const result = await call({ type: "PROBE_MANIFEST", tabId: state.tabId, candidate: candidateReference(item) });
        state.probes.set(key, result.probe);
      }
    }, { pendingText: "", successDurationMs: 0, failureDurationMs: 0 });
    setManifestCardLoading(card, null, manifestStatus, true);
    await task;
  } catch (error) {
    probeWarning = true;
  } finally {
    setManifestLoadingForItem(item, false);
  }
  state.dialogTrigger = findMediaAction(mediaKey(item), "download") || button;
  openDownloadDialog(item, { probeWarning });
}

function manifestActionKey(item) {
  return `popup:manifest:${mediaKey(item)}`;
}

function setManifestCardLoading(card, button, status, loading) {
  card?.classList.toggle("manifest-loading", loading);
  if (card) {
    if (loading) card.setAttribute("aria-busy", "true");
    else card.removeAttribute("aria-busy");
  }
  if (status) status.hidden = !loading;
  if (button && loading && !button.hasAttribute("aria-busy")) {
    button.disabled = true;
    button.setAttribute("aria-busy", "true");
    button.setAttribute("data-ui-state", "pending");
    button.textContent = "正在读取…";
  }
  if (button && !loading) {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.removeAttribute("data-ui-state");
    button.textContent = "下载";
  }
}

function setManifestLoadingForItem(item, loading) {
  const button = findMediaAction(mediaKey(item), "download");
  const card = button?.closest(".media-card");
  setManifestCardLoading(card, button, card?.querySelector(".manifest-status"), loading);
}

function manifestDownloadBlockReason(probe) {
  if (probe?.kind === "hls") {
    if (probe.protection === "drm" || probe.protected) return "检测到 DRM/SAMPLE-AES 内容保护，仅显示媒体信息。";
    if (probe.protection === "aes128" || probe.encrypted) return "当前版本暂不支持 AES-128 加密的 HLS 下载。";
    if (probe.type === "media" && probe.live) return "当前版本暂不支持 HLS 直播录制。";
    if (probe.discontinuity) return "当前版本暂不支持包含时间线切换的 HLS 下载。";
    if (Number(probe.audioTrackCount || 0) > 0 || probe.variants?.some((variant) => variant.audioGroup)) {
      return "当前版本暂不支持独立音轨 HLS 下载。";
    }
  }
  if (probe?.protection === "drm" || probe?.protected) return "检测到 DRM/内容保护，受保护内容暂不支持下载。";
  return "";
}

function openDownloadDialog(item, { probeWarning = false } = {}) {
  state.selected = item;
  clearDialogError();
  const containerSelect = $("#containerSelect");
  const pairedDash = item.kind === "dash_pair";
  for (const option of containerSelect.options) option.disabled = pairedDash && ["mkv", "webm"].includes(option.value);
  configureMp3Option(containerSelect);
  const preferredFormat = ["mp4", "mkv", "webm"].includes(state.settings.outputContainer) ? state.settings.outputContainer : "mp4";
  const preferredOption = [...containerSelect.options].find((option) => option.value === preferredFormat);
  const outputFormat = (pairedDash && ["mkv", "webm"].includes(preferredFormat)) || preferredOption?.disabled ? "mp4" : preferredFormat;
  containerSelect.value = outputFormat;
  $("#filenameInput").value = defaultFilename(item, outputFormat);
  $("#nativeDirectInput").checked = Boolean(state.settings.useNativeForDirect);
  $("#nativeDirectInput").closest("label").hidden = isStreamKind(item);
  const probe = state.probes.get(mediaKey(item));
  const variantLabel = $("#variantLabel");
  const variantSelect = $("#variantSelect");
  variantSelect.replaceChildren();
  if (Array.isArray(probe?.variants) && probe.variants.length > 0) {
    const automatic = document.createElement("option");
    automatic.value = "";
    automatic.textContent = "自动选择最高画质";
    variantSelect.append(automatic);
    for (const [index, variant] of probe.variants.entries()) {
      const option = document.createElement("option");
      option.value = variant.url;
      option.textContent = variantOptionLabel(variant, index);
      variantSelect.append(option);
    }
    variantLabel.hidden = false;
  } else variantLabel.hidden = true;
  syncVariantVisibility();
  const manifestBlockReason = manifestDownloadBlockReason(probe);
  $("#confirmDownload").disabled = Boolean(manifestBlockReason);
  $("#dialogNote").style.color = manifestBlockReason ? "var(--warning-strong)" : "";
  $("#dialogNote").textContent = manifestBlockReason
    ? manifestBlockReason
    : probeWarning
      ? "未读取到清晰度选项，将自动选择并生成一个可直接播放的文件。"
    : item.kind === "dash_pair"
        ? "这个网站把画面和声音分开传送。FluxCatch 会分别下载并无损合并，最后保存为一个可以直接播放的文件。"
      : isStreamKind(item)
        ? "这类在线视频由许多小片段组成。FluxCatch 会逐段下载并自动组合，最后保存为一个可直接播放的文件。"
        : "普通文件会直接使用浏览器下载；开启多连接可加速大文件。";
  dialog.showModal();
  queueMicrotask(() => {
    if (dialog.open) $("#filenameInput").focus({ preventScroll: true });
  });
}

function configureMp3Option(containerSelect = $("#containerSelect")) {
  const option = [...(containerSelect?.options || [])].find((candidate) => candidate.value === "mp3");
  if (!option) return;
  const host = state.hostStatus || {};
  const ffmpeg = host.capabilities?.ffmpeg;
  const mismatch = host.connected === true && host.compatible !== true;
  const explicitlyUnavailable = host.connected === true && host.compatible === true
    && (ffmpeg?.available === false || ffmpeg?.encoders?.libmp3lame === false);
  option.disabled = mismatch || explicitlyUnavailable;
  option.textContent = mismatch
    ? "MP3（需更新高速下载功能）"
    : explicitlyUnavailable
      ? "MP3（当前 FFmpeg 不支持）"
      : host.connected === true && ffmpeg?.encoders?.libmp3lame === true
        ? "MP3（仅音频）"
        : "MP3（需高速下载功能）";
}

async function submitDownload(event) {
  event.preventDefault();
  if (event.submitter?.value === "cancel") {
    dialog.close();
    return;
  }
  const item = state.selected;
  if (!item) return dialog.close();
  const outputFormat = $("#containerSelect").value;
  const options = {
    filename: $("#filenameInput").value,
    outputContainer: outputFormat,
    extractAudio: outputFormat === "mp3",
    useNativeForDirect: $("#nativeDirectInput").checked,
    convert: outputFormat === "mp3" || (item.kind === "video" && item.ext && item.ext !== outputFormat),
    variantUrl: $("#variantLabel").hidden ? null : $("#variantSelect").value || null
  };
  const confirm = $("#confirmDownload");
  const actionKey = `popup:start-download:${mediaKey(item)}`;
  if (isActionPending(actionKey)) return;
  clearDialogError();
  try {
    await withPendingAction(confirm, actionKey, async () => {
      const advanced = isStreamKind(item) || item.provenance !== "observed_response"
        || options.extractAudio || options.convert || options.useNativeForDirect;
      if (advanced) {
        const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
        if (!granted) throw new Error("请先允许使用高速下载功能，再继续下载");
        // An optional permission can be granted while the current MV3 worker
        // still has a stale runtime API binding. Probe before sending the job;
        // the settings page owns the single automatic recovery state machine.
        const host = await refreshNativeHost();
        requireNativeHostReady(host);
      }
      const result = await call({ type: "DOWNLOAD", tabId: state.tabId, candidate: candidateReference(item), options });
      dialog.close();
      if (result.method === "native") {
        state.jobs.set(result.jobId, { jobId: result.jobId, filename: options.filename, status: "queued", progress: 0, speed: 0 });
        renderJobs();
        switchView("jobs");
        restoreFocus($("#jobsTab"));
      } else showToast("浏览器下载已开始", "success");
    }, { pendingText: "准备中…", successText: "已开始 ✓", failureText: "下载失败", successDurationMs: 0, failureDurationMs: 0 });
  } catch (error) {
    showDialogError(friendlyErrorMessage(error?.message));
  } finally {
    const probe = state.probes.get(mediaKey(item));
    confirm.disabled = Boolean(manifestDownloadBlockReason(probe));
  }
}

function consumeJobUpdate(event) {
  if (!event?.jobId) return;
  const old = state.jobs.get(event.jobId) || { jobId: event.jobId, filename: event.filename || "media", progress: 0 };
  const changed = Object.entries(event).some(([key, value]) => old[key] !== value);
  if (!changed && state.jobs.has(event.jobId)) return;
  const updated = { ...old, ...event };
  state.jobs.set(event.jobId, updated);
  announceJobChange(old, updated);
  renderJobs();
}

function replaceJobs(jobs) {
  state.jobs.clear();
  for (const job of jobs) if (job?.jobId) state.jobs.set(job.jobId, job);
  renderJobs();
}

async function refreshJobs() {
  const result = await call({ type: "GET_JOBS" });
  replaceJobs(result.jobs || []);
}

function renderJobs() {
  const focusedJobId = document.activeElement?.dataset?.jobId || "";
  jobsList.replaceChildren();
  const jobs = [...state.jobs.values()].reverse();
  jobsEmpty.hidden = jobs.length > 0;
  $("#jobCount").textContent = jobs.length;
  for (const job of jobs) {
    const card = el("article", "job-card");
    const terminal = ["completed", "failed", "cancelled"].includes(job.status);
    if (terminal) card.classList.add("terminal");
    const line = el("div", "job-line");
    const name = document.createElement("strong"); name.textContent = job.filename || "media"; name.title = name.textContent;
    const progressPercent = job.status === "completed" ? 100 : Math.max(0, Math.min(100, Math.round(Number(job.progress || 0) * 100)));
    const percent = document.createElement("span"); percent.className = `job-state ${job.status === "completed" ? "done" : job.status === "failed" ? "bad" : job.status === "cancelled" ? "wait" : "running"}`; percent.textContent = terminal ? statusLabel(job.status) : `${progressPercent}%`;
    line.append(name, percent);
    card.append(line);
    if (terminal) {
      const terminalDetail = String(job.message || job.error || "").trim();
      if (job.status === "failed" && terminalDetail) {
        const meta = el("div", "job-meta");
        const status = document.createElement("span");
        status.className = "job-state bad";
        status.textContent = friendlyJobMessage(job);
        status.title = status.textContent;
        meta.append(status);
        card.append(meta);
      }
      jobsList.append(card);
      continue;
    }
    const progress = el("div", "progress");
    progress.setAttribute("role", "progressbar");
    progress.setAttribute("aria-label", `${job.filename || "媒体"}下载进度`);
    progress.setAttribute("aria-valuemin", "0");
    progress.setAttribute("aria-valuemax", "100");
    progress.setAttribute("aria-valuenow", String(progressPercent));
    progress.setAttribute("aria-valuetext", `${progressPercent}%`);
    const bar = document.createElement("i"); bar.style.width = `${progressPercent}%`; progress.append(bar);
    const meta = el("div", "job-meta"); const status = document.createElement("span"); status.textContent = friendlyJobMessage(job); status.title = status.textContent; const speed = document.createElement("span"); speed.className = "speed"; speed.textContent = job.speed ? `${humanBytes(job.speed)}/s` : ""; meta.append(status, speed);
    const cancel = document.createElement("button");
    cancel.className = "cancel-job";
    cancel.dataset.jobId = job.jobId;
    cancel.type = "button";
    cancel.textContent = "取消";
    cancel.setAttribute("aria-label", `取消 ${job.filename || "媒体"}`);
    cancel.addEventListener("click", () => void runUiAction(cancel, `popup:cancel-job:${job.jobId}`, () => call({ type: "CANCEL_JOB", jobId: job.jobId }), {
      pendingText: "", successText: "✓", successDurationMs: 0
    }));
    meta.append(cancel);
    card.append(progress, meta); jobsList.append(card);
  }
  if (focusedJobId) {
    const target = [...jobsList.querySelectorAll("button[data-job-id]")].find((button) => button.dataset.jobId === focusedJobId);
    if (!restoreFocus(target)) restoreFocus($("#jobsTab"));
  }
}

function announceJobChange(previous, current) {
  if (previous?.status === current?.status) return;
  $("#jobAnnouncer").textContent = `${current.filename || "媒体"}：${statusLabel(current.status)}`;
}

function nativeFailureReasonFromMessage(message) {
  const raw = String(message || "");
  if (/connectNative(?:\s+is not a function)?|chrome\.runtime\.connectNative|尚未加载连接接口|连接接口.*(?:待恢复|尚未就绪)/i.test(raw)) return "api_unavailable";
  if (/specified native messaging host not found|native messaging host.*not found|未安装或未注册/i.test(raw)) return "host_missing";
  return "connection_failed";
}

function nativeStatusFromError(error) {
  const raw = String(error?.message || error || "");
  if (/尚未授权|未获授权|nativeMessaging.*(?:permission|权限)|请先允许使用高速下载功能/i.test(raw)) {
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
  if (status.needsPermission) return "请先允许使用高速下载功能，再继续操作";
  if (status.failureReason === "api_unavailable") {
    return status.recoveryBlocked
      ? "Chrome 尚未恢复高速下载连接接口；请打开 chrome://extensions，重新加载 FluxCatch 后重试"
      : "授权已生效，但 Chrome 的高速下载连接接口尚未就绪；请打开设置页完成自动恢复后重试";
  }
  if (status.failureReason === "host_missing") return "高速下载配套程序尚未安装或未注册；请打开安装方法查看步骤";
  if (status.failureReason === "connection_failed") return "高速下载配套程序连接失败；请重试，仍失败时打开设置页检查";
  if (status.connected && status.compatible !== true) return HOST_MISMATCH_MESSAGE;
  return "高速下载功能暂未就绪；普通文件仍可直接下载";
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
  if (dialog.open) {
    const containerSelect = $("#containerSelect");
    const previous = containerSelect.value;
    configureMp3Option(containerSelect);
    if ([...containerSelect.options].find((option) => option.value === containerSelect.value)?.disabled) {
      containerSelect.value = "mp4";
      if (previous !== containerSelect.value) containerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }
  const dot = $("#hostDot");
  const mismatch = status.connected && status.compatible !== true;
  dot.className = `dot ${status.connected && !mismatch ? "ok" : status.failureReason || status.lastError || mismatch ? "bad" : ""}`;
  $("#hostTitle").textContent = mismatch ? "高速下载功能版本不匹配" : status.connected ? "高速下载功能已就绪" : "高速下载功能暂未就绪";
  const installHelp = $("#installHelpButton");
  const helpReason = mismatch ? "mismatch" : status.failureReason;
  installHelp.hidden = !["mismatch", "api_unavailable", "host_missing", "connection_failed"].includes(helpReason);
  installHelp.textContent = helpReason === "host_missing" ? "安装方法" : helpReason === "mismatch" ? "更新方法" : "打开设置";
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

function switchView(view) {
  for (const button of document.querySelectorAll('[role="tab"]')) {
    const selected = button.dataset.view === view;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
  }
  const mediaActive = view === "media";
  $("#mediaView").classList.toggle("active", mediaActive);
  $("#mediaView").hidden = !mediaActive;
  $("#jobsView").classList.toggle("active", !mediaActive);
  $("#jobsView").hidden = mediaActive;
  $("#filterSelect").hidden = view !== "media";
}

async function call(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "扩展请求失败");
  return response;
}

function mediaChips(item) {
  const stream = isStreamKind(item);
  const values = [{ text: streamTypeLabel(item), cls: stream ? "hls" : "fmt" }];
  if (item.site && SITE_LABELS[item.site]) values.push({ text: SITE_LABELS[item.site], cls: "fmt" });
  if (item.height) values.push({ text: `${item.height}p`, cls: "hd" });
  if (!stream && item.contentLength) values.push({ text: humanBytes(item.contentLength), cls: "" });
  if (item.duration) values.push({ text: formatDuration(item.duration), cls: "" });
  if (!stream && item.rangeSupported) values.push({ text: "支持多连接", cls: "" });
  return values;
}

function syncVariantVisibility() {
  const hasChoices = $("#variantSelect").options.length > 0;
  $("#variantLabel").hidden = !hasChoices || $("#containerSelect").value === "mp3";
}

function mediaKey(item) { return item.id || item.displayUrl; }

function findMediaAction(mediaId, action) {
  const normalizedId = String(mediaId ?? "");
  return [...mediaList.querySelectorAll("button[data-media-id][data-media-action]")]
    .find((button) => button.dataset.mediaId === normalizedId && button.dataset.mediaAction === action) || null;
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
function defaultFilename(item, format) {
  const title = readableMediaTitle(item);
  const match = title.match(/\.([a-z0-9]{1,8})$/i);
  const base = match && MEDIA_EXTENSIONS.has(match[1].toLowerCase()) ? title.slice(0, -match[0].length) : title;
  return `${sanitizeFilename(base)}.${format}`;
}
function replaceFilenameExtension(filename, format) {
  const source = String(filename || "media").trim() || "media";
  return `${source.replace(/\.[a-z0-9]{1,8}$/i, "")}.${format}`;
}
function variantOptionLabel(variant, index) {
  const resolution = variant.width && variant.height
    ? `${variant.width} × ${variant.height}（${variant.height}p）`
    : variant.height ? `${variant.height}p` : variant.name || `清晰度 ${index + 1}`;
  const bitrate = variant.bandwidth ? `${(variant.bandwidth / 1e6).toFixed(2)} Mbps` : "";
  return [resolution, bitrate].filter(Boolean).join(" · ");
}
function fileLabel(url) { try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || "media"; } catch { return "media"; } }
function compactUrl(url) { try { const u = new URL(url); return `${u.hostname}${decodeURIComponent(u.pathname)}`; } catch { return url; } }
function formatDuration(seconds) { const s = Math.round(seconds); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function statusLabel(status) { return ({ queued: "等待中", starting: "准备中", downloading: "下载中", remuxing: "正在合并", completed: "已完成", failed: "下载失败", cancelled: "已取消" })[status] || status || "处理中"; }
function friendlyJobMessage(job) {
  const raw = String(job.message || job.error || "").trim();
  if (!raw) return statusLabel(job.status);
  if (/FFmpeg/i.test(raw)) return job.status === "failed" ? "视频处理失败，请确认高速下载功能已就绪后重试" : "正在合并视频片段或转换格式";
  if (/DASH/i.test(raw)) return job.status === "failed" ? "这种流媒体暂不支持下载" : raw.replace(/DASH\s*/gi, "");
  return raw.replace(/本地(?:高速)?引擎/g, "高速下载功能");
}
function friendlyErrorMessage(message) {
  const raw = String(message || "下载失败").trim();
  if (/FFmpeg/i.test(raw)) return "此下载需要合并视频片段或转换格式，请确认高速下载功能已就绪后重试。";
  if (/DASH/i.test(raw)) return "这种流媒体暂时不支持下载。";
  if (/connectNative|native messaging|尚未授权连接本地引擎|本地(?:高速)?引擎.*(?:安装|注册|连接)|Chrome.*连接接口/i.test(raw)) {
    return nativeHostIssueMessage(nativeStatusFromError(raw));
  }
  return raw.replace(/本地(?:高速)?引擎/g, "高速下载功能");
}
function el(tag, className) { const node = document.createElement(tag); if (className) node.className = className; return node; }
function clearDialogError() {
  const error = $("#dialogError");
  error.textContent = "";
  error.hidden = true;
}
function showDialogError(message) {
  const error = $("#dialogError");
  error.textContent = String(message || "下载失败");
  error.hidden = false;
}
async function runUiAction(element, key, action, options = {}) {
  try {
    return await withPendingAction(element, key, action, { successDurationMs: 500, failureDurationMs: 0, ...options });
  } catch (error) {
    showToast(friendlyErrorMessage(error?.message || "操作失败"), "error");
    return undefined;
  }
}
function showToast(message, type = "error") {
  const method = ["success", "warning", "error"].includes(type) ? type : "error";
  return toastController[method](String(message || "操作失败"));
}
