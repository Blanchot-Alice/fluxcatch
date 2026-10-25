// Havre Downloads page (design review §6.15) on the v2 system: the live
// download as the one focus panel, then the durable history grouped by day,
// with the file actions Chrome's own list cannot offer for engine-saved files.
// All copy comes from ui/v2/messages.js; all formatting follows the one UI
// language (ui/v2/locale.js); engine text is never shown raw (ui/v2/errors.js).
// Rows, the focus panel and status lines are the shared v2 builders (ui/v2/rows.js,
// ui/v2/components.js); this file keeps the page's state and behaviour.
import { bootLocale, dayGroupOf, formatBytes, onLocaleChange } from "../ui/v2/locale.js";
import { msg } from "../ui/v2/messages.js";
import { brandMark, createMenus, createToaster, groupLabel, icon, runAction, setStatusLine } from "../ui/v2/components.js";
import { historyRow, liveRow, recordBytes, updateLiveRow } from "../ui/v2/rows.js";
import { errorText, userError } from "../ui/v2/errors.js";
import { callWorker as call, connectWorkerPort } from "../ui/v2/runtime.js";
import { contentBoxes, mountPondLayer } from "../ui/v2/pond.js";
import { compareJobs, isTerminalStatus, recordSpeedSample, runFileAction } from "../ui/v2/jobs.js";

const $ = (selector) => document.querySelector(selector);
const FINISH_HOLD_MS = 1800;

const state = {
  records: [],
  jobs: new Map(),
  filter: "all",
  query: "",
  settings: null,
  hostStatus: {},
  nativePermission: null,
  notificationPermission: null,
  notifyDismissed: false,
  load: "loading",
  disconnected: false,
  speeds: new Map(),
  finishing: new Map()
};

let pond = null;
let initStarted = false;

// Connect before anything awaits, so no broadcast is missed. An idle worker
// drops the port; the page reconnects and resyncs the history, and says
// "stopped responding" only when the worker does not come back.
connectWorkerPort({
  name: "havre-downloads",
  onMessage: (message) => onPortMessage(message),
  onReconnect: () => (initStarted ? refreshHistory({ quiet: true, keepOnError: true }) : true),
  onLost: () => {
    state.disconnected = true;
    renderStatusLine();
  }
});

await bootLocale();
const toast = createToaster($("#toastRegion"));
const menus = createMenus($("#menuLayer"));

document.addEventListener("DOMContentLoaded", init);
if (document.readyState !== "loading") void init();

async function init() {
  if (initStarted) return;
  initStarted = true;
  mountChrome();
  applyStaticCopy();
  bindEvents();
  onLocaleChange(() => { applyStaticCopy(); renderAll(); });
  // The pond layer (design review v3 §3.1): alpha 0 under every content box.
  pond = await mountPondLayer({ element: $("[data-pond]"), getContentBoxes: pondContentBoxes }).catch(() => null);
  await Promise.all([readPermissions(), readSettings()]);
  renderStatusLine();
  await refreshHistory();
  // Files can be moved or deleted outside Havre: ask the engine which
  // records still point at a real file, then redraw with the answer.
  void call({ type: "VERIFY_HISTORY" }).then((result) => (result?.checked ? refreshHistory({ quiet: true }) : undefined)).catch(() => {});
}

// ---------- static chrome ----------
function mountChrome() {
  $("#topbarInner").prepend(brandMark({ size: "m" }));
  $("#settingsButton").append(icon("settings"));
  $("#urlGlyph").append(icon("link"));
  $("#searchGlyph").append(icon("search"));
  $("#pageMoreButton").append(icon("more"));
  const topbar = $("#topbar");
  const onScroll = () => { topbar.dataset.scrolled = String(window.scrollY > 0); };
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();
}

function applyStaticCopy() {
  document.title = `${msg("downloads.title")} · ${msg("brand.name")}`;
  for (const element of document.querySelectorAll("[data-msg]")) element.textContent = msg(element.dataset.msg);
  for (const element of document.querySelectorAll("[data-msg-placeholder]")) element.placeholder = msg(element.dataset.msgPlaceholder);
  for (const element of document.querySelectorAll("[data-msg-label]")) {
    const label = msg(element.dataset.msgLabel);
    element.setAttribute("aria-label", label);
    if (element.tagName === "BUTTON") element.title = label;
  }
}

