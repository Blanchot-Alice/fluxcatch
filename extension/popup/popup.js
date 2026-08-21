import { MEDIA_EXTENSIONS, humanBytes, sanitizeFilename } from "../lib/media.js";
import { loadPrivacySafeThumbnail } from "../lib/thumbnail.js";

const SITE_LABELS = { instagram: "Instagram", twitter: "X", youtube: "YouTube" };
const state = { tabId: null, windowId: null, items: [], settings: {}, hostStatus: {}, jobs: new Map(), selected: null, probes: new Map(), filter: "all", toastTimer: null, refreshSequence: 0 };
const $ = (selector) => document.querySelector(selector);
const mediaList = $("#mediaList");
const emptyState = $("#emptyState");
const jobsList = $("#jobsList");
const jobsEmpty = $("#jobsEmpty");
const dialog = $("#downloadDialog");
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
port.onDisconnect.addListener(() => updateHost({ connected: false, lastError: chrome.runtime.lastError?.message || "扩展后台已断开" }));

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
  void call({ type: "PING_HOST" }).then((result) => updateHost(result.hostStatus)).catch((error) => updateHost({ connected: false, lastError: error.message }));
}

function bindEvents() {
  $("#filterSelect").addEventListener("change", (event) => { state.filter = event.target.value; renderMedia(); });
  $("#scanButton").addEventListener("click", () => runUiAction(async () => { await call({ type: "SCAN_TAB", tabId: state.tabId }); setTimeout(() => void refresh().catch((error) => showToast(error.message)), 450); }));
  $("#forceButton").addEventListener("click", () => runUiAction(async () => { await call({ type: "RELOAD_TAB", tabId: state.tabId, bypassCache: true }); window.close(); }));
  $("#clearButton").addEventListener("click", () => runUiAction(async () => {
    const result = await call({ type: "CLEAR_TAB", tabId: state.tabId });
    replaceJobs(result.jobs || []);
    await refresh();
    const active = (result.jobs || []).length;
    showToast(result.removedJobs
      ? `已清空检测结果和 ${result.removedJobs} 个已结束任务${active ? `；${active} 个进行中任务保留` : ""}`
      : `已清空检测结果${active ? `；${active} 个进行中任务保留` : ""}`);
  }));
  $("#folderButton").addEventListener("click", () => runUiAction(() => call({ type: "SHOW_DOWNLOAD_FOLDER" })));
  $("#workspaceButton").addEventListener("click", () => runUiAction(async () => {
    if (!Number.isInteger(state.windowId)) throw new Error("当前窗口不可用");
    await chrome.sidePanel.open({ windowId: state.windowId });
    window.close();
  }));
  $("#settingsButton").addEventListener("click", () => void chrome.runtime.openOptionsPage().catch((error) => showToast(error.message)));
  $("#pingButton").addEventListener("click", () => call({ type: "PING_HOST" }).then((result) => updateHost(result.hostStatus)).catch((error) => updateHost({ connected: false, lastError: error.message })));
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
  $("#containerSelect").addEventListener("change", () => {
    $("#filenameInput").value = replaceFilenameExtension($("#filenameInput").value, $("#containerSelect").value);
    syncVariantVisibility();
  });
}

async function refresh() {
  if (!Number.isInteger(state.tabId)) return;
  const sequence = ++state.refreshSequence;
  const result = await call({ type: "GET_TAB_MEDIA", tabId: state.tabId });
  if (sequence !== state.refreshSequence) return;
  state.items = result.items || [];
  state.settings = result.settings || {};
  $("#mediaCount").textContent = state.items.length;
  updateHost(result.hostStatus || {});
  renderMedia();
}

