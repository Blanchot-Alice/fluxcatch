// Havre component preview (design review §0: 1440 × auto, full page) on
// the v2 system: the living gallery of the shared components, built from the
// real builders (ui/v2 components.js, controls.js, rows.js, media.js) with
// fixture data, so it never drifts from the product.
//
// One view at a time, chosen by the segmented control or ?view=<id>, so each
// view keeps the screen budgets on its own (six text styles, two Display uses,
// three left edges, one primary button, no container inside a container).
// ?demo=static freezes every animation and live value for screenshots;
// ?theme=auto|morning|dusk, ?density=comfortable|compact and
// ?motion=full|reduced preset the gallery's own controls (Controls view);
// ?dialog=link|item opens the Download dialog specimen in that mode.
// Copy comes from ui/v2/messages (preview.js names the views and specimens;
// the specimens show product copy from common.js, media.js, popup.js and
// settings.js).
import { bootLocale, dayGroupOf, onLocaleChange } from "../ui/v2/locale.js";
import { msg } from "../ui/v2/messages.js";
import { brandMark, button, createMenus, createToaster, emptyState, filename, groupLabel, iconButton, listHeader, setStatusLine, status, statusLine } from "../ui/v2/components.js";
import { dialogShell, fieldStack, markSaved, nav, numberField, segmented, select, setOptions, setSettingError, settingRow, switchControl, textField, controlOf } from "../ui/v2/controls.js";
import { completedMeta, historyRow, liveRow, updateLiveRow } from "../ui/v2/rows.js";
import {
  applyStaticCopy,
  bindMist,
  defaultFilename,
  defaultFormat,
  engineLine,
  formatOptions,
  isStreamKind,
  mediaRow,
  openEngineSetup,
  openMediaMenu,
  replaceFilenameExtension,
  urlItem,
  variantLabel
} from "../ui/v2/media.js";
import { errorText } from "../ui/v2/errors.js";
import { contentBoxes, mountPondLayer } from "../ui/v2/pond.js";
// Settings' own limits, defaults and file-name tokens (a logic module, no UI),
// so the setting-row specimens show the product rows exactly.
import { DEFAULT_FORM_STATE, FILENAME_TOKENS, FORM_LIMITS, TOKEN_LABELS, insertTemplateToken } from "../options/form-state.js";

const $ = (selector) => document.querySelector(selector);
const root = document.documentElement;
const params = new URLSearchParams(globalThis.location?.search || "");
const STATIC = params.get("demo") === "static";

/** The gallery's views, in switch order. Each id works as ?view=<id>. */
const VIEWS = ["type", "text", "controls", "rows", "feedback", "overlays"];
// v1 links used light / dark / system; they still work.
const THEMES = { auto: "auto", system: "auto", morning: "morning", light: "morning", dusk: "dusk", dark: "dusk" };

const prefs = {
  view: VIEWS.includes(params.get("view")) ? params.get("view") : VIEWS[0],
  theme: THEMES[params.get("theme")] || "auto",
  density: params.get("density") === "compact" ? "compact" : "comfortable",
  motion: params.get("motion") === "reduced" ? "reduced" : "full",
  // The Download dialog opens as "Download a link" does, unless ?dialog=item.
  dialog: params.get("dialog") === "item" ? "item" : "link"
};
if (STATIC) root.dataset.demo = "static";
applyPrefs();

// ---------- fixtures ----------
const MINUTE = 60_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;
// The size unit Settings' minimum-size row shows (options.js KB_UNIT): the
// same symbol in both languages, so it is not a message.
const KB_UNIT = "KB";
const NOW = Date.now();
// History is dated against a fixed afternoon, so its day groups and relative
// times read the same whatever the hour the gallery opens.
const AFTERNOON = (() => { const date = new Date(NOW); date.setHours(15, 0, 0, 0); return date.getTime(); })();

const MEDIA = [
  { id: "pv-file", kind: "video", displayUrl: "https://cdn.example.com/lectures/lecture-12.mp4", displayTitle: "Lecture 12 · Pharmacokinetics.mp4", contentLength: 812_000_000, copyable: true, lastSeen: NOW - 5 * MINUTE },
  { id: "pv-stream", kind: "hls", displayUrl: "https://stream.example.com/keynote/master.m3u8", displayTitle: "Keynote 2026", height: 1080, duration: 3480, recommended: true, lastSeen: NOW - 2 * MINUTE },
  { id: "pv-audio", kind: "audio", displayUrl: "https://cdn.example.com/podcast/studio-session-41.m4a", displayTitle: "Studio Session 41.m4a", contentLength: 48_300_000, copyable: true, lastSeen: NOW - 12 * MINUTE }
];

const VARIANTS = [
  { url: "https://stream.example.com/keynote/1080.m3u8", height: 1080, bandwidth: 6_200_000 },
  { url: "https://stream.example.com/keynote/720.m3u8", height: 720, bandwidth: 3_100_000 },
  { url: "https://stream.example.com/keynote/480.m3u8", height: 480, bandwidth: 1_400_000 }
];

