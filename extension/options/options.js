// FluxCatch Settings (design review §6.13) on the v2 system: a nav column and
// one content column of setting rows. Every control saves itself and shows an
// inline "Saved"; there is no save bar. Allowing home-network downloads asks
// first with the shared confirm popover. The local engine is explained once,
// here, in #local-engine; its one status row (with Set up) sits in Status.
// Every heading is a section the nav lists. Developer tools (UI editor,
// version info) live in Lab and are off by default.
// All copy comes from ui/v2/messages (settings.*), all formatting follows the
// one UI language, and worker errors reach the user only through errorText.
import { BUILD_PROFILE } from "../lib/build-profile.js";
import { bootLocale, loadUiLanguage, onLocaleChange, saveUiLanguage } from "../ui/v2/locale.js";
import { MESSAGES, msg } from "../ui/v2/messages.js";
import { brandMark, button, createMenus, createToaster, filename, icon, runAction, status } from "../ui/v2/components.js";
import { controlOf, isSwitchOn, markSaved, nav, numberField, segmented, select, setSettingError, setSwitch, settingRow, switchControl, textField } from "../ui/v2/controls.js";
import { errorText, userError } from "../ui/v2/errors.js";
import { callWorker } from "../ui/v2/runtime.js";
import { mountPond } from "../ui/v2/pond.js";
import { bindUiCustomization, loadDeveloperTools, saveDeveloperTools } from "../ui/customization.js";
import {
  FILENAME_TOKENS,
  FORM_LIMITS,
  OUTPUT_CONTAINERS,
  PRESETS,
  TOKEN_LABELS,
  engineState,
  insertTemplateToken,
  matchPreset,
  renderTemplatePreview,
  resolveNotificationLoadState,
  settingsPayload,
  stateFromSettings,
  validateSettings
} from "./form-state.js";
import { waitForNativeRecovery } from "./native-recovery.js";

const $ = (selector, root = document) => root.querySelector(selector);

// Brand and format names are proper nouns, never translated. The message
// module joins the site names in the UI language.
const DIRECT_SITES = Object.freeze(["Instagram", "X"]);
const YOUTUBE = "YouTube";
const FORMAT_LABELS = Object.freeze({ mp4: "MP4", mkv: "MKV", webm: "WebM" });
const KB_UNIT = "KB";
const DEFAULT_LOCATION = "~/Downloads/FluxCatch";
const DESIGNER_URL = "../designer/designer.html";
const SHORTCUTS_URL = "chrome://extensions/shortcuts";
const SHORTCUT_LABELS = Object.freeze({
  _execute_action: "settings.shortcuts.popup",
  "open-downloads": "settings.shortcuts.downloads",
  "open-workspace": "settings.shortcuts.workspace"
});

/** Sections in page order; ids are stable (nav anchors, deep links, tests). */
const SECTIONS = Object.freeze([
  { id: "status", key: "settings.section.status" },
  { id: "local-engine", key: "settings.section.localEngine" },
  { id: "capabilities", key: "settings.section.capabilities" },
  { id: "saving", key: "settings.section.saving" },
  { id: "speed", key: "settings.section.speed" },
  { id: "finding", key: "settings.section.finding" },
  { id: "privacy", key: "settings.section.privacy" },
  { id: "notifications", key: "settings.section.notifications" },
  { id: "general", key: "settings.section.general" },
  { id: "lab", key: "settings.section.lab" }
]);

/** v1 section anchors still land in the right place. */
const LEGACY_HASHES = Object.freeze({
  runtime: "status",
  localCapabilities: "local-engine",
  basicDownloads: "saving",
  performance: "speed",
  detectionNaming: "finding",
  privacyNetwork: "privacy",
  developer: "lab"
});

const NUMBER_FIELDS = Object.freeze({
  concurrentFragments: { min: FORM_LIMITS.concurrencyMin, max: FORM_LIMITS.concurrencyMax, name: "settings.fragments.name", description: "settings.fragments.description" },
  concurrentRanges: { min: FORM_LIMITS.concurrencyMin, max: FORM_LIMITS.concurrencyMax, name: "settings.ranges.name", description: "settings.ranges.description" },
  concurrentJobs: { min: FORM_LIMITS.jobsMin, max: FORM_LIMITS.jobsMax, name: "settings.jobs.name", description: "settings.jobs.description" },
  minimumKB: { min: FORM_LIMITS.minimumKBMin, max: FORM_LIMITS.minimumKBMax, name: "settings.minimum.name", description: "settings.minimum.description", unit: KB_UNIT }
});

const state = {
  settings: null,
  loaded: false,
  loadFailed: false,
  host: {},
  nativePermission: null,
  engineChecking: true,
  engineFailed: false,
  // True only while the engine is connected and compatible (engineState "complete").
  engineReady: false,
  permissionRemoved: false,
  retrySeconds: 0,
  notificationPermission: false,
  diagnostics: null,
  developer: false,
  languagePref: "auto",
  shortcuts: [],
  // Typed fields whose value is not stored: invalid input, or a save that failed.
  invalid: new Set(),
  templateSelection: { start: 0, end: 0 },
  languageSaved: false
};

const ui = { rows: {}, controls: {}, engine: [], capabilities: [], install: null, preset: null, nav: null, developerRows: null, version: {} };

let menus = null;
let toast = () => {};
let customization = null;
let pond = null;
let initStarted = false;
let saveChain = Promise.resolve();
let pingInFlight = null;
let recoveryInFlight = null;
// Bumped on every build(); a save that finishes after a rebuild re-syncs the new controls.
let buildGeneration = 0;
let lastEngineAnnouncement = "";

await bootLocale();
document.addEventListener("DOMContentLoaded", () => void init());
if (document.readyState !== "loading") void init();

async function init() {
  if (initStarted) return;
  initStarted = true;
  toast = createToaster($("#toastRegion"));
  menus = createMenus($("#menuLayer"));
  // Listen before the first await: a language change that lands while the page is
  // still starting must not leave it in the old language. Before the first build,
  // locale.js already holds the new language, so build() picks it up by itself.
  let built = false;
  onLocaleChange(() => {
    if (!built) return;
    void loadUiLanguage().then((pref) => { state.languagePref = pref; }, () => {}).finally(() => rebuild());
  });
  mountChrome();
  try { state.developer = await loadDeveloperTools(); } catch { state.developer = false; }
  try { state.languagePref = await loadUiLanguage(); } catch { state.languagePref = "auto"; }
  state.shortcuts = await readShortcuts();
  build();
  built = true;
  // Layout overrides only: the UI editor never replaces v2 copy (rename table, §5 note).
  customization = await bindUiCustomization({ onChange: onCustomizationChange }).catch(() => null);
  bindGlobalEvents();
  mountPond({ element: $("[data-pond]"), getZones: pondZones }).then((mounted) => { pond = mounted; }).catch(() => {});
  await load();
}