function renderMedia() {
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
  url.textContent = compactUrl(item.url);
  url.title = item.url;
  const chips = el("div", "chips");
  for (const { text, cls } of mediaChips(item)) { const chip = el("span", cls ? `chip ${cls}` : "chip"); chip.textContent = text; chips.append(chip); }
  info.append(title, url, chips);
  const actions = el("div", "card-actions");
  const download = el("button", "download-button");
  download.textContent = "下载";
  download.addEventListener("click", () => void prepareDownload(item, download));
  actions.append(download);
  if (!stream) {
    const copy = el("button", "more-button");
    copy.textContent = "复制链接";
    copy.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(item.url);
        copy.textContent = "已复制";
        setTimeout(() => { if (copy.isConnected) copy.textContent = "复制链接"; }, 1000);
      } catch (error) {
        showToast(error?.message || "复制失败");
      }
    });
    actions.append(copy);
  }
  card.append(visual, info, actions);
  return card;
}

function createMediaVisual(item) {
  const stream = isStreamKind(item);
  const fallback = el("div", `kind-icon ${stream ? "stream" : item.kind || "video"}`);
  fallback.textContent = stream ? streamTypeLabel(item) : item.kind === "audio" ? "♫" : "▶";
  return loadPrivacySafeThumbnail(item.thumbnailUrl, fallback);
}

async function prepareDownload(item, button) {
  const stream = isStreamKind(item);
  if (!stream) {
    openDownloadDialog(item);
    return;
  }
  const originalText = button.textContent;
  let probeWarning = false;
  button.disabled = true;
  button.textContent = "正在读取…";
  button.setAttribute("aria-busy", "true");
  try {
    const key = mediaKey(item);
    if (!state.probes.has(key)) {
      const result = await call({ type: "PROBE_MANIFEST", tabId: state.tabId, candidate: item });
      state.probes.set(key, result.probe);
    }
  } catch (error) {
    probeWarning = true;
  } finally {
    button.disabled = false;
    button.textContent = originalText;
    button.removeAttribute("aria-busy");
  }
  openDownloadDialog(item, { probeWarning });
}

function openDownloadDialog(item, { probeWarning = false } = {}) {
  state.selected = item;
  const containerSelect = $("#containerSelect");
  const pairedDash = item.kind === "dash_pair";
  for (const option of containerSelect.options) option.disabled = pairedDash && ["mkv", "webm"].includes(option.value);
  const preferredFormat = ["mp4", "mkv", "webm"].includes(state.settings.outputContainer) ? state.settings.outputContainer : "mp4";
  const outputFormat = pairedDash && ["mkv", "webm"].includes(preferredFormat) ? "mp4" : preferredFormat;
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
  const protectedMedia = probe?.protection === "drm" || probe?.protected;
  const ytdlpReady = item.kind === "youtube" ? Boolean(state.hostStatus?.capabilities?.ytdlp?.available) : true;
  $("#confirmDownload").disabled = Boolean(protectedMedia) || (item.kind === "youtube" && !ytdlpReady);
  $("#dialogNote").style.color = item.kind === "youtube" && !ytdlpReady ? "var(--warning-strong)" : "";
  $("#dialogNote").textContent = item.kind === "youtube"
    ? ytdlpReady
      ? "实验性功能：由本机安装的 yt-dlp 引擎下载，画质与格式以本机 yt-dlp 为准。"
      : "实验性功能需要先安装 yt-dlp：请打开设置 → 站点适配器，按安装指引完成后再回来下载。"
    : protectedMedia
    ? "检测到 DRM/内容保护，受保护内容暂不支持下载。"
    : probeWarning
      ? "未读取到清晰度选项，将自动选择并生成一个可直接播放的文件。"
    : probe?.protection === "aes128"
      ? "检测到可处理的加密流媒体，将使用高速下载功能完成下载。"
      : item.kind === "dash_pair"
        ? "这个网站把画面和声音分开传送。FluxCatch 会分别下载并无损合并，最后保存为一个可以直接播放的文件。"
      : isStreamKind(item)
        ? "这类在线视频由许多小片段组成。FluxCatch 会逐段下载并自动组合，最后保存为一个可直接播放的文件。"
        : "普通文件会直接使用浏览器下载；开启多连接可加速大文件。";
  dialog.showModal();
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
  try {
    confirm.disabled = true;
    const advanced = isStreamKind(item) || item.kind === "youtube" || options.extractAudio || options.convert || options.useNativeForDirect;
    if (advanced) {
      const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
      if (!granted) throw new Error("请先允许使用高速下载功能，再继续下载");
    }
    const result = await call({ type: "DOWNLOAD", tabId: state.tabId, candidate: item, options });
    dialog.close();
    if (result.method === "native") {
      state.jobs.set(result.jobId, { jobId: result.jobId, filename: options.filename, status: "queued", progress: 0, speed: 0 });
      renderJobs();
      switchView("jobs");
    } else showToast("浏览器下载已开始");
  } catch (error) {
    $("#dialogNote").textContent = friendlyErrorMessage(error?.message);
    $("#dialogNote").style.color = "var(--danger-strong)";
  } finally {
    const probe = state.probes.get(item.id);
    confirm.disabled = Boolean(probe?.protection === "drm" || probe?.protected);
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
    cancel.textContent = "取消";
    cancel.addEventListener("click", () => runUiAction(async () => {
      cancel.disabled = true;
      try { await call({ type: "CANCEL_JOB", jobId: job.jobId }); }
      catch (error) { cancel.disabled = false; throw error; }
    }));
    meta.append(cancel);
    card.append(progress, meta); jobsList.append(card);
  }
  if (focusedJobId) {
    const target = [...jobsList.querySelectorAll("button[data-job-id]")].find((button) => button.dataset.jobId === focusedJobId);
    target?.focus({ preventScroll: true });
  }
}

