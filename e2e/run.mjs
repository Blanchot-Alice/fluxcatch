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
  schemaVersion: 3,
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
  assert.equal(buildInfo.diagnostics?.capabilities?.remoteThumbnails, false, "stable remote thumbnail gate must stay closed");
  report.extension.buildIdentity = {
    ...buildInfo.diagnostics.extension,
    commit: PACKAGED_EXTENSION_RUN ? buildInfo.diagnostics.extension.commit : E2E_SOURCE_COMMIT
  };
  report.extension.capabilityProfile = buildInfo.diagnostics.capabilities;

  await auditPhaseBOptionsMatrix(launched.httpOrigin);

  await auditExistingExtensionPage("options", controlPage, 720, 900, `(async () => ({
    title: document.title,
    heading: document.querySelector("h1")?.textContent,
    saveButton: document.querySelector(".save-btn")?.textContent,
    nativePermissionButton: document.querySelector("#nativePermissionButton")?.textContent,
    nativePermissionStatus: document.querySelector("#nativePermissionStatus")?.textContent,
    nativePermissionGranted: await chrome.permissions.contains({ permissions: ["nativeMessaging"] }),
    nativeInstallGuideOpen: Boolean(document.querySelector("#nativeInstallGuide")?.open),
    nativeConnection: document.querySelector("#capabilityNativeConnection")?.textContent,
    labelledFields: [...document.querySelectorAll(".opt-field input, .opt-field select, .opt-field textarea")].every((node) => Boolean(document.querySelector('label[for="' + node.id + '"]'))),
    deadControls: ["liveDuration", "youtubeEnabled", "ytdlpStatus", "ytdlpRefreshButton", "ytdlpGuide"].filter((id) => document.getElementById(id)),
    capabilities: [...document.querySelectorAll("#capabilityList li")].map((node) => ({
      feature: node.dataset.feature,
      enabled: node.dataset.enabled,
      status: node.querySelector("strong")?.textContent
    })),
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
  }))()`);
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
    report.extension.toolbarPopupIntrinsic = await auditToolbarPopupIntrinsicSize(launched.httpOrigin);
    await auditNewExtensionPage("popup", "popup/popup.html", 372, 560, `(async () => {
      const deadline = Date.now() + ${CASE_TIMEOUT_MS};
      let mediaCard;
      while (!(mediaCard = document.querySelector(".media-card")) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const scan = document.querySelector("#scanButton");
      scan?.click();
      scan?.click();
      const scanPending = {
        busy: scan?.getAttribute("aria-busy"),
        disabled: Boolean(scan?.disabled),
        state: scan?.dataset.uiState || ""
      };
      await new Promise((resolve) => setTimeout(resolve, 550));
      document.querySelector("#jobsTab")?.click();
      const jobsVisible = !document.querySelector("#jobsView")?.hidden;
      document.querySelector("#mediaTab")?.click();
      return {
        title: document.title,
        heading: document.querySelector("h1")?.textContent,
        workspaceButton: document.querySelector("#workspaceButton")?.textContent,
        hostTitle: document.querySelector("#hostTitle")?.textContent,
        hostDetail: document.querySelector("#hostDetail")?.textContent,
        tabs: [...document.querySelectorAll('[role="tab"]')].map((node) => ({ selected: node.getAttribute("aria-selected"), controls: node.getAttribute("aria-controls") })),
        jobsVisible,
        mediaVisible: !document.querySelector("#mediaView")?.hidden,
        thumbnailCount: document.querySelectorAll(".media-thumbnail").length,
        fallbackCount: document.querySelectorAll(".media-card .kind-icon").length,
        scanPending,
        sharedStyles: [...document.styleSheets].map((sheet) => new URL(sheet.href).pathname),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`, launched.httpOrigin);
    await control(`async () => { await chrome.tabs.update(${JSON.stringify(uiFixture.tabId)}, { active: true }); return true; }`);
    await auditNewExtensionPage("sidepanel", "sidepanel/sidepanel.html", 420, 820, `(async () => {
      const deadline = Date.now() + ${CASE_TIMEOUT_MS};
      let button;
      while (!(button = document.querySelector(".media-download")) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const scan = document.querySelector("#scanButton");
      scan?.click();
      scan?.click();
      const scanPending = {
        busy: scan?.getAttribute("aria-busy"),
        disabled: Boolean(scan?.disabled),
        state: scan?.dataset.uiState || ""
      };
      await new Promise((resolve) => setTimeout(resolve, 550));
      button = document.querySelector(".media-download");
      const quickDownloadLabel = button?.textContent;
      const quickDownloadDescribedBy = button?.getAttribute("aria-describedby");
      const jobsResponse = await chrome.runtime.sendMessage({ type: "GET_JOBS" });
      return {
        title: document.title,
        brand: document.querySelector(".brand-copy strong")?.textContent,
        hostTitle: document.querySelector("#hostTitle")?.textContent,
        hostDetail: document.querySelector("#hostDetail")?.textContent,
        mediaHeading: document.querySelector("#mediaHeading")?.textContent,
        jobsHeading: document.querySelector("#jobsHeading")?.textContent,
        quickDownloadButtons: document.querySelectorAll(".media-download").length,
        quickDownloadLabel,
        quickDownloadDescribedBy,
        quickDownloadCreatedJob: Boolean(jobsResponse?.jobs?.find((item) =>
          item.filename === ${JSON.stringify(UI_DIRECT_FILENAME)})),
        thumbnailCount: document.querySelectorAll(".media-thumbnail").length,
        fallbackCount: document.querySelectorAll(".media-row .kind-icon").length,
        globalErrorHidden: document.querySelector("#globalError")?.hidden,
        hasLiveRegions: document.querySelectorAll('[aria-live="polite"]').length >= 3,
        scanPending,
        sharedStyles: [...document.styleSheets].map((sheet) => new URL(sheet.href).pathname),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`, launched.httpOrigin);
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
  assert.equal(report.visualMatrix.length, 13, "Phase B visual matrix is incomplete");
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
    assert.match(badgeBeforeRead.title || "", /FluxCatch.*检测到 1 个媒体/, `${definition.name} toolbar title did not describe the detected media`);
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

      await auditHlsDownloadDialog(tabId, expectedPublicUrl, definition.expectedTitle);
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