const HISTORY = [
  { jobId: "pv-h1", status: "completed", method: "native", kind: "video", filename: "Interstellar Trailer 4K.mp4", total: 2_350_000_000, media: { height: 2160, duration: 148, container: "mp4" }, sourceUrl: "https://www.youtube.com/watch?v=zSWdZVtXT7E", finishedAt: AFTERNOON - HOUR, hasFile: true, hasSource: true },
  // A real engine failure line (the worker redacts the URL); rows.js localises it.
  { jobId: "pv-h2", status: "failed", method: "native", kind: "hls", filename: "Live Session.m3u8", sourceUrl: "https://example.tv/live/42", finishedAt: AFTERNOON - 3 * HOUR, error: "HLS media segment 11 failed: HTTP 403 for https://example.tv/…", retryable: true },
  { jobId: "pv-h3", status: "completed", method: "native", kind: "audio", filename: "Keynote Highlights.m4a", total: 48_300_000, media: { duration: 1860, container: "m4a" }, sourceUrl: "https://developer.apple.com/videos/", finishedAt: AFTERNOON - DAY, hasFile: true, fileMissing: true, hasSource: true },
  { jobId: "pv-h4", status: "cancelled", method: "native", kind: "video", filename: "Behind the Scenes.webm", sourceUrl: "https://vimeo.com/1234567", finishedAt: AFTERNOON - DAY - 2 * HOUR, retryable: true }
];

// The engine's progress text as the worker forwards it today (Chinese, so it
// is written as escapes here). The UI never shows it: rows.js reads it through
// segmentsFromActivity and describeJobActivity only.
const ENGINE_PARTS = "\u5206\u7247";
const ENGINE_FINISHING = "\u6b63\u5728\u65e0\u635f\u5c01\u88c5";

// Live rows beside the focus panel, one per progress state.
const LIVE = [
  { job: { jobId: "pv-l2", status: "paused", method: "native", kind: "audio", filename: "Studio Session 40.m4a", progress: 0.44, bytes: 21_400_000, total: 48_300_000, resumable: true }, finishing: null },
  { job: { jobId: "pv-l3", status: "queued", method: "native", kind: "video", filename: "City Walk 4K.webm", progress: 0, total: 310_000_000 }, finishing: null },
  { job: { jobId: "pv-l4", status: "remuxing", method: "native", kind: "video", filename: "Interview Raw.mkv", progress: 1, message: ENGINE_FINISHING }, finishing: null },
  // The media list's file (MEDIA[0]), just finished: the same glyph and size as above.
  { job: { jobId: "pv-l5", status: "downloading", method: "native", kind: "video", filename: "Lecture 12 · Pharmacokinetics.mp4", progress: 1, bytes: 812_000_000, total: 812_000_000 }, finishing: { phase: "complete" } }
];

// The focus panel runs a simulated download (frozen at 62 % under ?demo=static):
// it fills, holds celadon, settles, and starts again. It is the media list's
// stream (MEDIA[1], Keynote 2026), so the panel draws the same stream glyph as
// the list, and only a stream reports parts. The engine's byte total is its
// own estimate; the list shows no size for a stream.
const DEMO_ID = "pv-live";
const DEMO_TOTAL = 1_200_000_000;
const DEMO_PARTS = 120;
const DEMO_SECONDS = 14;
const DEMO_SPEED = DEMO_TOTAL / DEMO_SECONDS;
const SAMPLES = 48;
const TICK_MS = 250;
const SETTLE_MS = 1200;
const HOLD_MS = 600;
// The empty state's pond zone on a full page (the Downloads page uses 560).
const STATIC_WAVE = [0.2, 0.42, 0.55, 0.63, 0.7, 0.66, 0.74, 0.8, 0.78, 0.86, 0.9, 0.84, 0.88, 0.95, 0.92, 0.97, 0.93, 0.9, 0.96, 1, 0.94, 0.9, 0.95, 0.97];
const demo = { fraction: 0.62, paused: false, samples: STATIC_WAVE.map((value) => DEMO_SPEED * value), finishing: null, view: null, run: 0 };

// ---------- boot ----------
await bootLocale();
const toast = createToaster($("#toastRegion"));
// One menus instance for the page: real menus open from the specimens, and
// the in-place copies in the gallery are cloned from what it builds.
const menus = createMenus($("#menuLayer"));
// Toasts for the gallery are built here and cloned in place (a real toast
// leaves after 4 s).
const scratchRegion = document.createElement("div");
const scratchToast = createToaster(scratchRegion);
let switcher = null;
let navigation = null;
let pond = null;
// The Download dialog specimen ({ setMode }), rebuilt with each render.
let dialogSpecimenApi = null;

