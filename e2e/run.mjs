#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const EXTENSION_DIR = process.env.FLUXCATCH_EXTENSION_DIR
  ? path.resolve(process.env.FLUXCATCH_EXTENSION_DIR)
  : path.join(ROOT, "extension");
const MANIFEST_PATH = path.join(EXTENSION_DIR, "manifest.json");
const { publicDisplayUrl } = await import(pathToFileURL(path.join(EXTENSION_DIR, "lib/candidate-public.js")).href);
const importExtensionModule = (relative) => import(pathToFileURL(path.join(EXTENSION_DIR, relative)).href);
// Every UI string this suite asserts is read from the v2 message modules
// (extension/ui/v2/messages/*.js, merged by ui/v2/messages.js) in the language
// the run pins: Chrome starts with --lang=zh-CN and openExtensionTarget stores
// "zh" under UI_LANGUAGE_STORAGE_KEY (ui/v2/locale.js). The modules are loaded
// from EXTENSION_DIR, so a packaged run checks the copy it actually ships.
const UI_LANGUAGE = "zh";
const v2Locale = await importExtensionModule("ui/v2/locale.js");
const v2Messages = await importExtensionModule("ui/v2/messages.js");
const { errorText: v2ErrorText } = await importExtensionModule("ui/v2/errors.js");
const { workerError: v2WorkerError } = await importExtensionModule("ui/v2/runtime.js");
const settingsForm = await importExtensionModule("options/form-state.js");
// The worker reads messages/worker.js directly (README "Worker notes"), so its
// toolbar tooltip copy is checked against that module, not messages.js.
const workerCopy = (await importExtensionModule("ui/v2/messages/worker.js")).default[UI_LANGUAGE];
v2Locale.setUiLanguage(UI_LANGUAGE);
const UI_LANGUAGE_STORAGE_KEY = v2Locale.UI_LANGUAGE_STORAGE_KEY;
/** A v2 message in the suite's UI language; fails loudly when the key is gone (msg() would return the key). */
function T(key, params = {}) {
  const text = v2Messages.msg(key, params);
  assert.ok(typeof text === "string" && text && text !== key, `v2 message ${key} is missing from ui/v2/messages`);
  return text;
}
// v1 stylesheets the v2 rebuild deleted; no surface may still load them.
const V1_STYLESHEETS = ["/ui/tokens.css", "/ui/components.css", "/ui/atmosphere.css"];
// The visual states of a complete run, in capture order (see e2e/README.md).
const EXPECTED_VISUAL_STATES = Object.freeze([
  "options-light-980x900",
  "options-dark-980x900",
  "options-narrow-390x844",
  "options-autosaved",
  "options-validation",
  "options-private-network-confirm",
  "options-engine-api-unavailable",
  "options-native-host-missing",
  "options-native-host-ready",
  "reduced-motion",
  "popup-372x600",
  "sidepanel-420x820",
  "sidepanel-download-dialog",
  "popup-manifest-loading",
  "download-dialog"
]);
// ui/v2/README.md "Surfaces": the popup is 372 × ≤600. popup.css: html 372
// wide with a 600 cap, the body as tall as its content from a 440 floor (so
// switching views does not jump); a dialog takes the full 600 (system.css).
const POPUP_WIDTH = 372;
const POPUP_HEIGHT = 600;
const POPUP_MIN_HEIGHT = 440;
const ARTIFACT_PATH = path.join(HERE, "artifacts", "latest.json");
const SCREENSHOT_DIR = path.join(HERE, "artifacts", "screenshots");
const PHASE_B_ARTIFACT_DIR = path.join(HERE, "artifacts", "phase-b-matrix");
const FIXTURE_RESULT_KEY = "__FLUXCATCH_E2E_RESULT__";
const POLL_INTERVAL_MS = 100;
const START_TIMEOUT_MS = 20_000;
const CASE_TIMEOUT_MS = 15_000;
const BADGE_APPEAR_TIMEOUT_MS = 3_000;
const HLS_DISPLAY_TITLE = "Volume of Distribution Interactive | Pharmacokinetics - Part 1";
const HLS_INTERNAL_ASSET_TOKEN = "an_PHRM_PK1_2CM_v04_comp_v01_wm_cr_cc03";
const UI_DIRECT_FILENAME = "FluxCatch arrayBuffer fixture.mp4";
const HLS_RENDITIONS = [
  { slug: "q360-13b7ae81273bc61a0691de6bfa56425760148d79", bandwidth: 450000, width: 640, height: 360, codecs: "avc1.42E01E,mp4a.40.2" },
  { slug: "q480-8ba84504ee32e31dd44f9dd3462a250ae9438a37", bandwidth: 800000, width: 854, height: 480, codecs: "avc1.4D401E,mp4a.40.2" },
  { slug: "q720-d03d231954bffe231a18d61855081090b66d8da2", bandwidth: 1800000, width: 1280, height: 720, codecs: "avc1.4D401F,mp4a.40.2" },
  { slug: "q1080-ed447d1ead8963774fc6c2e49f8ebbecad7f2381", bandwidth: 3200000, width: 1920, height: 1080, codecs: "avc1.640028,mp4a.40.2" },
  { slug: "q1440-58445f5c11d2ba86867435dab9257ee49ef3f3ec", bandwidth: 5600000, width: 2560, height: 1440, codecs: "avc1.640032,mp4a.40.2" }
];

const manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, "utf8"));
const defaultMessages = JSON.parse(fs.readFileSync(
  path.join(EXTENSION_DIR, "_locales", manifest.default_locale, "messages.json"), "utf8"));
const EXPECTED_MANIFEST_NAME = resolveManifestMessage(manifest.name, defaultMessages);
const EXPECTED_EXTENSION_ID = extensionIdFromManifestKey(manifest.key);
const E2E_SOURCE_COMMIT = resolveE2eSourceCommit();
const EXPECTED_RUNTIME_COMMIT = process.env.FLUXCATCH_EXPECTED_BUILD_COMMIT || "development";
const PACKAGED_EXTENSION_RUN = EXPECTED_RUNTIME_COMMIT !== "development";
const E2E_WINDOW_SIZE = parseE2eWindowSize(process.env.FLUXCATCH_E2E_WINDOW_SIZE || "1280x900");
const EXPECT_RESTRICTED_ACTION_POPUP = process.env.FLUXCATCH_EXPECT_RESTRICTED_POPUP === "1";
const runId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
const report = {
  schemaVersion: 4,
  runId,
  startedAt: new Date().toISOString(),
  status: "running",
  chrome: {},
  extension: {
    expectedId: EXPECTED_EXTENSION_ID,
    expectedManifest: { name: EXPECTED_MANIFEST_NAME, version: manifest.version }
  },
  cases: [],
  ui: [],
  flows: [],
  visualMatrix: [],
  accessibility: {},
  cleanup: { chrome: false, server: false, profile: false }
};

let server;
let serverOrigin;
let chromeProcess;
let chromeProfile;
let browser;
let controlPage;
let controlTargetId;
let fatalError;
const caseTabIds = new Set();
const fixtureRequestCounts = new Map();

async function main() {
try {
  fs.rmSync(PHASE_B_ARTIFACT_DIR, { recursive: true, force: true });
  fs.mkdirSync(PHASE_B_ARTIFACT_DIR, { recursive: true });
  assert.equal(extensionIdFromManifestKey(manifest.key), EXPECTED_EXTENSION_ID,
    "manifest.key no longer produces the pinned extension ID");

  ({ server, origin: serverOrigin } = await startFixtureServer());
  report.server = { origin: serverOrigin };

  const chromePath = discoverChromeForTesting();
  chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), "fluxcatch-e2e-"));
  report.chrome.executable = path.basename(chromePath);
  report.chrome.profile = chromeProfile;

  const launched = await launchChrome(chromePath, chromeProfile);
  chromeProcess = launched.process;
  report.chrome.devtools = launched.httpOrigin;

  browser = await CdpClient.connect(launched.browserWebSocketUrl);
  const version = await browser.send("Browser.getVersion");
  report.chrome.product = version.product;
  report.chrome.userAgent = version.userAgent;

  const workerTarget = await waitForTarget(
    launched.httpOrigin,
    (target) => target.type === "service_worker" && target.url === `chrome-extension://${EXPECTED_EXTENSION_ID}/background.js`,
    START_TIMEOUT_MS,
    "FluxCatch service worker"
  );
  const discoveredExtensionId = extensionIdFromUrl(workerTarget.url);
  assert.equal(discoveredExtensionId, EXPECTED_EXTENSION_ID, "loaded extension ID mismatch");
  report.extension.workerTarget = workerTarget.url;

  ({ targetId: controlTargetId } = await browser.send("Target.createTarget", {
    url: `chrome-extension://${EXPECTED_EXTENSION_ID}/options/options.html`,
    background: true
  }));
  const controlTarget = await waitForTarget(
    launched.httpOrigin,
    (target) => target.id === controlTargetId && target.type === "page",
    START_TIMEOUT_MS,
    "extension control page"
  );
  controlPage = await CdpClient.connect(controlTarget.webSocketDebuggerUrl);
  await controlPage.send("Runtime.enable");
  const runtimeManifest = await evaluate(controlPage, `(() => {
    const value = chrome.runtime.getManifest();
    return { id: chrome.runtime.id, name: value.name, version: value.version };
  })()`);
  assert.deepEqual(runtimeManifest, {
    id: EXPECTED_EXTENSION_ID,
    name: EXPECTED_MANIFEST_NAME,
    version: manifest.version
  }, "runtime manifest differs from the checked-in manifest");
  report.extension.runtimeManifest = runtimeManifest;
  const buildInfo = await control(`async () => chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" })`);
  assert.equal(buildInfo?.ok, true, buildInfo?.error || "GET_DIAGNOSTICS failed");
  assert.equal(buildInfo.diagnostics?.extension?.version, manifest.version, "runtime build version differs from manifest");
  assert.equal(buildInfo.diagnostics?.extension?.id, EXPECTED_EXTENSION_ID, "runtime build identity has the wrong extension ID");
  assert.equal(buildInfo.diagnostics?.extension?.channel, "github", "runtime build channel mismatch");
  assert.equal(buildInfo.diagnostics?.extension?.commit, EXPECTED_RUNTIME_COMMIT,
    PACKAGED_EXTENSION_RUN ? "packaged extension commit differs from the tested candidate" : "unpacked source must retain its non-release sentinel");
  if (PACKAGED_EXTENSION_RUN) {
    assert.match(buildInfo.diagnostics?.extension?.buildTimestamp || "", /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/,
      "packaged extension lacks its reproducible source timestamp");
  } else {
    assert.equal(buildInfo.diagnostics?.extension?.buildTimestamp, null,
      "unpacked source must not claim a packaged source timestamp");
  }
  assert.equal(buildInfo.diagnostics?.capabilities?.externalToolNetwork, false, "stable external-tool gate must stay closed");
  // The worker still records page-referenced poster metadata on candidates
  // (runCase checks thumbnailUrl); the v2 popup and side panel never fetch or
  // show it (rows.js rowLead with poster: false), which the UI audits assert.
  assert.equal(buildInfo.diagnostics?.capabilities?.remoteThumbnails, true, "stable profile lost its page-referenced thumbnail metadata capability");
  report.extension.buildIdentity = {
    ...buildInfo.diagnostics.extension,
    commit: PACKAGED_EXTENSION_RUN ? buildInfo.diagnostics.extension.commit : E2E_SOURCE_COMMIT
  };
  report.extension.capabilityProfile = buildInfo.diagnostics.capabilities;

  await auditPhaseBOptionsMatrix(launched.httpOrigin);

  // v2 Settings (options/options.js): setting rows built by controls.js
  // settingRow; the engine's one row is #row-engine, the first row of #status
  // (v2 first put it in #local-engine with a #row-statusEngine mirror);
  // capability rows are #row-capability-<n> in #capabilities (matched as
  // .setting-row: settingRow also gives each row's name, description and
  // error nodes ids that start with the row id).
  await auditExistingExtensionPage("options", controlPage, 720, 900, `(async () => {
    const deadline = Date.now() + ${CASE_TIMEOUT_MS};
    const checking = ${JSON.stringify(T("settings.engine.checking"))};
    const { settingsSnapshot } = await import(chrome.runtime.getURL("options/options.js"));
    const engineWord = () => document.querySelector("#row-engine .row-status")?.textContent.trim() || checking;
    while (!(settingsSnapshot().loaded && engineWord() !== checking) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const text = (node) => node?.textContent.trim() ?? null;
    // Kept as strict as v1's label[for] check: controls.js settingRow names
    // every input, select, textarea and [role=switch] (its LABEL_FOR set)
    // with the row's <label for>; aria-label is only for controls with no
    // visible name, which a setting row never has.
    const rowLabel = (node) => Boolean(node.id && text(document.querySelector('label[for="' + node.id + '"]')));
    const controls = [...document.querySelectorAll('#sections input, #sections select, #sections textarea, #sections [role="switch"]')];
    const rowName = (node) => text(node.closest(".setting-row")?.querySelector(".setting-name")) || "";
    const engineAction = document.querySelector("#engine-action");
    return {
      title: document.title,
      heading: text(document.querySelector("#settingsTitle")),
      saveControls: document.querySelectorAll('.save-btn, #saveBar, #dirtyStatus, #discardChangesButton, #sections button[type="submit"]').length,
      engineAction: text(engineAction?.querySelector("span")),
      engineActionKind: engineAction?.dataset.engineAction || "",
      engineStatus: engineWord(),
      engineTone: document.querySelector("#row-engine .row-status")?.dataset.tone || "",
      engineDescription: text(document.querySelector("#row-engine .setting-description")),
      engineSection: document.querySelector("#row-engine")?.closest("section.settings-section")?.id || "",
      statusMirror: Boolean(document.querySelector("#row-statusEngine")),
      merge: text(document.querySelector("#row-merge .row-status")),
      mergeTone: document.querySelector("#row-merge .row-status")?.dataset.tone || "",
      // options.js renderSwitchGates: the Instagram/X engine switch cannot be
      // turned on before the engine is Ready; "Ask where to save" rests only
      // while the engine switch is on.
      useNative: {
        checked: document.querySelector("#field-useNativeForDirect")?.getAttribute("aria-checked"),
        disabled: Boolean(document.querySelector("#field-useNativeForDirect")?.disabled)
      },
      saveAsDisabled: Boolean(document.querySelector("#field-saveAs")?.disabled),
      nativePermissionGranted: await chrome.permissions.contains({ permissions: ["nativeMessaging"] }),
      installOpen: Boolean(document.querySelector("#install")?.open),
      unlabelled: controls.filter((node) => !rowLabel(node)).map((node) => node.id || node.localName),
      deadControls: ["liveDuration", "youtubeEnabled", "ytdlpStatus", "ytdlpRefreshButton", "ytdlpGuide"].filter((id) => document.getElementById(id)),
      externalToolControls: [...controls, ...document.querySelectorAll("#sections button, #sections a[href]")]
        .filter((node) => /youtube|yt-dlp|ytdlp|直播|live/i.test(node.id + " " + (node.getAttribute("name") || "") + " " + rowName(node)))
        .map((node) => node.id || rowName(node)),
      capabilities: [...document.querySelectorAll('#capabilities .setting-row[id^="row-capability-"]')].map((row) => ({
        name: text(row.querySelector(".setting-name")),
        status: text(row.querySelector(".row-status")),
        tone: row.querySelector(".row-status")?.dataset.tone || ""
      })),
      lanSwitch: document.querySelector("#field-allowPrivateNetworkMedia")?.getAttribute("aria-checked"),
      networkValue: text(document.querySelector("#row-network .row-value")),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    };
  })()`);
  const fixtureNetworkSetting = await control(`async () => {
    const before = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!before?.ok) throw new Error(before?.error || "GET_SETTINGS failed before fixture opt-in");
    const saved = await chrome.runtime.sendMessage({
      type: "SAVE_SETTINGS",
      settings: { ...before.settings, allowPrivateNetworkMedia: true }
    });
    if (!saved?.ok) throw new Error(saved?.error || "SAVE_SETTINGS failed for fixture opt-in");
    const after = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" });
    if (!after?.ok) throw new Error(after?.error || "GET_SETTINGS failed after fixture opt-in");
    return {
      defaultAllowed: Boolean(before.settings?.allowPrivateNetworkMedia),
      autoEnrichDefault: before.settings?.autoEnrichSiteQuality,
      enabled: Boolean(after.settings?.allowPrivateNetworkMedia)
    };
  }`);
  assert.equal(fixtureNetworkSetting.defaultAllowed, false, "private-network media must default to disabled");
  assert.equal(fixtureNetworkSetting.autoEnrichDefault, true, "Bilibili automatic quality enrichment must default to enabled");
  assert.equal(fixtureNetworkSetting.enabled, true, "loopback fixtures require an explicit private-network opt-in");
  report.extension.privateNetworkFixtureOptIn = true;
  const uiDownloadDir = path.join(chromeProfile, "verified-downloads");
  fs.mkdirSync(uiDownloadDir, { recursive: true });
  await browser.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: uiDownloadDir, eventsEnabled: true });
  const uiFixture = await prepareUiFixtureTab();
  try {
    // No remote thumbnails: from here until both surfaces are audited, nothing
    // may fetch the fixture's page-referenced poster again (the fixture page
    // loaded it before its load event; the worker only validates the URL).
    const posterRequestsBeforeSurfaces = fixtureRequestCounts.get(uiFixture.posterRequestKey) || 0;
    report.extension.toolbarPopupIntrinsic = await auditToolbarPopupIntrinsicSize(launched.httpOrigin);
    await auditNewExtensionPage("popup", "popup/popup.html", POPUP_WIDTH, POPUP_HEIGHT, popupAuditExpression(), launched.httpOrigin);
    await control(`async () => { await chrome.tabs.update(${JSON.stringify(uiFixture.tabId)}, { active: true }); return true; }`);
    await auditNewExtensionPage("sidepanel", "sidepanel/sidepanel.html", 420, 820, sidepanelAuditExpression(), launched.httpOrigin);
    const posterRequestsAfterSurfaces = fixtureRequestCounts.get(uiFixture.posterRequestKey) || 0;
    assert.equal(posterRequestsAfterSurfaces, posterRequestsBeforeSurfaces,
      "the popup or side panel fetched the page-referenced poster (v2 rows show a type glyph, never a remote thumbnail)");
    report.extension.remoteThumbnailRequestsBySurfaces = posterRequestsAfterSurfaces - posterRequestsBeforeSurfaces;
    await auditGenericNativeBoundary(uiFixture, uiDownloadDir);
    await auditPopupManifestLoading(launched.httpOrigin);
  } finally {
    try { await control(`async () => { await chrome.tabs.remove(${JSON.stringify(uiFixture.tabId)}); return true; }`); } catch { /* Best-effort fixture cleanup. */ }
  }

  const cases = [
    {
      name: "direct-mp4",
      pagePath: `/cases/direct.html?run=${encodeURIComponent(runId)}`,
      expectedKind: "video",
      mediaPath: `/media/direct.mp4?run=${encodeURIComponent(runId)}`,
      thumbnailPath: `/media/poster.png?run=${encodeURIComponent(runId)}`
    },
    {
      name: "hls-master",
      pagePath: hlsFixturePagePath(runId),
      expectedKind: "hls",
      mediaUrl: hlsFixtureUrls(runId).master,
      thumbnailPath: `/media/poster.png?run=${encodeURIComponent(runId)}`,
      expectedVariants: hlsFixtureUrls(runId).references,
      observedVariants: hlsFixtureUrls(runId).observedVariants,
      captionUrl: hlsFixtureUrls(runId).caption,
      expectedTitle: HLS_DISPLAY_TITLE
    },
    {
      name: "dash-mpd",
      pagePath: `/cases/dash.html?run=${encodeURIComponent(runId)}`,
      expectedKind: "dash",
      mediaPath: `/dash/stream.mpd?run=${encodeURIComponent(runId)}`,
      thumbnailPath: `/media/poster.png?run=${encodeURIComponent(runId)}`
    }
  ];

  for (const definition of cases) {
    await runCase(definition, launched.httpOrigin);
  }

  assert.equal(report.ui.length, 3, "not every extension UI page was audited");
  assert.ok(report.ui.every((item) => item.status === "passed"), "one or more UI page checks failed");
  assert.equal(report.cases.length, cases.length, "not every E2E case ran");
  assert.ok(report.cases.every((item) => item.status === "passed"), "one or more E2E cases failed");
  assert.equal(report.flows.length, 3, "not every interaction flow ran");
  assert.ok(report.flows.every((item) => item.status === "passed"), "one or more E2E interaction flows failed");
  assert.deepEqual(report.visualMatrix.map((item) => item.name), [...EXPECTED_VISUAL_STATES],
    "Phase B visual matrix does not match the v2 state list");
  assert.ok(report.visualMatrix.every((item) => item.status === "passed"), "one or more Phase B visual states failed");
  report.status = "passed";
} catch (error) {
  fatalError = error;
  report.status = "failed";
  report.error = serializeError(error);
  process.exitCode = 1;
} finally {
  if (controlPage) controlPage.close();
  if (browser && controlTargetId) {
    try { await browser.send("Target.closeTarget", { targetId: controlTargetId }); } catch { /* Chrome may already be exiting. */ }
  }
  if (browser) {
    try { await browser.send("Browser.close", {}, 2_000); } catch { /* Fall through to process termination. */ }
    browser.close();
  }
  if (chromeProcess) report.cleanup.chrome = await stopProcess(chromeProcess);
  if (server) report.cleanup.server = await closeServer(server);
  if (chromeProfile) {
    try {
      fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
      report.cleanup.profile = !fs.existsSync(chromeProfile);
    } catch (error) {
      report.cleanup.profileError = error.message;
      process.exitCode = 1;
      if (report.status === "passed") report.status = "failed";
    }
  }
  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.parse(report.finishedAt) - Date.parse(report.startedAt);
  report.chrome.profile = "<temporary profile removed>";
  writeReport(report);
}

if (report.status !== "passed") {
  console.error(`E2E failed: ${fatalError?.stack || fatalError?.message || report.cleanup.profileError || "cleanup failed"}`);
} else {
  console.log(`E2E passed: ${report.cases.length} detection cases + ${report.ui.length} UI pages + ${report.flows.length} interaction flows + ${report.visualMatrix.length} Phase B visual states; artifact ${ARTIFACT_PATH}`);
}
}

