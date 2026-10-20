// FluxCatch downloads page: live jobs on top, the durable history grouped by
// day below, with the file actions Chrome's own list cannot offer for files
// the local engine saved.
import { humanBytes } from "../lib/media.js";
import { friendlyDashMessage } from "../lib/job-presentation.js";
import { createToastController, restoreFocus, withPendingAction } from "../ui/interactions.js";
import { bindUiI18n } from "../ui/i18n.js";
import {
  compareJobs,
  createJobActions,
  createJobTile,
  createTransferControls,
  dayGroupOf,
  estimateRemaining,
  finishedMetaParts,
  formatRelativeTime,
  isTerminalStatus,
  runFileAction,
  statusLabel
} from "../ui/job-rows.js";
import { pushSpeedSample, renderSegmentMap, renderSpeedGraph, segmentsFromMessage } from "../ui/speed-graph.js";

// Recent speed samples per live job, for the graph in the active card.
const speedSamples = new Map();

function recordSpeed(job) {
  if (!job?.jobId) return;
  if (isTerminalStatus(job.status)) {
    speedSamples.delete(job.jobId);
    return;
  }
  speedSamples.set(job.jobId, pushSpeedSample(speedSamples.get(job.jobId), job.speed));
}

let initStarted = false;
await bindUiI18n();

const $ = (selector) => document.querySelector(selector);
const state = {
  records: [],
  jobs: new Map(),
  filter: "all",
  query: "",
  downloadDir: "",
  settings: {},
  hostStatus: {},
  notificationPermission: null,
  notifyDismissed: false,
  menuJobId: null
};
const toastController = createToastController($("#toast"));
const port = chrome.runtime.connect({ name: "fluxcatch-downloads" });
const DAY_ORDER = ["今天", "昨天", "本周", "更早"];

port.onMessage.addListener((message) => {
  if (!message?.type) return;
  if (message.type === "JOB_UPDATED" && message.job?.jobId) {
    state.jobs.set(message.job.jobId, message.job);
    recordSpeed(message.job);
    renderActive();
    // A row that just ended shows up in the history list within the same tick.
    if (isTerminalStatus(message.job.status)) void refreshHistory({ quiet: true });
  } else if (message.type === "JOBS_UPDATED") {
    state.jobs = new Map((message.jobs || []).map((job) => [job.jobId, job]));
    for (const job of state.jobs.values()) recordSpeed(job);
    renderActive();
  } else if (message.type === "HISTORY_UPDATED" && message.record?.jobId) {
    state.records = [message.record, ...state.records.filter((item) => item.jobId !== message.record.jobId)];
    renderHistory();
  } else if (message.type === "HISTORY_REMOVED") {
    state.records = state.records.filter((item) => item.jobId !== message.jobId);
    renderHistory();
  } else if (message.type === "HISTORY_CLEARED" || message.type === "HISTORY_VERIFIED") {
    void refreshHistory({ quiet: true });
  } else if (message.type === "HOST_EVENT") {
    state.hostStatus = message.hostStatus || state.hostStatus;
  }
});

document.addEventListener("DOMContentLoaded", init);

async function init() {
  if (initStarted) return;
  initStarted = true;
  bindEvents();
  try {
    state.notificationPermission = await chrome.permissions.contains({ permissions: ["notifications"] });
  } catch {
    state.notificationPermission = false;
  }
  try {
    const settings = await call({ type: "GET_SETTINGS" });
    state.settings = settings.settings || {};
  } catch { /* defaults */ }
  await refreshHistory();
  // Files can be moved or deleted outside FluxCatch; ask the engine which
  // records still point at a real file, then redraw with the answer.
  void call({ type: "VERIFY_HISTORY" }).then((result) => {
    if (result?.checked) return refreshHistory({ quiet: true });
    return undefined;
  }).catch(() => {});
}