function announceJobChange(previous, current) {
  if (previous?.status === current?.status) return;
  $("#jobAnnouncer").textContent = `${current.filename || "媒体"}：${statusLabel(current.status)}`;
}

function updateHost(status = {}) {
  const dot = $("#hostDot");
  dot.className = `dot ${status.connected ? "ok" : status.lastError ? "bad" : ""}`;
  $("#hostTitle").textContent = status.connected ? "高速下载功能已就绪" : "高速下载功能暂未就绪";
  const installHelp = $("#installHelpButton");
  // The connect attempt itself failed (engine missing / not registered):
  // point the user at the install guidance instead of a bare error.
  installHelp.hidden = Boolean(status.connected || status.needsPermission || !status.lastError);
  if (!status.connected) {
    $("#hostDetail").textContent = status.needsPermission
      ? "需要加速、合并或转换格式时会请你授权"
      : status.lastError
        ? "本地引擎尚未就绪；点「安装方法」查看一分钟安装指引"
        : "普通文件仍可直接下载";
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
  if (item.kind === "youtube") return [{ text: "YouTube", cls: "hls" }, { text: "实验性", cls: "fmt" }];
  const stream = isStreamKind(item);
  const values = [{ text: streamTypeLabel(item), cls: stream ? "hls" : "fmt" }];
  if (item.site && SITE_LABELS[item.site] && item.site !== "youtube") values.push({ text: SITE_LABELS[item.site], cls: "fmt" });
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

function mediaKey(item) { return item.id || item.url; }
function readableMediaTitle(item) {
  for (const value of [item.displayTitle, item.title, item.suggestedFilename, item.pageTitle]) {
    const title = String(value || "").trim();
    if (title) return title;
  }
  return fileLabel(item.url);
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
  return raw.replace(/本地(?:高速)?引擎/g, "高速下载功能");
}
function el(tag, className) { const node = document.createElement(tag); if (className) node.className = className; return node; }
async function runUiAction(action) { try { await action(); } catch (error) { showToast(friendlyErrorMessage(error?.message || "操作失败")); } }
function showToast(message) {
  clearTimeout(state.toastTimer);
  const toast = $("#toast");
  if (!toast) return;
  toast.textContent = String(message || "操作失败");
  toast.classList.add("show");
  state.toastTimer = setTimeout(() => toast.classList.remove("show"), 1800);
}