function bindEvents() {
  $("#settingsButton").addEventListener("click", () => {
    chrome.runtime.openOptionsPage().catch(() => toast(msg("toast.settingsFailed"), "error"));
  });
  $("#urlForm").addEventListener("submit", (event) => {
    event.preventDefault();
    void submitLink();
  });
  $("#searchInput").addEventListener("input", (event) => {
    state.query = String(event.target.value || "").trim().toLowerCase();
    renderHistory();
  });
  const tabs = [...document.querySelectorAll("#filters [data-filter]")];
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectFilter(tab.dataset.filter, { focus: false }));
    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      selectFilter(tabs[(next + tabs.length) % tabs.length].dataset.filter, { focus: true });
    });
  }
  $("#pageMoreButton").addEventListener("click", (event) => {
    const anchor = event.currentTarget;
    const items = [
      { label: msg("downloads.showFolder"), iconName: "folder", run: () => void runAction(anchor, "downloads:folder", () => call({ type: "OPEN_DOWNLOAD_FOLDER" }), { onError: showError }) }
    ];
    if (state.records.length) items.push({ label: msg("downloads.clearHistory"), iconName: "clear", tone: "destructive", keepOpen: true, run: () => void clearHistory(anchor) });
    menus.openItems(anchor, items);
  });
  $("#emptyAction").addEventListener("click", () => {
    state.query = "";
    $("#searchInput").value = "";
    selectFilter("all", { focus: false });
    $("#searchInput").focus();
  });
  chrome.permissions.onAdded?.addListener(() => void readPermissions().then(renderStatusLine));
  chrome.permissions.onRemoved?.addListener(() => void readPermissions().then(renderStatusLine));
}

function selectFilter(filter, { focus }) {
  state.filter = filter;
  for (const tab of document.querySelectorAll("#filters [data-filter]")) {
    const selected = tab.dataset.filter === filter;
    tab.setAttribute("aria-selected", String(selected));
    tab.tabIndex = selected ? 0 : -1;
    if (selected && focus) tab.focus();
  }
  renderHistory();
}

// ---------- data ----------
async function readPermissions() {
  try { state.nativePermission = await chrome.permissions.contains({ permissions: ["nativeMessaging"] }); } catch { state.nativePermission = false; }
  try { state.notificationPermission = await chrome.permissions.contains({ permissions: ["notifications"] }); } catch { state.notificationPermission = false; }
}

async function readSettings() {
  try {
    const result = await call({ type: "GET_SETTINGS" });
    state.settings = result.settings || null;
  } catch {
    state.settings = null;
  }
}

/** Read the history and live jobs; true when the worker answered.
 *  keepOnError: a failed resync (after a reconnect) leaves the page as it was. */
async function refreshHistory({ quiet = false, keepOnError = false } = {}) {
  if (!quiet) { state.load = "loading"; renderLoadState(); }
  try {
    const result = await call({ type: "GET_HISTORY" });
    state.records = Array.isArray(result.items) ? result.items : [];
    state.jobs = new Map((result.jobs || []).map((job) => [job.jobId, job]));
    state.hostStatus = result.hostStatus || state.hostStatus;
    state.load = "ready";
  } catch {
    if (keepOnError) return false;
    state.load = "error";
    renderAll();
    return false;
  }
  renderAll();
  return true;
}