async function runCase(definition, devtoolsOrigin) {
  const startedAt = Date.now();
  const pageUrl = `${serverOrigin}${definition.pagePath}`;
  const expectedUrl = definition.mediaUrl || `${serverOrigin}${definition.mediaPath}`;
  const expectedPublicUrl = publicDisplayUrl(expectedUrl);
  const expectedThumbnailUrl = publicDisplayUrl(`${serverOrigin}${definition.thumbnailPath}`);
  const item = {
    name: definition.name,
    pageUrl,
    expected: { kind: definition.expectedKind, observedUrl: expectedUrl, publicUrl: expectedPublicUrl },
    startedAt: new Date(startedAt).toISOString(),
    status: "running"
  };
  report.cases.push(item);

  let tabId;
  let pageClient;
  try {
    const created = await control(`async () => {
      const tab = await chrome.tabs.create({ url: "about:blank", active: true });
      const cleared = await chrome.runtime.sendMessage({ type: "CLEAR_TAB", tabId: tab.id });
      const empty = await chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: tab.id });
      return { tabId: tab.id, cleared, empty };
    }`);
    tabId = created.tabId;
    item.tabId = tabId;
    assert.ok(Number.isInteger(tabId) && tabId >= 0, "case did not bind to a real Chrome tab ID");
    assert.equal(caseTabIds.has(tabId), false, "Chrome reused a tab ID across E2E cases");
    caseTabIds.add(tabId);
    assert.equal(created.cleared?.ok, true, "CLEAR_TAB failed");
    assert.equal(created.empty?.ok, true, "GET_TAB_MEDIA failed after CLEAR_TAB");
    assert.deepEqual(created.empty.items, [], "tab state was not empty after CLEAR_TAB");
    item.clearVerified = true;

    await control(`async () => {
      await chrome.tabs.update(${JSON.stringify(tabId)}, { url: ${JSON.stringify(pageUrl)}, active: true });
      return true;
    }`);
    await waitForTabComplete(tabId, pageUrl, CASE_TIMEOUT_MS);

    const pageTarget = await waitForTarget(
      devtoolsOrigin,
      (target) => target.type === "page" && target.url === pageUrl,
      CASE_TIMEOUT_MS,
      `${definition.name} fixture page`
    );
    pageClient = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
    await pageClient.send("Runtime.enable");
    const fetchResult = await poll(async () => {
      const value = await evaluate(pageClient, `globalThis[${JSON.stringify(FIXTURE_RESULT_KEY)}] ?? null`);
      return value && value.done ? value : null;
    }, CASE_TIMEOUT_MS, `${definition.name} fixture fetch result`);
    item.fetch = fetchResult;
    assert.equal(fetchResult.ok, true, `fixture fetch failed: ${fetchResult.error || "unknown error"}`);
    assert.ok(fetchResult.status >= 200 && fetchResult.status < 300, "fixture fetch was not a successful HTTP response");
    assert.equal(fetchResult.url, expectedUrl, "fixture fetched a different media URL");

    // This check deliberately precedes the first post-navigation
    // GET_TAB_MEDIA call. Reading extension UI state must not be what causes
    // the toolbar badge to appear.
    const badgeBeforeRead = await poll(async () => {
      const value = await control(`async () => {
        const [text, title] = await Promise.all([
          chrome.action.getBadgeText({ tabId: ${JSON.stringify(tabId)} }),
          chrome.action.getTitle({ tabId: ${JSON.stringify(tabId)} })
        ]);
        return { text, title };
      }`);
      return value?.text === "1" ? value : null;
    }, BADGE_APPEAR_TIMEOUT_MS, `${definition.name} automatic toolbar badge before media UI read`);
    assert.equal(badgeBeforeRead.text, "1", `${definition.name} toolbar badge count mismatch`);
    // background.js updateBadge: workerText("worker.action.found", { count }) from ui/v2/messages/worker.js.
    assert.equal(badgeBeforeRead.title, workerCopy["worker.action.found"]({ count: 1 }),
      `${definition.name} toolbar title did not describe the detected media`);
    item.badgeBeforeRead = badgeBeforeRead;

    const detection = await poll(async () => {
      const response = await control(`async () => chrome.runtime.sendMessage({
        type: "GET_TAB_MEDIA",
        tabId: ${JSON.stringify(tabId)}
      })`);
      if (!response?.ok) throw new Error(response?.error || "GET_TAB_MEDIA failed");
      item.observed = (response.items || []).map(({ kind, displayUrl, source, sources }) => ({ kind, displayUrl, source, sources }));
      const candidate = (response.items || []).find((entry) => entry.kind === definition.expectedKind && entry.displayUrl === expectedPublicUrl);
      return candidate ? { response, candidate } : null;
    }, CASE_TIMEOUT_MS, `${definition.name} exact ${definition.expectedKind} detection`);

    assert.equal(detection.candidate.kind, definition.expectedKind, "candidate kind mismatch");
    assert.equal(detection.candidate.displayUrl, expectedPublicUrl, "candidate public display URL mismatch");
    assert.equal(Object.hasOwn(detection.candidate, "url"), false, "PublicCandidate exposed an executable URL field");
    assert.match(detection.candidate.generation || "", /^[a-f0-9-]{36}$/, "candidate generation is not opaque");
    assert.equal(detection.candidate.copyable, false, "signed fixture URLs must not be copyable");
    assert.equal(detection.candidate.urlIsRedacted, true, "signed fixture URLs must be marked as redacted");
    assert.doesNotMatch(JSON.stringify(detection.candidate), /token=(?:direct|fast|manifest|observed|caption|dash)/,
      "signed media values crossed the PublicCandidate boundary");
    assert.equal(detection.candidate.thumbnailUrl, expectedThumbnailUrl, "candidate thumbnail URL mismatch");
    assert.equal(detection.candidate.thumbnailSource, "poster", "video poster must outrank page metadata");
    item.candidate = {
      id: detection.candidate.id,
      generation: detection.candidate.generation,
      kind: detection.candidate.kind,
      displayUrl: detection.candidate.displayUrl,
      mime: detection.candidate.mime,
      sources: detection.candidate.sources,
      thumbnailUrl: detection.candidate.thumbnailUrl,
      thumbnailSource: detection.candidate.thumbnailSource
    };

    if (definition.expectedVariants) {
      const grouped = await poll(async () => {
        const response = await control(`async () => chrome.runtime.sendMessage({
          type: "GET_TAB_MEDIA",
          tabId: ${JSON.stringify(tabId)}
        })`);
        if (!response?.ok) throw new Error(response?.error || "GET_TAB_MEDIA failed while waiting for HLS grouping");
        const visibleMedia = (response.items || []).filter((entry) => entry.kind !== "segment");
        const streams = visibleMedia.filter((entry) => entry.kind === "hls");
        const representative = streams.find((entry) => entry.displayUrl === expectedPublicUrl);
        const captionVisible = visibleMedia.some((entry) => entry.displayUrl === publicDisplayUrl(definition.captionUrl)
          || (() => { try { return /\/embed\/captions\//i.test(new URL(entry.displayUrl).pathname); } catch { return false; } })());
        return visibleMedia.length === 1
          && streams.length === 1
          && representative?.groupSize >= HLS_RENDITIONS.length + 1
          && representative?.aliases?.length >= HLS_RENDITIONS.length
          && !captionVisible
          ? { visibleMedia, streams, representative, captionVisible }
          : null;
      }, CASE_TIMEOUT_MS, `${definition.name} master/variant grouping`);
      assert.equal(grouped.visibleMedia.length, 1,
        "the real-shaped HLS observations must produce exactly one visible media item");
      assert.equal(grouped.streams.length, 1,
        "one HLS video must be displayed once even when its master and rendition playlists were observed");
      assert.equal(grouped.captionVisible, false,
        "an /embed/captions/*.m3u8 subtitle playlist must not become a downloadable video candidate");
      assert.equal(grouped.representative.displayUrl, expectedPublicUrl,
        "the fast-host master must remain the representative instead of a rendition or caption playlist");
      assert.ok(grouped.representative.aliases.length >= HLS_RENDITIONS.length,
        "the grouped HLS item must retain its rendition aliases for diagnostics");
      const aliasUrls = grouped.representative.aliases.map((alias) => alias.displayUrl);
      for (const observedUrl of definition.observedVariants || []) {
        assert.ok(aliasUrls.includes(publicDisplayUrl(observedUrl)),
          `the grouped HLS item lost its observed CDN rendition alias: ${observedUrl}`);
      }
      item.grouping = {
        visibleCandidates: grouped.visibleMedia.length,
        groupSize: grouped.representative.groupSize,
        aliasCount: grouped.representative.aliases.length,
        representativeUrl: grouped.representative.displayUrl,
        captionExcluded: !grouped.captionVisible
      };

      const probe = await control(`async () => chrome.runtime.sendMessage({
        type: "PROBE_MANIFEST",
        tabId: ${JSON.stringify(tabId)},
        candidate: ${JSON.stringify({
          id: detection.candidate.id,
          kind: detection.candidate.kind,
          generation: detection.candidate.generation
        })}
      })`);
      assert.equal(probe?.ok, true, `HLS probe failed: ${probe?.error || "unknown error"}`);
      const actualVariants = (probe.probe?.variants || []).map((variant) => variant.url).sort();
      assert.equal(actualVariants.length, definition.expectedVariants.length,
        "HLS master must expose one opaque selector per rendition");
      assert.equal(new Set(actualVariants).size, definition.expectedVariants.length,
        "HLS variants unexpectedly share an opaque selector");
      assert.ok(actualVariants.every((value) => /^https:\/\/fluxcatch\.invalid\/manifest\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(value)),
        "HLS variants exposed a media URL instead of an opaque selector");
      assert.doesNotMatch(JSON.stringify(actualVariants), /run=|token=|signature=|\/deliveries\//i,
        "HLS variant selectors leaked internal media URLs or queries");
      item.hlsVariants = actualVariants;

      await auditHlsDownloadDialog(tabId, expectedPublicUrl, definition.expectedTitle, grouped.representative.id || detection.candidate.id);
    }

    item.status = "passed";
  } catch (error) {
    item.status = "failed";
    item.error = serializeError(error);
    throw error;
  } finally {
    if (pageClient) pageClient.close();
    if (Number.isInteger(tabId)) {
      try { await control(`async () => { await chrome.tabs.remove(${JSON.stringify(tabId)}); return true; }`); } catch { /* Best-effort per-case cleanup. */ }
    }
    item.finishedAt = new Date().toISOString();
    item.durationMs = Date.now() - startedAt;
  }
}

// Settings sections in page order (options/options.js SECTIONS); ids are the
// nav anchors and deep links, and "local-engine" is where every Set up goes
// (ui/v2/media.js ENGINE_SETUP_PATH). Every heading is a section the nav
// lists: "What FluxCatch can save" (#capabilities) is its own section after
// the local engine's explanation, ten in all.
const SETTINGS_SECTIONS = Object.freeze([
  ["status", "settings.section.status"],
  ["local-engine", "settings.section.localEngine"],
  ["capabilities", "settings.section.capabilities"],
  ["saving", "settings.section.saving"],
  ["speed", "settings.section.speed"],
  ["finding", "settings.section.finding"],
  ["privacy", "settings.section.privacy"],
  ["notifications", "settings.section.notifications"],
  ["general", "settings.section.general"],
  ["lab", "settings.section.lab"]
]);
// ui/v2/README.md status(): the tones a status word may carry.
const STATUS_TONES = new Set(["progress", "paused", "queued", "complete", "warning", "failed", "cancelled"]);
// options.js buildCapabilities: the rows of #capabilities in page order for
// the stable build profile, as [name, the build has it, the engine saves it].
// v1 listed nine features and the first v2 port eight; the visual review added
// "Copy-protected video · Not yet" right after Encrypted streams.
const STABLE_CAPABILITIES = Object.freeze([
  ["settings.cap.directMedia", true, true],
  ["settings.cap.streaming", true, true],
  ["settings.cap.bilibili", true, true],
  ["settings.cap.live", false, true],
  ["settings.cap.encrypted", true, true],
  ["settings.cap.protected", false, true],
  ["settings.cap.separateAudio", true, true],
  ["YouTube", false, true],
  ["settings.cap.thumbnails", true, false]
]);
/** The capability rows Settings must show (options.js renderEngine mirror):
 *  "Not yet" (cancelled) is only for what the build lacks; a row the engine
 *  saves shows the engine row's own word and tone until the engine is Ready
 *  (`engine` null), then "Yes"; thumbnails need no engine and read "Yes". */
function expectedCapabilityRows(engine) {
  return STABLE_CAPABILITIES.map(([key, built, needsEngine]) => {
    const name = key.startsWith("settings.") ? T(key) : key;
    if (!built) return { name, status: T("settings.notYet"), tone: "cancelled" };
    if (needsEngine && engine) return { name, status: engine.label, tone: engine.tone };
    return { name, status: T("settings.yes"), tone: "complete" };
  });
}
// Deterministic host DTOs for the engine rows. v1 rendered them with the
// exported renderHostStatus; v2 has no such export, so the page's own Set up
// and Retry run against a stubbed worker answer (see installEngineFixtureStubs).
const ENGINE_FIXTURES = Object.freeze({
  apiUnavailable: { connected: false, failureReason: "api_unavailable" },
  hostMissing: { connected: false, failureReason: "host_missing" },
  ready: {
    connected: true,
    compatible: true,
    version: "0.2.5",
    protocolVersion: 1,
    capabilityProfileVersion: 1,
    ffmpeg: true,
    capabilities: {
      ffmpeg: { available: true, encoders: { libmp3lame: true } },
      ytdlp: { installed: true, available: false, networkDisabled: true }
    }
  }
});

async function auditPhaseBOptionsMatrix(devtoolsOrigin) {
  const originalSettingsResponse = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
  assert.equal(originalSettingsResponse?.ok, true, originalSettingsResponse?.error || "GET_SETTINGS failed before Phase B Options audit");
  const originalSettings = originalSettingsResponse.settings;
  // The speed counts are the Balanced preset's (form-state.js PRESETS, now
  // 8 / 12, the worker's own default), so the baseline shows Balanced selected.
  // v2 first pinned 8 / 8, which the visual review turned into a Custom value.
  const balanced = settingsForm.PRESETS.find((preset) => preset.name === "balanced");
  assert.ok(balanced, "form-state.js lost its Balanced speed preset");
  assert.deepEqual([balanced.fragments, balanced.ranges], [8, 12], "the Balanced preset is no longer 8 parts / 12 ranges");
  const prepared = await control(`async () => chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      ...${JSON.stringify(originalSettings)},
      allowPrivateNetworkMedia: false,
      concurrentFragments: ${balanced.fragments},
      concurrentRanges: ${balanced.ranges},
      minimumBytes: 1024,
      filenameTemplate: "{title} - {height}",
      blockedDomains: []
    }
  })`);
  assert.equal(prepared?.ok, true, prepared?.error || "could not prepare deterministic Options settings");

  const page = await openExtensionTarget("options/options.html", devtoolsOrigin, "Phase B Options matrix");
  const { client } = page;
  try {
    await setViewport(client, 980, 900);
    await setEmulatedPreferences(client, { colorScheme: "light", reducedMotion: "no-preference" });
    await waitForOptionsReady(client);
    await client.send("Page.bringToFront");

    // v1 asserted six fieldsets with legends, a disabled Save, "所有更改均已保存"
    // and 40px targets. v2 (§6.13): ten labelled sections of setting rows,
    // autosave with no save bar, controls at the --control-height tokens.
    const baseline = await evaluate(client, `(async () => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0 && !node.closest("[hidden]");
      };
      const textNodes = [...document.querySelectorAll("p, small, label, button, input, select, textarea, summary, dt, dd, .t-meta")]
        .filter(visible)
        .filter((node) => !node.closest(".skip-link"))
        .map((node) => ({ selector: node.id || node.className || node.localName, px: parseFloat(getComputedStyle(node).fontSize) }))
        .filter((entry) => Number.isFinite(entry.px));
      const described = [...document.querySelectorAll("[aria-describedby]")].map((node) => ({
        id: node.id,
        missing: node.getAttribute("aria-describedby").split(/\\s+/).filter(Boolean).filter((id) => !document.getElementById(id))
      }));
      // The hit area counts an absolutely positioned ::before that grows the
      // control (system.css: the switch's 44 × 32 hit area around a 36 × 20 track).
      const hitArea = (node) => {
        const rect = node.getBoundingClientRect();
        const before = getComputedStyle(node, "::before");
        const grow = (value) => Math.max(0, -(parseFloat(value) || 0));
        const extra = before.content !== "none" && before.position === "absolute"
          ? { x: grow(before.left) + grow(before.right), y: grow(before.top) + grow(before.bottom) }
          : { x: 0, y: 0 };
        return { width: rect.width + extra.x, height: rect.height + extra.y };
      };
      const targets = [...document.querySelectorAll('button, input:not([type=checkbox]):not([type=radio]), select, textarea, summary, a.btn, [role="switch"]')]
        .filter((node) => visible(node) && !node.matches(".skip-link"))
        .map((node) => ({ id: node.id || node.textContent.trim().slice(0, 24), ...hitArea(node) }));
      const compactHeight = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--control-height-compact")) || 32;
      const shortControls = [...document.querySelectorAll('.btn, .icon-button, [data-field]:not([data-multiline])')]
        .filter((node) => visible(node) && !node.matches(".skip-link"))
        .map((node) => ({ id: node.id || node.querySelector("input, select")?.id || node.textContent.trim().slice(0, 24), height: node.getBoundingClientRect().height }))
        .filter((entry) => entry.height < compactHeight - 0.5);
      const sheets = [...document.styleSheets].map((sheet) => new URL(sheet.href).pathname);
      const sectionsNode = document.querySelector("#sections");
      const sections = [...document.querySelectorAll("#sections > section.settings-section")].map((section) => ({
        id: section.id,
        heading: document.getElementById(section.getAttribute("aria-labelledby") || "")?.textContent.trim() || ""
      }));
      const navItems = [...document.querySelectorAll("nav.nav .nav-item")].map((node) => ({ id: node.dataset.navId, current: node.getAttribute("aria-current") }));
      const switches = [...document.querySelectorAll('#sections [role="switch"]')].filter((node) => !node.closest("[hidden]")).map((node) => ({
        id: node.id,
        checked: node.getAttribute("aria-checked"),
        label: document.querySelector('label[for="' + node.id + '"]')?.textContent.trim() || ""
      }));
      const preset = document.querySelector("#field-preset");
      const presetLabel = (preset?.getAttribute("aria-labelledby") || "").split(/\\s+/).filter(Boolean)
        .map((id) => document.getElementById(id)?.textContent.trim() || "").join(" ");
      const unsupported = document.querySelector("#row-unsupported");
      const focusControl = document.querySelector("#field-filenameTemplate");
      focusControl.focus({ preventScroll: true });
      const focusField = focusControl.closest("[data-field]");
      // The ring animates in over --t-micro (system.css .field transition); read it settled.
      await new Promise((resolve) => setTimeout(resolve, 400));
      return {
        title: document.title,
        heading: document.querySelector("#settingsTitle")?.textContent.trim(),
        sections,
        navItems,
        navLabel: document.querySelector("nav.nav")?.getAttribute("aria-label") || "",
        described,
        minVisibleTextPx: Math.min(...textNodes.map((entry) => entry.px)),
        undersizedTargets: targets.filter((entry) => entry.height < 23.5 || entry.width < 23.5),
        shortControls,
        sheets,
        saveControls: document.querySelectorAll('.save-btn, #saveBar, #dirtyStatus, #discardChangesButton, #sections button[type="submit"]').length,
        sectionsBusy: sectionsNode?.getAttribute("aria-busy"),
        sectionsInert: Boolean(sectionsNode?.hasAttribute("inert")),
        savedNotesVisible: document.querySelectorAll('.saved-note[data-visible="true"]').length,
        switches,
        presetRole: preset?.getAttribute("role"),
        presetLabel,
        presetOptions: [...(preset?.querySelectorAll("button") || [])].map((node) => ({
          value: node.dataset.value,
          role: node.getAttribute("role"),
          checked: node.getAttribute("aria-checked"),
          selected: node.getAttribute("aria-selected")
        })),
        presetDescription: document.querySelector("#row-preset .setting-description")?.textContent.trim() || "",
        // The engine's one status row is the first row of Status; Local engine
        // keeps only the explanation and the install steps (no setting row).
        engineRows: [...document.querySelectorAll("#sections .setting-row")]
          .filter((node) => node.querySelector(".setting-name")?.textContent.trim() === ${JSON.stringify(T("settings.engine.name"))})
          .map((node) => ({ id: node.id, section: node.closest("section.settings-section")?.id || "" })),
        firstStatusRow: document.querySelector("#status .setting-row")?.id || "",
        minimumKB: {
          min: document.querySelector("#field-minimumKB")?.getAttribute("min"),
          max: document.querySelector("#field-minimumKB")?.getAttribute("max"),
          description: document.querySelector("#row-minimumKB .setting-description")?.textContent.trim() || ""
        },
        signin: {
          value: document.querySelector("#row-signin .row-value")?.textContent.trim() || "",
          description: document.querySelector("#row-signin .setting-description")?.textContent.trim() || ""
        },
        localEngineRows: document.querySelectorAll("#local-engine .setting-row").length,
        localEngineButtons: document.querySelectorAll("#local-engine button").length,
        unsupportedControls: unsupported ? unsupported.querySelectorAll('button, input, select, textarea, a[href], [role="switch"]').length : -1,
        developerRowsHidden: Boolean(document.querySelector("#developer-rows")?.hidden),
        // v1: no enabled, visible control in #lab. v2 options.js buildLab keeps
        // one by design, the Developer tools switch; everything else is hidden.
        labActive: [...document.querySelectorAll('#lab button, #lab input, #lab select, #lab textarea, #lab a[href], #lab [role="switch"]')]
          .filter((node) => !node.disabled && visible(node)).map((node) => node.id || node.localName),
        primaryButtons: document.querySelectorAll("#sections .btn-primary").length,
        focusRing: {
          shadow: getComputedStyle(focusField).boxShadow,
          focusWithin: focusField.matches(":focus-within"),
          inputOutline: getComputedStyle(focusControl).outlineStyle
        },
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    assert.equal(baseline.title, `${T("settings.title")} · ${T("brand.name")}`);
    assert.equal(baseline.heading, T("settings.title"));
    assert.deepEqual(baseline.sections.map((section) => section.id), SETTINGS_SECTIONS.map(([id]) => id),
      "Settings must group its rows into the ten v2 sections (local engine at #local-engine, then #capabilities)");
    assert.deepEqual(baseline.sections.map((section) => section.heading), SETTINGS_SECTIONS.map(([, key]) => T(key)),
      "every Settings section must be labelled by its heading");
    assert.deepEqual(baseline.navItems.map((item) => item.id), SETTINGS_SECTIONS.map(([id]) => id), "Settings nav does not list every section");
    assert.equal(baseline.navItems.filter((item) => item.current === "true").length, 1, "Settings nav must mark exactly one current item");
    assert.equal(baseline.navLabel, T("settings.navLabel"));
    assert.deepEqual(baseline.described.filter((entry) => entry.missing.length), [], "Options aria-describedby references a missing helper");
    assert.ok(baseline.minVisibleTextPx >= 12, `Options contains ${baseline.minVisibleTextPx}px visible text`);
    // v1 required 40px; v2 sizes controls by token (36 regular, 32 compact,
    // tertiary and icon buttons). The floor is WCAG 2.5.8 (24 × 24) for every
    // hit area, and the compact control height for every button and field.
    assert.deepEqual(baseline.undersizedTargets, [], `Options contains sub-24px hit areas: ${JSON.stringify(baseline.undersizedTargets)}`);
    assert.deepEqual(baseline.shortControls, [], `Options contains controls below --control-height-compact: ${JSON.stringify(baseline.shortControls)}`);
    for (const sheet of ["/ui/v2/tokens.css", "/ui/v2/system.css", "/options/options.css"]) {
      assert.ok(baseline.sheets.some((value) => value.endsWith(sheet)), `Options does not load ${sheet}`);
    }
    assert.deepEqual(baseline.sheets.filter((value) => V1_STYLESHEETS.some((sheet) => value.endsWith(sheet))), [], "Options still loads a v1 stylesheet");
    assert.equal(baseline.saveControls, 0, "v2 Settings autosaves: no Save button, save bar or dirty status may remain");
    assert.equal(baseline.sectionsBusy, null, "loaded Settings still marks its rows aria-busy");
    assert.equal(baseline.sectionsInert, false, "loaded Settings still makes its rows inert");
    assert.equal(baseline.savedNotesVisible, 0, "a fresh Settings page shows an inline Saved before any change");
    assert.ok(baseline.switches.length >= 6, "Settings booleans must be switchControl switches");
    for (const entry of baseline.switches) {
      assert.ok(["true", "false"].includes(entry.checked), `switch ${entry.id} lacks aria-checked`);
      assert.ok(entry.label, `switch ${entry.id} is not named by its setting row's <label for>`);
    }
    assert.equal(baseline.switches.find((entry) => entry.id === "field-allowPrivateNetworkMedia")?.checked, "false",
      "the home-network switch must show off while the stored setting is off");
    assert.equal(baseline.presetRole, "radiogroup", "the speed preset must be a segmented radiogroup");
    assert.equal(baseline.presetLabel, T("settings.preset.name"), "the speed preset radiogroup is not labelled by its row name");
    assert.ok(baseline.presetOptions.length >= 2 && baseline.presetOptions.every((option) => option.role === "radio"
      && ["true", "false"].includes(option.checked) && option.selected === null), `speed preset options are not radios: ${JSON.stringify(baseline.presetOptions)}`);
    assert.deepEqual(baseline.presetOptions.map((option) => option.value), settingsForm.PRESETS.map((preset) => preset.name),
      "the speed preset does not offer the form-state.js presets in order");
    assert.deepEqual(baseline.presetOptions.filter((option) => option.checked === "true").map((option) => option.value), ["balanced"],
      `stored Balanced counts (${balanced.fragments} / ${balanced.ranges}) did not select Balanced: ${JSON.stringify(baseline.presetOptions)}`);
    assert.equal(baseline.presetDescription, T("settings.preset.description"), "a matched preset must keep the preset row's own line");
    assert.deepEqual(baseline.engineRows, [{ id: "row-engine", section: "status" }],
      "Settings must show the local engine in exactly one row, in Status (v2 first mirrored it as #row-statusEngine)");
    assert.equal(baseline.firstStatusRow, "row-engine", "the engine row is not the first row of Status");
    assert.equal(baseline.localEngineRows, 0, "Local engine must hold only the explanation and the install steps, not a second engine row");
    assert.equal(baseline.localEngineButtons, 0, "Local engine must not offer its own Set up (the one Set up is on the Status row)");
    // Ignore files smaller than: the ceiling is 100,000 KB (form-state.js
    // FORM_LIMITS.minimumKBMax; v2 first allowed 104,857), on the input and in its line.
    assert.equal(settingsForm.FORM_LIMITS.minimumKBMax, 100_000, "the ignore-files ceiling is no longer 100,000 KB");
    assert.deepEqual(baseline.minimumKB, {
      min: String(settingsForm.FORM_LIMITS.minimumKBMin),
      max: String(settingsForm.FORM_LIMITS.minimumKBMax),
      description: T("settings.minimum.description", { min: settingsForm.FORM_LIMITS.minimumKBMin, max: settingsForm.FORM_LIMITS.minimumKBMax })
    }, "the ignore-files field does not state and enforce its 0 to 100,000 range");
    // Sign-in info: "Never stored" in the trailing cell (v2 first left it empty) and its one line.
    assert.deepEqual(baseline.signin, { value: T("settings.signin.value"), description: T("settings.signin.description") },
      "the sign-in info row lost its Never stored value or its line");
    assert.equal(baseline.unsupportedControls, 0, "gated Lab features expose an active control");
    assert.deepEqual(baseline.labActive, ["field-developerTools"], "Lab exposes an active control other than the Developer tools switch");
    assert.equal(baseline.developerRowsHidden, true, "developer rows must stay hidden until Developer tools is turned on");
    assert.ok(baseline.primaryButtons <= 1, "Settings shows more than one primary button");
    // system.css: a builder field's focus ring is the wrapper's 2px --pond-text box-shadow (.field:focus-within).
    assert.equal(baseline.focusRing.focusWithin, true, "focused Options field did not take focus");
    assert.match(baseline.focusRing.shadow, /0px 0px 0px 2px/, `focused Options field has no visible focus ring: ${baseline.focusRing.shadow}`);
    assert.ok(baseline.overflow <= 1, `Options light view overflows by ${baseline.overflow}px`);
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-light-980x900", 980, 900, { theme: "light", state: "loaded", origin: "top" });
    const stickyWide = await measureFinalSettingAgainstTopbar(client, "wide Options");
    await resetVisualOrigin(client);

    await setEmulatedPreferences(client, { colorScheme: "dark", reducedMotion: "no-preference" });
    await delay(100);
    const dark = await evaluate(client, `(() => ({
      matches: matchMedia("(prefers-color-scheme: dark)").matches,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }))()`);
    assert.equal(dark.matches, true, "dark-mode media emulation did not apply");
    assert.notEqual(dark.bodyBackground, baseline.bodyBackground, "dark mode (Dusk) did not change the page background");
    assert.ok(dark.overflow <= 1, `Options dark view overflows by ${dark.overflow}px`);
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-dark-980x900", 980, 900, { theme: "dusk", origin: "top" });

    await setEmulatedPreferences(client, { colorScheme: "light", reducedMotion: "no-preference" });
    await setViewport(client, 390, 844);
    // options.css @media (max-width: 760px): the nav-layout collapses to one column and the nav stops being sticky.
    const narrow = await evaluate(client, `(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navPosition: getComputedStyle(document.querySelector(".nav-slot")).position,
      layoutColumns: getComputedStyle(document.querySelector(".nav-layout")).gridTemplateColumns
    }))()`);
    assert.ok(narrow.overflow <= 1, `Options narrow view overflows by ${narrow.overflow}px`);
    assert.notEqual(narrow.navPosition, "sticky", "Options navigation remains sticky at narrow width");
    assert.equal(narrow.layoutColumns.trim().split(/\s+/).length, 1, `Options narrow layout is not one column: ${narrow.layoutColumns}`);
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-narrow-390x844", 390, 844, { layout: "single-column", origin: "top" });
    const stickyNarrow = await measureFinalSettingAgainstTopbar(client, "narrow Options");
    await resetVisualOrigin(client);

    const zoomChecks = [];
    for (const zoom of [{ percent: 125, width: 784 }, { percent: 150, width: 653 }]) {
      await setViewport(client, zoom.width, 720);
      const value = await evaluate(client, `(() => ({
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        viewportWidth: document.documentElement.clientWidth
      }))()`);
      assert.ok(value.overflow <= 1, `Options ${zoom.percent}% effective zoom overflows by ${value.overflow}px`);
      zoomChecks.push({ ...zoom, ...value, method: "980px physical viewport represented by effective CSS viewport" });
    }

    // Autosave (v1: dirty state, then Save). controls.js markSaved: every
    // control saves itself and shows an inline "Saved" for SAVED_VISIBLE_MS.
    await setViewport(client, 980, 900);
    await evaluate(client, `(() => {
      const input = document.querySelector("#field-filenameTemplate");
      input.scrollIntoView({ block: "center", behavior: "instant" });
      input.value += " 视觉校对";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    const autosaved = await poll(async () => {
      const value = await evaluate(client, `(() => {
        const note = document.querySelector("#row-filename .saved-note");
        const input = document.querySelector("#field-filenameTemplate");
        return {
          visible: note?.dataset.visible,
          text: note?.textContent.trim(),
          role: note?.getAttribute("role"),
          errorHidden: document.querySelector("#row-filename .setting-error")?.hidden,
          invalid: input.getAttribute("aria-invalid"),
          value: input.value
        };
      })()`);
      return value.visible === "true" ? value : null;
    }, CASE_TIMEOUT_MS, "Settings inline Saved after an autosave");
    assert.equal(autosaved.text, T("status.saved"), "autosave did not show the inline Saved");
    assert.equal(autosaved.role, "status", "the inline Saved is not announced as a status");
    assert.equal(autosaved.errorHidden, true, "a successful autosave left a row error");
    assert.equal(autosaved.invalid, null, "a successful autosave left the field aria-invalid");
    const afterAutosave = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
    assert.equal(afterAutosave?.settings?.filenameTemplate, autosaved.value, "autosave did not persist the edited file name pattern");
    assert.match(afterAutosave.settings.filenameTemplate, /视觉校对$/, "autosave persisted a different file name pattern");
    await captureMatrixState(client, "options-autosaved", 980, 900, { savedNote: autosaved.text, persisted: true });
    const savedFaded = await poll(async () => {
      const value = await evaluate(client, `document.querySelector("#row-filename .saved-note")?.dataset.visible`);
      return value === "false" ? value : null;
    }, CASE_TIMEOUT_MS, "inline Saved to fade after SAVED_VISIBLE_MS");
    assert.equal(savedFaded, "false");

    await evaluate(client, `(() => {
      const input = document.querySelector("#field-filenameTemplate");
      input.focus();
      input.setSelectionRange(0, 0);
      input.dispatchEvent(new Event("select", { bubbles: true }));
      document.querySelector('#row-filename [data-token="{title}"]').focus();
      return true;
    })()`);
    await pressEnterKey(client);
    const keyboardInsertion = await poll(async () => {
      const value = await evaluate(client, `(() => ({ value: document.querySelector("#field-filenameTemplate").value, active: document.activeElement?.id }))()`);
      return value.value.startsWith("{title}") ? value : null;
    }, CASE_TIMEOUT_MS, "keyboard template-token insertion");
    assert.ok(keyboardInsertion.value.startsWith("{title}"), "keyboard activation did not insert the selected filename token");
    const insertionSaved = await poll(async () => {
      const value = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
      return value?.settings?.filenameTemplate === keyboardInsertion.value ? value.settings.filenameTemplate : null;
    }, CASE_TIMEOUT_MS, "keyboard token insertion to autosave");
    assert.ok(insertionSaved.startsWith("{title}"));

    // Counts that match no preset (options.js syncPreset): no radio is checked
    // and the preset row's one line says why ("settings.preset.custom").
    // Typing the Balanced count back selects Balanced and its own line again.
    const setRanges = (ranges) => evaluate(client, `(async () => {
      const input = document.querySelector("#field-concurrentRanges");
      input.scrollIntoView({ block: "center", behavior: "instant" });
      input.value = ${JSON.stringify(String(ranges))};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    const readPreset = () => evaluate(client, `(() => ({
      checked: [...document.querySelectorAll('#field-preset [role="radio"][aria-checked="true"]')].map((node) => node.dataset.value),
      description: document.querySelector("#row-preset .setting-description")?.textContent.trim() || ""
    }))()`);
    const customRanges = balanced.ranges - 1;
    assert.equal(settingsForm.matchPreset(balanced.fragments, customRanges), null, "the Custom fixture counts unexpectedly match a preset");
    await setRanges(customRanges);
    const custom = await poll(async () => {
      const value = await readPreset();
      return value.description === T("settings.preset.custom") ? value : null;
    }, CASE_TIMEOUT_MS, "speed preset Custom line");
    assert.deepEqual(custom.checked, [], "hand-set counts that match no preset still check a preset");
    await setRanges(balanced.ranges);
    const rebalanced = await poll(async () => {
      const value = await readPreset();
      return value.description === T("settings.preset.description") ? value : null;
    }, CASE_TIMEOUT_MS, "speed preset back to Balanced");
    assert.deepEqual(rebalanced.checked, ["balanced"], "typing the Balanced counts back did not select Balanced");
    await waitForNothingUnsaved(client, "speed preset Custom round trip to autosave");
    const afterPresetRoundTrip = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
    assert.deepEqual([afterPresetRoundTrip.settings.concurrentFragments, afterPresetRoundTrip.settings.concurrentRanges],
      [balanced.fragments, balanced.ranges], "the Custom round trip did not autosave the Balanced counts back");

    // A failed autosave (v1: failed Save kept the form dirty and the Save
    // action enabled). v2: the row shows errorText(), the field stays
    // aria-invalid and editable with the typed value, nothing is stored.
    const failureHook = await evaluate(client, `(async () => {
      const original = chrome.runtime.sendMessage.bind(chrome.runtime);
      globalThis.__fluxcatchOriginalSendMessage = original;
      try {
        const wrapped = (...args) => args[0]?.type === "SAVE_SETTINGS"
          ? Promise.resolve({ ok: false, error: "确定性保存失败" })
          : original(...args);
        Object.defineProperty(chrome.runtime, "sendMessage", { configurable: true, writable: true, value: wrapped });
        const probe = await chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: {} });
        return { installed: chrome.runtime.sendMessage === wrapped, probe };
      } catch (error) {
        return { installed: false, error: String(error && error.message || error) };
      }
    })()`);
    assert.equal(failureHook.installed, true, `could not install deterministic Save failure hook: ${JSON.stringify(failureHook)}`);
    assert.deepEqual(failureHook.probe, { ok: false, error: "确定性保存失败" }, "Save failure hook did not intercept runtime messaging");
    const storedBeforeFailure = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
    const storedMinimumKB = settingsForm.stateFromSettings(storedBeforeFailure.settings).minimumKB;
    const failedValue = String(Number(storedMinimumKB) + 1);
    await evaluate(client, `(() => {
      const input = document.querySelector("#field-minimumKB");
      input.scrollIntoView({ block: "center", behavior: "instant" });
      input.value = ${JSON.stringify(failedValue)};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    const failedSave = await poll(async () => {
      const value = await evaluate(client, `(async () => {
        const { settingsSnapshot } = await import(chrome.runtime.getURL("options/options.js"));
        const row = document.querySelector("#row-minimumKB");
        const input = document.querySelector("#field-minimumKB");
        const error = row.querySelector(".setting-error");
        return {
          errorHidden: error.hidden,
          error: error.textContent.trim(),
          invalid: input.getAttribute("aria-invalid"),
          value: input.value,
          disabled: input.disabled,
          unsaved: settingsSnapshot().invalid,
          savedVisible: row.querySelector(".saved-note")?.dataset.visible,
          sectionsBusy: document.querySelector("#sections").getAttribute("aria-busy")
        };
      })()`);
      return value.errorHidden === false ? value : null;
    }, CASE_TIMEOUT_MS, "Options failed autosave state");
    assert.equal(failedSave.error, v2ErrorText(v2WorkerError({ ok: false, error: "确定性保存失败" })),
      "a failed autosave must show errorText() on its row, never the raw worker text");
    assert.equal(failedSave.invalid, "true", "a failed autosave did not mark its field aria-invalid");
    assert.equal(failedSave.value, failedValue, "a failed autosave discarded the typed value");
    assert.equal(failedSave.disabled, false, "a failed autosave left the field disabled");
    assert.ok(failedSave.unsaved.includes("minimumKB"), "a failed autosave was not kept as unsaved (leave-page warning)");
    assert.notEqual(failedSave.savedVisible, "true", "a failed autosave showed the inline Saved");
    assert.equal(failedSave.sectionsBusy, null, "a failed autosave left the rows aria-busy");
    // Restore messaging, then put the stored value back so nothing is left
    // unsaved (options.js would otherwise hold the reload with beforeunload).
    await evaluate(client, `(() => {
      Object.defineProperty(chrome.runtime, "sendMessage", { configurable: true, writable: true, value: globalThis.__fluxcatchOriginalSendMessage });
      const input = document.querySelector("#field-minimumKB");
      input.value = ${JSON.stringify(String(storedMinimumKB))};
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    })()`);
    await waitForNothingUnsaved(client, "discard the failed autosave before reload");
    const afterFailure = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
    assert.equal(afterFailure.settings.minimumBytes, storedBeforeFailure.settings.minimumBytes, "a failed autosave changed the stored setting");

    const restoredSettings = await control(`async () => chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: ${JSON.stringify(originalSettings)} })`);
    assert.equal(restoredSettings?.ok, true, restoredSettings?.error || "could not restore settings before validation audit");
    await reloadExtensionPage(client);
    await waitForOptionsReady(client);
    await setViewport(client, 980, 900);

    // Validation (v1: one Save validated four fields, showed an error summary
    // and focused the first invalid field). v2 validates each field on its own
    // change, shows the reason on that row and never sends an invalid value.
    // The v1 "focus the first invalid field on submit" check is removed: v2
    // Settings has no submit (autosave per control, options.js commitField).
    const storedForm = settingsForm.stateFromSettings(originalSettings);
    const invalidInput = {
      concurrentFragments: String(settingsForm.FORM_LIMITS.concurrencyMax + 1),
      minimumKB: String(settingsForm.FORM_LIMITS.minimumKBMax + 1),
      filenameTemplate: "{title}-{unknown}",
      blockedDomains: "https://valid.example/path\n*.invalid.example\nhttps://user:pass@example.com"
    };
    const validationRows = { concurrentFragments: "concurrentFragments", minimumKB: "minimumKB", filenameTemplate: "filename", blockedDomains: "blockedDomains" };
    const expectedIssues = Object.fromEntries(Object.entries(invalidInput).map(([field, raw]) =>
      [field, settingsForm.validateSettings({ ...storedForm, [field]: raw }).fieldErrors[field]?.[0]]));
    for (const [field, issue] of Object.entries(expectedIssues)) assert.ok(issue, `${field} fixture value is unexpectedly valid`);
    assert.ok(expectedIssues.blockedDomains.params.lines.includes(2), "the wildcard domain line must be rejected");
    assert.ok(expectedIssues.filenameTemplate.params.tokens.includes("{unknown}"), "the unknown filename token must be rejected");
    await evaluate(client, `(() => {
      for (const [field, value] of Object.entries(${JSON.stringify(invalidInput)})) {
        const input = document.querySelector("#field-" + field);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      document.activeElement?.blur?.();
      return true;
    })()`);
    const validation = await poll(async () => {
      const value = await evaluate(client, `(async () => {
        const { settingsSnapshot } = await import(chrome.runtime.getURL("options/options.js"));
        const rows = ${JSON.stringify(validationRows)};
        const errors = {};
        const halos = {};
        // Halos animate in over --t-micro (system.css .field transition); read them settled.
        await new Promise((resolve) => setTimeout(resolve, 400));
        for (const [field, row] of Object.entries(rows)) {
          const error = document.querySelector("#row-" + row + " .setting-error");
          errors[field] = error && !error.hidden ? error.textContent.trim() : null;
          halos[field] = getComputedStyle(document.querySelector("#field-" + field).closest("[data-field]")).boxShadow;
        }
        return {
          errors,
          halos,
          invalidIds: [...document.querySelectorAll('#sections [aria-invalid="true"]')].map((node) => node.id),
          unsaved: settingsSnapshot().invalid
        };
      })()`);
      return Object.values(value.errors).every(Boolean) ? value : null;
    }, CASE_TIMEOUT_MS, "Options validation state");
    for (const [field, issue] of Object.entries(expectedIssues)) {
      assert.equal(validation.errors[field], T(`settings.error.${issue.code}`, issue.params), `${field} row does not show its validation reason`);
      assert.ok(validation.invalidIds.includes(`field-${field}`), `${field} validation did not mark its field invalid`);
      // controls.js setSettingError: a soft 3px vermilion halo on the field at rest.
      assert.match(validation.halos[field], /0px 0px 0px 3px/, `${field} invalid field has no halo: ${validation.halos[field]}`);
    }
    assert.deepEqual([...validation.unsaved].sort(), Object.keys(invalidInput).sort(), "invalid fields were not kept as unsaved");
    const afterValidation = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
    for (const field of ["concurrentFragments", "minimumBytes", "filenameTemplate", "blockedDomains"]) {
      assert.deepEqual(afterValidation.settings[field], originalSettings[field], `invalid ${field} input reached the worker`);
    }
    await evaluate(client, `document.querySelector("#row-concurrentFragments").scrollIntoView({ block: "start", behavior: "instant" })`);
    await captureMatrixState(client, "options-validation", 980, 900, { invalidFields: validation.invalidIds });

    await evaluate(client, `(() => {
      const stored = ${JSON.stringify({
        concurrentFragments: String(storedForm.concurrentFragments),
        minimumKB: String(storedForm.minimumKB),
        filenameTemplate: storedForm.filenameTemplate,
        blockedDomains: storedForm.blockedDomains.join("\n")
      })};
      for (const [field, value] of Object.entries(stored)) {
        const input = document.querySelector("#field-" + field);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return true;
    })()`);
    await waitForNothingUnsaved(client, "discard invalid Options input before reload");
    await reloadExtensionPage(client);
    await waitForOptionsReady(client);

    // Home-network downloads ask first (v1: a modal #privateNetworkDialog).
    // v2 options.js changePrivateNetwork: the shared in-place confirm popover
    // (components.js createMenus().confirm), Cancel focused, Allow tertiary.
    await evaluate(client, `(() => {
      const control = document.querySelector("#field-allowPrivateNetworkMedia");
      control.scrollIntoView({ block: "center", behavior: "instant" });
      control.click();
      return true;
    })()`);
    const warning = await poll(async () => {
      const value = await evaluate(client, `(() => {
        const layer = document.querySelector("#menuLayer");
        const menu = layer.querySelector(".menu");
        const buttons = [...menu.querySelectorAll(".confirm-actions .btn")];
        return {
          open: !layer.hidden,
          role: menu.getAttribute("role"),
          label: menu.getAttribute("aria-label"),
          // components.js confirm: the question is the box's one <p> (t-row
          // since the visual review; it was t-body when v2 was first ported).
          question: menu.querySelector(".confirm > p")?.textContent.trim(),
          buttons: buttons.map((node) => ({ text: node.textContent.trim(), kind: [...node.classList].find((name) => name.startsWith("btn-")) })),
          checked: document.querySelector("#field-allowPrivateNetworkMedia").getAttribute("aria-checked"),
          activeText: document.activeElement?.textContent.trim(),
          activeInConfirm: Boolean(document.activeElement?.closest(".confirm-actions")),
          description: document.querySelector("#row-allowPrivateNetworkMedia .setting-description")?.textContent.trim()
        };
      })()`);
      return value.open ? value : null;
    }, CASE_TIMEOUT_MS, "home-network confirmation");
    assert.equal(warning.checked, "false", "home-network setting changed before confirmation");
    assert.equal(warning.role, "dialog", "home-network confirmation is not exposed as a dialog");
    assert.equal(warning.label, T("settings.lan.confirm"), "home-network confirmation is not labelled by its question");
    assert.equal(warning.question, T("settings.lan.confirm"));
    assert.deepEqual(warning.buttons, [
      { text: T("action.cancel"), kind: "btn-tertiary" },
      { text: T("settings.lan.allow"), kind: "btn-tertiary" }
    ], "home-network confirmation must offer Cancel then a tertiary Allow");
    assert.equal(warning.activeInConfirm, true, "home-network confirmation did not take focus");
    assert.equal(warning.activeText, T("action.cancel"), "home-network confirmation did not place focus on the safe action");
    // v1 listed every blocked range in the dialog; v2 keeps one line under the
    // switch (no helper paragraphs, ui/v2/README.md rules).
    assert.equal(warning.description, T("settings.lan.description"), "home-network row lost its blocked-addresses line");
    await evaluate(client, `(() => {
      globalThis.__phaseBPrivateDialogClicks = 0;
      globalThis.__phaseBPrivateDialogFocus = [];
      document.activeElement.addEventListener("click", () => { globalThis.__phaseBPrivateDialogClicks += 1; }, { once: true });
      document.addEventListener("focusin", (event) => { globalThis.__phaseBPrivateDialogFocus.push(event.target?.id || event.target?.localName || "unknown"); }, { capture: true });
      return true;
    })()`);
    await captureMatrixState(client, "options-private-network-confirm", 980, 900, { confirmationRequired: true });
    await pressEnterKey(client);
    await poll(async () => {
      const value = await evaluate(client, `(() => ({ open: !document.querySelector("#menuLayer").hidden, active: document.activeElement?.id }))()`);
      return !value.open ? value : null;
    }, CASE_TIMEOUT_MS, "home-network confirmation focus restoration");
    await delay(250);
    const warningClosed = await evaluate(client, `(() => ({
      open: !document.querySelector("#menuLayer").hidden,
      active: document.activeElement?.id,
      checked: document.querySelector("#field-allowPrivateNetworkMedia").getAttribute("aria-checked"),
      cancelClicks: globalThis.__phaseBPrivateDialogClicks,
      focusEvents: globalThis.__phaseBPrivateDialogFocus
    }))()`);
    assert.equal(warningClosed.cancelClicks, 1, `keyboard activation did not invoke exactly one Cancel action: ${JSON.stringify(warningClosed)}`);
    assert.equal(warningClosed.active, "field-allowPrivateNetworkMedia", `home-network confirmation did not restore focus to its switch: ${JSON.stringify(warningClosed)}`);
    assert.equal(warningClosed.checked, "false", "cancelling the home-network confirmation turned the switch on");
    const afterCancel = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
    assert.equal(afterCancel.settings.allowPrivateNetworkMedia, false, "cancelling the home-network confirmation stored the opt-in");

    // The engine's one row (#row-engine, first in #status; v2 first had it in
    // #local-engine mirrored by #row-statusEngine) for deterministic host DTOs,
    // rendered by options.js renderEngine through the page's own Set up and
    // Retry (form-state.js engineState). Until the engine is Ready, merging and
    // every capability the engine saves show the engine's own word and tone.
    await installEngineFixtureStubs(client);
    // API binding not ready yet: it must not read as a missing engine, so it
    // runs before the missing-host fixture (which opens the install steps).
    const unavailableApiMatrix = await renderEngineFixture(client, ENGINE_FIXTURES.apiUnavailable, T("settings.engine.finishing"));
    assert.equal(unavailableApiMatrix.engine.tone, "progress");
    assert.equal(unavailableApiMatrix.engine.description, T("settings.engine.descFinishing"));
    assert.equal(unavailableApiMatrix.engineRows, 1, "Settings shows the engine in more than one row");
    assert.equal(unavailableApiMatrix.action, T("action.retry"));
    assert.equal(unavailableApiMatrix.actionKind, "retry");
    assert.equal(unavailableApiMatrix.actionHidden, false, "a recovering engine row lost its Retry");
    assert.equal(unavailableApiMatrix.installOpen, false, "API-binding recovery was misclassified as a missing engine");
    assert.equal(unavailableApiMatrix.installHidden, false, "the install steps stepped aside although the engine is not ready");
    assert.deepEqual([unavailableApiMatrix.merge, unavailableApiMatrix.mergeTone], [T("settings.engine.finishing"), "progress"],
      "merging does not show the engine's Finishing setup state");
    assert.deepEqual(unavailableApiMatrix.capabilities, expectedCapabilityRows({ label: T("settings.engine.finishing"), tone: "progress" }),
      "capability rows do not show the engine's Finishing setup state");
    assert.doesNotMatch(unavailableApiMatrix.bodyText, /TypeError|connectNative is not a function/);
    assert.equal(unavailableApiMatrix.engineVisible, true, "API-unavailable engine row is outside its evidence screenshot");
    await captureMatrixState(client, "options-engine-api-unavailable", 980, 900, {
      fixture: "deterministic host DTO rendered by production renderEngine via Set up",
      model: { ...unavailableApiMatrix, bodyText: undefined }
    });

    const missingMatrix = await renderEngineFixture(client, ENGINE_FIXTURES.hostMissing, T("settings.engine.notInstalled"));
    assert.equal(missingMatrix.engine.tone, "failed");
    assert.equal(missingMatrix.engine.description, T("settings.engine.descNotInstalled"));
    assert.equal(missingMatrix.engineRows, 1, "Settings shows the engine in more than one row");
    assert.equal(missingMatrix.action, T("action.retry"));
    assert.equal(missingMatrix.actionHidden, false, "a missing engine row lost its Retry");
    assert.equal(missingMatrix.installOpen, true, "missing engine did not open its installation steps");
    assert.equal(missingMatrix.installHidden, false, "missing engine hid its installation steps");
    assert.deepEqual([missingMatrix.merge, missingMatrix.mergeTone], [T("settings.engine.notInstalled"), "failed"],
      "merging does not show the engine's Not installed state");
    assert.deepEqual(missingMatrix.capabilities, expectedCapabilityRows({ label: T("settings.engine.notInstalled"), tone: "failed" }),
      "capability rows do not show the engine's Not installed state");
    assert.match(missingMatrix.installText, /\.\/scripts\/native-install-wrapper\.sh/);
    assert.match(missingMatrix.installText, /\.\/install-macos\.sh/);
    assert.doesNotMatch(missingMatrix.bodyText, /TypeError|connectNative is not a function/);
    assert.equal(missingMatrix.engineVisible, true, "missing-host engine row is outside its evidence screenshot");
    await captureMatrixState(client, "options-native-host-missing", 980, 900, {
      fixture: "deterministic host DTO rendered by production renderEngine via Retry",
      model: { ...missingMatrix, bodyText: undefined }
    });

    const readyMatrix = await renderEngineFixture(client, ENGINE_FIXTURES.ready, T("settings.engine.ready"));
    assert.equal(readyMatrix.engine.tone, "complete");
    assert.equal(readyMatrix.engine.description, "", "a ready engine still shows a description");
    assert.equal(readyMatrix.engineRows, 1, "Settings shows the engine in more than one row");
    // form-state.js engineState: a Ready engine offers no action (v2 first kept
    // Retry), and the install steps step aside until the engine breaks again.
    assert.equal(readyMatrix.actionKind, "", "a ready engine still names an engine action");
    assert.equal(readyMatrix.actionHidden, true, "a ready engine still offers Retry");
    assert.equal(readyMatrix.installHidden, true, "a ready engine still shows the install steps");
    assert.deepEqual([readyMatrix.merge, readyMatrix.mergeTone], [T("settings.yes"), "complete"], "a ready engine with FFmpeg did not enable merging");
    assert.deepEqual(readyMatrix.capabilities, expectedCapabilityRows(null), "a ready engine did not turn the engine's capability rows to Yes");
    // v1: "yt-dlp 已安装 · 未开放" and external network "未启用". v2 shows no
    // yt-dlp row; an installed yt-dlp must still leave YouTube unsupported.
    assert.equal(readyMatrix.youtube, T("settings.notYet"), "an installed yt-dlp made YouTube read as supported in the stable build");
    assert.equal(readyMatrix.network, T("settings.off"), "the Status section does not report the home network as off");
    // Whether a capability exists is static (options.js buildCapabilities reads
    // BUILD_PROFILE; only the engine's state is mirrored), so also prove the
    // host's yt-dlp report reaches no Settings copy at all (no v2 message names yt-dlp).
    assert.doesNotMatch(readyMatrix.bodyText, /yt-?dlp/i, "stable Settings surfaced the host's yt-dlp report");
    assert.equal(readyMatrix.engineVisible, true, "ready-host engine row is outside its evidence screenshot");
    await captureMatrixState(client, "options-native-host-ready", 980, 900, {
      fixture: "deterministic host DTO rendered by production renderEngine via Retry",
      model: { ...readyMatrix, bodyText: undefined }
    });
    report.extension.nativeFailureEvidence = {
      apiUnavailable: { ...unavailableApiMatrix, bodyText: undefined },
      hostMissing: { ...missingMatrix, bodyText: undefined },
      ready: { ...readyMatrix, bodyText: undefined }
    };
    await removeEngineFixtureStubs(client);
    await reloadExtensionPage(client);
    await waitForOptionsReady(client);

    await setEmulatedPreferences(client, { colorScheme: "light", reducedMotion: "reduce" });
    await resetVisualOrigin(client);
    // system.css reduced motion keeps 200ms transitions; let the scroll reset's
    // top-bar transition finish before counting running animations.
    await delay(400);
    const reduced = await evaluate(client, `(() => {
      const button = document.querySelector("#location-change");
      const style = getComputedStyle(button);
      const animations = document.getAnimations().filter((animation) => animation.playState === "running");
      return {
        matches: matchMedia("(prefers-reduced-motion: reduce)").matches,
        transitionDuration: style.transitionDuration,
        transform: style.transform,
        runningAnimations: animations.length,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    assert.equal(reduced.matches, true, "reduced-motion media emulation did not apply");
    assert.ok(reduced.runningAnimations === 0, `reduced-motion view still has ${reduced.runningAnimations} running animations`);
    assert.ok(reduced.overflow <= 1, `reduced-motion Options view overflows by ${reduced.overflow}px`);
    await captureMatrixState(client, "reduced-motion", 980, 900, { media: "prefers-reduced-motion: reduce", computed: reduced, origin: "top" });

    report.accessibility.options = {
      sections: baseline.sections,
      navItems: baseline.navItems.length,
      switches: baseline.switches.length,
      speedPreset: { role: baseline.presetRole, label: baseline.presetLabel },
      missingDescribedByTargets: baseline.described.filter((entry) => entry.missing.length),
      minimumVisibleTextPx: baseline.minVisibleTextPx,
      undersizedHitAreas: baseline.undersizedTargets,
      shortControls: baseline.shortControls,
      focusRing: baseline.focusRing,
      zoomChecks,
      stickyTopBar: { wide: stickyWide, narrow: stickyNarrow },
      keyboardTemplateInsertion: { valueInserted: true, autosaved: true, resultingFocus: keyboardInsertion.active || "browser-managed" },
      autosave: { inlineSaved: true, persisted: true, fades: true, failureKeepsValueUnsaved: true, failureStoresNothing: true },
      validation: { invalidFields: validation.invalidIds, perRowReasons: true, nothingSent: true },
      privateNetworkFocusRestored: warningClosed.active === "field-allowPrivateNetworkMedia",
      reducedMotion: reduced
    };
  } finally {
    try {
      await control(`async () => chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: ${JSON.stringify(originalSettings)} })`);
    } catch { /* The main E2E cleanup still removes the isolated profile. */ }
    await closeExtensionTarget(page);
  }
}

/** Stub the worker's engine answers and the nativeMessaging permission on one
 *  Settings page (chrome.runtime.sendMessage is the transport of
 *  ui/v2/runtime.js callWorker; options.js asks chrome.permissions at call time). */
async function installEngineFixtureStubs(client) {
  const installed = await evaluate(client, `(() => {
    const permissions = chrome.permissions;
    globalThis.__fluxcatchEngineOriginals = {
      send: chrome.runtime.sendMessage,
      contains: permissions.contains,
      request: permissions.request
    };
    const originals = {
      send: chrome.runtime.sendMessage.bind(chrome.runtime),
      contains: permissions.contains.bind(permissions),
      request: permissions.request.bind(permissions)
    };
    globalThis.__fluxcatchHostFixture = null;
    const nativeOnly = (query) => Array.isArray(query?.permissions) && query.permissions.length > 0
      && query.permissions.every((name) => name === "nativeMessaging");
    const send = (...args) => {
      const type = args[0]?.type;
      if (type === "PING_HOST") return Promise.resolve({ ok: true, hostStatus: globalThis.__fluxcatchHostFixture });
      if (type === "RECOVER_NATIVE_API") return Promise.resolve({ ok: true, hostStatus: globalThis.__fluxcatchHostFixture, retryAfterMs: 0 });
      return originals.send(...args);
    };
    const contains = (query) => (nativeOnly(query) ? Promise.resolve(true) : originals.contains(query));
    const request = (query) => (nativeOnly(query) ? Promise.resolve(true) : originals.request(query));
    Object.defineProperty(chrome.runtime, "sendMessage", { configurable: true, writable: true, value: send });
    Object.defineProperty(permissions, "contains", { configurable: true, writable: true, value: contains });
    Object.defineProperty(permissions, "request", { configurable: true, writable: true, value: request });
    return chrome.runtime.sendMessage === send && permissions.contains === contains && permissions.request === request;
  })()`);
  assert.equal(installed, true, "could not install the deterministic engine fixture stubs");
}

async function removeEngineFixtureStubs(client) {
  await evaluate(client, `(() => {
    const originals = globalThis.__fluxcatchEngineOriginals;
    if (!originals) return false;
    Object.defineProperty(chrome.runtime, "sendMessage", { configurable: true, writable: true, value: originals.send });
    Object.defineProperty(chrome.permissions, "contains", { configurable: true, writable: true, value: originals.contains });
    Object.defineProperty(chrome.permissions, "request", { configurable: true, writable: true, value: originals.request });
    delete globalThis.__fluxcatchEngineOriginals;
    return true;
  })()`);
}

/** Answer the next PING_HOST with `host`, press the engine row's action
 *  (Set up, then Retry) and read the rendered rows once they show `expected`. */
async function renderEngineFixture(client, host, expected) {
  await evaluate(client, `(() => {
    globalThis.__fluxcatchHostFixture = ${JSON.stringify(host)};
    document.querySelector("#engine-action").click();
    return true;
  })()`);
  const value = await poll(async () => {
    const state = await evaluate(client, `(async () => {
      const text = (node) => node?.textContent.trim() ?? null;
      const status = document.querySelector("#row-engine .row-status");
      const description = document.querySelector("#row-engine .setting-description");
      const action = document.querySelector("#engine-action");
      const capabilities = [...document.querySelectorAll('#capabilities .setting-row[id^="row-capability-"]')];
      const engineName = ${JSON.stringify(T("settings.engine.name"))};
      return {
        engine: { label: text(status), tone: status?.dataset.tone || "", description: description && !description.hidden ? text(description) : "" },
        engineRows: [...document.querySelectorAll("#sections .setting-row")].filter((row) => text(row.querySelector(".setting-name")) === engineName).length
          + document.querySelectorAll("#row-statusEngine").length,
        action: text(action?.querySelector("span")),
        actionKind: action?.dataset.engineAction || "",
        actionBusy: action?.getAttribute("aria-busy"),
        actionHidden: Boolean(action?.hidden),
        installOpen: Boolean(document.querySelector("#install")?.open),
        installHidden: Boolean(document.querySelector("#install")?.hidden),
        installText: text(document.querySelector("#install")),
        merge: text(document.querySelector("#row-merge .row-status")),
        mergeTone: document.querySelector("#row-merge .row-status")?.dataset.tone || "",
        capabilities: capabilities.map((row) => ({
          name: text(row.querySelector(".setting-name")),
          status: text(row.querySelector(".row-status")),
          tone: row.querySelector(".row-status")?.dataset.tone || ""
        })),
        youtube: text(capabilities.find((row) => /YouTube/.test(row.textContent))?.querySelector(".row-status")),
        network: text(document.querySelector("#row-network .row-value")),
        tones: [...document.querySelectorAll(".row-status")].map((node) => node.dataset.tone),
        bodyText: document.body.textContent
      };
    })()`);
    return state.engine.label === expected && state.actionBusy === null ? state : null;
  }, CASE_TIMEOUT_MS, `engine row to show ${expected}`);
  assert.ok(value.tones.every((tone) => STATUS_TONES.has(tone)), `engine fixture produced an unknown status tone: ${JSON.stringify(value.tones)}`);
  // Bring Status, whose first row is the engine (options.js jumpToHash lands
  // a #local-engine link there too), under the sticky top bar (options.css
  // scroll-padding-top) and prove the engine row is inside the screenshot.
  const geometry = await evaluate(client, `(async () => {
    document.querySelector("#status").scrollIntoView({ block: "start", behavior: "instant" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const heading = document.querySelector("#status-heading").getBoundingClientRect();
    const row = document.querySelector("#row-engine").getBoundingClientRect();
    const topbar = document.querySelector("#topbar").getBoundingClientRect();
    return { headingTop: heading.top, rowTop: row.top, rowBottom: row.bottom, topbarBottom: topbar.bottom, viewportHeight: innerHeight };
  })()`);
  await delay(80);
  return {
    ...value,
    geometry,
    engineVisible: geometry.headingTop >= geometry.topbarBottom - 1 && geometry.rowTop >= geometry.headingTop
      && geometry.rowBottom <= geometry.viewportHeight + 1
  };
}

async function resetVisualOrigin(client) {
  await evaluate(client, `(() => {
    if (document.activeElement && typeof document.activeElement.blur === "function") document.activeElement.blur();
    globalThis.__phaseBScrollRestore ||= {
      behavior: document.documentElement.style.scrollBehavior,
      anchor: document.documentElement.style.overflowAnchor
    };
    document.documentElement.style.scrollBehavior = "auto";
    document.documentElement.style.overflowAnchor = "none";
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    scrollTo({ left: 0, top: 0, behavior: "instant" });
    return { x: scrollX, y: scrollY };
  })()`);
  await poll(async () => {
    const position = await evaluate(client, `(() => {
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      scrollTo({ left: 0, top: 0, behavior: "instant" });
      return { x: scrollX, y: scrollY };
    })()`);
    return Math.abs(position.x) <= 1 && Math.abs(position.y) <= 1 ? position : null;
  }, CASE_TIMEOUT_MS, "visual capture to reset to the page origin");
}

async function restoreVisualOriginStyles(client) {
  await evaluate(client, `(() => {
    const prior = globalThis.__phaseBScrollRestore;
    if (!prior) return { x: scrollX, y: scrollY };
    document.documentElement.style.scrollBehavior = prior.behavior;
    document.documentElement.style.overflowAnchor = prior.anchor;
    delete globalThis.__phaseBScrollRestore;
    return { x: scrollX, y: scrollY };
  })()`);
}

// v1 measured the final setting against the sticky Save bar. v2 has no save
// bar; the sticky chrome is the top bar (system.css .topbar, options.css
// scroll-padding-top). The last setting on the page (Lab -> Developer tools)
// must land fully visible below it, and its switch must not be covered.
async function measureFinalSettingAgainstTopbar(client, label) {
  const geometry = await evaluate(client, `(async () => {
    const control = document.querySelector("#field-developerTools");
    const row = control.closest(".setting-row");
    const topbar = document.querySelector("#topbar");
    const priorScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    row.scrollIntoView({ block: "start" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.style.scrollBehavior = priorScrollBehavior;
    control.focus({ preventScroll: true });
    const rowRect = row.getBoundingClientRect();
    const topbarRect = topbar.getBoundingClientRect();
    const controlRect = control.getBoundingClientRect();
    const hit = document.elementFromPoint(controlRect.left + controlRect.width / 2, controlRect.top + controlRect.height / 2);
    return {
      rowTop: rowRect.top,
      rowBottom: rowRect.bottom,
      topbarBottom: topbarRect.bottom,
      gap: rowRect.top - topbarRect.bottom,
      viewportHeight: document.documentElement.clientHeight,
      controlHit: hit === control || control.contains(hit)
    };
  })()`);
  assert.ok(geometry.rowTop >= geometry.topbarBottom - 1 && geometry.rowBottom <= geometry.viewportHeight + 1,
    `${label} sticky top bar obscures the final setting: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.controlHit, true, `${label} final setting's switch is covered: ${JSON.stringify(geometry)}`);
  return geometry;
}

/** Settings has finished loading: stored settings in the controls, rows
 *  neither busy nor inert, the engine check settled, nothing unsaved. */
async function waitForOptionsReady(client) {
  const checking = T("settings.engine.checking");
  try {
    return await poll(async () => {
      const value = await evaluate(client, `(async () => {
        const { settingsSnapshot } = await import(chrome.runtime.getURL("options/options.js"));
        const snapshot = settingsSnapshot();
        const sections = document.querySelector("#sections");
        return {
          ready: document.readyState === "complete",
          loaded: snapshot.loaded,
          unsaved: snapshot.invalid,
          busy: sections?.getAttribute("aria-busy"),
          inert: Boolean(sections?.hasAttribute("inert")),
          engine: document.querySelector("#row-engine .row-status")?.textContent.trim() || ""
        };
      })()`);
      return value.ready && value.loaded && value.busy === null && !value.inert
        && value.engine && value.engine !== checking && value.unsaved.length === 0 ? value : null;
    }, CASE_TIMEOUT_MS, "Options loaded baseline");
  } catch (error) {
    const snapshot = await evaluate(client, `(async () => ({
      readyState: document.readyState,
      sectionsBusy: document.querySelector("#sections")?.getAttribute("aria-busy"),
      loadText: document.querySelector("#loadText")?.textContent.trim(),
      engine: document.querySelector("#row-engine .row-status")?.textContent.trim(),
      uiLang: chrome.i18n?.getUILanguage?.(),
      storedLang: (await chrome.storage?.local?.get?.(${JSON.stringify(UI_LANGUAGE_STORAGE_KEY)}))?.[${JSON.stringify(UI_LANGUAGE_STORAGE_KEY)}],
      htmlLang: document.documentElement.lang,
      settingsReply: await Promise.race([
        chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).then((r) => JSON.stringify(r)?.slice(0, 200)),
        new Promise((resolve) => setTimeout(() => resolve("GET_SETTINGS-TIMEOUT-3S"), 3000))
      ]),
      pageErrors: window.__pageErrors || [],
      bodySample: document.body?.innerText?.replace(/\\s+/g, " ").slice(0, 200)
    }))()`).catch((diagError) => ({ diagError: String(diagError) }));
    throw new Error(`${error.message} | page snapshot: ${JSON.stringify(snapshot)}`);
  }
}

/** options.js keeps typed values it could not store (settingsSnapshot().invalid)
 *  and then holds navigation with beforeunload; wait until none are left. */
async function waitForNothingUnsaved(client, label) {
  return poll(async () => {
    const unsaved = await evaluate(client, `(async () => {
      const { settingsSnapshot, whenSaved } = await import(chrome.runtime.getURL("options/options.js"));
      await whenSaved();
      return settingsSnapshot().invalid;
    })()`);
    return unsaved.length === 0 ? true : null;
  }, CASE_TIMEOUT_MS, label);
}

async function reloadExtensionPage(client) {
  await client.send("Page.reload", { ignoreCache: true });
  await poll(async () => await evaluate(client, `document.readyState === "complete"`), CASE_TIMEOUT_MS, "extension page reload");
}

async function setViewport(client, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
}

async function setEmulatedPreferences(client, { colorScheme = "light", reducedMotion = "no-preference" } = {}) {
  await client.send("Emulation.setEmulatedMedia", {
    media: "screen",
    features: [
      { name: "prefers-color-scheme", value: colorScheme },
      { name: "prefers-reduced-motion", value: reducedMotion }
    ]
  });
}

async function pressEnterKey(client) {
  const base = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await client.send("Input.dispatchKeyEvent", { type: "rawKeyDown", ...base, text: "\r", unmodifiedText: "\r" });
  await client.send("Input.dispatchKeyEvent", { type: "char", ...base, text: "\r", unmodifiedText: "\r" });
  await client.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
}

async function openExtensionTarget(relativePath, devtoolsOrigin, label) {
  const { targetId } = await browser.send("Target.createTarget", {
    url: `chrome-extension://${EXPECTED_EXTENSION_ID}/${relativePath}`,
    background: true
  });
  const target = await waitForTarget(
    devtoolsOrigin,
    (candidate) => candidate.id === targetId && candidate.type === "page",
    START_TIMEOUT_MS,
    label
  );
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
  await poll(async () => await evaluate(client, `document.readyState === "complete"`), CASE_TIMEOUT_MS, `${label} DOM ready`);
  // The suite asserts copy from the v2 message modules in UI_LANGUAGE; pin the
  // stored preference so the runner's Chrome locale cannot flip it (every
  // open page follows the change through ui/v2/locale.js bootLocale).
  await evaluate(client, `chrome.storage?.local?.set?.({ ${JSON.stringify(UI_LANGUAGE_STORAGE_KEY)}: ${JSON.stringify(UI_LANGUAGE)} })`);
  await evaluate(client, `window.addEventListener("error", (event) => { (window.__pageErrors = window.__pageErrors || []).push(String(event.message)); }); window.addEventListener("unhandledrejection", (event) => { (window.__pageErrors = window.__pageErrors || []).push("unhandled: " + String(event.reason)); });`)
  return { targetId, client };
}

async function auditToolbarPopupIntrinsicSize(devtoolsOrigin) {
  const { windowId } = await browser.send("Browser.getWindowForTarget", { targetId: controlTargetId });
  const { bounds } = await browser.send("Browser.getWindowBounds", { windowId });
  const mode = EXPECT_RESTRICTED_ACTION_POPUP ? "restricted" : "roomy";
  const popup = await openRealToolbarPopup(devtoolsOrigin, mode);
  try {
    await poll(async () => await evaluate(popup.client, `document.readyState === "complete"`),
      CASE_TIMEOUT_MS, `${mode} Chrome action popup DOM ready`);
    await poll(async () => await evaluate(popup.client, `Boolean(document.querySelector("#mediaRows:not([hidden]) > .row"))`),
      CASE_TIMEOUT_MS, `${mode} Chrome action popup media row`);
    const geometry = await popupIntrinsicGeometry(popup.client);
    assertToolbarPopupGeometry(geometry);
    if (EXPECT_RESTRICTED_ACTION_POPUP) {
      // The popup now follows its content (440 floor, 600 cap), so "shorter
      // than 600" no longer proves the screen cut it: a roomy popup with one
      // row is already at its 440 floor. A constrained popup is shorter than
      // its floor, or (with more content) clips its list into #main's scroller.
      assert.ok(geometry.viewport.height < POPUP_HEIGHT
        && (geometry.viewport.height < POPUP_MIN_HEIGHT || geometry.main.scrollHeight > geometry.main.clientHeight + 1),
        `restricted Chrome screen did not constrain popup height: ${JSON.stringify({ viewport: geometry.viewport, main: geometry.main })}`);
    } else {
      // v2 first fixed the popup at 600; the visual review made it follow its
      // content (popup.css body height auto, min 440, max 600). A roomy screen
      // must therefore give the popup its content height within 440 to 600,
      // and only a popup at the 600 cap may scroll its body.
      assert.ok(geometry.viewport.height >= POPUP_MIN_HEIGHT && geometry.viewport.height <= POPUP_HEIGHT,
        `roomy Chrome screen did not give the popup a height between ${POPUP_MIN_HEIGHT} and ${POPUP_HEIGHT}: ${JSON.stringify(geometry.viewport)}`);
      if (geometry.viewport.height < POPUP_HEIGHT) {
        assert.ok(geometry.main.scrollHeight <= geometry.main.clientHeight + 1,
          `a popup below its ${POPUP_HEIGHT}px cap clips content it should have grown for: ${JSON.stringify({ viewport: geometry.viewport, main: geometry.main })}`);
      }
    }
    const screenshot = await popup.client.send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: false
    }, CASE_TIMEOUT_MS * 2);
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, `popup-action-${mode}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    return {
      mode: "chrome.action.openPopup",
      hostViewportVerified: true,
      deviceMetricsOverrideApplied: false,
      heightMode: mode,
      requestedWindowSize: E2E_WINDOW_SIZE,
      measuredWindowBounds: bounds,
      geometry,
      screenshot: path.relative(HERE, screenshotPath)
    };
  } finally {
    await closeExtensionTarget(popup);
  }
}

async function openRealToolbarPopup(devtoolsOrigin, label) {
  const popupUrl = `chrome-extension://${EXPECTED_EXTENSION_ID}/popup/popup.html`;
  const baselineTargetIds = new Set((await listDevToolsTargets(devtoolsOrigin)).map((target) => target.id));
  const opened = await control(`async () => {
    if (typeof chrome.action?.openPopup !== "function") return { supported: false };
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    await chrome.action.openPopup(activeTab?.windowId == null ? undefined : { windowId: activeTab.windowId });
    return { supported: true, windowId: activeTab?.windowId ?? null };
  }`);
  assert.equal(opened?.supported, true,
    "this E2E Chrome build does not expose chrome.action.openPopup for real popup sizing");
  const target = await waitForTarget(
    devtoolsOrigin,
    (candidate) => candidate.url === popupUrl && !baselineTargetIds.has(candidate.id),
    CASE_TIMEOUT_MS,
    `${label} real Chrome action popup target`
  );
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return { targetId: target.id, client };
}

async function popupIntrinsicGeometry(client) {
  // v2 popup.html: header#topbar > .topbar-inner.lead-grid (BrandMark S, whose
  // span is display: contents, so its logo and wordmark are measured, plus
  // span.bar-actions) and #viewBar (segmented + type filter); main#main is the
  // only scroller; footer#footer holds the two tertiary links (.foot-links).
  return evaluate(client, `(() => {
    const box = (value) => value ? {
      left: value.left, top: value.top, right: value.right, bottom: value.bottom,
      width: value.width, height: value.height
    } : null;
    const rect = (selector) => box(document.querySelector(selector)?.getBoundingClientRect());
    const popupSheet = [...document.styleSheets].find((sheet) => sheet.href?.endsWith("/popup/popup.css"));
    const bodyRule = popupSheet ? [...popupSheet.cssRules].find((rule) => rule.selectorText === "body") : null;
    const htmlRule = popupSheet ? [...popupSheet.cssRules].find((rule) => rule.selectorText === "html") : null;
    const body = document.body.getBoundingClientRect();
    const overlaps = (left, right) => Boolean(left && right
      && left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top);
    const logo = rect("#topbarInner .brandmark-logo");
    const wordmark = rect("#topbarInner .t-wordmark");
    const toolbar = rect("#topbarInner .bar-actions");
    const topbar = rect("#topbarInner");
    const controls = rect("#viewBar");
    const content = rect("#main");
    const footer = rect("#footer");
    const firstCard = rect("#mediaRows > .row");
    const footerButtons = [...document.querySelectorAll("#footer .foot-links .btn")].map((node) => box(node.getBoundingClientRect()));
    return {
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight
      },
      body: {
        left: body.left, top: body.top, right: body.right, bottom: body.bottom,
        width: body.width, height: body.height,
        scrollWidth: document.body.scrollWidth, scrollHeight: document.body.scrollHeight
      },
      declaredBodySize: {
        width: bodyRule?.style.width || "",
        height: bodyRule?.style.height || "",
        minHeight: bodyRule?.style.minHeight || "",
        maxHeight: bodyRule?.style.maxHeight || "",
        cssText: bodyRule?.style.cssText || ""
      },
      declaredRootSize: {
        width: htmlRule?.style.width || "",
        height: htmlRule?.style.height || "",
        maxHeight: htmlRule?.style.maxHeight || "",
        overflow: htmlRule?.style.overflow || "",
        cssText: htmlRule?.style.cssText || ""
      },
      main: (() => {
        const node = document.querySelector("#main");
        return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight };
      })(),
      surface: document.documentElement.dataset.surface || "",
      density: document.documentElement.dataset.density || "",
      mainOverflowY: getComputedStyle(document.querySelector("#main")).overflowY,
      layout: {
        topbar, logo, wordmark, toolbar, controls, content, footer, firstCard, footerButtons,
        brandToolbarOverlap: overlaps(logo, toolbar) || overlaps(wordmark, toolbar),
        topbarControlsOverlap: overlaps(topbar, controls),
        controlsContentOverlap: overlaps(controls, content),
        contentFooterOverlap: overlaps(content, footer),
        cardTopbarOverlap: overlaps(firstCard, topbar),
        cardControlsOverlap: overlaps(firstCard, controls),
        cardFooterOverlap: overlaps(firstCard, footer),
        footerButtonOverlap: footerButtons.some((left, index) =>
          footerButtons.slice(index + 1).some((right) => overlaps(left, right)))
      },
      horizontalOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      verticalOverflow: document.documentElement.scrollHeight - document.documentElement.clientHeight
    };
  })()`);
}

function assertToolbarPopupGeometry(geometry) {
  // v1 declared html 372 × 560 and body min(560px, 100dvh). The first v2 port
  // declared html 372 × 600 and body 100% × 100%. popup.css now: html 372 wide
  // with max-height 600 and overflow hidden, body a flex column as tall as its
  // content (height auto, min-height 440, max-height 600) whose only scroller
  // is #main (ui/v2/README.md "Popup (372 × ≤600)").
  assert.equal(geometry.surface, "popup", "popup root lost data-surface=popup (v2 popup grid)");
  assert.equal(geometry.density, "compact", "popup root lost data-density=compact");
  assert.equal(geometry.declaredRootSize.width, `${POPUP_WIDTH}px`, "popup root lost its intrinsic width request");
  assert.equal(geometry.declaredRootSize.height, "", "popup root must not fix its height (the popup follows its content)");
  assert.equal(geometry.declaredRootSize.maxHeight, `${POPUP_HEIGHT}px`, "popup root lost its 600px height cap");
  assert.equal(geometry.declaredRootSize.overflow, "hidden", "popup root no longer contains a constrained host viewport");
  assert.equal(geometry.declaredBodySize.width, "100%", "popup body no longer fills the 372px root");
  assert.equal(geometry.declaredBodySize.height, "auto", "popup body no longer follows its content height");
  assert.equal(geometry.declaredBodySize.minHeight, `${POPUP_MIN_HEIGHT}px`, "popup body lost its 440px floor");
  assert.equal(geometry.declaredBodySize.maxHeight, `${POPUP_HEIGHT}px`, "popup body lost its 600px cap");
  assert.doesNotMatch(`${geometry.declaredRootSize.width} ${geometry.declaredBodySize.width}`, /v[wh]/i,
    "popup width depends on the host viewport during Chrome's intrinsic layout pass");
  assert.match(geometry.mainOverflowY, /^(auto|scroll)$/, "popup body (#main) is no longer the scroller");
  assert.equal(geometry.body.width, POPUP_WIDTH, "popup body does not render at its declared intrinsic width");
  assert.equal(geometry.viewport.width, POPUP_WIDTH, "real Chrome action popup host did not adopt the 372px intrinsic width");
  assert.equal(geometry.viewport.clientWidth, POPUP_WIDTH, "real Chrome action popup client width is not 372px");
  // Kept from v1: the body must match the real host viewport, whether Chrome
  // sized the popup to its content or a restricted screen shrank it.
  assert.equal(geometry.body.height, geometry.viewport.height,
    "popup body height does not adapt to the real Chrome action viewport");
  assert.equal(geometry.viewport.clientHeight, geometry.viewport.height,
    "real Chrome action popup client height differs from its viewport height");
  assert.ok(geometry.body.height <= POPUP_HEIGHT, `popup body exceeds its ${POPUP_HEIGHT}px ceiling: ${geometry.body.height}px`);
  assert.equal(geometry.layout.brandToolbarOverlap, false, "popup BrandMark overlaps the top-bar icon buttons");
  assert.equal(geometry.layout.topbarControlsOverlap, false, "popup top bar overlaps the Media | Downloads row");
  assert.equal(geometry.layout.controlsContentOverlap, false, "popup view row overlaps the scrollable content");
  assert.equal(geometry.layout.contentFooterOverlap, false, "popup content overlaps the footer links");
  assert.equal(geometry.layout.cardTopbarOverlap, false, "popup media row overlaps the top bar");
  assert.equal(geometry.layout.cardControlsOverlap, false, "popup media row overlaps the view row");
  assert.equal(geometry.layout.cardFooterOverlap, false, "popup media row overlaps the footer");
  assert.equal(geometry.layout.footerButtonOverlap, false, "popup footer links overlap each other");
  assert.equal(geometry.layout.footerButtons.length, 2, "popup footer must hold Open workspace and All downloads");
  assert.ok(geometry.layout.footer.top >= 0 && geometry.layout.footer.bottom <= geometry.viewport.height + 1,
    `popup footer is outside the visible host viewport: ${JSON.stringify({ footer: geometry.layout.footer, viewport: geometry.viewport })}`);
  assert.ok(geometry.layout.firstCard && geometry.layout.firstCard.top >= geometry.layout.controls.bottom,
    "popup did not render a media row below the view row");
  assert.ok(geometry.horizontalOverflow <= 1,
    `real Chrome action popup has ${geometry.horizontalOverflow}px horizontal overflow`);
}

async function listDevToolsTargets(devtoolsOrigin) {
  const response = await fetch(`${devtoolsOrigin}/json/list`, { cache: "no-store" });
  if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}`);
  return response.json();
}

async function closeExtensionTarget({ targetId, client }) {
  client?.close();
  if (targetId) {
    try { await browser.send("Target.closeTarget", { targetId }); } catch { /* Best-effort target cleanup. */ }
  }
}

async function captureMatrixState(client, name, width, height, evidence = {}) {
  const item = { name, status: "running", viewport: { width, height }, evidence };
  report.visualMatrix.push(item);
  try {
    const dimensions = await evaluate(client, `(() => {
      ${evidence.origin === "top" ? `document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      scrollTo({ left: 0, top: 0, behavior: "instant" });` : ""}
      return {
        width: window.innerWidth,
        height: window.innerHeight,
        contentWidth: document.documentElement.clientWidth,
        scrollY,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    assert.equal(dimensions.width, width, `${name} CSS viewport width mismatch`);
    assert.equal(dimensions.height, height, `${name} CSS viewport height mismatch`);
    assert.ok(dimensions.overflow <= 1, `${name} has ${dimensions.overflow}px horizontal overflow`);
    if (evidence.origin === "top") assert.ok(Math.abs(dimensions.scrollY) <= 1, `${name} did not capture from the page origin: scrollY=${dimensions.scrollY}`);
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, CASE_TIMEOUT_MS * 2);
    const screenshotPath = path.join(PHASE_B_ARTIFACT_DIR, `${name}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    const file = path.relative(HERE, screenshotPath);
    item.dimensions = dimensions;
    item.screenshot = file;
    item.status = "passed";
    return item;
  } catch (error) {
    item.status = "failed";
    item.error = serializeError(error);
    throw error;
  } finally {
    if (evidence.origin === "top") {
      try { await restoreVisualOriginStyles(client); } catch { /* The target cleanup owns terminal failures. */ }
    }
  }
}

async function auditHlsDownloadDialog(tabId, expectedUrl, expectedTitle, expectedCandidateId) {
  const item = { name: "hls-download-dialog", status: "running" };
  report.flows.push(item);
  let targetId;
  let client;
  try {
    await control(`async () => { await chrome.tabs.update(${JSON.stringify(tabId)}, { active: true }); return true; }`);
    ({ targetId } = await browser.send("Target.createTarget", {
      url: `chrome-extension://${EXPECTED_EXTENSION_ID}/popup/popup.html`,
      background: true
    }));
    const target = await waitForTarget(
      report.chrome.devtools,
      (candidate) => candidate.id === targetId && candidate.type === "page",
      CASE_TIMEOUT_MS,
      "HLS popup flow"
    );
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setFocusEmulationEnabled", { enabled: true });
    await client.send("Emulation.setDeviceMetricsOverride", {
      width: POPUP_WIDTH,
      height: POPUP_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false
    });
    await poll(async () => await evaluate(client, `document.readyState === "complete"`), CASE_TIMEOUT_MS, "HLS popup DOM ready");
    await client.send("Page.bringToFront");
    // v2 (ui/v2/media.js mediaRow + createMediaDialog): one row per detected
    // item in #mediaRows; Download ([data-media-action="download"]) reads the
    // stream's qualities (PROBE_MANIFEST) and opens dialog#downloadDialog with
    // #mediaName, #mediaFormat, #mediaQuality and the one #mediaDialogLine.
    const result = await evaluate(client, `(async () => {
      const deadline = Date.now() + ${CASE_TIMEOUT_MS};
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      let rows;
      while ((rows = document.querySelectorAll("#mediaRows:not([hidden]) > .row")).length !== 1 && Date.now() < deadline) await sleep(50);
      const row = rows?.[0];
      const rowSnapshot = row ? {
        itemId: row.dataset.itemId || "",
        title: row.querySelector(".row-title .filename")?.dataset.filename || "",
        titleText: row.querySelector(".row-title")?.textContent.trim() || "",
        sourceHost: row.querySelector(".row-source [data-user-content]")?.textContent.trim() || "",
        meta: row.querySelector(".row-meta")?.textContent.trim() || "",
        actions: [...row.querySelectorAll(".row-actions button")].map((node) => node.dataset.mediaAction || node.dataset.action || ""),
        leadImages: row.querySelectorAll(".row-lead img").length
      } : null;
      row?.querySelector('[data-media-action="download"]')?.click();
      const dialog = document.querySelector("#downloadDialog");
      while (!dialog?.open && Date.now() < deadline) await sleep(50);
      while (document.activeElement?.id !== "mediaName" && Date.now() < deadline) await sleep(50);
      const name = document.querySelector("#mediaName");
      const format = document.querySelector("#mediaFormat");
      const quality = document.querySelector("#mediaQuality");
      const qualityStack = quality?.closest(".field-stack");
      const labelFor = (id) => document.querySelector('#downloadDialog label[for="' + id + '"]')?.textContent.trim() || "";
      const lineState = () => {
        const line = document.querySelector("#mediaDialogLine");
        return {
          text: line?.querySelector(".line-text > span")?.textContent.trim() || "",
          actions: [...(line?.querySelectorAll(".line-actions .btn") || [])].map((node) => node.textContent.trim()),
          role: line?.getAttribute("role") || ""
        };
      };
      const filenameBefore = name?.value || "";
      const qualityHiddenBefore = Boolean(qualityStack?.hidden);
      const formatBefore = format?.value || "";
      const lineBefore = lineState();
      const formatOptions = [...(format?.options || [])].map((option) => ({ value: option.value, text: option.textContent.trim(), disabled: option.disabled }));
      const qualityOptions = [...(quality?.options || [])].map((option) => ({ value: option.value, text: option.textContent.trim() }));
      if (format) {
        format.value = "mp3";
        format.dispatchEvent(new Event("change", { bubbles: true }));
      }
      const heading = document.getElementById(dialog?.getAttribute("aria-labelledby") || "");
      const formControls = [...(dialog?.querySelectorAll("input, select, textarea, [role=switch]") || [])];
      // §6.12 / controls.js dialogShell: the dialog fits the popup, its body
      // scrolls and its action row stays in view (sticky), never covered.
      const geometry = (() => {
        if (!dialog) return null;
        const viewportWidth = document.documentElement.clientWidth;
        const viewportHeight = document.documentElement.clientHeight;
        const box = (value) => ({ left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height });
        const rect = dialog.getBoundingClientRect();
        const body = dialog.querySelector(".dialog-body");
        const actions = dialog.querySelector(".dialog-actions");
        const actionsRect = actions?.getBoundingClientRect();
        const buttons = [...(actions?.querySelectorAll("button") || [])].map((node) => {
          const value = node.getBoundingClientRect();
          const hit = document.elementFromPoint(value.left + value.width / 2, value.top + value.height / 2);
          return { action: node.dataset.action || "", kind: [...node.classList].find((name) => name.startsWith("btn-")) || "", type: node.type, ...box(value), uncovered: hit === node || node.contains(hit) };
        });
        return {
          viewportWidth,
          viewportHeight,
          rootHeight: document.documentElement.getBoundingClientRect().height,
          dialog: box(rect),
          // Kept from v1: a modal .dialog-shell has margin: auto (system.css)
          // and width min(--dialog-width, 100vw - 32px), so it stays centred.
          horizontalDelta: Math.abs(rect.left - (viewportWidth - rect.right)),
          verticalDelta: Math.abs(rect.top - (viewportHeight - rect.bottom)),
          inside: rect.left >= 0 && rect.top >= 0 && rect.right <= viewportWidth + 0.5 && rect.bottom <= viewportHeight + 0.5,
          body: body ? { overflowY: getComputedStyle(body).overflowY, scrollHeight: body.scrollHeight, clientHeight: body.clientHeight } : null,
          actions: actionsRect ? { ...box(actionsRect), position: getComputedStyle(actions).position } : null,
          actionsInside: Boolean(actionsRect && actionsRect.top >= rect.top - 0.5 && actionsRect.bottom <= rect.bottom + 0.5
            && actionsRect.bottom <= viewportHeight + 0.5 && actionsRect.top >= 0),
          buttons
        };
      })();
      return {
        rowCount: rows?.length || 0,
        row: rowSnapshot,
        dialogOpen: Boolean(dialog?.open),
        dialogHeading: heading?.textContent.trim() || "",
        dialogDescribedBy: dialog?.getAttribute("aria-describedby") || "",
        closeLabel: dialog?.querySelector(".dialog-close")?.getAttribute("aria-label") || "",
        labels: { name: labelFor("mediaName"), format: labelFor("mediaFormat"), quality: labelFor("mediaQuality") },
        controlIds: formControls.map((node) => node.id),
        checkboxes: dialog?.querySelectorAll('input[type="checkbox"]').length ?? -1,
        numberInputs: dialog?.querySelectorAll('input[type="number"]').length ?? -1,
        hasExtractCheckbox: Boolean(document.querySelector("#extractAudioInput")),
        hasConcurrencyInput: Boolean(document.querySelector("#concurrencyInput")),
        primaryButtons: dialog?.querySelectorAll(".btn-primary").length ?? -1,
        initialFocus: document.activeElement?.id || "",
        formatBefore,
        filenameBefore,
        filenameAfter: name?.value || "",
        formatOptions,
        qualityHiddenBefore,
        qualityHiddenAfter: Boolean(qualityStack?.hidden),
        qualityOptions,
        lineBefore,
        lineAfter: lineState(),
        geometry,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    item.result = result;
    if (result.rowCount !== 1) {
      const popupState = await evaluate(client, `(() => ({
        readyState: document.readyState,
        rows: document.querySelectorAll("#mediaRows > .row").length,
        mediaState: document.querySelector("#mediaState")?.textContent.trim(),
        empty: document.querySelector("#mediaEmpty")?.hidden,
        body: document.body?.innerText?.replace(/\\s+/g, " ").slice(0, 200)
      }))()`).catch(() => ({}));
      throw new Error(`popup rendered ${result.rowCount} rows for one HLS master | state: ${JSON.stringify(popupState)}`);
    }
    // v1 read the representative URL from .media-url; v2 rows show only the
    // host (mediaSource), so the representative is proven by the row's
    // data-item-id (mediaKey = candidate id) plus the fast master's host.
    assert.equal(result.row.itemId, String(expectedCandidateId), "popup rendered the wrong HLS representative");
    assert.equal(result.row.sourceHost, new URL(expectedUrl).hostname.replace(/^www\./i, ""),
      "popup row does not name the fast-host master as its source");
    // mediaRow adds an overflow only for copyable items; signed fixture URLs
    // are not copyable, so Download is the one action and no parse action exists.
    assert.deepEqual(result.row.actions, ["download"], "stream rows expose an action other than Download");
    assert.equal(result.row.leadImages, 0, "the HLS row shows a thumbnail instead of its type glyph");
    assert.equal(result.dialogOpen, true, "Download did not open the HLS download dialog");
    assert.equal(result.initialFocus, "mediaName", "download dialog did not focus its file name field");
    assert.equal(result.dialogHeading, T("action.download"), "download dialog is not labelled by its title");
    assert.equal(result.dialogDescribedBy, "mediaDialogLine", "download dialog is not described by its status line");
    assert.equal(result.closeLabel, T("action.close"));
    assert.deepEqual(result.labels, { name: T("media.dialog.name"), format: T("media.dialog.format"), quality: T("media.dialog.quality") },
      "download dialog fields lack their visible labels");
    assert.equal(result.row.title, expectedTitle, "HLS row did not use the readable page title");
    assert.equal(result.row.titleText, expectedTitle, "HLS row title is not the full readable title");
    assert.doesNotMatch(result.row.title, /an_PHRM|comp_v\d+|wm_cr|cc\d+/i,
      "HLS row exposes an internal asset-management token");
    const filesystemSafeTitle = result.row.title.replace(/[\\/:*?"<>|]/g, "_");
    assert.equal(result.formatBefore, "mp4", "a stream must open with its container format (media.js defaultFormat)");
    assert.equal(result.filenameBefore, `${filesystemSafeTitle}.mp4`,
      "dialog filename is not the filesystem-safe form of the readable row/page title");
    assert.doesNotMatch(result.filenameBefore, /^[a-f0-9]{20,}\./i, "dialog filename fell back to an opaque asset hash");
    assert.doesNotMatch(result.filenameBefore, /an_PHRM|comp_v\d+|wm_cr|cc\d+/i,
      "dialog filename exposes an internal asset-management token");
    // media.js formatOptions: MP3 is a normal format choice ("MP3 · 仅音频"), enabled while the engine can make it.
    const mp3 = result.formatOptions.find((option) => option.value === "mp3");
    assert.ok(mp3, "MP3 is not a first-class output format");
    assert.equal(mp3.text, `MP3 · ${T("media.format.audioOnly")}`, "MP3 is not labelled as an audio-only format");
    assert.equal(mp3.disabled, false, "MP3 is disabled although no engine has said it cannot convert");
    assert.equal(result.formatOptions.find((option) => option.value === "original")?.disabled, true,
      "a stream offers to keep its original (playlist) format");
    assert.equal(result.filenameAfter, `${filesystemSafeTitle}.mp3`, "choosing MP3 did not update the filename extension");
    assert.equal(result.hasExtractCheckbox, false, "the obsolete extract-audio checkbox is still present");
    assert.equal(result.hasConcurrencyInput, false, "per-download concurrency is still exposed in the popup");
    assert.equal(result.checkboxes, 0, "the download dialog contains a checkbox (v2's one boolean control is the switch)");
    assert.equal(result.numberInputs, 0, "the download dialog exposes a numeric (concurrency) control");
    assert.deepEqual(result.controlIds, ["mediaLink", "mediaName", "mediaFormat", "mediaQuality"],
      "the download dialog must hold only link, file name, format and quality");
    assert.equal(result.primaryButtons, 1, "the download dialog must have exactly one primary action");
    assert.equal(result.qualityHiddenBefore, false, "quality selection stayed hidden for a multi-rendition HLS master");
    assert.equal(result.qualityHiddenAfter, true, "quality selection stayed visible after switching to audio-only MP3");
    assert.equal(result.qualityOptions.length, HLS_RENDITIONS.length + 1,
      "quality selector must contain automatic plus five renditions");
    assert.equal(result.qualityOptions[0].text, T("media.quality.best"), "the first quality is not the automatic best choice");
    assert.equal(result.qualityOptions[0].value, "", "the automatic quality must not pin a rendition");
    for (const rendition of HLS_RENDITIONS) {
      // media.js variantLabel: "1080p · 3.2 Mb/s" (v1 showed width × height).
      assert.ok(result.qualityOptions.some((option) => new RegExp(`^${rendition.height}p(?:\\s·\\s|$)`).test(option.text)),
        `${rendition.height}p rendition is missing`);
    }
    assert.ok(result.qualityOptions.slice(1).every((option) => /^https:\/\/fluxcatch\.invalid\/manifest\/[a-f0-9-]{36}\/[a-f0-9-]{36}$/.test(option.value)),
      "quality choices carry media URLs instead of opaque selectors");
    // v1 showed a helper note about segments; v2 has no helper paragraphs
    // (ui/v2/README.md rules) and its one dialog line states the engine
    // boundary: a fresh profile has no nativeMessaging grant.
    assert.deepEqual(result.lineBefore, { text: T("status.engineNotSetUp"), actions: [T("action.setUp")], role: "status" },
      "the stream dialog does not state that the local engine is not set up");
    assert.deepEqual(result.lineAfter.text, T("status.engineNotSetUp"), "the dialog line changed after choosing MP3");
    const geometry = result.geometry;
    assert.ok(geometry, "download dialog geometry was not measurable");
    assert.equal(geometry.viewportWidth, POPUP_WIDTH, "HLS dialog audit did not run at the popup width");
    assert.equal(geometry.viewportHeight, POPUP_HEIGHT, "HLS dialog audit did not run at the popup height");
    assert.ok(geometry.rootHeight >= POPUP_HEIGHT - 0.5, `the popup did not take its full ${POPUP_HEIGHT}px while the dialog is open`);
    assert.equal(geometry.inside, true, `download dialog is outside the ${POPUP_WIDTH} × ${POPUP_HEIGHT} viewport: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.horizontalDelta <= 2, `download dialog is not horizontally centered: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.verticalDelta <= 2, `download dialog is not vertically centered: ${JSON.stringify(geometry)}`);
    assert.ok(geometry.body && /^(auto|scroll)$/.test(geometry.body.overflowY), `download dialog body does not scroll: ${JSON.stringify(geometry.body)}`);
    assert.equal(geometry.actions?.position, "sticky", "download dialog action row is not sticky");
    assert.equal(geometry.actionsInside, true, `download dialog action row is clipped: ${JSON.stringify(geometry)}`);
    assert.deepEqual(geometry.buttons.map((entry) => [entry.action, entry.kind, entry.type]),
      [["cancel", "btn-tertiary", "button"], ["download", "btn-primary", "submit"]],
      "download dialog actions must be Cancel then the one primary Download");
    assert.ok(geometry.buttons.every((entry) => entry.uncovered), `download dialog actions are covered: ${JSON.stringify(geometry.buttons)}`);
    assert.ok(Number(result.overflow) <= 1, `HLS download dialog has horizontal overflow: ${result.overflow}px`);

    await evaluate(client, `(() => {
      globalThis.__phaseBDownloadDialogFocus = [];
      document.addEventListener("focusin", (event) => { globalThis.__phaseBDownloadDialogFocus.push(event.target?.id || event.target?.dataset?.mediaAction || event.target?.localName || "unknown"); }, { capture: true });
      return true;
    })()`);
    await client.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await client.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await poll(async () => {
      const value = await evaluate(client, `(() => ({
        dialogOpen: document.querySelector("#downloadDialog").open,
        activeAction: document.activeElement?.dataset?.mediaAction || "",
        activeMediaId: document.activeElement?.dataset?.mediaId || ""
      }))()`);
      return !value.dialogOpen ? value : null;
    }, CASE_TIMEOUT_MS, "download dialog focus restoration");
    await delay(250);
    const restoredFocus = await evaluate(client, `(() => ({
      dialogOpen: document.querySelector("#downloadDialog").open,
      returnValue: document.querySelector("#downloadDialog").returnValue,
      activeId: document.activeElement?.id || "",
      activeAction: document.activeElement?.dataset?.mediaAction || "",
      activeMediaId: document.activeElement?.dataset?.mediaId || "",
      focusEvents: globalThis.__phaseBDownloadDialogFocus,
      downloadActions: [...document.querySelectorAll('[data-media-action="download"]')].map((node) => ({ connected: node.isConnected, disabled: node.disabled, id: node.dataset.mediaId }))
    }))()`);
    assert.equal(restoredFocus.activeAction, "download", `closing download dialog did not restore focus to the media action: ${JSON.stringify(restoredFocus)}`);
    assert.equal(restoredFocus.activeMediaId, String(expectedCandidateId), "closing the dialog focused another row's Download");
    assert.equal(restoredFocus.returnValue, "cancel", "Escape must close the dialog as a cancel (controls.js dialogShell)");
    await evaluate(client, `document.querySelector('#mediaRows > .row [data-media-action="download"]').click()`);
    await poll(async () => await evaluate(client, `document.querySelector("#downloadDialog").open`), CASE_TIMEOUT_MS, "reopened download dialog for visual evidence");

    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, "hls-download-dialog.png");
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    item.screenshot = path.relative(HERE, screenshotPath);
    await captureMatrixState(client, "download-dialog", POPUP_WIDTH, POPUP_HEIGHT, {
      dialog: "HLS multi-rendition settings",
      centered: true,
      fitsPopup: geometry.inside,
      actionRowVisible: geometry.actionsInside,
      keyboardFocusRestored: restoredFocus.activeAction === "download"
    });
    item.status = "passed";
  } catch (error) {
    item.status = "failed";
    item.error = serializeError(error);
    throw error;
  } finally {
    client?.close();
    if (targetId) {
      try { await browser.send("Target.closeTarget", { targetId }); } catch { /* Best-effort UI flow cleanup. */ }
    }
  }
}

async function auditPopupManifestLoading(devtoolsOrigin) {
  const item = { name: "popup-manifest-loading", status: "running", viewport: { width: POPUP_WIDTH, height: POPUP_HEIGHT } };
  report.flows.push(item);
  const fixtureId = `${runId}-manifest-loading`;
  const fixture = hlsFixtureUrls(fixtureId, { delayMs: 1200 });
  // Keep this interaction fixture to one observed master. The broader HLS
  // detection fixture deliberately observes rendition playlists too, which
  // starts the worker's background alias-inspection queue. Measuring the
  // popup request while that queue is still draining makes a legitimate
  // automatic probe look like a duplicate click. This flow is specifically
  // responsible for proving that two synchronous clicks collapse to one
  // user-initiated master request, so isolate that single causal request.
  const pageQuery = new URLSearchParams({
    run: fixtureId,
    master: fixture.master,
    caption: fixture.caption
  });
  const pageUrl = `${serverOrigin}/cases/hls.html?${pageQuery}`;
  const requestKey = fixtureRequestKey(new URL(fixture.master));
  let tabId;
  let popup;
  try {
    const tab = await control(`async () => chrome.tabs.create({ url: ${JSON.stringify(pageUrl)}, active: true })`);
    tabId = tab?.id;
    assert.ok(Number.isInteger(tabId), "manifest-loading fixture did not create a real tab");
    await waitForTabComplete(tabId, pageUrl, CASE_TIMEOUT_MS);
    await poll(async () => {
      const response = await control(`async () => chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: ${JSON.stringify(tabId)} })`);
      if (!response?.ok) throw new Error(response?.error || "GET_TAB_MEDIA failed for manifest-loading fixture");
      return response.items?.some((candidate) => candidate.kind === "hls"
        && candidate.displayUrl === publicDisplayUrl(fixture.master)) ? true : null;
    }, CASE_TIMEOUT_MS, "manifest-loading HLS candidate");
    const initialRequestCount = fixtureRequestCounts.get(requestKey) || 0;
    assert.ok(initialRequestCount >= 1, "fixture page did not make an initial HLS master request");

    popup = await openExtensionTarget("popup/popup.html", devtoolsOrigin, "manifest-loading popup");
    await setViewport(popup.client, POPUP_WIDTH, POPUP_HEIGHT);
    // v1: the card went aria-busy, its button aria-busy and disabled, and a
    // card-local .manifest-status said it was reading. v2 media.js mediaRow:
    // the row and its Download are aria-busy and the row's meta line reads
    // media.reading; the button stays enabled on purpose ("busy, not
    // disabled", so focus survives the re-render), so both clicks arrive and
    // the dialog's single flight (createMediaDialog prepare) drops the second.
    const loading = await poll(async () => {
      const value = await evaluate(popup.client, `(() => {
        const rows = document.querySelectorAll("#mediaRows:not([hidden]) > .row");
        const row = rows[0];
        const button = row?.querySelector('[data-media-action="download"]');
        if (rows.length !== 1 || !button) return null;
        if (!globalThis.__phaseBManifestStarted) {
          globalThis.__phaseBManifestStarted = true;
          globalThis.__phaseBManifestClickEvents = 0;
          button.addEventListener("click", () => { globalThis.__phaseBManifestClickEvents += 1; });
          button.click();
          button.click();
        }
        const current = document.querySelector("#mediaRows > .row");
        const currentButton = current?.querySelector('[data-media-action="download"]');
        return {
          rowCount: document.querySelectorAll("#mediaRows > .row").length,
          rowBusy: current?.getAttribute("aria-busy"),
          buttonBusy: currentButton?.getAttribute("aria-busy"),
          buttonDisabled: Boolean(currentButton?.disabled),
          meta: current?.querySelector(".row-meta")?.textContent.trim() || "",
          clickEvents: globalThis.__phaseBManifestClickEvents,
          dialogOpen: document.querySelector("#downloadDialog").open,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })()`);
      return value?.rowBusy === "true" ? value : null;
    }, CASE_TIMEOUT_MS, "row-local manifest loading state");
    assert.equal(loading.rowCount, 1, "manifest-loading popup rendered duplicate rows");
    assert.equal(loading.buttonBusy, "true", "manifest-loading action did not expose aria-busy");
    assert.equal(loading.buttonDisabled, false, "v2 keeps the busy Download enabled so keyboard focus survives the re-render");
    assert.equal(loading.clickEvents, 2, "both synchronous clicks must reach the busy Download (single flight drops the second)");
    assert.equal(loading.meta, T("media.reading"), "manifest loading feedback is not local to the media row");
    assert.equal(loading.dialogOpen, false, "download dialog opened before manifest reading completed");
    assert.ok(loading.overflow <= 1, `manifest-loading popup overflows by ${loading.overflow}px`);
    const loadingRequestCount = await poll(async () => {
      const count = fixtureRequestCounts.get(requestKey) || 0;
      return count === initialRequestCount + 1 ? count : null;
    }, CASE_TIMEOUT_MS, "one user-initiated manifest probe request");
    assert.equal(loadingRequestCount - initialRequestCount, 1, "manifest double-click did not collapse to one probe request");
    await captureMatrixState(popup.client, "popup-manifest-loading", POPUP_WIDTH, POPUP_HEIGHT, {
      localRowBusy: true,
      duplicateClicksSuppressed: true,
      hlsMasterRequestsBeforePopup: initialRequestCount,
      hlsMasterRequestsDuringProbe: loadingRequestCount - initialRequestCount
    });
    const settled = await poll(async () => {
      const value = await evaluate(popup.client, `(() => ({
        open: document.querySelector("#downloadDialog").open,
        rowBusy: document.querySelector("#mediaRows > .row")?.getAttribute("aria-busy"),
        buttonBusy: document.querySelector('#mediaRows > .row [data-media-action="download"]')?.getAttribute("aria-busy")
      }))()`);
      return value.open ? value : null;
    }, CASE_TIMEOUT_MS, "manifest-loading popup to settle");
    assert.equal(settled.rowBusy, null, "media row remained aria-busy after manifest reading");
    assert.equal(settled.buttonBusy, null, "media row Download remained aria-busy after manifest reading");
    const finalRequestCount = fixtureRequestCounts.get(requestKey) || 0;
    assert.equal(finalRequestCount - initialRequestCount, 1,
      `manifest-loading flow made duplicate master requests: ${initialRequestCount} -> ${finalRequestCount}`);
    item.result = { loading, settled, initialRequestCount, probeRequestCount: finalRequestCount - initialRequestCount };
    item.screenshot = report.visualMatrix.find((entry) => entry.name === "popup-manifest-loading")?.screenshot;
    item.status = "passed";
  } catch (error) {
    item.status = "failed";
    item.error = serializeError(error);
    throw error;
  } finally {
    if (popup) await closeExtensionTarget(popup);
    if (Number.isInteger(tabId)) {
      try { await control(`async () => { await chrome.tabs.remove(${JSON.stringify(tabId)}); return true; }`); } catch { /* Best-effort fixture cleanup. */ }
    }
  }
}

async function prepareUiFixtureTab() {
  const pageUrl = `${serverOrigin}/cases/direct.html?run=${encodeURIComponent(`${runId}-ui`)}`;
  const expectedUrl = publicDisplayUrl(`${serverOrigin}/media/direct.mp4?run=${encodeURIComponent(`${runId}-ui`)}`);
  const expectedThumbnailUrl = publicDisplayUrl(`${serverOrigin}/media/poster.png?run=${encodeURIComponent(`${runId}-ui`)}`);
  const tab = await control(`async () => chrome.tabs.create({ url: ${JSON.stringify(pageUrl)}, active: true })`);
  assert.ok(Number.isInteger(tab?.id), "UI fixture did not create an active tab");
  await waitForTabComplete(tab.id, pageUrl, CASE_TIMEOUT_MS);
  const candidate = await poll(async () => {
    const response = await control(`async () => chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: ${JSON.stringify(tab.id)} })`);
    if (!response?.ok) throw new Error(response?.error || "GET_TAB_MEDIA failed for UI fixture");
    return response.items?.find((item) => item.kind === "video"
      && item.displayUrl === expectedUrl
      && item.thumbnailUrl === expectedThumbnailUrl
      && item.thumbnailSource === "poster") || null;
  }, CASE_TIMEOUT_MS, "direct candidate for Side Panel quick download");
  return {
    tabId: tab.id,
    expectedThumbnailUrl,
    // fixtureRequestKey() of the page's poster: counted to prove no surface fetches it.
    posterRequestKey: fixtureRequestKey(new URL(`${serverOrigin}/media/poster.png?run=${encodeURIComponent(`${runId}-ui`)}`)),
    candidate: { id: candidate.id, kind: candidate.kind, generation: candidate.generation }
  };
}

async function auditGenericNativeBoundary(uiFixture, downloadDir) {
  const item = { name: "generic-native-preflight", status: "running" };
  report.flows.push(item);
  try {
    const result = await control(`async () => {
      const before = await chrome.runtime.sendMessage({ type: "GET_JOBS" });
      const response = await chrome.runtime.sendMessage({
        type: "DOWNLOAD",
        tabId: ${JSON.stringify(uiFixture.tabId)},
        candidate: ${JSON.stringify(uiFixture.candidate)},
        options: { outputContainer: "original", outputFormat: "original", convert: false, extractAudio: false }
      });
      const after = await chrome.runtime.sendMessage({ type: "GET_JOBS" });
      return { before, response, after };
    }`);
    assert.equal(result.before?.ok, true, "GET_JOBS failed before native-boundary assertion");
    assert.equal(result.response?.ok, false, "generic observed media bypassed the native policy broker");
    assert.match(result.response?.error || "", /授权|本地引擎|高速下载/,
      "generic observed media did not report the native authorization boundary");
    // v2 worker contract (ui/v2/README.md "Worker notes"): every { ok: false }
    // carries a FAILURE_CODES code; background.js throws engine_not_set_up here.
    assert.equal(result.response?.code, "engine_not_set_up", "the native authorization failure lost its v2 failure code");
    assert.equal(result.after?.ok, true, "GET_JOBS failed after native-boundary assertion");
    assert.deepEqual(result.after.jobs, result.before.jobs, "failed native preflight mutated the task list");
    assert.equal(walk(downloadDir, 5).some((value) => path.basename(value) === UI_DIRECT_FILENAME), false,
      "failed native preflight wrote a browser download");
    item.result = {
      response: { ok: result.response.ok, error: result.response.error, code: result.response.code },
      jobsUnchanged: true,
      wroteBrowserFile: false
    };
    item.status = "passed";
  } catch (error) {
    item.status = "failed";
    item.error = serializeError(error);
    throw error;
  }
}

async function auditExistingExtensionPage(name, client, width, height, expression) {
  return auditExtensionPage(name, client, width, height, expression, false);
}

async function auditNewExtensionPage(name, relativePath, width, height, expression, devtoolsOrigin) {
  let targetId;
  let client;
  try {
    ({ targetId } = await browser.send("Target.createTarget", {
      url: `chrome-extension://${EXPECTED_EXTENSION_ID}/${relativePath}`,
      background: true
    }));
    const target = await waitForTarget(
      devtoolsOrigin,
      (candidate) => candidate.id === targetId && candidate.type === "page",
      START_TIMEOUT_MS,
      `${name} extension page`
    );
    client = await CdpClient.connect(target.webSocketDebuggerUrl);
    await client.send("Runtime.enable");
    return await auditExtensionPage(name, client, width, height, expression, true);
  } finally {
    client?.close();
    if (targetId) {
      try { await browser.send("Target.closeTarget", { targetId }); } catch { /* Best-effort UI target cleanup. */ }
    }
  }
}

async function auditExtensionPage(name, client, width, height, expression, closeAfter) {
  const item = { name, status: "running", viewport: { width, height } };
  report.ui.push(item);
  try {
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: 1,
      mobile: false
    });
    await poll(async () => await evaluate(client, "document.readyState === 'complete'"), CASE_TIMEOUT_MS, `${name} DOM ready`);
    await delay(250);
    // Bringing the synthetic Side Panel tab to the foreground would make it
    // the active content tab and cause its own tabs.onActivated listener to
    // replace the fixture state.
    if (name !== "sidepanel") await client.send("Page.bringToFront");
    const result = await evaluate(client, expression);
    item.result = result;
    await delay(250);
    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, CASE_TIMEOUT_MS * 2);
    assert.equal(result?.title?.includes("FluxCatch"), true, `${name} title does not contain FluxCatch`);
    assert.ok(Number(result?.overflow) <= 1, `${name} has horizontal overflow: ${result?.overflow}px`);
    if (name === "options") {
      assert.equal(result.title, `${T("settings.title")} · ${T("brand.name")}`);
      assert.equal(result.heading, T("settings.title"));
      assert.equal(result.saveControls, 0, "v2 Settings autosaves; the v1 Save button, save bar and dirty status must be gone");
      assert.deepEqual(result.unlabelled, [], "Settings contains a field, select or switch not named by its setting row's <label for>");
      assert.equal(result.nativePermissionGranted, false, "fresh E2E profile unexpectedly has nativeMessaging permission");
      // options/form-state.js engineState without the permission: "Not set up",
      // Set up, and the queued (harbour) tone every other surface gives it
      // (v2 first used the warning tone here).
      assert.equal(result.engineAction, T("action.setUp"), "ungranted engine row does not offer Set up");
      assert.equal(result.engineActionKind, "setUp");
      assert.equal(result.engineStatus, T("settings.engine.notSetUp"));
      assert.equal(result.engineTone, "queued", "Settings' Not set up must use the harbour (queued) tone, as on the popup and side panel");
      assert.equal(result.engineDescription, T("settings.engine.descNotSetUp"));
      // The #row-statusEngine mirror was removed: the engine has one row, in Status.
      assert.equal(result.engineSection, "status", "the engine row is not in the Status section");
      assert.equal(result.statusMirror, false, "Settings still shows a second (mirrored) engine row");
      // Merging needs the engine, so until it is Ready the row shows the engine's own state, not "Not yet".
      assert.deepEqual([result.merge, result.mergeTone], [T("settings.engine.notSetUp"), "queued"],
        "the merging row does not show the engine's state before the engine is ready");
      assert.deepEqual(result.useNative, { checked: "false", disabled: true },
        "the Instagram/X engine switch can be turned on although the engine is not ready");
      assert.equal(result.saveAsDisabled, false, "Ask where to save is disabled although Chrome saves Instagram/X videos");
      assert.equal(result.installOpen, false, "ungranted native access should not open the engine installation steps");
      assert.deepEqual(result.deadControls, [], "stable options still exposes unavailable controls");
      assert.deepEqual(result.externalToolControls, [], "stable Settings exposes a YouTube, yt-dlp or live-stream control");
      // options.js buildCapabilities: nine rows in #capabilities (v2 folds
      // static HLS and DASH into "Streaming video" and adds Copy-protected
      // video). Without the engine, what the engine saves reads "Not set up"
      // (the engine row's word and tone), never "Yes" (v2 first said Yes).
      assert.deepEqual(result.capabilities, expectedCapabilityRows({ label: T("settings.engine.notSetUp"), tone: "queued" }),
        "Settings capability rows differ from the stable build profile without the engine");
      assert.equal(result.lanSwitch, "false", "the home-network switch must default to off");
      assert.equal(result.networkValue, T("settings.off"), "the Status section must report the home network as off by default");
    } else if (name === "popup") {
      assert.equal(result.title, T("brand.name"));
      assert.equal(result.surface, "popup");
      assert.equal(result.wordmark, T("brand.name"), "popup lost its BrandMark wordmark");
      assert.equal(result.workspaceButton, T("popup.openWorkspace"));
      assert.equal(result.historyButton, T("media.allDownloads"));
      assert.equal(result.urlButtonLabel, T("media.downloadLink"));
      assert.equal(result.settingsButtonLabel, T("action.settings"));
      // controls.js segmented (tablist) with popup.js data-view and tab ids.
      assert.equal(result.tablistLabel, T("popup.views"));
      assert.deepEqual(result.tabs, [
        { role: "tab", view: "media", id: "tab-media", controls: "mediaView" },
        { role: "tab", view: "downloads", id: "tab-downloads", controls: "downloadsView" }
      ], "popup views are not a Media | Downloads tablist");
      assert.deepEqual(result.panels, [
        { id: "mediaView", role: "tabpanel", labelledBy: "tab-media" },
        { id: "downloadsView", role: "tabpanel", labelledBy: "tab-downloads" }
      ], "popup view panels are not labelled by their tabs");
      const { afterClick, afterArrow, afterHome } = result.tabBehaviour;
      assert.deepEqual([afterClick.selected, afterClick.mediaHidden, afterClick.downloadsHidden], ["downloads", true, false],
        "popup Downloads tab did not activate");
      assert.deepEqual([afterArrow.selected, afterArrow.active, afterArrow.downloadsHidden, afterArrow.tabIndexes],
        ["downloads", "tab-downloads", false, [-1, 0]], "ArrowRight did not move the roving tab stop to Downloads");
      assert.deepEqual([afterHome.selected, afterHome.active, afterHome.mediaHidden, afterHome.tabIndexes],
        ["media", "tab-media", false, [0, -1]], "Home did not reactivate the Media tab");
      assert.equal(result.filterLabel, T("media.filter.label"), "the media type filter is unlabelled");
      // The filter filters whichever list is shown (v2 first left it on the
      // media list only): on an empty Downloads list it rests on All types,
      // disabled; back on Media, with rows, it works again.
      assert.equal(afterClick.jobsShown, 0, "the fresh profile unexpectedly lists downloads in the popup");
      assert.deepEqual(afterClick.jobsEmpty, { hidden: false, sentence: T("media.downloads.empty"), body: T("media.downloads.emptyBody") },
        "the popup's empty Downloads view lost its sentence or its body line");
      assert.deepEqual(afterClick.filter, { value: "all", disabled: true },
        "the type filter does not rest on All types, disabled, over an empty Downloads list");
      assert.deepEqual(afterHome.filter, { value: "all", disabled: false }, "the type filter is not usable over the media rows");
      assert.deepEqual(result.mediaHeader, {
        hidden: false,
        title: T("media.listTitle"),
        meta: "",
        actions: [{ action: "rescan", hidden: false }, { action: "more", hidden: false }]
      }, "the popup list header must read media.listTitle with Rescan and the overflow as its only actions");
      const expectedOverflow = [
        ...(result.rows.length >= 2 ? [{ label: T("media.downloadAll"), tone: "" }] : []),
        { label: T("media.clearResults"), tone: "destructive" }
      ];
      assert.deepEqual(result.overflowMenu, { open: true, role: "menu", items: expectedOverflow, closed: true },
        "the popup overflow must hold Download all (two or more items) and the destructive Clear results, and close on Escape");
      assertEngineLineNotSetUp(result.engineLine, "popup");
      assertGlyphRows(result, "video", "popup");
      assertRescanPending(result.rescan, "popup");
      assertV2Styles(result.sharedStyles, ["/ui/v2/tokens.css", "/ui/v2/system.css", "/ui/v2/media.css", "/popup/popup.css"], "popup");
    } else if (name === "sidepanel") {
      assert.equal(result.title, `${T("sidepanel.title")} · ${T("brand.name")}`);
      assert.equal(result.surface, "sidepanel");
      assert.equal(result.wordmark, T("brand.name"), "Side Panel lost its BrandMark wordmark");
      assert.equal(result.mediaHeading, T("media.listTitle"));
      // sidepanel.js renderMedia: the header names the page host only while the
      // list is empty (rows carry their own host); v2 first always showed it.
      assert.ok(result.rows.length >= 1, "Side Panel rendered no media row");
      assert.equal(result.mediaHeadingMeta, "", "Side Panel media header still names the page host while media rows exist");
      // With results Rescan is a header tertiary (the empty state carries it
      // otherwise); the overflow (Download all) appears for two or more items.
      assert.deepEqual(result.mediaHeader.actions, [{ action: "rescan", hidden: false }, { action: "more", hidden: result.rows.length < 2 }],
        "Side Panel media header actions do not match its results");
      // sidepanel.html: the engine's one status line is the first child of #page, above both lists.
      assert.equal(result.engineLineFirst, "engineLine", "the Side Panel engine line is not above the lists");
      assert.equal(result.downloadsHeading, T("sidepanel.downloadsTitle"));
      assert.deepEqual(result.sections, [
        { id: "mediaSection", labelledBy: "mediaHeading" },
        { id: "downloadsSection", labelledBy: "downloadsHeading" }
      ], "Side Panel sections are not labelled by their list headers");
      // Clear finished is hidden, not disabled, until something has ended
      // (v2 first kept it visible and disabled); this fresh profile has no downloads.
      assert.equal(result.jobsShown, 0, "the fresh profile unexpectedly lists downloads in the Side Panel");
      assert.deepEqual(result.jobsEmpty, { hidden: false, sentenceShown: false, body: T("media.downloads.emptyBody") },
        "the Side Panel's empty Downloads section must be its one body line, without a Display sentence");
      assert.deepEqual(result.downloadsActions, [{ action: "history", hidden: false }, { action: "clear-finished", hidden: true }],
        "Side Panel Downloads header must keep All downloads and hide Clear finished while nothing has ended");
      assertEngineLineNotSetUp(result.engineLine, "Side Panel");
      // v1: a quick "检查并下载" action described by #localEngineBoundary. v2:
      // the row's tertiary Download (media.js mediaRow) opens the shared
      // dialog, whose one line states the engine boundary for generic media.
      assert.ok(result.quickDownload.count >= 1, "Side Panel did not render a Download action for the detected media");
      assert.equal(result.quickDownload.label, T("action.download"));
      assert.equal(result.quickDownload.kind, "btn-tertiary", "the row Download must be tertiary (one primary per view)");
      assert.ok(result.quickDownload.title && result.quickDownload.title !== T("media.untitled"), "the direct media row has no readable title");
      assert.equal(result.quickDownload.ariaLabel, T("media.downloadFor", { name: result.quickDownload.title }),
        "the row Download is not named for its media");
      assert.equal(result.dialog.open, true, "the row Download did not open the download dialog");
      assert.deepEqual(result.dialog.line, { hidden: false, tone: "", text: T("status.engineNotSetUp"), actions: [T("action.setUp")] },
        "generic direct media did not show the native-engine boundary in the dialog");
      assert.equal(result.dialog.format, "original", "a direct file must open in its original format");
      assert.equal(result.dialogClosed, true, "Cancel did not close the download dialog");
      assert.equal(result.quickDownloadCreatedJob, false, "opening the generic direct dialog created a job without native authorization");
      assertGlyphRows(result, "video", "Side Panel");
      assert.equal(result.errorToasts, 0, "Side Panel reported an error toast");
      assert.ok(result.liveRegions >= 2, "Side Panel lost its polite announcer or toast region");
      assert.ok(result.statusRegions >= 4, "Side Panel lost its status lines (engine, media, downloads, announcer)");
      assertRescanPending(result.rescan, "Side Panel");
      assertV2Styles(result.sharedStyles, ["/ui/v2/tokens.css", "/ui/v2/system.css", "/ui/v2/media.css", "/sidepanel/sidepanel.css"], "Side Panel");
    }
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    item.screenshot = path.relative(HERE, screenshotPath);
    if (name === "popup") {
      await captureMatrixState(client, "popup-372x600", POPUP_WIDTH, POPUP_HEIGHT, {
        deterministicFixture: "direct media",
        v2Styles: true
      });
    } else if (name === "sidepanel") {
      await captureMatrixState(client, "sidepanel-420x820", 420, 820, {
        deterministicFixture: "generic direct media awaiting explicit native authorization",
        v2Styles: true
      });
      await evaluate(client, `(async () => {
        document.querySelector('#mediaRows > .row [data-media-action="download"]')?.click();
        const deadline = Date.now() + ${CASE_TIMEOUT_MS};
        while (!document.querySelector("#downloadDialog")?.open && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
        return document.querySelector("#downloadDialog")?.open;
      })()`);
      try {
        await captureMatrixState(client, "sidepanel-download-dialog", 420, 820, {
          dialog: "generic direct media",
          line: result.dialog.line.text
        });
      } finally {
        await evaluate(client, `document.querySelector('#downloadDialog .dialog-actions [data-action="cancel"]')?.click()`);
      }
    }
    item.status = "passed";
    return item;
  } catch (error) {
    item.status = "failed";
    item.error = serializeError(error);
    throw error;
  } finally {
    if (closeAfter) {
      // The caller owns the page target/client and performs cleanup.
    }
  }
}

// In-page helpers shared by the popup and side panel audits (both built from
// ui/v2/media.js). Rows are rows.js downloadRow: span.row-lead (a 20px glyph
// from components.js icon() when poster: false) · div.row-main (filename,
// plain-text .row-meta, .row-source) · div.row-trail (.row-actions).
function surfaceProbeHelpers() {
  return `
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const deadline = Date.now() + ${CASE_TIMEOUT_MS};
    const { icon } = await import(chrome.runtime.getURL("ui/v2/components.js"));
    const glyphPaths = Object.fromEntries(["video", "audio", "stream"].map((kind) => [kind, icon(kind).innerHTML]));
    const lineOf = (element) => ({
      hidden: Boolean(element?.hidden),
      tone: element?.dataset.tone ?? null,
      text: element?.querySelector(".line-text > span")?.textContent.trim() || "",
      actions: [...(element?.querySelectorAll(".line-actions .btn") || [])].map((node) => node.textContent.trim())
    });
    const rowsOf = () => [...document.querySelectorAll("#mediaRows > .row")].map((row) => {
      const lead = row.querySelector(".row-lead");
      const svg = lead?.querySelector(":scope > svg");
      const svgRect = svg?.getBoundingClientRect();
      const meta = row.querySelector(".row-meta");
      return {
        leadChildren: [...(lead?.children || [])].map((node) => node.localName),
        glyph: Object.entries(glyphPaths).find(([, paths]) => svg && svg.innerHTML === paths)?.[0] || null,
        glyphSize: svgRect ? [Math.round(svgRect.width), Math.round(svgRect.height)] : null,
        images: row.querySelectorAll("img").length,
        chips: row.querySelectorAll('.chip, [class*="chip"], [data-chip]').length,
        metaElements: meta ? meta.children.length : -1,
        meta: meta?.textContent.trim() || "",
        title: row.querySelector(".row-title .filename")?.dataset.filename || "",
        actions: [...row.querySelectorAll(".row-actions button")].map((node) => node.dataset.mediaAction || node.dataset.action || "")
      };
    });
    const remoteImages = () => [...document.images].map((image) => image.currentSrc || image.src).filter((src) => /^https?:/i.test(src));
    const posterLoads = () => performance.getEntriesByType("resource")
      .filter((entry) => /\\/media\\/poster\\.png/.test(entry.name) || (entry.initiatorType === "img" && /^https?:/i.test(entry.name)))
      .map((entry) => entry.name);
    const sheets = () => [...document.styleSheets].map((sheet) => new URL(sheet.href).pathname);
    const overflow = () => document.documentElement.scrollWidth - document.documentElement.clientWidth;
    // components.js listHeader: h2.list-title (title span, count, meta) and .list-actions.
    const headerOf = (slot) => {
      const header = document.querySelector(slot + " .list-header");
      return {
        hidden: Boolean(header?.closest("[hidden]")),
        title: header?.querySelector(".list-title > span:first-child")?.textContent.trim() || "",
        meta: header?.querySelector(".list-meta")?.textContent.trim() || "",
        actions: [...(header?.querySelectorAll(".list-actions > button") || [])].map((node) => ({ action: node.dataset.action || "", hidden: node.hidden }))
      };
    };
    // components.js runAction: aria-busy and disabled while the task runs, the label never changes.
    const rescanPending = async () => {
      const rescan = document.querySelector('#mediaHeaderSlot [data-action="rescan"]');
      const label = rescan?.textContent.trim() || "";
      rescan?.click();
      rescan?.click();
      const pending = { busy: rescan?.getAttribute("aria-busy") ?? null, disabled: Boolean(rescan?.disabled), label: rescan?.textContent.trim() || "" };
      while (rescan?.getAttribute("aria-busy") === "true" && Date.now() < deadline) await sleep(50);
      return { label, pending, settled: { busy: rescan?.getAttribute("aria-busy") ?? null, disabled: Boolean(rescan?.disabled) } };
    };
  `;
}

function popupAuditExpression() {
  return `(async () => {
    ${surfaceProbeHelpers()}
    while (!document.querySelector("#mediaRows:not([hidden]) > .row") && Date.now() < deadline) await sleep(50);
    const rescan = await rescanPending();
    // popup.js buildChrome: the side panel's header (media.listTitle, v2 first
    // used popup.listTitle) with Rescan as its one visible action and one
    // overflow holding Download all (two or more shown items) and Clear results.
    const mediaHeader = headerOf("#mediaHeaderSlot");
    document.querySelector('#mediaHeaderSlot [data-action="more"]')?.click();
    const overflowMenu = {
      open: !document.querySelector("#menuLayer").hidden,
      role: document.querySelector("#menuLayer .menu")?.getAttribute("role") || "",
      items: [...document.querySelectorAll("#menuLayer .menu .menu-item")].map((node) => ({
        label: node.querySelector("span")?.textContent.trim() || "",
        tone: node.dataset.tone || ""
      }))
    };
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    overflowMenu.closed = document.querySelector("#menuLayer").hidden;
    const mediaTab = document.querySelector("#tab-media");
    const downloadsTab = document.querySelector("#tab-downloads");
    const filterControl = () => document.querySelector("#filterSelect");
    const tabState = () => ({
      selected: document.querySelector('#viewBar [role="tab"][aria-selected="true"]')?.dataset.view || "",
      active: document.activeElement?.id || "",
      mediaHidden: document.querySelector("#mediaView").hidden,
      downloadsHidden: document.querySelector("#downloadsView").hidden,
      tabIndexes: [mediaTab, downloadsTab].map((node) => node?.tabIndex),
      // popup.js renderFilter: the type filter describes the list under it.
      filter: { value: filterControl()?.value || "", disabled: Boolean(filterControl()?.disabled) },
      jobsShown: document.querySelectorAll("#jobRows > .row").length,
      // popup.js renderJobsState: no downloads keeps the Display sentence and its body line.
      jobsEmpty: (() => {
        const node = document.querySelector("#jobsEmpty");
        return {
          hidden: Boolean(node?.closest("[hidden]")),
          sentence: node?.querySelector(".t-empty")?.textContent.trim() || "",
          body: node?.querySelector(".t-body")?.textContent.trim() || ""
        };
      })()
    });
    downloadsTab?.click();
    const afterClick = tabState();
    mediaTab?.click();
    mediaTab?.focus();
    mediaTab?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    const afterArrow = tabState();
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true, cancelable: true }));
    const afterHome = tabState();
    document.activeElement?.blur?.();
    const tablist = document.querySelector('#viewBar [role="tablist"]');
    return {
      title: document.title,
      surface: document.documentElement.dataset.surface || "",
      wordmark: document.querySelector("#topbarInner .t-wordmark")?.textContent.trim() || "",
      workspaceButton: document.querySelector("#workspaceButton")?.textContent.trim() || "",
      historyButton: document.querySelector("#historyButton")?.textContent.trim() || "",
      urlButtonLabel: document.querySelector("#urlButton")?.getAttribute("aria-label") || "",
      settingsButtonLabel: document.querySelector("#settingsButton")?.getAttribute("aria-label") || "",
      tablistLabel: tablist?.getAttribute("aria-label") || "",
      tabs: [...(tablist?.querySelectorAll("button") || [])].map((node) => ({
        role: node.getAttribute("role"), view: node.dataset.view, id: node.id, controls: node.getAttribute("aria-controls")
      })),
      panels: ["mediaView", "downloadsView"].map((id) => {
        const node = document.getElementById(id);
        return { id, role: node?.getAttribute("role"), labelledBy: node?.getAttribute("aria-labelledby") };
      }),
      tabBehaviour: { afterClick, afterArrow, afterHome },
      mediaHeader,
      overflowMenu,
      filterLabel: document.querySelector("#filterSelect")?.getAttribute("aria-label") || "",
      engineLine: lineOf(document.querySelector("#engineLine")),
      rows: rowsOf(),
      remoteImages: remoteImages(),
      posterLoads: posterLoads(),
      rescan,
      sharedStyles: sheets(),
      overflow: overflow()
    };
  })()`;
}

function sidepanelAuditExpression() {
  return `(async () => {
    ${surfaceProbeHelpers()}
    const downloadSelector = '#mediaRows:not([hidden]) > .row [data-media-action="download"]';
    while (!document.querySelector(downloadSelector) && Date.now() < deadline) await sleep(50);
    const rescan = await rescanPending();
    while (!document.querySelector(downloadSelector) && Date.now() < deadline) await sleep(50);
    const button = document.querySelector(downloadSelector);
    const row = button?.closest(".row");
    const quickDownload = {
      count: document.querySelectorAll('#mediaRows [data-media-action="download"]').length,
      label: button?.querySelector("span")?.textContent.trim() || "",
      ariaLabel: button?.getAttribute("aria-label") || "",
      title: row?.querySelector(".row-title .filename")?.dataset.filename || "",
      kind: [...(button?.classList || [])].find((name) => name.startsWith("btn-")) || ""
    };
    button?.click();
    const dialog = document.querySelector("#downloadDialog");
    while (!dialog?.open && Date.now() < deadline) await sleep(50);
    const dialogState = {
      open: Boolean(dialog?.open),
      line: lineOf(document.querySelector("#mediaDialogLine")),
      format: document.querySelector("#mediaFormat")?.value || ""
    };
    dialog?.querySelector('.dialog-actions [data-action="cancel"]')?.click();
    while (dialog?.open && Date.now() < deadline) await sleep(50);
    const jobsResponse = await chrome.runtime.sendMessage({ type: "GET_JOBS" });
    const heading = (id) => document.querySelector("#" + id + " > span:first-child")?.textContent.trim() || "";
    return {
      title: document.title,
      surface: document.documentElement.dataset.surface || "",
      wordmark: document.querySelector("#topbarInner .t-wordmark")?.textContent.trim() || "",
      mediaHeading: heading("mediaHeading"),
      mediaHeadingMeta: document.querySelector("#mediaHeading .list-meta")?.textContent.trim() || "",
      mediaHeader: headerOf("#mediaHeaderSlot"),
      downloadsHeading: heading("downloadsHeading"),
      sections: ["mediaSection", "downloadsSection"].map((id) => ({ id, labelledBy: document.getElementById(id)?.getAttribute("aria-labelledby") })),
      downloadsActions: headerOf("#downloadsHeaderSlot").actions,
      jobsShown: document.querySelectorAll("#jobRows > .row").length,
      // sidepanel.js buildChrome: no downloads is one body line, never a second Display sentence.
      jobsEmpty: (() => {
        const node = document.querySelector("#jobsEmpty");
        const sentence = node?.querySelector(".t-empty");
        return {
          hidden: Boolean(node?.closest("[hidden]")),
          sentenceShown: Boolean(sentence && !sentence.hidden && sentence.textContent.trim()),
          body: node?.querySelector(".t-body")?.textContent.trim() || ""
        };
      })(),
      engineLineFirst: document.querySelector("#page")?.firstElementChild?.id || "",
      engineLine: lineOf(document.querySelector("#engineLine")),
      quickDownload,
      dialog: dialogState,
      dialogClosed: !dialog?.open,
      quickDownloadCreatedJob: Boolean(jobsResponse?.jobs?.find((item) => item.filename === ${JSON.stringify(UI_DIRECT_FILENAME)})),
      rows: rowsOf(),
      errorToasts: document.querySelectorAll('#toastRegion .toast[data-tone="error"]').length,
      liveRegions: document.querySelectorAll('[aria-live="polite"]').length,
      statusRegions: document.querySelectorAll('[role="status"]').length,
      remoteImages: remoteImages(),
      posterLoads: posterLoads(),
      rescan,
      sharedStyles: sheets(),
      overflow: overflow()
    };
  })()`;
}

/** The engine's one status line (ui/v2/media.js engineLine) for a profile
 *  without the nativeMessaging grant: "Local engine isn't set up · Set up". */
function assertEngineLineNotSetUp(line, label) {
  assert.deepEqual(line, { hidden: false, tone: "", text: T("status.engineNotSetUp"), actions: [T("action.setUp")] },
    `${label} engine status line does not say the local engine is not set up`);
  assert.doesNotMatch(line.text, /FFmpeg|DASH\s*(?:静态规划|原生)|本地高速引擎|v\d+\.\d+/i,
    `${label} exposes internal acceleration implementation details`);
}

/** Popup and side panel rows: a 20px type glyph in the lead, no thumbnail,
 *  no chips (one plain meta line), the tertiary Download; nothing remote loaded. */
function assertGlyphRows(result, kind, label) {
  assert.ok(result.rows.length >= 1, `${label} rendered no media row`);
  for (const row of result.rows) {
    assert.deepEqual(row.leadChildren, ["svg"], `${label} row lead is not a single glyph: ${JSON.stringify(row)}`);
    assert.equal(row.glyph, kind, `${label} row lead is not the ${kind} glyph: ${JSON.stringify(row)}`);
    assert.deepEqual(row.glyphSize, [20, 20], `${label} row glyph is not 20px`);
    assert.equal(row.images, 0, `${label} row renders a thumbnail`);
    assert.equal(row.chips, 0, `${label} row renders chips`);
    assert.equal(row.metaElements, 0, `${label} row meta is not one plain text line`);
    assert.ok(row.meta, `${label} row has no meta line`);
    assert.ok(row.actions.includes("download"), `${label} row lacks its Download`);
  }
  assert.deepEqual(result.remoteImages, [], `${label} shows a remote image`);
  assert.deepEqual(result.posterLoads, [], `${label} loaded the page-referenced poster`);
}

function assertRescanPending(rescan, label) {
  assert.equal(rescan.label, T("media.rescan"), `${label} list header lost its Rescan`);
  assert.deepEqual(rescan.pending, { busy: "true", disabled: true, label: T("media.rescan") },
    `${label} rescan did not expose a stable pending state`);
  assert.deepEqual(rescan.settled, { busy: null, disabled: false }, `${label} rescan did not restore its action`);
}

function assertV2Styles(sheets, expected, label) {
  for (const sheet of expected) assert.ok(sheets.some((value) => value.endsWith(sheet)), `${label} does not load ${sheet}`);
  assert.deepEqual(sheets.filter((value) => V1_STYLESHEETS.some((sheet) => value.endsWith(sheet))), [], `${label} still loads a v1 stylesheet`);
}

async function control(functionSource) {
  assert.ok(controlPage, "extension control page is not connected");
  return evaluate(controlPage, `(${functionSource})()`);
}

async function waitForTabComplete(tabId, expectedUrl, timeoutMs) {
  return poll(async () => {
    const tab = await control(`async () => chrome.tabs.get(${JSON.stringify(tabId)})`);
    return tab?.status === "complete" && tab.url === expectedUrl ? tab : null;
  }, timeoutMs, `tab ${tabId} to finish ${expectedUrl}`);
}

function startFixtureServer() {
  const directBody = Buffer.alloc(640 * 1024, 0x2a);
  const mediaPlaylist = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:4",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXTINF:4.0,",
    "segment-0.ts",
    "#EXT-X-ENDLIST",
    ""
  ].join("\n");
  const captionPlaylist = [
    "#EXTM3U",
    "#EXT-X-VERSION:3",
    "#EXT-X-TARGETDURATION:4",
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXTINF:4.0,",
    "caption-0.vtt",
    "#EXT-X-ENDLIST",
    ""
  ].join("\n");
  const dashManifest = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT4S" minBufferTime="PT1S">
  <Period duration="PT4S">
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true">
      <Representation id="video-720" bandwidth="1800000" width="1280" height="720" codecs="avc1.4D401F">
        <BaseURL>video-720.mp4</BaseURL>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;
  const poster = fs.readFileSync(path.join(EXTENSION_DIR, "icons", "icon128.png"));

  const instance = http.createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      const requestKey = fixtureRequestKey(url);
      fixtureRequestCounts.set(requestKey, (fixtureRequestCounts.get(requestKey) || 0) + 1);
      const common = {
        "access-control-allow-origin": "*",
        "cache-control": "no-store, max-age=0",
        "x-content-type-options": "nosniff"
      };
      if (url.pathname === "/cases/direct.html") {
        return send(response, 200, "text/html; charset=utf-8", fixturePage(`/media/direct.mp4${url.search}`, "arrayBuffer", `/media/poster.png${url.search}`), common);
      }
      if (url.pathname === "/cases/hls.html") {
        const fixture = hlsFixtureUrls(url.searchParams.get("run") || "fixture");
        return send(response, 200, "text/html; charset=utf-8", hlsFixturePage(
          url.searchParams.get("master") || fixture.master,
          `/media/poster.png?run=${encodeURIComponent(url.searchParams.get("run") || "fixture")}`,
          HLS_RENDITIONS.map((_, index) => url.searchParams.get(`variant${index}`)).filter(Boolean),
          url.searchParams.get("caption") || fixture.caption
        ), common);
      }
      if (url.pathname === "/cases/dash.html") {
        return send(response, 200, "text/html; charset=utf-8", fixturePage(`/dash/stream.mpd${url.search}`, "text", `/media/poster.png${url.search}`), common);
      }
      if (url.pathname === "/media/poster.png") return send(response, 200, "image/png", poster, common);
      if (url.pathname === "/media/direct.mp4") return send(response, 200, "video/mp4", directBody, {
        ...common,
        "content-disposition": attachmentFilename(UI_DIRECT_FILENAME)
      });
      if (/^\/embed\/medias\/[^/]+\.m3u8$/i.test(url.pathname)) {
        const fixture = hlsFixtureUrls(url.searchParams.get("run") || "fixture");
        const hlsMaster = ["#EXTM3U", "#EXT-X-VERSION:3"];
        for (const [index, rendition] of HLS_RENDITIONS.entries()) {
          hlsMaster.push(`#EXT-X-STREAM-INF:BANDWIDTH=${rendition.bandwidth},RESOLUTION=${rendition.width}x${rendition.height},CODECS="${rendition.codecs}"`);
          hlsMaster.push(fixture.references[index]);
        }
        hlsMaster.push("");
        const delayMs = Math.max(0, Math.min(5_000, Number(url.searchParams.get("e2eDelayMs")) || 0));
        if (delayMs > 0) {
          setTimeout(() => send(response, 200, "application/vnd.apple.mpegurl", hlsMaster.join("\n"), common), delayMs);
          return;
        }
        return send(response, 200, "application/vnd.apple.mpegurl", hlsMaster.join("\n"), common);
      }
      if (/^\/deliveries\/q\d+-[a-f0-9]+\.m3u8$/i.test(url.pathname)) {
        return send(response, 200, "application/vnd.apple.mpegurl", mediaPlaylist, common);
      }
      if (/^\/embed\/captions\/[^/]+\.m3u8$/i.test(url.pathname)) {
        return send(response, 200, "application/vnd.apple.mpegurl", captionPlaylist, common);
      }
      if (url.pathname === "/dash/stream.mpd") return send(response, 200, "application/dash+xml", dashManifest, common);
      return send(response, 404, "text/plain; charset=utf-8", "not found", common);
    } catch (error) {
      return send(response, 500, "text/plain; charset=utf-8", error.message, {});
    }
  });

  return new Promise((resolve, reject) => {
    instance.once("error", reject);
    instance.listen(0, "127.0.0.1", () => {
      instance.removeListener("error", reject);
      const address = instance.address();
      resolve({ server: instance, origin: `http://127.0.0.1:${address.port}` });
    });
  });
}

