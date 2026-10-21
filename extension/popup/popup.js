// FluxCatch toolbar popup (design review §6.14) on the v2 system. Top bar:
// BrandMark S, "Download a link" and Settings. A Media | Downloads segmented
// control with the type filter, which filters whichever list is shown. Media:
// the list header (Rescan, and an overflow with Download all and the confirmed
// Clear results) over detected rows, or the empty state with Rescan as the
// view's one primary. Downloads: rows.js rows in compact density. One status
// line for the engine. Footer: Open workspace and All downloads. The Download dialog, rows and lists are shared with the side
// panel (ui/v2/media.js); all copy comes from ui/v2/messages.js.
import { bootLocale, onLocaleChange } from "../ui/v2/locale.js";
import { msg } from "../ui/v2/messages.js";
import { brandMark, createMenus, createToaster, emptyState, icon, iconButton, listHeader, runAction, setStatusLine } from "../ui/v2/components.js";
import { segmented, select } from "../ui/v2/controls.js";
import { errorText, userError } from "../ui/v2/errors.js";
import { callWorker as call, connectWorkerPort } from "../ui/v2/runtime.js";
import { mountPond } from "../ui/v2/pond.js";
import {
  applyStaticCopy,
  bindMist,
  candidateReference,
  createJobList,
  createMediaDialog,
  downloadNeedsNative,
  engineIssue,
  engineLine,
  filterItems,
  findDownloadButton,
  isOfferedCandidate,
  mediaKey,
  mediaRow,
  normalizeHostStatus,
  openEngineSetup,
  openMediaMenu,
  pingEngine,
  pondZones,
  recheckEngine,
  requireEngineReady,
  setPondOpening
} from "../ui/v2/media.js";

const $ = (selector) => document.querySelector(selector);
const FILTERS = ["all", "video", "audio", "stream"];

const state = {
  tabId: null,
  windowId: null,
  readable: true,
  items: [],
  settings: {},
  hostStatus: {},
  nativePermission: null,
  notificationPermission: null,
  notifyDismissed: false,
  view: "media",
  filter: "all",
  mediaLoad: "loading",
  jobsLoad: "loading",
  disconnected: false,
  refreshSequence: 0
};

// Connect before anything awaits, so no broadcast is missed. An idle worker
// drops the port; the page reconnects and resyncs, and says "stopped
// responding" only when the worker does not come back.
connectWorkerPort({
  name: "fluxcatch-popup",
  onMessage: (message) => onPortMessage(message),
  onReconnect: async () => {
    if (!jobList) return true;
    const [jobs] = await Promise.all([loadJobs({ quiet: true }), loadMedia({ quiet: true })]);
    return jobs;
  },
  onLost: () => {
    state.disconnected = true;
    renderEngineLine();
  }
});

let jobList = null;
let dialog = null;
let pond = null;
let initStarted = false;
const ui = {};

await bootLocale();
const toast = createToaster($("#toastRegion"));
// One menus instance per page: createMenus() adds document listeners on every call.
const menus = createMenus($("#menuLayer"));
const showError = (error) => toast(errorText(error), "error");

jobList = createJobList({ list: $("#jobRows"), menus, toast, onError: showError, announcer: $("#announcer"), onChange: renderJobsState, call });
dialog = createMediaDialog({
  getContext: () => ({ tabId: state.tabId, settings: state.settings, hostStatus: state.hostStatus, permission: state.nativePermission }),
  ping: () => pingEngine(call),
  onHost: updateHost,
  onStarted,
  onRepresented,
  onBusy: (key, busy) => {
    renderMedia();
    // The row's meta reads "Reading qualities…"; say it too, as v1's live status did.
    if (busy) say(msg("media.reading"));
  },
  setUp: () => void setUpEngine(),
  fallbackFocus: () => (state.view === "downloads" ? $("#tab-downloads") : $("#urlButton")),
  call
});

document.addEventListener("DOMContentLoaded", init);
if (document.readyState !== "loading") void init();