function onPortMessage(message) {
  if (!message?.type) return;
  if (message.type === "JOB_UPDATED" && message.job?.jobId) {
    const job = message.job;
    const previous = state.jobs.get(job.jobId);
    state.jobs.set(job.jobId, job);
    recordSpeed(job);
    if (isTerminalStatus(job.status)) {
      if (job.status === "completed" && previous && !isTerminalStatus(previous.status)) beginFinish(job);
      else void refreshHistory({ quiet: true });
    }
    renderActive();
  } else if (message.type === "JOBS_UPDATED") {
    state.jobs = new Map((message.jobs || []).map((job) => [job.jobId, job]));
    for (const job of state.jobs.values()) recordSpeed(job);
    renderActive();
  } else if (message.type === "HISTORY_UPDATED" && message.record?.jobId) {
    state.records = [message.record, ...state.records.filter((item) => item.jobId !== message.record.jobId)];
    if (!state.finishing.has(message.record.jobId)) renderHistory();
    renderSummary();
  } else if (message.type === "HISTORY_REMOVED") {
    state.records = state.records.filter((item) => item.jobId !== message.jobId);
    renderHistory();
    renderSummary();
  } else if (message.type === "HISTORY_CLEARED" || message.type === "HISTORY_VERIFIED") {
    void refreshHistory({ quiet: true });
  } else if (message.type === "HOST_EVENT") {
    state.hostStatus = message.hostStatus || state.hostStatus;
  }
}

function recordSpeed(job) {
  if (isTerminalStatus(job.status)) { state.speeds.delete(job.jobId); return; }
  state.speeds.set(job.jobId, recordSpeedSample(state.speeds.get(job.jobId) || [], job));
}

// A finished download stays a moment: the fill turns celadon, then fades,
// then the row takes its history form.
function beginFinish(job) {
  state.finishing.set(job.jobId, { job, phase: "complete" });
  setTimeout(() => {
    const entry = state.finishing.get(job.jobId);
    if (entry) { entry.phase = "settled"; renderActive(); }
  }, 1200);
  setTimeout(() => {
    state.finishing.delete(job.jobId);
    void refreshHistory({ quiet: true });
  }, FINISH_HOLD_MS);
}

// ---------- rendering ----------
function renderAll() {
  renderLoadState();
  renderSummary();
  renderStatusLine();
  renderActive();
  renderHistory();
  pond?.refresh();
}

function renderSummary() {
  const completed = state.records.filter((record) => record.status === "completed");
  const bytes = completed.reduce((sum, record) => sum + recordBytes(record), 0);
  const summary = $("#pageSummary");
  summary.hidden = completed.length === 0;
  summary.textContent = completed.length ? msg("downloads.summary", { count: completed.length, size: formatBytes(bytes) }) : "";
}

function renderStatusLine() {
  const container = $("#statusLine");
  if (state.disconnected) {
    container.hidden = false;
    setStatusLine(container, { tone: "failed", text: msg("downloads.disconnected"), actions: [{ label: msg("action.reload"), run: () => location.reload() }] });
    return;
  }
  if (state.nativePermission === false) {
    container.hidden = false;
    setStatusLine(container, { text: msg("status.engineNotSetUp"), actions: [{ label: msg("action.setUp"), run: openEngineSetup }] });
    return;
  }
  const wantsNotifications = state.settings ? state.settings.showNotifications !== false : true;
  if (wantsNotifications && state.notificationPermission === false && !state.notifyDismissed) {
    container.hidden = false;
    setStatusLine(container, {
      text: msg("downloads.notificationsOff"),
      actions: [
        { label: msg("action.turnOn"), run: (anchor) => void enableNotifications(anchor) },
        { label: msg("action.dontNotify"), run: (anchor) => void dismissNotifications(anchor) }
      ]
    });
    return;
  }
  container.hidden = true;
  container.replaceChildren();
  pond?.refresh();
}

function renderLoadState() {
  const container = $("#loadState");
  if (state.load === "loading") {
    container.hidden = false;
    setStatusLine(container, { tone: "progress", text: msg("downloads.loading") });
  } else if (state.load === "error") {
    container.hidden = false;
    setStatusLine(container, { tone: "failed", text: msg("downloads.loadFailed"), actions: [{ label: msg("action.retry"), run: () => void refreshHistory() }] });
  } else {
    container.hidden = true;
    container.replaceChildren();
  }
}

// ----- active downloads: one focus panel, the rest as rows, updated in place -----
const live = { focusId: null, focus: null, rows: new Map() };