function hlsFixturePage(masterPath, posterPath, observedVariantUrls, captionUrl) {
  const master = JSON.stringify(masterPath);
  const poster = JSON.stringify(posterPath);
  const observed = JSON.stringify(observedVariantUrls);
  const caption = JSON.stringify(captionUrl);
  const resultKey = JSON.stringify(FIXTURE_RESULT_KEY);
  return `<!doctype html>
<meta charset="utf-8">
<title>${HLS_DISPLAY_TITLE}</title>
<meta property="og:image" content=${poster}>
<video title="${HLS_INTERNAL_ASSET_TOKEN}" poster=${poster} hidden></video>
<script>
(async () => {
  const requested = new URL(${master}, location.href).href;
  try {
    const masterResponse = await fetch(requested, { cache: "no-store" });
    if (!masterResponse.ok) throw new Error("HTTP " + masterResponse.status + " for " + requested);
    const masterText = await masterResponse.text();
    const renditions = await Promise.all(${observed}.map(async (value) => {
      const response = await fetch(new URL(value, location.href), { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status + " for " + response.url);
      const text = await response.text();
      return { url: response.url, status: response.status, bodySize: text.length };
    }));
    const captionResponse = await fetch(new URL(${caption}, location.href), { cache: "no-store" });
    if (!captionResponse.ok) throw new Error("HTTP " + captionResponse.status + " for " + captionResponse.url);
    const captionText = await captionResponse.text();
    globalThis[${resultKey}] = {
      done: true,
      ok: true,
      status: masterResponse.status,
      url: masterResponse.url,
      bodySize: masterText.length,
      renditions,
      caption: { url: captionResponse.url, status: captionResponse.status, bodySize: captionText.length }
    };
  } catch (error) {
    globalThis[${resultKey}] = { done: true, ok: false, url: requested, error: String(error && error.message || error) };
  }
})();
</script>`;
}

