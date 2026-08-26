import {
  bilibiliDashAssetFamily,
  bilibiliDashTrackId,
  canonicalizeUrl,
  classifyBilibiliDashTrack,
  classifyMedia,
  filenameFromCandidate,
  isBilibiliMediaUrl,
  isBilibiliVideoPage,
  isInstagramByteRangeFragment,
  isLikelySubtitleResource,
  normalizeMime,
  sanitizeFilename
} from "./lib/media.js";
import { parseHls, sortHlsVariants } from "./lib/hls.js";
import { parseDash } from "./lib/dash.js";
import { candidateForPersistence, candidateForUi, previewForPersistence } from "./lib/candidate-public.js";
import { CANDIDATE_PROVENANCES, evaluateNetworkRequest, requireNetworkRequest } from "./lib/network-policy.js";
import { hostEventForUi, hostStatusForUi } from "./lib/host-public.js";
import { BUILD_PROFILE, HOST_MISMATCH_MESSAGE, buildDiagnostics, hostCompatibility } from "./lib/build-profile.js";

const HOST_NAME = "io.github.blanchot_alice.fluxcatch";
const NATIVE_API_BINDING_WAIT_MS = 500;
const NATIVE_API_RECOVERY_KEY = "nativeApiRecovery";
const NATIVE_API_RECOVERY_WAIT_MS = 35_000;
const NATIVE_API_RECOVERY_TTL_MS = 2 * 60_000;
const NATIVE_API_RECOVERY_RESUME_LIMIT = 2;
const NATIVE_API_UNAVAILABLE_MESSAGE = "本地下载引擎权限已开启，Chrome 正在初始化连接接口。FluxCatch 将自动重试。";
const NATIVE_API_RESTART_MESSAGE = "本地下载引擎权限已开启，但 Chrome 的连接接口长期未恢复。请完全退出并重新启动 Chrome，返回后点击“重新检查”。";
const NATIVE_HOST_MISSING_MESSAGE = "本地下载引擎尚未安装或未注册。从源码使用时请运行 ./scripts/native-install-wrapper.sh；从 Native ZIP 使用时请运行 ./install-macos.sh。";
const NATIVE_CONNECTION_FAILED_MESSAGE = "暂时未能连接本地引擎。请稍后点击“重新检查”；若持续失败，请在 chrome://extensions 中查看 FluxCatch 的错误。";
const EXTENSION_ORIGIN = chrome.runtime.getURL("");
const MAX_ITEMS_PER_TAB = 160;
const HEADER_TTL_MS = 5 * 60 * 1000;
const PENDING_HEADER_TTL_MS = 60 * 1000;
const MAX_PENDING_HEADER_REQUESTS = 1600;
const MAX_CAPTURED_HEADERS_BYTES = 64 * 1024;
const MAX_CAPTURED_HEADERS_GLOBAL_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_IDENTITY_KEY_LENGTH = 16_416;
const MANIFEST_INSPECTION_TIMEOUT_MS = 7_000;
const MAX_MANIFEST_CACHE_CHARS_PER_TAB = 4_000_000;
const MAX_MANIFEST_CACHE_CHARS_GLOBAL = 12_000_000;
const MAX_MANIFEST_SELECTOR_MAPPINGS = 512;
const MAX_STORED_JOBS = 200;
const JOB_PROGRESS_PERSIST_INTERVAL_MS = 1_000;
const MAX_THUMBNAIL_URL_LENGTH = 4096;
const BILIBILI_DISCOVERY_TTL_MS = 45_000;
const BILIBILI_AUTOMATIC_RETRY_COOLDOWN_MS = 5_000;
const BILIBILI_OBSERVED_METADATA_TIMEOUT_MS = 2_000;
const BILIBILI_TRACK_TTL_MS = 2 * 60_000;
const BILIBILI_PAIR_WINDOW_MS = 30_000;
const BILIBILI_SAFE_REFERER = "https://www.bilibili.com/";
const DASH_PAIR_SELECTOR_ORIGIN = "https://fluxcatch.invalid";
const MANIFEST_SELECTOR_ORIGIN = "https://fluxcatch.invalid";
// 0.2.5 has no pinned broker for external tools. Keep the adapter source for
// the future GitHub build, but compile every setting/candidate/download gate
// closed regardless of what an older or replacement native host reports.
const SENSITIVE_REQUEST_HEADERS = new Set(["authorization", "cookie", "origin", "referer"]);
const UI_PORT_NAMES = new Set(["fluxcatch-popup", "fluxcatch-sidepanel"]);
const JOB_STATUSES = new Set(["queued", "starting", "downloading", "remuxing", "completed", "failed", "cancelled"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CONTENT_SOURCES = new Set([
  "content", "dom", "loadedmetadata", "durationchange", "mutation",
  "source-element", "metadata", "site-payload", "instagram-api-response", "x-api-response"
]);
const CONTENT_MESSAGE_TYPES = new Set(["CONTENT_MEDIA", "PAGE_PREVIEW"]);
const PAGE_PREVIEW_PRIORITIES = new Map([
  ["poster", 600],
  ["og:image:secure_url", 500],
  ["og:image", 490],
  ["twitter:image", 480],
  ["thumbnailUrl", 470],
  ["image_src", 460]
]);
const POLICY_BLOCKED_DOMAINS = Object.freeze(["youtube.com", "youtu.be", "googlevideo.com"]);
// Minimal site-adapter registry: page URL matchers give detected media their
// site label, and tab completion fans out to per-site discovery. Bilibili
// keeps its dedicated DASH machinery; YouTube is an experimental opt-in that
// delegates the actual transfer to the local yt-dlp engine via the native
// host; Instagram/X reuse the generic content-script + webRequest pipeline.
const SITE_ADAPTERS = Object.freeze([
  {
    id: "bilibili",
    label: "Bilibili",
    pagePattern: /^https?:\/\/(?:www\.|m\.)?bilibili\.com\/video\//i,
    imageHostSuffixes: ["hdslb.com", "biliimg.com"]
  },
  {
    id: "youtube",
    label: "YouTube",
    experimental: true,
    pagePattern: /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/watch\b/i
  },
  {
    id: "instagram",
    label: "Instagram",
    pagePattern: /^https?:\/\/(?:www\.)?instagram\.com\/(?:p|reel|reels|tv)\/[A-Za-z0-9_-]+/i,
    mediaHostPattern: /(?:^|\.)(?:cdninstagram\.com|fbcdn\.net)$/i,
    imageHostSuffixes: ["cdninstagram.com", "fbcdn.net"]
  },
  {
    id: "twitter",
    label: "X",
    pagePattern: /^https?:\/\/(?:www\.|mobile\.)?(?:twitter|x)\.com\/[^/?#]+\/status\/\d+/i,
    mediaHostPattern: /(?:^|\.)twimg\.com$/i,
    imageHostSuffixes: ["twimg.com"]
  }
]);

function siteAdapterForPageUrl(url) {
  const value = canonicalizeUrl(url);
  if (!value) return null;
  return SITE_ADAPTERS.find((adapter) => adapter.pagePattern.test(value)) || null;
}

function siteAdapterForMediaUrl(url) {
  const value = canonicalizeUrl(url);
  if (!value) return null;
  let host = "";
  try { host = new URL(value).hostname.toLowerCase(); } catch { return null; }
  if (isBilibiliMediaUrl(value)) return SITE_ADAPTERS.find((adapter) => adapter.id === "bilibili");
  return SITE_ADAPTERS.find((adapter) => adapter.mediaHostPattern?.test(host)) || null;
}

function isTrustedInstagramBrowserDirectCandidate(candidate) {
  const url = canonicalizeUrl(candidate?.url);
  if (!url || candidate?.kind !== "video" || candidate?.site !== "instagram") return false;
  if (!["site_payload", "dom_metadata", "observed_response"].includes(candidate?.provenance)) return false;
  if (siteAdapterForPageUrl(candidate?.tabUrl)?.id !== "instagram") return false;
  if (siteAdapterForMediaUrl(url)?.id !== "instagram" || isInstagramByteRangeFragment(url)) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && /\.mp4$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function candidateHasSource(candidate, source) {
  return candidate?.source === source || (Array.isArray(candidate?.sources) && candidate.sources.includes(source));
}

function isTrustedXBrowserDirectCandidate(candidate) {
  const url = canonicalizeUrl(candidate?.url);
  if (!url || candidate?.kind !== "video" || candidate?.site !== "twitter") return false;
  if (!["site_payload", "observed_response"].includes(candidate?.provenance)) return false;
  if (candidate?.provenance !== "observed_response"
    && !candidateHasSource(candidate, "x-api-response")
    && !candidateHasSource(candidate, "site-payload")) return false;
  try {
    const page = new URL(candidate.tabUrl);
    const media = new URL(url);
    const pageHost = page.hostname.toLowerCase();
    return page.protocol === "https:"
      && (pageHost === "x.com" || pageHost.endsWith(".x.com") || pageHost === "twitter.com" || pageHost.endsWith(".twitter.com"))
      && media.protocol === "https:"
      && !media.username
      && !media.password
      && media.hostname.toLowerCase() === "video.twimg.com";
  } catch {
    return false;
  }
}

// Canonical watch URL for the page candidate handed to the local yt-dlp engine.
function youtubeWatchUrl(url) {
  const value = canonicalizeUrl(url);
  if (!value) return null;
  let parsed;
  try { parsed = new URL(value); } catch { return null; }
  const host = parsed.hostname.toLowerCase();
  const id = host === "youtu.be" ? parsed.pathname.slice(1) : parsed.searchParams.get("v");
  if (!id || !/^[\w-]{6,20}$/.test(id)) return null;
  if (host === "youtu.be" || host.endsWith("youtube.com")) return `https://www.youtube.com/watch?v=${id}`;
  return null;
}

const DEFAULT_SETTINGS = {
  concurrentFragments: 8,
  concurrentRanges: 8,
  outputContainer: "mp4",
  saveAs: false,
  useNativeForDirect: false,
  minimumBytes: 500 * 1024,
  liveDuration: 0,
  youtubeEnabled: false,
  autoEnrichSiteQuality: true,
  allowPrivateNetworkMedia: false,
  blockedDomains: [],
  filenameTemplate: "{title}",
  showNotifications: false
};

const tabMedia = new Map();
const tabGenerations = new Map();
const tabPreviews = new Map();
const siteCandidateRecoveryInFlight = new Map();
const requestHeaders = new Map();
const pendingRequestHeaders = new Map();
const hostClients = new Set();
const popupClients = new Set();
const browserDownloads = new Set();
// chrome.downloads.cancel() can synchronously emit an "interrupted" change
// before its promise resolves. Remember our intent before calling Chrome so
// that event is not committed as a failure and allowed to win the terminal
// state race.
const browserCancellationRequested = new Set();
const jobs = new Map();
const jobHeaderKeys = new Map();
const manifestInspectionInFlight = new Map();
const manifestInspectionAttempted = new Set();
const bilibiliDashStates = new Map();
const bilibiliDiscoveryInFlight = new Map();
const bilibiliDiscoveryAt = new Map();
const bilibiliAutomaticDiscoveryAttemptAt = new Map();
const bilibiliObservationChains = new Map();
const bilibiliPruneTimers = new Map();
const bilibiliTabTokens = new Map();
let headerPruneTimer = null;
let jobPersistTimer = null;
let nativePort = null;
let nativeConnectPromise = null;
const pendingHostPings = new Map();
let hostStatus = {
  connected: false,
  version: null,
  protocolVersion: null,
  capabilityProfileVersion: null,
  ffmpeg: false,
  capabilities: null,
  needsPermission: true,
  failureReason: null,
  lastError: null
};

// Register listeners synchronously, but make every state consumer wait for the
// MV3 session restore so early webRequest/content events cannot be overwritten.
const sessionReady = restoreSession();
const nativeRecoveryReady = prepareNativeApiRecoveryAtStartup();

chrome.permissions.onRemoved?.addListener((permissions) => {
  if (!permissions?.permissions?.includes("nativeMessaging")) return;
  void handleNativePermissionRemoved();
});

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url) return;
    const url = canonicalizeUrl(details.url);
    if (!url) return;
    const routeGeneration = currentTabGeneration(details.tabId);
    const documentId = cleanText(details.documentId, 128);
    // Bind a Bilibili request to the tab generation in which it started. A
    // response from the previous History API route must not be classified
    // against the URL that happens to be current when the response arrives.
    const bilibiliGeneration = isBilibiliMediaUrl(url) ? bilibiliTabToken(details.tabId) : null;
    // With automatic quality enrichment enabled, the first trusted Bilibili
    // media signal for a page (playback or preload) may complete its DASH pair.
    // triggerSiteDiscovery checks the setting before any fixed-site API I/O;
    // discoverBilibiliDash then coalesces Range repeats with its in-flight,
    // success-TTL and failed-attempt cooldown guards.
    if (bilibiliGeneration) {
      void triggerSiteDiscovery(details.tabId, {
        automatic: true,
        observedPlayback: true,
        observedMediaUrl: url,
        expectedTabToken: bilibiliGeneration
      });
    }
    const allowed = new Set(["accept", "authorization", "cookie", "origin", "referer", "user-agent"]);
    const headers = {};
    let capturedBytes = 0;
    for (const header of details.requestHeaders || []) {
      const key = String(header.name || "").toLowerCase();
      if (!allowed.has(key) || typeof header.value !== "string" || /[\r\n]/.test(header.value)) continue;
      const bytes = new TextEncoder().encode(`${key}: ${header.value}`).byteLength;
      if (bytes > 32 * 1024 || capturedBytes + bytes > MAX_CAPTURED_HEADERS_BYTES) continue;
      headers[key] = header.value;
      capturedBytes += bytes;
    }
    // Keep a bounded route record even when no reusable headers exist. A later
    // response without the generation/document that initiated it must not be
    // attached to whatever page happens to occupy the tab after navigation.
    pendingRequestHeaders.set(details.requestId, {
      headers,
      bytes: capturedBytes,
      at: Date.now(),
      tabId: details.tabId,
      url,
      routeGeneration,
      documentId,
      bilibiliGeneration
    });
    pruneHeaders();
  },
  { urls: ["http://*/*", "https://*/*"], types: ["media", "xmlhttprequest", "other"] },
  ["requestHeaders", "extraHeaders"]
);

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url) return;
    const headers = headerObject(details.responseHeaders || []);
    const mime = normalizeMime(headers["content-type"] || "");
    const bodyLength = Number.parseInt(headers["content-length"] || "0", 10) || 0;
    const rangeLength = contentRangeTotal(headers["content-range"]);
    const contentLength = Math.max(bodyLength, rangeLength);
    const suggestedFilename = contentDispositionFilename(headers["content-disposition"]);
    const classification = classifyMedia({
      url: details.url,
      mime,
      resourceType: details.type,
      contentLength
    });
    const pending = pendingRequestHeaders.get(details.requestId);
    pendingRequestHeaders.delete(details.requestId);
    const routeIsCurrent = Boolean(
      pending
      && pending.tabId === details.tabId
      && pending.routeGeneration
      && tabGenerations.get(details.tabId) === pending.routeGeneration
      && (!pending.documentId || pending.documentId === cleanText(details.documentId, 128))
    );
    if (routeIsCurrent && classification?.kind === "segment") {
      queueBilibiliDashObservation(details, {
        mime,
        contentLength,
        rangeSupported: rangeLength > 0 || /bytes/i.test(headers["accept-ranges"] || ""),
        headers: nonSensitiveMediaHeaders(pending?.headers)
      }, pending?.bilibiliGeneration);
    }
    if (routeIsCurrent && classification && classification.kind !== "segment" && pending?.headers && !isPolicyBlocked(details.url)) {
      const finalUrl = canonicalizeUrl(details.url);
      if (finalUrl) {
        const promotedHeaders = sameOrigin(pending.url, finalUrl)
          ? pending.headers
          : Object.fromEntries(Object.entries(pending.headers).filter(([key]) => !SENSITIVE_REQUEST_HEADERS.has(key)));
        requestHeaders.set(headerKey(details.tabId, finalUrl), {
          headers: promotedHeaders,
          bytes: capturedHeadersByteLength(promotedHeaders),
          at: Date.now(),
          tabId: details.tabId,
          requestId: details.requestId
        });
        scheduleHeaderPrune();
      }
    }
    if (!routeIsCurrent || !classification || classification.kind === "segment") return;
    void addCandidate(details.tabId, {
      url: details.url,
      mime,
      contentLength,
      resourceType: details.type,
      rangeSupported: rangeLength > 0 || /bytes/i.test(headers["accept-ranges"] || ""),
      suggestedFilename,
      routeGeneration: pending.routeGeneration,
      documentId: pending.documentId,
      source: "webRequest",
      provenance: "observed_response",
      ...classification
    }, () => tabGenerations.get(details.tabId) === pending.routeGeneration);
  },
  { urls: ["http://*/*", "https://*/*"], types: ["media", "xmlhttprequest", "other"] },
  ["responseHeaders", "extraHeaders"]
);

for (const event of [chrome.webRequest.onCompleted, chrome.webRequest.onErrorOccurred]) {
  event?.addListener(
    (details) => pendingRequestHeaders.delete(details.requestId),
    { urls: ["http://*/*", "https://*/*"], types: ["media", "xmlhttprequest", "other"] }
  );
}

chrome.runtime.onConnect.addListener((port) => {
  if (!UI_PORT_NAMES.has(port.name) || !isExtensionPage(port.sender)) return;
  hostClients.add(port);
  if (port.name === "fluxcatch-popup") popupClients.add(port);
  port.onDisconnect.addListener(() => {
    hostClients.delete(port);
    if (port.name !== "fluxcatch-popup") return;
    popupClients.delete(port);
    // Job history is shared with the persistent Side Panel. Closing a transient
    // popup must never mutate that shared state; ended jobs are removed only by
    // the explicit CLEAR_COMPLETED_JOBS action.
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => {
      const response = { ok: false, error: error?.message || String(error) };
      const jobId = cleanText(error?.jobId, 128);
      if (jobId) response.jobId = jobId;
      sendResponse(response);
    });
  return true;
});

chrome.tabs.onRemoved.addListener((tabId) => {
  invalidateBilibiliTabGeneration(tabId);
  void clearTabAfterRestore(tabId, false);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading" || typeof changeInfo.url === "string") {
    // History API navigations can report only changeInfo.url. Rotate the token
    // synchronously so both in-flight API discovery and old webRequest replies
    // fail their commit guards before asynchronous cleanup begins.
    invalidateBilibiliTabGeneration(tabId);
    void clearTabAfterRestore(tabId, true);
    return;
  }
  // Page completion alone is not a trusted media signal. Automatic Bilibili
  // enrichment starts only from the observed media-request path above.
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  // Chrome keeps per-tab badge text across service-worker restarts, but media
  // restored from storage.session has no badge until something re-applies it.
  void refreshTabBadge(tabId);
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!browserDownloads.has(delta.id)) return;
  void updateBrowserDownload(delta);
});

function recoverableSiteForPage(url) {
  try {
    const page = new URL(url);
    const host = page.hostname.toLowerCase();
    if (siteAdapterForPageUrl(page.href)?.id === "instagram") return "instagram";
    if (page.protocol === "https:"
      && (host === "x.com" || host.endsWith(".x.com") || host === "twitter.com" || host.endsWith(".twitter.com"))) return "twitter";
  } catch { /* Non-web tabs have no site cache. */ }
  return "";
}

