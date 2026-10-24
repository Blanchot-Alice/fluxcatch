// FluxCatch side-panel workspace on the v2 system: the popup's skeleton at
// 420 wide (design review P2). Top bar: BrandMark S, "Download a link" and
// Settings. The engine's one status line. "Media on this page": while empty,
// the page host as meta and the empty state with Rescan as the one primary;
// with results, Rescan and an overflow with Download all over detected rows.
// "Downloads" with All downloads and, once something has ended, Clear
// finished; the active download as the one focus panel, then rows.js rows,
// or one body line when there are none. The media empty state sits high on
// the text column with the pond around it. The Download dialog, rows and lists are
// shared with the popup (ui/v2/media.js); all copy comes from ui/v2/messages.js.
import { bootLocale, onLocaleChange } from "../ui/v2/locale.js";
import { msg } from "../ui/v2/messages.js";
import { brandMark, createMenus, createToaster, emptyState, icon, iconButton, listHeader, runAction, setStatusLine } from "../ui/v2/components.js";
import { errorText, userError } from "../ui/v2/errors.js";
import { callWorker as call, connectWorkerPort } from "../ui/v2/runtime.js";
import { contentBoxes, mountPondLayer } from "../ui/v2/pond.js";
import {
  applyStaticCopy,
  bindMist,
  candidateReference,
  createJobList,
  createMediaDialog,
  downloadNeedsNative,
  engineIssue,
  engineLine,
  findDownloadButton,
  isOfferedCandidate,
  mediaKey,
  mediaRow,
  normalizeHostStatus,
  openEngineSetup,
  openMediaMenu,
  pingEngine,
  recheckEngine,
  requireEngineReady
} from "../ui/v2/media.js";
import { captureMediaRefresh, isMediaRefreshCurrent } from "./refresh-guard.js";

const $ = (selector) => document.querySelector(selector);

const state = {
  tabId: null,
  tabUrl: "",
  readable: true,
  items: [],
  settings: {},
  hostStatus: {},
  nativePermission: null,
  refreshToken: 0,
  mediaLoad: "loading",
  jobsLoad: "loading",
  disconnected: false
};