// ---------- static chrome ----------
function mountChrome() {
  $("#topbarInner").append(brandMark({ size: "m" }));
  const topbar = $("#topbar");
  const onScroll = () => {
    topbar.dataset.scrolled = String((globalThis.scrollY || 0) > 0);
    updateCurrentSection();
  };
  globalThis.addEventListener?.("scroll", onScroll, { passive: true });
  onScroll();
  $("#loadRetry").addEventListener("click", () => void load());
}

function applyStaticCopy() {
  document.title = `${msg("settings.title")} · ${msg("brand.name")}`;
  for (const element of document.querySelectorAll("[data-msg]")) element.textContent = msg(element.dataset.msg);
}

function bindGlobalEvents() {
  globalThis.addEventListener?.("beforeunload", (event) => {
    if (!state.invalid.size) return;
    event.preventDefault();
    event.returnValue = "";
  });
  globalThis.addEventListener?.("hashchange", () => jumpToHash());
  const permissions = globalThis.chrome?.permissions;
  permissions?.onAdded?.addListener((change) => onPermissionChange(change, true));
  permissions?.onRemoved?.addListener((change) => onPermissionChange(change, false));
}

function onPermissionChange(change, added) {
  const names = change?.permissions || [];
  if (names.includes("notifications")) state.notificationPermission = added;
  if (!names.includes("nativeMessaging")) return;
  // A Set up or Retry in flight reconciles the live permission itself.
  if (pingInFlight || recoveryInFlight || ui.engine.some((view) => view.action.getAttribute("aria-busy") === "true")) return;
  void checkEngine();
}

// ---------- building ----------
function build() {
  buildGeneration += 1;
  lastEngineAnnouncement = "";
  applyStaticCopy();
  ui.rows = {};
  ui.controls = {};
  ui.engine = [];
  ui.capabilities = [];
  ui.version = {};
  const navigation = nav({
    items: SECTIONS.map((section) => ({ id: section.id, label: msg(section.key) })),
    current: SECTIONS[0].id,
    label: msg("settings.navLabel")
  });
  ui.nav = navigation;
  for (const link of navigation.element.querySelectorAll(".nav-item")) {
    link.addEventListener("click", () => navigation.setCurrent(link.dataset.navId));
  }
  $("#navSlot").replaceChildren(navigation.element);
  const builders = {
    status: buildStatus,
    capabilities: buildCapabilities,
    "local-engine": buildLocalEngine,
    saving: buildSaving,
    speed: buildSpeed,
    finding: buildFinding,
    privacy: buildPrivacy,
    notifications: buildNotifications,
    general: buildGeneral,
    lab: buildLab
  };
  $("#sections").replaceChildren(...SECTIONS.map((section) => sectionNode(section, builders[section.id]())));
  writeControls();
  renderEngine();
  renderLocation();
  renderDerived();
  renderDeveloper();
  renderLoadState();
}

/** Rebuild for a language switch: same ids, same state, focus kept by id. */
function rebuild() {
  const focusedId = document.activeElement?.id || "";
  // Typed values that were not saved (invalid) survive the rebuild and are re-checked.
  const pending = [...state.invalid].map((field) => [field, rawValue(field)]);
  build();
  for (const [field, raw] of pending) {
    controlOf(ui.controls[field]).value = raw;
    void commitField(field);
  }
  customization?.refresh();
  if (state.languageSaved) {
    state.languageSaved = false;
    markSaved(ui.rows.language);
  }
  if (focusedId) $(`#${focusedId}`)?.focus?.();
  pond?.refresh();
}

function sectionNode(section, children) {
  const element = document.createElement("section");
  element.className = "settings-section";
  element.id = section.id;
  element.setAttribute("aria-labelledby", `${section.id}-heading`);
  const heading = document.createElement("h2");
  heading.className = "t-title section-title";
  heading.id = `${section.id}-heading`;
  heading.dataset.msg = section.key;
  heading.textContent = msg(section.key);
  element.append(heading, ...children);
  return element;
}

// settingRow names an action row's buttons by their own words ("All downloads",
// "Copy") and describes them with the row name; pass several trailing items
// as an array and it lays them out in one group.
function row(key, options) {
  const element = settingRow({ id: `row-${key}`, ...options });
  ui.rows[key] = element;
  return element;
}

function meta(text, { userContent = false } = {}) {
  const element = document.createElement("span");
  element.className = "t-meta row-value";
  if (userContent) element.dataset.userContent = "";
  element.textContent = text;
  return element;
}

/** A status word with its dot in the trailing cell (never the row's "Saved" note). */
function rowStatus(tone, label) {
  const element = status(tone, label);
  element.classList.add("row-status");
  return element;
}

function setDescription(rowElement, text) {
  const node = rowElement?.querySelector(".setting-description");
  if (!node) return;
  node.textContent = text || "";
  node.hidden = !text;
}

function sites() {
  return [...DIRECT_SITES];
}

// ---------- Status ----------
// The engine's one status row lives here (§6.13: "Local engine · Not set up ·
// Set up"); #local-engine keeps the one explanation and the install steps.
function buildStatus() {
  return [
    engineRow("engine", { withDescription: true }),
    row("merge", { name: msg("settings.merge.name"), control: rowStatus("cancelled", msg("settings.notYet")) }),
    row("direct", { name: msg("settings.direct.name", { sites: sites() }), control: meta(msg("settings.direct.chrome")) }),
    row("network", { name: msg("settings.network.name"), control: meta(msg("settings.off")) })
  ];
}

// ---------- What FluxCatch can save ----------
// What can be saved today. "Not yet" is for what this build lacks; a format
// the build has but only the engine saves shows the engine's own state until
// the engine is Ready (renderEngine), so the list never claims more than works.
function buildCapabilities() {
  const features = BUILD_PROFILE.features;
  const capabilities = [
    [msg("settings.cap.directMedia"), features.directMedia, true],
    [msg("settings.cap.streaming"), features.staticHls || features.staticDash, true],
    [msg("settings.cap.bilibili"), features.bilibiliDashPair, true],
    [msg("settings.cap.live"), features.liveHls, true],
    [msg("settings.cap.encrypted"), features.encryptedHls, true],
    // Next to Encrypted streams: AES-128 streams save, DRM never does.
    [msg("settings.cap.protected"), false, true],
    [msg("settings.cap.separateAudio"), features.separateAudioHls, true],
    [YOUTUBE, features.externalToolNetwork, true],
    [msg("settings.cap.thumbnails"), features.remoteThumbnails, false]
  ];
  return capabilities.map(([name, feature, needsEngine], index) => {
    const enabled = feature === true;
    const statusNode = enabled ? rowStatus("complete", msg("settings.yes")) : rowStatus("cancelled", msg("settings.notYet"));
    ui.capabilities.push({ status: statusNode, enabled, needsEngine });
    return row(`capability-${index}`, { name, control: statusNode });
  });
}