function activeJobs() {
  const list = [...state.jobs.values()].filter((job) => !isTerminalStatus(job.status) || state.finishing.has(job.jobId));
  return list.sort(compareJobs);
}

function renderActive() {
  // A new download takes the focus panel: the demoted job gets a new view, so
  // put keyboard focus back on the same job's control afterwards.
  const focused = document.activeElement;
  const focusJob = focused?.closest?.("#activeSection [data-job-id]")?.dataset?.jobId || "";
  const focusAction = focused?.dataset?.action || "";
  const jobs = activeJobs();
  $("#activeSection").hidden = jobs.length === 0;
  const [first, ...rest] = jobs;
  const slot = $("#focusSlot");
  if (!first) {
    slot.replaceChildren();
    live.focusId = null;
    live.focus = null;
  } else if (live.focusId !== first.jobId || !live.focus) {
    live.focusId = first.jobId;
    live.focus = liveRow(first, { focus: true });
    slot.replaceChildren(live.focus.root);
  }
  if (first) updateLive(live.focus, first);
  const list = $("#activeRows");
  const keep = new Set(rest.map((job) => job.jobId));
  for (const [id, view] of live.rows) if (!keep.has(id)) { view.root.remove(); live.rows.delete(id); }
  rest.forEach((job, index) => {
    let view = live.rows.get(job.jobId);
    if (!view) { view = liveRow(job, { focus: false }); live.rows.set(job.jobId, view); }
    if (list.children[index] !== view.root) list.insertBefore(view.root, list.children[index] || null);
    updateLive(view, job);
  });
  if (focusJob && !focused.isConnected && !document.activeElement?.closest?.("#activeSection")) {
    const candidates = [...document.querySelectorAll(`#activeSection [data-job-id="${CSS.escape(focusJob)}"] button`)];
    (candidates.find((element) => element.dataset.action === focusAction) || candidates[0])?.focus({ preventScroll: true });
  }
  pond?.refresh();
}

function updateLive(view, job) {
  updateLiveRow(view, job, { finishing: state.finishing.get(job.jobId) || null, samples: state.speeds.get(job.jobId) || [], onControl: transferControl });
}

function transferControl(action, job, control) {
  if (action === "resume") {
    void runAction(control, `resume:${job.jobId}`, async () => {
      await call({ type: "RESUME_JOB", jobId: job.jobId });
      toast(msg("toast.resumed"));
    }, { onError: showError });
  } else if (action === "pause") {
    void runAction(control, `pause:${job.jobId}`, async () => {
      await call({ type: "PAUSE_JOB", jobId: job.jobId });
      toast(msg("toast.pausing"));
    }, { onError: showError });
  } else if (action === "cancel") {
    void cancelJob(job, control);
  }
}

async function cancelJob(job, control) {
  const yes = await menus.confirm(control, { question: msg("job.cancelConfirm"), confirmLabel: msg("job.cancelAction") });
  if (!yes) return;
  await runAction(control, `cancel:${job.jobId}`, async () => {
    await call({ type: "CANCEL_JOB", jobId: job.jobId });
    toast(msg("toast.stopped"));
  }, { onError: showError });
}

// ----- history -----
function visibleRecords() {
  return state.records.filter((record) => {
    if (state.finishing.has(record.jobId)) return false;
    if (state.filter === "completed" && record.status !== "completed") return false;
    if (state.filter === "failed" && record.status === "completed") return false;
    if (!state.query) return true;
    return `${record.filename || ""} ${record.sourceHost || ""} ${record.sourceTitle || ""}`.toLowerCase().includes(state.query);
  });
}

function renderFilters() {
  const all = state.records.length;
  const completed = state.records.filter((record) => record.status === "completed").length;
  const counts = { countAll: all, countCompleted: completed, countFailed: all - completed };
  for (const [id, value] of Object.entries(counts)) {
    const element = document.getElementById(id);
    element.textContent = value ? String(value) : "";
    element.hidden = value === 0;
  }
  // With no history there is nothing to filter, search or clear: the empty
  // state stands alone (§6.11). The download folder stays reachable in Settings.
  $("#filterRow").hidden = all === 0;
}