$("#topbarInner").prepend(brandMark({ size: "m" }));
bindMist($("#topbar"));
render();
onLocaleChange(render);
// Every content box of the shown view (v3 §3.1): the header, the title, the
// view switch, each block of the view and each text block of its empty state.
const PREVIEW_BOXES = ["#topbarInner", "#previewTitle", "#viewSwitch", "[data-view-panel]:not([hidden]) > :not(.empty-state)", "[data-view-panel]:not([hidden]) .empty-state > *"];
mountPondLayer({ element: $("[data-pond]"), getContentBoxes: () => contentBoxes(PREVIEW_BOXES) }).then((mounted) => { pond = mounted; }).catch(() => {});
// The demo's timer: none under ?demo=static until a confirmed Cancel restarts the demo.
let timer = STATIC ? 0 : setInterval(tick, TICK_MS);

function render() {
  applyStaticCopy(document);
  document.title = `${msg("preview.title")} · ${msg("brand.name")}`;
  buildSwitch();
  buildType($("#view-type"));
  buildText($("#view-text"));
  buildControls($("#view-controls"));
  buildRows($("#view-rows"));
  buildFeedback($("#view-feedback"));
  buildOverlays($("#view-overlays"));
  showView(prefs.view, { write: false });
}

// ---------- preferences, URL and views ----------
function applyPrefs() {
  if (prefs.theme === "auto") delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  if (prefs.density === "compact") root.dataset.density = "compact";
  else delete root.dataset.density;
  if (prefs.motion === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
}

function query(view = prefs.view) {
  const next = new URLSearchParams(globalThis.location?.search || "");
  next.set("view", view);
  if (prefs.dialog === "item") next.set("dialog", "item"); else next.delete("dialog");
  if (prefs.theme === "auto") next.delete("theme"); else next.set("theme", prefs.theme);
  if (prefs.density === "compact") next.set("density", "compact"); else next.delete("density");
  if (prefs.motion === "reduced") next.set("motion", "reduced"); else next.delete("motion");
  return `?${next}`;
}

function writeUrl() {
  try { history.replaceState(null, "", query()); } catch { /* a file:// copy has no history to write */ }
  // The nav's links carry the current preferences, for a new tab or a copied link.
  for (const link of navigation?.element.querySelectorAll("[data-nav-id]") || []) link.href = query(link.dataset.navId);
}

function showView(id, { write = true, focusTab = false } = {}) {
  prefs.view = VIEWS.includes(id) ? id : VIEWS[0];
  for (const panel of document.querySelectorAll("[data-view-panel]")) panel.hidden = panel.dataset.viewPanel !== prefs.view;
  switcher?.select(prefs.view, { focus: focusTab });
  navigation?.setCurrent(prefs.view);
  pond?.refresh();
  if (write) writeUrl();
}

function buildSwitch() {
  switcher = segmented({
    items: VIEWS.map((id) => ({ value: id, label: msg(`preview.view.${id}`), controls: `view-${id}` })),
    current: prefs.view,
    label: msg("preview.views"),
    onSelect: (id) => showView(id)
  });
  for (const tab of switcher.element.querySelectorAll('[role="tab"]')) tab.id = `tab-${tab.dataset.value}`;
  $("#viewSwitch").replaceChildren(switcher.element);
  for (const panel of document.querySelectorAll("[data-view-panel]")) panel.setAttribute("aria-labelledby", `tab-${panel.dataset.viewPanel}`);
}

// ---------- small helpers ----------
function text(tag, className, words) {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = words;
  return element;
}

/**
 * A sample on the text column with its name on the trailing edge. The name
 * takes the label role unless a view passes another (Text styles uses meta,
 * so each name recedes behind the sample it names).
 */
function specimens(lines, { nameRole = "t-label" } = {}) {
  const list = document.createElement("div");
  list.className = "specimens";
  for (const [sample, name] of lines) {
    const line = document.createElement("div");
    line.className = "specimen";
    line.append(sample, text("span", nameRole, name));
    list.append(line);
  }
  return list;
}

function rows(children, className = "") {
  const list = document.createElement("ul");
  list.className = `rows${className ? ` ${className}` : ""}`;
  list.append(...children);
  return list;
}

function showError(error) {
  toast(errorText(error), "error");
}

async function confirmThen(anchor, question, confirmLabel, done) {
  if (await menus.confirm(anchor, { question, confirmLabel })) toast(done);
}

function copyLink(url) {
  return navigator.clipboard.writeText(url).then(() => toast(msg("toast.linkCopied"))).catch(showError);
}

function setUp() {
  void openEngineSetup();
}

function noop() {}

/** The overflow of a history row (§6.4): Show in Finder, Open source page, Copy link, Remove from history. */
function historyItems(record) {
  const items = [];
  if (record.status === "completed" && record.hasFile && !record.fileMissing) items.push({ label: msg("action.showInFinder"), iconName: "folder", run: noop });
  if (record.sourceUrl) {
    items.push({ label: msg("action.openSource"), iconName: "source", run: noop });
    items.push({ label: msg("action.copyLink"), iconName: "copy", run: () => void copyLink(record.sourceUrl) });
  }
  items.push({ label: msg("action.remove"), iconName: "remove", tone: "destructive", keepOpen: true, run: (anchor) => void confirmThen(anchor, msg("job.removeConfirm"), msg("action.remove"), msg("toast.removed")) });
  return items;
}

/**
 * A menu or confirmation at rest: the page's own menus instance builds it
 * against a detached anchor (so no row is marked and focus is not returned),
 * the result is copied into the gallery, and the floating layer closes again.
 * The copy keeps the builder's classes; its buttons are wired to the same runs.
 */
function frozenMenu(open, className, wire) {
  const previous = document.activeElement;
  open(document.createElement("button"));
  const copy = $("#menuLayer .menu").cloneNode(true);
  menus.close({ restore: false });
  if (previous?.isConnected && previous !== document.body && document.activeElement !== previous) previous.focus?.({ preventScroll: true });
  copy.removeAttribute("style");
  // A copy at rest is a picture of the menu, not a live menu: no menu roles.
  copy.removeAttribute("role");
  copy.removeAttribute("aria-label");
  for (const node of copy.querySelectorAll("[role]")) node.removeAttribute("role");
  wire([...copy.querySelectorAll("button")]);
  const frame = document.createElement("div");
  frame.className = className;
  frame.append(copy);
  return frame;
}

/** A toast at rest: built by createToaster, copied without its live-region role. */
function frozenToast(words, tone) {
  scratchToast(words, tone);
  const copy = scratchRegion.lastElementChild.cloneNode(true);
  scratchRegion.replaceChildren();
  copy.removeAttribute("role");
  return copy;
}

// ---------- view: Type and brand ----------
function buildType(panel) {
  const brand = (size, name) => {
    const line = document.createElement("div");
    line.className = "lead-grid brand-specimen";
    line.append(brandMark({ size }), text("span", "t-label", name));
    return line;
  };
  // The extension's own icon set (manifest icons), at the sizes Chrome uses.
  const icons = document.createElement("div");
  icons.className = "icon-specimens";
  for (const size of [128, 48, 32, 16]) {
    const image = document.createElement("img");
    image.src = `../icons/icon${size}.png`;
    image.alt = "";
    image.setAttribute("width", String(size));
    image.setAttribute("height", String(size));
    icons.append(image);
  }
  panel.replaceChildren(
    groupLabel(msg("preview.group.brand")),
    brand("s", msg("preview.brand.small")),
    brand("m", msg("preview.brand.medium")),
    groupLabel(msg("preview.group.icon")),
    icons,
    groupLabel(msg("preview.group.type")),
    specimens([
      [text("p", "t-empty", msg("media.downloads.empty")), msg("preview.role.empty")],
      [text("p", "t-title", msg("media.listTitle")), msg("preview.role.title")]
    ])
  );
}

// ---------- view: Text styles ----------
function buildText(panel) {
  const name = document.createElement("p");
  name.className = "t-row";
  name.append(filename("Lecture 12 · Pharmacokinetics.mp4"));
  panel.replaceChildren(specimens([
    [name, msg("preview.role.row")],
    [text("p", "t-body", msg("media.empty.noneBody")), msg("preview.role.body")],
    [text("p", "t-meta", completedMeta(HISTORY[0])), msg("preview.role.meta")],
    [text("p", "t-label", msg("group.yesterday")), msg("preview.role.label")]
  ], { nameRole: "t-meta" }));
}

// ---------- view: Controls ----------
function buildControls(panel) {
  const buttons = document.createElement("div");
  buttons.className = "button-specimens";
  const primary = button({ kind: "primary", label: msg("action.download"), action: "download" });
  primary.addEventListener("click", () => toast(msg("toast.downloadStarted")));
  const secondary = button({ kind: "secondary", label: msg("media.rescan"), iconName: "rescan", action: "rescan" });
  secondary.addEventListener("click", () => toast(msg("media.scanDone")));
  const tertiary = button({ kind: "tertiary", label: msg("action.open"), action: "open" });
  const destructive = button({ kind: "destructive", label: msg("action.remove"), action: "remove" });
  destructive.addEventListener("click", () => void confirmThen(destructive, msg("job.removeConfirm"), msg("action.remove"), msg("toast.removed")));
  // "Download a link" opens the Download dialog for a pasted link; in the
  // gallery that dialog lives in Dialogs and menus.
  const link = iconButton({ iconName: "link", label: msg("media.downloadLink"), action: "link" });
  link.addEventListener("click", () => {
    dialogSpecimenApi?.setMode("link");
    showView("overlays", { focusTab: true });
  });
  const settings = iconButton({ iconName: "settings", label: msg("action.settings"), action: "settings" });
  settings.addEventListener("click", () => {
    Promise.resolve().then(() => chrome.runtime.openOptionsPage()).catch(() => toast(msg("toast.settingsFailed"), "error"));
  });
  const more = iconButton({ iconName: "more", label: msg("action.moreFor", { name: HISTORY[0].filename }), action: "more", haspopup: true });
  more.addEventListener("click", () => menus.openItems(more, historyItems(HISTORY[0])));
  buttons.append(primary, secondary, tertiary, destructive, link, settings, more);

  // The gallery's own settings are real controls: theme, density and motion apply to every view.
  // A choice of one value with no panels: a radio group, as Settings' presets.
  const theme = segmented({
    role: "radiogroup",
    items: ["auto", "morning", "dusk"].map((value) => ({ value, label: msg(`preview.theme.${value}`) })),
    current: prefs.theme,
    onSelect: (value) => {
      prefs.theme = value;
      applyPrefs();
      writeUrl();
      pond?.refresh();
      markSaved(themeRow);
    }
  });
  const themeRow = settingRow({ id: "pv-theme", name: msg("preview.setting.theme"), description: msg("preview.setting.themeHint"), control: theme.element });
  const densityRow = settingRow({
    id: "pv-density",
    name: msg("preview.setting.density"),
    description: msg("preview.setting.densityHint"),
    control: select({
      options: [{ value: "comfortable", label: msg("preview.density.comfortable") }, { value: "compact", label: msg("preview.density.compact") }],
      value: prefs.density,
      width: "medium",
      onChange: (value) => { prefs.density = value; applyPrefs(); writeUrl(); markSaved(densityRow); }
    })
  });
  const motionRow = settingRow({
    id: "pv-motion",
    name: msg("preview.setting.motion"),
    description: msg("preview.setting.motionHint"),
    control: switchControl({
      checked: prefs.motion === "reduced",
      onChange: (on) => { prefs.motion = on ? "reduced" : "full"; applyPrefs(); writeUrl(); markSaved(motionRow); }
    })
  });
  // Settings' own rows, with their copy, limits and defaults (options.js).
  const filenameRow = filenameSpecimen();
  const numberRow = ({ id, name, description, min, max, value, unit = "" }) => {
    const outOfRange = msg("settings.error.out_of_range", { min, max });
    const valid = (raw) => {
      const number = Number(raw);
      return String(raw).trim() !== "" && Number.isInteger(number) && number >= min && number <= max;
    };
    const row = settingRow({
      id,
      name: msg(name),
      description: msg(description, { min, max }),
      control: numberField({
        value,
        min,
        max,
        step: 1,
        unit,
        onInput: () => setSettingError(row, ""),
        onChange: (raw) => {
          if (!valid(raw)) { setSettingError(row, outOfRange); return; }
          setSettingError(row, "");
          markSaved(row);
        }
      })
    });
    // A value outside the range shows the error line at rest.
    if (!valid(value)) setSettingError(row, outOfRange);
    return row;
  };
  const sizeRow = numberRow({ id: "pv-minimum", name: "settings.minimum.name", description: "settings.minimum.description", min: FORM_LIMITS.minimumKBMin, max: FORM_LIMITS.minimumKBMax, value: DEFAULT_FORM_STATE.minimumKB, unit: KB_UNIT });
  const connectionsRow = numberRow({ id: "pv-ranges", name: "settings.ranges.name", description: "settings.ranges.description", min: FORM_LIMITS.concurrencyMin, max: FORM_LIMITS.concurrencyMax, value: 32 });
  const settingsList = document.createElement("div");
  settingsList.className = "setting-specimens";
  settingsList.append(themeRow, densityRow, motionRow, filenameRow, sizeRow, connectionsRow);

  // The nav moves between the gallery's views, as Settings' nav moves between sections.
  navigation = nav({ items: VIEWS.map((id) => ({ id, label: msg(`preview.view.${id}`), href: query(id) })), current: prefs.view, label: msg("preview.group.nav") });
  navigation.element.addEventListener("click", (event) => {
    const item = event.target?.closest?.("[data-nav-id]");
    if (!item) return;
    // A modified or middle click opens the link the browser's way (new tab, window).
    if ((event.button ?? 0) !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    showView(item.dataset.navId, { focusTab: true });
  });
  const navFrame = document.createElement("div");
  navFrame.className = "nav-specimen";
  navFrame.append(navigation.element);

  panel.replaceChildren(
    groupLabel(msg("preview.group.buttons")),
    buttons,
    groupLabel(msg("preview.group.settings")),
    settingsList,
    groupLabel(msg("preview.group.nav")),
    navFrame
  );
}

/**
 * Settings' File names row (options.js): the template field under the text,
 * then the fields you can add, each inserted at the cursor.
 */
function filenameSpecimen() {
  const template = textField({
    id: "pv-filename-template",
    value: DEFAULT_FORM_STATE.filenameTemplate,
    width: "fill",
    maxLength: FORM_LIMITS.filenameTemplateMaxLength,
    spellcheck: false,
    placeholder: "{title} - {height}",
    onChange: () => markSaved(row)
  });
  const input = controlOf(template);
  // A template is typed by the user; its tokens are not UI words.
  input.dataset.userContent = "";
  const row = settingRow({ id: "pv-filename", name: msg("settings.filename.name"), description: msg("settings.filename.description"), control: template, layout: "stack" });
  const chips = document.createElement("div");
  chips.className = "token-chips";
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", msg("settings.filename.fields"));
  for (const token of FILENAME_TOKENS) {
    const chip = button({ kind: "tertiary", label: msg(`settings.token.${TOKEN_LABELS[token]}`) });
    chip.dataset.token = token;
    // Keep the cursor in the field while the chip is pressed.
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", () => {
      const end = input.value.length;
      const inserted = insertTemplateToken(input.value, token, input.selectionStart ?? end, input.selectionEnd ?? end);
      input.value = inserted.value;
      input.focus();
      input.setSelectionRange?.(inserted.selectionStart, inserted.selectionEnd);
      markSaved(row);
    });
    chips.append(chip);
  }
  row.querySelector(".setting-trail").append(chips);
  return row;
}