async function init() {
  if (initStarted) return;
  initStarted = true;
  $("#urlButton").append(icon("link"));
  $("#settingsButton").append(icon("settings"));
  buildChrome();
  applyStaticCopy();
  bindEvents();
  bindMist($("#topbar"), $("#main"));
  onLocaleChange(() => {
    buildChrome();
    applyStaticCopy();
    dialog.applyCopy();
    jobList.relabel();
    renderAll();
  });
  // The pond paints on its own time; the first data load never waits for it.
  void mountPond({ element: $("[data-pond]"), getZones }).catch(() => null).then((mounted) => {
    pond = mounted;
    renderPond();
  });
  await Promise.allSettled([readPermissions(), readTab()]);
  await Promise.allSettled([loadMedia(), loadJobs()]);
  // A fresh status (the worker may have to start the engine to answer).
  void pingEngine(call).then(updateHost);
}

// ---------- static chrome (rebuilt on a language switch) ----------
function buildChrome() {
  $("#topbarInner [data-brandmark]")?.remove();
  $("#topbarInner").prepend(brandMark({ size: "s" }));

  ui.views = segmented({
    items: [
      { value: "media", label: msg("popup.view.media"), controls: "mediaView" },
      { value: "downloads", label: msg("popup.view.downloads"), controls: "downloadsView" }
    ],
    current: state.view,
    label: msg("popup.views"),
    onSelect: (view) => switchView(view)
  });
  for (const tab of ui.views.element.querySelectorAll('[role="tab"]')) {
    tab.dataset.view = tab.dataset.value;
    tab.id = `tab-${tab.dataset.value}`;
  }
  ui.filter = select({
    id: "filterSelect",
    size: "compact",
    width: "short",
    label: msg("media.filter.label"),
    options: FILTERS.map((value) => ({ value, label: msg(`media.filter.${value}`) })),
    value: state.filter,
    onChange: (value) => { state.filter = value; jobList.setFilter(value); renderMedia(); }
  });
  $("#viewBar").replaceChildren(ui.views.element, ui.filter);

  // The same header as the side panel's: title, Rescan and one overflow. The
  // destructive Clear results stays quiet inside it (§6.1) and asks first.
  ui.header = listHeader({
    title: msg("media.listTitle"),
    actions: [{ label: msg("media.rescan"), action: "rescan", run: (control) => void rescan(control) }]
  });
  ui.more = iconButton({ iconName: "more", label: msg("media.moreActions"), action: "more", haspopup: true });
  ui.more.addEventListener("click", () => {
    const items = [];
    if (filterItems(state.items, state.filter).length >= 2) items.push({ label: msg("media.downloadAll"), iconName: "video", run: (anchor) => void downloadAll(anchor) });
    items.push({ label: msg("media.clearResults"), iconName: "clear", tone: "destructive", keepOpen: true, run: (anchor) => void clearResults(anchor) });
    menus.openItems(ui.more, items);
  });
  ui.header.actions.append(ui.more);
  $("#mediaHeaderSlot").replaceChildren(ui.header.element);

  ui.mediaEmpty = emptyState({});
  ui.mediaEmpty.element.id = "mediaEmpty";
  $("#mediaEmptySlot").replaceChildren(ui.mediaEmpty.element);
  ui.jobsEmpty = emptyState({});
  ui.jobsEmpty.element.id = "jobsEmpty";
  $("#jobsEmptySlot").replaceChildren(ui.jobsEmpty.element);
}