function renderHistory() {
  renderFilters();
  const focused = document.activeElement;
  const focusJob = focused?.closest?.("#history [data-job-id]")?.dataset?.jobId || "";
  const focusAction = focused?.dataset?.action || "";
  const section = $("#history");
  const records = visibleRecords().slice().sort((a, b) => (b.finishedAt || b.createdAt || 0) - (a.finishedAt || a.createdAt || 0));
  section.replaceChildren();
  if (state.load !== "ready") { section.hidden = true; renderEmpty(null); return; }
  if (!records.length) {
    section.hidden = true;
    renderEmpty(state.records.length ? "noMatch" : "none");
    return;
  }
  renderEmpty(null);
  section.hidden = false;
  const now = Date.now();
  const groups = new Map();
  for (const record of records) {
    const key = dayGroupOf(record.finishedAt || record.createdAt, now);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(record);
  }
  for (const key of ["today", "yesterday", "week", "earlier"]) {
    const items = groups.get(key);
    if (!items?.length) continue;
    const group = document.createElement("section");
    const labelId = `group-${key}`;
    group.setAttribute("aria-labelledby", labelId);
    const list = document.createElement("ul");
    list.className = "rows";
    list.append(...items.map((record) => historyRow(record, { now, onAction: onRecordAction })));
    group.append(groupLabel(msg(`group.${key}`), labelId), list);
    section.append(group);
  }
  if (focusJob) {
    const candidates = [...section.querySelectorAll(`[data-job-id="${CSS.escape(focusJob)}"] button`)];
    (candidates.find((element) => element.dataset.action === focusAction) || candidates[0])?.focus({ preventScroll: true });
  }
}

function renderEmpty(kind) {
  const empty = $("#emptyState");
  const wasHidden = empty.hidden;
  if (!kind) {
    empty.hidden = true;
    if (!wasHidden) pond?.refresh();
    return;
  }
  empty.hidden = false;
  $("#emptySentence").textContent = msg(kind === "none" ? "downloads.empty.none" : "downloads.empty.noMatch");
  $("#emptyBody").textContent = msg(kind === "none" ? "downloads.empty.noneBody" : "downloads.empty.noMatchBody");
  const action = $("#emptyAction");
  action.hidden = kind !== "noMatch";
  action.replaceChildren(document.createTextNode(msg("action.clearSearch")));
  // The layer's mask follows the text blocks, so it repaints with them.
  pond?.refresh();
}

function onRecordAction(action, record, control) {
  if (action === "more") openRecordMenu(record, control);
  else void recordAction(action, record, control);
}

function openRecordMenu(record, anchor) {
  const items = [];
  const hasFile = record.status === "completed" && record.hasFile && !record.fileMissing;
  if (hasFile) items.push({ label: msg("action.showInFinder"), iconName: "folder", run: () => void recordAction("reveal", record, anchor) });
  if (record.hasSource) items.push({ label: msg("action.openSource"), iconName: "source", run: () => void recordAction("source", record, anchor) });
  if (record.hasSource && record.sourceUrl) items.push({ label: msg("action.copyLink"), iconName: "copy", run: () => void recordAction("copy", record, anchor) });
  if (hasFile) items.push({ label: msg("action.trash"), iconName: "trash", tone: "destructive", keepOpen: true, run: () => void recordAction("trash", record, anchor) });
  items.push({ label: msg("action.remove"), iconName: "remove", tone: "destructive", keepOpen: true, run: () => void recordAction("remove", record, anchor) });
  menus.openItems(anchor, items);
}