// ---------- view: Rows and progress ----------
function buildRows(panel) {
  // The popup's view switch with its counts (§6.3: a count shows above 0).
  const popupViews = segmented({
    role: "radiogroup",
    items: [
      { value: "media", label: msg("popup.view.media"), count: MEDIA.length },
      { value: "downloads", label: msg("popup.view.downloads"), count: LIVE.length + 1 }
    ],
    current: "media",
    label: msg("popup.views")
  });
  const switchFrame = document.createElement("div");
  switchFrame.className = "switch-specimen";
  switchFrame.append(popupViews.element);

  // The popup's list header exactly as popup.js builds it: its own title, no
  // count (the switch above already carries the 3, §6.3), Rescan as the one
  // visible action, and Download all plus Clear results in the overflow.
  const header = listHeader({
    title: msg("media.listTitle"),
    actions: [
      { label: msg("media.rescan"), action: "rescan", run: () => toast(msg("media.scanDone")) }
    ]
  });
  const more = iconButton({ iconName: "more", label: msg("media.moreActions"), action: "more", haspopup: true });
  more.addEventListener("click", () => menus.openItems(more, [
    { label: msg("media.downloadAll"), iconName: "video", run: () => toast(msg("media.batchStarted", { count: MEDIA.length })) },
    { label: msg("media.clearResults"), iconName: "clear", tone: "destructive", keepOpen: true, run: () => void confirmThen(more, msg("media.clearConfirm"), msg("media.clearResults"), msg("media.cleared")) }
  ]));
  header.actions.append(more);
  const media = rows(MEDIA.map((item) => mediaRow(item, {
    onDownload: () => toast(msg("toast.downloadStarted")),
    onMore: (target, anchor) => openMediaMenu(menus, target, anchor, { toast, onError: showError })
  })), "media-rows");

  demo.view = liveRow(demoJob(), { focus: true });
  demo.view.details.element.open = true;
  renderDemo();
  const live = rows(LIVE.map(({ job, finishing }) => {
    const view = liveRow(job);
    updateLiveRow(view, job, { finishing, onControl });
    return view.root;
  }), "job-rows");

  const history = [];
  const groups = new Map();
  for (const record of HISTORY) {
    const group = dayGroupOf(record.finishedAt, AFTERNOON);
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(record);
  }
  for (const [group, records] of groups) {
    history.push(groupLabel(msg(`group.${group}`)), rows(records.map((record) => {
      const row = historyRow(record, {
        now: AFTERNOON,
        onAction: (action, item, anchor) => { if (action === "more") menus.openItems(anchor, historyItems(item)); }
      });
      // The selected row (§6.4): tinted, its Open and overflow shown at rest.
      // It is the row whose menu Dialogs and menus shows.
      if (record.jobId === HISTORY[0].jobId) row.dataset.selected = "";
      return row;
    })));
  }

  const words = document.createElement("div");
  words.className = "status-specimens";
  words.append(
    status("progress", msg("status.downloading")),
    status("paused", msg("status.paused")),
    status("queued", msg("status.queued")),
    status("complete", msg("status.completed")),
    status("warning", msg("status.missing")),
    status("failed", msg("status.failed")),
    status("cancelled", msg("status.cancelled"))
  );

  panel.replaceChildren(
    switchFrame,
    header.element,
    media,
    groupLabel(msg("group.active")),
    demo.view.root,
    live,
    ...history,
    groupLabel(msg("preview.group.status")),
    words
  );
}