function bindEvents() {
  $("#settingsButton").addEventListener("click", () => void chrome.runtime.openOptionsPage().catch((error) => showToast(error?.message || "无法打开设置页", "error")));
  $("#folderButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "downloads:open-folder", () => call({ type: "OPEN_DOWNLOAD_FOLDER" }), {
    pendingText: "", successText: "已打开 ✓", successDurationMs: 800
  }));
  $("#retryButton").addEventListener("click", () => void refreshHistory());
  $("#newDownloadButton").addEventListener("click", (event) => {
    const form = $("#urlForm");
    form.hidden = !form.hidden;
    event.currentTarget.setAttribute("aria-expanded", String(!form.hidden));
    if (!form.hidden) $("#urlInput").focus({ preventScroll: true });
  });
  $("#urlForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const submit = event.currentTarget.querySelector("button[type=submit]");
    const url = String($("#urlInput").value || "").trim();
    void runUiAction(submit, `downloads:url-download:${url}`, async () => {
      if (!/^https?:\/\/\S+$/i.test(url)) throw new Error("请输入 http 或 https 的媒体地址");
      const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
      if (!granted) throw new Error("请先允许使用本地下载引擎，再继续下载");
      await call({ type: "DOWNLOAD_URL", url, options: {} });
      $("#urlInput").value = "";
      showToast("本地下载任务已开始", "success");
    }, { pendingText: "", successText: "已开始 ✓", successDurationMs: 800 });
  });
  $("#searchInput").addEventListener("input", (event) => {
    state.query = String(event.target.value || "").trim().toLowerCase();
    renderHistory();
  });
  for (const button of document.querySelectorAll(".segmented [data-filter]")) {
    button.addEventListener("click", () => {
      state.filter = button.dataset.filter;
      for (const other of document.querySelectorAll(".segmented [data-filter]")) {
        const selected = other === button;
        other.classList.toggle("active", selected);
        other.setAttribute("aria-selected", String(selected));
      }
      renderHistory();
    });
  }
  $("#clearHistoryButton").addEventListener("click", (event) => {
    if (!window.confirm("清空全部下载记录？文件本身不会被删除。")) return;
    void runUiAction(event.currentTarget, "downloads:clear-history", async () => {
      const result = await call({ type: "CLEAR_HISTORY" });
      state.records = [];
      state.jobs = new Map((result.jobs || []).map((job) => [job.jobId, job]));
      renderActive();
      renderHistory();
      showToast(result.removed ? `已清空 ${result.removed} 条记录` : "没有可清空的记录", result.removed ? "success" : "warning");
    }, { pendingText: "清空中…", successText: "已清空 ✓" });
  });
  $("#notifyEnableButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "downloads:enable-notifications", async () => {
    const granted = await chrome.permissions.request({ permissions: ["notifications"] });
    state.notificationPermission = granted;
    if (!granted) throw new Error("未授予通知权限，可稍后在设置里开启");
    showToast("下载完成后会收到通知", "success");
    renderNotifyBanner();
  }, { pendingText: "", successText: "已开启 ✓", successDurationMs: 0 }));
  $("#notifyDismissButton").addEventListener("click", (event) => void runUiAction(event.currentTarget, "downloads:dismiss-notifications", async () => {
    state.notifyDismissed = true;
    renderNotifyBanner();
    const settings = { ...(state.settings || {}), showNotifications: false };
    const saved = await call({ type: "SAVE_SETTINGS", settings });
    state.settings = saved.settings || settings;
  }, { pendingText: "", successDurationMs: 0 }));
  $("#menuLayer").addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeMenu();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !$("#menuLayer").hidden) {
      event.preventDefault();
      closeMenu();
    }
  });
  window.addEventListener("resize", closeMenu);
}

async function refreshHistory({ quiet = false } = {}) {
  if (!quiet) setLoadState("loading");
  try {
    const result = await call({ type: "GET_HISTORY" });
    state.records = Array.isArray(result.items) ? result.items : [];
    state.jobs = new Map((result.jobs || []).map((job) => [job.jobId, job]));
    state.hostStatus = result.hostStatus || state.hostStatus;
    state.downloadDir = result.downloadDir || state.downloadDir;
    setLoadState("ready");
    renderActive();
    renderHistory();
  } catch (error) {
    setLoadState("error", friendlyErrorMessage(error?.message || "读取下载记录失败"));
  }
}