function engineRow(key, { withDescription }) {
  const statusNode = rowStatus("queued", msg("settings.engine.checking"));
  const action = button({ kind: "tertiary", label: msg("action.setUp") });
  action.id = `${key}-action`;
  action.addEventListener("click", () => {
    if (action.dataset.engineAction === "setUp") void requestNativeAccess(action);
    else void runAction(action, "native-retry", () => checkEngine(), { onError: showEngineError });
  });
  const element = row(key, { name: msg("settings.engine.name"), description: withDescription ? " " : "", control: [statusNode, action] });
  let announcer = null;
  if (withDescription) {
    setDescription(element, "");
    // The one place engine state changes are spoken.
    announcer = document.createElement("span");
    announcer.className = "sr-only";
    announcer.id = `${key}-announce`;
    announcer.setAttribute("role", "status");
    announcer.setAttribute("aria-atomic", "true");
    $(".setting-text", element).append(announcer);
  }
  ui.engine.push({ row: element, status: statusNode, action, withDescription, announcer });
  return element;
}

// ---------- Local engine (the one explanation) ----------
function buildLocalEngine() {
  const intro = document.createElement("p");
  intro.className = "t-body section-intro";
  intro.dataset.msg = "settings.engine.explain";
  intro.textContent = msg("settings.engine.explain");

  const install = document.createElement("details");
  install.className = "install";
  install.id = "install";
  const summary = document.createElement("summary");
  summary.className = "t-row";
  const words = document.createElement("span");
  words.textContent = msg("settings.install.summary");
  // The words lead so they start on the content edge; the chevron trails.
  summary.append(words, icon("chevron"));
  const steps = document.createElement("ol");
  steps.className = "install-steps";
  const step = (key, command) => {
    const item = document.createElement("li");
    item.className = "t-body";
    const line = document.createElement("span");
    line.textContent = msg(key);
    item.append(line);
    if (command) {
      const code = document.createElement("span");
      code.className = "install-command";
      code.dataset.userContent = "";
      code.translate = false;
      code.setAttribute("translate", "no");
      code.textContent = command;
      item.append(code);
    }
    return item;
  };
  steps.append(
    step("settings.install.source", "./scripts/native-install-wrapper.sh"),
    step("settings.install.zip", "./install-macos.sh"),
    step("settings.install.browsers"),
    step("settings.install.done")
  );
  install.append(summary, steps);
  ui.install = install;
  return [intro, install];
}

// ---------- Saving ----------
function buildSaving() {
  const change = button({ kind: "tertiary", label: msg("settings.location.change") });
  change.id = "location-change";
  change.addEventListener("click", () => void changeDownloadFolder(change, false));
  const reset = button({ kind: "tertiary", label: msg("settings.location.reset") });
  reset.id = "location-reset";
  reset.hidden = true;
  reset.addEventListener("click", () => void changeDownloadFolder(reset, true));
  const reveal = button({ kind: "tertiary", label: msg("action.showInFinder") });
  reveal.id = "location-reveal";
  reveal.addEventListener("click", () => void runAction(reveal, "settings:folder", async () => {
    await callWorker({ type: "OPEN_DOWNLOAD_FOLDER" });
    setSettingError(ui.rows.location, "");
  }, { onError: (error) => setSettingError(ui.rows.location, errorText(error)) }));
  const location = row("location", { name: msg("settings.location.name"), description: DEFAULT_LOCATION, control: [change, reset, reveal] });
  const path = $(".setting-description", location);
  path.classList.add("location-path");
  path.dataset.userContent = "";
  ui.controls.locationReset = reset;

  const format = select({
    id: "field-outputContainer",
    name: "outputContainer",
    options: OUTPUT_CONTAINERS.map((value) => ({ value, label: FORMAT_LABELS[value] })),
    value: "mp4",
    width: "short",
    onChange: (value) => void saveChoice("outputContainer", value, "format")
  });
  ui.controls.outputContainer = format;

  const template = textField({
    id: "field-filenameTemplate",
    name: "filenameTemplate",
    width: "fill",
    maxLength: FORM_LIMITS.filenameTemplateMaxLength,
    spellcheck: false,
    placeholder: "{title} - {height}",
    onInput: () => { setSettingError(ui.rows.filename, ""); renderTemplatePreviewLine(); },
    onChange: () => void commitField("filenameTemplate")
  });
  ui.controls.filenameTemplate = template;
  const input = controlOf(template);
  for (const type of ["click", "keyup", "select", "input", "blur"]) input.addEventListener(type, rememberTemplateSelection);
  const filenameRow = row("filename", { name: msg("settings.filename.name"), description: msg("settings.filename.description"), control: template, layout: "stack" });
  const chips = document.createElement("div");
  chips.className = "token-chips";
  chips.setAttribute("role", "group");
  chips.setAttribute("aria-label", msg("settings.filename.fields"));
  for (const token of FILENAME_TOKENS) {
    const chip = button({ kind: "tertiary", label: msg(`settings.token.${TOKEN_LABELS[token]}`) });
    chip.dataset.token = token;
    chip.addEventListener("mousedown", (event) => event.preventDefault());
    chip.addEventListener("click", () => insertFilenameToken(token));
    chips.append(chip);
  }
  const preview = document.createElement("p");
  preview.className = "t-meta filename-preview";
  preview.id = "filename-preview";
  const previewLabel = document.createElement("span");
  previewLabel.textContent = msg("settings.filename.preview");
  // The sample name is a filename: row role, middle-truncated (renderTemplatePreviewLine).
  const previewValue = document.createElement("span");
  previewValue.className = "filename-preview-value";
  preview.append(previewLabel, previewValue);
  $(".setting-trail", filenameRow).append(chips, preview);
  input.setAttribute("aria-describedby", `${input.getAttribute("aria-describedby") || ""} filename-preview`.trim());

  return [
    location,
    row("format", { name: msg("settings.format.name"), description: msg("settings.format.description"), control: format }),
    filenameRow,
    // The engine switch leads: "Ask where to save" applies only while Chrome saves these videos.
    booleanRow("useNativeForDirect", msg("settings.useNative.name", { sites: sites() }), msg("settings.useNative.description"), (checked, element) => void changeUseNative(checked, element)),
    booleanRow("saveAs", msg("settings.saveAs.name", { sites: sites() }), msg("settings.saveAs.description")),
    historyRow()
  ];
}