// ---------- view: Status and empty states ----------
function buildFeedback(panel) {
  const toasts = document.createElement("div");
  toasts.className = "toast-specimens";
  toasts.append(
    frozenToast(msg("toast.downloadStarted"), "success"),
    frozenToast(msg("toast.engineNeeded"), "warning"),
    frozenToast(msg("toast.genericError"), "error")
  );
  const confirmation = frozenMenu(
    (anchor) => { void menus.confirm(anchor, { question: msg("job.cancelConfirm"), confirmLabel: msg("job.cancelAction") }); },
    "confirm-specimen",
    ([, stop]) => stop?.addEventListener("click", () => toast(msg("toast.stopped")))
  );
  // The popup's empty page: one sentence, one line, and the view's one primary.
  const empty = emptyState({
    sentence: msg("media.empty.none"),
    body: msg("media.empty.noneBody"),
    action: { label: msg("media.rescan"), kind: "primary", run: () => toast(msg("media.scanDone")) }
  });
  // The empty state first, with the pond open around its sentence (§6.10).
  // In the gallery it sits under its group label like any other specimen
  // (preview.css drops the page padding a real surface gives it).
  panel.replaceChildren(
    groupLabel(msg("preview.group.empty")),
    empty.element,
    groupLabel(msg("preview.group.statusLines")),
    statusLine(engineLine("permission", { setUp })),
    statusLine({ tone: "progress", text: msg("media.loading") }),
    statusLine(engineLine("update", { setUp, retry: noop })),
    statusLine({ tone: "failed", text: msg("media.loadFailed"), actions: [{ label: msg("action.retry"), run: noop }] }),
    statusLine({ tone: "complete", text: msg("media.engine.ready") }),
    groupLabel(msg("preview.group.toasts")),
    toasts,
    groupLabel(msg("preview.group.confirm")),
    confirmation
  );
}