function hlsFixtureUrls(id, { delayMs = 0 } = {}) {
  assert.ok(serverOrigin, "fixture server origin is required before building HLS URLs");
  const url = new URL(serverOrigin);
  const fastOrigin = `${url.protocol}//localhost:${url.port}`;
  const run = encodeURIComponent(id);
  const mediaId = "77994wpv0p";
  const renditionPaths = HLS_RENDITIONS.map((rendition) => `/deliveries/${rendition.slug}.m3u8`);
  return {
    master: `${fastOrigin}/embed/medias/${mediaId}.m3u8?run=${run}&token=fast-master${delayMs ? `&e2eDelayMs=${encodeURIComponent(delayMs)}` : ""}`,
    // The manifest and the browser observe the same rendition paths with
    // different signed-query values, matching rotating CDN token behavior.
    references: renditionPaths.map((pathname, index) =>
      `${serverOrigin}${pathname}?run=${run}&token=manifest-${index}`),
    observedVariants: renditionPaths.map((pathname, index) =>
      `${serverOrigin}${pathname}?run=${run}&token=observed-${index}&expires=4102444800`),
    caption: `${fastOrigin}/embed/captions/${mediaId}.m3u8?run=${run}&token=caption`
  };
}

function hlsFixturePagePath(id, options) {
  const fixture = hlsFixtureUrls(id, options);
  const query = new URLSearchParams({
    run: id,
    master: fixture.master,
    caption: fixture.caption
  });
  fixture.observedVariants.forEach((value, index) => query.set(`variant${index}`, value));
  return `/cases/hls.html?${query}`;
}