function historyRow() {
  const open = button({ kind: "tertiary", label: msg("settings.history.open") });
  open.id = "history-open";
  open.addEventListener("click", () => void runAction(open, "settings:history", () => callWorker({ type: "OPEN_DOWNLOADS_PAGE" }), {
    onError: (error) => setSettingError(ui.rows.history, errorText(error))
  }));
  return row("history", { name: msg("settings.history.name"), control: open });
}

function booleanRow(field, name, description, onChange) {
  const control = switchControl({
    id: `field-${field}`,
    name: field,
    onChange: onChange || ((checked, element) => void saveBoolean(field, checked, element))
  });
  ui.controls[field] = control;
  return row(field, { name, description, control });
}

// ---------- Speed ----------
function buildSpeed() {
  // A choice of one value, not tabs: no panels, so a radio group (v1 used pressed buttons).
  const presets = segmented({
    id: "field-preset",
    role: "radiogroup",
    items: PRESETS.map((preset) => ({ value: preset.name, label: msg(`settings.preset.${preset.name}`) })),
    current: "",
    onSelect: (value) => void applyPreset(value)
  });
  ui.preset = presets;
  return [
    row("preset", { name: msg("settings.preset.name"), description: msg("settings.preset.description"), control: presets.element }),
    numberRow("concurrentFragments"),
    numberRow("concurrentRanges"),
    numberRow("concurrentJobs")
  ];
}

function numberRow(field) {
  const spec = NUMBER_FIELDS[field];
  const control = numberField({
    id: `field-${field}`,
    name: field,
    min: spec.min,
    max: spec.max,
    step: 1,
    unit: spec.unit || "",
    onInput: () => setSettingError(ui.rows[field], ""),
    onChange: () => void commitField(field)
  });
  ui.controls[field] = control;
  return row(field, { name: msg(spec.name), description: msg(spec.description, { min: spec.min, max: spec.max }), control });
}

// ---------- Finding media ----------
function buildFinding() {
  const domains = textField({
    id: "field-blockedDomains",
    name: "blockedDomains",
    multiline: true,
    rows: 4,
    width: "fill",
    spellcheck: false,
    placeholder: "ads.example.com",
    onInput: () => setSettingError(ui.rows.blockedDomains, ""),
    onChange: () => void commitField("blockedDomains")
  });
  ui.controls.blockedDomains = domains;
  return [
    numberRow("minimumKB"),
    row("blockedDomains", { name: msg("settings.blocked.name"), description: msg("settings.blocked.description"), control: domains, layout: "stack" })
  ];
}

// ---------- Privacy & network ----------
function buildPrivacy() {
  return [
    booleanRow("autoEnrichSiteQuality", msg("settings.enrich.name"), msg("settings.enrich.description")),
    booleanRow("allowPrivateNetworkMedia", msg("settings.lan.name"), msg("settings.lan.description"), (checked, element) => void changePrivateNetwork(checked, element)),
    row("signin", { name: msg("settings.signin.name"), description: msg("settings.signin.description"), control: meta(msg("settings.signin.value")) }),
    row("cloud", { name: msg("settings.cloud.name"), control: meta(msg("settings.none")) })
  ];
}

// ---------- Notifications ----------
function buildNotifications() {
  return [booleanRow("showNotifications", msg("settings.notify.name"), msg("settings.notify.description"), (checked, element) => void changeNotifications(checked, element))];
}

// ---------- Language & shortcuts ----------
function buildGeneral() {
  const language = select({
    id: "field-language",
    name: "language",
    width: "short",
    options: [
      { value: "auto", label: msg("settings.language.auto") },
      { value: "en", label: MESSAGES.en["settings.language.endonym"] },
      { value: "zh", label: MESSAGES.zh["settings.language.endonym"] }
    ],
    value: state.languagePref,
    onChange: (value) => void changeLanguage(value)
  });
  for (const option of controlOf(language).querySelectorAll("option")) {
    if (option.value === "en") option.setAttribute("lang", "en");
    if (option.value === "zh") option.setAttribute("lang", "zh-CN");
    if (option.value !== "auto") option.setAttribute("translate", "no");
  }
  ui.controls.language = language;
  const change = button({ kind: "tertiary", label: msg("settings.shortcuts.change") });
  change.id = "shortcuts-change";
  change.addEventListener("click", () => void runAction(change, "settings:shortcuts", () => globalThis.chrome.tabs.create({ url: SHORTCUTS_URL }), {
    onError: (error) => setSettingError(ui.rows.shortcuts, errorText(error))
  }));
  return [
    row("language", { name: msg("settings.language.name"), control: language }),
    row("shortcuts", { name: msg("settings.shortcuts.name"), description: shortcutsText(), control: change })
  ];
}

async function readShortcuts() {
  try {
    const commands = await globalThis.chrome?.commands?.getAll?.();
    return Array.isArray(commands) ? commands : [];
  } catch {
    return [];
  }
}

function shortcutsText() {
  const parts = state.shortcuts
    .filter((command) => SHORTCUT_LABELS[command.name] && command.shortcut)
    .map((command) => `${command.shortcut} ${msg(SHORTCUT_LABELS[command.name])}`);
  return parts.length ? parts.join(" · ") : msg("settings.shortcuts.none");
}

// ---------- Lab (developer tools) ----------
function buildLab() {
  const features = BUILD_PROFILE.features;
  const unsupported = [
    features.externalToolNetwork === true ? null : YOUTUBE,
    features.liveHls === true ? null : msg("settings.cap.live"),
    features.encryptedHls === true ? null : msg("settings.cap.encrypted"),
    msg("settings.cap.protected")
  ].filter(Boolean);
  const developer = booleanRow("developerTools", msg("settings.dev.name"), msg("settings.dev.description"), (checked, element) => void changeDeveloperTools(checked, element));

  const editor = document.createElement("a");
  editor.className = "btn btn-tertiary";
  editor.id = "editor-open";
  editor.href = DESIGNER_URL;
  editor.textContent = msg("action.open");
  const copy = button({ kind: "tertiary", label: msg("settings.version.copy") });
  copy.id = "version-copy";
  copy.addEventListener("click", () => void copyVersionInfo(copy));
  const values = {
    extensionId: meta("", { userContent: true }),
    build: meta("", { userContent: true }),
    engine: meta("", { userContent: true }),
    compat: rowStatus("cancelled", msg("settings.compat.notConnected"))
  };
  ui.version = values;
  const rows = document.createElement("div");
  rows.className = "developer-rows";
  rows.id = "developer-rows";
  rows.append(
    row("editor", { name: msg("settings.editor.name"), description: msg("settings.editor.description"), control: editor }),
    row("version", { name: msg("settings.version.name"), description: msg("settings.version.description"), control: copy }),
    row("versionExtensionId", { name: msg("settings.version.extensionId"), control: values.extensionId }),
    row("versionBuild", { name: msg("settings.version.build"), control: values.build }),
    row("versionEngine", { name: msg("settings.version.engine"), control: values.engine }),
    row("versionCompat", { name: msg("settings.version.compat"), control: values.compat })
  );
  ui.developerRows = rows;
  // No sub-heading: the "Developer tools" row names the group itself.
  return [
    row("unsupported", { name: msg("settings.unsupported.name"), description: unsupported.join(" · ") }),
    developer,
    rows
  ];
}