function setLoadState(type, message = "") {
  $("#loadingState").hidden = type !== "loading";
  $("#errorState").hidden = type !== "error";
  if (message) $("#errorText").textContent = message;
  if (type !== "ready") {
    $("#historySection").hidden = true;
    $("#emptyState").hidden = true;
  }
}

function renderActive() {
  const active = [...state.jobs.values()].filter((job) => !isTerminalStatus(job.status)).sort(compareJobs);
  const section = $("#activeSection");
  const list = $("#activeList");
  section.hidden = active.length === 0;
  $("#activeCount").textContent = String(active.length);
  $("#activeCount").setAttribute("aria-label", `${active.length} 个进行中`);
  list.replaceChildren(...active.map(createActiveRow));
}

function createActiveRow(job) {
  const row = document.createElement("li");
  row.className = `job-row ${job.status || "queued"}`;
  const head = document.createElement("div");
  head.className = "job-head";
  const title = document.createElement("h3");
  title.className = "job-title";
  title.textContent = job.filename || "media";
  title.title = title.textContent;
  const percentValue = Math.round(Math.max(0, Math.min(1, Number(job.progress) || 0)) * 100);
  const stateText = document.createElement("span");
  stateText.className = "job-state";
  stateText.textContent = percentValue > 0 ? `${percentValue}%` : statusLabel(job.status);
  head.append(title, stateText);
  const progress = document.createElement("div");
  progress.className = "progress";
  progress.setAttribute("role", "progressbar");
  progress.setAttribute("aria-label", `${title.textContent} 下载进度`);
  progress.setAttribute("aria-valuemin", "0");
  progress.setAttribute("aria-valuemax", "100");
  progress.setAttribute("aria-valuenow", String(percentValue));
  progress.setAttribute("aria-valuetext", `${percentValue}%`);
  const bar = document.createElement("span");
  bar.style.width = `${percentValue}%`;
  progress.append(bar);
  // The active card carries the speed graph with its reflection and, for
  // streams the engine reports as "分片 n/m", the segment map.
  const extras = [];
  const samples = speedSamples.get(job.jobId) || [];
  if (job.status === "downloading" && samples.length > 1) {
    const graph = document.createElement("div");
    graph.className = "job-graph";
    renderSpeedGraph(graph, samples, { width: 640, height: 64, label: `${title.textContent} 下载速度` });
    extras.push(graph);
  }
  const segments = segmentsFromMessage(job.message);
  if (segments) {
    const map = document.createElement("div");
    map.className = "job-segments";
    renderSegmentMap(map, {
      done: segments.done,
      total: segments.total,
      active: job.status === "downloading" ? Math.min(8, Math.max(0, segments.total - segments.done)) : 0
    }, { maximum: 64, label: `${title.textContent} 分片进度` });
    extras.push(map);
  }
  const foot = document.createElement("div");
  foot.className = "job-foot";
  const message = document.createElement("span");
  message.className = "job-message";
  message.textContent = friendlyJobMessage(job);
  message.title = message.textContent;
  const speed = document.createElement("span");
  speed.className = "job-speed";
  speed.textContent = Number(job.speed) > 0 ? `${humanBytes(job.speed)}/s` : byteSummary(job);
  const remaining = estimateRemaining(job);
  if (remaining) {
    const eta = document.createElement("span");
    eta.className = "job-eta";
    eta.textContent = remaining;
    speed.append(eta);
  }
  if (job.status === "paused" || job.status === "pausing") row.classList.add("paused");
  foot.append(message, speed, createTransferControls(job, handleTransferControl));
  row.append(head, progress, ...extras, foot);
  return row;
}