function fixtureRequestKey(url) {
  return `${url.pathname}?run=${url.searchParams.get("run") || ""}`;
}

function fixturePage(resourcePath, reader, posterPath) {
  const resource = JSON.stringify(resourcePath);
  const resultKey = JSON.stringify(FIXTURE_RESULT_KEY);
  return `<!doctype html>
<meta charset="utf-8">
<title>FluxCatch ${reader} fixture</title>
<meta property="og:image" content=${JSON.stringify(posterPath)}>
<video poster=${JSON.stringify(posterPath)} hidden></video>
<script>
(async () => {
  const requested = new URL(${resource}, location.href).href;
  try {
    const response = await fetch(requested, { cache: "no-store" });
    if (!response.ok) throw new Error("HTTP " + response.status + " for " + requested);
    const body = await response.${reader}();
    globalThis[${resultKey}] = {
      done: true,
      ok: true,
      status: response.status,
      url: response.url,
      bodySize: typeof body === "string" ? body.length : body.byteLength
    };
  } catch (error) {
    globalThis[${resultKey}] = { done: true, ok: false, url: requested, error: String(error && error.message || error) };
  }
})();
</script>`;
}

function send(response, status, contentType, body, extraHeaders) {
  const data = Buffer.isBuffer(body) ? body : Buffer.from(String(body));
  response.writeHead(status, {
    ...extraHeaders,
    "content-type": contentType,
    "content-length": String(data.byteLength)
  });
  response.end(data);
}