// ---------- writing state into controls ----------
function formState() {
  const form = stateFromSettings(state.settings || {});
  if (state.settings) form.showNotifications = state.settings.showNotifications === true && state.notificationPermission === true;
  return form;
}

function writeControls() {
  const form = formState();
  for (const field of Object.keys(NUMBER_FIELDS)) {
    if (!state.invalid.has(field)) controlOf(ui.controls[field]).value = String(form[field]);
  }
  controlOf(ui.controls.outputContainer).value = form.outputContainer;
  if (!state.invalid.has("filenameTemplate")) controlOf(ui.controls.filenameTemplate).value = form.filenameTemplate;
  if (!state.invalid.has("blockedDomains")) controlOf(ui.controls.blockedDomains).value = form.blockedDomains.join("\n");
  for (const field of ["saveAs", "useNativeForDirect", "allowPrivateNetworkMedia", "autoEnrichSiteQuality", "showNotifications"]) setSwitch(ui.controls[field], form[field]);
  setSwitch(ui.controls.developerTools, state.developer);
  controlOf(ui.controls.language).value = state.languagePref;
  syncPreset();
  renderTemplatePreviewLine();
  renderSwitchGates();
}

function syncPreset() {
  const fragments = controlOf(ui.controls.concurrentFragments).value;
  const ranges = controlOf(ui.controls.concurrentRanges).value;
  const preset = matchPreset(fragments, ranges);
  ui.preset?.select(preset || "");
  // No segment is raised for hand-set counts, so the one line says why.
  setDescription(ui.rows.preset, msg(preset ? "settings.preset.description" : "settings.preset.custom"));
}

/**
 * Switches that only apply in some states. The Instagram/X engine switch can
 * be turned on only once the engine works (turning it off always works, and a
 * stored On is kept); "Ask where to save" applies only while Chrome saves
 * those videos, so it rests while the engine switch is on.
 */
function renderSwitchGates() {
  const native = ui.controls.useNativeForDirect;
  const saveAs = ui.controls.saveAs;
  if (!native || !saveAs) return;
  const nativeOn = isSwitchOn(native);
  native.disabled = !state.engineReady && !nativeOn;
  saveAs.disabled = nativeOn;
}

/** After a rebuild during a save, write the stored values of `fields` into the new controls. */
function syncControls(fields) {
  const form = formState();
  for (const field of fields) {
    const control = ui.controls[field];
    if (!control || state.invalid.has(field) || !Object.hasOwn(form, field)) continue;
    if (typeof form[field] === "boolean") setSwitch(control, form[field]);
    else controlOf(control).value = Array.isArray(form[field]) ? form[field].join("\n") : String(form[field]);
  }
  syncPreset();
  renderTemplatePreviewLine();
}

function renderDerived() {
  const settings = state.settings || {};
  const direct = $(".row-value", ui.rows.direct);
  if (direct) direct.textContent = msg(settings.useNativeForDirect === true ? "settings.direct.engine" : "settings.direct.chrome");
  const network = $(".row-value", ui.rows.network);
  if (network) network.textContent = msg(settings.allowPrivateNetworkMedia === true ? "settings.on" : "settings.off");
  renderSwitchGates();
}

function renderLoadState() {
  const text = $("#loadText");
  const retry = $("#loadRetry");
  const sections = $("#sections");
  if (state.loaded) {
    text.textContent = "";
    retry.hidden = true;
    sections.inert = false;
    sections.removeAttribute("inert");
    sections.removeAttribute("aria-busy");
    return;
  }
  sections.inert = true;
  sections.setAttribute("inert", "");
  sections.setAttribute("aria-busy", "true");
  text.textContent = msg(state.loadFailed ? "settings.loadFailed" : "settings.loading");
  retry.hidden = !state.loadFailed;
}

// ---------- loading ----------
async function load() {
  state.loaded = false;
  state.loadFailed = false;
  renderLoadState();
  try {
    const response = await callWorker({ type: "GET_SETTINGS" });
    state.notificationPermission = await permissionsContains("notifications");
    let settings = response.settings || {};
    const notifications = resolveNotificationLoadState({
      persisted: settings.showNotifications === true,
      permissionGranted: state.notificationPermission
    });
    if (notifications.requiresRepair) {
      // The browser grant was revoked: store the preference as off so the
      // worker and this page agree.
      const repaired = await callWorker({ type: "SAVE_SETTINGS", settings: { ...settings, showNotifications: false } });
      settings = repaired.settings || { ...settings, showNotifications: false };
    }
    state.settings = settings;
    state.invalid.clear();
    state.loaded = true;
    writeControls();
    renderDerived();
    renderLoadState();
    jumpToHash({ landing: true });
  } catch {
    state.loadFailed = true;
    state.engineChecking = false;
    state.engineFailed = true;
    renderLoadState();
    renderEngine();
    return;
  }
  await Promise.allSettled([checkEngine(), refreshDiagnostics()]);
}

async function permissionsContains(name) {
  try { return await globalThis.chrome.permissions.contains({ permissions: [name] }); } catch { return false; }
}

// ---------- autosave ----------
/**
 * Save `patch` on top of the last stored settings, one save at a time, so a
 * later save never drops an earlier one and invalid fields elsewhere are never
 * sent. Shows "Saved" on the row, or the error on the row. Resolves true or false.
 */
function persist(patch, rowKey) {
  // The controls in place now; a language switch may rebuild them before this save ends.
  const generation = buildGeneration;
  const run = async () => {
    const base = state.settings || {};
    const payload = settingsPayload(base, { ...stateFromSettings(base), ...patch }, { changed: Object.keys(patch) });
    const response = await callWorker({ type: "SAVE_SETTINGS", settings: payload });
    state.settings = response.settings || payload;
    if (generation !== buildGeneration) syncControls(Object.keys(patch));
    // The row is looked up now, so a rebuilt page gets the note, not a detached row.
    const rowElement = ui.rows[rowKey];
    setSettingError(rowElement, "");
    markSaved(rowElement);
    renderDerived();
    return true;
  };
  const result = saveChain.then(run).catch((error) => {
    const rowElement = ui.rows[rowKey];
    setSettingError(rowElement, errorText(error));
    return false;
  });
  saveChain = result;
  return result;
}