async function handleTransferControl(action, job, button) {
  const key = `downloads:transfer:${action}:${job.jobId}`;
  if (action === "pause") {
    await runUiAction(button, key, async () => {
      await call({ type: "PAUSE_JOB", jobId: job.jobId });
      showToast("已发送暂停请求", "success");
    }, { pendingText: "", successText: "✓" });
    return;
  }
  if (action === "resume") {
    await runUiAction(button, key, async () => {
      await call({ type: "RESUME_JOB", jobId: job.jobId });
      showToast("已继续下载", "success");
    }, { pendingText: "", successText: "✓" });
    return;
  }
  await runUiAction(button, key, async () => {
    await call({ type: "CANCEL_JOB", jobId: job.jobId });
    showToast("已发送取消请求", "success");
  }, { pendingText: "", successText: "✓" });
}

function visibleRecords() {
  return state.records.filter((record) => {
    if (state.filter === "completed" && record.status !== "completed") return false;
    if (state.filter === "failed" && record.status === "completed") return false;
    if (!state.query) return true;
    const haystack = `${record.filename || ""} ${record.sourceHost || ""} ${record.sourceTitle || ""}`.toLowerCase();
    return haystack.includes(state.query);
  });
}

function renderHistory() {
  closeMenu();
  const focused = document.activeElement;
  const focusedJobId = focused?.dataset?.jobId || "";
  const focusedAction = focused?.dataset?.action || "";
  const all = state.records;
  $("#countAll").textContent = String(all.length);
  $("#countCompleted").textContent = String(all.filter((item) => item.status === "completed").length);
  $("#countFailed").textContent = String(all.filter((item) => item.status !== "completed").length);
  $("#clearHistoryButton").disabled = all.length === 0;
  renderSummary();
  renderNotifyBanner();
  const records = visibleRecords().slice().sort((a, b) => (b.finishedAt || 0) - (a.finishedAt || 0));
  const section = $("#historySection");
  const empty = $("#emptyState");
  section.replaceChildren();
  if (!records.length) {
    section.hidden = true;
    empty.hidden = false;
    const filtered = all.length > 0;
    $("#emptyTitle").textContent = filtered ? "没有匹配的记录" : "还没有下载记录";
    $("#emptyCopy").textContent = filtered
      ? "换一个关键词，或切换上方的状态筛选。"
      : "在视频页面点击工具栏图标开始下载；本地引擎保存的文件都会记在这里，并可直接在 Finder 中显示。";
    return;
  }
  empty.hidden = true;
  section.hidden = false;
  const now = Date.now();
  const groups = new Map();
  for (const record of records) {
    const key = dayGroupOf(record.finishedAt || record.createdAt, now);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const key of DAY_ORDER) {
    const items = groups.get(key);
    if (!items?.length) continue;
    const group = document.createElement("section");
    group.className = "day-group";
    group.setAttribute("aria-label", key);
    const head = document.createElement("h2");
    head.className = "day-head";
    head.textContent = key;
    const list = document.createElement("ul");
    list.className = "jobs-list";
    list.replaceChildren(...items.map(createRecordRow));
    group.append(head, list);
    section.append(group);
  }
  if (focusedJobId) {
    const buttons = [...section.querySelectorAll("button[data-job-id]")].filter((button) => button.dataset.jobId === focusedJobId);
    restoreFocus(buttons.find((button) => button.dataset.action === focusedAction) || buttons[0]);
  }
}

function renderSummary() {
  const completed = state.records.filter((item) => item.status === "completed");
  const bytes = completed.reduce((sum, item) => sum + (Number(item.size) || 0), 0);
  const summary = $("#pageSummary");
  summary.textContent = completed.length
    ? `已保存 ${completed.length} 个文件 · 共 ${humanBytes(bytes)}`
    : "本地引擎保存的每个文件都会记在这里";
  const note = $("#folderNote");
  const dir = state.downloadDir || state.hostStatus?.downloadDir || "";
  note.hidden = !dir;
  note.textContent = dir ? abbreviateHome(dir) : "";
}

function renderNotifyBanner() {
  const banner = $("#notifyBanner");
  const wanted = state.settings?.showNotifications !== false;
  banner.hidden = state.notifyDismissed || !wanted || state.notificationPermission !== false;
}