// ---------- view: Dialogs and menus ----------
function buildOverlays(panel) {
  const items = historyItems(HISTORY[0]);
  const menu = frozenMenu(
    (anchor) => menus.openItems(anchor, items),
    "menu-specimen",
    (buttons) => buttons.forEach((entry, index) => entry.addEventListener("click", () => items[index]?.run(entry)))
  );
  dialogSpecimenApi = dialogSpecimen();
  // The dialog opens two ways: "Download a link" (a pasted link) or a row's
  // Download (a detected item). One dialog, as createMediaDialog builds it.
  const modes = segmented({
    role: "radiogroup",
    items: [
      { value: "link", label: msg("media.downloadLink") },
      { value: "item", label: msg("media.listTitle") }
    ],
    current: prefs.dialog,
    label: msg("preview.dialog.modes"),
    onSelect: (mode) => { dialogSpecimenApi.setMode(mode); writeUrl(); }
  });
  dialogSpecimenApi.onMode = (mode) => { modes.select(mode); };
  const modeFrame = document.createElement("div");
  modeFrame.className = "switch-specimen";
  modeFrame.append(modes.element);
  panel.replaceChildren(
    groupLabel(msg("preview.group.dialog")),
    modeFrame,
    dialogSpecimenApi.element,
    groupLabel(msg("preview.group.menu")),
    menu
  );
}