async function refreshCachedSiteCandidates(tabId) {
  if (siteCandidateRecoveryInFlight.has(tabId)) return siteCandidateRecoveryInFlight.get(tabId);
  const routeGeneration = currentTabGeneration(tabId);
  const routeGuard = () => tabGenerations.get(tabId) === routeGeneration;
  const task = (async () => {
    if (typeof chrome.tabs.sendMessage !== "function") return;
    let tab;
    try { tab = await chrome.tabs.get(tabId); } catch { return; }
    const startUrl = canonicalizeUrl(tab?.url);
    const site = recoverableSiteForPage(startUrl);
    if (!site) return;
    const current = [...(tabMedia.get(tabId)?.values() || [])];
    const alreadyRecovered = site === "instagram"
      ? current.some((item) => candidateHasSource(item, "instagram-api-response") && isTrustedInstagramBrowserDirectCandidate(item))
      : current.some((item) => isTrustedXBrowserDirectCandidate(item));
    if (alreadyRecovered) return;

    let response;
    try {
      response = await chrome.tabs.sendMessage(tabId, { type: "GET_CACHED_SITE_MEDIA" }, { frameId: 0 });
    } catch { return; }
    const items = Array.isArray(response?.items) ? response.items.slice(0, 64) : [];
    if (!items.length) return;
    let liveTab;
    try { liveTab = await chrome.tabs.get(tabId); } catch { return; }
    if (!routeGuard() || canonicalizeUrl(liveTab?.url) !== startUrl) return;
    const sender = { id: chrome.runtime.id, frameId: 0, url: startUrl, tab: liveTab };
    for (const item of items) {
      const validated = await validateContentCandidate(item, sender);
      if (validated && routeGuard()) await addCandidate(tabId, {
        ...validated,
        routeGeneration
      }, routeGuard);
    }
  })();
  siteCandidateRecoveryInFlight.set(tabId, task);
  try {
    await task;
  } finally {
    if (siteCandidateRecoveryInFlight.get(tabId) === task) siteCandidateRecoveryInFlight.delete(tabId);
  }
}

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("消息格式无效");
  const earlyContentSender = CONTENT_MESSAGE_TYPES.has(message.type) && isContentSender(sender);
  const contentRoute = earlyContentSender ? {
    tabId: sender.tab.id,
    generation: currentTabGeneration(sender.tab.id),
    documentId: cleanText(sender.documentId, 128),
    tabUrl: canonicalizeUrl(sender.tab?.url)
  } : null;
  const contentRouteGuard = () => Boolean(
    contentRoute
    && tabGenerations.get(contentRoute.tabId) === contentRoute.generation
  );
  await sessionReady;
  const fromContent = isContentSender(sender);
  const fromExtensionPage = isExtensionPage(sender);
  if (CONTENT_MESSAGE_TYPES.has(message.type) ? !fromContent : !fromExtensionPage) {
    throw new Error("消息来源未通过校验");
  }
  switch (message.type) {
    case "CONTENT_MEDIA": {
      const tabId = sender.tab?.id;
      if (!contentRouteGuard()) return { ignored: true };
      const data = await validateContentCandidate(message.data, sender);
      if (!data || !contentRouteGuard()) return { ignored: true };
      let liveTab;
      try { liveTab = await chrome.tabs.get(tabId); } catch { return { ignored: true }; }
      if (!contentRouteGuard() || (contentRoute.tabUrl && canonicalizeUrl(liveTab?.url) !== contentRoute.tabUrl)) return { ignored: true };
      const accepted = await addCandidate(tabId, {
        ...data,
        routeGeneration: contentRoute.generation,
        documentId: contentRoute.documentId
      }, contentRouteGuard);
      return accepted ? { accepted: true } : { ignored: true };
    }
    case "PAGE_PREVIEW": {
      const tabId = sender.tab?.id;
      if (!contentRouteGuard()) return { ignored: true };
      const preview = await validatePagePreview(message.data, sender);
      if (!preview || !contentRouteGuard()) return { ignored: true };
      await setTabPreview(tabId, preview, contentRouteGuard);
      return contentRouteGuard() ? { accepted: true } : { ignored: true };
    }
    case "GET_TAB_MEDIA": {
      const tabId = validTabId(message.tabId);
      // Signed site URLs are intentionally excluded from storage.session. A
      // still-open content script keeps a small, page-scoped memory cache so a
      // restarted MV3 worker can recover the current Instagram/X candidate.
      await refreshCachedSiteCandidates(tabId);
      await expireBilibiliState(tabId);
      // Reading the current media list is deliberately side-effect free for
      // site discovery. Opening or closing popup/Side Panel must not be what
      // creates a Bilibili candidate or changes its toolbar badge; trusted
      // playback traffic and the explicit SCAN_TAB action own that work.
      await maybeAddYouTubeCandidate(tabId);
      const settings = await getSettings();
      const items = [...(tabMedia.get(tabId)?.values() || [])]
        .filter((item) => item.kind !== "segment" && !item.mergedInto)
        .filter((item) => item.kind !== "dash_pair" || isFreshBilibiliCandidate(item))
        .filter((item) => item.kind !== "youtube" || settings.youtubeEnabled)
        .sort((a, b) => candidateScore(b) - candidateScore(a) || b.lastSeen - a.lastSeen)
        .map(withoutManifestText);
      return { items, hostStatus: hostStatusForUi(hostStatus), settings };
    }
    case "GET_JOBS":
      return { jobs: jobsForUi(), hostStatus: hostStatusForUi(hostStatus) };
    case "CLEAR_COMPLETED_JOBS": {
      // Keep the legacy message name for compatibility, but "completed" here
      // means every ended state: saved, failed, or cancelled.
      return clearTerminalJobs();
    }
    case "CLEAR_TAB": {
      const tabId = validTabId(message.tabId);
      try { await chrome.tabs.sendMessage(tabId, { type: "CLEAR_CACHED_SITE_MEDIA" }, { frameId: 0 }); } catch { /* restricted or closed page */ }
      dropTabState(tabId);
      await persistSession();
      await updateBadge(tabId);
      return { removedJobs: 0, jobs: jobsForUi() };
    }
    case "SCAN_TAB": {
      const tabId = validTabId(message.tabId);
      try { await chrome.tabs.sendMessage(tabId, { type: "REQUEST_SCAN" }); } catch { /* restricted page */ }
      await discoverBilibiliDash(tabId, true);
      await maybeAddYouTubeCandidate(tabId);
      return {};
    }
    case "RELOAD_TAB": {
      const tabId = validTabId(message.tabId);
      await chrome.tabs.reload(tabId, { bypassCache: Boolean(message.bypassCache) });
      return {};
    }
    case "SHOW_DOWNLOAD_FOLDER":
      await chrome.downloads.showDefaultFolder();
      return {};
    case "PROBE_MANIFEST": {
      const tabId = validTabId(message.tabId);
      const candidate = requireTabCandidate(tabId, message.candidate);
      if (candidate.kind === "dash_pair") return { probe: dashPairProbeForUi(candidate) };
      const settings = await getSettings();
      const inspection = await probeManifest(candidate, {
        userInitiated: true,
        networkScope: networkScopeForSettings(settings)
      });
      await recordManifestInspection(tabId, candidate, inspection);
      return { probe: probeForUi(inspection, candidate) };
    }
    case "DOWNLOAD": {
      const tabId = validTabId(message.tabId);
      return startDownload(requireTabCandidate(tabId, message.candidate), message.options || {}, tabId);
    }
    case "PING_HOST": {
      await nativeRecoveryReady;
      if (!await hasNativePermission()) {
        hostStatus = disconnectedHostStatus({ needsPermission: true });
        return { hostStatus: hostStatusForUi(hostStatus) };
      }
      try {
        const port = await ensureNativePort({ requireCompatibility: false });
        // A live port answers with capabilities probed when its process started;
        // yt-dlp may have been installed or upgraded since. Force a fresh ping
        // round-trip so the UI's "重新检查" reports the machine's current state
        // instead of a stale snapshot. The host re-probes yt-dlp on every ping.
        if (nativePort === port && hostStatus.connected) {
          try {
            await pingNativePort(port);
          } catch (error) {
            if (nativePort === port) {
              nativePort = null;
              const failure = nativeConnectionFailure(error);
              hostStatus = disconnectedHostStatus(failure);
              try { port.disconnect?.(); } catch { /* The failed port may already be closed. */ }
              void handleNativeDisconnect(failure.lastError);
            }
          }
        }
      } catch {
        // Connection failures are represented by the public host state below.
        // PING_HOST is a status probe, so callers should not have to parse raw
        // Chrome errors to distinguish permission, API binding and install state.
      }
      return { hostStatus: hostStatusForUi(hostStatus) };
    }
    case "RECOVER_NATIVE_API":
      return recoverNativeMessagingApi();
    case "CANCEL_JOB": {
      const jobId = cleanText(message.jobId, 128);
      if (!jobId) throw new Error("任务编号无效");
      const job = jobs.get(jobId);
      if (job?.method === "browser" && Number.isInteger(job.downloadId)) {
        browserCancellationRequested.add(job.downloadId);
        try {
          await chrome.downloads.cancel(job.downloadId);
          await mergeJob(jobId, { status: "cancelled", message: "任务已取消", error: "", speed: 0 });
          browserDownloads.delete(job.downloadId);
          browserCancellationRequested.delete(job.downloadId);
          return {};
        } catch (error) {
          // A rejected cancellation must not make a later, unrelated browser
          // interruption look user-requested.
          browserCancellationRequested.delete(job.downloadId);
          throw error;
        }
      }
      const port = await ensureNativePort();
      port.postMessage({ type: "cancel", jobId });
      return {};
    }
    case "GET_SETTINGS":
      return { settings: await getSettings() };
    case "GET_DIAGNOSTICS":
      return {
        diagnostics: buildDiagnostics({
          extensionId: chrome.runtime.id,
          manifestVersion: chrome.runtime.getManifest().version,
          hostStatus
        })
      };
    case "SAVE_SETTINGS": {
      const requested = normalizeSettings(message.settings);
      const settings = {
        ...requested,
        // The 0.2.5 build gate is closed. A caller cannot persist the
        // experimental switch by forging a capability response.
        youtubeEnabled: requested.youtubeEnabled && ytdlpNetworkAllowed()
      };
      await chrome.storage.local.set({ settings });
      return { settings };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

function dashPairProbeForUi(candidate) {
  const now = Date.now();
  if (!isFreshBilibiliCandidate(candidate, now)) throw new Error("视频清晰度地址已过期，请重新扫描页面");
  const audios = (candidate.audioTracks || []).filter((track) => isFreshBilibiliTrack(track, now));
  const ranked = (candidate.videoTracks || [])
    .filter((track) => isFreshBilibiliTrack(track, now))
    .filter((video) => audios.some((audio) => canPairBilibiliTracks(video, audio, true)))
    .sort((a, b) => Number(b.height || 0) - Number(a.height || 0)
      || bilibiliVideoCompatibilityRank(b) - bilibiliVideoCompatibilityRank(a)
      || Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
      || Number(b.lastSeen || 0) - Number(a.lastSeen || 0))
    .map((track) => ({
      // The popup treats this as an opaque option value. Never disclose the
      // short-lived CDN signature outside the worker's private state.
      url: dashPairTrackSelector(candidate, track),
      id: cleanText(track.representationId, 32),
      bandwidth: positive(track.bandwidth) || 0,
      width: positive(track.width),
      height: positive(track.height),
      codecs: cleanText(track.codecs, 120),
      mime: normalizeMime(track.mime || "video/mp4")
    }))
    .filter((track) => track.url);
  const seenQualities = new Set();
  const variants = ranked.filter((track) => {
    const quality = track.height ? `${track.width || 0}x${track.height}` : `id:${track.id}`;
    if (seenQualities.has(quality)) return false;
    seenQualities.add(quality);
    return true;
  });
  return {
    kind: "dash_pair",
    type: "static",
    variants,
    audioTrackCount: Array.isArray(candidate.audioTracks) ? candidate.audioTracks.length : 0,
    duration: positive(candidate.duration),
    protected: false
  };
}

function bilibiliVideoIdentity(tabUrl) {
  try {
    const parsed = new URL(tabUrl);
    if (!isBilibiliVideoPage(parsed.href)) return null;
    const match = parsed.pathname.match(/^\/video\/(BV[a-z0-9]+|av(\d+))(?:\/|$)/i);
    if (!match) return null;
    const page = boundedInt(parsed.searchParams.get("p"), 1, 10_000, 1);
    return match[1].toLowerCase().startsWith("av")
      ? { key: "avid", value: match[2], page }
      : { key: "bvid", value: match[1], page };
  } catch {
    return null;
  }
}

function bilibiliPageKey(tabUrl) {
  const identity = bilibiliVideoIdentity(tabUrl);
  return identity ? `${identity.key}:${identity.value}:p${identity.page}` : "";
}

function bilibiliCidFromMediaUrl(value) {
  try {
    const parsed = new URL(value);
    if (!isBilibiliMediaUrl(parsed.href)) return null;
    const basename = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    const match = basename.match(/^(\d{1,20})-\d{1,4}-30[0-2]\d{2}\.(?:m4s|cmfv|cmfa)$/i);
    if (!match) return null;
    const cid = Number(match[1]);
    return Number.isSafeInteger(cid) && cid > 0 ? cid : null;
  } catch {
    return null;
  }
}

function publicBilibiliPageUrl(tabUrl) {
  const identity = bilibiliVideoIdentity(tabUrl);
  if (!identity) return null;
  const page = new URL(`https://www.bilibili.com/video/${identity.key === "avid" ? `av${identity.value}` : identity.value}/`);
  if (identity.page > 1) page.searchParams.set("p", String(identity.page));
  return page.href;
}

async function discoverBilibiliDash(tabId, force = false, {
  automatic = false,
  expectedTabToken = null,
  observedMediaUrl = null
} = {}) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return false; }
  if (expectedTabToken && bilibiliTabTokens.get(tabId) !== expectedTabToken) return false;
  const video = bilibiliVideoIdentity(tab?.url);
  if (!video) return false;
  const tabToken = bilibiliTabToken(tabId);
  const pageKey = `${video.key}:${video.value}:p${video.page}`;
  const now = Date.now();
  const previousDiscovery = bilibiliDiscoveryAt.get(tabId);
  if (!force && previousDiscovery?.pageKey === pageKey && now - previousDiscovery.at < BILIBILI_DISCOVERY_TTL_MS) return true;
  const existingDiscovery = bilibiliDiscoveryInFlight.get(tabId);
  if (existingDiscovery?.pageKey === pageKey) return existingDiscovery.promise;
  const previousAutomaticAttempt = bilibiliAutomaticDiscoveryAttemptAt.get(tabId);
  if (automatic && !force && previousAutomaticAttempt?.pageKey === pageKey
      && now - previousAutomaticAttempt.at < BILIBILI_AUTOMATIC_RETRY_COOLDOWN_MS) return false;
  // A playback/preload stream can issue many short Range requests. Record the
  // automatic attempt before starting I/O so both successful and failed fixed-
  // endpoint lookups receive the same cooldown. Explicit rescans use `force`
  // and remain able to retry immediately.
  if (automatic) bilibiliAutomaticDiscoveryAttemptAt.set(tabId, { pageKey, at: now });
  const task = (async () => {
    const observedDeadlineAt = observedMediaUrl ? Date.now() + BILIBILI_OBSERVED_METADATA_TIMEOUT_MS : 0;
    const observedTimeRemaining = () => Math.max(0, observedDeadlineAt - Date.now());
    // Bilibili's immutable DASH object name starts with the numeric cid. When
    // a strictly validated media request triggered discovery, use that cid
    // directly and avoid the extra pagelist round trip. This keeps the normal
    // playback-to-badge path inside the three-second UI budget.
    let cid = bilibiliCidFromMediaUrl(observedMediaUrl);
    if (!cid) {
      if (observedDeadlineAt && observedTimeRemaining() < 250) return false;
      const pageListUrl = new URL("https://api.bilibili.com/x/player/pagelist");
      pageListUrl.searchParams.set(video.key, video.value);
      const pages = await fetchPublicJson(pageListUrl.href, {
        credentials: "include",
        timeoutMs: observedDeadlineAt ? observedTimeRemaining() : 3_000
      });
      if (pages?.code !== 0 || !Array.isArray(pages.data) || !pages.data.length) return false;
      const page = pages.data[Math.min(video.page - 1, pages.data.length - 1)] || pages.data[0];
      cid = Number(page?.cid);
    }
    if (!Number.isSafeInteger(cid) || cid <= 0) return false;
    const playUrl = new URL("https://api.bilibili.com/x/player/playurl");
    playUrl.searchParams.set(video.key, video.value);
    playUrl.searchParams.set("cid", String(cid));
    playUrl.searchParams.set("qn", "127");
    playUrl.searchParams.set("fnval", "16");
    playUrl.searchParams.set("fourk", "1");
    if (observedDeadlineAt && observedTimeRemaining() < 250) return false;
    const play = await fetchPublicJson(playUrl.href, {
      credentials: "include",
      timeoutMs: observedDeadlineAt ? observedTimeRemaining() : 3_000
    });
    const dash = play?.code === 0 && play?.data?.dash;
    if (!dash || typeof dash !== "object") return false;
    const videoTracks = (Array.isArray(dash.video) ? dash.video : [])
      .map((track) => normalizeBilibiliApiTrack(track, "video"))
      .filter(Boolean);
    const audioSources = [
      ...(Array.isArray(dash.audio) ? dash.audio : []),
      ...(Array.isArray(play?.data?.dolby?.audio) ? play.data.dolby.audio : []),
      ...(play?.data?.flac?.audio ? [play.data.flac.audio] : [])
    ];
    const audioTracks = audioSources.map((track) => normalizeBilibiliApiTrack(track, "audio")).filter(Boolean);
    if (!videoTracks.length || !audioTracks.length) return false;
    // A SPA navigation or a tab close may finish while the public requests are
    // in flight. Re-check identity before any signed URL reaches live state.
    let currentTab;
    try { currentTab = await chrome.tabs.get(tabId); } catch { return false; }
    if (bilibiliTabTokens.get(tabId) !== tabToken) return false;
    if (bilibiliPageKey(currentTab?.url) !== pageKey) return false;
    const state = bilibiliState(tabId, pageKey);
    state.duration = positive(dash.duration) || (positive(play?.data?.timelength) ? Number(play.data.timelength) / 1000 : state.duration || null);
    for (const track of videoTracks) mergeBilibiliTrack(state.video, { ...track, cohort: `api:${pageKey}` }, now);
    for (const track of audioTracks) mergeBilibiliTrack(state.audio, { ...track, cohort: `api:${pageKey}` }, now);
    state.revision += 1;
    bilibiliDiscoveryAt.set(tabId, { pageKey, at: now });
    await publishBilibiliDashPair(tabId, currentTab, tabToken);
    return true;
  })().catch(() => false).finally(() => {
    if (bilibiliDiscoveryInFlight.get(tabId)?.promise === task) bilibiliDiscoveryInFlight.delete(tabId);
  });
  bilibiliDiscoveryInFlight.set(tabId, { pageKey, promise: task });
  return task;
}

// Fan out per-site discovery after a trusted media request (which may be
// playback or preload). Every automatic entry point shares the same setting
// gate before credentialed fixed-site I/O; page completion is not an entry.
// After the first permitted signal, Range/preload repeats are coalesced by the
// per-page in-flight promise, 45-second success TTL and 5-second failure
// cooldown; explicit scans remain able to retry immediately.
async function triggerSiteDiscovery(tabId, {
  automatic = false,
  observedPlayback = false,
  observedMediaUrl = null,
  expectedTabToken = null
} = {}) {
  try {
    await sessionReady;
    const settings = await getSettings();
    if (!automatic || settings.autoEnrichSiteQuality) {
      await discoverBilibiliDash(tabId, false, {
        automatic,
        expectedTabToken,
        observedMediaUrl: observedPlayback ? observedMediaUrl : null
      });
    }
    await maybeAddYouTubeCandidate(tabId);
  } catch {
    // Discovery is best-effort; the popup scan path retries on demand.
  }
}

async function refreshTabBadge(tabId) {
  try {
    await sessionReady;
    await updateBadge(tabId);
  } catch {
    // The tab may already be gone.
  }
}

// The experimental YouTube adapter publishes one page candidate per watch URL.
// The candidate only exists while the user keeps the toggle enabled in
// settings; turning it off withdraws the candidate everywhere.
async function maybeAddYouTubeCandidate(tabId) {
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const routeGeneration = currentTabGeneration(tabId);
  const commitGuard = () => tabGenerations.get(tabId) === routeGeneration;
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return; }
  const settings = await getSettings();
  if (!commitGuard()) return;
  const watchUrl = settings.youtubeEnabled && !ytdlpNetworkDisabled() ? youtubeWatchUrl(tab?.url) : null;
  const map = tabMedia.get(tabId);
  if (!watchUrl) {
    if (map) await removeYouTubeCandidatesFromTab(tabId, map);
    return;
  }
  if (map?.has(`youtube:${watchUrl}`)) return;
  await addCandidate(tabId, {
    kind: "youtube",
    url: watchUrl,
    mime: "video/mp4",
    ext: "mp4",
    title: cleanText(tab?.title, 240),
    pageTitle: cleanText(tab?.title, 240),
    tabUrl: watchUrl,
    source: "site-adapter",
    provenance: "site_payload",
    site: "youtube",
    confidence: 1,
    routeGeneration
  }, commitGuard);
}

async function removeYouTubeCandidatesFromTab(tabId, map) {
  let removed = false;
  for (const [key, item] of map) {
    if (item.kind !== "youtube") continue;
    map.delete(key);
    removed = true;
  }
  if (!removed) return;
  await persistSession();
  await updateBadge(tabId);
  broadcast({ type: "MEDIA_UPDATED", tabId, item: null });
}

async function dropYouTubeCandidates() {
  for (const [tabId, map] of tabMedia) await removeYouTubeCandidatesFromTab(tabId, map);
}