function attachmentFilename(filename) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

function discoverChromeForTesting() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);

  const playwrightCache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  for (const file of walk(playwrightCache, 8)) {
    if (file.endsWith("/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")) candidates.push(file);
  }

  candidates.push(
    "/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    path.join(os.homedir(), "Applications", "Google Chrome for Testing.app", "Contents", "MacOS", "Google Chrome for Testing")
  );

  const usable = [...new Set(candidates)].filter((candidate) => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  });
  usable.sort((a, b) => chromeCandidateRank(b) - chromeCandidateRank(a) || b.localeCompare(a));
  if (!usable.length) {
    throw new Error("Chrome for Testing was not found. Set CHROME_PATH or populate ~/Library/Caches/ms-playwright.");
  }
  return usable[0];
}

function chromeCandidateRank(candidate) {
  const version = Number(candidate.match(/ms-playwright\/chromium-(\d+)/)?.[1] || 0);
  return (candidate.includes("Google Chrome for Testing") ? 1_000_000 : 0) + version;
}

function walk(root, maxDepth) {
  const found = [];
  function visit(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile()) found.push(full);
    }
  }
  visit(root, 0);
  return found;
}

function launchChrome(executable, profile) {
  const args = [
    "--headless=new",
    "--lang=zh-CN",
    `--screen-info={${E2E_WINDOW_SIZE.width}x${E2E_WINDOW_SIZE.height}}`,
    `--window-size=${E2E_WINDOW_SIZE.width},${E2E_WINDOW_SIZE.height}`,
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${EXTENSION_DIR}`,
    `--load-extension=${EXTENSION_DIR}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--password-store=basic",
    "--use-mock-keychain",
    "about:blank"
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = [];
  report.chrome.arguments = args.map((arg) => {
    if (arg.startsWith("--user-data-dir=")) return "--user-data-dir=<temporary profile>";
    if (arg.startsWith("--disable-extensions-except=")) return "--disable-extensions-except=<extension directory>";
    if (arg.startsWith("--load-extension=")) return "--load-extension=<extension directory>";
    return arg;
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => fail(new Error(`Chrome did not expose DevTools within ${START_TIMEOUT_MS} ms\n${stderr.slice(-30).join("")}`)), START_TIMEOUT_MS);
    const onExit = (code, signal) => fail(new Error(`Chrome exited before DevTools was ready (code=${code}, signal=${signal})\n${stderr.slice(-30).join("")}`));
    const fail = (error) => {
      clearTimeout(timeout);
      child.stderr.off("data", onData);
      child.off("exit", onExit);
      reject(error);
    };
    const onData = (chunk) => {
      const text = chunk.toString();
      stderr.push(text);
      if (stderr.length > 200) stderr.shift();
      const match = stderr.join("").match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.off("exit", onExit);
      const browserWebSocketUrl = match[1];
      const parsed = new URL(browserWebSocketUrl);
      resolve({ process: child, browserWebSocketUrl, httpOrigin: `http://${parsed.host}` });
    };
    child.stderr.on("data", onData);
    child.once("exit", onExit);
    child.once("error", fail);
  });
}