async function auditPhaseBOptionsMatrix(devtoolsOrigin) {
  const originalSettingsResponse = await control(`async () => chrome.runtime.sendMessage({ type: "GET_SETTINGS" })`);
  assert.equal(originalSettingsResponse?.ok, true, originalSettingsResponse?.error || "GET_SETTINGS failed before Phase B Options audit");
  const originalSettings = originalSettingsResponse.settings;
  const prepared = await control(`async () => chrome.runtime.sendMessage({
    type: "SAVE_SETTINGS",
    settings: {
      ...${JSON.stringify(originalSettings)},
      allowPrivateNetworkMedia: false,
      concurrentFragments: 8,
      concurrentRanges: 8,
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

    const baseline = await evaluate(client, `(() => {
      const visible = (node) => {
        const style = getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const textNodes = [...document.querySelectorAll("p, small, label, button, input, select, textarea, summary, dt, dd")]
        .filter(visible)
        .map((node) => ({ selector: node.id || node.className || node.localName, px: parseFloat(getComputedStyle(node).fontSize) }))
        .filter((entry) => Number.isFinite(entry.px));
      const described = [...document.querySelectorAll("[aria-describedby]")].map((node) => ({
        id: node.id,
        missing: node.getAttribute("aria-describedby").split(/\\s+/).filter(Boolean).filter((id) => !document.getElementById(id))
      }));
      const targetNodes = [...document.querySelectorAll("button, input:not([type=checkbox]):not([type=radio]), select, textarea, summary")]
        .filter(visible)
        .map((node) => {
          const rect = node.getBoundingClientRect();
          return { id: node.id || node.textContent.trim().slice(0, 24), width: rect.width, height: rect.height };
        });
      const sheets = [...document.styleSheets].map((sheet) => new URL(sheet.href).pathname);
      const save = document.querySelector(".save-btn");
      const labActions = [...document.querySelectorAll("#lab button, #lab input, #lab select, #lab textarea")]
        .filter((node) => !node.disabled && visible(node));
      const focusControl = document.querySelector("#filenameTemplate");
      focusControl.focus({ preventScroll: true });
      const focusStyle = getComputedStyle(focusControl);
      return {
        title: document.title,
        fieldsets: document.querySelectorAll("fieldset").length,
        legends: document.querySelectorAll("fieldset > legend").length,
        described,
        minVisibleTextPx: Math.min(...textNodes.map((entry) => entry.px)),
        undersizedTargets: targetNodes.filter((entry) => entry.height < 39.5 || entry.width < 39.5),
        sheets,
        saveDisabled: Boolean(save.disabled),
        dirty: document.querySelector("#settingsForm")?.dataset.dirty,
        dirtyText: document.querySelector("#dirtyStatus")?.textContent.trim(),
        labActionCount: labActions.length,
        focusOutline: { style: focusStyle.outlineStyle, width: parseFloat(focusStyle.outlineWidth) || 0 },
        bodyBackground: getComputedStyle(document.body).backgroundColor,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    assert.equal(baseline.title, "FluxCatch 设置");
    assert.equal(baseline.fieldsets, 6, "Options grouped settings must use six fieldsets");
    assert.equal(baseline.legends, baseline.fieldsets, "every Options fieldset must have a legend");
    assert.deepEqual(baseline.described.filter((entry) => entry.missing.length), [], "Options aria-describedby references a missing helper");
    assert.ok(baseline.minVisibleTextPx >= 12, `Options contains ${baseline.minVisibleTextPx}px visible text`);
    assert.deepEqual(baseline.undersizedTargets, [], `Options contains sub-40px controls: ${JSON.stringify(baseline.undersizedTargets)}`);
    assert.ok(baseline.sheets.some((value) => value.endsWith("/ui/tokens.css")), "Options does not load shared tokens");
    assert.ok(baseline.sheets.some((value) => value.endsWith("/ui/components.css")), "Options does not load shared components");
    assert.equal(baseline.saveDisabled, true, "Options Save must initially be disabled");
    assert.equal(baseline.dirty, "false", "Options form must initially be clean");
    assert.equal(baseline.dirtyText, "所有更改均已保存");
    assert.equal(baseline.labActionCount, 0, "gated Lab features expose an active primary control");
    assert.notEqual(baseline.focusOutline.style, "none", "focused Options input has no visible focus ring");
    assert.ok(baseline.focusOutline.width >= 2, "focused Options input focus ring is too thin");
    assert.ok(baseline.overflow <= 1, `Options light view overflows by ${baseline.overflow}px`);
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-light-980x900", 980, 900, { theme: "light", state: "clean", origin: "top" });
    const stickyWide = await measureFinalFieldAgainstSaveBar(client, "wide Options");
    await resetVisualOrigin(client);

    await setEmulatedPreferences(client, { colorScheme: "dark", reducedMotion: "no-preference" });
    await delay(100);
    const dark = await evaluate(client, `(() => ({
      matches: matchMedia("(prefers-color-scheme: dark)").matches,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      focusColor: getComputedStyle(document.querySelector("#filenameTemplate")).outlineColor,
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
    }))()`);
    assert.equal(dark.matches, true, "dark-mode media emulation did not apply");
    assert.notEqual(dark.bodyBackground, baseline.bodyBackground, "dark mode did not change the page background");
    assert.ok(dark.overflow <= 1, `Options dark view overflows by ${dark.overflow}px`);
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-dark-980x900", 980, 900, { theme: "dark", origin: "top" });

    await setEmulatedPreferences(client, { colorScheme: "light", reducedMotion: "no-preference" });
    await setViewport(client, 390, 844);
    const narrow = await evaluate(client, `(() => ({
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      navPosition: getComputedStyle(document.querySelector(".section-nav")).position,
      layoutColumns: getComputedStyle(document.querySelector(".options-layout")).gridTemplateColumns
    }))()`);
    assert.ok(narrow.overflow <= 1, `Options narrow view overflows by ${narrow.overflow}px`);
    assert.notEqual(narrow.navPosition, "sticky", "Options navigation remains sticky at narrow width");
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-narrow-390x844", 390, 844, { layout: "single-column", origin: "top" });
    const stickyNarrow = await measureFinalFieldAgainstSaveBar(client, "narrow Options");
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

    await setViewport(client, 980, 900);
    await evaluate(client, `(() => {
      const input = document.querySelector("#filenameTemplate");
      input.value += " 视觉校对";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
    const dirty = await poll(async () => {
      const value = await evaluate(client, `(() => ({
        disabled: document.querySelector(".save-btn").disabled,
        dirty: document.querySelector("#settingsForm").dataset.dirty,
        text: document.querySelector("#dirtyStatus").textContent.trim()
      }))()`);
      return value.dirty === "true" && value.disabled === false ? value : null;
    }, CASE_TIMEOUT_MS, "Options dirty state");
    assert.equal(dirty.text, "有未保存的更改");
    await resetVisualOrigin(client);
    await captureMatrixState(client, "options-dirty", 980, 900, { saveEnabled: true, origin: "top" });

    await evaluate(client, `(() => {
      const input = document.querySelector("#filenameTemplate");
      input.focus();
      input.setSelectionRange(0, 0);
      input.dispatchEvent(new Event("select", { bubbles: true }));
      document.querySelector('[data-token="{title}"]').focus();
      return true;
    })()`);
    await pressEnterKey(client);
    const keyboardInsertion = await poll(async () => {
      const value = await evaluate(client, `(() => ({ value: document.querySelector("#filenameTemplate").value, active: document.activeElement?.id }))()`);
      return value.value.startsWith("{title}") ? value : null;
    }, CASE_TIMEOUT_MS, "keyboard template-token insertion");
    assert.ok(keyboardInsertion.value.startsWith("{title}"), "keyboard activation did not insert the selected filename token");

    await evaluate(client, `document.querySelector(".save-btn").click()`);
    const saved = await poll(async () => {
      const value = await evaluate(client, `(() => ({
        disabled: document.querySelector(".save-btn").disabled,
        dirty: document.querySelector("#settingsForm").dataset.dirty,
        status: document.querySelector("#saveStatus").textContent.trim(),
        busy: document.querySelector(".save-btn").getAttribute("aria-busy"),
        actionState: document.querySelector(".save-btn").dataset.uiState || ""
      }))()`);
      return value.dirty === "false" && /已保存/.test(value.status) ? value : null;
    }, CASE_TIMEOUT_MS, "Options successful save");
    assert.match(saved.status, /已保存/);
    await poll(async () => {
      const value = await evaluate(client, `(() => ({
        disabled: document.querySelector(".save-btn").disabled,
        busy: document.querySelector(".save-btn").getAttribute("aria-busy"),
        actionState: document.querySelector(".save-btn").dataset.uiState || ""
      }))()`);
      return value.disabled && value.busy === null && value.actionState === "" ? value : null;
    }, CASE_TIMEOUT_MS, "Options Save action to restore after success");

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
    await evaluate(client, `(() => {
      const input = document.querySelector("#minimumKiB");
      input.value = String(Number(input.value || 0) + 1);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      document.querySelector(".save-btn").click();
      return true;
    })()`);
    const failedSave = await poll(async () => {
      const value = await evaluate(client, `(() => ({
        dirty: document.querySelector("#settingsForm").dataset.dirty,
        saveDisabled: document.querySelector(".save-btn").disabled,
        status: document.querySelector("#saveStatus").textContent.trim(),
        formBusy: document.querySelector("#settingsForm").getAttribute("aria-busy")
      }))()`);
      return value.status.includes("失败") ? value : null;
    }, CASE_TIMEOUT_MS, "Options failed save state");
    assert.equal(failedSave.dirty, "true", "failed save discarded dirty state");
    assert.equal(failedSave.saveDisabled, false, "failed save did not restore the Save action");
    assert.equal(failedSave.formBusy, null, "failed save left the form aria-busy");
    await evaluate(client, `document.querySelector("#discardChangesButton").click()`);
    await poll(async () => await evaluate(client, `document.querySelector("#settingsForm").dataset.dirty === "false"`), CASE_TIMEOUT_MS, "discard failed-save changes before reload");

    const restoredSettings = await control(`async () => chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: ${JSON.stringify(originalSettings)} })`);
    assert.equal(restoredSettings?.ok, true, restoredSettings?.error || "could not restore settings before validation audit");
    await reloadExtensionPage(client);
    await waitForOptionsReady(client);
    await setViewport(client, 980, 900);
    await evaluate(client, `(() => {
      const values = {
        concurrentFragments: "25",
        minimumKiB: "102401",
        filenameTemplate: "{title}-{unknown}",
        blockedDomains: "https://valid.example/path\\n*.invalid.example\\nhttps://user:pass@example.com"
      };
      for (const [id, value] of Object.entries(values)) {
        const input = document.querySelector("#" + id);
        input.value = value;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
      document.querySelector(".save-btn").click();
      return true;
    })()`);
    const validation = await poll(async () => {
      const value = await evaluate(client, `(() => ({
        summaryHidden: document.querySelector("#errorSummary").hidden,
        invalidIds: [...document.querySelectorAll('[aria-invalid="true"]')].map((node) => node.id),
        firstFocus: document.activeElement?.id,
        domainError: document.querySelector("#blockedDomainsError").textContent.trim(),
        tokenError: document.querySelector("#filenameTemplateError").textContent.trim(),
        summary: document.querySelector("#errorSummary").textContent.trim()
      }))()`);
      return !value.summaryHidden ? value : null;
    }, CASE_TIMEOUT_MS, "Options validation state");
    assert.ok(validation.invalidIds.includes("concurrentFragments"), "concurrency validation did not mark its field invalid");
    assert.ok(validation.invalidIds.includes("minimumKiB"), "minimum size validation did not mark its field invalid");
    assert.ok(validation.invalidIds.includes("filenameTemplate"), "unknown filename token was accepted");
    assert.ok(validation.invalidIds.includes("blockedDomains"), "invalid domain lines were accepted");
    assert.equal(validation.firstFocus, "concurrentFragments", "failed submission did not focus the first invalid field");
    assert.match(validation.domainError, /第\s*2\s*行|2/);
    assert.match(validation.tokenError, /不支持|unknown|未知/i);
    await captureMatrixState(client, "options-validation", 980, 900, { invalidFields: validation.invalidIds });

    await evaluate(client, `document.querySelector("#discardChangesButton").click()`);
    await poll(async () => await evaluate(client, `document.querySelector("#settingsForm").dataset.dirty === "false"`), CASE_TIMEOUT_MS, "discard invalid Options changes before reload");
    await reloadExtensionPage(client);
    await waitForOptionsReady(client);
    await evaluate(client, `document.querySelector("#allowPrivateNetworkMedia").click()`);
    const warning = await poll(async () => {
      const value = await evaluate(client, `(() => ({
        open: document.querySelector("#privateNetworkDialog").open,
        checked: document.querySelector("#allowPrivateNetworkMedia").checked,
        active: document.activeElement?.id,
        text: document.querySelector("#privateNetworkDialogDescription").textContent.trim()
      }))()`);
      return value.open ? value : null;
    }, CASE_TIMEOUT_MS, "private-network confirmation dialog");
    assert.equal(warning.checked, false, "private-network setting changed before confirmation");
    assert.equal(warning.active, "privateNetworkCancelButton", "private-network dialog did not place focus on a safe action");
    assert.match(warning.text, /云元数据服务.*链路本地.*多播.*未指定.*保留地址/);
    await evaluate(client, `(() => {
      globalThis.__phaseBPrivateDialogClicks = 0;
      globalThis.__phaseBPrivateDialogFocus = [];
      document.querySelector("#privateNetworkCancelButton").addEventListener("click", () => { globalThis.__phaseBPrivateDialogClicks += 1; }, { once: true });
      document.addEventListener("focusin", (event) => { globalThis.__phaseBPrivateDialogFocus.push(event.target?.id || event.target?.localName || "unknown"); }, { capture: true });
      return true;
    })()`);
    await captureMatrixState(client, "options-private-network-warning", 980, 900, { confirmationRequired: true });
    await pressEnterKey(client);
    await poll(async () => {
      const value = await evaluate(client, `(() => ({ open: document.querySelector("#privateNetworkDialog").open, active: document.activeElement?.id }))()`);
      return !value.open ? value : null;
    }, CASE_TIMEOUT_MS, "private-network dialog focus restoration");
    await delay(250);
    const warningClosed = await evaluate(client, `(() => ({
      open: document.querySelector("#privateNetworkDialog").open,
      active: document.activeElement?.id,
      cancelClicks: globalThis.__phaseBPrivateDialogClicks,
      focusEvents: globalThis.__phaseBPrivateDialogFocus
    }))()`);
    assert.equal(warningClosed.cancelClicks, 1, `keyboard activation did not invoke exactly one Cancel action: ${JSON.stringify(warningClosed)}`);
    assert.equal(warningClosed.active, "allowPrivateNetworkMedia", `private-network dialog did not restore focus to its trigger: ${JSON.stringify(warningClosed)}`);

    const missingMatrix = await evaluate(client, `(async () => {
      const root = document.documentElement;
      const priorScrollBehavior = root.style.scrollBehavior;
      root.style.scrollBehavior = "auto";
      document.querySelector("#localCapabilities").scrollIntoView({ block: "center", behavior: "auto" });
      root.style.scrollBehavior = priorScrollBehavior;
      const { renderHostStatus } = await import(chrome.runtime.getURL("options/options.js"));
      renderHostStatus({ connected: false, failureReason: "host_missing" }, { permissionGranted: true });
      const matrixRect = document.querySelector("#localCapabilities .local-capability-matrix").getBoundingClientRect();
      const saveRect = document.querySelector("#saveBar").getBoundingClientRect();
      const guide = document.querySelector("#nativeInstallGuide");
      return {
        states: [...document.querySelectorAll("#localCapabilities dd[data-state]")].map((node) => node.dataset.state),
        native: document.querySelector("#capabilityNativeConnection").textContent,
        permission: document.querySelector("#nativePermissionStatus").textContent,
        action: document.querySelector("#nativePermissionButton").textContent,
        guideOpen: Boolean(guide.open),
        guideText: guide.textContent.trim(),
        matrixVisible: matrixRect.top >= 0 && matrixRect.bottom <= saveRect.top
      };
    })()`);
    assert.match(missingMatrix.native, /未安装|未注册/);
    assert.match(missingMatrix.permission, /已授权.*未安装|已授权.*未注册/);
    assert.match(missingMatrix.permission, /\.\/scripts\/native-install-wrapper\.sh/);
    assert.equal(missingMatrix.action, "重新检查");
    assert.equal(missingMatrix.guideOpen, true, "missing native host did not open its installation guide");
    assert.match(missingMatrix.guideText, /\.\/scripts\/native-install-wrapper\.sh/);
    assert.match(missingMatrix.guideText, /\.\/install-macos\.sh/);
    assert.doesNotMatch(JSON.stringify(missingMatrix), /TypeError|connectNative is not a function/);
    assert.equal(missingMatrix.matrixVisible, true, "missing-host capability matrix is outside its evidence screenshot");
    assert.ok(missingMatrix.states.every((state) => ["ready", "gated", "missing", "mismatch", "unknown"].includes(state)),
      `missing-host fixture produced an unknown production state: ${JSON.stringify(missingMatrix.states)}`);
    await delay(80);
    await captureMatrixState(client, "options-native-host-missing", 980, 900, {
      fixture: "deterministic host DTO rendered by production renderHostStatus",
      model: missingMatrix
    });

    const unavailableApiMatrix = await evaluate(client, `(async () => {
      const { renderHostStatus } = await import(chrome.runtime.getURL("options/options.js"));
      renderHostStatus({ connected: false, failureReason: "api_unavailable" }, { permissionGranted: true });
      const guide = document.querySelector("#nativeInstallGuide");
      return {
        states: [...document.querySelectorAll("#localCapabilities dd[data-state]")].map((node) => node.dataset.state),
        native: document.querySelector("#capabilityNativeConnection").textContent,
        permission: document.querySelector("#nativePermissionStatus").textContent,
        action: document.querySelector("#nativePermissionButton").textContent,
        guideOpen: Boolean(guide.open),
        bodyText: document.body.textContent
      };
    })()`);
    assert.match(unavailableApiMatrix.native, /授权已生效.*接口待恢复/);
    assert.match(unavailableApiMatrix.permission, /Chrome.*初始化.*自动重试/);
    assert.equal(unavailableApiMatrix.action, "重新检查");
    assert.equal(unavailableApiMatrix.guideOpen, false, "API-binding recovery was misclassified as a missing host");
    assert.equal(unavailableApiMatrix.states[0], "mismatch");
    assert.doesNotMatch(JSON.stringify(unavailableApiMatrix), /TypeError|connectNative is not a function/);
    report.extension.nativeFailureEvidence = {
      hostMissing: missingMatrix,
      apiUnavailable: {
        ...unavailableApiMatrix,
        bodyText: undefined
      }
    };

    const readyMatrix = await evaluate(client, `(async () => {
      const { renderHostStatus } = await import(chrome.runtime.getURL("options/options.js"));
      renderHostStatus({
        connected: true,
        compatible: true,
        version: "0.2.5",
        protocolVersion: 1,
        ffmpeg: true,
        capabilities: {
          ffmpeg: { available: true, encoders: { libmp3lame: true } },
          ytdlp: { installed: true, available: false, networkDisabled: true }
        }
      }, { permissionGranted: true });
      const matrixRect = document.querySelector("#localCapabilities .local-capability-matrix").getBoundingClientRect();
      const saveRect = document.querySelector("#saveBar").getBoundingClientRect();
      return {
        states: [...document.querySelectorAll("#localCapabilities dd[data-state]")].map((node) => node.dataset.state),
        ytdlp: document.querySelector("#capabilityYtDlp").textContent,
        external: document.querySelector("#capabilityExternalNetwork").textContent,
        permission: document.querySelector("#nativePermissionStatus").textContent,
        action: document.querySelector("#nativePermissionButton").textContent,
        matrixVisible: matrixRect.top >= 0 && matrixRect.bottom <= saveRect.top
      };
    })()`);
    assert.match(readyMatrix.ytdlp, /已安装.*未开放/);
    assert.doesNotMatch(readyMatrix.ytdlp, /^可用$/);
    assert.match(readyMatrix.external, /未启用/);
    assert.match(readyMatrix.permission, /已就绪/);
    assert.equal(readyMatrix.action, "重新检查");
    assert.equal(readyMatrix.matrixVisible, true, "ready-host capability matrix is outside its evidence screenshot");
    assert.ok(readyMatrix.states.every((state) => ["ready", "gated", "missing", "mismatch", "unknown"].includes(state)),
      `ready-host fixture produced an unknown production state: ${JSON.stringify(readyMatrix.states)}`);
    await delay(80);
    await captureMatrixState(client, "options-native-host-ready", 980, 900, {
      fixture: "deterministic host DTO rendered by production renderHostStatus",
      model: readyMatrix
    });

    await setEmulatedPreferences(client, { colorScheme: "light", reducedMotion: "reduce" });
    await resetVisualOrigin(client);
    await delay(100);
    const reduced = await evaluate(client, `(() => {
      const button = document.querySelector("#copyDiagnosticsButton");
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
      fieldsets: baseline.fieldsets,
      legends: baseline.legends,
      missingDescribedByTargets: baseline.described.filter((entry) => entry.missing.length),
      minimumVisibleTextPx: baseline.minVisibleTextPx,
      undersizedControls: baseline.undersizedTargets,
      focusRing: baseline.focusOutline,
      zoomChecks,
      stickySaveBar: { wide: stickyWide, narrow: stickyNarrow },
      keyboardTemplateInsertion: { valueInserted: true, resultingFocus: keyboardInsertion.active || "browser-managed" },
      save: { initiallyDisabled: true, successResetsDirty: true, failurePreservesDirty: true },
      validation: { invalidFields: validation.invalidIds, firstFocus: validation.firstFocus },
      privateNetworkFocusRestored: warningClosed.active === "allowPrivateNetworkMedia",
      reducedMotion: reduced
    };
  } finally {
    try {
      await control(`async () => chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", settings: ${JSON.stringify(originalSettings)} })`);
    } catch { /* The main E2E cleanup still removes the isolated profile. */ }
    await closeExtensionTarget(page);
  }
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

async function measureFinalFieldAgainstSaveBar(client, label) {
  const geometry = await evaluate(client, `(async () => {
    const control = document.querySelector("#showNotifications");
    const field = document.querySelector("#notifications .section-content");
    const saveBar = document.querySelector("#saveBar");
    const priorScrollBehavior = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = "auto";
    field.scrollIntoView({ block: "end" });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    document.documentElement.style.scrollBehavior = priorScrollBehavior;
    control.focus({ preventScroll: true });
    const fieldRect = field.getBoundingClientRect();
    const saveRect = saveBar.getBoundingClientRect();
    return {
      fieldTop: fieldRect.top,
      fieldBottom: fieldRect.bottom,
      saveTop: saveRect.top,
      saveBottom: saveRect.bottom,
      gap: saveRect.top - fieldRect.bottom,
      viewportHeight: document.documentElement.clientHeight
    };
  })()`);
  assert.ok(geometry.fieldTop >= 0 && geometry.fieldBottom <= geometry.saveTop + 1,
    `${label} sticky Save bar obscures the final setting: ${JSON.stringify(geometry)}`);
  return geometry;
}

async function waitForOptionsReady(client) {
  return poll(async () => {
    const value = await evaluate(client, `(() => ({
      ready: document.readyState === "complete",
      dirty: document.querySelector("#settingsForm")?.dataset.dirty,
      saveText: document.querySelector(".save-btn")?.textContent.trim()
    }))()`);
    return value.ready && value.dirty === "false" && value.saveText === "保存设置" ? value : null;
  }, CASE_TIMEOUT_MS, "Options normalized form baseline");
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
    await poll(async () => await evaluate(popup.client, `Boolean(document.querySelector(".media-card"))`),
      CASE_TIMEOUT_MS, `${mode} Chrome action popup media card`);
    const geometry = await popupIntrinsicGeometry(popup.client);
    assertToolbarPopupGeometry(geometry);
    if (EXPECT_RESTRICTED_ACTION_POPUP) {
      assert.ok(geometry.viewport.height < 560,
        `restricted Chrome screen did not constrain popup height: ${JSON.stringify(geometry.viewport)}`);
    } else {
      assert.equal(geometry.viewport.height, 560,
        `roomy Chrome screen did not expose the full popup height: ${JSON.stringify(geometry.viewport)}`);
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
  return evaluate(client, `(() => {
    const rect = (selector) => {
      const value = document.querySelector(selector)?.getBoundingClientRect();
      return value ? {
        left: value.left, top: value.top, right: value.right, bottom: value.bottom,
        width: value.width, height: value.height
      } : null;
    };
    const popupSheet = [...document.styleSheets].find((sheet) => sheet.href?.endsWith("/popup/popup.css"));
    const bodyRule = popupSheet ? [...popupSheet.cssRules].find((rule) => rule.selectorText === "body") : null;
    const htmlRule = popupSheet ? [...popupSheet.cssRules].find((rule) => rule.selectorText === "html") : null;
    const body = document.body.getBoundingClientRect();
    const overlaps = (left, right) => Boolean(left && right
      && left.left < right.right && left.right > right.left
      && left.top < right.bottom && left.bottom > right.top);
    const brand = rect(".brand");
    const toolbar = rect(".toolbar");
    const topbar = rect(".topbar");
    const controls = rect(".control-row");
    const content = rect("main.body");
    const footer = rect(".foot-actions");
    const firstCard = rect(".media-card");
    const footerButtons = [...document.querySelectorAll(".foot-actions .foot-btn")].map((node) => {
      const value = node.getBoundingClientRect();
      return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height };
    });
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
        maxHeight: bodyRule?.style.maxHeight || "",
        cssText: bodyRule?.style.cssText || ""
      },
      declaredRootSize: {
        width: htmlRule?.style.width || "",
        height: htmlRule?.style.height || "",
        overflow: htmlRule?.style.overflow || "",
        cssText: htmlRule?.style.cssText || ""
      },
      layout: {
        topbar, brand, toolbar, controls, content, footer, firstCard, footerButtons,
        brandToolbarOverlap: overlaps(brand, toolbar),
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
  assert.equal(geometry.declaredRootSize.width, "372px", "popup root lost its intrinsic width request");
  assert.equal(geometry.declaredRootSize.height, "560px", "popup root lost its intrinsic height request");
  assert.equal(geometry.declaredRootSize.overflow, "hidden", "popup root no longer contains a constrained host viewport");
  assert.equal(geometry.declaredBodySize.width, "372px", "popup body lost its fixed intrinsic width");
  assert.equal(geometry.declaredBodySize.height, "min(560px, 100dvh)",
    "popup body lost its adaptive 560px height ceiling");
  assert.equal(geometry.declaredBodySize.maxHeight, "100dvh", "popup body lost its viewport height guard");
  assert.doesNotMatch(geometry.declaredBodySize.width, /v[wh]/i,
    "popup width depends on the host viewport during Chrome's intrinsic layout pass");
  assert.equal(geometry.body.width, 372, "popup body does not render at its declared intrinsic width");
  assert.equal(geometry.viewport.width, 372, "real Chrome action popup host did not adopt the 372px intrinsic width");
  assert.equal(geometry.viewport.clientWidth, 372, "real Chrome action popup client width is not 372px");
  assert.equal(geometry.body.height, geometry.viewport.height,
    "popup body height does not adapt to the real Chrome action viewport");
  assert.equal(geometry.viewport.clientHeight, geometry.viewport.height,
    "real Chrome action popup client height differs from its viewport height");
  assert.ok(geometry.body.height <= 560, `popup body exceeds its 560px ceiling: ${geometry.body.height}px`);
  assert.equal(geometry.layout.brandToolbarOverlap, false, "popup brand overlaps the header toolbar");
  assert.equal(geometry.layout.topbarControlsOverlap, false, "popup header overlaps the media/task controls");
  assert.equal(geometry.layout.controlsContentOverlap, false, "popup controls overlap the scrollable content");
  assert.equal(geometry.layout.contentFooterOverlap, false, "popup content overlaps the footer actions");
  assert.equal(geometry.layout.cardTopbarOverlap, false, "popup media card overlaps the header");
  assert.equal(geometry.layout.cardControlsOverlap, false, "popup media card overlaps the view controls");
  assert.equal(geometry.layout.cardFooterOverlap, false, "popup media card overlaps the footer");
  assert.equal(geometry.layout.footerButtonOverlap, false, "popup footer buttons overlap each other");
  assert.ok(geometry.layout.footer.top >= 0 && geometry.layout.footer.bottom <= geometry.viewport.height + 1,
    `popup footer is outside the visible host viewport: ${JSON.stringify({ footer: geometry.layout.footer, viewport: geometry.viewport })}`);
  assert.ok(geometry.layout.firstCard && geometry.layout.firstCard.top >= geometry.layout.controls.bottom,
    "popup did not render a separated media card below the controls");
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

async function auditHlsDownloadDialog(tabId, expectedUrl, expectedTitle) {
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
      width: 372,
      height: 560,
      deviceScaleFactor: 1,
      mobile: false
    });
    await poll(async () => await evaluate(client, `document.readyState === "complete"`), CASE_TIMEOUT_MS, "HLS popup DOM ready");
    await client.send("Page.bringToFront");
    const result = await evaluate(client, `(async () => {
      const deadline = Date.now() + ${CASE_TIMEOUT_MS};
      let cards;
      while ((cards = document.querySelectorAll(".media-card")).length !== 1 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const card = cards?.[0];
      const button = card?.querySelector(".download-button");
      button?.click();
      const dialog = document.querySelector("#downloadDialog");
      while (!dialog?.open && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
      while (document.activeElement?.id !== "filenameInput" && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const cardTitle = card?.querySelector(".media-title")?.textContent?.trim() || "";
      const filenameBefore = document.querySelector("#filenameInput")?.value || "";
      const qualityHiddenBefore = Boolean(document.querySelector("#variantLabel")?.hidden);
      const format = document.querySelector("#containerSelect");
      if (format) {
        format.value = "mp3";
        format.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return {
        cardCount: cards?.length || 0,
        cardTitle,
        candidateUrl: card?.querySelector(".media-url")?.title || "",
        secondaryActions: [...(card?.querySelectorAll(".more-button") || [])].map((node) => node.textContent.trim()),
        dialogOpen: Boolean(dialog?.open),
        initialFocus: document.activeElement?.id || "",
        filenameBefore,
        filenameAfter: document.querySelector("#filenameInput")?.value || "",
        formatOptions: [...(format?.options || [])].map((option) => ({ value: option.value, text: option.textContent.trim() })),
        qualityHiddenBefore,
        qualityHiddenAfter: Boolean(document.querySelector("#variantLabel")?.hidden),
        qualityOptions: [...(document.querySelector("#variantSelect")?.options || [])].map((option) => option.textContent.trim()),
        hasExtractCheckbox: Boolean(document.querySelector("#extractAudioInput")),
        hasConcurrencyInput: Boolean(document.querySelector("#concurrencyInput")),
        note: document.querySelector("#dialogNote")?.textContent?.trim() || "",
        dialogGeometry: (() => {
          const rect = dialog?.getBoundingClientRect();
          if (!rect) return null;
          const viewportWidth = document.documentElement.clientWidth;
          const viewportHeight = document.documentElement.clientHeight;
          const leftGap = rect.left;
          const rightGap = viewportWidth - rect.right;
          const topGap = rect.top;
          const bottomGap = viewportHeight - rect.bottom;
          return {
            viewportWidth,
            viewportHeight,
            left: rect.left,
            right: rect.right,
            top: rect.top,
            bottom: rect.bottom,
            leftGap,
            rightGap,
            topGap,
            bottomGap,
            horizontalDelta: Math.abs(leftGap - rightGap),
            verticalDelta: Math.abs(topGap - bottomGap)
          };
        })(),
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
      };
    })()`);
    item.result = result;
    assert.equal(result.cardCount, 1, "popup rendered duplicate cards for one HLS master");
    assert.equal(result.candidateUrl, expectedUrl, "popup rendered the wrong HLS representative");
    assert.deepEqual(result.secondaryActions, [], "stream cards still expose a duplicate parse action");
    assert.equal(result.dialogOpen, true, "Download did not open the HLS settings dialog");
    assert.equal(result.initialFocus, "filenameInput", "download dialog did not focus its first field");
    assert.equal(result.cardTitle, expectedTitle, "HLS card did not use the readable page title");
    assert.doesNotMatch(result.cardTitle, /an_PHRM|comp_v\d+|wm_cr|cc\d+/i,
      "HLS card exposes an internal asset-management token");
    const filesystemSafeTitle = result.cardTitle.replace(/[\\/:*?"<>|]/g, "_");
    assert.equal(result.filenameBefore, `${filesystemSafeTitle}.mp4`,
      "dialog filename is not the filesystem-safe form of the readable card/page title");
    assert.doesNotMatch(result.filenameBefore, /^[a-f0-9]{20,}\./i, "dialog filename fell back to an opaque asset hash");
    assert.doesNotMatch(result.filenameBefore, /an_PHRM|comp_v\d+|wm_cr|cc\d+/i,
      "dialog filename exposes an internal asset-management token");
    assert.ok(result.formatOptions.some((option) => option.value === "mp3" && /(仅音频|需本地下载引擎)/.test(option.text)),
      "MP3 is not a first-class output format");
    assert.equal(result.filenameAfter, `${filesystemSafeTitle}.mp3`, "choosing MP3 did not update the filename extension");
    assert.equal(result.hasExtractCheckbox, false, "the obsolete extract-audio checkbox is still present");
    assert.equal(result.hasConcurrencyInput, false, "per-download concurrency is still exposed in the popup");
    assert.equal(result.qualityHiddenBefore, false, "quality selection stayed hidden for a multi-rendition HLS master");
    assert.equal(result.qualityHiddenAfter, true, "quality selection stayed visible after switching to audio-only MP3");
    assert.equal(result.qualityOptions.length, HLS_RENDITIONS.length + 1,
      "quality selector must contain automatic plus five renditions");
    assert.match(result.qualityOptions[0], /自动选择最高画质/);
    for (const rendition of HLS_RENDITIONS) {
      assert.ok(result.qualityOptions.some((value) => new RegExp(`${rendition.width}\\s*×\\s*${rendition.height}`).test(value)),
        `${rendition.height}p rendition is missing`);
    }
    assert.match(result.note, /在线视频由许多小片段组成.*逐段下载并自动组合.*可直接播放的文件/);
    assert.ok(result.dialogGeometry, "download dialog geometry was not measurable");
    assert.ok(result.dialogGeometry.leftGap >= 0 && result.dialogGeometry.rightGap >= 0
      && result.dialogGeometry.topGap >= 0 && result.dialogGeometry.bottomGap >= 0,
    `download dialog is outside the viewport: ${JSON.stringify(result.dialogGeometry)}`);
    assert.ok(result.dialogGeometry.horizontalDelta <= 2,
      `download dialog is not horizontally centered: ${JSON.stringify(result.dialogGeometry)}`);
    assert.ok(result.dialogGeometry.verticalDelta <= 2,
      `download dialog is not vertically centered: ${JSON.stringify(result.dialogGeometry)}`);
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
      activeId: document.activeElement?.id || "",
      activeAction: document.activeElement?.dataset?.mediaAction || "",
      activeMediaId: document.activeElement?.dataset?.mediaId || "",
      focusEvents: globalThis.__phaseBDownloadDialogFocus,
      downloadActions: [...document.querySelectorAll('[data-media-action="download"]')].map((node) => ({ connected: node.isConnected, disabled: node.disabled, id: node.dataset.mediaId }))
    }))()`);
    assert.equal(restoredFocus.activeAction, "download", `closing download dialog did not restore focus to the media action: ${JSON.stringify(restoredFocus)}`);
    await evaluate(client, `document.querySelector(".media-card .download-button").click()`);
    await poll(async () => await evaluate(client, `document.querySelector("#downloadDialog").open`), CASE_TIMEOUT_MS, "reopened download dialog for visual evidence");

    const screenshot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, "hls-download-dialog.png");
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    item.screenshot = path.relative(HERE, screenshotPath);
    await captureMatrixState(client, "download-dialog", 372, 560, {
      dialog: "HLS multi-rendition settings",
      centered: true,
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
  const item = { name: "popup-manifest-loading", status: "running", viewport: { width: 372, height: 560 } };
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
    await setViewport(popup.client, 372, 560);
    const loading = await poll(async () => {
      const value = await evaluate(popup.client, `(() => {
        const cards = document.querySelectorAll(".media-card");
        const card = cards[0];
        const button = card?.querySelector(".download-button");
        if (cards.length !== 1 || !button) return null;
        if (!globalThis.__phaseBManifestStarted) {
          globalThis.__phaseBManifestStarted = true;
          globalThis.__phaseBManifestClickEvents = 0;
          button.addEventListener("click", () => { globalThis.__phaseBManifestClickEvents += 1; });
          button.click();
          button.click();
        }
        const status = card.querySelector(".manifest-status");
        return {
          cardCount: cards.length,
          cardBusy: card.getAttribute("aria-busy"),
          buttonBusy: button.getAttribute("aria-busy"),
          buttonDisabled: button.disabled,
          statusHidden: status?.hidden,
          statusText: status?.textContent.trim() || "",
          clickEvents: globalThis.__phaseBManifestClickEvents,
          dialogOpen: document.querySelector("#downloadDialog").open,
          overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth
        };
      })()`);
      return value?.cardBusy === "true" ? value : null;
    }, CASE_TIMEOUT_MS, "card-local manifest loading state");
    assert.equal(loading.cardCount, 1, "manifest-loading popup rendered duplicate cards");
    assert.equal(loading.buttonBusy, "true", "manifest-loading action did not expose aria-busy");
    assert.equal(loading.buttonDisabled, true, "manifest-loading action did not suppress repeated clicks");
    assert.equal(loading.clickEvents, 1, "the disabled pending action accepted a duplicate click event");
    assert.equal(loading.statusHidden, false, "manifest loading feedback is not local to the media card");
    assert.match(loading.statusText, /正在读取清晰度与流媒体信息/);
    assert.equal(loading.dialogOpen, false, "download dialog opened before manifest reading completed");
    assert.ok(loading.overflow <= 1, `manifest-loading popup overflows by ${loading.overflow}px`);
    const loadingRequestCount = await poll(async () => {
      const count = fixtureRequestCounts.get(requestKey) || 0;
      return count === initialRequestCount + 1 ? count : null;
    }, CASE_TIMEOUT_MS, "one user-initiated manifest probe request");
    assert.equal(loadingRequestCount - initialRequestCount, 1, "manifest double-click did not collapse to one probe request");
    await captureMatrixState(popup.client, "popup-manifest-loading", 372, 560, {
      localCardBusy: true,
      duplicateClicksSuppressed: true,
      hlsMasterRequestsBeforePopup: initialRequestCount,
      hlsMasterRequestsDuringProbe: loadingRequestCount - initialRequestCount
    });
    const settled = await poll(async () => {
      const value = await evaluate(popup.client, `(() => ({
        open: document.querySelector("#downloadDialog").open,
        cardBusy: document.querySelector(".media-card")?.getAttribute("aria-busy")
      }))()`);
      return value.open ? value : null;
    }, CASE_TIMEOUT_MS, "manifest-loading popup to settle");
    assert.equal(settled.cardBusy, null, "media card remained aria-busy after manifest reading");
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
    assert.equal(result.after?.ok, true, "GET_JOBS failed after native-boundary assertion");
    assert.deepEqual(result.after.jobs, result.before.jobs, "failed native preflight mutated the task list");
    assert.equal(walk(downloadDir, 5).some((value) => path.basename(value) === UI_DIRECT_FILENAME), false,
      "failed native preflight wrote a browser download");
    item.result = {
      response: { ok: result.response.ok, error: result.response.error },
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
      assert.equal(result.heading, "FluxCatch 设置");
      assert.equal(result.saveButton, "保存设置");
      assert.equal(result.labelledFields, true, "options contains an unlabelled field");
      assert.equal(result.nativePermissionGranted, false, "fresh E2E profile unexpectedly has nativeMessaging permission");
      assert.equal(result.nativePermissionButton, "开启本地下载引擎");
      assert.match(result.nativePermissionStatus || "", /需要开启/);
      assert.match(result.nativeConnection || "", /尚未授权/);
      assert.equal(result.nativeInstallGuideOpen, false, "ungranted native access should not show the host installation failure guide");
      assert.deepEqual(result.deadControls, [], "stable options still exposes unavailable controls");
      assert.equal(result.capabilities.length, 9, "options capability matrix is incomplete");
      const capabilityMap = Object.fromEntries(result.capabilities.map((entry) => [entry.feature, entry]));
      for (const feature of ["directMedia", "staticHls", "staticDash", "bilibiliDashPair"]) {
        assert.deepEqual(capabilityMap[feature], { feature, enabled: "true", status: "可用" });
      }
      assert.deepEqual(capabilityMap.separateAudioHls,
        { feature: "separateAudioHls", enabled: "true", status: "可用" });
      for (const feature of ["liveHls", "encryptedHls", "externalToolNetwork", "remoteThumbnails"]) {
        assert.deepEqual(capabilityMap[feature], { feature, enabled: "false", status: "未启用" });
      }
    } else if (name === "popup") {
      assert.equal(result.heading, "FluxCatch");
      assert.equal(result.workspaceButton, "打开媒体工作台");
      assert.equal(result.jobsVisible, true, "popup jobs tab did not activate");
      assert.equal(result.mediaVisible, true, "popup media tab did not reactivate");
      assert.deepEqual(result.tabs.map((tab) => tab.controls), ["mediaView", "jobsView"]);
      assert.ok(["本地下载引擎已就绪", "本地下载引擎暂未就绪"].includes(result.hostTitle));
      assert.doesNotMatch(`${result.hostTitle} ${result.hostDetail}`, /FFmpeg|DASH\s*(?:静态规划|原生)|本地高速引擎|v\d+\.\d+/i,
        "popup exposes internal acceleration implementation details");
      assert.equal(result.thumbnailCount, 0, "stable popup must not render a remotely fetched thumbnail");
      assert.ok(result.fallbackCount >= 1, "popup did not retain the media-type fallback tile");
      assert.deepEqual(result.scanPending, { busy: "true", disabled: true, state: "pending" }, "popup rescan did not expose a stable pending state");
      assert.ok(result.sharedStyles.some((value) => value.endsWith("/ui/tokens.css")), "popup does not load shared tokens");
      assert.ok(result.sharedStyles.some((value) => value.endsWith("/ui/components.css")), "popup does not load shared components");
    } else if (name === "sidepanel") {
      assert.equal(result.brand, "FluxCatch");
      assert.equal(result.mediaHeading, "当前页面媒体");
      assert.equal(result.jobsHeading, "下载任务");
      assert.ok(["本地下载引擎已就绪", "本地下载引擎暂未就绪"].includes(result.hostTitle));
      assert.doesNotMatch(`${result.hostTitle} ${result.hostDetail}`, /FFmpeg|DASH\s*(?:静态规划|原生)|本地高速引擎|v\d+\.\d+/i,
        "Side Panel exposes internal acceleration implementation details");
      assert.ok(result.quickDownloadButtons >= 1, "Side Panel did not render a quick-download action for the detected media");
      assert.equal(result.quickDownloadLabel, "检查并下载", "generic direct media did not expose the native preflight action");
      assert.equal(result.quickDownloadDescribedBy, "localEngineBoundary", "native preflight action lacks its permission boundary description");
      assert.equal(result.quickDownloadCreatedJob, false, "generic direct preflight created a job without native authorization");
      assert.equal(result.thumbnailCount, 0, "stable Side Panel must not render a remotely fetched thumbnail");
      assert.ok(result.fallbackCount >= 1, "Side Panel did not retain the media-type fallback tile");
      assert.equal(result.globalErrorHidden, true, "Side Panel reported an error during quick download");
      assert.equal(result.hasLiveRegions, true);
      assert.deepEqual(result.scanPending, { busy: "true", disabled: true, state: "pending" }, "Side Panel rescan did not expose a stable pending state");
      assert.ok(result.sharedStyles.some((value) => value.endsWith("/ui/tokens.css")), "Side Panel does not load shared tokens");
      assert.ok(result.sharedStyles.some((value) => value.endsWith("/ui/components.css")), "Side Panel does not load shared components");
    }
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    const screenshotPath = path.join(SCREENSHOT_DIR, `${name}.png`);
    fs.writeFileSync(screenshotPath, Buffer.from(screenshot.data, "base64"));
    item.screenshot = path.relative(HERE, screenshotPath);
    if (name === "popup") {
      await captureMatrixState(client, "popup-372x560", 372, 560, {
        deterministicFixture: "direct media",
        sharedStyles: true
      });
    } else if (name === "sidepanel") {
      await captureMatrixState(client, "sidepanel-420x820", 420, 820, {
        deterministicFixture: "generic direct media awaiting explicit native authorization",
        sharedStyles: true
      });
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
