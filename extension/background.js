import {
  bilibiliDashAssetFamily,
  bilibiliDashTrackId,
  canonicalizeUrl,
  classifyBilibiliDashTrack,
  classifyMedia,
  filenameFromCandidate,
  isBilibiliMediaUrl,
  isBilibiliVideoPage,
  isLikelySubtitleResource,
  normalizeMime,
  sanitizeFilename
} from "./lib/media.js";
import { parseHls, sortHlsVariants } from "./lib/hls.js";
import { parseDash } from "./lib/dash.js";

const HOST_NAME = "io.github.blanchot_alice.fluxcatch";
const EXTENSION_ORIGIN = chrome.runtime.getURL("");
const MAX_ITEMS_PER_TAB = 160;
const HEADER_TTL_MS = 5 * 60 * 1000;
const PENDING_HEADER_TTL_MS = 60 * 1000;
const MAX_PENDING_HEADER_REQUESTS = 1600;
const MAX_CAPTURED_HEADERS_BYTES = 64 * 1024;
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_IDENTITY_KEY_LENGTH = 16_416;
const MANIFEST_INSPECTION_TIMEOUT_MS = 7_000;
const MAX_MANIFEST_CACHE_CHARS_PER_TAB = 4_000_000;
const MAX_MANIFEST_CACHE_CHARS_GLOBAL = 12_000_000;
const MAX_STORED_JOBS = 200;
const MAX_THUMBNAIL_URL_LENGTH = 4096;
const BILIBILI_DISCOVERY_TTL_MS = 45_000;
const BILIBILI_TRACK_TTL_MS = 2 * 60_000;
const BILIBILI_PAIR_WINDOW_MS = 30_000;
const BILIBILI_SAFE_REFERER = "https://www.bilibili.com/";
const DASH_PAIR_SELECTOR_ORIGIN = "https://fluxcatch.invalid";
const SENSITIVE_REQUEST_HEADERS = new Set(["authorization", "cookie", "origin", "referer"]);
const UI_PORT_NAMES = new Set(["fluxcatch-popup", "fluxcatch-sidepanel"]);
const JOB_STATUSES = new Set(["queued", "starting", "downloading", "remuxing", "completed", "failed", "cancelled"]);
const TERMINAL_JOB_STATUSES = new Set(["completed", "failed", "cancelled"]);
const CONTENT_SOURCES = new Set([
  "content", "dom", "loadedmetadata", "durationchange", "mutation",
  "source-element", "metadata"
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
const DEFAULT_SETTINGS = {
  concurrentFragments: 8,
  concurrentRanges: 8,
  outputContainer: "mp4",
  saveAs: false,
  useNativeForDirect: false,
  minimumBytes: 500 * 1024,
  liveDuration: 0,
  blockedDomains: [],
  filenameTemplate: "{title}",
  showNotifications: false
};

const tabMedia = new Map();
const tabPreviews = new Map();
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
const bilibiliObservationChains = new Map();
const bilibiliPruneTimers = new Map();
const bilibiliTabTokens = new Map();
let headerPruneTimer = null;
let nativePort = null;
let nativeConnectPromise = null;
const pendingHostPings = new Map();
let hostStatus = { connected: false, version: null, ffmpeg: false, capabilities: null, needsPermission: true, lastError: null };

// Register listeners synchronously, but make every state consumer wait for the
// MV3 session restore so early webRequest/content events cannot be overwritten.
const sessionReady = restoreSession();

chrome.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    if (details.tabId < 0 || !details.url) return;
    const url = canonicalizeUrl(details.url);
    if (!url) return;
    // Bind a Bilibili request to the tab generation in which it started. A
    // response from the previous History API route must not be classified
    // against the URL that happens to be current when the response arrives.
    const bilibiliGeneration = isBilibiliMediaUrl(url) ? bilibiliTabToken(details.tabId) : null;
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
    if (Object.keys(headers).length || bilibiliGeneration) {
      pendingRequestHeaders.set(details.requestId, { headers, at: Date.now(), tabId: details.tabId, url, bilibiliGeneration });
    }
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
    if (classification?.kind === "segment") {
      queueBilibiliDashObservation(details, {
        mime,
        contentLength,
        rangeSupported: rangeLength > 0 || /bytes/i.test(headers["accept-ranges"] || ""),
        headers: nonSensitiveMediaHeaders(pending?.headers)
      }, pending?.bilibiliGeneration);
    }
    if (classification && classification.kind !== "segment" && pending?.headers && !isPolicyBlocked(details.url)) {
      const finalUrl = canonicalizeUrl(details.url);
      if (finalUrl) {
        const promotedHeaders = sameOrigin(pending.url, finalUrl)
          ? pending.headers
          : Object.fromEntries(Object.entries(pending.headers).filter(([key]) => !SENSITIVE_REQUEST_HEADERS.has(key)));
        requestHeaders.set(headerKey(details.tabId, finalUrl), {
          headers: promotedHeaders,
          at: Date.now(),
          tabId: details.tabId,
          requestId: details.requestId
        });
        scheduleHeaderPrune();
      }
    }
    if (!classification || classification.kind === "segment") return;
    void addCandidate(details.tabId, {
      url: details.url,
      mime,
      contentLength,
      resourceType: details.type,
      rangeSupported: rangeLength > 0 || /bytes/i.test(headers["accept-ranges"] || ""),
      suggestedFilename,
      source: "webRequest",
      ...classification
    });
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
    // The popup is a short-lived progress surface rather than a permanent
    // download-history page. Once its last window closes, discard only jobs
    // that have already ended; active downloads continue in the background.
    if (popupClients.size === 0) void clearTerminalJobsAfterRestore();
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  handleMessage(message, sender)
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((error) => sendResponse({ ok: false, error: error?.message || String(error) }));
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
  }
});