async function waitForTarget(devtoolsOrigin, predicate, timeoutMs, label) {
  return poll(async () => {
    const response = await fetch(`${devtoolsOrigin}/json/list`, { cache: "no-store" });
    if (!response.ok) throw new Error(`DevTools target list returned HTTP ${response.status}`);
    const targets = await response.json();
    return targets.find(predicate) || null;
  }, timeoutMs, label);
}

async function poll(operation, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try {
      const value = await operation();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(POLL_INTERVAL_MS);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  });
  if (response.exceptionDetails) {
    const description = response.exceptionDetails.exception?.description || response.exceptionDetails.text || "Runtime.evaluate failed";
    throw new Error(description);
  }
  if (response.result?.subtype === "error") throw new Error(response.result.description || "Runtime.evaluate returned an error");
  return response.result?.value;
}

class CdpClient {
  static async connect(url) {
    const client = new CdpClient(url);
    await client.open();
    return client;
  }

  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  open() {
    assert.equal(typeof WebSocket, "function", "Node 22+ with global WebSocket is required");
    this.socket = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to CDP ${this.url}`)), START_TIMEOUT_MS);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(`CDP WebSocket error for ${this.url}`)); }, { once: true });
      this.socket.addEventListener("message", (event) => this.onMessage(event));
      this.socket.addEventListener("close", () => this.rejectPending(new Error("CDP WebSocket closed")));
    });
  }

  send(method, params = {}, timeoutMs = START_TIMEOUT_MS) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP socket is not open for ${method}`));
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP command timed out: ${method}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
    });
  }

  onMessage(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result || {});
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  close() {
    this.rejectPending(new Error("CDP client closed"));
    try { this.socket?.close(); } catch { /* Already closed. */ }
  }
}