async function recordAction(action, record, anchor) {
  const key = `record:${action}:${record.jobId}`;
  if (action === "copy") {
    await runAction(null, key, async () => {
      await navigator.clipboard.writeText(record.sourceUrl);
      toast(msg("toast.linkCopied"));
    }, { onError: showError });
    return;
  }
  if (action === "remove") {
    if (!(await menus.confirm(anchor, { question: msg("job.removeConfirm"), confirmLabel: msg("action.remove") }))) return;
    await runAction(anchor, key, async () => {
      await call({ type: "REMOVE_HISTORY", jobId: record.jobId });
      state.records = state.records.filter((item) => item.jobId !== record.jobId);
      renderHistory();
      renderSummary();
      toast(msg("toast.removed"));
    }, { onError: showError });
    return;
  }
  if (action === "trash") {
    if (!(await menus.confirm(anchor, { question: msg("job.trashConfirm", { name: record.filename || "" }), confirmLabel: msg("action.trash") }))) return;
    await runAction(anchor, key, async () => {
      const result = await runFileAction(record, "trash", call);
      toast(msg(result?.permanent ? "toast.fileDeleted" : "toast.movedToTrash"));
    }, { onError: showError });
    return;
  }
  if (action === "retry") {
    await runAction(anchor, key, async () => {
      await call({ type: "RETRY_JOB", jobId: record.jobId });
      toast(msg("toast.downloadStarted"));
    }, { onError: showError });
    return;
  }
  if (action === "source") {
    await runAction(anchor, key, () => call({ type: "OPEN_JOB_SOURCE", jobId: record.jobId }), { onError: showError });
    return;
  }
  await runAction(anchor, key, () => runFileAction(record, action, call), { onError: showError });
}

// ---------- page actions ----------
async function submitLink() {
  const input = $("#urlInput");
  const submit = $("#urlSubmit");
  const url = String(input.value || "").trim();
  await runAction(submit, `link:${url}`, async () => {
    if (!/^https?:\/\/\S+$/i.test(url)) throw userError(msg("toast.invalidUrl"));
    const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
    if (!granted) throw userError(msg("toast.engineNeeded"));
    state.nativePermission = true;
    renderStatusLine();
    await call({ type: "DOWNLOAD_URL", url, options: {} });
    input.value = "";
    toast(msg("toast.downloadStarted"));
  }, { onError: showError });
}

async function clearHistory(anchor) {
  if (!(await menus.confirm(anchor, { question: msg("downloads.clearConfirm"), confirmLabel: msg("downloads.clearAction") }))) return;
  await runAction(anchor, "downloads:clear", async () => {
    const result = await call({ type: "CLEAR_HISTORY" });
    state.records = [];
    state.jobs = new Map((result.jobs || []).map((job) => [job.jobId, job]));
    renderAll();
    toast(result.removed ? msg("toast.cleared", { count: result.removed }) : msg("toast.nothingToClear"), result.removed ? "success" : "warning");
  }, { onError: showError });
}

function openEngineSetup() {
  chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html#local-engine") }).catch(() => {
    chrome.runtime.openOptionsPage().catch(() => toast(msg("toast.settingsFailed"), "error"));
  });
}

async function enableNotifications(anchor) {
  await runAction(anchor, "downloads:notifications", async () => {
    const granted = await chrome.permissions.request({ permissions: ["notifications"] });
    state.notificationPermission = granted;
    renderStatusLine();
    toast(msg(granted ? "toast.notificationsOn" : "toast.notificationsDenied"), granted ? "success" : "warning");
  }, { onError: showError });
}

async function dismissNotifications(anchor) {
  state.notifyDismissed = true;
  renderStatusLine();
  // Persist only on top of settings we actually read; never write a partial object.
  if (!state.settings) return;
  await runAction(anchor, "downloads:notifications-off", async () => {
    const result = await call({ type: "SAVE_SETTINGS", settings: { ...state.settings, showNotifications: false } });
    state.settings = result.settings || { ...state.settings, showNotifications: false };
  }, { onError: showError });
}

// ---------- pond content boxes (v3 §3.1): the layer is alpha 0 under each ----------
// The header, the title block, the link row, each status line with text, the
// filter row, the live and history lists, and each text block of the empty
// state, as laid out right now.
const DOWNLOADS_BOXES = ["#topbarInner", "#pageTitle", "#pageSummary", "#urlForm", "#statusLine", "#loadState", "#activeSection", "#filterRow", "#history", "#emptyState > *"];

function pondContentBoxes() {
  return contentBoxes(DOWNLOADS_BOXES);
}

// ---------- plumbing ----------
function showError(error) {
  toast(errorText(error), "error");
}