function createRecordRow(record) {
  const row = document.createElement("li");
  row.className = `record ${record.status}${record.fileMissing ? " missing" : ""}`;
  row.dataset.jobId = record.jobId;
  const main = document.createElement("div");
  main.className = "record-main";
  const titleLine = document.createElement("div");
  titleLine.className = "record-title";
  const title = document.createElement("h3");
  title.className = "job-title";
  title.textContent = record.filename || "media";
  title.title = title.textContent;
  const chip = document.createElement("span");
  chip.className = `job-chip ${record.status === "completed" ? "done" : record.status === "failed" ? "bad" : "wait"}`;
  chip.textContent = record.fileMissing ? "文件已移走" : statusLabel(record.status);
  titleLine.append(title, chip);
  const meta = document.createElement("p");
  meta.className = "job-meta-line";
  meta.textContent = finishedMetaParts(withoutHostAndTime(record), { message: record.status === "failed" ? friendlyJobMessage(record) : "" }).join(" · ");
  meta.title = meta.textContent;
  const source = document.createElement("p");
  source.className = "record-source";
  const when = formatRelativeTime(record.finishedAt || record.createdAt);
  if (record.hasSource && record.sourceUrl) {
    const link = document.createElement("a");
    link.href = record.sourceUrl;
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = record.sourceTitle || record.sourceHost || record.sourceUrl;
    link.title = record.sourceUrl;
    link.dataset.noI18n = "";
    source.append(link);
    if (when) source.append(` · ${when}`);
  } else {
    source.textContent = when;
  }
  main.append(titleLine, meta, source);
  const actions = createJobActions(record, handleRecordAction, { allowTrash: false, allowRemove: false });
  const more = document.createElement("button");
  more.type = "button";
  more.className = "job-action icon-only";
  more.dataset.action = "more";
  more.dataset.jobId = record.jobId;
  more.setAttribute("aria-haspopup", "menu");
  more.setAttribute("aria-label", `更多操作 ${record.filename || "media"}`);
  more.title = "更多操作";
  more.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>';
  more.addEventListener("click", (event) => {
    event.stopPropagation();
    openMenu(record, more);
  });
  actions.append(more);
  row.append(createJobTile(record, { size: 56 }), main, actions);
  return row;
}

function withoutHostAndTime(record) {
  // The source host and time have their own line on this page; keep the meta
  // line to size, duration and resolution.
  return { ...record, sourceHost: "", finishedAt: 0, updatedAt: 0 };
}