function issueText(issue) {
  const key = `settings.error.${issue?.code}`;
  return Object.prototype.hasOwnProperty.call(MESSAGES.en, key) ? msg(key, issue.params || {}) : msg("toast.genericError");
}

function rawValue(field) {
  return controlOf(ui.controls[field])?.value ?? "";
}

/** Validate one typed field against the stored settings, then save it. */
async function commitField(field) {
  const rowKey = field === "filenameTemplate" ? "filename" : field;
  const rowElement = ui.rows[rowKey];
  const raw = rawValue(field);
  const stored = stateFromSettings(state.settings || {});
  const check = validateSettings({ ...stored, [field]: raw });
  const issues = check.fieldErrors[field] || [];
  if (issues.length) {
    state.invalid.add(field);
    setSettingError(rowElement, issueText(issues[0]));
    return;
  }
  state.invalid.delete(field);
  setSettingError(rowElement, "");
  const value = check.normalized[field];
  const write = () => {
    // Keep anything typed while the save was in flight.
    if (rawValue(field) !== raw) return;
    controlOf(ui.controls[field]).value = Array.isArray(value) ? value.join("\n") : String(value);
    if (field === "filenameTemplate") renderTemplatePreviewLine();
  };
  if (JSON.stringify(stored[field]) === JSON.stringify(value)) {
    write();
    return;
  }
  const generation = buildGeneration;
  if (await persist({ [field]: value }, rowKey)) write();
  else {
    // Not stored: keep it on screen as unsaved (leave-page warning, kept across rebuilds).
    state.invalid.add(field);
    if (generation !== buildGeneration) controlOf(ui.controls[field]).value = raw;
  }
  if (field === "concurrentFragments" || field === "concurrentRanges") syncPreset();
}

async function saveChoice(field, value, rowKey) {
  const check = validateSettings({ ...stateFromSettings(state.settings || {}), [field]: value });
  const issues = check.fieldErrors[field] || [];
  if (issues.length) {
    setSettingError(ui.rows[rowKey], issueText(issues[0]));
    return;
  }
  if (!(await persist({ [field]: check.normalized[field] }, rowKey))) {
    controlOf(ui.controls[field]).value = stateFromSettings(state.settings || {})[field];
  }
}

async function saveBoolean(field, checked, element) {
  if (await persist({ [field]: checked }, field)) return;
  setSwitch(element, !checked);
  if (ui.controls[field] !== element) setSwitch(ui.controls[field], formState()[field] === true);
}

async function changeUseNative(checked, element) {
  renderSwitchGates();
  await saveBoolean("useNativeForDirect", checked, element);
  renderSwitchGates();
}

async function applyPreset(name) {
  const preset = PRESETS.find((item) => item.name === name);
  if (!preset) return;
  controlOf(ui.controls.concurrentFragments).value = String(preset.fragments);
  controlOf(ui.controls.concurrentRanges).value = String(preset.ranges);
  for (const field of ["concurrentFragments", "concurrentRanges"]) {
    state.invalid.delete(field);
    setSettingError(ui.rows[field], "");
  }
  if (await persist({ concurrentFragments: preset.fragments, concurrentRanges: preset.ranges }, "preset")) {
    markSaved(ui.rows.concurrentFragments);
    markSaved(ui.rows.concurrentRanges);
  } else {
    // Not stored: the fields and the preset go back to what the worker uses.
    const stored = stateFromSettings(state.settings || {});
    controlOf(ui.controls.concurrentFragments).value = String(stored.concurrentFragments);
    controlOf(ui.controls.concurrentRanges).value = String(stored.concurrentRanges);
  }
  syncPreset();
}

// A risky setting asks first, in place, before anything is saved.
async function changePrivateNetwork(checked, element) {
  if (!checked) {
    await saveBoolean("allowPrivateNetworkMedia", false, element);
    return;
  }
  setSwitch(element, false);
  // Allowing an opt-in removes nothing, so "Allow" is tertiary, not destructive.
  const confirmed = await menus.confirm(element, {
    question: msg("settings.lan.confirm"),
    confirmLabel: msg("settings.lan.allow"),
    cancelLabel: msg("action.cancel"),
    confirmKind: "tertiary"
  });
  if (!confirmed) return;
  setSwitch(element, true);
  await saveBoolean("allowPrivateNetworkMedia", true, element);
}

// The permission request is the first call of the switch's own gesture.
async function changeNotifications(checked, element) {
  // Looked up when needed: a language switch may rebuild the row while Chrome asks.
  const rowElement = () => ui.rows.showNotifications;
  let request = null;
  if (checked) {
    try {
      request = globalThis.chrome.permissions.request({ permissions: ["notifications"] });
    } catch (error) {
      setSwitch(element, false);
      setSettingError(rowElement(), errorText(error));
      return;
    }
  }
  if (!request) {
    await saveBoolean("showNotifications", false, element);
    return;
  }
  await runAction(element, "settings:notifications", async () => {
    const granted = await request;
    state.notificationPermission = granted === true;
    if (!granted) {
      setSwitch(element, false);
      setSettingError(rowElement(), msg("settings.notify.denied"));
      return;
    }
    await saveBoolean("showNotifications", true, element);
  }, {
    onError: (error) => {
      setSwitch(element, false);
      setSettingError(rowElement(), errorText(error));
    }
  });
}

async function changeLanguage(value) {
  const rowElement = ui.rows.language;
  try {
    state.languagePref = value;
    state.languageSaved = true;
    await saveUiLanguage(value);
    // The page rebuilds on the storage change; mark the current row too in
    // case the resolved language did not change.
    markSaved(ui.rows.language || rowElement);
  } catch (error) {
    state.languageSaved = false;
    setSettingError(rowElement, errorText(error));
  }
}

async function changeDeveloperTools(checked, element) {
  try {
    state.developer = await saveDeveloperTools(checked);
    markSaved(ui.rows.developerTools);
    renderDeveloper();
    if (state.developer) void refreshDiagnostics();
  } catch (error) {
    setSwitch(element, !checked);
    setSettingError(ui.rows.developerTools, errorText(error));
  }
}

function onCustomizationChange({ enabled }) {
  state.developer = enabled;
  setSwitch(ui.controls.developerTools, enabled);
  renderDeveloper();
  customization?.refresh();
}