// Connect before anything awaits, so no broadcast is missed. The panel lives
// long: an idle worker drops the port, so the page reconnects, resyncs what
// it missed, and says "stopped responding" only when the worker is gone.
connectWorkerPort({
  name: "fluxcatch-sidepanel",
  onMessage: (message) => onPortMessage(message),
  onReconnect: async () => {
    if (!jobList) return true;
    const [jobs] = await Promise.all([loadJobs({ quiet: true }), refreshMedia()]);
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

jobList = createJobList({ list: $("#jobRows"), focusSlot: $("#focusSlot"), menus, toast, onError: showError, announcer: $("#announcer"), onChange: renderJobsState, call });
dialog = createMediaDialog({
  getContext: () => ({ tabId: state.tabId, settings: state.settings, hostStatus: state.hostStatus, permission: state.nativePermission }),
  ping: () => pingEngine(call),
  onHost: updateHost,
  onStarted,
  onRepresented: async (jobId) => {
    await loadJobs({ quiet: true });
    if (!jobList.has(jobId)) return false;
    // The dialog closes: say what happened to the download.
    jobList.announce(jobId);
    return true;
  },
  onBusy: (key, busy) => {
    renderMedia();
    // The row's meta reads "Reading qualities…"; say it too, as v1's live status did.
    if (busy) say(msg("media.reading"));
  },
  setUp: () => void setUpEngine(),
  fallbackFocus: () => $("#urlButton"),
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
  bindMist($("#topbar"), window);
  onLocaleChange(() => {
    buildChrome();
    applyStaticCopy();
    dialog.applyCopy();
    jobList.relabel();
    renderAll();
  });
  // The pond paints on its own time; the first data load never waits for it.
  void mountPondLayer({ element: $("[data-pond]"), getContentBoxes }).catch(() => null).then((mounted) => {
    pond = mounted;
    renderPond();
  });
  await Promise.allSettled([readPermissions(), refreshAll()]);
  renderEngineLine();
  // A fresh status (the worker may have to start the engine to answer).
  void pingEngine(call).then(updateHost);
}

// ---------- static chrome (rebuilt on a language switch) ----------
function buildChrome() {
  document.title = `${msg("sidepanel.title")} · ${msg("brand.name")}`;
  $("#topbarInner [data-brandmark]")?.remove();
  $("#topbarInner").prepend(brandMark({ size: "s" }));

  ui.mediaHeader = listHeader({
    title: msg("media.listTitle"),
    id: "mediaHeading",
    metaUserContent: true,
    actions: [{ label: msg("media.rescan"), action: "rescan", run: (control) => void rescan(control) }]
  });
  ui.more = iconButton({ iconName: "more", label: msg("media.moreActions"), action: "more", haspopup: true });
  ui.more.addEventListener("click", () => {
    menus.openItems(ui.more, [{ label: msg("media.downloadAll"), iconName: "video", run: (anchor) => void downloadAll(anchor) }]);
  });
  ui.mediaHeader.actions.append(ui.more);
  $("#mediaHeaderSlot").replaceChildren(ui.mediaHeader.element);

  ui.downloadsHeader = listHeader({
    title: msg("sidepanel.downloadsTitle"),
    id: "downloadsHeading",
    actions: [
      { label: msg("media.allDownloads"), action: "history", run: (control) => void openHistory(control) },
      { label: msg("sidepanel.clearFinished"), kind: "destructive", action: "clear-finished", run: (control) => void clearFinished(control) }
    ]
  });
  $("#downloadsHeaderSlot").replaceChildren(ui.downloadsHeader.element);

  ui.mediaEmpty = emptyState({});
  ui.mediaEmpty.element.id = "mediaEmpty";
  $("#mediaEmptySlot").replaceChildren(ui.mediaEmpty.element);
  // No downloads is one body line, never a second Display sentence: the media
  // empty state above is the panel's one real empty state.
  ui.jobsEmpty = emptyState({});
  ui.jobsEmpty.element.id = "jobsEmpty";
  ui.jobsEmpty.sentence.hidden = true;
  $("#jobsEmptySlot").replaceChildren(ui.jobsEmpty.element);
}

function bindEvents() {
  $("#urlButton").addEventListener("click", (event) => dialog.openUrl(event.currentTarget));
  $("#settingsButton").addEventListener("click", () => {
    chrome.runtime.openOptionsPage().catch(() => toast(msg("toast.settingsFailed"), "error"));
  });
  chrome.tabs.onActivated?.addListener(() => void refreshAll());
  chrome.tabs.onUpdated?.addListener((tabId, changeInfo) => {
    if (tabId !== state.tabId) return;
    if (changeInfo.status === "complete" || changeInfo.url) void refreshAll();
  });
  // A permission granted or removed elsewhere (Settings): read it, then ask the
  // engine again, since the stored status still describes the old permission.
  const onPermissions = () => void readPermissions()
    .then(() => { renderEngineLine(); return pingEngine(call); })
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
}

async function refreshAll() {
  const token = ++state.refreshToken;
  state.mediaLoad = "loading";
  renderMedia();
  let tab = null;
  try { [tab] = await chrome.tabs.query({ active: true, currentWindow: true }); } catch { tab = null; }
  if (token !== state.refreshToken) return;
  state.tabId = Number.isInteger(tab?.id) ? tab.id : null;
  state.tabUrl = String(tab?.url || "");
  state.readable = Number.isInteger(state.tabId) && /^https?:/i.test(state.tabUrl);
  await Promise.allSettled([refreshMedia(), loadJobs({ quiet: state.jobsLoad === "ready" })]);
}

/** Read the active tab's media: true when the worker answered, false when it
 *  failed, null when another tab became active first. */
async function refreshMedia() {
  const request = captureMediaRefresh(state);
  if (!state.readable || !Number.isInteger(request.tabId)) {
    // Nothing to read on chrome:// pages or the New Tab page; the dialog still needs the settings.
    try {
      const result = await call({ type: "GET_SETTINGS" });
      state.settings = result.settings || state.settings;
    } catch { /* keep the last settings */ }
    if (request.refreshToken !== state.refreshToken) return null;
    state.items = [];
    state.mediaLoad = "ready";
    renderMedia();
    return true;
  }
  let answered = true;
  try {
    const result = await call({ type: "GET_TAB_MEDIA", tabId: request.tabId });
    // A response for tab A must not land after tab B became active.
    if (!isMediaRefreshCurrent(request, state)) return null;
    state.items = (result.items || []).filter(isOfferedCandidate);
    state.settings = result.settings || state.settings;
    state.mediaLoad = "ready";
    if (result.hostStatus) updateHost(result.hostStatus);
  } catch {
    if (!isMediaRefreshCurrent(request, state)) return null;
    answered = false;
    if (state.mediaLoad !== "ready") state.mediaLoad = "error";
  }
  renderMedia();
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
    if (message.item?.id) dialog.invalidate(String(message.item.id));
    void refreshMedia();
  } else if (message.type === "JOB_UPDATED") {
    jobList.upsert(message.job || message.event);
  } else if (message.type === "JOBS_UPDATED") {
    jobList.setJobs(message.jobs || []);
  } else if (message.type === "HOST_EVENT") {
    if (message.hostStatus) updateHost(message.hostStatus);
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

function showLine(element, spec) {
  element.hidden = !spec?.text;
  setStatusLine(element, spec || {});
}

function pageHost() {
  try {
    return state.readable ? new URL(state.tabUrl).hostname.replace(/^www\./i, "") : "";
  } catch {
    return "";
  }
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

function renderMedia() {
  if (!ui.mediaHeader) return;
  const focused = document.activeElement;
  const focusKey = focused?.dataset?.mediaId || "";
  const focusAction = focused?.dataset?.mediaAction || "";
  const wasInSection = Boolean(focused && $("#mediaSection").contains(focused));
  // The host names the page the empty sentence speaks of; rows carry their own.
  ui.mediaHeader.setMeta(state.items.length ? "" : pageHost());
  // Rescan is the empty state's primary while the list is empty (§6.14), and
  // a tertiary in the header once results exist.
  const headerRescan = ui.mediaHeader.actions.querySelector('[data-action="rescan"]');
  headerRescan.hidden = !state.readable || state.items.length === 0;
  const line = $("#mediaState");
  const rows = $("#mediaRows");
  if (state.mediaLoad !== "ready") {
    showLine(line, state.mediaLoad === "loading"
      ? { tone: "progress", text: msg("media.loading") }
      : { tone: "failed", text: msg("media.loadFailed"), actions: [{ label: msg("action.retry"), run: () => void refreshAll() }] });
    ui.more.hidden = true;
    rows.hidden = true;
    rows.replaceChildren();
    ui.mediaEmpty.element.hidden = true;
    renderPond();
    return;
  }
  showLine(line, null);
  const items = state.items;
  ui.more.hidden = items.length < 2;
  rows.replaceChildren(...items.map((item) => mediaRow(item, {
    busy: dialog.isBusy(mediaKey(item)),
    onDownload: (target, control) => void dialog.prepare(target, control),
    onMore: (target, control) => openMediaMenu(menus, target, control, { toast, onError: showError })
  })));
  rows.hidden = items.length === 0;
  if (!state.readable) ui.mediaEmpty.update({ sentence: msg("media.empty.unreadable"), body: msg("media.empty.unreadableBody") });
  else ui.mediaEmpty.update({ sentence: msg("media.empty.none"), body: msg("media.empty.noneBody"), action: { label: msg("media.rescan"), kind: "primary", run: (control) => void rescan(control) } });
  ui.mediaEmpty.element.hidden = items.length > 0;
  renderPond();
  // A re-render can remove the focused control, or hide the header's Rescan under it.
  if (wasInSection && (!focused.isConnected || focused.hidden)) {
    const target = (focusKey && [...rows.querySelectorAll("button[data-media-id]")].find((element) => element.dataset.mediaId === focusKey && element.dataset.mediaAction === focusAction))
      || (focusKey && findDownloadButton(focusKey))
      || (!headerRescan.hidden && headerRescan)
      || (!ui.mediaEmpty.element.hidden && !ui.mediaEmpty.action.hidden && ui.mediaEmpty.action)
      || $("#urlButton");
    target?.focus({ preventScroll: true });
  }
}

function renderJobsState() {
  if (!ui.jobsEmpty) return;
  const line = $("#jobsState");
  const count = jobList?.size || 0;
  // Clear finished appears only when something has ended (§6.14, like Clear results).
  const clear = ui.downloadsHeader.actions.querySelector('[data-action="clear-finished"]');
  clear.hidden = !jobList?.endedCount;
  if (state.jobsLoad !== "ready") {
    showLine(line, state.jobsLoad === "loading"
      ? { tone: "progress", text: msg("media.downloads.loading") }
      : { tone: "failed", text: msg("media.downloads.loadFailed"), actions: [{ label: msg("action.retry"), run: () => void loadJobs() }] });
    $("#jobRows").hidden = true;
    ui.jobsEmpty.element.hidden = true;
    renderPond();
    return;
  }
  showLine(line, null);
  $("#jobRows").hidden = false;
  ui.jobsEmpty.update({ body: msg("media.downloads.emptyBody") });
  ui.jobsEmpty.element.hidden = count > 0;
  renderPond();
}

/** The layer's mask follows the panel's boxes; a render that moved them repaints it. */
function renderPond() {
  pond?.refresh();
}

// Every content box (v3 §3.1): the header, each status line with text, the
// list headers, the focus panel, the lists and each text block of an empty state.
const SIDEPANEL_BOXES = ["#topbarInner", "#engineLine", "#mediaHeaderSlot > *", "#mediaState", "#mediaRows", "#mediaEmptySlot .empty-state > *", "#downloadsHeaderSlot > *", "#jobsState", "#focusSlot > *", "#jobRows", "#jobsEmptySlot .empty-state > *"];

function getContentBoxes() {
  return contentBoxes(SIDEPANEL_BOXES);
}

// ---------- actions ----------
async function rescan(control) {
  await runAction(control, `sidepanel:scan:${state.tabId}`, async () => {
    if (!Number.isInteger(state.tabId)) throw userError(msg("media.loadFailed"));
    await call({ type: "SCAN_TAB", tabId: state.tabId });
    await new Promise((resolve) => setTimeout(resolve, 450));
    // A page that could not be read is a failure, not "Scan finished".
    if ((await refreshMedia()) === false) throw userError(msg("media.loadFailed"));
    toast(msg("media.scanDone"));
  }, { onError: showError });
}

async function downloadAll(anchor) {
  const items = state.items;
  if (!items.length) { toast(msg("media.nothingToDownload"), "warning"); return; }
  await runAction(anchor, `sidepanel:all:${state.tabId}`, async () => {
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
  }, { onError: showError });
}

function onStarted(result, { item }) {
  toast(msg("toast.downloadStarted"));
  void loadJobs({ quiet: true });
  if (item?.urlMode) void refreshMedia();
}

async function openHistory(control) {
  await runAction(control, "sidepanel:history", () => call({ type: "OPEN_DOWNLOADS_PAGE" }), { onError: showError });
}

async function clearFinished(control) {
  // Destructive (§6.1): failed rows lose their Retry, so ask first, as the popup's Clear results does.
  const yes = await menus.confirm(control, { question: msg("sidepanel.clearConfirm"), confirmLabel: msg("sidepanel.clearFinished") });
  if (!yes) return;
  await runAction(control, "sidepanel:clear-finished", async () => {
    const result = await call({ type: "CLEAR_COMPLETED_JOBS" });
    jobList.setJobs(result.jobs || []);
    toast(result.removed ? msg("sidepanel.cleared", { count: result.removed }) : msg("toast.nothingToClear"), result.removed ? "success" : "warning");
  }, { onError: showError });
  // Nothing left to clear: the button is hidden, so focus moves to its neighbour.
  if (control.hidden && (document.activeElement === control || document.activeElement === document.body)) ui.downloadsHeader.actions.querySelector('[data-action="history"]')?.focus({ preventScroll: true });
}

async function setUpEngine() {
  if (!(await openEngineSetup())) toast(msg("toast.settingsFailed"), "error");
}

async function retryEngine(anchor) {
  await runAction(anchor, "sidepanel:ping-host", async () => {
    await recheckEngine({ call, onHost: updateHost, permission: state.nativePermission });
    toast(msg("media.engine.ready"));
  }, { onError: showError });
}