function bindEvents() {
  $("#urlButton").addEventListener("click", (event) => dialog.openUrl(event.currentTarget));
  $("#settingsButton").addEventListener("click", () => {
    chrome.runtime.openOptionsPage().catch(() => toast(msg("toast.settingsFailed"), "error"));
  });
  $("#workspaceButton").addEventListener("click", (event) => void runAction(event.currentTarget, "popup:workspace", async () => {
    if (!Number.isInteger(state.windowId)) throw userError(msg("popup.windowUnavailable"));
    // The first asynchronous call of the click, so the side panel opens on its gesture.
    await chrome.sidePanel.open({ windowId: state.windowId });
    window.close();
  }, { onError: showError }));
  $("#historyButton").addEventListener("click", (event) => void runAction(event.currentTarget, "popup:history", async () => {
    await call({ type: "OPEN_DOWNLOADS_PAGE" });
    window.close();
  }, { onError: showError }));
  // A permission granted or removed elsewhere (Settings): read it, then ask the
  // engine again, since the stored status still describes the old permission.
  const onPermissions = () => void readPermissions()
    .then(() => { renderAll(); return pingEngine(call); })
    .then(updateHost);
  chrome.permissions.onAdded?.addListener(onPermissions);
  chrome.permissions.onRemoved?.addListener(onPermissions);
}

/** Say something in the polite region (cleared first, so a repeat is heard). */
function say(text) {
  const announcer = $("#announcer");
  announcer.textContent = "";
  queueMicrotask(() => { announcer.textContent = text; });
}

// ---------- data ----------
async function readPermissions() {
  try { state.nativePermission = await chrome.permissions.contains({ permissions: ["nativeMessaging"] }); } catch { state.nativePermission = null; }
  try { state.notificationPermission = await chrome.permissions.contains({ permissions: ["notifications"] }); } catch { state.notificationPermission = null; }
}

async function readTab() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    state.tabId = Number.isInteger(tab?.id) ? tab.id : null;
    state.windowId = Number.isInteger(tab?.windowId) ? tab.windowId : null;
    state.readable = Number.isInteger(state.tabId) && /^https?:/i.test(String(tab?.url || ""));
  } catch {
    state.readable = false;
  }
}

/** Read this tab's media: true when the worker answered, false when it failed,
 *  null when a newer read took over. */
async function loadMedia({ quiet = false } = {}) {
  const sequence = ++state.refreshSequence;
  if (!state.readable) {
    // Nothing to read on chrome:// pages or the New Tab page; the dialog still needs the settings.
    try {
      const result = await call({ type: "GET_SETTINGS" });
      if (sequence === state.refreshSequence) state.settings = result.settings || {};
    } catch { /* keep the defaults */ }
    if (sequence !== state.refreshSequence) return null;
    state.items = [];
    state.mediaLoad = "ready";
    renderMedia();
    renderJobsState();
    return true;
  }
  if (!quiet) { state.mediaLoad = "loading"; renderMedia(); }
  let answered = true;
  try {
    const result = await call({ type: "GET_TAB_MEDIA", tabId: state.tabId });
    if (sequence !== state.refreshSequence) return null;
    state.items = (result.items || []).filter(isOfferedCandidate);
    state.settings = result.settings || state.settings || {};
    state.mediaLoad = "ready";
    if (result.hostStatus) updateHost(result.hostStatus);
  } catch {
    if (sequence !== state.refreshSequence) return null;
    answered = false;
    if (!quiet || state.mediaLoad !== "ready") state.mediaLoad = "error";
  }
  renderMedia();
  renderEngineLine();
  // The settings may have changed whether notifications are wanted.
  renderJobsState();
  return answered;
}

/** Read the downloads: true when the worker answered. */
async function loadJobs({ quiet = false } = {}) {
  if (!quiet) { state.jobsLoad = "loading"; renderJobsState(); }
  let answered = true;
  try {
    const result = await call({ type: "GET_JOBS" });
    jobList.setJobs(result.jobs || []);
    state.jobsLoad = "ready";
    if (result.hostStatus) updateHost(result.hostStatus);
  } catch {
    answered = false;
    if (!quiet || state.jobsLoad !== "ready") state.jobsLoad = "error";
  }
  renderJobsState();
  return answered;
}