// ---------- file names ----------
function rememberTemplateSelection() {
  const input = controlOf(ui.controls.filenameTemplate);
  const length = input.value.length;
  state.templateSelection = {
    start: Number.isInteger(input.selectionStart) ? input.selectionStart : length,
    end: Number.isInteger(input.selectionEnd) ? input.selectionEnd : length
  };
}

function insertFilenameToken(token) {
  const input = controlOf(ui.controls.filenameTemplate);
  const inserted = insertTemplateToken(input.value, token, state.templateSelection.start, state.templateSelection.end);
  input.value = inserted.value;
  input.focus();
  input.setSelectionRange?.(inserted.selectionStart, inserted.selectionEnd);
  rememberTemplateSelection();
  setSettingError(ui.rows.filename, "");
  renderTemplatePreviewLine();
  void commitField("filenameTemplate");
}

function renderTemplatePreviewLine() {
  const value = $("#filename-preview .filename-preview-value");
  if (!value) return;
  // The values the worker writes (background.js renderFilename): the stream
  // kind in lower case, the height with "p", today's UTC date.
  const name = renderTemplatePreview(rawValue("filenameTemplate"), {
    title: msg("settings.filename.sampleTitle"),
    host: "media.example.com",
    kind: "hls",
    height: "1080p",
    date: new Date().toISOString().slice(0, 10)
  });
  if (!name) {
    value.textContent = msg("settings.filename.emptyPreview");
    return;
  }
  const shown = filename(name);
  shown.classList.add("t-row");
  value.replaceChildren(shown);
}

// ---------- save location ----------
function renderLocation() {
  const rowElement = ui.rows.location;
  if (!rowElement) return;
  const full = typeof state.host?.downloadDir === "string" && state.host.downloadDir.startsWith("/") ? state.host.downloadDir : "";
  const shown = full ? full.replace(/^\/Users\/[^/]+(?=\/|$)/, "~") : DEFAULT_LOCATION;
  const path = $(".setting-description", rowElement);
  path.textContent = shown;
  path.hidden = false;
  path.title = full;
  ui.controls.locationReset.hidden = shown === DEFAULT_LOCATION;
}

// The folder picker is a native sheet shown by the engine; the permission
// request stays inside this click so Chrome can prompt when needed.
async function changeDownloadFolder(buttonElement, reset) {
  const rowElement = ui.rows.location;
  let request;
  try {
    request = globalThis.chrome.permissions.request({ permissions: ["nativeMessaging"] });
  } catch (error) {
    setSettingError(rowElement, errorText(error));
    return;
  }
  await runAction(buttonElement, reset ? "settings:reset-folder" : "settings:choose-folder", async () => {
    if (!(await request)) throw userError(msg("toast.engineNeeded"));
    state.nativePermission = true;
    const response = await callWorker({ type: "CHOOSE_DOWNLOAD_FOLDER", reset });
    state.host = { ...state.host, downloadDir: response.downloadDir };
    renderLocation();
    setSettingError(rowElement, "");
    markSaved(rowElement);
  }, {
    // Closing the folder sheet is the user's own choice, not an error.
    onError: (error) => setSettingError(rowElement, error?.code === "cancelled" ? "" : errorText(error))
  });
}

// ---------- local engine ----------
function renderEngine() {
  const view = engineState({
    checking: state.engineChecking,
    permission: state.nativePermission === true,
    host: state.host,
    failed: state.engineFailed,
    retrySeconds: state.retrySeconds,
    removed: state.permissionRemoved
  });
  state.engineReady = view.tone === "complete";
  for (const entry of ui.engine) {
    entry.status.dataset.tone = view.tone;
    entry.status.textContent = msg(view.label);
    entry.action.dataset.engineAction = view.action;
    const label = entry.action.querySelector("span");
    if (label) label.textContent = msg(view.action === "setUp" ? "action.setUp" : "action.retry");
    // A Ready engine offers no action; Retry follows a failure only.
    entry.action.hidden = !view.action || (view.checking === true && state.nativePermission === null);
    const detail = view.description ? msg(view.description, view.params) : "";
    if (entry.withDescription) setDescription(entry.row, detail);
    if (entry.announcer) {
      const spoken = msg("settings.engine.announce", { state: msg(view.label), detail });
      if (spoken !== lastEngineAnnouncement) {
        lastEngineAnnouncement = spoken;
        entry.announcer.textContent = spoken;
      }
    }
  }
  // The install steps open by themselves when the engine is missing; the user
  // closes them. Once the engine works they step aside, and return if it breaks.
  if (ui.install) {
    ui.install.hidden = state.engineReady;
    if (view.install === true) ui.install.open = true;
  }
  // Until the engine is Ready, what needs it shows the engine's own state, not
  // "Not yet" (which means the build lacks it) and not "Yes".
  const mirror = (node, ready) => {
    if (!node) return;
    const [tone, key] = state.engineReady ? ready : [view.tone, view.label];
    node.dataset.tone = tone;
    node.textContent = msg(key);
  };
  mirror($(".row-status", ui.rows.merge), view.merging ? ["complete", "settings.yes"] : ["cancelled", "settings.notYet"]);
  for (const capability of ui.capabilities) {
    if (capability.enabled && capability.needsEngine) mirror(capability.status, ["complete", "settings.yes"]);
  }
  renderSwitchGates();
  renderLocation();
}

function showEngineError() {
  // The engine rows carry the state; a failed check reads as "Couldn't connect".
  state.engineFailed = true;
  renderEngine();
}

async function requestNativeAccess(buttonElement) {
  let request;
  try {
    // Native Messaging is optional: request it straight from the click.
    request = globalThis.chrome.permissions.request({ permissions: ["nativeMessaging"] });
  } catch {
    showEngineError();
    return;
  }
  await runAction(buttonElement, "native-access", async () => {
    const granted = await request;
    state.nativePermission = granted === true;
    if (!granted) {
      state.host = { connected: false, needsPermission: true };
      renderEngine();
      return;
    }
    state.permissionRemoved = false;
    await checkEngine();
  }, { onError: showEngineError });
}

/** Ask the engine how it is, finish Chrome's setup when needed, then reconcile the live permission. */
async function checkEngine() {
  state.nativePermission = await permissionsContains("nativeMessaging");
  if (!state.nativePermission) {
    state.engineChecking = false;
    state.host = { connected: false, needsPermission: true };
    renderEngine();
    return;
  }
  state.engineChecking = true;
  state.engineFailed = false;
  renderEngine();
  try {
    const host = await pingHost();
    state.host = host;
    state.engineChecking = false;
    renderEngine();
    await recoverNativeApi(host);
    await refreshDiagnostics().catch(() => {});
  } catch {
    state.host = { connected: false };
    state.engineFailed = true;
  } finally {
    state.engineChecking = false;
    const granted = await permissionsContains("nativeMessaging");
    if (state.nativePermission && !granted) state.permissionRemoved = true;
    state.nativePermission = granted;
    if (!granted) state.host = { connected: false, needsPermission: true };
    renderEngine();
  }
}