function resolveE2eSourceCommit() {
  const probe = spawnSync("git", ["-C", ROOT, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8" });
  if (probe.error) throw new Error(`git is required to identify E2E evidence: ${probe.error.message}`);
  if (probe.status !== 0) {
    const details = `${probe.stderr || ""}${probe.stdout || ""}`.trim();
    if (probe.status === 128 && !fs.existsSync(path.join(ROOT, ".git"))) {
      return "not-a-git-repository";
    }
    throw new Error(`failed to identify the E2E Git worktree: ${details || `exit ${probe.status}`}`);
  }

  const status = spawnSync(
    "git",
    ["-C", ROOT, "status", "--porcelain", "--untracked-files=all"],
    { encoding: "utf8" }
  );
  if (status.error) throw new Error(`failed to read E2E worktree status: ${status.error.message}`);
  if (status.status !== 0) throw new Error(`failed to read E2E worktree status: ${(status.stderr || "").trim() || `exit ${status.status}`}`);
  if (status.stdout.trim()) return "uncommitted";

  const revision = spawnSync("git", ["-C", ROOT, "rev-parse", "--short=12", "HEAD"], { encoding: "utf8" });
  if (revision.error) throw new Error(`failed to identify the E2E commit: ${revision.error.message}`);
  const commit = revision.stdout.trim();
  if (revision.status !== 0 || !/^[a-f0-9]{12}$/i.test(commit)) {
    throw new Error(`failed to identify the E2E commit: ${(revision.stderr || "").trim() || commit || `exit ${revision.status}`}`);
  }
  return commit;
}

function resolveManifestMessage(value, messages) {
  const match = String(value || "").match(/^__MSG_([A-Za-z0-9_]+)__$/);
  if (!match) return String(value || "");
  const message = messages?.[match[1]]?.message;
  if (typeof message !== "string" || !message.trim()) {
    throw new Error(`missing manifest locale message: ${value}`);
  }
  return message.trim();
}

function parseE2eWindowSize(value) {
  const match = String(value || "").match(/^(\d{3,4})[x,](\d{3,4})$/i);
  assert.ok(match, `FLUXCATCH_E2E_WINDOW_SIZE must look like 1280x900, got ${JSON.stringify(value)}`);
  const width = Number(match[1]);
  const height = Number(match[2]);
  assert.ok(width >= 800 && height >= 400, "E2E Chrome window is too small for stable extension setup");
  return { width, height };
}

function extensionIdFromManifestKey(key) {
  assert.equal(typeof key, "string", "manifest.key is required for deterministic E2E loading");
  const digest = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest().subarray(0, 16);
  return [...digest.toString("hex")].map((nibble) => String.fromCharCode(97 + Number.parseInt(nibble, 16))).join("");
}

function extensionIdFromUrl(value) {
  const match = String(value).match(/^chrome-extension:\/\/([a-p]{32})\//);
  return match?.[1] || null;
}

async function stopProcess(child) {
  if (child.exitCode !== null || child.signalCode) return true;
  child.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => child.once("exit", () => resolve(true))),
    delay(3_000).then(() => false)
  ]);
  if (!exited) {
    child.kill("SIGKILL");
    await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(2_000)]);
  }
  return child.exitCode !== null || Boolean(child.signalCode);
}

async function closeServer(instance) {
  instance.closeAllConnections?.();
  await new Promise((resolve) => instance.close(resolve));
  return true;
}

function writeReport(value) {
  fs.mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true });
  let serialized = JSON.stringify(value, null, 2);
  for (const [source, replacement] of [[ROOT, "<repository>"], [os.homedir(), "<home>"], [os.tmpdir(), "<temporary directory>"]]) {
    serialized = serialized.split(source).join(replacement);
  }
  fs.writeFileSync(ARTIFACT_PATH, `${serialized}\n`);
}

function serializeError(error) {
  return {
    name: error?.name || "Error",
    message: error?.message || String(error),
    stack: error?.stack || null
  };
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

await main();