function onPortMessage(message) {
  if (!message?.type || !jobList) return;
  if (message.type === "MEDIA_UPDATED" && message.tabId === state.tabId) {
    // Rendition grouping can finish after an earlier probe: read qualities again next time.
    if (message.item?.id) dialog.invalidate(String(message.item.id));
    void loadMedia({ quiet: true });
  } else if (message.type === "JOB_UPDATED") {
    jobList.upsert(message.job || message.event);
  } else if (message.type === "JOBS_UPDATED") {
    jobList.setJobs(message.jobs || []);
  } else if (message.type === "HOST_EVENT") {
    if (message.hostStatus) updateHost(message.hostStatus);
    // Older workers only emit HOST_EVENT; merging keeps this idempotent with JOB_UPDATED.
    jobList.upsert(message.event);
  }
}

function updateHost(status) {
  state.hostStatus = normalizeHostStatus(status);
  renderEngineLine();
  dialog?.syncHost();
}

// ---------- rendering ----------
function renderAll() {
  renderEngineLine();
  renderMedia();
  renderJobsState();
}

function switchView(view, { focus = false } = {}) {
  state.view = view === "downloads" ? "downloads" : "media";
  ui.views.select(state.view, { focus });
  $("#mediaView").hidden = state.view !== "media";
  $("#downloadsView").hidden = state.view !== "downloads";
  $("#main").scrollTop = 0;
  renderFilter();
  renderEngineLine();
  renderPond();
}

/** The filter always describes the list under it (§6.3): it filters the
 *  shown view, and is disabled (back on All types) when that list is empty. */
function renderFilter() {
  if (!ui.filter) return;
  const media = state.view === "media";
  const empty = media ? state.items.length === 0 : (jobList?.size || 0) === 0;
  const control = ui.filter.querySelector("select");
  if (empty && state.filter !== "all") {
    state.filter = "all";
    control.value = "all";
    jobList?.setFilter("all");
    if (media) renderMedia();
    else renderJobsState();
  }
  control.disabled = empty || (media && state.mediaLoad !== "ready");
}

function showLine(element, spec) {
  element.hidden = !spec?.text;
  setStatusLine(element, spec || {});
}

function renderEngineLine() {
  const element = $("#engineLine");
  if (state.disconnected) {
    showLine(element, { tone: "failed", text: msg("media.disconnected"), actions: [{ label: msg("action.reload"), run: () => location.reload() }] });
    return;
  }
  const issue = engineIssue(state.hostStatus, { permission: state.nativePermission });
  showLine(element, issue ? engineLine(issue, { setUp: () => void setUpEngine(), retry: (anchor) => void retryEngine(anchor) }) : null);
}

/** The Downloads view's own line: "Notifications are off" with Turn on and
 *  Don't notify me. It sits beside any engine line, so a user without the
 *  engine can still turn notifications on. */
function notifyLine() {
  const wanted = state.settings?.showNotifications !== false;
  if (!wanted || state.notificationPermission !== false || state.notifyDismissed) return null;
  return {
    text: msg("media.notificationsOff"),
    actions: [
      { label: msg("action.turnOn"), run: (anchor) => void enableNotifications(anchor) },
      { label: msg("action.dontNotify"), run: (anchor) => void dismissNotifications(anchor) }
    ]
  };
}