/**
 * The Download dialog (§6.12) in both of its modes, as media.js
 * createMediaDialog builds it for the popup and the side panel:
 * - link: "Download a link" opens it on an empty Link field (input[type=url]),
 *   File name blank with its placeholder, Format Original; no Quality.
 * - item: a detected stream after its quality probe: File name and Format
 *   filled in, Quality from the probed variants.
 * Then the one status line, Cancel and the one primary Download. dialogShell
 * builds it; the form is shown in place (a <dialog> at rest is not rendered,
 * and an open one would be modal), inside the builder's own dialog-shell
 * surface. Cancel and the close button put the dialog back to how it opened.
 */
function dialogSpecimen() {
  const stream = MEDIA[1];
  let mode = prefs.dialog;
  let item = null;
  let failure = "";

  const linkField = textField({ id: "pvDialogLink", type: "url", maxLength: 4096, spellcheck: false, placeholder: msg("media.dialog.linkPlaceholder"), onInput: syncLink });
  const nameField = textField({ id: "pvDialogName", maxLength: 200, spellcheck: false });
  const formatField = select({ id: "pvDialogFormat", width: "fill", onChange: onFormat });
  const qualityField = select({ id: "pvDialogQuality", width: "fill" });
  const linkStack = fieldStack({ label: msg("media.dialog.link"), control: linkField });
  const nameStack = fieldStack({ label: msg("media.dialog.name"), control: nameField });
  const formatStack = fieldStack({ label: msg("media.dialog.format"), control: formatField });
  const qualityStack = fieldStack({ label: msg("media.dialog.quality"), control: qualityField });
  const line = statusLine({ id: "pvDialogLine" });
  line.classList.add("dialog-line");
  const link = controlOf(linkField);
  const name = controlOf(nameField);
  const format = controlOf(formatField);

  const cancel = button({ kind: "tertiary", label: msg("action.cancel"), action: "cancel" });
  const submit = button({ kind: "primary", label: msg("action.download"), type: "submit", action: "download" });
  const shell = dialogShell({
    title: msg("action.download"),
    id: "pvDialog",
    body: [linkStack, nameStack, formatStack, qualityStack, line],
    actions: [cancel, submit],
    onSubmit: (event) => { event.preventDefault(); start(); }
  });
  cancel.addEventListener("click", () => setMode(mode));
  shell.form.querySelector(".dialog-close")?.addEventListener("click", () => setMode(mode));

  function setFormats(value) {
    const options = formatOptions(item, {});
    setOptions(format, options, value);
    const chosen = options.find((option) => option.value === format.value);
    if (!chosen || chosen.disabled) format.value = (options.find((option) => option.value === "mp4" && !option.disabled) || options.find((option) => !option.disabled)).value;
  }

  function syncQuality() {
    // A pasted link has no probe, so no qualities to choose from.
    qualityStack.hidden = Boolean(item?.urlMode) || ["mp3", "original"].includes(format.value);
  }

  function renderLine() {
    line.setAttribute("role", failure ? "alert" : "status");
    setStatusLine(line, failure ? { tone: "failed", text: failure } : engineLine("permission", { setUp }));
  }

  function onFormat(value) {
    if (!(item.urlMode && !String(name.value || "").trim())) name.value = replaceFilenameExtension(name.value, value, item);
    syncQuality();
    failure = "";
    renderLine();
  }

  function syncLink() {
    if (!item?.urlMode) return;
    item = urlItem(link.value);
    let next = format.value;
    if (isStreamKind(item) && next === "original") next = defaultFormat(item, {});
    if (!isStreamKind(item) && next !== "mp3") next = "original";
    setFormats(next);
    syncQuality();
    failure = "";
    renderLine();
  }

  function start() {
    if (item.urlMode && !/^https?:\/\/\S+$/i.test(String(link.value || "").trim())) {
      failure = msg("toast.invalidUrl");
      renderLine();
      link.focus({ preventScroll: true });
      return;
    }
    toast(msg("toast.downloadStarted"));
  }

  /** Open the specimen in a mode, with that mode's opening values. */
  function setMode(next) {
    mode = next === "item" ? "item" : "link";
    prefs.dialog = mode;
    failure = "";
    if (mode === "link") {
      item = urlItem("");
      linkStack.hidden = false;
      link.value = "";
      name.value = "";
      name.placeholder = msg("media.dialog.namePlaceholder");
      setFormats("original");
    } else {
      item = stream;
      linkStack.hidden = true;
      setFormats(defaultFormat(item, {}));
      name.value = defaultFilename(item, format.value);
      name.placeholder = "";
    }
    setOptions(qualityField, [{ value: "", label: msg("media.quality.best") }, ...VARIANTS.map((variant, index) => ({ value: variant.url, label: variantLabel(variant, index) }))], "");
    syncQuality();
    renderLine();
    api.onMode?.(mode);
  }

  const frame = document.createElement("div");
  frame.className = "dialog-shell dialog-specimen";
  frame.setAttribute("role", "group");
  frame.setAttribute("aria-labelledby", shell.heading.id);
  frame.setAttribute("aria-describedby", line.id);
  frame.append(shell.form);
  const api = { element: frame, setMode, onMode: null };
  setMode(mode);
  return api;
}