function openMenu(record, anchor) {
  const layer = $("#menuLayer");
  const menu = $("#rowMenu");
  menu.replaceChildren();
  state.menuJobId = record.jobId;
  const items = [];
  if (record.hasSource) items.push({ action: "source", label: "打开来源页面", icon: "M14 4h6v6M20 4 10 14M19 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h6" });
  items.push({ action: "copy", label: "复制文件名", icon: "M9 9h10v10H9zM5 15V5h10" });
  if (record.status === "completed" && record.hasFile && !record.fileMissing) {
    items.push({ action: "trash", label: "移到废纸篓", icon: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13", danger: true });
  }
  if (record.retryable) items.push({ action: "retry", label: "重试下载", icon: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" });
  items.push({ action: "remove", label: "从记录中移除", icon: "M6 6l12 12M18 6 6 18", danger: true });
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.className = item.danger ? "danger" : "";
    button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${item.icon}"/></svg>`;
    const text = document.createElement("span");
    text.textContent = item.label;
    button.append(text);
    button.addEventListener("click", () => {
      closeMenu();
      void handleRecordAction(item.action, record, anchor);
    });
    menu.append(button);
  }
  layer.hidden = false;
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(200, menu.offsetWidth);
  menu.style.left = `${Math.max(8, Math.min(window.innerWidth - width - 8, rect.right - width))}px`;
  const below = rect.bottom + 6;
  const height = menu.offsetHeight;
  menu.style.top = `${below + height > window.innerHeight - 8 ? Math.max(8, rect.top - height - 6) : below}px`;
  menu.querySelector("button")?.focus();
}

function closeMenu() {
  const layer = $("#menuLayer");
  if (layer.hidden) return;
  layer.hidden = true;
  const anchor = state.menuJobId
    ? document.querySelector(`button[data-action="more"][data-job-id="${CSS.escape(state.menuJobId)}"]`)
    : null;
  state.menuJobId = null;
  restoreFocus(anchor);
}

async function handleRecordAction(action, record, button) {
  const key = `downloads:${action}:${record.jobId}`;
  if (action === "copy") {
    await runUiAction(button, key, async () => {
      await navigator.clipboard.writeText(record.filename || "");
      showToast("已复制文件名", "success");
    }, { pendingText: "", successDurationMs: 0 });
    return;
  }
  if (action === "remove") {
    await runUiAction(button, key, async () => {
      await call({ type: "REMOVE_HISTORY", jobId: record.jobId });
      state.records = state.records.filter((item) => item.jobId !== record.jobId);
      renderHistory();
    }, { pendingText: "", successDurationMs: 0 });
    return;
  }
  if (action === "trash") {
    if (!window.confirm(`把“${record.filename}”移到废纸篓？`)) return;
    await runUiAction(button, key, async () => {
      await runFileAction(record, "trash", call);
      showToast("已移到废纸篓", "success");
    }, { pendingText: "", successDurationMs: 0 });
    return;
  }
  if (action === "retry") {
    await runUiAction(button, key, async () => {
      const result = await call({ type: "RETRY_JOB", jobId: record.jobId });
      showToast(result.method === "native" ? "本地下载任务已开始" : "浏览器下载已开始", "success");
    }, { pendingText: "", successText: "✓", successDurationMs: 0 });
    return;
  }
  if (action === "source") {
    await runUiAction(button, key, () => call({ type: "OPEN_JOB_SOURCE", jobId: record.jobId }), { pendingText: "", successDurationMs: 0 });
    return;
  }
  await runUiAction(button, key, () => runFileAction(record, action, call), { pendingText: "", successText: "✓", successDurationMs: 600 });
}

function byteSummary(job) {
  if (Number(job.total) > 0) return `${humanBytes(job.bytes || 0)} / ${humanBytes(job.total)}`;
  if (Number(job.bytes) > 0) return humanBytes(job.bytes);
  return "";
}

function abbreviateHome(path) {
  return String(path || "").replace(/^\/Users\/[^/]+(?=\/|$)/, "~");
}

function friendlyJobMessage(job) {
  const raw = String(job.message || job.error || "").trim();
  if (!raw) return statusLabel(job.status);
  if (/FFmpeg/i.test(raw)) return job.status === "failed" ? "视频处理失败，请确认本地下载引擎已就绪后重试" : "正在合并视频片段或转换格式";
  const dashMessage = friendlyDashMessage(raw, { failed: job.status === "failed" });
  if (dashMessage) return dashMessage;
  return raw.replace(/高速下载功能|本地(?:高速|下载)?引擎/g, "本地下载引擎");
}

function friendlyErrorMessage(message) {
  const raw = String(message || "操作失败").trim();
  const dashMessage = friendlyDashMessage(raw, { failed: true });
  if (dashMessage) return dashMessage;
  return raw.replace(/高速下载功能|本地(?:高速|下载)?引擎/g, "本地下载引擎");
}

async function runUiAction(element, key, action, options = {}) {
  try {
    return await withPendingAction(element, key, action, { successDurationMs: 500, failureDurationMs: 0, ...options });
  } catch (error) {
    showToast(friendlyErrorMessage(error?.message || "操作失败"), "error");
    restoreFocus(element);
    return undefined;
  }
}

function showToast(message, type = "success") {
  const method = ["success", "warning", "error"].includes(type) ? type : "error";
  return toastController[method](String(message || "操作完成"));
}

async function call(message) {
  const response = await chrome.runtime.sendMessage(message);
  if (!response?.ok) throw new Error(response?.error || "扩展请求失败");
  return response;
}

if (document.readyState !== "loading") void init();