chrome.downloads.onChanged.addListener((delta) => {
  if (!browserDownloads.has(delta.id)) return;
  void updateBrowserDownload(delta);
});

async function handleMessage(message, sender) {
  if (!message || typeof message.type !== "string") throw new Error("消息格式无效");
  await sessionReady;
  const fromContent = isContentSender(sender);
  const fromExtensionPage = isExtensionPage(sender);
  if (CONTENT_MESSAGE_TYPES.has(message.type) ? !fromContent : !fromExtensionPage) {
    throw new Error("消息来源未通过校验");
  }
  switch (message.type) {
    case "CONTENT_MEDIA": {
      const tabId = sender.tab?.id;
      const data = validateContentCandidate(message.data, sender);
      if (!data) return { ignored: true };
      await addCandidate(tabId, data);
      return { accepted: true };
    }
    case "PAGE_PREVIEW": {
      const tabId = sender.tab?.id;
      const preview = validatePagePreview(message.data, sender);
      if (!preview) return { ignored: true };
      await setTabPreview(tabId, preview);
      return { accepted: true };
    }
    case "GET_TAB_MEDIA": {
      const tabId = validTabId(message.tabId);
      await expireBilibiliState(tabId);
      // Public API discovery is opportunistic. Give a fast response time-box,
      // then let the in-flight promise publish through MEDIA_UPDATED instead
      // of making every popup wait on two remote requests.
      await settleWithin(discoverBilibiliDash(tabId), 900);
      const items = [...(tabMedia.get(tabId)?.values() || [])]
        .filter((item) => item.kind !== "segment" && !item.mergedInto)
        .filter((item) => item.kind !== "dash_pair" || isFreshBilibiliCandidate(item))
        .sort((a, b) => candidateScore(b) - candidateScore(a) || b.lastSeen - a.lastSeen)
        .map(withoutManifestText);
      return { items, hostStatus, settings: await getSettings() };
    }
    case "GET_JOBS":
      return { jobs: jobsForUi(), hostStatus };
    case "CLEAR_COMPLETED_JOBS": {
      // Keep the legacy message name for compatibility, but "completed" here
      // means every ended state: saved, failed, or cancelled.
      return clearTerminalJobs();
    }
    case "CLEAR_TAB": {
      const tabId = validTabId(message.tabId);
      dropTabState(tabId);
      await persistSession();
      await updateBadge(tabId);
      const cleared = await clearTerminalJobs();
      return { removedJobs: cleared.removed, jobs: cleared.jobs };
    }
    case "SCAN_TAB": {
      const tabId = validTabId(message.tabId);
      try { await chrome.tabs.sendMessage(tabId, { type: "REQUEST_SCAN" }); } catch { /* restricted page */ }
      await discoverBilibiliDash(tabId, true);
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
      const inspection = await probeManifest(candidate);
      await recordManifestInspection(tabId, candidate, inspection);
      return { probe: probeForUi(inspection) };
    }
    case "DOWNLOAD": {
      const tabId = validTabId(message.tabId);
      return startDownload(requireTabCandidate(tabId, message.candidate), message.options || {}, tabId);
    }
    case "PING_HOST": {
      if (!await hasNativePermission()) {
        hostStatus = { connected: false, version: null, ffmpeg: false, capabilities: null, needsPermission: true, lastError: null };
        return { hostStatus };
      }
      await ensureNativePort();
      return { hostStatus };
    }
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
    case "SAVE_SETTINGS": {
      const settings = normalizeSettings(message.settings);
      await chrome.storage.local.set({ settings });
      return { settings };
    }
    default:
      throw new Error(`Unknown message type: ${message.type}`);
  }
}