// `credentials: "include"` lets the service-worker fetch reuse the browser's
// bilibili.com cookie jar (the manifest already grants host permissions), so a
// logged-in session receives its full DASH quality ladder instead of the
// guest-tier 480p ceiling. Guests keep the anonymous tier because no cookie
// is attached. Cookies only ever travel to the api.bilibili.com origin named
// in the URL itself.
async function fetchPublicJson(url, { credentials = "omit", timeoutMs = 3_000 } = {}) {
  const allowedUrl = requireNetworkRequest({
    url,
    purpose: "site_metadata",
    provenance: "fixed_site_api",
    networkScope: "public_only"
  });
  const controller = new AbortController();
  const timeout = Math.max(250, Math.min(3_000, Number(timeoutMs) || 3_000));
  const timer = setTimeout(() => controller.abort(), timeout);
  timer?.unref?.();
  try {
    const response = await fetch(allowedUrl, {
      method: "GET",
      credentials,
      cache: "no-store",
      redirect: "error",
      signal: controller.signal
    });
    if (!response.ok) return null;
    if (response.url && response.url !== allowedUrl) return null;
    const declared = Number(response.headers.get("content-length") || 0);
    if (declared > 2 * 1024 * 1024) return null;
    const text = await response.text();
    if (text.length > 2 * 1024 * 1024) return null;
    return JSON.parse(text);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBilibiliApiTrack(value, trackType) {
  if (!value || typeof value !== "object" || !["video", "audio"].includes(trackType)) return null;
  const candidates = [
    value.baseUrl,
    value.base_url,
    ...(Array.isArray(value.backupUrl) ? value.backupUrl : []),
    ...(Array.isArray(value.backup_url) ? value.backup_url : [])
  ];
  const url = candidates.map(canonicalizeUrl).find((candidate) => candidate && isBilibiliMediaUrl(candidate));
  if (!url) return null;
  const parsed = new URL(url);
  const representationId = cleanText(String(value.id ?? ""), 32);
  const codecs = cleanText(value.codecs, 120);
  const width = trackType === "video" ? positive(value.width) : null;
  const height = trackType === "video" ? positive(value.height) : null;
  return {
    url,
    identity: `${parsed.hostname.toLowerCase()}${parsed.pathname}`,
    assetFamily: bilibiliDashAssetFamily(parsed),
    trackId: bilibiliDashTrackId(parsed, trackType),
    trackType,
    representationId,
    qualityId: trackType === "video" ? Number(value.id) || null : null,
    width,
    height,
    bandwidth: positive(value.bandwidth) || 0,
    codecs,
    mime: normalizeMime(value.mimeType || value.mime_type || (trackType === "video" ? "video/mp4" : "audio/mp4")),
    contentLength: 0,
    rangeSupported: true,
    source: "bilibili-api",
    provenance: "fixed_site_api"
  };
}

function bilibiliState(tabId, pageKey = "") {
  let state = bilibiliDashStates.get(tabId);
  if (!state || (pageKey && state.pageKey && state.pageKey !== pageKey)) {
    if (state) {
      for (const track of [...state.video.values(), ...state.audio.values()]) requestHeaders.delete(headerKey(tabId, track.url));
      const media = tabMedia.get(tabId);
      let removed = false;
      for (const [key, item] of media || []) {
        if (item.kind !== "dash_pair") continue;
        media.delete(key);
        removed = true;
      }
      const timer = bilibiliPruneTimers.get(tabId);
      if (timer !== undefined) clearTimeout(timer);
      bilibiliPruneTimers.delete(tabId);
      if (removed) {
        void persistSession();
        void updateBadge(tabId);
        broadcast({ type: "MEDIA_UPDATED", tabId, item: null });
      }
    }
    state = {
      pageKey,
      video: new Map(),
      audio: new Map(),
      currentVideoIdentity: "",
      currentAudioIdentity: "",
      expiresAt: 0,
      revision: 0
    };
    bilibiliDashStates.set(tabId, state);
  } else if (pageKey) state.pageKey = pageKey;
  return state;
}

function mergeBilibiliTrack(map, track, now) {
  const old = map.get(track.identity);
  map.set(track.identity, {
    ...old,
    ...track,
    width: track.width || old?.width || null,
    height: track.height || old?.height || null,
    bandwidth: track.bandwidth || old?.bandwidth || 0,
    codecs: track.codecs || old?.codecs || "",
    contentLength: Math.max(Number(track.contentLength || 0), Number(old?.contentLength || 0)),
    firstSeen: old?.firstSeen || now,
    lastSeen: now,
    expiresAt: now + BILIBILI_TRACK_TTL_MS
  });
}

function queueBilibiliDashObservation(details, observation, tabToken) {
  const track = classifyBilibiliDashTrack({
    url: details.url,
    mime: observation.mime,
    contentLength: observation.contentLength
  });
  // Missing start-generation metadata means the worker began observing after
  // the request was already in flight. Fail closed rather than bind it to a
  // possibly different SPA route.
  if (!track || !tabToken || !Number.isInteger(details.tabId) || details.tabId < 0) return;
  const previous = bilibiliObservationChains.get(details.tabId) || Promise.resolve();
  const next = previous.catch(() => {}).then(() => observeBilibiliDashTrack(details, observation, track, tabToken));
  bilibiliObservationChains.set(details.tabId, next);
  void next.finally(() => {
    if (bilibiliObservationChains.get(details.tabId) === next) bilibiliObservationChains.delete(details.tabId);
  });
}

async function observeBilibiliDashTrack(details, observation, classified, tabToken) {
  let tab;
  try { tab = await chrome.tabs.get(details.tabId); } catch { return; }
  if (bilibiliTabTokens.get(details.tabId) !== tabToken) return;
  if (!isBilibiliVideoPage(tab?.url)) return;
  const url = canonicalizeUrl(details.url);
  if (!url) return;
  const now = Date.now();
  const pageKey = bilibiliPageKey(tab.url);
  if (!pageKey) return;
  const state = bilibiliState(details.tabId, pageKey);
  const track = {
    ...classified,
    url,
    cohort: bilibiliObservationCohort(details, state.pageKey),
    rangeSupported: Boolean(observation.rangeSupported),
    source: "webRequest",
    provenance: "observed_response"
  };
  const map = classified.trackType === "video" ? state.video : state.audio;
  const old = map.get(classified.identity);
  mergeBilibiliTrack(map, track, now);
  if (old?.url && old.url !== url) requestHeaders.delete(headerKey(details.tabId, old.url));
  state.revision += 1;
  if (classified.trackType === "video") state.currentVideoIdentity = classified.identity;
  else state.currentAudioIdentity = classified.identity;
  const safeHeaders = nonSensitiveMediaHeaders(observation.headers);
  if (Object.keys(safeHeaders).length) {
    requestHeaders.set(headerKey(details.tabId, url), {
      headers: safeHeaders,
      bytes: capturedHeadersByteLength(safeHeaders),
      at: now,
      tabId: details.tabId,
      requestId: details.requestId
    });
    scheduleHeaderPrune();
  }
  await publishBilibiliDashPair(details.tabId, tab, tabToken);
}

function bilibiliTabToken(tabId) {
  let token = bilibiliTabTokens.get(tabId);
  if (!token) {
    token = {};
    bilibiliTabTokens.set(tabId, token);
  }
  return token;
}

function invalidateBilibiliTabGeneration(tabId) {
  bilibiliTabTokens.set(tabId, {});
}

async function publishBilibiliDashPair(tabId, tab, tabToken = bilibiliTabTokens.get(tabId)) {
  const state = bilibiliDashStates.get(tabId);
  if (!state || !tabToken || bilibiliTabTokens.get(tabId) !== tabToken) return;
  if (bilibiliPageKey(tab?.url) !== state.pageKey) return;
  const now = Date.now();
  if (pruneExpiredBilibiliTracks(tabId, state, now)) state.revision += 1;
  const revision = state.revision;
  const commitGuard = () => bilibiliCommitIsCurrent(tabId, tabToken, state, revision);
  const videos = [...state.video.values()].filter((track) => isFreshBilibiliTrack(track, now));
  const audios = [...state.audio.values()].filter((track) => isFreshBilibiliTrack(track, now));
  const rankedVideos = videos.slice().sort((a, b) => Number(b.height || 0) - Number(a.height || 0)
    || bilibiliVideoCompatibilityRank(b) - bilibiliVideoCompatibilityRank(a)
    || Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
    || Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
  const currentVideo = state.video.get(state.currentVideoIdentity);
  const candidateVideoOrder = currentVideo && isFreshBilibiliTrack(currentVideo, now)
    ? [currentVideo, ...rankedVideos.filter((track) => track !== currentVideo)]
    : rankedVideos;
  let selectedVideo = null;
  let compatibleAudios = [];
  // Some accepted CDN object names do not expose their cid. The fixed API may
  // then return a canonical track family that differs from the observed URL.
  // Prefer the current observed rendition only when it has a compatible audio
  // partner; otherwise fall back to the best complete API pair.
  const hasCurrentVideo = Boolean(currentVideo && isFreshBilibiliTrack(currentVideo, now));
  for (const video of candidateVideoOrder) {
    // A later incompatible observed object deliberately withdraws an older
    // observed pair. Only a complete pair returned by this fixed-site lookup
    // may replace the current opaque observation.
    if (hasCurrentVideo && video !== currentVideo && video.provenance !== "fixed_site_api") continue;
    const matches = audios
      .filter((track) => canPairBilibiliTracks(track, video, true))
      .sort((a, b) => bilibiliAudioCompatibilityRank(b) - bilibiliAudioCompatibilityRank(a)
        || Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
        || Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
    if (!matches.length || (hasCurrentVideo && video !== currentVideo
      && !matches.some((track) => track.provenance === "fixed_site_api"))) continue;
    selectedVideo = video;
    compatibleAudios = matches;
    break;
  }
  const currentAudio = state.audio.get(state.currentAudioIdentity);
  const selectedAudio = currentAudio && compatibleAudios.includes(currentAudio) ? currentAudio : compatibleAudios[0];
  if (!selectedVideo || !selectedAudio || selectedVideo.url === selectedAudio.url) {
    state.expiresAt = 0;
    await removePublishedBilibiliDashPair(tabId, commitGuard);
    scheduleBilibiliPrune(tabId);
    return;
  }

  // A candidate represents one playback family/cohort only. Other preloaded
  // objects stay in volatile state until they acquire their own compatible
  // partner, but never become selectors on this candidate.
  const candidateVideos = videos.filter((track) => canPairBilibiliTracks(track, selectedAudio, true));
  const candidateAudios = audios.filter((audio) => candidateVideos.some((video) => canPairBilibiliTracks(audio, video, true)));
  const expiresAt = Math.min(bilibiliTrackExpiresAt(selectedVideo), bilibiliTrackExpiresAt(selectedAudio));
  if (!candidateVideos.length || !candidateAudios.length || !Number.isFinite(expiresAt) || expiresAt <= now) {
    state.expiresAt = 0;
    await removePublishedBilibiliDashPair(tabId, commitGuard);
    scheduleBilibiliPrune(tabId);
    return;
  }
  state.expiresAt = expiresAt;
  const pageUrl = publicBilibiliPageUrl(tab?.url);
  if (!pageUrl) {
    await removePublishedBilibiliDashPair(tabId, commitGuard);
    scheduleBilibiliPrune(tabId);
    return;
  }
  let map = tabMedia.get(tabId);
  const previous = [...(map?.values() || [])].find((item) => item.kind === "dash_pair");
  const liveTrackUrls = new Set([...videos, ...audios].map((track) => track.url));
  for (const track of [...(previous?.videoTracks || []), ...(previous?.audioTracks || [])]) {
    if (track?.url && !liveTrackUrls.has(track.url)) requestHeaders.delete(headerKey(tabId, track.url));
  }
  if (!commitGuard()) return;
  if (map) for (const [key, item] of map) if (item.kind === "dash_pair") map.delete(key);
  await addCandidate(tabId, {
    id: previous?.id || randomOpaqueId(),
    kind: "dash_pair",
    // This public candidate address is intentionally the page URL. Exact CDN
    // track URLs remain only in the worker-private arrays below.
    url: pageUrl,
    pairedAudioUrl: selectedAudio.url,
    videoTracks: candidateVideos,
    audioTracks: candidateAudios,
    selectedVideoTrackId: selectedVideo.trackId,
    selectedAudioTrackId: selectedAudio.trackId,
    expiresAt,
    mime: selectedVideo.mime || "video/mp4",
    ext: "mp4",
    width: selectedVideo.width,
    height: selectedVideo.height,
    duration: state.duration,
    codecs: selectedVideo.codecs,
    contentLength: Number(selectedVideo.contentLength || 0) + Number(selectedAudio.contentLength || 0),
    rangeSupported: Boolean(selectedVideo.rangeSupported && selectedAudio.rangeSupported),
    title: cleanText(tab?.title, 240),
    pageTitle: cleanText(tab?.title, 240),
    tabUrl: pageUrl,
    source: "bilibili-dash",
    provenance: candidateVideos.some((track) => track.provenance === "fixed_site_api")
      ? "fixed_site_api"
      : "observed_response",
    confidence: 1
  }, commitGuard);
  if (commitGuard()) scheduleBilibiliPrune(tabId);
}

function bilibiliCommitIsCurrent(tabId, tabToken, state, revision) {
  return bilibiliTabTokens.get(tabId) === tabToken
    && bilibiliDashStates.get(tabId) === state
    && state.pageKey
    && state.revision === revision;
}

function canPairBilibiliTracks(first, second, enforceWindow = false) {
  if (!first || !second || !sameBilibiliAssetFamily(first, second) || !sameBilibiliCohort(first, second)) return false;
  return !enforceWindow || Math.abs(Number(first.lastSeen || 0) - Number(second.lastSeen || 0)) <= BILIBILI_PAIR_WINDOW_MS;
}

async function removePublishedBilibiliDashPair(tabId, commitGuard = null) {
  if (commitGuard && !commitGuard()) return false;
  const map = tabMedia.get(tabId);
  let removed = false;
  for (const [key, item] of map || []) {
    if (item.kind !== "dash_pair") continue;
    map.delete(key);
    removed = true;
  }
  if (!removed) return false;
  await persistSession();
  await updateBadge(tabId);
  if (!commitGuard || commitGuard()) broadcast({ type: "MEDIA_UPDATED", tabId, item: null });
  return true;
}

function scheduleBilibiliPrune(tabId) {
  const existing = bilibiliPruneTimers.get(tabId);
  if (existing !== undefined) clearTimeout(existing);
  bilibiliPruneTimers.delete(tabId);
  const state = bilibiliDashStates.get(tabId);
  const expiries = [...(state?.video?.values() || []), ...(state?.audio?.values() || [])]
    .map(bilibiliTrackExpiresAt)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (!expiries.length) return;
  const timer = setTimeout(() => { void expireBilibiliState(tabId); }, Math.max(0, Math.min(...expiries) - Date.now() + 25));
  timer?.unref?.();
  bilibiliPruneTimers.set(tabId, timer);
}

async function expireBilibiliState(tabId) {
  const existingTimer = bilibiliPruneTimers.get(tabId);
  if (existingTimer !== undefined) clearTimeout(existingTimer);
  bilibiliPruneTimers.delete(tabId);
  const state = bilibiliDashStates.get(tabId);
  if (!state) return;
  const tabToken = bilibiliTabTokens.get(tabId);
  if (!tabToken) return;
  const removedTracks = pruneExpiredBilibiliTracks(tabId, state, Date.now());
  if (!removedTracks) {
    scheduleBilibiliPrune(tabId);
    return;
  }
  state.revision += 1;
  const revision = state.revision;
  const commitGuard = () => bilibiliCommitIsCurrent(tabId, tabToken, state, revision);
  if (!state.video.size && !state.audio.size) {
    state.expiresAt = 0;
    await removePublishedBilibiliDashPair(tabId, commitGuard);
    if (commitGuard()) bilibiliDashStates.delete(tabId);
  } else {
    let tab = null;
    try { tab = await chrome.tabs.get(tabId); } catch { /* closed */ }
    if (!commitGuard()) {
      scheduleBilibiliPrune(tabId);
      return;
    }
    if (tab && bilibiliPageKey(tab.url) === state.pageKey) {
      await publishBilibiliDashPair(tabId, tab, tabToken);
    } else {
      state.expiresAt = 0;
      await removePublishedBilibiliDashPair(tabId, commitGuard);
    }
  }
  scheduleHeaderPrune();
  scheduleBilibiliPrune(tabId);
}

function pruneExpiredBilibiliTracks(tabId, state, now = Date.now()) {
  let removed = 0;
  for (const map of [state.video, state.audio]) {
    for (const [identity, track] of map) {
      if (isFreshBilibiliTrack(track, now)) continue;
      requestHeaders.delete(headerKey(tabId, track.url));
      map.delete(identity);
      removed += 1;
    }
  }
  return removed;
}

function sameBilibiliAssetFamily(first, second) {
  const left = typeof first?.assetFamily === "string"
    && first.assetFamily.length <= MAX_MANIFEST_IDENTITY_KEY_LENGTH
    && !/[\u0000-\u001f]/.test(first.assetFamily) ? first.assetFamily : "";
  const right = typeof second?.assetFamily === "string"
    && second.assetFamily.length <= MAX_MANIFEST_IDENTITY_KEY_LENGTH
    && !/[\u0000-\u001f]/.test(second.assetFamily) ? second.assetFamily : "";
  return Boolean(left && right && left === right);
}

function bilibiliVideoCompatibilityRank(track) {
  const codecs = cleanText(track?.codecs, 120).toLowerCase();
  if (/avc1|avc3|h264/.test(codecs)) return 3;
  if (/hev1|hvc1|hevc|h265/.test(codecs)) return 2;
  if (/av01|av1/.test(codecs)) return 1;
  return 0;
}

function bilibiliAudioCompatibilityRank(track) {
  const codecs = cleanText(track?.codecs, 120).toLowerCase();
  if (/mp4a|aac/.test(codecs)) return 4;
  if (/opus/.test(codecs)) return 3;
  if (/ec-?3|ac-?3/.test(codecs)) return 2;
  if (/flac/.test(codecs)) return 1;
  return 0;
}

function sameBilibiliCohort(first, second) {
  const left = cleanText(first?.cohort, 1024);
  const right = cleanText(second?.cohort, 1024);
  if (!left || !right) return false;
  // Tracks returned together by the public page API are bound by page/cid and
  // may safely complement an observed track of that same asset family.
  if (left.startsWith("api:") || right.startsWith("api:")) return left.replace(/^api:/, "") === right.replace(/^api:/, "") || sameBilibiliAssetFamily(first, second);
  return left === right;
}

function bilibiliObservationCohort(details, pageKey) {
  const document = cleanText(details?.documentId, 128)
    || `frame:${Number.isInteger(details?.frameId) ? details.frameId : -1}`;
  let initiator = cleanText(details?.initiator, 512);
  try { initiator = initiator ? new URL(initiator).origin : ""; } catch { initiator = ""; }
  return `${pageKey}|${document}|${initiator || "no-initiator"}`;
}

function nonSensitiveMediaHeaders(value) {
  const result = {};
  const allowed = new Set(["accept", "origin", "referer", "user-agent"]);
  for (const [rawKey, rawValue] of Object.entries(value || {})) {
    const key = String(rawKey).toLowerCase();
    if (!allowed.has(key) || typeof rawValue !== "string" || /[\r\n]/.test(rawValue)) continue;
    result[key] = rawValue.slice(0, 4096);
  }
  return result;
}

function normalizeDashPairTracks(values, trackType) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const url = canonicalizeUrl(value?.url);
    if (!url || !isBilibiliMediaUrl(url) || seen.has(url)) continue;
    seen.add(url);
    const parsed = new URL(url);
    const assetFamily = bilibiliDashAssetFamily(parsed);
    const identity = cleanText(value.identity, 4096) || `${parsed.hostname.toLowerCase()}${parsed.pathname}`;
    const trackId = bilibiliDashTrackId(parsed, trackType);
    if (!assetFamily || !trackId) continue;
    const lastSeen = timestamp(value.lastSeen, Date.now());
    const derivedExpiresAt = lastSeen + BILIBILI_TRACK_TTL_MS;
    const suppliedExpiresAt = Number(value.expiresAt);
    const expiresAt = Number.isFinite(suppliedExpiresAt) && suppliedExpiresAt > 0
      ? Math.min(suppliedExpiresAt, derivedExpiresAt)
      : derivedExpiresAt;
    result.push({
      url,
      identity,
      assetFamily,
      trackId,
      cohort: cleanText(value.cohort, 1024),
      trackType,
      representationId: cleanText(value.representationId, 32),
      qualityId: trackType === "video" ? positive(value.qualityId) : null,
      width: trackType === "video" ? positive(value.width) : null,
      height: trackType === "video" ? positive(value.height) : null,
      bandwidth: positive(value.bandwidth) || 0,
      codecs: cleanText(value.codecs, 120),
      mime: normalizeMime(value.mime || (trackType === "video" ? "video/mp4" : "audio/mp4")),
      contentLength: positive(value.contentLength) || 0,
      rangeSupported: Boolean(value.rangeSupported),
      source: value.source === "webRequest" ? "webRequest" : "bilibili-api",
      provenance: value.provenance === "observed_response" || value.source === "webRequest"
        ? "observed_response"
        : "fixed_site_api",
      firstSeen: timestamp(value.firstSeen, Date.now()),
      lastSeen,
      expiresAt
    });
    if (result.length >= 32) break;
  }
  return result;
}

function dashPairTrackSelector(candidate, track) {
  const candidateId = cleanText(candidate?.id, 64);
  const trackId = cleanText(track?.trackId, 128);
  if (!candidateId || !trackId) return null;
  return `${DASH_PAIR_SELECTOR_ORIGIN}/dash/${encodeURIComponent(candidateId)}/${encodeURIComponent(trackId)}`;
}

async function addCandidate(tabId, input, commitGuard = null) {
  await sessionReady;
  if (commitGuard && !commitGuard()) return false;
  if (!Number.isInteger(tabId) || tabId < 0) return;
  const routeGeneration = cleanText(input?.routeGeneration, 64);
  if (routeGeneration && tabGenerations.get(tabId) !== routeGeneration) return false;
  const url = canonicalizeUrl(input.url);
  if (!url) return;
  // Never persist Meta's query-addressed MediaSource fragments. This guard is
  // intentionally before input.kind so neither a stale worker nor a trusted
  // adapter can accidentally override the classifier and recreate the old
  // broken MP4 rows.
  if (isInstagramByteRangeFragment(url)) return;
  // Content scripts may already have classified an URL before this worker was
  // upgraded.  Recheck here so caption/text-track manifests never become HLS
  // video rows even when input.kind was supplied by the page.
  if (isLikelySubtitleResource({ url, mime: input.mime })) return;
  // The store-policy blocklist keeps generic media detection off YouTube. The
  // opt-in experimental adapter is the one exception: its candidate is the
  // watch page itself and the actual transfer is delegated to the locally
  // installed yt-dlp engine, so no googlevideo URL ever flows through here.
  if (isPolicyBlocked(url, input.tabUrl) && input.kind !== "youtube") return;
  const classified = classifyMedia({
    url,
    mime: input.mime,
    resourceType: input.resourceType,
    contentLength: input.contentLength
  });
  const kind = input.kind || classified?.kind;
  if (!kind) return;
  const settings = await getSettings();
  if (commitGuard && !commitGuard()) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    if (settings.blockedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return;
  } catch { /* URL was already validated */ }
  if (kind !== "hls" && kind !== "dash" && Number(input.contentLength || 0) > 0 && Number(input.contentLength) < settings.minimumBytes) return;

  const incomingPreview = previewFromCandidate(input);
  if (incomingPreview) await setTabPreview(tabId, incomingPreview, commitGuard);
  if (commitGuard && !commitGuard()) return false;

  let map = tabMedia.get(tabId);
  if (!map) tabMedia.set(tabId, (map = new Map()));
  if (input.source !== "instagram-api-response"
    && kind === "video"
    && siteAdapterForMediaUrl(url)?.id === "instagram"
    && [...map.values()].some((existing) => existing?.kind === "video"
      && existing.url !== url
      && candidateHasSource(existing, "instagram-api-response"))) return false;
  if (input.source === "instagram-api-response") {
    // The response observer is shortcode-bound and yields one best complete
    // rendition. Replace lower-confidence metadata, stale signatures and
    // recommendation rows for this Reel instead of presenting duplicate jobs.
    for (const [existingKey, existing] of map) {
      if (existing?.kind === "video"
        && siteAdapterForMediaUrl(existing.url)?.id === "instagram"
        && existing.url !== url) map.delete(existingKey);
    }
  }
  const key = `${kind}:${url}`;
  const old = map.get(key);
  let tab = null;
  if (!old && (!input.pageTitle || !input.tabUrl)) {
    try { tab = await chrome.tabs.get(tabId); } catch { /* tab closed */ }
    if (commitGuard && !commitGuard()) return false;
  }
  const now = Date.now();
  const sources = new Set([...(old?.sources || []), input.source || "unknown"]);
  const provenance = deriveCandidateProvenance(input, old);
  const preview = choosePreview(previewFromCandidate(old), tabPreviews.get(tabId), incomingPreview);
  const mime = normalizeMime(input.mime || old?.mime || classified?.mime || "");
  const ext = input.ext || old?.ext || classified?.ext || "";
  const manifest = kind === "hls" || kind === "dash";
  const observedLength = Math.max(
    Number(old?.manifestSize || 0),
    Number(old?.contentLength || 0),
    Number(input.contentLength || 0)
  );
  const pageTitle = cleanText(input.pageTitle, 240) || old?.pageTitle || cleanText(tab?.title, 240) || "";
  const sourceFilenames = uniqueCleanTexts([
    input.suggestedFilename,
    ...(Array.isArray(old?.sourceFilenames) ? old.sourceFilenames : []),
    old?.suggestedFilename
  ], 260, 20);
  const naming = candidateNaming({
    kind,
    ext,
    url,
    inputTitle: input.title,
    previousTitle: old?.title,
    pageTitle,
    suggestedFilenames: sourceFilenames
  });
  const directSourceFilename = !manifest ? directSuggestedFilename(input.suggestedFilename, kind, ext) : "";
  const videoTracks = kind === "dash_pair" ? normalizeDashPairTracks(input.videoTracks, "video") : [];
  const audioTracks = kind === "dash_pair" ? normalizeDashPairTracks(input.audioTracks, "audio") : [];
  const pairedAudioUrl = kind === "dash_pair" ? canonicalizeUrl(input.pairedAudioUrl) : null;
  if (kind === "dash_pair" && (!videoTracks.length || !audioTracks.length || !pairedAudioUrl || !isBilibiliMediaUrl(pairedAudioUrl))) return;
  const selectedVideo = kind === "dash_pair" ? videoTracks.find((track) => track.trackId === cleanText(input.selectedVideoTrackId, 128)) : null;
  const selectedAudio = kind === "dash_pair" ? audioTracks.find((track) => track.trackId === cleanText(input.selectedAudioTrackId, 128)) : null;
  const pairExpiresAt = kind === "dash_pair" && selectedVideo && selectedAudio
    ? Math.min(bilibiliTrackExpiresAt(selectedVideo), bilibiliTrackExpiresAt(selectedAudio), Number(input.expiresAt || Number.POSITIVE_INFINITY))
    : 0;
  if (kind === "dash_pair" && (!selectedVideo || !selectedAudio || !Number.isFinite(pairExpiresAt) || pairExpiresAt <= now)) return false;
  const candidate = {
    id: old?.id || reusableOpaqueId(input.id),
    generation: old?.generation || routeGeneration || currentTabGeneration(tabId),
    documentId: cleanText(input.documentId, 128) || old?.documentId || "",
    url,
    kind,
    mime,
    ext,
    contentLength: manifest ? 0 : observedLength,
    manifestSize: manifest ? observedLength : null,
    rangeSupported: Boolean(input.rangeSupported || old?.rangeSupported),
    width: positive(input.width) || old?.width || null,
    height: positive(input.height) || old?.height || null,
    duration: positive(input.duration) || old?.duration || null,
    codecs: cleanText(input.codecs, 180) || old?.codecs || "",
    title: naming.title,
    suggestedFilename: directSourceFilename || old?.suggestedFilename || naming.suggestedFilename,
    sourceFilenames,
    pageTitle,
    tabUrl: canonicalizeUrl(input.tabUrl) || old?.tabUrl || canonicalizeUrl(tab?.url) || "",
    confidence: Math.max(Number(old?.confidence || 0), Number(input.confidence || classified?.confidence || 0.5)),
    source: input.source || old?.source || "unknown",
    sources: [...sources],
    provenance,
    site: cleanText(input.site, 24) || old?.site || siteAdapterForMediaUrl(url)?.id || "",
    thumbnailUrl: preview?.thumbnailUrl || null,
    thumbnailSource: preview?.thumbnailSource || null,
    thumbnailFrameId: preview?.thumbnailFrameId ?? null,
    thumbnailAt: preview?.thumbnailAt || null,
    thumbnailAllowedOrigins: uniqueCleanTexts(preview?.thumbnailAllowedOrigins, 512, 16),
    thumbnailAdapterImageHosts: uniqueCleanTexts(preview?.thumbnailAdapterImageHosts, 255, 16),
    manifestType: old?.manifestType || null,
    manifestVariantCount: positive(old?.manifestVariantCount) || 0,
    manifestAudioTrackCount: positive(old?.manifestAudioTrackCount) || 0,
    manifestSubtitleTrackCount: positive(old?.manifestSubtitleTrackCount) || 0,
    manifestReferences: normalizeUrlList(old?.manifestReferences),
    manifestRedirectUrl: canonicalizeUrl(old?.manifestRedirectUrl) || null,
    manifestFingerprint: cleanText(old?.manifestFingerprint, 128) || null,
    manifestProbeStatus: cleanText(old?.manifestProbeStatus, 24) || null,
    manifestInspectedAt: positive(old?.manifestInspectedAt) || null,
    mergedInto: old?.mergedInto || null,
    aliases: Array.isArray(old?.aliases) ? old.aliases : [],
    manifestText: typeof input.manifestText === "string" && input.manifestText.length <= 1_500_000 ? input.manifestText : old?.manifestText || null,
    pairedAudioUrl,
    videoTracks,
    audioTracks,
    selectedVideoTrackId: kind === "dash_pair" ? selectedVideo.trackId : "",
    selectedAudioTrackId: kind === "dash_pair" ? selectedAudio.trackId : "",
    ...(kind === "dash_pair" ? { expiresAt: pairExpiresAt } : {}),
    firstSeen: old?.firstSeen || now,
    lastSeen: now
  };
  if (commitGuard && !commitGuard()) return false;
  map.set(key, candidate);
  regroupManifestCandidates(tabId);
  trimManifestCache(tabId, key);
  if (map.size > MAX_ITEMS_PER_TAB) {
    const removable = [...map.entries()].sort((a, b) => candidateScore(a[1]) - candidateScore(b[1]) || a[1].lastSeen - b[1].lastSeen);
    while (map.size > MAX_ITEMS_PER_TAB && removable.length) map.delete(removable.shift()[0]);
    regroupManifestCandidates(tabId);
  }
  // Paint the badge independently of storage latency. Both operations still
  // finish before the candidate broadcast, but a slow storage.session write
  // cannot consume the observed-media three-second feedback budget.
  await Promise.all([persistSession(), updateBadge(tabId)]);
  if (commitGuard && !commitGuard()) {
    // Navigation may have invalidated the candidate while persistence was in
    // flight. Repaint from the current map so a stale page cannot win the last
    // badge write.
    await updateBadge(tabId);
    return false;
  }
  broadcast({ type: "MEDIA_UPDATED", tabId, item: withoutManifestText(candidate) });
  if (kind === "hls") scheduleTabManifestInspections(tabId, key, Boolean(input.manifestText));
  return true;
}

function provenanceForContentSource(source) {
  // MAIN-world response observers are bounded site hints, not an authenticity
  // boundary: page JavaScript can post the same message channel. Exact page,
  // CDN, MIME and path checks decide whether a user-selected direct download
  // may stay in Chrome.
  if (source === "x-api-response" || source === "instagram-api-response") return "site_payload";
  if (source === "metadata") return "dom_metadata";
  if (source === "site-payload") return "site_payload";
  return "dom_media_element";
}

function isTrustedXProgressiveCandidate(url, source, sender) {
  if (source !== "x-api-response" || sender?.frameId !== 0) return false;
  try {
    const page = new URL(sender?.tab?.url || sender?.url || "");
    const media = new URL(url);
    const pageHost = page.hostname.toLowerCase();
    return page.protocol === "https:"
      && (pageHost === "x.com" || pageHost.endsWith(".x.com") || pageHost === "twitter.com" || pageHost.endsWith(".twitter.com"))
      && media.protocol === "https:"
      && !media.username
      && !media.password
      && media.hostname.toLowerCase() === "video.twimg.com";
  } catch {
    return false;
  }
}

function isTrustedInstagramProgressiveCandidate(url, source, sender) {
  if (source !== "instagram-api-response" || sender?.frameId !== 0) return false;
  try {
    const page = new URL(sender?.tab?.url || sender?.url || "");
    const media = new URL(url);
    return siteAdapterForPageUrl(page.href)?.id === "instagram"
      && media.protocol === "https:"
      && !media.username
      && !media.password
      && siteAdapterForMediaUrl(media.href)?.id === "instagram"
      && /\.mp4$/i.test(media.pathname)
      && !isInstagramByteRangeFragment(media.href)
      && !media.searchParams.has("bytestart")
      && !media.searchParams.has("byteend");
  } catch {
    return false;
  }
}

function deriveCandidateProvenance(input, previous) {
  const source = cleanText(input?.source, 40);
  let next = CANDIDATE_PROVENANCES.includes(input?.provenance) ? input.provenance : "";
  if (source === "webRequest") next = "observed_response";
  else if (["bilibili-api", "bilibili-dash"].includes(source) && next !== "observed_response") next = "fixed_site_api";
  else if (source === "site-adapter") next = "site_payload";
  else if (CONTENT_SOURCES.has(source)) next = provenanceForContentSource(source);
  if (!next) next = "user_supplied";

  // Page messages cannot choose this field: validateContentCandidate derives
  // it from the trusted sender/source. A later webRequest observation may only
  // promote an existing hint to observed_response; lower-trust input cannot
  // downgrade a candidate that the browser has actually seen.
  if (previous?.provenance === "observed_response" || next === "observed_response") return "observed_response";
  if (previous?.provenance === "fixed_site_api" || next === "fixed_site_api") return "fixed_site_api";
  return CANDIDATE_PROVENANCES.includes(previous?.provenance) ? previous.provenance : next;
}

function urlOrigin(value) {
  try { return new URL(value).origin; } catch { return ""; }
}

function networkScopeForSettings(settings) {
  return settings?.allowPrivateNetworkMedia ? "private_network_opt_in" : "public_only";
}

async function validateThumbnailPreview(value, source, sender) {
  const thumbnailUrl = normalizeThumbnailUrl(value);
  if (!thumbnailUrl) return null;
  const tabId = sender?.tab?.id;
  const pageUrls = uniqueCleanTexts([
    canonicalizeUrl(sender?.tab?.url),
    canonicalizeUrl(sender?.url)
  ], 16_384, 4);
  const observedMediaUrls = [...(tabMedia.get(tabId)?.values() || [])]
    .filter((item) => item.provenance === "observed_response" || item.sources?.includes("webRequest"))
    .map((item) => item.url);
  const adapter = pageUrls.map(siteAdapterForPageUrl).find(Boolean);
  const adapterImageHosts = adapter?.imageHostSuffixes || [];
  const allowedOrigins = uniqueCleanTexts([
    ...pageUrls.map(urlOrigin),
    ...observedMediaUrls.map(urlOrigin)
  ], 512, 16);
  const settings = await getSettings();
  const decision = evaluateNetworkRequest({
    url: thumbnailUrl,
    purpose: "thumbnail",
    provenance: source === "poster" ? "dom_media_element" : "dom_metadata",
    networkScope: networkScopeForSettings(settings),
    allowedThumbnailOrigins: allowedOrigins,
    adapterImageHosts
  });
  if (!decision.allowed) return null;
  return createPreview(decision.url, source, sender.frameId, Date.now(), { allowedOrigins, adapterImageHosts });
}

async function validateContentCandidate(data, sender) {
  if (!data || typeof data !== "object") return null;
  const url = canonicalizeUrl(data.url);
  if (!url) return null;
  const tab = sender.tab;
  const manifestText = typeof data.manifestText === "string" && data.manifestText.length <= 1_500_000 ? data.manifestText : null;
  const source = cleanText(data.source, 40);
  if (source === "x-api-response"
    && (!isTrustedXProgressiveCandidate(url, source, sender) || normalizeMime(data.mime) !== "video/mp4")) return null;
  if (source === "instagram-api-response"
    && (!isTrustedInstagramProgressiveCandidate(url, source, sender) || normalizeMime(data.mime) !== "video/mp4")) return null;
  const preview = cleanText(data.thumbnailSource, 40) === "poster"
    ? await validateThumbnailPreview(data.thumbnailUrl, "poster", sender)
    : null;
  return {
    url,
    mime: cleanText(data.mime, 180),
    resourceType: cleanText(data.resourceType, 40),
    contentLength: positive(data.contentLength) || 0,
    width: positive(data.width),
    height: positive(data.height),
    duration: positive(data.duration),
    codecs: cleanText(data.codecs, 180),
    title: cleanText(data.title, 240),
    pageTitle: cleanText(data.pageTitle, 240) || cleanText(tab?.title, 240) || "",
    // Do not trust a MAIN-world page to choose the provenance tab URL/source.
    tabUrl: canonicalizeUrl(tab?.url) || canonicalizeUrl(sender.url) || "",
    source: CONTENT_SOURCES.has(source) ? source : "content",
    provenance: provenanceForContentSource(source),
    manifestText,
    ...(preview || {})
  };
}

async function validatePagePreview(data, sender) {
  if (!data || typeof data !== "object") return null;
  const source = cleanText(data.source, 40);
  if (!PAGE_PREVIEW_PRIORITIES.has(source)) return null;
  return validateThumbnailPreview(data.thumbnailUrl, source, sender);
}

function normalizeThumbnailUrl(value) {
  try {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_THUMBNAIL_URL_LENGTH) return null;
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    if (url.username || url.password) return null;
    url.hash = "";
    return url.href.length <= MAX_THUMBNAIL_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

function createPreview(value, source, frameId, at, policy = {}) {
  const thumbnailUrl = normalizeThumbnailUrl(value);
  if (!thumbnailUrl || !PAGE_PREVIEW_PRIORITIES.has(source)) return null;
  return {
    thumbnailUrl,
    thumbnailSource: source,
    thumbnailFrameId: Number.isInteger(frameId) && frameId >= 0 ? frameId : 0,
    thumbnailAt: Number.isFinite(Number(at)) && Number(at) > 0 ? Math.min(Number(at), Date.now() + 60_000) : Date.now(),
    thumbnailAllowedOrigins: uniqueCleanTexts(policy.allowedOrigins, 512, 16),
    thumbnailAdapterImageHosts: uniqueCleanTexts(policy.adapterImageHosts, 255, 16)
  };
}

function previewFromCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  return createPreview(
    candidate.thumbnailUrl,
    cleanText(candidate.thumbnailSource, 40),
    candidate.thumbnailFrameId,
    candidate.thumbnailAt,
    {
      allowedOrigins: candidate.thumbnailAllowedOrigins,
      adapterImageHosts: candidate.thumbnailAdapterImageHosts
    }
  );
}

function previewRank(preview) {
  return (PAGE_PREVIEW_PRIORITIES.get(preview?.thumbnailSource) || 0) * 10
    + (preview?.thumbnailFrameId === 0 ? 1 : 0);
}

function choosePreview(...previews) {
  let best = null;
  for (const preview of previews) {
    if (!preview) continue;
    const rank = previewRank(preview);
    const bestRank = previewRank(best);
    if (!best || rank > bestRank || (rank === bestRank && preview.thumbnailAt >= best.thumbnailAt)) best = preview;
  }
  return best;
}

function samePreview(first, second) {
  return first?.thumbnailUrl === second?.thumbnailUrl
    && first?.thumbnailSource === second?.thumbnailSource
    && first?.thumbnailFrameId === second?.thumbnailFrameId;
}

async function setTabPreview(tabId, preview, commitGuard = null) {
  if (!Number.isInteger(tabId) || tabId < 0 || !preview) return;
  if (commitGuard && !commitGuard()) return;
  const previous = tabPreviews.get(tabId);
  const selected = choosePreview(tabPreviews.get(tabId), preview);
  tabPreviews.set(tabId, selected);
  const previewChanged = !samePreview(previous, selected) || previous?.thumbnailAt !== selected?.thumbnailAt;
  const changed = [];
  for (const candidate of tabMedia.get(tabId)?.values() || []) {
    const candidatePreview = previewFromCandidate(candidate);
    const next = choosePreview(candidatePreview, selected);
    if (!next || samePreview(candidatePreview, next)) continue;
    candidate.thumbnailUrl = next.thumbnailUrl;
    candidate.thumbnailSource = next.thumbnailSource;
    candidate.thumbnailFrameId = next.thumbnailFrameId;
    candidate.thumbnailAt = next.thumbnailAt;
    candidate.thumbnailAllowedOrigins = [...(next.thumbnailAllowedOrigins || [])];
    candidate.thumbnailAdapterImageHosts = [...(next.thumbnailAdapterImageHosts || [])];
    changed.push(candidate);
  }
  if (!changed.length && !previewChanged) return;
  await persistSession();
  if (commitGuard && !commitGuard()) return;
  for (const candidate of changed) {
    broadcast({ type: "MEDIA_UPDATED", tabId, item: withoutManifestText(candidate) });
  }
}

function uniqueCleanTexts(values, maxLength, limit = 40) {
  const seen = new Set();
  const result = [];
  for (const value of values || []) {
    const clean = cleanText(value, maxLength);
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    result.push(clean);
    if (result.length >= limit) break;
  }
  return result;
}

function normalizeUrlList(values, limit = 400) {
  const seen = new Set();
  const result = [];
  for (const value of Array.isArray(values) ? values : []) {
    const url = canonicalizeUrl(value);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    result.push(url);
    if (result.length >= limit) break;
  }
  return result;
}

function titleStem(value) {
  let title = cleanText(value, 240);
  if (!title) return "";
  try { title = decodeURIComponent(title); } catch { /* keep undecoded text */ }
  title = title
    .replace(/^.*[\\/]/, "")
    .replace(/\.(?:m3u8?|mpd|mp4|m4v|webm|mkv|mov|avi|flv|m4a|mp3|aac|ogg|opus|wav|flac)$/i, "")
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleanText(title, 180);
}

function readableTitle(value) {
  const raw = cleanText(value, 240);
  if (!raw) return "";
  const basename = raw.replace(/^.*[\\/]/, "");
  const separatorCount = (basename.match(/[_-]/g) || []).length;
  const versionMarkers = basename.match(/(?:^|[_-])v\d{1,4}(?=[_-]|$)/gi) || [];
  // Production media pipelines often expose internal revision IDs as titles
  // (for example, name_v04_comp_v01_cc03). Prefer the readable page title
  // rather than turning those asset-management tokens into user filenames.
  if (separatorCount >= 4 && versionMarkers.length > 0) return "";
  const title = titleStem(raw);
  if (!title || !/[\p{L}]/u.test(title)) return "";
  const compact = title.replace(/[^\p{L}\p{N}]/gu, "");
  const lower = title.toLowerCase();
  if (/^(?:index|master|playlist|manifest|media|video|audio|stream|asset|file|delivery)(?:[- _]?\d+)?$/i.test(title)) return "";
  if (/^[a-f0-9]{12,}$/i.test(compact) || /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(lower)) return "";
  const digits = (compact.match(/\p{N}/gu) || []).length;
  const asciiToken = /^[a-z0-9-]+$/i.test(title) && !/[\s_-]/.test(title);
  if (asciiToken && compact.length >= 10 && digits / compact.length >= 0.35 && !/[aeiou]/i.test(title)) return "";
  if (asciiToken && compact.length >= 18 && /\d/.test(compact) && /[a-z]/i.test(compact)) return "";
  return title;
}

function candidateNaming({ kind, ext, url, inputTitle, previousTitle, pageTitle, suggestedFilenames = [] }) {
  let urlName = "";
  try { urlName = new URL(url).pathname.split("/").filter(Boolean).pop() || ""; } catch { /* validated earlier */ }
  const title = [
    inputTitle,
    ...suggestedFilenames,
    pageTitle,
    previousTitle,
    urlName
  ].map(readableTitle).find(Boolean) || "媒体";
  const outputExt = ["hls", "dash", "dash_pair"].includes(kind) ? "mp4" : ext || (kind === "audio" ? "m4a" : "mp4");
  return {
    title,
    suggestedFilename: `${sanitizeFilename(title)}.${outputExt}`
  };
}

function directSuggestedFilename(value, kind, ext) {
  const raw = cleanText(value, 260);
  if (!raw || !readableTitle(raw)) return "";
  const safe = sanitizeFilename(raw);
  const outputExt = cleanText(ext, 12) || (kind === "audio" ? "m4a" : "mp4");
  const stem = safe.replace(/\.[a-z0-9]{1,8}$/i, "");
  return `${stem}.${outputExt}`;
}

function strongDeliveryPathIdentity(pathname) {
  let decoded = pathname;
  try { decoded = decodeURIComponent(pathname); } catch { /* keep encoded path */ }
  const match = decoded.match(/(?:^|\/)deliveries\/([^/]+?)(?:\.m3u8?)?\/?$/i);
  if (!match) return null;
  const assetId = match[1].toLowerCase();
  // Cross-host matching is deliberately limited to opaque asset identifiers.
  // Common names such as master.m3u8 or video.m3u8 can occur for unrelated
  // videos on the same page and therefore must remain origin-scoped.
  const compact = assetId.replace(/[^a-z0-9]/g, "");
  const looksOpaque = compact.length >= 20
    && (/^[a-f0-9]+$/.test(compact) || (/\d/.test(compact) && /[a-z]/.test(compact)));
  return looksOpaque ? `delivery:${assetId}` : null;
}

function manifestIdentityKeys(value) {
  const url = canonicalizeUrl(value);
  if (!url) return [];
  // Query parameters may be the only asset identity on manifest endpoints.
  // Candidate-to-candidate identity therefore remains exact. Cross-host or
  // re-signed aliases are joined only through an explicit manifest reference
  // (below) or a verified body fingerprint.
  return [`url:${url}`];
}

function manifestReferenceIdentityKeys(value) {
  const url = canonicalizeUrl(value);
  if (!url) return [];
  try {
    const parsed = new URL(url);
    return uniqueCleanTexts([
      `url:${url}`,
      strongDeliveryPathIdentity(parsed.pathname)
    ], MAX_MANIFEST_IDENTITY_KEY_LENGTH, 2);
  } catch {
    return [];
  }
}

function manifestIdentityUrls(candidate) {
  return normalizeUrlList([candidate?.url, candidate?.manifestRedirectUrl]);
}

function manifestIdentityKeysForCandidate(candidate) {
  return uniqueCleanTexts(
    manifestIdentityUrls(candidate).flatMap(manifestIdentityKeys),
    MAX_MANIFEST_IDENTITY_KEY_LENGTH,
    12
  );
}

function manifestCandidateQuality(candidate) {
  const parsed = candidate?.manifestProbeStatus === "parsed" ? 1_000_000 : 0;
  const type = candidate?.manifestType === "master" ? 10_000_000 : candidate?.manifestType === "media" ? 100_000 : 0;
  return type + parsed
    + Number(candidate?.manifestVariantCount || 0) * 10_000
    + Number(candidate?.manifestAudioTrackCount || 0) * 1_000
    + Number(candidate?.manifestSubtitleTrackCount || 0) * 100
    + Number(candidate?.manifestReferences?.length || 0) * 100
    + Number(candidate?.confidence || 0) * 10
    - String(candidate?.url || "").length / 100_000;
}

function regroupManifestCandidates(tabId) {
  const map = tabMedia.get(tabId);
  if (!map) return;
  const candidates = [...map.values()].filter((item) => item.kind === "hls");
  if (!candidates.length) return;
  const parent = candidates.map((_, index) => index);
  const find = (index) => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const union = (first, second) => {
    const a = find(first);
    const b = find(second);
    if (a !== b) parent[b] = a;
  };
  const byIdentity = new Map();
  const byReferenceIdentity = new Map();
  const byFingerprint = new Map();
  for (const [index, candidate] of candidates.entries()) {
    candidate.mergedInto = null;
    candidate.aliases = [];
    candidate.groupSize = 1;
    for (const identity of manifestIdentityKeysForCandidate(candidate)) {
      for (const previous of byIdentity.get(identity) || []) union(index, previous);
      const matches = byIdentity.get(identity) || [];
      matches.push(index);
      byIdentity.set(identity, matches);
    }
    for (const identity of manifestIdentityUrls(candidate).flatMap(manifestReferenceIdentityKeys)) {
      const matches = byReferenceIdentity.get(identity) || [];
      matches.push(index);
      byReferenceIdentity.set(identity, matches);
    }
    if (candidate.manifestFingerprint) {
      const previous = byFingerprint.get(candidate.manifestFingerprint);
      if (previous !== undefined) union(index, previous);
      else byFingerprint.set(candidate.manifestFingerprint, index);
    }
  }
  for (const [index, candidate] of candidates.entries()) {
    for (const reference of normalizeUrlList(candidate.manifestReferences)) {
      for (const identity of manifestReferenceIdentityKeys(reference)) {
        for (const target of byReferenceIdentity.get(identity) || []) union(index, target);
      }
    }
  }
  const groups = new Map();
  for (let index = 0; index < candidates.length; index += 1) {
    const root = find(index);
    const group = groups.get(root) || [];
    group.push(candidates[index]);
    groups.set(root, group);
  }
  for (const members of groups.values()) {
    const representative = [...members].sort((a, b) =>
      manifestCandidateQuality(b) - manifestCandidateQuality(a)
      || Number(a.firstSeen || 0) - Number(b.firstSeen || 0)
      || String(a.url).localeCompare(String(b.url))
    )[0];
    const aliases = [];
    const seenAliases = new Set([representative.url]);
    const sources = new Set(representative.sources || []);
    const sourceFilenames = [...(representative.sourceFilenames || [])];
    for (const member of members) {
      member.groupSize = members.length;
      member.mergedInto = member === representative ? null : representative.id;
      for (const source of member.sources || []) sources.add(source);
      sourceFilenames.push(...(member.sourceFilenames || []));
      for (const url of manifestIdentityUrls(member)) {
        if (seenAliases.has(url)) continue;
        seenAliases.add(url);
        aliases.push({
          id: member.id,
          url,
          source: cleanText(member.source, 40),
          manifestType: cleanText(member.manifestType, 24) || null,
          width: positive(member.width),
          height: positive(member.height),
          manifestSize: positive(member.manifestSize) || 0
        });
      }
    }
    representative.aliases = aliases.slice(0, 400);
    representative.sources = [...sources];
    representative.sourceFilenames = uniqueCleanTexts(sourceFilenames, 260, 40);
    representative.firstSeen = Math.min(...members.map((item) => Number(item.firstSeen || Date.now())));
    representative.lastSeen = Math.max(...members.map((item) => Number(item.lastSeen || 0)));
    representative.width = Math.max(...members.map((item) => Number(item.width || 0))) || null;
    representative.height = Math.max(...members.map((item) => Number(item.height || 0))) || null;
    const naming = candidateNaming({
      kind: representative.kind,
      ext: representative.ext,
      url: representative.url,
      inputTitle: members.map((item) => item.title).find(readableTitle),
      previousTitle: representative.title,
      pageTitle: representative.pageTitle || members.map((item) => item.pageTitle).find(Boolean),
      suggestedFilenames: representative.sourceFilenames
    });
    representative.title = naming.title;
    representative.suggestedFilename = naming.suggestedFilename;
  }
}

function inspectionKey(tabId, key) {
  return `${tabId}\n${key}`;
}

function scheduleTabManifestInspections(tabId, preferredKey, retryPreferred = false) {
  const entries = [...(tabMedia.get(tabId)?.entries() || [])].filter(([, candidate]) =>
    candidate.kind === "hls"
    && (typeof candidate.manifestText === "string"
      || candidate.provenance === "observed_response"
      || candidate.sources?.includes("webRequest"))
  );
  if (entries.length < 2 && !retryPreferred) return;
  for (const [key] of entries) scheduleManifestInspection(tabId, key, retryPreferred && key === preferredKey);
}

function scheduleManifestInspection(tabId, key, retry = false) {
  const token = inspectionKey(tabId, key);
  if (retry) manifestInspectionAttempted.delete(token);
  if (manifestInspectionAttempted.has(token) || manifestInspectionInFlight.has(token)) return;
  manifestInspectionAttempted.add(token);
  const promise = inspectManifestCandidate(tabId, key).finally(() => manifestInspectionInFlight.delete(token));
  manifestInspectionInFlight.set(token, promise);
}

async function inspectManifestCandidate(tabId, key) {
  const candidate = tabMedia.get(tabId)?.get(key);
  if (!candidate || candidate.kind !== "hls") return;
  try {
    const settings = await getSettings();
    const inspection = await probeManifest(candidate, {
      credentials: "omit",
      timeoutMs: MANIFEST_INSPECTION_TIMEOUT_MS,
      automatic: true,
      networkScope: networkScopeForSettings(settings)
    });
    await recordManifestInspection(tabId, candidate, inspection);
  } catch {
    // Private, expired and live manifests remain individually usable; a user
    // initiated probe/download can retry with the captured browser context.
  }
}

async function mediaPlaylistFingerprint(inspection) {
  const segments = Array.isArray(inspection?.segments) ? inspection.segments : [];
  if (!segments.length || !globalThis.crypto?.subtle) return null;
  const identity = JSON.stringify(segments.slice(0, 4000).map((segment) => [
    canonicalizeUrl(segment.url),
    Number(segment.duration || 0),
    cleanText(segment.byteRange, 80),
    canonicalizeUrl(segment.initMap?.url),
    cleanText(segment.initMap?.byteRange, 80)
  ]));
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(identity));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function recordManifestInspection(tabId, inspectedCandidate, inspection) {
  if (inspection?.kind !== "hls") return;
  const map = tabMedia.get(tabId);
  if (!map) return;
  const key = `hls:${canonicalizeUrl(inspectedCandidate?.url)}`;
  const candidate = map.get(key);
  if (!candidate || candidate.id !== inspectedCandidate.id) return;
  const variants = Array.isArray(inspection.variants) ? inspection.variants : [];
  const audioTracks = Array.isArray(inspection.audioTracks) ? inspection.audioTracks : [];
  const subtitleTracks = Array.isArray(inspection.subtitleTracks) ? inspection.subtitleTracks : [];
  candidate.manifestType = inspection.type === "master" ? "master" : "media";
  candidate.manifestVariantCount = variants.length;
  candidate.manifestAudioTrackCount = audioTracks.length;
  candidate.manifestSubtitleTrackCount = subtitleTracks.length;
  candidate.manifestReferences = normalizeUrlList([
    ...variants.map((item) => item.url),
    ...audioTracks.map((item) => item.url),
    ...subtitleTracks.map((item) => item.url)
  ]);
  candidate.manifestRedirectUrl = canonicalizeUrl(inspection.manifestUrl) || null;
  candidate.manifestFingerprint = candidate.manifestType === "media" ? await mediaPlaylistFingerprint(inspection) : null;
  candidate.manifestProbeStatus = "parsed";
  candidate.manifestInspectedAt = Date.now();
  candidate.manifestSize = Math.max(Number(candidate.manifestSize || 0), Number(inspection.manifestByteLength || 0));
  const bestVariant = sortHlsVariants(variants)[0];
  if (bestVariant) {
    candidate.width = positive(bestVariant.width) || candidate.width;
    candidate.height = positive(bestVariant.height) || candidate.height;
    candidate.codecs = cleanText(bestVariant.codecs, 180) || candidate.codecs;
  }
  regroupManifestCandidates(tabId);
  await persistSession();
  await updateBadge(tabId);
  const representative = candidate.mergedInto
    ? [...map.values()].find((item) => item.id === candidate.mergedInto)
    : candidate;
  if (representative) broadcast({ type: "MEDIA_UPDATED", tabId, item: withoutManifestText(representative) });
}

async function probeManifest(candidate, options = {}) {
  const url = canonicalizeUrl(candidate?.url);
  if (!url) throw new Error("清单地址无效");
  let text = typeof candidate.manifestText === "string" ? candidate.manifestText : "";
  let manifestUrl = url;
  if (!text) {
    const allowedUrl = requireNetworkRequest({
      url,
      purpose: "manifest_probe",
      provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "user_supplied",
      networkScope: options.networkScope || "public_only",
      automatic: Boolean(options.automatic),
      userInitiated: Boolean(options.userInitiated)
    });
    const controller = Number(options.timeoutMs) > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), Number(options.timeoutMs)) : null;
    try {
      const response = await fetch(allowedUrl, {
        credentials: options.credentials === "omit" ? "omit" : "include",
        cache: "no-store",
        redirect: "error",
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > MAX_MANIFEST_BYTES) throw new Error("媒体清单超出大小限制");
      if (response.url && response.url !== allowedUrl) {
        manifestUrl = requireNetworkRequest({
          url: response.url,
          purpose: "redirect",
          provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "user_supplied",
          networkScope: options.networkScope || "public_only",
          userInitiated: Boolean(options.userInitiated)
        });
      } else manifestUrl = allowedUrl;
      text = await readResponseTextLimited(response, MAX_MANIFEST_BYTES);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }
  if (text.length > MAX_MANIFEST_BYTES) throw new Error("媒体清单超出大小限制");
  const manifestByteLength = new TextEncoder().encode(text).byteLength;
  if (candidate.kind === "dash" || /<MPD\b/i.test(text)) {
    const dash = { kind: "dash", manifestUrl, manifestByteLength, ...parseDash(text, manifestUrl) };
    validateManifestChildren(dash, candidate, options);
    return dash;
  }
  const hls = parseHls(text, manifestUrl);
  const result = { kind: "hls", manifestUrl, manifestByteLength, ...hls, variants: sortHlsVariants(hls.variants) };
  validateManifestChildren(result, candidate, options);
  return result;
}

function validateManifestChildren(manifest, candidate, options) {
  const urls = manifest.kind === "dash"
    ? (manifest.representations || []).map((item) => item.url)
    : [
        ...(manifest.variants || []).map((item) => item.url),
        ...(manifest.audioTracks || []).map((item) => item.url),
        ...(manifest.subtitleTracks || []).map((item) => item.url),
        ...(manifest.segments || []).flatMap((item) => [item.url, item.initMap?.url]),
        ...(manifest.keys || []).map((item) => item.url)
      ];
  for (const childUrl of urls) {
    if (!childUrl) continue;
    requireNetworkRequest({
      url: childUrl,
      purpose: "manifest_child",
      provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "user_supplied",
      networkScope: options.networkScope || "public_only",
      automatic: Boolean(options.automatic),
      userInitiated: Boolean(options.userInitiated)
    });
  }
}

async function readResponseTextLimited(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (text.length > maxBytes) throw new Error("媒体清单超出大小限制");
    return text;
  }
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel();
        throw new Error("媒体清单超出大小限制");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function manifestVariantSelector(candidate, value) {
  const url = canonicalizeUrl(value);
  const candidateId = cleanText(candidate?.id, 64);
  if (!url || !candidateId) return null;
  if (!(candidate.manifestVariantSelectors instanceof Map)) candidate.manifestVariantSelectors = new Map();
  if (!(candidate.manifestVariantSelectorsByUrl instanceof Map)) candidate.manifestVariantSelectorsByUrl = new Map();
  const existing = candidate.manifestVariantSelectorsByUrl.get(url);
  if (existing && candidate.manifestVariantSelectors.get(existing) === url) return existing;
  let selector;
  do {
    selector = `${MANIFEST_SELECTOR_ORIGIN}/manifest/${encodeURIComponent(candidateId)}/${randomOpaqueId()}`;
  } while (candidate.manifestVariantSelectors.has(selector));
  candidate.manifestVariantSelectors.set(selector, url);
  candidate.manifestVariantSelectorsByUrl.set(url, selector);
  while (candidate.manifestVariantSelectors.size > MAX_MANIFEST_SELECTOR_MAPPINGS) {
    const [oldSelector, oldUrl] = candidate.manifestVariantSelectors.entries().next().value || [];
    if (!oldSelector) break;
    candidate.manifestVariantSelectors.delete(oldSelector);
    if (candidate.manifestVariantSelectorsByUrl.get(oldUrl) === oldSelector) candidate.manifestVariantSelectorsByUrl.delete(oldUrl);
  }
  return selector;
}

function resolveManifestVariantSelector(candidate, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const selector = canonicalizeUrl(value);
  if (!selector || !selector.startsWith(`${MANIFEST_SELECTOR_ORIGIN}/manifest/`)) {
    throw new Error("所选清晰度无效，请重新读取清晰度");
  }
  const selected = candidate?.manifestVariantSelectors instanceof Map
    ? candidate.manifestVariantSelectors.get(selector)
    : null;
  if (!selected) throw new Error("所选清晰度已失效，请重新读取清晰度");
  return selected;
}

function probeForUi(probe, candidate) {
  if (probe.kind === "hls") {
    const variants = (probe.variants || []).slice(0, 200).map((item) => ({
      url: manifestVariantSelector(candidate, item.url),
      bandwidth: positive(item.bandwidth) || 0,
      width: positive(item.width),
      height: positive(item.height),
      codecs: cleanText(item.codecs, 180),
      frameRate: positive(item.frameRate),
      audioGroup: cleanText(item.audioGroup, 120),
      name: cleanText(item.name, 160)
    })).filter((item) => item.url);
    const segments = Array.isArray(probe.segments) ? probe.segments : [];
    return {
      kind: "hls",
      type: probe.type,
      variants,
      segmentCount: segments.length,
      duration: segments.reduce((sum, item) => sum + (positive(item.duration) || 0), 0) || null,
      encrypted: Boolean(probe.encrypted),
      protection: probe.protection,
      live: Boolean(probe.live),
      discontinuity: Boolean(probe.discontinuity),
      audioTrackCount: Array.isArray(probe.audioTracks) ? probe.audioTracks.length : 0,
      targetDuration: positive(probe.targetDuration)
    };
  }
  return {
    kind: "dash",
    type: cleanText(probe.type, 32) || "static",
    duration: cleanText(probe.duration, 80) || null,
    protected: Boolean(probe.protected),
    representations: (probe.representations || []).slice(0, 300).map((item) => ({
      id: cleanText(item.id, 120),
      mime: cleanText(item.mime, 180),
      codecs: cleanText(item.codecs, 180),
      bandwidth: positive(item.bandwidth) || 0,
      width: positive(item.width),
      height: positive(item.height),
      frameRate: cleanText(item.frameRate, 80),
      url: manifestVariantSelector(candidate, item.url)
    }))
  };
}

function hlsUnsupportedReason(probe) {
  if (probe?.kind !== "hls") return null;
  if (probe.protection === "drm" || probe.protected) return "检测到 DRM/SAMPLE-AES 内容保护，仅显示媒体信息";
  if (probe.protection === "aes128" || probe.encrypted) return "FluxCatch 0.2.5 暂不支持 AES-128 加密的 HLS 下载";
  // A master playlist has no EXT-X-ENDLIST of its own. Its selected media
  // playlist is revalidated by the native host before any segment is fetched.
  if (probe.type === "media" && probe.live) return "FluxCatch 0.2.5 暂不支持 HLS 直播录制";
  if (probe.discontinuity) return "FluxCatch 0.2.5 暂不支持包含时间线切换的 HLS 下载";
  return null;
}

function selectDashPairTracks(candidate, requestedVariant) {
  const now = Date.now();
  if (!isFreshBilibiliCandidate(candidate, now)) throw new Error("视频清晰度地址已过期，请重新扫描页面");
  const videos = (candidate.videoTracks || []).filter((track) => isFreshBilibiliTrack(track, now));
  const audios = (candidate.audioTracks || []).filter((track) => isFreshBilibiliTrack(track, now));
  if (!videos.length || !audios.length) throw new Error("视频清晰度地址已过期，请重新扫描页面");

  let video = videos.find((track) => track.trackId === candidate.selectedVideoTrackId) || null;
  const requested = typeof requestedVariant === "string" && requestedVariant.trim() ? canonicalizeUrl(requestedVariant) : null;
  if (typeof requestedVariant === "string" && requestedVariant.trim() && !requested) throw new Error("所选清晰度无效，请重新选择");
  if (requested) {
    video = videos.find((track) => dashPairTrackSelector(candidate, track) === requested) || null;
    if (!video) throw new Error("所选清晰度已失效，请重新读取清晰度");
  }
  if (!video) {
    video = videos.slice().sort((a, b) => Number(b.height || 0) - Number(a.height || 0)
      || bilibiliVideoCompatibilityRank(b) - bilibiliVideoCompatibilityRank(a)
      || Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
      || Number(b.lastSeen || 0) - Number(a.lastSeen || 0))[0];
  }
  const compatibleAudios = audios.filter((track) => canPairBilibiliTracks(track, video, true));
  let audio = compatibleAudios.find((track) => track.trackId === candidate.selectedAudioTrackId) || null;
  if (!audio) {
    audio = compatibleAudios.slice().sort((a, b) => bilibiliAudioCompatibilityRank(b) - bilibiliAudioCompatibilityRank(a)
      || Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
      || Number(b.lastSeen || 0) - Number(a.lastSeen || 0))[0];
  }
  if (!video || !audio || video.url === audio.url) throw new Error("未找到可配对的音轨，请重新扫描页面");
  const expiresAt = Math.min(Number(candidate.expiresAt || Number.POSITIVE_INFINITY), bilibiliTrackExpiresAt(video), bilibiliTrackExpiresAt(audio));
  if (!Number.isFinite(expiresAt) || expiresAt <= now) throw new Error("视频清晰度地址已过期，请重新扫描页面");
  return { video, audio, expiresAt };
}

function bilibiliTrackExpiresAt(track) {
  const lastSeen = Number(track?.lastSeen || 0);
  const derived = lastSeen > 0 ? lastSeen + BILIBILI_TRACK_TTL_MS : 0;
  const explicit = Number(track?.expiresAt || 0);
  return explicit > 0 && Number.isFinite(explicit) ? (derived > 0 ? Math.min(explicit, derived) : explicit) : derived;
}

function isFreshBilibiliTrack(track, now = Date.now()) {
  const url = canonicalizeUrl(track?.url);
  return Boolean(url && isBilibiliMediaUrl(url) && bilibiliTrackExpiresAt(track) > now);
}

function isFreshBilibiliCandidate(candidate, now = Date.now()) {
  const expiresAt = Number(candidate?.expiresAt || 0);
  if (candidate?.kind !== "dash_pair" || !Number.isFinite(expiresAt) || expiresAt <= now) return false;
  const video = (candidate.videoTracks || []).find((track) => track.trackId === candidate.selectedVideoTrackId);
  const audio = (candidate.audioTracks || []).find((track) => track.trackId === candidate.selectedAudioTrackId);
  return Boolean(
    video
    && audio
    && video.url !== audio.url
    && isFreshBilibiliTrack(video, now)
    && isFreshBilibiliTrack(audio, now)
    && canPairBilibiliTracks(video, audio, true)
  );
}

function dashPairHeaders(tabId, url) {
  const key = headerKey(tabId, url);
  const capture = requestHeaders.get(key);
  if (capture && Date.now() - capture.at > HEADER_TTL_MS) requestHeaders.delete(key);
  const safe = capture && Date.now() - capture.at <= HEADER_TTL_MS
    ? nonSensitiveMediaHeaders(capture.headers)
    : {};
  const result = { referer: BILIBILI_SAFE_REFERER };
  if (safe.accept) result.accept = safe.accept;
  if (safe["user-agent"]) result["user-agent"] = safe["user-agent"];
  return result;
}

async function startDownload(candidate, options, tabId) {
  let url = canonicalizeUrl(candidate?.url);
  if (!url) throw new Error("媒体地址无效");
  let dashPair = candidate.kind === "dash_pair" ? selectDashPairTracks(candidate, options.variantUrl) : null;
  if (dashPair) url = dashPair.video.url;
  // YouTube downloads only ever reach this branch through the explicit
  // experimental opt-in; the page URL is handed to the local yt-dlp engine.
  if (isPolicyBlocked(url, candidate?.tabUrl) && candidate?.kind !== "youtube") throw new Error("商店版本不支持从此平台下载");
  const settings = await getSettings();
  const networkScope = networkScopeForSettings(settings);
  url = requireNetworkRequest({
    url,
    purpose: "user_download",
    provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "user_supplied",
    networkScope,
    userInitiated: true
  });
  if (dashPair) {
    requireNetworkRequest({
      url: dashPair.audio.url,
      purpose: "manifest_child",
      provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "fixed_site_api",
      networkScope,
      userInitiated: true
    });
  }
  if (matchesBlockedDomain(url, settings.blockedDomains) || matchesBlockedDomain(candidate?.tabUrl, settings.blockedDomains)) {
    throw new Error("该域名已在 FluxCatch 设置中被忽略");
  }
  const opts = normalizeDownloadOptions(options, settings);
  if (candidate.kind === "hls" || candidate.kind === "dash") {
    try {
      const inspection = await probeManifest(candidate, { userInitiated: true, networkScope });
      const unsupportedHls = hlsUnsupportedReason(inspection);
      if (unsupportedHls) {
        const error = new Error(unsupportedHls);
        error.code = "HLS_UNSUPPORTED";
        throw error;
      }
      if (inspection.protected) throw new Error("检测到 DRM 内容保护，仅显示媒体信息");
      probeForUi(inspection, candidate);
    } catch (error) {
      if (error?.code || /DRM|内容保护|网络策略/i.test(error?.message || "")) throw error;
      // An authenticated manifest may be unavailable to extension fetch. The
      // native host can still use the request headers observed for this tab.
    }
  }
  const preDispatchCandidate = requireTabCandidate(tabId, candidate);
  if (preDispatchCandidate.kind !== candidate.kind
    || (candidate.kind !== "dash_pair" && canonicalizeUrl(preDispatchCandidate.url) !== canonicalizeUrl(candidate.url))) {
    throw new Error("该媒体候选项已更新，请重新选择后下载");
  }
  candidate = preDispatchCandidate;
  const pageTitle = candidate.pageTitle || candidate.title || "media";
  const requestedName = cleanText(options.filename, 200) || renderFilename(candidate, settings.filenameTemplate, pageTitle);
  const filename = sanitizeFilename(requestedName);
  // chrome.downloads follows redirects outside the worker's fetch policy.
  // Keep the generic path limited to a final response observed by webRequest;
  // the only site-payload exceptions below are complete Instagram/X MP4s with
  // exact top-frame, provenance, scheme, CDN-host and fragment checks.
  const instagramBrowserDirect = isTrustedInstagramBrowserDirectCandidate(candidate);
  const xBrowserDirect = isTrustedXBrowserDirectCandidate(candidate);
  // Browser download APIs expose neither DNS answers nor connected peer IPs,
  // and redirects escape this worker's policy hook. In public-only mode the
  // generic observed-response path therefore uses the pinned native broker.
  // The two browser exceptions are fixed page/CDN/provenance allowlists above.
  const browserDirectEligible = instagramBrowserDirect || xBrowserDirect;
  // A strictly allow-listed Instagram/X MP4 may stay in Chrome by default.
  // The explicit useNativeForDirect preference is still honored so users can
  // opt those final browser exceptions into the pinned native path as well.
  const advanced = candidate.kind === "hls" || candidate.kind === "dash" || candidate.kind === "dash_pair" || candidate.kind === "youtube"
    || opts.extractAudio || opts.convert || opts.useNativeForDirect || !browserDirectEligible;
  const requestedVariantUrl = dashPair ? null : resolveManifestVariantSelector(candidate, options.variantUrl);
  if (requestedVariantUrl) {
    requireNetworkRequest({
      url: requestedVariantUrl,
      purpose: "manifest_child",
      provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "user_supplied",
      networkScope,
      userInitiated: true
    });
  }

  if (!advanced) {
    const id = await chrome.downloads.download({
      url,
      filename: `FluxCatch/${filename}`,
      saveAs: Boolean(opts.saveAs),
      conflictAction: "uniquify"
    });
    requestHeaders.delete(headerKey(tabId, url));
    scheduleHeaderPrune();
    const jobId = `browser:${id}`;
    const browserJob = await mergeJob(jobId, {
      method: "browser",
      downloadId: id,
      tabId,
      kind: candidate.kind,
      filename,
      status: "downloading",
      progress: 0,
      speed: 0,
      bytes: 0,
      total: Number(candidate.contentLength || 0),
      message: "浏览器正在下载"
    });
    // Establish the durable job before accepting onChanged events. Otherwise a
    // very fast download can emit a terminal event while the id is tracked but
    // before its job exists, causing the listener to discard the tracking id.
    browserDownloads.add(id);
    // A loopback/small file can finish before downloads.download() resolves or
    // while the initial job snapshot is being persisted. Reconcile immediately
    // after tracking starts so that a terminal event from either gap is retained.
    if (typeof chrome.downloads.search === "function") await reconcileBrowserJob(browserJob, false);
    return { method: "browser", downloadId: id, jobId };
  }

  if (!await hasNativePermission()) throw new Error("需要授权连接本地引擎，才能使用此下载模式");
  const port = await ensureNativePort();
  if (candidate.kind === "youtube" && ytdlpNetworkDisabled()) {
    throw new Error("0.2.5 暂停外部引擎联网，等待受控网络代理");
  }
  const finalCandidate = requireTabCandidate(tabId, candidate);
  if (!dashPair && (finalCandidate.kind !== candidate.kind || canonicalizeUrl(finalCandidate.url) !== canonicalizeUrl(candidate.url))) {
    throw new Error("该媒体候选项已更新，请重新选择后下载");
  }
  candidate = finalCandidate;
  if (dashPair) {
    // Permission prompts and native-host startup are asynchronous. Resolve the
    // candidate again at the final dispatch boundary so navigation, a newer
    // signature, or TTL expiry cannot leave a stale pair queued in the host.
    dashPair = selectDashPairTracks(candidate, options.variantUrl);
    url = dashPair.video.url;
    requireNetworkRequest({
      url,
      purpose: "manifest_child",
      provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "fixed_site_api",
      networkScope,
      userInitiated: true
    });
    requireNetworkRequest({
      url: dashPair.audio.url,
      purpose: "manifest_child",
      provenance: CANDIDATE_PROVENANCES.includes(candidate?.provenance) ? candidate.provenance : "fixed_site_api",
      networkScope,
      userInitiated: true
    });
    if (isPolicyBlocked(url, candidate?.tabUrl)
      || matchesBlockedDomain(url, settings.blockedDomains)
      || matchesBlockedDomain(candidate?.tabUrl, settings.blockedDomains)) {
      throw new Error("该域名已在 FluxCatch 设置中被忽略");
    }
  }
  const jobId = crypto.randomUUID();
  const captureKey = headerKey(tabId, url);
  const capture = requestHeaders.get(captureKey);
  const captured = dashPair
    ? dashPairHeaders(tabId, dashPair.video.url)
    : capture && Date.now() - capture.at <= HEADER_TTL_MS ? capture.headers : {};
  const audioCaptureKey = dashPair ? headerKey(tabId, dashPair.audio.url) : null;
  const audioHeaders = dashPair ? dashPairHeaders(tabId, dashPair.audio.url) : null;
  if (capture && !dashPair && captured !== capture.headers) requestHeaders.delete(captureKey);
  const total = dashPair
    ? Number(dashPair.video.contentLength || 0) + Number(dashPair.audio.contentLength || 0)
    : Number(candidate.contentLength || 0);
  await mergeJob(jobId, {
    method: "native",
    tabId,
    kind: candidate.kind,
    filename,
    status: "queued",
    progress: 0,
    speed: 0,
    bytes: 0,
    total,
    message: "等待本地引擎"
  });
  try {
    if (dashPair) {
      const currentCandidate = requireTabCandidate(tabId, candidate);
      if (currentCandidate !== candidate) throw new Error("视频清晰度地址已更新，请重新开始下载");
      const finalPair = selectDashPairTracks(currentCandidate, options.variantUrl);
      if (finalPair.video.url !== dashPair.video.url || finalPair.audio.url !== dashPair.audio.url) {
        throw new Error("视频清晰度地址已更新，请重新开始下载");
      }
      dashPair = finalPair;
    }
    port.postMessage({
      type: "download",
      jobId,
      url,
      mediaKind: candidate.kind,
      filename,
      headers: captured,
      options: {
        concurrentFragments: opts.concurrentFragments,
        concurrentRanges: opts.concurrentRanges,
        outputContainer: opts.outputContainer,
        extractAudio: Boolean(opts.extractAudio),
        convert: Boolean(opts.convert),
        liveDuration: Number(opts.liveDuration || 0),
        variantUrl: requestedVariantUrl,
        audioUrl: dashPair?.audio.url || null,
        audioHeaders,
        expiresAt: dashPair?.expiresAt || null,
        expectedDuration: dashPair ? positive(candidate.duration) || 0 : 0,
        allowPrivateNetworkMedia: Boolean(settings.allowPrivateNetworkMedia)
      }
    });
    // Keep the capture only while this in-memory native job is active so a
    // second rendition can still be queued; terminal events remove it early.
    const captureKeys = [capture ? captureKey : null, dashPair && requestHeaders.has(audioCaptureKey) ? audioCaptureKey : null].filter(Boolean);
    if (captureKeys.length) jobHeaderKeys.set(jobId, captureKeys);
  } catch (error) {
    requestHeaders.delete(captureKey);
    if (audioCaptureKey) requestHeaders.delete(audioCaptureKey);
    jobHeaderKeys.delete(jobId);
    scheduleHeaderPrune();
    await mergeJob(jobId, { status: "failed", message: error?.message || "本地引擎未接收任务", error: error?.message, speed: 0 });
    const dispatchError = new Error(error?.message || "本地引擎未接收任务");
    dispatchError.jobId = jobId;
    throw dispatchError;
  }
  return { method: "native", jobId };
}

async function ensureNativePort({ requireCompatibility = true } = {}) {
  if (nativePort && hostStatus.connected) {
    if (requireCompatibility) requireCompatibleNativeHost();
    return nativePort;
  }
  if (nativeConnectPromise) {
    const port = await nativeConnectPromise;
    // A status probe may own the shared connection with compatibility checks
    // disabled. Every concurrent action must still enforce its own policy
    // before it can use that same port for a download or cancellation.
    if (requireCompatibility) requireCompatibleNativeHost();
    return port;
  }
  nativeConnectPromise = openNativePort();
  try {
    const port = await nativeConnectPromise;
    if (requireCompatibility) requireCompatibleNativeHost();
    return port;
  } finally {
    nativeConnectPromise = null;
  }
}

async function openNativePort() {
  if (!await hasNativePermission()) throw new Error("尚未授权连接本地引擎");
  if (!await waitForNativeMessagingApi()) {
    const marker = await readNativeApiRecoveryMarker();
    const message = marker?.phase === "restart_required"
      ? NATIVE_API_RESTART_MESSAGE
      : NATIVE_API_UNAVAILABLE_MESSAGE;
    hostStatus = disconnectedHostStatus({
      failureReason: "api_unavailable",
      lastError: message,
      restartRequired: marker?.phase === "restart_required"
    });
    throw new Error(message);
  }
  // The binding itself is the recovery signal. Clear stale waiting/terminal
  // guidance before attempting the host so every recheck converges in one
  // action even when Chrome restored the API between UI sessions.
  await clearNativeApiRecoveryMarker();
  // The optional permission may be removed while the worker is waiting for
  // Chrome to expose connectNative. Never connect on a stale permission read.
  if (!await hasNativePermission()) {
    hostStatus = disconnectedHostStatus({ needsPermission: true });
    throw new Error("尚未授权连接本地引擎");
  }
  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    const failure = nativeConnectionFailure(error);
    hostStatus = disconnectedHostStatus(failure);
    throw new Error(failure.lastError);
  }
  nativePort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "pong") {
      hostStatus = {
        connected: true,
        version: message.version || null,
        protocolVersion: message.protocolVersion ?? null,
        capabilityProfileVersion: message.capabilityProfileVersion ?? null,
        ffmpeg: Boolean(message.ffmpeg),
        capabilities: message.capabilities && typeof message.capabilities === "object" ? message.capabilities : null,
        needsPermission: false,
        failureReason: null,
        lastError: null
      };
      void clearNativeApiRecoveryMarker();
      if (ytdlpNetworkDisabled()) void dropYouTubeCandidates();
      resolveHostPing(port, message.requestId);
    }
    void handleNativeHostMessage(message);
  });
  port.onDisconnect.addListener(() => {
    const failure = nativeConnectionFailure(chrome.runtime.lastError?.message || "");
    rejectHostPings(port, new Error(failure.lastError));
    if (nativePort !== port) return;
    nativePort = null;
    hostStatus = disconnectedHostStatus(failure);
    void handleNativeDisconnect(failure.lastError);
  });
  try {
    await pingNativePort(port);
    return port;
  } catch (error) {
    if (nativePort === port) {
      nativePort = null;
      const failure = nativeConnectionFailure(error);
      hostStatus = disconnectedHostStatus(failure);
    }
    try { port.disconnect?.(); } catch { /* The failed port may already be closed. */ }
    throw error;
  }
}