// ---------- the live demo ----------
function demoJob() {
  const running = !demo.paused;
  return {
    jobId: DEMO_ID,
    status: running ? "downloading" : "paused",
    method: "native",
    kind: MEDIA[1].kind,
    filename: `${MEDIA[1].displayTitle}.mp4`,
    progress: demo.fraction,
    bytes: Math.round(DEMO_TOTAL * demo.fraction),
    total: DEMO_TOTAL,
    speed: running ? demo.samples[demo.samples.length - 1] || 0 : 0,
    pausable: running,
    resumable: !running,
    message: `${ENGINE_PARTS} ${Math.floor(demo.fraction * DEMO_PARTS)}/${DEMO_PARTS}`
  };
}

function renderDemo() {
  if (demo.view) updateLiveRow(demo.view, demoJob(), { finishing: demo.finishing, samples: demo.samples, onControl });
}

function tick() {
  if (demo.paused || demo.finishing) return;
  demo.fraction = Math.min(1, demo.fraction + TICK_MS / (DEMO_SECONDS * 1000));
  const t = globalThis.performance?.now?.() ?? Date.now();
  // Ramps up, then wavers like light on water.
  const wave = 0.8 + 0.2 * Math.sin(t / 420) + 0.12 * Math.sin(t / 97);
  demo.samples.push(DEMO_SPEED * wave * Math.min(1, 0.3 + demo.fraction * 7));
  while (demo.samples.length > SAMPLES) demo.samples.shift();
  if (demo.fraction < 1) { renderDemo(); return; }
  // The finish hold (§6.7): celadon, then the bar fades, then a new run.
  const run = demo.run;
  demo.finishing = { phase: "complete" };
  renderDemo();
  setTimeout(() => {
    if (run !== demo.run) return;
    demo.finishing = { phase: "settled" };
    renderDemo();
    setTimeout(() => { if (run === demo.run) restartDemo(); }, HOLD_MS);
  }, SETTLE_MS);
}

function restartDemo() {
  demo.run += 1;
  demo.fraction = 0;
  demo.samples = [];
  demo.paused = false;
  demo.finishing = null;
  renderDemo();
  // From the static frame, a restart plays live (v1's Replay did the same).
  if (!timer) timer = setInterval(tick, TICK_MS);
}

/** Pause, Resume and Cancel (confirmed in place). The focus panel's demo obeys; the other rows answer with their toast. */
function onControl(action, job, control) {
  const isDemo = job.jobId === DEMO_ID;
  if (action === "cancel") {
    void menus.confirm(control, { question: msg("job.cancelConfirm"), confirmLabel: msg("job.cancelAction") }).then((yes) => {
      if (!yes) return;
      if (isDemo) restartDemo();
      toast(msg("toast.stopped"));
    });
    return;
  }
  if (isDemo) {
    demo.paused = action === "pause";
    renderDemo();
    return;
  }
  toast(msg(action === "pause" ? "toast.pausing" : "toast.resumed"));
}