function pingHost() {
  pingInFlight ||= callWorker({ type: "PING_HOST" })
    .then((response) => response.hostStatus || {})
    .finally(() => { pingInFlight = null; });
  return pingInFlight;
}

function recoverNativeApi(host) {
  // While the worker reloads the extension to obtain the API, this page is
  // about to be replaced; a recovery request now would only race the reload.
  if (host?.failureReason !== "api_unavailable" || host.selfHealing === true) return Promise.resolve();
  recoveryInFlight ||= completeNativeApiRecovery(host).finally(() => { recoveryInFlight = null; });
  return recoveryInFlight;
}

async function completeNativeApiRecovery(host) {
  let response = await callWorker({ type: "RECOVER_NATIVE_API" });
  let recovered = response.hostStatus || host;
  state.host = recovered;
  renderEngine();
  if (recovered.needsPermission) return;
  const retryAfterMs = Number.isFinite(response.retryAfterMs) ? Math.max(0, Math.min(120_000, response.retryAfterMs)) : 0;
  if (retryAfterMs > 0) {
    state.retrySeconds = Math.ceil(retryAfterMs / 1000);
    renderEngine();
    // Deliberately do not message the worker while waiting: its idle lifecycle
    // can end, and the ping below then starts a fresh worker whose optional
    // nativeMessaging binding is complete.
    await waitForNativeRecovery(retryAfterMs);
    state.retrySeconds = 0;
    if (!(await permissionsContains("nativeMessaging"))) {
      state.host = { connected: false, needsPermission: true };
      renderEngine();
      return;
    }
    recovered = await pingHost();
    state.host = recovered;
    renderEngine();
    if (recovered.needsPermission) return;
    if (recovered.failureReason !== "api_unavailable") return;
    response = await callWorker({ type: "RECOVER_NATIVE_API" });
    recovered = response.hostStatus || recovered;
    state.host = recovered;
    renderEngine();
  }
  if (response.recoveryBlocked === true) {
    state.host = { ...state.host, connected: false, failureReason: "api_unavailable", restartRequired: true, selfHealing: false };
    renderEngine();
  }
}

// ---------- developer: version info ----------
function renderDeveloper() {
  if (ui.developerRows) ui.developerRows.hidden = !state.developer;
  const diagnostics = state.diagnostics;
  const unknown = msg("settings.version.unknown");
  const extension = diagnostics?.extension || {};
  const native = diagnostics?.native || {};
  if (!ui.version.extensionId) return;
  ui.version.extensionId.textContent = extension.id || globalThis.chrome?.runtime?.id || unknown;
  ui.version.build.textContent = [extension.version, extension.channel, extension.commit].filter(Boolean).join(" · ") || unknown;
  ui.version.engine.textContent = native.connected ? native.version || unknown : msg("settings.compat.notConnected");
  const compat = !native.connected ? ["cancelled", "settings.compat.notConnected"] : native.compatible === true ? ["complete", "settings.compat.ok"] : ["warning", "settings.engine.updateNeeded"];
  ui.version.compat.dataset.tone = compat[0];
  ui.version.compat.textContent = msg(compat[1]);
}

async function refreshDiagnostics() {
  const response = await callWorker({ type: "GET_DIAGNOSTICS" });
  state.diagnostics = response.diagnostics || null;
  renderDeveloper();
  return state.diagnostics;
}

async function copyVersionInfo(buttonElement) {
  await runAction(buttonElement, "settings:copy-version", async () => {
    const diagnostics = state.diagnostics || await refreshDiagnostics();
    await globalThis.navigator.clipboard.writeText(JSON.stringify(diagnostics, null, 2));
    setSettingError(ui.rows.version, "");
    toast(msg("settings.version.copied"));
  }, { onError: (error) => setSettingError(ui.rows.version, errorText(error)) });
}

// ---------- navigation ----------
function sectionForHash(hash) {
  const id = decodeURIComponent(String(hash || "").replace(/^#/, ""));
  if (!id) return null;
  if (SECTIONS.some((section) => section.id === id)) return id;
  return LEGACY_HASHES[id] || null;
}

/**
 * Scroll to the section a hash names. Every "Set up" elsewhere opens
 * #local-engine; on that landing the page starts at Status, whose first row
 * is the engine with its Set up, and the explanation follows right below it,
 * so both are in view. A nav click goes to the section itself.
 */
function jumpToHash({ landing = false } = {}) {
  const hash = globalThis.location?.hash || "";
  const id = sectionForHash(hash);
  if (!id) return;
  const raw = hash.replace(/^#/, "");
  if (raw !== id) globalThis.history?.replaceState?.(null, "", `#${id}`);
  const target = landing && id === "local-engine" ? "status" : id;
  $(`#${target}`)?.scrollIntoView?.({ block: "start" });
  ui.nav?.setCurrent(id);
}

function updateCurrentSection() {
  if (!ui.nav) return;
  const offset = 56 + 24 + 8;
  let current = SECTIONS[0].id;
  for (const section of SECTIONS) {
    const element = $(`#${section.id}`);
    if (element?.getBoundingClientRect && element.getBoundingClientRect().top - offset <= 0) current = section.id;
  }
  const root = document.documentElement;
  if (root?.scrollHeight && (globalThis.innerHeight || 0) + (globalThis.scrollY || 0) >= root.scrollHeight - 2) current = SECTIONS[SECTIONS.length - 1].id;
  ui.nav.setCurrent(current);
}

// ---------- pond zones: the page margins only ----------
function pondZones() {
  const page = $("#page").getBoundingClientRect();
  const width = globalThis.innerWidth;
  const height = globalThis.innerHeight;
  return [
    { x: 0, y: 0, width: Math.max(0, page.left - 12), height },
    { x: page.right + 12, y: 0, width: Math.max(0, width - page.right - 12), height }
  ];
}

// For node probes and the design audit: the current page state, read-only.
export function settingsSnapshot() {
  return {
    loaded: state.loaded,
    settings: state.settings,
    developer: state.developer,
    invalid: [...state.invalid],
    nativePermission: state.nativePermission,
    switchOn: (field) => isSwitchOn(ui.controls[field])
  };
}

export function whenSaved() {
  return saveChain;
}