async function settleWithin(promise, milliseconds) {
  let timer = null;
  try {
    await Promise.race([
      promise,
      new Promise((resolve) => { timer = setTimeout(resolve, milliseconds); timer?.unref?.(); })
    ]);
  } finally {
    if (timer !== null) clearTimeout(timer);
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

function publicBilibiliPageUrl(tabUrl) {
  const identity = bilibiliVideoIdentity(tabUrl);
  if (!identity) return null;
  const page = new URL(`https://www.bilibili.com/video/${identity.key === "avid" ? `av${identity.value}` : identity.value}/`);
  if (identity.page > 1) page.searchParams.set("p", String(identity.page));
  return page.href;
}

async function discoverBilibiliDash(tabId, force = false) {
  let tab;
  try { tab = await chrome.tabs.get(tabId); } catch { return false; }
  const video = bilibiliVideoIdentity(tab?.url);
  if (!video) return false;
  const tabToken = bilibiliTabToken(tabId);
  const pageKey = `${video.key}:${video.value}:p${video.page}`;
  const now = Date.now();
  const previousDiscovery = bilibiliDiscoveryAt.get(tabId);
  if (!force && previousDiscovery?.pageKey === pageKey && now - previousDiscovery.at < BILIBILI_DISCOVERY_TTL_MS) return true;
  const existingDiscovery = bilibiliDiscoveryInFlight.get(tabId);
  if (existingDiscovery?.pageKey === pageKey) return existingDiscovery.promise;
  const task = (async () => {
    const pageListUrl = new URL("https://api.bilibili.com/x/player/pagelist");
    pageListUrl.searchParams.set(video.key, video.value);
    const pages = await fetchPublicJson(pageListUrl.href);
    if (pages?.code !== 0 || !Array.isArray(pages.data) || !pages.data.length) return false;
    const page = pages.data[Math.min(video.page - 1, pages.data.length - 1)] || pages.data[0];
    const cid = Number(page?.cid);
    if (!Number.isSafeInteger(cid) || cid <= 0) return false;
    const playUrl = new URL("https://api.bilibili.com/x/player/playurl");
    playUrl.searchParams.set(video.key, video.value);
    playUrl.searchParams.set("cid", String(cid));
    playUrl.searchParams.set("qn", "127");
    playUrl.searchParams.set("fnval", "16");
    playUrl.searchParams.set("fourk", "1");
    const play = await fetchPublicJson(playUrl.href);
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

async function fetchPublicJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3_000);
  timer?.unref?.();
  try {
    const response = await fetch(url, {
      method: "GET",
      credentials: "omit",
      cache: "no-store",
      redirect: "follow",
      signal: controller.signal
    });
    if (!response.ok) return null;
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
    source: "bilibili-api"
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
    source: "webRequest"
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
    requestHeaders.set(headerKey(details.tabId, url), { headers: safeHeaders, at: now, tabId: details.tabId, requestId: details.requestId });
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
  const selectedVideo = currentVideo && isFreshBilibiliTrack(currentVideo, now) ? currentVideo : rankedVideos[0];
  const compatibleAudios = audios
    .filter((track) => canPairBilibiliTracks(track, selectedVideo, true))
    .sort((a, b) => bilibiliAudioCompatibilityRank(b) - bilibiliAudioCompatibilityRank(a)
      || Number(b.bandwidth || 0) - Number(a.bandwidth || 0)
      || Number(b.lastSeen || 0) - Number(a.lastSeen || 0));
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
    id: previous?.id || stableId(`bilibili-dash-pair:${tabId}:${state.pageKey}`),
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
  const url = canonicalizeUrl(input.url);
  if (!url) return;
  // Content scripts may already have classified an URL before this worker was
  // upgraded.  Recheck here so caption/text-track manifests never become HLS
  // video rows even when input.kind was supplied by the page.
  if (isLikelySubtitleResource({ url, mime: input.mime })) return;
  if (isPolicyBlocked(url, input.tabUrl)) return;
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
  if (incomingPreview) await setTabPreview(tabId, incomingPreview);
  if (commitGuard && !commitGuard()) return false;

  let map = tabMedia.get(tabId);
  if (!map) tabMedia.set(tabId, (map = new Map()));
  const key = `${kind}:${url}`;
  const old = map.get(key);
  let tab = null;
  if (!old && (!input.pageTitle || !input.tabUrl)) {
    try { tab = await chrome.tabs.get(tabId); } catch { /* tab closed */ }
  }
  const now = Date.now();
  const sources = new Set([...(old?.sources || []), input.source || "unknown"]);
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
    ...(Array.isArray(old?.sourceFilenames) ? old.sourceFilenames : []),
    old?.suggestedFilename,
    input.suggestedFilename
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
    id: cleanText(input.id, 64) || old?.id || stableId(key),
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
    suggestedFilename: naming.suggestedFilename,
    sourceFilenames,
    pageTitle,
    tabUrl: canonicalizeUrl(input.tabUrl) || old?.tabUrl || canonicalizeUrl(tab?.url) || "",
    confidence: Math.max(Number(old?.confidence || 0), Number(input.confidence || classified?.confidence || 0.5)),
    source: input.source || old?.source || "unknown",
    sources: [...sources],
    thumbnailUrl: preview?.thumbnailUrl || null,
    thumbnailSource: preview?.thumbnailSource || null,
    thumbnailFrameId: preview?.thumbnailFrameId ?? null,
    thumbnailAt: preview?.thumbnailAt || null,
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
  await persistSession();
  if (commitGuard && !commitGuard()) return false;
  await updateBadge(tabId);
  if (commitGuard && !commitGuard()) return false;
  broadcast({ type: "MEDIA_UPDATED", tabId, item: withoutManifestText(candidate) });
  if (kind === "hls") scheduleTabManifestInspections(tabId, key, Boolean(input.manifestText));
  return true;
}

function validateContentCandidate(data, sender) {
  if (!data || typeof data !== "object") return null;
  const url = canonicalizeUrl(data.url);
  if (!url) return null;
  const tab = sender.tab;
  const manifestText = typeof data.manifestText === "string" && data.manifestText.length <= 1_500_000 ? data.manifestText : null;
  const source = cleanText(data.source, 40);
  const preview = cleanText(data.thumbnailSource, 40) === "poster"
    ? createPreview(data.thumbnailUrl, "poster", sender.frameId, Date.now())
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
    manifestText,
    ...(preview || {})
  };
}

function validatePagePreview(data, sender) {
  if (!data || typeof data !== "object") return null;
  const source = cleanText(data.source, 40);
  if (!PAGE_PREVIEW_PRIORITIES.has(source)) return null;
  return createPreview(data.thumbnailUrl, source, sender.frameId, Date.now());
}

function normalizeThumbnailUrl(value) {
  try {
    if (typeof value !== "string" || !value.trim() || value.length > MAX_THUMBNAIL_URL_LENGTH) return null;
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return null;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.href.length <= MAX_THUMBNAIL_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

function createPreview(value, source, frameId, at) {
  const thumbnailUrl = normalizeThumbnailUrl(value);
  if (!thumbnailUrl || !PAGE_PREVIEW_PRIORITIES.has(source)) return null;
  return {
    thumbnailUrl,
    thumbnailSource: source,
    thumbnailFrameId: Number.isInteger(frameId) && frameId >= 0 ? frameId : 0,
    thumbnailAt: Number.isFinite(Number(at)) && Number(at) > 0 ? Math.min(Number(at), Date.now() + 60_000) : Date.now()
  };
}

function previewFromCandidate(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  return createPreview(
    candidate.thumbnailUrl,
    cleanText(candidate.thumbnailSource, 40),
    candidate.thumbnailFrameId,
    candidate.thumbnailAt
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

async function setTabPreview(tabId, preview) {
  if (!Number.isInteger(tabId) || tabId < 0 || !preview) return;
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
    changed.push(candidate);
  }
  if (!changed.length && !previewChanged) return;
  await persistSession();
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
    pageTitle,
    previousTitle,
    ...suggestedFilenames,
    urlName
  ].map(readableTitle).find(Boolean) || "媒体";
  const outputExt = ["hls", "dash", "dash_pair"].includes(kind) ? "mp4" : ext || (kind === "audio" ? "m4a" : "mp4");
  return {
    title,
    suggestedFilename: `${sanitizeFilename(title)}.${outputExt}`
  };
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
  try {
    const parsed = new URL(url);
    const queryless = `${parsed.origin}${parsed.pathname}`;
    return uniqueCleanTexts([
      `url:${url}`,
      `origin-path:${queryless}`,
      strongDeliveryPathIdentity(parsed.pathname)
    ], MAX_MANIFEST_IDENTITY_KEY_LENGTH, 3);
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
    if (candidate.manifestFingerprint) {
      const previous = byFingerprint.get(candidate.manifestFingerprint);
      if (previous !== undefined) union(index, previous);
      else byFingerprint.set(candidate.manifestFingerprint, index);
    }
  }
  for (const [index, candidate] of candidates.entries()) {
    for (const reference of normalizeUrlList(candidate.manifestReferences)) {
      for (const identity of manifestIdentityKeys(reference)) {
        for (const target of byIdentity.get(identity) || []) union(index, target);
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
  const entries = [...(tabMedia.get(tabId)?.entries() || [])].filter(([, candidate]) => candidate.kind === "hls");
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
    const inspection = await probeManifest(candidate, {
      credentials: "omit",
      timeoutMs: MANIFEST_INSPECTION_TIMEOUT_MS
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
    const controller = Number(options.timeoutMs) > 0 ? new AbortController() : null;
    const timeout = controller ? setTimeout(() => controller.abort(), Number(options.timeoutMs)) : null;
    try {
      const response = await fetch(url, {
        credentials: options.credentials === "omit" ? "omit" : "include",
        cache: "no-store",
        redirect: "follow",
        ...(controller ? { signal: controller.signal } : {})
      });
      if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
      const length = Number(response.headers.get("content-length") || 0);
      if (length > MAX_MANIFEST_BYTES) throw new Error("媒体清单超出大小限制");
      manifestUrl = canonicalizeUrl(response.url) || url;
      text = await readResponseTextLimited(response, MAX_MANIFEST_BYTES);
    } finally {
      if (timeout !== null) clearTimeout(timeout);
    }
  }
  if (text.length > MAX_MANIFEST_BYTES) throw new Error("媒体清单超出大小限制");
  const manifestByteLength = new TextEncoder().encode(text).byteLength;
  if (candidate.kind === "dash" || /<MPD\b/i.test(text)) return { kind: "dash", manifestUrl, manifestByteLength, ...parseDash(text, manifestUrl) };
  const hls = parseHls(text, manifestUrl);
  return { kind: "hls", manifestUrl, manifestByteLength, ...hls, variants: sortHlsVariants(hls.variants) };
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

function probeForUi(probe) {
  if (probe.kind === "hls") {
    const variants = (probe.variants || []).slice(0, 200).map((item) => ({
      url: canonicalizeUrl(item.url),
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
      url: canonicalizeUrl(item.url)
    }))
  };
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
  if (isPolicyBlocked(url, candidate?.tabUrl)) throw new Error("商店版本不支持从此平台下载");
  const settings = await getSettings();
  if (matchesBlockedDomain(url, settings.blockedDomains) || matchesBlockedDomain(candidate?.tabUrl, settings.blockedDomains)) {
    throw new Error("该域名已在 FluxCatch 设置中被忽略");
  }
  const opts = normalizeDownloadOptions(options, settings);
  if (candidate.kind === "hls" || candidate.kind === "dash") {
    try {
      const inspection = await probeManifest(candidate);
      if (inspection.protection === "drm" || inspection.protected) throw new Error("检测到 DRM 内容保护，仅显示媒体信息");
    } catch (error) {
      if (/DRM|内容保护/i.test(error?.message || "")) throw error;
      // An authenticated manifest may be unavailable to extension fetch. The
      // native host can still use the request headers observed for this tab.
    }
  }
  const pageTitle = candidate.pageTitle || candidate.title || "media";
  const requestedName = cleanText(options.filename, 200) || renderFilename(candidate, settings.filenameTemplate, pageTitle);
  const filename = sanitizeFilename(requestedName);
  const advanced = candidate.kind === "hls" || candidate.kind === "dash" || candidate.kind === "dash_pair" || opts.extractAudio || opts.convert || opts.useNativeForDirect;

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
  if (dashPair) {
    // Permission prompts and native-host startup are asynchronous. Resolve the
    // candidate again at the final dispatch boundary so navigation, a newer
    // signature, or TTL expiry cannot leave a stale pair queued in the host.
    candidate = requireTabCandidate(tabId, candidate);
    dashPair = selectDashPairTracks(candidate, options.variantUrl);
    url = dashPair.video.url;
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
        variantUrl: dashPair ? null : canonicalizeUrl(options.variantUrl) || null,
        audioUrl: dashPair?.audio.url || null,
        audioHeaders,
        expiresAt: dashPair?.expiresAt || null,
        expectedDuration: dashPair ? positive(candidate.duration) || 0 : 0
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
    throw error;
  }
  return { method: "native", jobId };
}

async function ensureNativePort() {
  if (nativePort && hostStatus.connected) return nativePort;
  if (nativeConnectPromise) return nativeConnectPromise;
  nativeConnectPromise = openNativePort();
  try {
    return await nativeConnectPromise;
  } finally {
    nativeConnectPromise = null;
  }
}

async function openNativePort() {
  if (!await hasNativePermission()) throw new Error("尚未授权连接本地引擎");
  let port;
  try {
    port = chrome.runtime.connectNative(HOST_NAME);
  } catch (error) {
    hostStatus = { connected: false, version: null, ffmpeg: false, capabilities: null, needsPermission: false, lastError: error.message };
    throw new Error(`本地引擎尚未安装或未注册：${error.message}`);
  }
  nativePort = port;
  port.onMessage.addListener((message) => {
    if (message?.type === "pong") {
      hostStatus = {
        connected: true,
        version: message.version || null,
        ffmpeg: Boolean(message.ffmpeg),
        capabilities: message.capabilities && typeof message.capabilities === "object" ? message.capabilities : null,
        needsPermission: false,
        lastError: null
      };
      resolveHostPing(port, message.requestId);
    }
    void handleNativeHostMessage(message);
  });
  port.onDisconnect.addListener(() => {
    const error = chrome.runtime.lastError?.message || "本地引擎连接已断开";
    rejectHostPings(port, new Error(error));
    if (nativePort !== port) return;
    nativePort = null;
    hostStatus = { connected: false, version: null, ffmpeg: false, capabilities: null, needsPermission: false, lastError: error };
    void handleNativeDisconnect(error);
  });
  try {
    await pingNativePort(port);
    return port;
  } catch (error) {
    if (nativePort === port) {
      nativePort = null;
      hostStatus = { connected: false, version: null, ffmpeg: false, capabilities: null, needsPermission: false, lastError: error.message };
    }
    try { port.disconnect?.(); } catch { /* The failed port may already be closed. */ }
    throw error;
  }
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
  if (jobId) {
    const status = nativeJobStatus(message);
    if (status) {
      await mergeJob(jobId, {
        method: "native",
        filename: cleanText(message.filename, 180) || undefined,
        status,
        progress: message.progress,
        speed: message.speed,
        bytes: message.bytes ?? message.size,
        total: message.total ?? message.size,
        message: cleanText(message.message, 240) || undefined,
        error: cleanText(message.error, 240) || undefined
      });
      if (TERMINAL_JOB_STATUSES.has(status)) cleanupJobHeaders(jobId);
    }
  }
  broadcast({ type: "HOST_EVENT", event: message, hostStatus });
  await maybeNotifyHostEvent(message);
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
  broadcast({ type: "HOST_EVENT", event: { type: "host-disconnected", error }, hostStatus });
  for (const job of updates) broadcast({ type: "JOB_UPDATED", job: jobForUi(job) });
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
  if (TERMINAL_JOB_STATUSES.has(merged.status)) {
    browserDownloads.delete(delta.id);
    browserCancellationRequested.delete(delta.id);
  }
}

async function mergeJob(jobId, patch) {
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
  await persistJobs();
  broadcast({ type: "JOB_UPDATED", job: jobForUi(job) });
  return job;
}

function nativeJobStatus(message) {
  const direct = cleanText(message?.status, 32).toLowerCase();
  if (JOB_STATUSES.has(direct)) return direct;
  return ({ complete: "completed", failed: "failed", cancelled: "cancelled" })[message?.type] || null;
}

async function maybeNotifyHostEvent(message) {
  const status = message?.status;
  if (!message?.jobId || !["completed", "failed"].includes(status)) return;
  const settings = await getSettings();
  if (!settings.showNotifications) return;
  const filename = cleanText(message.filename, 180) || "media";
  const detail = status === "completed"
    ? `${filename} 已保存`
    : redactJobText(message.message || message.error, 240) || `${filename} 下载失败`;
  try {
    await chrome.notifications.create(`fluxcatch:${message.jobId}:${status}`, {
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
    await chrome.action.setBadgeBackgroundColor({ tabId, color: count ? "#466F66" : "#66716D" });
    await chrome.action.setTitle({ tabId, title: count ? `FluxCatch — 检测到 ${count} 个媒体` : "FluxCatch — 暂未检测到媒体" });
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
        if (!url || isLikelySubtitleResource({ url, mime: item?.mime }) || !["video", "audio", "hls", "dash", "segment"].includes(item?.kind)) continue;
        const preview = previewFromCandidate(item);
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
          ...item,
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
          thumbnailUrl: preview?.thumbnailUrl || null,
          thumbnailSource: preview?.thumbnailSource || null,
          thumbnailFrameId: preview?.thumbnailFrameId ?? null,
          thumbnailAt: preview?.thumbnailAt || null,
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
      const preview = previewFromCandidate(item);
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
  // are intentionally volatile and are rediscovered after worker restart.
  for (const [tabId, map] of tabMedia) {
    data[tabId] = [...map.values()]
      .filter((item) => item.kind !== "dash_pair")
      .map(withoutManifestText);
  }
  const previews = {};
  for (const [tabId, preview] of tabPreviews) previews[tabId] = { ...preview };
  // Timers may be discarded when an MV3 worker is suspended. Queue the actual
  // storage operation and return it so message handlers stay alive until done.
  persistChain = persistChain
    .catch(() => {})
    .then(() => chrome.storage.session.set({ tabMedia: data, tabPreviews: previews }))
    .catch(() => {});
  return persistChain;
}

function persistJobs() {
  const storedJobs = [...jobs.values()]
    .sort((a, b) => a.createdAt - b.createdAt || a.jobId.localeCompare(b.jobId))
    .map(jobForUi);
  persistChain = persistChain
    .catch(() => {})
    .then(() => chrome.storage.session.set({ jobs: storedJobs }))
    .catch(() => {});
  return persistChain;
}

function jobsForUi() {
  return [...jobs.values()]
    .sort((a, b) => b.updatedAt - a.updatedAt || b.createdAt - a.createdAt)
    .map(jobForUi);
}

async function clearTerminalJobsAfterRestore() {
  await sessionReady;
  return clearTerminalJobs();
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
    kind: ["video", "audio", "hls", "dash", "dash_pair"].includes(value.kind) ? value.kind : "",
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
  if (jobs.size <= MAX_STORED_JOBS) return;
  const oldest = [...jobs.values()].sort((a, b) => a.updatedAt - b.updatedAt || a.createdAt - b.createdAt);
  while (jobs.size > MAX_STORED_JOBS && oldest.length) jobs.delete(oldest.shift().jobId);
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
  return normalizeSettings(data.settings || {});
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
    liveDuration: boundedInt(value.liveDuration, 0, 24 * 3600, DEFAULT_SETTINGS.liveDuration),
    blockedDomains: normalizeDomains(value.blockedDomains),
    filenameTemplate: cleanText(value.filenameTemplate, 160) || DEFAULT_SETTINGS.filenameTemplate,
    showNotifications: Boolean(value.showNotifications)
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
    liveDuration: boundedInt(value.liveDuration, 0, 24 * 3600, fallback.liveDuration || 0)
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
  const kind = ["hls", "dash", "dash_pair"].includes(item.kind) ? 300 : item.kind === "video" ? 200 : item.kind === "audio" ? 100 : 0;
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

function stableId(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
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
  tabMedia.delete(tabId);
  tabPreviews.delete(tabId);
  bilibiliDashStates.delete(tabId);
  bilibiliDiscoveryAt.delete(tabId);
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
  scheduleHeaderPrune();
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
  const url = canonicalizeUrl(reference?.url);
  const id = cleanText(reference?.id, 64);
  const kind = cleanText(reference?.kind, 16);
  if (!url || !id || !kind) throw new Error("媒体候选项无效");
  const map = tabMedia.get(tabId);
  let item = map?.get(`${kind}:${url}`);
  if (!item || item.id !== id) {
    item = [...(map?.values() || [])].find((candidate) =>
      candidate.kind === kind
      && !candidate.mergedInto
      && (candidate.aliases || []).some((alias) => alias.id === id && alias.url === url)
    );
  }
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
  const {
    manifestText,
    pairedAudioUrl,
    videoTracks,
    audioTracks,
    selectedVideoTrackId,
    selectedAudioTrackId,
    ...safe
  } = item;
  if (item?.kind === "dash_pair") {
    const now = Date.now();
    const tracks = [
      ...(Array.isArray(videoTracks) ? videoTracks : []).filter((track) => isFreshBilibiliTrack(track, now)).map((track) => publicDashPairTrack(track, "video")),
      ...(Array.isArray(audioTracks) ? audioTracks : []).filter((track) => isFreshBilibiliTrack(track, now)).map((track) => publicDashPairTrack(track, "audio"))
    ];
    const expiresAt = Number(item.expiresAt || 0);
    return {
      ...safe,
      tracks,
      videoTrackCount: tracks.filter((track) => track.role === "video").length,
      audioTrackCount: tracks.filter((track) => track.role === "audio").length,
      available: isFreshBilibiliCandidate(item, now),
      expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null
    };
  }
  return safe;
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
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\)[^\s]+/g, "<本地路径已隐藏>");
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