function renderMedia() {
  if (!ui.header) return;
  const focused = document.activeElement;
  const focusKey = focused?.dataset?.mediaId || "";
  const focusAction = focused?.dataset?.mediaAction || focused?.dataset?.action || "";
  const wasInView = Boolean(focused && $("#mediaView").contains(focused));
  const line = $("#mediaState");
  const rows = $("#mediaRows");
  const header = ui.header.element;
  ui.views.setCount("media", state.items.length);
  if (state.mediaLoad !== "ready") {
    showLine(line, state.mediaLoad === "loading"
      ? { tone: "progress", text: msg("media.loading") }
      : { tone: "failed", text: msg("media.loadFailed"), actions: [{ label: msg("action.retry"), run: () => void loadMedia() }] });
    header.hidden = true;
    rows.hidden = true;
    rows.replaceChildren();
    ui.mediaEmpty.element.hidden = true;
    renderFilter();
    renderPond();
    return;
  }
  showLine(line, null);
  const items = filterItems(state.items, state.filter);
  const any = state.items.length > 0;
  header.hidden = !any;
  ui.more.hidden = !any;
  rows.replaceChildren(...items.map((item) => mediaRow(item, {
    busy: dialog.isBusy(mediaKey(item)),
    onDownload: (target, control) => void dialog.prepare(target, control),
    onMore: (target, control) => openMediaMenu(menus, target, control, { toast, onError: showError })
  })));
  rows.hidden = items.length === 0;
  if (!state.readable) {
    ui.mediaEmpty.update({ sentence: msg("media.empty.unreadable"), body: msg("media.empty.unreadableBody") });
  } else if (!any) {
    ui.mediaEmpty.update({ sentence: msg("media.empty.none"), body: msg("media.empty.noneBody"), action: { label: msg("media.rescan"), kind: "primary", run: (control) => void rescan(control) } });
  } else if (!items.length) {
    ui.mediaEmpty.update({ sentence: msg("media.empty.noMatch"), body: msg("media.empty.noMatchBody") });
  }
  ui.mediaEmpty.element.hidden = items.length > 0;
  renderFilter();
  renderPond();
  if (wasInView && !focused.isConnected) {
    const target = (focusKey && [...rows.querySelectorAll("button[data-media-id]")].find((element) => element.dataset.mediaId === focusKey && element.dataset.mediaAction === focusAction))
      || (focusKey && findDownloadButton(focusKey))
      || (!header.hidden && header.querySelector('[data-action="rescan"]'))
      || (!ui.mediaEmpty.action.hidden && ui.mediaEmpty.action)
      || ui.views.element.querySelector('[aria-selected="true"]');
    target?.focus({ preventScroll: true });
  }
}

function renderJobsState() {
  if (!ui.jobsEmpty) return;
  const line = $("#jobsState");
  const count = jobList?.size || 0;
  ui.views.setCount("downloads", count);
  if (state.jobsLoad !== "ready") {
    showLine(line, state.jobsLoad === "loading"
      ? { tone: "progress", text: msg("media.downloads.loading") }
      : { tone: "failed", text: msg("media.downloads.loadFailed"), actions: [{ label: msg("action.retry"), run: () => void loadJobs() }] });
    $("#jobRows").hidden = true;
    ui.jobsEmpty.element.hidden = true;
    renderPond();
    return;
  }
  showLine(line, notifyLine());
  const shown = jobList?.shown || 0;
  $("#jobRows").hidden = shown === 0;
  if (count === 0) ui.jobsEmpty.update({ sentence: msg("media.downloads.empty"), body: msg("media.downloads.emptyBody") });
  else ui.jobsEmpty.update({ sentence: msg("media.downloads.noMatch"), body: msg("media.downloads.noMatchBody") });
  ui.jobsEmpty.element.hidden = shown > 0;
  renderFilter();
  renderPond();
}

function visibleEmptySentence() {
  const empty = state.view === "media" ? ui.mediaEmpty : ui.jobsEmpty;
  return empty && !empty.element.hidden ? empty.sentence : null;
}

function renderPond() {
  setPondOpening($("[data-pond]"), pond, visibleEmptySentence());
}

function getZones() {
  return pondZones($("#column"), visibleEmptySentence());
}

// ---------- actions ----------
async function rescan(control) {
  await runAction(control, `popup:scan:${state.tabId}`, async () => {
    if (!Number.isInteger(state.tabId)) throw userError(msg("media.loadFailed"));
    await call({ type: "SCAN_TAB", tabId: state.tabId });
    await new Promise((resolve) => setTimeout(resolve, 450));
    // A page that could not be read is a failure, not "Scan finished".
    if ((await loadMedia({ quiet: true })) === false) throw userError(msg("media.loadFailed"));
    toast(msg("media.scanDone"));
  }, { onError: showError });
}