async function recoverNativeMessagingApi() {
  await nativeRecoveryReady;
  if (!await hasNativePermission()) {
    await clearNativeApiRecoveryMarker();
    hostStatus = disconnectedHostStatus({ needsPermission: true });
    return { retryAfterMs: 0, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
  }
  if (typeof chrome.runtime.connectNative === "function") {
    await clearNativeApiRecoveryMarker();
    try { await ensureNativePort({ requireCompatibility: false }); } catch { /* Public status describes the failure. */ }
    return { retryAfterMs: 0, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
  }

  const marker = await readNativeApiRecoveryMarker();
  if (marker?.phase === "restart_required") {
    hostStatus = disconnectedHostStatus({
      failureReason: "api_unavailable",
      lastError: NATIVE_API_RESTART_MESSAGE,
      restartRequired: true
    });
    return {
      retryAfterMs: 0,
      recoveryBlocked: true,
      restartRequired: true,
      hostStatus: hostStatusForUi(hostStatus)
    };
  }
  if (marker?.phase === "resumed") {
    const resumeCount = Math.min(
      NATIVE_API_RECOVERY_RESUME_LIMIT,
      nativeApiRecoveryResumeCount(marker) + 1
    );
    const nextMarker = resumeCount >= NATIVE_API_RECOVERY_RESUME_LIMIT
      ? { ...marker, phase: "restart_required", resumeCount }
      : { ...marker, resumeCount };
    if (!await writeNativeApiRecoveryMarker(nextMarker)) {
      hostStatus = disconnectedHostStatus({ needsPermission: true });
      return { retryAfterMs: 0, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
    }
    const restartRequired = nextMarker.phase === "restart_required";
    const message = restartRequired ? NATIVE_API_RESTART_MESSAGE : NATIVE_API_UNAVAILABLE_MESSAGE;
    hostStatus = disconnectedHostStatus({ failureReason: "api_unavailable", lastError: message, restartRequired });
    return {
      retryAfterMs: 0,
      recoveryBlocked: restartRequired,
      restartRequired,
      hostStatus: hostStatusForUi(hostStatus)
    };
  }
  if (marker?.phase === "waiting") {
    const retryAfterMs = Math.max(0, marker.retryAt - Date.now());
    if (retryAfterMs > 0) {
      return { retryAfterMs, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
    }
    if (!await writeNativeApiRecoveryMarker({
      ...marker,
      phase: "resumed",
      resumeCount: Math.min(NATIVE_API_RECOVERY_RESUME_LIMIT, nativeApiRecoveryResumeCount(marker) + 1)
    })) {
      hostStatus = disconnectedHostStatus({ needsPermission: true });
      return { retryAfterMs: 0, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
    }
    hostStatus = disconnectedHostStatus({ failureReason: "api_unavailable", lastError: NATIVE_API_UNAVAILABLE_MESSAGE });
    return { retryAfterMs: 0, recoveryBlocked: false, restartRequired: false, hostStatus: hostStatusForUi(hostStatus) };
  }

  const now = Date.now();
  const waiting = {
    phase: "waiting",
    requestedAt: now,
    retryAt: now + NATIVE_API_RECOVERY_WAIT_MS,
    expiresAt: now + NATIVE_API_RECOVERY_TTL_MS,
    resumeCount: 0
  };
  if (!await writeNativeApiRecoveryMarker(waiting)) {
    hostStatus = disconnectedHostStatus({ needsPermission: true });
    return { retryAfterMs: 0, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
  }
  return { retryAfterMs: NATIVE_API_RECOVERY_WAIT_MS, recoveryBlocked: false, hostStatus: hostStatusForUi(hostStatus) };
}

async function writeNativeApiRecoveryMarker(marker) {
  await chrome.storage.local.set({ [NATIVE_API_RECOVERY_KEY]: marker });
  if (await hasNativePermission()) return true;
  await clearNativeApiRecoveryMarker();
  return false;
}

async function prepareNativeApiRecoveryAtStartup() {
  const marker = await readNativeApiRecoveryMarker();
  if (marker?.phase !== "waiting" || marker.retryAt > Date.now()) return;
  if (!await hasNativePermission()) {
    await clearNativeApiRecoveryMarker();
    return;
  }
  const current = await readNativeApiRecoveryMarker();
  if (current?.phase !== "waiting" || current.requestedAt !== marker.requestedAt) return;
  const resumeCount = Math.min(
    NATIVE_API_RECOVERY_RESUME_LIMIT,
    nativeApiRecoveryResumeCount(current) + 1
  );
  await writeNativeApiRecoveryMarker({
    ...current,
    phase: resumeCount >= NATIVE_API_RECOVERY_RESUME_LIMIT ? "restart_required" : "resumed",
    resumeCount
  });
}

async function readNativeApiRecoveryMarker() {
  let stored;
  try { stored = (await chrome.storage.local.get(NATIVE_API_RECOVERY_KEY))?.[NATIVE_API_RECOVERY_KEY]; } catch { return null; }
  const valid = stored && ["waiting", "resumed", "restart_required"].includes(stored.phase)
    && Number.isFinite(stored.requestedAt) && Number.isFinite(stored.retryAt) && Number.isFinite(stored.expiresAt)
    && stored.retryAt >= stored.requestedAt && stored.retryAt <= stored.expiresAt
    && stored.expiresAt - stored.requestedAt <= NATIVE_API_RECOVERY_TTL_MS;
  if (valid) {
    const normalized = { ...stored, resumeCount: nativeApiRecoveryResumeCount(stored) };
    if (stored.phase === "restart_required") return normalized;
    if (stored.expiresAt > Date.now()) return normalized;
    // An expired recovery attempt is evidence that Chrome never restored the
    // API. Preserve that outcome instead of clearing it and starting the same
    // waiting -> resumed -> expired loop again.
    const terminal = {
      ...normalized,
      phase: "restart_required",
      resumeCount: NATIVE_API_RECOVERY_RESUME_LIMIT
    };
    return await writeNativeApiRecoveryMarker(terminal) ? terminal : null;
  }
  if (stored) await clearNativeApiRecoveryMarker();
  return null;
}

function nativeApiRecoveryResumeCount(marker) {
  if (Number.isInteger(marker?.resumeCount) && marker.resumeCount >= 0) {
    return Math.min(NATIVE_API_RECOVERY_RESUME_LIMIT, marker.resumeCount);
  }
  if (marker?.phase === "resumed") return 1;
  if (marker?.phase === "restart_required") return NATIVE_API_RECOVERY_RESUME_LIMIT;
  return 0;
}

async function clearNativeApiRecoveryMarker() {
  try {
    if (typeof chrome.storage.local.remove === "function") await chrome.storage.local.remove(NATIVE_API_RECOVERY_KEY);
    else await chrome.storage.local.set({ [NATIVE_API_RECOVERY_KEY]: null });
  } catch { /* Recovery state is best-effort and contains no sensitive data. */ }
}

async function handleNativePermissionRemoved() {
  const port = nativePort;
  nativePort = null;
  hostStatus = disconnectedHostStatus({ needsPermission: true });
  rejectHostPings(port, new Error("本地下载引擎权限已关闭"));
  try { port?.disconnect?.(); } catch { /* The port may already be closed. */ }
  await clearNativeApiRecoveryMarker();
  await handleNativeDisconnect("本地下载引擎权限已关闭");
}

async function waitForNativeMessagingApi() {
  const deadline = Date.now() + NATIVE_API_BINDING_WAIT_MS;
  do {
    if (typeof chrome.runtime.connectNative === "function") return true;
    await new Promise((resolve) => setTimeout(resolve, 50));
  } while (Date.now() < deadline);
  return typeof chrome.runtime.connectNative === "function";
}

function nativeConnectionFailure(error) {
  const raw = typeof error === "string" ? error : error?.message || "";
  // Keep classification idempotent: an onDisconnect listener rejects the
  // pending ping with the already-sanitized message, which is then handled by
  // openNativePort's catch path a second time.
  const hostMissing = raw === NATIVE_HOST_MISSING_MESSAGE
    || /specified native messaging host not found|native messaging host.*not found/i.test(raw);
  return {
    failureReason: hostMissing ? "host_missing" : "connection_failed",
    lastError: hostMissing ? NATIVE_HOST_MISSING_MESSAGE : NATIVE_CONNECTION_FAILED_MESSAGE
  };
}

function pingNativePort(port) {
  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHostPings.delete(requestId);
      reject(new Error("本地引擎响应超时"));
    }, 5_000);
    pendingHostPings.set(requestId, { port, resolve, reject, timer });
    try {
      port.postMessage({ type: "ping", requestId });
    } catch (error) {
      clearTimeout(timer);
      pendingHostPings.delete(requestId);
      reject(error);
    }
  });
}

function resolveHostPing(port, requestId) {
  const pending = pendingHostPings.get(requestId);
  if (!pending || pending.port !== port) return;
  clearTimeout(pending.timer);
  pendingHostPings.delete(requestId);
  pending.resolve();
}

function rejectHostPings(port, error) {
  for (const [requestId, pending] of pendingHostPings) {
    if (pending.port !== port) continue;
    clearTimeout(pending.timer);
    pendingHostPings.delete(requestId);
    pending.reject(error);
  }
}

async function handleNativeHostMessage(message) {
  const jobId = cleanText(message?.jobId, 128);
  let updatedJob = null;
  if (jobId) {
    const status = nativeJobStatus(message);
    if (status) {
      updatedJob = await mergeJob(jobId, {
        method: "native",
        filename: cleanText(message.filename, 180) || undefined,
        status,
        progress: message.progress,
        speed: message.speed,
        bytes: message.bytes ?? message.size,
        total: message.total ?? message.size,
        message: cleanText(message.message, 240) || undefined,
        error: cleanText(message.error, 240) || undefined
      }, {
        deferPersistence: message?.type === "progress" && status === "downloading"
      });
      if (TERMINAL_JOB_STATUSES.has(status)) cleanupJobHeaders(jobId);
    }
  }
  broadcast({ type: "HOST_EVENT", event: hostEventForUi(message), hostStatus: hostStatusForUi(hostStatus) });
  if (updatedJob && ["completed", "failed"].includes(updatedJob.status)) await maybeNotifyJob(updatedJob);
}

async function handleNativeDisconnect(error) {
  const updates = [];
  for (const [jobId, job] of jobs) {
    if (job.method !== "native" || TERMINAL_JOB_STATUSES.has(job.status)) continue;
    const updated = normalizeJob({ ...job, status: "failed", message: error, error, speed: 0, updatedAt: Date.now() });
    jobs.set(jobId, updated);
    cleanupJobHeaders(jobId);
    updates.push(updated);
  }
  if (updates.length) await persistJobs();
  broadcast({
    type: "HOST_EVENT",
    event: hostEventForUi({ type: "host-disconnected" }),
    hostStatus: hostStatusForUi(hostStatus)
  });
  for (const job of updates) broadcast({ type: "JOB_UPDATED", job: jobForUi(job) });
  for (const job of updates) await maybeNotifyJob(job);
}

async function updateBrowserDownload(delta) {
  const jobId = `browser:${delta.id}`;
  const current = jobs.get(jobId);
  if (!current) {
    browserDownloads.delete(delta.id);
    return;
  }
  const browserState = delta.state?.current;
  const now = Date.now();
  const bytes = nonNegativeNumber(delta.bytesReceived?.current, current.bytes);
  const total = nonNegativeNumber(delta.totalBytes?.current ?? delta.fileSize?.current, current.total);
  const changedFilename = cleanText(delta.filename?.current, 500);
  // Keep the explicit name accepted when the job was started. Chrome may emit
  // a transient URL-derived basename (or omit filename entirely) while its
  // download item is being created; neither should replace the user's name.
  const browserFilename = changedFilename ? displayFilename(changedFilename) : "";
  const elapsed = Math.max(0.001, (now - current.updatedAt) / 1000);
  const speed = bytes > current.bytes ? Math.round((bytes - current.bytes) / elapsed) : current.speed;
  let status = current.status;
  let message = current.message;
  let error = current.error;
  if (browserState === "in_progress") {
    status = "downloading";
    message = delta.paused?.current ? "浏览器下载已暂停" : "浏览器正在下载";
  } else if (browserState === "complete") {
    status = "completed";
    message = "已保存到下载目录";
    error = "";
  } else if (browserState === "interrupted") {
    const interruptReason = cleanText(delta.error?.current, 240);
    const userCancelled = browserCancellationRequested.has(delta.id)
      || interruptReason.toUpperCase() === "USER_CANCELED";
    status = userCancelled ? "cancelled" : "failed";
    error = userCancelled ? "" : interruptReason || "浏览器下载中断";
    message = userCancelled ? "任务已取消" : error;
  }
  const progress = status === "completed" ? 1 : total > 0 ? bytes / total : current.progress;
  const merged = await mergeJob(jobId, {
    status,
    progress,
    speed: TERMINAL_JOB_STATUSES.has(status) ? 0 : speed,
    bytes,
    total,
    filename: current.filename && current.filename !== "media" ? undefined : browserFilename || undefined,
    message,
    error
  });
  broadcast({ type: "BROWSER_DOWNLOAD", downloadId: delta.id, state: browserState || status, error: delta.error?.current || null });
  if (["completed", "failed"].includes(merged.status) && !TERMINAL_JOB_STATUSES.has(current.status)) {
    await maybeNotifyJob(merged);
  }
  if (TERMINAL_JOB_STATUSES.has(merged.status)) {
    browserDownloads.delete(delta.id);
    browserCancellationRequested.delete(delta.id);
  }
}

async function mergeJob(jobId, patch, { deferPersistence = false } = {}) {
  const safeId = cleanText(jobId, 128);
  if (!safeId) throw new Error("任务编号无效");
  const now = Date.now();
  const old = jobs.get(safeId);
  const definedPatch = Object.fromEntries(Object.entries(patch || {}).filter(([, value]) => value !== undefined));
  const requestedStatus = cleanText(definedPatch.status, 32).toLowerCase();
  // Commit-point guard: downloads.search() and onChanged can both prepare an
  // update from the same older snapshot. Once either one commits a terminal
  // browser state, a later stale update must not overwrite it.
  if (
    old?.method === "browser"
    && TERMINAL_JOB_STATUSES.has(old.status)
    && requestedStatus
    && requestedStatus !== old.status
  ) return old;
  const job = normalizeJob({
    ...old,
    ...definedPatch,
    jobId: safeId,
    createdAt: old?.createdAt || now,
    updatedAt: now
  });
  jobs.set(safeId, job);
  trimJobs();
  if (deferPersistence) scheduleJobPersistence();
  else await persistJobs();
  broadcast({ type: "JOB_UPDATED", job: jobForUi(job) });
  return job;
}

function nativeJobStatus(message) {
  const direct = cleanText(message?.status, 32).toLowerCase();
  if (JOB_STATUSES.has(direct)) return direct;
  return ({ complete: "completed", failed: "failed", cancelled: "cancelled" })[message?.type] || null;
}

async function maybeNotifyJob(job) {
  const status = job?.status;
  if (!job?.jobId || !["completed", "failed"].includes(status)) return;
  const settings = await getSettings();
  if (!settings.showNotifications) return;
  const filename = displayFilename(job.filename);
  const detail = status === "completed"
    ? `${filename} 已保存`
    : redactJobText(job.message || job.error, 240) || `${filename} 下载失败`;
  try {
    await chrome.notifications.create(`fluxcatch:${job.jobId}:${status}`, {
      type: "basic",
      iconUrl: chrome.runtime.getURL("icons/icon128.png"),
      title: status === "completed" ? "FluxCatch 下载完成" : "FluxCatch 下载失败",
      message: detail
    });
  } catch {
    // Notifications can be disabled by browser policy.
  }
}

function broadcast(message) {
  for (const port of hostClients) {
    try { port.postMessage(message); } catch { hostClients.delete(port); }
  }
}

async function updateBadge(tabId) {
  const count = [...(tabMedia.get(tabId)?.values() || [])].filter((item) => item.kind !== "segment" && !item.mergedInto).length;
  try {
    await chrome.action.setBadgeText({ tabId, text: count ? String(Math.min(count, 99)) : "" });
    await Promise.allSettled([
      chrome.action.setBadgeBackgroundColor({ tabId, color: count ? "#7C6FA3" : "#66716D" }),
      chrome.action.setBadgeTextColor?.({ tabId, color: "#FFFFFF" }),
      chrome.action.setTitle({ tabId, title: count ? `FluxCatch — 检测到 ${count} 个媒体` : "FluxCatch — 暂未检测到媒体" })
    ]);
  } catch {
    // The tab may have closed.
  }
}

async function restoreSession() {
  try {
    const data = await chrome.storage.session.get(["tabMedia", "tabPreviews", "jobs"]);
    for (const [tabId, items] of Object.entries(data.tabMedia || {})) {
      const numericTabId = Number(tabId);
      if (!Number.isInteger(numericTabId) || numericTabId < 0 || !Array.isArray(items)) continue;
      const restored = new Map();
      for (const item of items.slice(0, MAX_ITEMS_PER_TAB)) {
        const url = canonicalizeUrl(item?.url);
        if (!url || isLikelySubtitleResource({ url, mime: item?.mime }) || !["video", "audio", "hls", "dash", "segment", "youtube"].includes(item?.kind)) continue;
        // Heal session data written by older workers that treated Instagram's
        // query-addressed MediaSource fragments as complete MP4 candidates.
        // Keeping them hidden only in the UI would let the stale rows return on
        // every worker restart, so discard them at the restore boundary.
        const restoredClassification = classifyMedia({
          url,
          mime: item?.mime,
          resourceType: item?.resourceType,
          contentLength: item?.contentLength
        });
        if (isInstagramByteRangeFragment(url) && restoredClassification?.kind === "segment") continue;
        const persisted = candidateForPersistence({ ...item, url });
        if (!persisted) continue;
        const preview = previewFromCandidate(persisted);
        const manifest = item.kind === "hls" || item.kind === "dash";
        const sourceFilenames = uniqueCleanTexts([
          ...(Array.isArray(item.sourceFilenames) ? item.sourceFilenames : []),
          item.suggestedFilename
        ], 260, 40);
        const naming = candidateNaming({
          kind: item.kind,
          ext: cleanText(item.ext, 12),
          url,
          inputTitle: item.title,
          pageTitle: cleanText(item.pageTitle, 240),
          suggestedFilenames: sourceFilenames
        });
        const fingerprint = cleanText(item.manifestFingerprint, 128).toLowerCase();
        restored.set(`${item.kind}:${url}`, {
          ...persisted,
          id: randomOpaqueId(),
          generation: currentTabGeneration(numericTabId),
          url,
          title: naming.title,
          suggestedFilename: naming.suggestedFilename,
          sourceFilenames,
          contentLength: manifest ? 0 : Math.max(0, Number(item.contentLength || 0)),
          manifestSize: manifest ? Math.max(0, Number(item.manifestSize || 0), Number(item.contentLength || 0)) : null,
          manifestType: ["master", "media"].includes(item.manifestType) ? item.manifestType : null,
          manifestVariantCount: boundedInt(item.manifestVariantCount, 0, 10_000, 0),
          manifestAudioTrackCount: boundedInt(item.manifestAudioTrackCount, 0, 10_000, 0),
          manifestSubtitleTrackCount: boundedInt(item.manifestSubtitleTrackCount, 0, 10_000, 0),
          manifestReferences: normalizeUrlList(item.manifestReferences),
          manifestRedirectUrl: canonicalizeUrl(item.manifestRedirectUrl) || null,
          manifestFingerprint: /^[a-f0-9]{64}$/.test(fingerprint) ? fingerprint : null,
          manifestProbeStatus: item.manifestProbeStatus === "parsed" ? "parsed" : null,
          manifestInspectedAt: positive(item.manifestInspectedAt) || null,
          mergedInto: null,
          aliases: [],
          provenance: CANDIDATE_PROVENANCES.includes(item.provenance)
            ? item.provenance
            : deriveCandidateProvenance(item, null),
          thumbnailUrl: preview?.thumbnailUrl || null,
          thumbnailSource: preview?.thumbnailSource || null,
          thumbnailFrameId: preview?.thumbnailFrameId ?? null,
          thumbnailAt: preview?.thumbnailAt || null,
          thumbnailAllowedOrigins: uniqueCleanTexts(preview?.thumbnailAllowedOrigins, 512, 16),
          thumbnailAdapterImageHosts: uniqueCleanTexts(preview?.thumbnailAdapterImageHosts, 255, 16),
          manifestText: null
        });
      }
      if (restored.size) {
        tabMedia.set(numericTabId, restored);
        regroupManifestCandidates(numericTabId);
        // Legacy session rows predate relation metadata. Re-inspect tabs with
        // multiple HLS candidates so an MV3 worker upgrade can fold them too.
        scheduleTabManifestInspections(numericTabId, "", false);
        const preview = choosePreview(...[...restored.values()].map(previewFromCandidate));
        if (preview) tabPreviews.set(numericTabId, preview);
      }
    }
    for (const [tabId, item] of Object.entries(data.tabPreviews || {})) {
      const numericTabId = Number(tabId);
      if (!Number.isInteger(numericTabId) || numericTabId < 0) continue;
      const preview = previewFromCandidate(previewForPersistence(item));
      if (preview) tabPreviews.set(numericTabId, choosePreview(tabPreviews.get(numericTabId), preview));
    }
    for (const raw of Array.isArray(data.jobs) ? data.jobs : []) {
      let job = normalizeJob(raw);
      if (!job.jobId) continue;
      if (job.method === "native" && !TERMINAL_JOB_STATUSES.has(job.status)) {
        job = normalizeJob({
          ...job,
          status: "failed",
          speed: 0,
          message: "浏览器后台已重启，原本地任务状态已失效",
          error: "请重新开始该下载任务",
          updatedAt: Date.now()
        });
      }
      const old = jobs.get(job.jobId);
      if (!old || job.updatedAt >= old.updatedAt) jobs.set(job.jobId, job);
    }
    trimJobs();
    const browserRestores = [];
    for (const job of jobs.values()) {
      if (job.method === "browser" && Number.isInteger(job.downloadId) && !TERMINAL_JOB_STATUSES.has(job.status)) {
        browserDownloads.add(job.downloadId);
        browserRestores.push(job);
      }
    }
    if (Array.isArray(data.jobs)) await chrome.storage.session.set({ jobs: jobsForUi() });
    if (typeof chrome.downloads.search === "function") {
      await Promise.all(browserRestores.map((job) => reconcileBrowserJob(job)));
    }
  } catch {
    // storage.session is optional in older Chromium forks.
  }
}

let persistChain = Promise.resolve();
function persistSession() {
  const data = {};
  // Bilibili track URLs carry short-lived signatures. dash_pair candidates
  // are intentionally volatile and are rediscovered only from later trusted
  // playback traffic or an explicit rescan after a worker restart.
  for (const [tabId, map] of tabMedia) {
    data[tabId] = [...map.values()]
      .filter((item) => item.kind !== "dash_pair")
      .map(candidateForPersistence)
      .filter(Boolean);
  }
  const previews = {};
  for (const [tabId, preview] of tabPreviews) {
    const persisted = previewForPersistence(preview);
    if (persisted) previews[tabId] = persisted;
  }
  // Timers may be discarded when an MV3 worker is suspended. Queue the actual
  // storage operation and return it so message handlers stay alive until done.
  persistChain = persistChain
    .catch(() => {})
    .then(() => chrome.storage.session.set({ tabMedia: data, tabPreviews: previews }))
    .catch(() => {});
  return persistChain;
}

function persistJobs() {
  if (jobPersistTimer !== null) clearTimeout(jobPersistTimer);
  jobPersistTimer = null;
  const storedJobs = [...jobs.values()]
    .sort((a, b) => a.createdAt - b.createdAt || a.jobId.localeCompare(b.jobId))
    .map(jobForUi);
  persistChain = persistChain
    .catch(() => {})
    .then(() => chrome.storage.session.set({ jobs: storedJobs }))
    .catch(() => {});
  return persistChain;
}

function scheduleJobPersistence() {
  if (jobPersistTimer !== null) return;
  jobPersistTimer = setTimeout(() => {
    jobPersistTimer = null;
    void persistJobs();
  }, JOB_PROGRESS_PERSIST_INTERVAL_MS);
  jobPersistTimer?.unref?.();
}

function jobsForUi() {
  return [...jobs.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    .map(jobForUi);
}

async function clearTerminalJobs() {
  let removed = 0;
  for (const [jobId, job] of jobs) {
    if (!TERMINAL_JOB_STATUSES.has(job.status)) continue;
    jobs.delete(jobId);
    cleanupJobHeaders(jobId);
    if (Number.isInteger(job.downloadId)) {
      browserDownloads.delete(job.downloadId);
      browserCancellationRequested.delete(job.downloadId);
    }
    removed += 1;
  }
  const visibleJobs = jobsForUi();
  if (removed) {
    await persistJobs();
    broadcast({ type: "JOBS_UPDATED", jobs: visibleJobs });
  }
  return { removed, jobs: visibleJobs };
}

function jobForUi(job) {
  return {
    jobId: job.jobId,
    method: job.method,
    downloadId: job.downloadId,
    tabId: job.tabId,
    kind: job.kind,
    filename: job.filename,
    status: job.status,
    progress: job.progress,
    speed: job.speed,
    bytes: job.bytes,
    total: job.total,
    message: job.message,
    error: job.error,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt
  };
}

function normalizeJob(value = {}) {
  const now = Date.now();
  const jobId = cleanText(value.jobId, 128);
  const method = value.method === "browser" ? "browser" : "native";
  const statusText = cleanText(value.status, 32).toLowerCase();
  const status = JOB_STATUSES.has(statusText) ? statusText : "queued";
  const total = nonNegativeNumber(value.total, 0);
  const bytes = nonNegativeNumber(value.bytes, 0);
  const progressValue = Number(value.progress);
  const progress = status === "completed"
    ? 1
    : Number.isFinite(progressValue)
      ? Math.max(0, Math.min(1, progressValue))
      : total > 0 ? Math.max(0, Math.min(1, bytes / total)) : 0;
  const createdAt = timestamp(value.createdAt, now);
  const updatedAt = Math.max(createdAt, timestamp(value.updatedAt, createdAt));
  return {
    jobId,
    method,
    downloadId: method === "browser" && Number.isInteger(value.downloadId) && value.downloadId >= 0 ? value.downloadId : null,
    tabId: Number.isInteger(value.tabId) && value.tabId >= 0 ? value.tabId : null,
    kind: ["video", "audio", "hls", "dash", "dash_pair", "youtube"].includes(value.kind) ? value.kind : "",
    filename: displayFilename(value.filename),
    status,
    progress,
    speed: TERMINAL_JOB_STATUSES.has(status) ? 0 : Math.min(nonNegativeNumber(value.speed, 0), Number.MAX_SAFE_INTEGER),
    bytes: Math.min(bytes, Number.MAX_SAFE_INTEGER),
    total: Math.min(total, Number.MAX_SAFE_INTEGER),
    message: redactJobText(value.message, 240),
    error: redactJobText(value.error, 240),
    createdAt,
    updatedAt
  };
}

function trimJobs() {
  if (jobs.size <= MAX_STORED_JOBS) return;
  const oldestTerminal = [...jobs.values()]
    .filter((job) => TERMINAL_JOB_STATUSES.has(job.status))
    .sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt);
  while (jobs.size > MAX_STORED_JOBS && oldestTerminal.length) jobs.delete(oldestTerminal.shift().jobId);
  // Active jobs are durable control state, not cache entries. If every slot is
  // active, temporarily exceed the history cap rather than orphan cancellation,
  // progress, or terminal reconciliation for a live transfer.
}

function cleanupJobHeaders(jobId) {
  const captureKeys = jobHeaderKeys.get(jobId);
  for (const captureKey of Array.isArray(captureKeys) ? captureKeys : captureKeys ? [captureKeys] : []) requestHeaders.delete(captureKey);
  jobHeaderKeys.delete(jobId);
  scheduleHeaderPrune();
}

async function reconcileBrowserJob(job, missingIsFailure = true) {
  try {
    const [item] = await chrome.downloads.search({ id: job.downloadId });
    if (!item) {
      if (!missingIsFailure) return;
      await mergeJob(job.jobId, { status: "failed", speed: 0, message: "浏览器下载记录已不存在", error: "浏览器下载记录已不存在" });
      browserDownloads.delete(job.downloadId);
      return;
    }
    await updateBrowserDownload({
      id: job.downloadId,
      state: { current: item.state },
      paused: { current: Boolean(item.paused) },
      bytesReceived: { current: Number(item.bytesReceived || 0) },
      totalBytes: { current: Number(item.totalBytes || 0) },
      filename: { current: item.filename || job.filename },
      error: item.error ? { current: item.error } : undefined
    });
  } catch {
    // Keep the restored snapshot when downloads history is temporarily unavailable.
  }
}

async function getSettings() {
  const data = await chrome.storage.local.get("settings");
  const settings = normalizeSettings(data.settings || {});
  if (settings.youtubeEnabled && !ytdlpNetworkAllowed()) {
    settings.youtubeEnabled = false;
    await chrome.storage.local.set({ settings });
  }
  return settings;
}

function normalizeSettings(value) {
  return {
    ...DEFAULT_SETTINGS,
    concurrentFragments: boundedInt(value.concurrentFragments, 1, 24, DEFAULT_SETTINGS.concurrentFragments),
    concurrentRanges: boundedInt(value.concurrentRanges, 1, 24, DEFAULT_SETTINGS.concurrentRanges),
    outputContainer: ["mp4", "mkv", "webm"].includes(value.outputContainer) ? value.outputContainer : DEFAULT_SETTINGS.outputContainer,
    saveAs: Boolean(value.saveAs),
    useNativeForDirect: Boolean(value.useNativeForDirect),
    minimumBytes: boundedInt(value.minimumBytes, 0, 100 * 1024 * 1024, DEFAULT_SETTINGS.minimumBytes),
    // Live capture is deliberately unavailable in 0.2.5 while external-tool
    // networking is fail-closed. Ignore stale pre-upgrade preferences.
    liveDuration: 0,
    blockedDomains: normalizeDomains(value.blockedDomains),
    filenameTemplate: cleanText(value.filenameTemplate, 160) || DEFAULT_SETTINGS.filenameTemplate,
    showNotifications: Boolean(value.showNotifications),
    youtubeEnabled: Boolean(value.youtubeEnabled),
    autoEnrichSiteQuality: typeof value.autoEnrichSiteQuality === "boolean"
      ? value.autoEnrichSiteQuality
      : DEFAULT_SETTINGS.autoEnrichSiteQuality,
    allowPrivateNetworkMedia: Boolean(value.allowPrivateNetworkMedia)
  };
}

function normalizeDownloadOptions(value, fallback = DEFAULT_SETTINGS) {
  return {
    concurrentFragments: boundedInt(value.concurrentFragments, 1, 24, fallback.concurrentFragments),
    concurrentRanges: boundedInt(value.concurrentRanges, 1, 24, fallback.concurrentRanges),
    outputContainer: ["mp4", "mkv", "webm"].includes(value.outputContainer) ? value.outputContainer : fallback.outputContainer,
    extractAudio: Boolean(value.extractAudio),
    convert: Boolean(value.convert),
    useNativeForDirect: typeof value.useNativeForDirect === "boolean" ? value.useNativeForDirect : Boolean(fallback.useNativeForDirect),
    saveAs: typeof value.saveAs === "boolean" ? value.saveAs : Boolean(fallback.saveAs),
    liveDuration: 0
  };
}

function headerObject(headers) {
  const result = {};
  for (const header of headers) {
    const key = String(header.name || "").toLowerCase();
    if (key && typeof header.value === "string") result[key] = header.value;
  }
  return result;
}

function contentRangeTotal(value) {
  const match = String(value || "").match(/\/\s*(\d+)\s*$/);
  if (!match) return 0;
  const total = Number(match[1]);
  return Number.isSafeInteger(total) && total > 0 ? total : 0;
}

function contentDispositionFilename(value) {
  const source = String(value || "");
  const encoded = source.match(/(?:^|;)\s*filename\*\s*=\s*([^']*)'[^']*'([^;]*)/i);
  if (encoded) {
    try {
      const charset = encoded[1].trim().toLowerCase();
      if (!charset || charset === "utf-8" || charset === "us-ascii") {
        const decoded = decodeURIComponent(encoded[2].trim());
        if (decoded) return cleanText(decoded, 260);
      }
    } catch { /* fall through to filename= */ }
  }
  const quoted = source.match(/(?:^|;)\s*filename\s*=\s*"((?:\\.|[^"\\])*)"/i);
  if (quoted) return cleanText(quoted[1].replace(/\\(["\\])/g, "$1"), 260);
  const plain = source.match(/(?:^|;)\s*filename\s*=\s*([^;]+)/i);
  return plain ? cleanText(plain[1].trim(), 260) : "";
}

function candidateScore(item) {
  // On X, the progressive rendition is both complete and able to reuse
  // Chrome's working network path. Prefer it over the equivalent HLS row,
  // whose native direct connection may be reset on filtered networks.
  const kind = isTrustedXBrowserDirectCandidate(item)
    ? 400
    : ["hls", "dash", "dash_pair"].includes(item.kind) ? 300 : item.kind === "video" ? 200 : item.kind === "audio" ? 100 : 0;
  return kind + Number(item.confidence || 0) * 50 + Math.log10(Math.max(1, Number(item.contentLength || 0)));
}

function trimManifestCache(preferredTabId, preferredKey) {
  const cached = [];
  let globalChars = 0;
  for (const [tabId, map] of tabMedia) {
    let tabChars = 0;
    const tabCached = [];
    for (const [key, item] of map) {
      const chars = typeof item.manifestText === "string" ? item.manifestText.length : 0;
      if (!chars) continue;
      const entry = { tabId, key, item, chars, preferred: tabId === preferredTabId && key === preferredKey };
      tabCached.push(entry);
      cached.push(entry);
      tabChars += chars;
      globalChars += chars;
    }
    if (tabChars > MAX_MANIFEST_CACHE_CHARS_PER_TAB) {
      tabCached.sort((a, b) => Number(a.preferred) - Number(b.preferred) || a.item.lastSeen - b.item.lastSeen);
      while (tabChars > MAX_MANIFEST_CACHE_CHARS_PER_TAB && tabCached.length) {
        const entry = tabCached.shift();
        if (!entry.item.manifestText) continue;
        entry.item.manifestText = null;
        entry.dropped = true;
        tabChars -= entry.chars;
        globalChars -= entry.chars;
      }
    }
  }
  if (globalChars <= MAX_MANIFEST_CACHE_CHARS_GLOBAL) return;
  cached.sort((a, b) => Number(a.preferred) - Number(b.preferred) || a.item.lastSeen - b.item.lastSeen);
  for (const entry of cached) {
    if (globalChars <= MAX_MANIFEST_CACHE_CHARS_GLOBAL) break;
    if (entry.dropped || !entry.item.manifestText) continue;
    entry.item.manifestText = null;
    globalChars -= entry.chars;
  }
}

function randomOpaqueId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function currentTabGeneration(tabId) {
  let generation = tabGenerations.get(tabId);
  if (!generation) {
    generation = randomOpaqueId();
    tabGenerations.set(tabId, generation);
  }
  return generation;
}

function reusableOpaqueId(value) {
  const id = cleanText(value, 64).toLowerCase();
  return /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(id)
    ? id
    : randomOpaqueId();
}

function ytdlpNetworkAllowed() {
  const ytdlp = hostStatus?.capabilities?.ytdlp;
  return BUILD_PROFILE.features.externalToolNetwork
    && hostStatus?.connected === true
    && ytdlp?.available === true
    && ytdlp?.networkDisabled === false;
}

function disconnectedHostStatus({ needsPermission = false, failureReason = null, lastError = null, restartRequired = false } = {}) {
  return {
    connected: false,
    version: null,
    protocolVersion: null,
    capabilityProfileVersion: null,
    ffmpeg: false,
    capabilities: null,
    needsPermission: Boolean(needsPermission),
    failureReason,
    lastError: lastError || null,
    restartRequired: Boolean(restartRequired)
  };
}

function requireCompatibleNativeHost() {
  if (hostCompatibility(hostStatus).compatible !== true) throw new Error(HOST_MISMATCH_MESSAGE);
}

function ytdlpNetworkDisabled() {
  return !ytdlpNetworkAllowed();
}

function headerKey(tabId, url) {
  return `${tabId}\n${url}`;
}

function sameOrigin(first, second) {
  try {
    return new URL(first).origin === new URL(second).origin;
  } catch {
    return false;
  }
}

function dropTabState(tabId) {
  // Rotate before deleting candidates so a still-open popup can never reuse a
  // reference captured from the previous document in the same tab.
  tabGenerations.set(tabId, randomOpaqueId());
  tabMedia.delete(tabId);
  tabPreviews.delete(tabId);
  bilibiliDashStates.delete(tabId);
  bilibiliDiscoveryAt.delete(tabId);
  bilibiliAutomaticDiscoveryAttemptAt.delete(tabId);
  bilibiliDiscoveryInFlight.delete(tabId);
  bilibiliObservationChains.delete(tabId);
  bilibiliTabTokens.delete(tabId);
  const pruneTimer = bilibiliPruneTimers.get(tabId);
  if (pruneTimer !== undefined) clearTimeout(pruneTimer);
  bilibiliPruneTimers.delete(tabId);
  const prefix = `${tabId}\n`;
  for (const token of manifestInspectionAttempted) if (token.startsWith(prefix)) manifestInspectionAttempted.delete(token);
  for (const token of manifestInspectionInFlight.keys()) if (token.startsWith(prefix)) manifestInspectionInFlight.delete(token);
  for (const [key, value] of requestHeaders) {
    if (value.tabId === tabId) requestHeaders.delete(key);
  }
  for (const [key, value] of pendingRequestHeaders) {
    if (value.tabId === tabId) pendingRequestHeaders.delete(key);
  }
  scheduleHeaderPrune();
}

async function clearTabAfterRestore(tabId, update) {
  await sessionReady;
  dropTabState(tabId);
  if (!update) tabGenerations.delete(tabId);
  await persistSession();
  if (update) await updateBadge(tabId);
}

function pruneHeaders() {
  const cutoff = Date.now() - HEADER_TTL_MS;
  for (const [url, value] of requestHeaders) if (value.at < cutoff) requestHeaders.delete(url);
  const pendingCutoff = Date.now() - PENDING_HEADER_TTL_MS;
  for (const [requestId, value] of pendingRequestHeaders) {
    if (value.at < pendingCutoff) pendingRequestHeaders.delete(requestId);
  }
  if (pendingRequestHeaders.size > MAX_PENDING_HEADER_REQUESTS) {
    const pendingOldest = [...pendingRequestHeaders.entries()].sort((a, b) => a[1].at - b[1].at);
    while (pendingRequestHeaders.size > MAX_PENDING_HEADER_REQUESTS && pendingOldest.length) {
      pendingRequestHeaders.delete(pendingOldest.shift()[0]);
    }
  }
  if (requestHeaders.size > 800) {
    const oldest = [...requestHeaders.entries()].sort((a, b) => a[1].at - b[1].at);
    while (requestHeaders.size > 800 && oldest.length) requestHeaders.delete(oldest.shift()[0]);
  }
  let capturedBytes = 0;
  const capturedOldest = [];
  for (const [key, value] of pendingRequestHeaders) {
    const bytes = Number.isFinite(value.bytes) ? value.bytes : capturedHeadersByteLength(value.headers);
    capturedBytes += bytes;
    capturedOldest.push({ map: pendingRequestHeaders, key, at: value.at, bytes });
  }
  for (const [key, value] of requestHeaders) {
    const bytes = Number.isFinite(value.bytes) ? value.bytes : capturedHeadersByteLength(value.headers);
    capturedBytes += bytes;
    capturedOldest.push({ map: requestHeaders, key, at: value.at, bytes });
  }
  if (capturedBytes > MAX_CAPTURED_HEADERS_GLOBAL_BYTES) {
    capturedOldest.sort((a, b) => a.at - b.at);
    let index = 0;
    while (capturedBytes > MAX_CAPTURED_HEADERS_GLOBAL_BYTES && index < capturedOldest.length) {
      const entry = capturedOldest[index++];
      if (!entry.map.delete(entry.key)) continue;
      capturedBytes -= entry.bytes;
    }
  }
  scheduleHeaderPrune();
}

function capturedHeadersByteLength(headers) {
  let total = 0;
  for (const [key, value] of Object.entries(headers || {})) {
    total += new TextEncoder().encode(`${key}: ${value}`).byteLength;
  }
  return total;
}

function scheduleHeaderPrune() {
  if (headerPruneTimer !== null) clearTimeout(headerPruneTimer);
  headerPruneTimer = null;
  const expiries = [
    ...[...requestHeaders.values()].map((value) => value.at + HEADER_TTL_MS),
    ...[...pendingRequestHeaders.values()].map((value) => value.at + PENDING_HEADER_TTL_MS)
  ];
  if (!expiries.length) return;
  const nextExpiry = Math.min(...expiries);
  headerPruneTimer = setTimeout(() => {
    headerPruneTimer = null;
    pruneHeaders();
  }, Math.max(0, nextExpiry - Date.now() + 50));
  headerPruneTimer?.unref?.();
}

function isPolicyBlocked(url, tabUrl = "") {
  for (const value of [url, tabUrl]) {
    try {
      const host = new URL(value).hostname.toLowerCase();
      if (POLICY_BLOCKED_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))) return true;
    } catch { /* invalid optional tab URL */ }
  }
  return false;
}

function matchesBlockedDomain(value, domains) {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return (domains || []).some((domain) => host === domain || host.endsWith(`.${domain}`));
  } catch {
    return false;
  }
}

async function hasNativePermission() {
  return chrome.permissions.contains({ permissions: ["nativeMessaging"] });
}

function validTabId(value) {
  if (!Number.isInteger(value) || value < 0) throw new Error("标签页编号无效");
  return value;
}

function requireTabCandidate(tabId, reference) {
  const id = cleanText(reference?.id, 64);
  const kind = cleanText(reference?.kind, 16);
  const generation = cleanText(reference?.generation, 64);
  const currentGeneration = tabGenerations.get(tabId);
  if (!id || !kind || !generation || !currentGeneration || generation !== currentGeneration) {
    throw new Error("该媒体候选项已失效，请重新扫描页面");
  }
  const map = tabMedia.get(tabId);
  let item = [...(map?.values() || [])].find((candidate) =>
    candidate.generation === generation && candidate.kind === kind && candidate.id === id
  );
  if (!item) item = [...(map?.values() || [])].find((candidate) =>
    candidate.generation === generation
    && candidate.kind === kind
    && !candidate.mergedInto
    && (candidate.aliases || []).some((alias) => alias.id === id)
  );
  if (!item) throw new Error("该媒体候选项已失效，请重新扫描页面");
  if (item.mergedInto) item = [...(map?.values() || [])].find((candidate) => candidate.id === item.mergedInto);
  if (!item || item.mergedInto) throw new Error("该媒体候选项已失效，请重新扫描页面");
  return item;
}

function isExtensionPage(sender) {
  return sender?.id === chrome.runtime.id && typeof sender.url === "string" && sender.url.startsWith(EXTENSION_ORIGIN);
}

function isContentSender(sender) {
  return sender?.id === chrome.runtime.id && Number.isInteger(sender.tab?.id) && sender.tab.id >= 0 && Boolean(canonicalizeUrl(sender.url));
}

function withoutManifestText(item) {
  if (item?.kind === "dash_pair") {
    const now = Date.now();
    const tracks = [
      ...(Array.isArray(item.videoTracks) ? item.videoTracks : []).filter((track) => isFreshBilibiliTrack(track, now)).map((track) => publicDashPairTrack(track, "video")),
      ...(Array.isArray(item.audioTracks) ? item.audioTracks : []).filter((track) => isFreshBilibiliTrack(track, now)).map((track) => publicDashPairTrack(track, "audio"))
    ];
    const expiresAt = Number(item.expiresAt || 0);
    return candidateForUi(item, {
      tracks,
      videoTrackCount: tracks.filter((track) => track.role === "video").length,
      audioTrackCount: tracks.filter((track) => track.role === "audio").length,
      available: isFreshBilibiliCandidate(item, now),
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null
    });
  }
  return candidateForUi(item);
}

function publicDashPairTrack(track, role) {
  return {
    id: cleanText(track?.trackId, 128),
    role,
    mime: normalizeMime(track?.mime || (role === "video" ? "video/mp4" : "audio/mp4")),
    bytes: positive(track?.contentLength) || 0,
    bandwidth: positive(track?.bandwidth) || 0,
    width: role === "video" ? positive(track?.width) : null,
    height: role === "video" ? positive(track?.height) : null,
    codecs: cleanText(track?.codecs, 120)
  };
}

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function redactJobText(value, max) {
  let text = cleanText(value, Math.max(max * 3, max));
  text = text.replace(/\bhttps?:\/\/[^\s<>'"]+/gi, (match) => {
    try {
      const url = new URL(match.replace(/[),.;]+$/, ""));
      return `${url.origin}/…`;
    } catch {
      return "<链接已隐藏>";
    }
  });
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <已隐藏>")
    .replace(/\b(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|token|signature|sig|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=<已隐藏>")
    .replace(/(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/|\/opt\/|\/usr\/|\/Applications\/|\/Library\/|[A-Za-z]:\\).*/g, "<本地路径已隐藏>");
  return cleanText(text, max);
}

function displayFilename(value) {
  const clean = cleanText(value, 500).replace(/\\/g, "/");
  return cleanText(clean.split("/").pop(), 180) || "media";
}

function nonNegativeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : Number(fallback) || 0;
}

function timestamp(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.min(number, Date.now() + 60_000) : fallback;
}

function positive(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function boundedInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizeDomains(value) {
  const items = Array.isArray(value) ? value : String(value || "").split(/[\s,]+/);
  return [...new Set(items.map((item) => String(item).trim().toLowerCase().replace(/^\.+|\.+$/g, "")).filter((item) => /^(?:[a-z0-9-]+\.)*[a-z0-9-]+$/.test(item)))].slice(0, 500);
}

function renderFilename(candidate, template, pageTitle) {
  let host = "media";
  try { host = new URL(candidate.tabUrl || candidate.url).hostname; } catch { /* ignored */ }
  const values = {
    title: pageTitle || "media",
    host,
    kind: candidate.kind || "media",
    height: candidate.height ? `${candidate.height}p` : "",
    date: new Date().toISOString().slice(0, 10)
  };
  const base = String(template || "{title}").replace(/\{(title|host|kind|height|date)\}/g, (_, key) => values[key]);
  const original = filenameFromCandidate(candidate, base);
  return original;
}