async function clearResults(control) {
  const yes = await menus.confirm(control, { question: msg("media.clearConfirm"), confirmLabel: msg("media.clearResults") });
  if (!yes) return;
  await runAction(control, `popup:clear:${state.tabId}`, async () => {
    await call({ type: "CLEAR_TAB", tabId: state.tabId });
    const result = await call({ type: "CLEAR_COMPLETED_JOBS" });
    jobList.setJobs(result.jobs || []);
    dialog.invalidate();
    await loadMedia({ quiet: true });
    toast(msg("media.cleared"));
  }, { onError: showError });
  if (!control.isConnected || control.closest("[hidden]")) (ui.mediaEmpty.action.hidden ? ui.views.element.querySelector('[aria-selected="true"]') : ui.mediaEmpty.action)?.focus({ preventScroll: true });
}

async function downloadAll(anchor) {
  const items = filterItems(state.items, state.filter);
  if (!items.length) { toast(msg("media.nothingToDownload"), "warning"); return; }
  await runAction(anchor, `popup:all:${state.tabId}`, async () => {
    if (items.some((item) => downloadNeedsNative(item, { useNativeForDirect: state.settings?.useNativeForDirect }))) {
      // The first asynchronous call of the click keeps the permission prompt's gesture.
      const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
      if (!granted) throw userError(msg("toast.engineNeeded"));
      const host = await pingEngine(call);
      updateHost(host);
      requireEngineReady(host);
    }
    const result = await call({ type: "DOWNLOAD_BATCH", tabId: state.tabId, candidates: items.map(candidateReference), options: {} });
    await loadJobs({ quiet: true });
    toast(msg("media.batchStarted", { count: result.started || 0, failed: result.failed || 0 }), result.failed ? "warning" : "success");
    if (result.started) switchView("downloads", { focus: true });
  }, { onError: showError });
}

function onStarted(result, { item, options }) {
  if (result.method === "native" && result.jobId) {
    const placeholder = { jobId: result.jobId, status: "queued", progress: 0, speed: 0 };
    if (options.filename) placeholder.filename = options.filename;
    jobList.upsert(placeholder);
    showAllTypes();
    switchView("downloads", { focus: true });
  } else {
    toast(msg("toast.downloadStarted"));
  }
  if (item?.urlMode) void loadMedia({ quiet: true });
}

/** A failed start that a job row now represents: show the row instead of a dialog error. */
async function onRepresented(jobId) {
  await loadJobs({ quiet: true });
  if (!jobList.has(jobId)) return false;
  // The dialog closes and focus moves: say what happened to the download.
  jobList.announce(jobId);
  showAllTypes();
  switchView("downloads", { focus: true });
  return true;
}

/** A download the user just started is never hidden by the type filter. */
function showAllTypes() {
  if (state.filter === "all") return;
  state.filter = "all";
  ui.filter.querySelector("select").value = "all";
  jobList.setFilter("all");
  renderMedia();
}

async function setUpEngine() {
  if (await openEngineSetup()) window.close();
  else toast(msg("toast.settingsFailed"), "error");
}

async function retryEngine(anchor) {
  await runAction(anchor, "popup:ping-host", async () => {
    await recheckEngine({ call, onHost: updateHost, permission: state.nativePermission });
    toast(msg("media.engine.ready"));
  }, { onError: showError });
}

async function enableNotifications(anchor) {
  await runAction(anchor, "popup:notifications", async () => {
    // The first asynchronous call of this click, so the prompt keeps its gesture.
    const granted = await chrome.permissions.request({ permissions: ["notifications"] });
    state.notificationPermission = granted;
    renderJobsState();
    toast(msg(granted ? "toast.notificationsOn" : "toast.notificationsDenied"), granted ? "success" : "warning");
  }, { onError: showError });
}

async function dismissNotifications(anchor) {
  state.notifyDismissed = true;
  renderJobsState();
  if (!state.settings || !Object.keys(state.settings).length) return;
  await runAction(anchor, "popup:notifications-off", async () => {
    const result = await call({ type: "SAVE_SETTINGS", settings: { ...state.settings, showNotifications: false } });
    state.settings = result.settings || { ...state.settings, showNotifications: false };
  }, { onError: showError });
}
