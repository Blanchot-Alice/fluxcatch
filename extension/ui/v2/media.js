// FluxCatch v2: what the toolbar popup and the side-panel workspace share
// (design review P2: one skeleton, the same components). Detected media rows,
// the per-item download dialog (§6.12), the local-engine status line (§7: one
// line with "Set up", never an explanation), the downloads list built from
// rows.js, and the pure media helpers both pages need. Copy comes from
// messages/media.js; formats follow locale.js; errors go through errors.js.
// Surface state (tab, items, settings) stays in each page.
import { msg } from "./messages.js";
import { formatBytes, formatDuration, formatRelativeTime, uiLocale } from "./locale.js";
import { button, iconButton, runAction, setStatusLine } from "./components.js";
import { controlOf, dialogShell, fieldStack, select, setOptions, textField } from "./controls.js";
import { downloadRow, historyRow, liveRow, mediaKindOf, rowLead, updateLiveRow } from "./rows.js";
import { errorText, userError } from "./errors.js";
import { callWorker } from "./runtime.js";
import { compareJobs, isTerminalStatus, recordSpeedSample, runFileAction } from "./jobs.js";
import { MEDIA_EXTENSIONS, sanitizeFilename } from "../../lib/media.js";
import { BUILD_PROFILE } from "../../lib/build-profile.js";

// ======================================================================
// Pure media helpers (no DOM)
// ======================================================================

const STREAM_KINDS = new Set(["hls", "dash", "dash_pair"]);
const CONTAINERS = ["mp4", "mkv", "webm"];
const FORMAT_NAMES = { mp4: "MP4", m4v: "MP4", m4a: "M4A", mp3: "MP3", webm: "WebM", mkv: "MKV", mov: "MOV", aac: "AAC", flac: "FLAC", wav: "WAV", ogg: "OGG", oga: "OGG", opus: "Opus", ts: "TS", m2ts: "TS", avi: "AVI", flv: "FLV" };
const MIME_EXTENSIONS = {
  "audio/mp4": "m4a",
  "audio/mpeg": "mp3",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/opus": "opus",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/flac": "flac",
  "audio/webm": "webm",
  "video/mp4": "mp4",
  "video/webm": "webm",
  "video/quicktime": "mov",
  "video/x-matroska": "mkv"
};

const positive = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
};

export function isStreamKind(value) {
  const kind = typeof value === "string" ? value : value?.kind;
  return STREAM_KINDS.has(kind);
}

/** A strictly matched Instagram CDN MP4 that Chrome may save without the engine. */
export function isTrustedInstagramBrowserItem(item) {
  if (item?.site !== "instagram"
      || item?.kind !== "video"
      || !["site_payload", "dom_metadata", "observed_response"].includes(item?.provenance)) return false;
  try {
    const url = new URL(item.displayUrl);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && (hostname === "cdninstagram.com" || hostname.endsWith(".cdninstagram.com") || hostname === "fbcdn.net" || hostname.endsWith(".fbcdn.net"))
      && /\.mp4$/i.test(url.pathname);
  } catch {
    return false;
  }
}

/** A strictly matched X video (video.twimg.com) that Chrome may save without the engine. */
export function isTrustedXBrowserItem(item) {
  if (item?.site !== "twitter" || item?.kind !== "video" || !["site_payload", "observed_response"].includes(item?.provenance)) return false;
  const hinted = item.provenance === "observed_response"
    || item.source === "x-api-response"
    || item.source === "site-payload"
    || item.sources?.includes("x-api-response")
    || item.sources?.includes("site-payload");
  if (!hinted) return false;
  try {
    const url = new URL(item.displayUrl);
    return url.protocol === "https:" && url.hostname.toLowerCase() === "video.twimg.com";
  } catch {
    return false;
  }
}

/** True when this download goes through the local engine (everything except
 *  the trusted Instagram and X files kept in their original format). */
export function downloadNeedsNative(item, options = {}) {
  const trustedBrowserDirect = isTrustedInstagramBrowserItem(item) || isTrustedXBrowserItem(item);
  return isStreamKind(item)
    || !trustedBrowserDirect
    || Boolean(options?.extractAudio)
    || Boolean(options?.convert)
    || Boolean(options?.useNativeForDirect);
}

/** Candidates the surfaces list: no stream parts, no external-tool items in a stable build. */
export function isOfferedCandidate(item) {
  if (!item || item.kind === "segment") return false;
  return item.kind !== "youtube" || Boolean(BUILD_PROFILE.features.externalToolNetwork);
}

export function mediaKey(item) {
  return String(item?.id || item?.displayUrl || "");
}

export function candidateReference(item) {
  return { id: item?.id, kind: item?.kind, generation: item?.generation };
}

/** The last path segment of a URL; "" when there is none. */
function fileLabel(url) {
  try { return decodeURIComponent(new URL(url).pathname.split("/").pop()) || ""; } catch { return ""; }
}

/** The item's own name (title, filename or URL segment); "" when it has none. */
function ownTitle(item) {
  for (const value of [item?.displayTitle, item?.title, item?.suggestedFilename, item?.pageTitle]) {
    const title = String(value || "").trim();
    if (title) return title;
  }
  return fileLabel(item?.displayUrl);
}

/** The name a row shows: the item's own name, or "Untitled media" in the UI language. */
export function readableMediaTitle(item) {
  return ownTitle(item) || msg("media.untitled");
}

/** A record's display name: its filename, or "Untitled media" in the UI language. */
export function displayFilename(record) {
  return String(record?.filename || "").trim() || msg("media.untitled");
}

/** The host of a URL without "www."; "" when it cannot be read. */
export function urlHost(url) {
  try { return new URL(url).hostname.replace(/^www\./i, ""); } catch { return ""; }
}

/** The source file's extension ("mp4", "m4a" …), from the item's fields, URL or MIME; "" when unknown. */
export function originalExtension(item) {
  const values = [item?.ext, item?.suggestedFilename, item?.displayTitle, item?.title];
  try { values.push(new URL(item?.displayUrl || "").pathname.split("/").pop()); } catch { /* Ignore invalid URLs. */ }
  for (const value of values) {
    const text = String(value || "").trim().toLowerCase();
    const explicit = text.replace(/^\./, "");
    if (/^[a-z0-9]{1,8}$/.test(explicit) && MEDIA_EXTENSIONS.has(explicit)) return explicit;
    const match = text.match(/\.([a-z0-9]{1,8})(?:$|[?#])/i);
    if (match && MEDIA_EXTENSIONS.has(match[1].toLowerCase())) return match[1].toLowerCase();
  }
  return MIME_EXTENSIONS[String(item?.mime || "").split(";", 1)[0].trim().toLowerCase()] || "";
}

/** "MP4", "M4A" … for an extension; "" when unknown. Format names read the same in both languages. */
export function formatLabel(extension) {
  return FORMAT_NAMES[String(extension || "").toLowerCase()] || "";
}

export function defaultFilename(item, format) {
  // A written filename, never UI copy: a nameless item is saved as "media".
  const title = ownTitle(item) || "media";
  const match = title.match(/\.([a-z0-9]{1,8})$/i);
  const base = match && MEDIA_EXTENSIONS.has(match[1].toLowerCase()) ? title.slice(0, -match[0].length) : title;
  if (format === "original") {
    const extension = originalExtension(item);
    return extension ? `${sanitizeFilename(base)}.${extension}` : sanitizeFilename(base);
  }
  return `${sanitizeFilename(base)}.${format}`;
}

export function replaceFilenameExtension(filename, format, item) {
  const source = String(filename || "media").trim() || "media";
  if (format === "original") {
    const extension = originalExtension(item);
    return extension ? `${source.replace(/\.[a-z0-9]{1,8}$/i, "")}.${extension}` : source;
  }
  return `${source.replace(/\.[a-z0-9]{1,8}$/i, "")}.${format}`;
}

/** The one meta line of a detected item (§6.14): "Stream · 1080p · 58:00",
 *  "MP4 · 812 MB", "M4A · 48.3 MB"; the recommended item carries "Best" as plain text. */
export function mediaMeta(item) {
  const parts = [];
  const stream = isStreamKind(item);
  if (item?.kind === "youtube") parts.push("YouTube");
  else if (stream) parts.push(msg("media.kind.stream"));
  else parts.push(formatLabel(originalExtension(item)));
  const grouped = Array.isArray(item?.variants) && item.variants.length > 0;
  const audioOnly = item?.trackHints && item.trackHints.video === false && item.trackHints.audio === true && !grouped;
  if (audioOnly) parts.push(msg("media.kind.audioOnly"));
  else if (positive(item?.height)) parts.push(`${Math.round(item.height)}p`);
  if (!stream && positive(item?.contentLength)) parts.push(formatBytes(item.contentLength));
  if (positive(item?.duration)) parts.push(formatDuration(item.duration));
  if (item?.recommended) parts.push(msg("media.best"));
  return parts.filter(Boolean).join(" · ");
}

/** The popup's type filter: all | video | audio | stream. */
export function filterItems(items, filter = "all") {
  return (items || []).filter((item) => {
    if (filter === "all") return true;
    if (filter === "stream") return isStreamKind(item);
    return item.kind === filter;
  });
}

/** The same filter for download jobs, by the kind their row's glyph shows
 *  (rows.js mediaKindOf: the job's kind, or an audio file name). */
function jobMatchesFilter(job, filter = "all") {
  return filter === "all" || mediaKindOf(job) === filter;
}

/** A pasted link as a stand-in item, until the worker registers the real candidate. */
export function urlItem(rawUrl) {
  const text = String(rawUrl || "").trim();
  let kind = "video";
  let title = "";
  try {
    const parsed = new URL(text);
    const extension = (parsed.pathname.match(/\.([a-z0-9]{1,8})$/i)?.[1] || "").toLowerCase();
    if (extension === "m3u8" || extension === "m3u") kind = "hls";
    else if (extension === "mpd") kind = "dash";
    else if (["mp3", "m4a", "aac", "flac", "wav", "ogg", "opus"].includes(extension)) kind = "audio";
    title = decodeURIComponent(parsed.pathname.split("/").filter(Boolean).pop() || parsed.hostname);
  } catch {
    title = "";
  }
  return { id: "url", kind, displayUrl: text, displayTitle: title, urlMode: true, copyable: false };
}

/** Why a probed stream cannot be saved: "drm" | "live" | "discontinuous" | "". */
export function manifestBlock(probe) {
  if (probe?.kind === "hls") {
    if (probe.protection === "drm" || probe.protected) return "drm";
    if (probe.type === "media" && probe.live) return "live";
    if (probe.discontinuity) return "discontinuous";
  }
  if (probe?.protection === "drm" || probe?.protected) return "drm";
  return "";
}

/** False when the engine is connected but cannot make MP3 (or needs an update). */
export function mp3Available(host = {}) {
  const ffmpeg = host?.capabilities?.ffmpeg;
  const mismatch = host?.connected === true && host.compatible !== true;
  const unavailable = host?.connected === true && host.compatible === true
    && (ffmpeg?.available === false || ffmpeg?.encoders?.libmp3lame === false);
  return !(mismatch || unavailable);
}

/** Format options for an item: original (never for streams), MP4, MKV and WebM
 *  (not for split picture-and-sound pairs), MP3 when the engine can make it. */
export function formatOptions(item, host = {}) {
  const stream = isStreamKind(item);
  const paired = item?.kind === "dash_pair";
  const mp3 = mp3Available(host);
  return [
    { value: "original", label: msg("media.format.original"), disabled: stream },
    { value: "mp4", label: "MP4" },
    { value: "mkv", label: "MKV", disabled: paired },
    { value: "webm", label: "WebM", disabled: paired },
    { value: "mp3", label: `MP3 · ${msg(mp3 ? "media.format.audioOnly" : "media.format.unavailable")}`, disabled: !mp3 }
  ];
}

/** The format a dialog opens with: original for files, the preferred container for streams. */
export function defaultFormat(item, settings = {}) {
  if (!isStreamKind(item)) return "original";
  const preferred = CONTAINERS.includes(settings?.outputContainer) ? settings.outputContainer : "mp4";
  return item.kind === "dash_pair" && preferred !== "mp4" ? "mp4" : preferred;
}

function bitrate(bandwidth) {
  const value = positive(bandwidth);
  if (!value) return "";
  const mbps = value / 1e6;
  const unit = mbps >= 1 ? "megabit-per-second" : "kilobit-per-second";
  const amount = mbps >= 1 ? mbps : value / 1e3;
  return new Intl.NumberFormat(uiLocale(), { style: "unit", unit, unitDisplay: "short", maximumFractionDigits: amount >= 10 ? 0 : 1 }).format(amount);
}

/** "1080p · 4.2 Mb/s", or the bitrate alone, or "Quality 2" (never the worker's own name text). */
export function variantLabel(variant, index = 0) {
  const height = Math.round(positive(variant?.height));
  const rate = bitrate(variant?.bandwidth);
  if (height) return [`${height}p`, rate].filter(Boolean).join(" · ");
  return rate || msg("media.quality.rank", { count: index + 1 });
}

/** The options a download is sent with (message shape unchanged from v1). */
export function downloadOptions(item, { filename, format, variantUrl = null, settings = {} }) {
  const sourceExtension = originalExtension(item);
  return {
    filename,
    outputContainer: format,
    outputFormat: format,
    extractAudio: format === "mp3",
    useNativeForDirect: Boolean(settings?.useNativeForDirect),
    convert: format !== "original" && (format === "mp3" || !sourceExtension || sourceExtension !== format),
    variantUrl: variantUrl || null
  };
}

// ======================================================================
// The local engine: one status line, never an explanation (§7)
// ======================================================================

const HOST_FAILURES = new Set(["api_unavailable", "host_missing", "connection_failed"]);
const PERMISSION_TEXT = /\u5c1a\u672a\u6388\u6743|\u672a\u83b7\u6388\u6743|nativeMessaging.*(?:permission|\u6743\u9650)|\u8bf7\u5148\u5141\u8bb8\u4f7f\u7528(?:\u672c\u5730\u4e0b\u8f7d\u5f15\u64ce|\u9ad8\u901f\u4e0b\u8f7d\u529f\u80fd)/i;

/** Classify raw connection text (Chrome or worker) into a failure reason; the text itself is never shown. */
export function hostReasonFromText(text) {
  const raw = String(text || "");
  if (/connectNative(?:\s+is not a function)?|chrome\.runtime\.connectNative|\u5c1a\u672a\u52a0\u8f7d\u8fde\u63a5\u63a5\u53e3|\u8fde\u63a5\u63a5\u53e3.*(?:\u5f85\u6062\u590d|\u5c1a\u672a\u5c31\u7eea)/i.test(raw)) return "api_unavailable";
  if (/specified native messaging host not found|native messaging host.*not found|\u672a\u5b89\u88c5\u6216\u672a\u6ce8\u518c/i.test(raw)) return "host_missing";
  return "connection_failed";
}

/** A host status for a failed ping or connection. */
export function hostStatusFromError(error) {
  const raw = String(error?.message || error || "");
  if (PERMISSION_TEXT.test(raw)) return { connected: false, needsPermission: true, failureReason: null, lastError: null };
  return { connected: false, needsPermission: false, failureReason: hostReasonFromText(raw), lastError: null };
}

/** Normalise a worker host status: a permission state carries no failure;
 *  a legacy raw lastError becomes a failure reason and is dropped. */
export function normalizeHostStatus(status = {}) {
  status = status && typeof status === "object" ? status : {};
  if (status.needsPermission) return { ...status, failureReason: null, lastError: null };
  if (status.connected || HOST_FAILURES.has(status.failureReason)) return status;
  if (!status.lastError) return status;
  return { ...status, failureReason: hostReasonFromText(status.lastError), lastError: null };
}

/**
 * What is wrong with the engine, if anything:
 * "permission" | "finishing" | "restart" | "recover" | "missing" | "noResponse" | "update" | "noConvert" | null.
 * permission: false when chrome.permissions says nativeMessaging is not granted.
 */
export function engineIssue(status, { permission = null } = {}) {
  const host = normalizeHostStatus(status);
  if (permission === false || host.needsPermission) return "permission";
  if (host.connected) {
    if (host.compatible !== true) return "update";
    const ffmpeg = host.capabilities?.ffmpeg;
    const tools = ffmpeg ? Boolean(ffmpeg.available) : host.ffmpeg !== false;
    return tools ? null : "noConvert";
  }
  switch (host.failureReason) {
    case "api_unavailable":
      if (host.selfHealing) return "finishing";
      return host.recoveryBlocked || host.restartRequired ? "restart" : "recover";
    case "host_missing": return "missing";
    case "connection_failed": return "noResponse";
    default: return null;
  }
}

const ISSUE_TEXT = {
  permission: "status.engineNotSetUp",
  finishing: "media.engine.finishing",
  restart: "media.engine.restart",
  recover: "media.engine.recover",
  missing: "media.engine.missing",
  noResponse: "media.engine.noResponse",
  update: "media.engine.update",
  noConvert: "media.engine.noConvert"
};

export function engineIssueText(issue) {
  return issue ? msg(ISSUE_TEXT[issue]) : "";
}

/** Issues a fresh check can clear (v1's Recheck): everything except the
 *  permission, which Set up asks for, and the setup Chrome is still finishing. */
const RECHECKABLE = new Set(["restart", "recover", "missing", "noResponse", "update", "noConvert"]);
const FAILED_ISSUES = new Set(["missing", "noResponse"]);

/** The status-line spec for an engine issue: { tone, text, actions } ("" text clears the line). */
export function engineLine(issue, { setUp, retry } = {}) {
  if (!issue) return { tone: "", text: "", actions: [] };
  const actions = [];
  if (RECHECKABLE.has(issue) && retry) actions.push({ label: msg("action.retry"), run: retry });
  if (issue !== "finishing" && setUp) actions.push({ label: msg("action.setUp"), run: setUp });
  // The same tones as Settings' engine row: not set up is harbour, an engine
  // that is missing or does not answer has failed, the rest are warnings.
  const tone = issue === "permission" ? "" : issue === "finishing" ? "progress" : FAILED_ISSUES.has(issue) ? "failed" : "warning";
  return { tone, text: engineIssueText(issue), actions };
}

/** The error to show when a download needs the engine and it is not ready. */
export function engineError(status) {
  const issue = engineIssue(status);
  if (!issue || issue === "permission" || issue === "noConvert") return userError(msg("toast.engineNeeded"));
  return userError(engineIssueText(issue));
}

/** Throw a user-facing error unless the engine is connected and compatible. */
export function requireEngineReady(status) {
  const host = normalizeHostStatus(status);
  if (!host.connected || host.needsPermission) throw engineError(host);
  if (host.compatible !== true) throw userError(msg("media.engine.update"));
  return host;
}

/** Retry on an engine line: ping, keep the fresh status, then say "ready" or
 *  throw the issue that remains (as a user error, never raw text). */
export async function recheckEngine({ call = callWorker, onHost, permission = null } = {}) {
  const host = await pingEngine(call);
  onHost?.(host);
  const issue = engineIssue(host, { permission });
  if (issue) throw userError(engineIssueText(issue));
  return host;
}

/** PING_HOST: the worker's fresh host status, or a failure status (never throws). */
export async function pingEngine(call = callWorker) {
  try {
    const result = await call({ type: "PING_HOST" });
    return normalizeHostStatus(result?.hostStatus || {});
  } catch (error) {
    return hostStatusFromError(error);
  }
}

/** Where every "Set up" goes (Settings also accepts the legacy #localCapabilities). */
export const ENGINE_SETUP_PATH = "options/options.html#local-engine";

export async function openEngineSetup() {
  try {
    await chrome.tabs.create({ url: chrome.runtime.getURL(ENGINE_SETUP_PATH) });
    return true;
  } catch {
    try { await chrome.runtime.openOptionsPage(); return true; } catch { return false; }
  }
}

// ======================================================================
// Page plumbing shared by both surfaces
// ======================================================================

/** Fill [data-msg], [data-msg-label] and [data-msg-placeholder] under root. */
export function applyStaticCopy(root = document) {
  for (const element of root.querySelectorAll("[data-msg]")) element.textContent = msg(element.dataset.msg);
  for (const element of root.querySelectorAll("[data-msg-placeholder]")) element.placeholder = msg(element.dataset.msgPlaceholder);
  for (const element of root.querySelectorAll("[data-msg-label]")) {
    const label = msg(element.dataset.msgLabel);
    element.setAttribute("aria-label", label);
    if (element.tagName === "BUTTON") element.title = label;
  }
}

/** The top bar's mist (P6): present once the scroller has moved, absent at 0. */
export function bindMist(topbar, scroller = window) {
  const read = () => (scroller === window ? window.scrollY : scroller.scrollTop);
  const update = () => { topbar.dataset.scrolled = String(read() > 0); };
  scroller.addEventListener("scroll", update, { passive: true });
  update();
  return update;
}

/** Pond zones (§6.10): the two gutters, plus the empty-state section around a
 *  shown empty sentence. The zone never reaches above or below that section,
 *  so no touch lands behind a status line, a list header or the next section.
 *  width: the empty-state zone's width from its left edge, for full pages
 *  (Downloads uses 560); by default the zone ends at x = 480, which suits the
 *  popup and the side panel. */
export function pondZones(column, sentence = null, { width = null } = {}) {
  const rect = column.getBoundingClientRect();
  const height = window.innerHeight;
  const zones = [
    { x: 0, y: 0, width: Math.max(0, rect.left), height },
    { x: rect.right, y: 0, width: Math.max(0, window.innerWidth - rect.right), height }
  ];
  if (sentence?.isConnected && sentence.getClientRects().length) {
    const section = (sentence.closest?.(".empty-state") || sentence).getBoundingClientRect();
    const left = Math.max(0, section.left - 40);
    const right = Number(width) > 0 ? Math.min(window.innerWidth, left + Number(width)) : Math.min(window.innerWidth, 480);
    zones.push({ x: left, y: Math.max(0, section.top), width: Math.max(0, right - left), height: section.height });
  }
  return zones;
}

// The pond that last painted each opening: a page can open the pond before
// mountPond() resolves, and that pond must still repaint once it exists.
const pondOpenedBy = new WeakMap();

/** Open the pond around an empty sentence (or close it with null). */
export function setPondOpening(pondElement, pond, sentence) {
  if (!pondElement) return;
  if (!sentence) {
    if (pondElement.dataset.open) { delete pondElement.dataset.open; pond?.refresh(); }
    return;
  }
  requestAnimationFrame(() => {
    if (!sentence.isConnected) return;
    const rect = sentence.getBoundingClientRect();
    pondElement.style.setProperty("--open-x", `${Math.round(rect.left + 120)}px`);
    pondElement.style.setProperty("--open-y", `${Math.round(rect.top + rect.height)}px`);
    if (pondElement.dataset.open !== "true" || (pond && pondOpenedBy.get(pondElement) !== pond)) {
      pondElement.dataset.open = "true";
      if (pond) { pondOpenedBy.set(pondElement, pond); pond.refresh(); }
    }
  });
}

// ======================================================================
// Detected media rows
// ======================================================================

/**
 * One detected item (§6.4, §6.14): 20px type glyph in the lead, the title in
 * `row` middle-truncated, one meta line, the source line (host · age), a
 * tertiary Download (data-media-action "download") and, for copyable items,
 * an overflow with Copy link. A row without the overflow keeps an inert
 * slot of its size, so every Download ends on one right edge (§5).
 * @param {object} item
 * @param {object} o
 * @param {boolean} [o.busy]  the quality probe is running (meta reads "Reading qualities…")
 * @param {(item, button) => void} o.onDownload
 * @param {(item, button) => void} [o.onMore]
 */
export function mediaRow(item, { busy = false, onDownload, onMore } = {}) {
  const key = mediaKey(item);
  const name = readableMediaTitle(item);
  const download = button({ kind: "tertiary", label: msg("action.download"), action: "download" });
  download.dataset.mediaAction = "download";
  download.dataset.mediaId = key;
  download.setAttribute("aria-label", msg("media.downloadFor", { name }));
  // Busy, not disabled: a re-render during the probe keeps keyboard focus on
  // this button, and a second click is ignored by the dialog's single flight.
  if (busy) download.setAttribute("aria-busy", "true");
  download.addEventListener("click", () => onDownload?.(item, download));
  const actions = [download];
  if (item.copyable === true && onMore) {
    const more = iconButton({ iconName: "more", label: msg("action.moreFor", { name }), action: "more", haspopup: true });
    more.dataset.mediaAction = "more";
    more.dataset.mediaId = key;
    more.addEventListener("click", () => onMore(item, more));
    actions.push(more);
  } else {
    const slot = document.createElement("span");
    slot.className = "icon-slot";
    slot.setAttribute("aria-hidden", "true");
    actions.push(slot);
  }
  const row = downloadRow({
    lead: rowLead(item, { poster: false }),
    title: name,
    meta: busy ? msg("media.reading") : mediaMeta(item),
    source: mediaSource(item),
    actions,
    actionsVisible: true,
    id: key
  });
  if (busy) row.setAttribute("aria-busy", "true");
  return row;
}

/** The source line of a detected item (§6.4): "cdn.example.com · 5 min. ago";
 *  the host is user content, the age follows locale.js. null when neither is known. */
export function mediaSource(item) {
  const host = urlHost(item?.displayUrl);
  const when = formatRelativeTime(item?.lastSeen);
  if (!host && !when) return null;
  const line = document.createElement("span");
  if (host) {
    const hostNode = document.createElement("span");
    hostNode.dataset.userContent = "";
    hostNode.textContent = host;
    line.append(hostNode);
  }
  if (when) line.append(document.createTextNode(`${host ? " · " : ""}${when}`));
  return line;
}

/** The overflow of a detected item: Copy link. */
export function openMediaMenu(menus, item, anchor, { toast, onError } = {}) {
  menus.openItems(anchor, [{
    label: msg("action.copyLink"),
    iconName: "copy",
    run: () => void runAction(null, `copy:${mediaKey(item)}`, async () => {
      await navigator.clipboard.writeText(item.displayUrl);
      toast?.(msg("toast.linkCopied"));
    }, { onError })
  }]);
}

/** The focusable Download of a detected item, by its media key. */
export function findDownloadButton(key, root = document) {
  return [...root.querySelectorAll('button[data-media-action="download"]')].find((element) => element.dataset.mediaId === key) || null;
}

// ======================================================================
// The per-item download dialog (§6.12)
// ======================================================================

/**
 * The Download dialog shared by the popup and the side panel: file name,
 * format and (when the stream offers them) quality; one status line for the
 * engine, a blocked stream or a failure; Cancel and the one primary Download.
 * Fits 372 × 600: the body scrolls and the action row stays in view.
 *
 * @param {object} o
 * @param {() => {tabId: number, settings: object, hostStatus: object, permission: boolean|null}} o.getContext
 * @param {() => Promise<object>} o.ping            fresh host status (pingEngine)
 * @param {(status: object) => void} [o.onHost]     the page keeps the fresh status
 * @param {(result: object, info: {item, options}) => void} [o.onStarted]
 * @param {(jobId: string) => Promise<boolean>} [o.onRepresented]  a failed start a job row now shows
 * @param {(key: string, busy: boolean) => void} [o.onBusy]        a quality probe started or ended
 * @param {() => void} [o.setUp]                    the engine line's Set up
 * @param {() => HTMLElement|null} [o.fallbackFocus]
 * @param {(message) => Promise<object>} [o.call]
 */
export function createMediaDialog({ getContext, ping, onHost, onStarted, onRepresented, onBusy, setUp, fallbackFocus, call = callWorker } = {}) {
  // Probes and busy flags are per tab: a candidate id belongs to the tab it was found on.
  const probes = new Map();
  const busy = new Set();
  const slot = (tabId, key) => `${tabId ?? ""}:${key}`;
  let item = null;
  // The tab the open dialog belongs to, captured when it opens: the side panel
  // may follow another tab while the dialog is open, and the start must still
  // go to the item's own tab.
  let tabId = null;
  let trigger = null;
  let probeFailed = false;
  let error = null;
  let starting = false;

  const linkField = textField({ id: "mediaLink", type: "url", maxLength: 4096, spellcheck: false, onInput: syncLink });
  const nameField = textField({ id: "mediaName", maxLength: 200 });
  const formatField = select({ id: "mediaFormat", width: "fill", onChange: onFormat });
  const qualityField = select({ id: "mediaQuality", width: "fill" });
  const linkStack = fieldStack({ label: "", control: linkField });
  const nameStack = fieldStack({ label: "", control: nameField });
  const formatStack = fieldStack({ label: "", control: formatField });
  const qualityStack = fieldStack({ label: "", control: qualityField });
  const line = document.createElement("p");
  line.className = "status-line lead-grid dialog-line";
  line.id = "mediaDialogLine";
  line.setAttribute("role", "status");
  const cancel = button({ kind: "tertiary", label: "", action: "cancel" });
  const submit = button({ kind: "primary", label: "", type: "submit", action: "download" });
  const shell = dialogShell({
    title: "",
    id: "downloadDialog",
    body: [linkStack, nameStack, formatStack, qualityStack, line],
    actions: [cancel, submit],
    onSubmit: (event) => { event.preventDefault(); void startDownload(); },
    onClose: restoreFocus
  });
  shell.dialog.setAttribute("aria-describedby", line.id);
  cancel.addEventListener("click", () => shell.close("cancel"));
  document.body.append(shell.dialog);

  const link = controlOf(linkField);
  const name = controlOf(nameField);
  const format = controlOf(formatField);
  const quality = controlOf(qualityField);

  function applyCopy() {
    shell.heading.textContent = msg("action.download");
    linkStack.querySelector("label").textContent = msg("media.dialog.link");
    nameStack.querySelector("label").textContent = msg("media.dialog.name");
    formatStack.querySelector("label").textContent = msg("media.dialog.format");
    qualityStack.querySelector("label").textContent = msg("media.dialog.quality");
    link.placeholder = msg("media.dialog.linkPlaceholder");
    name.placeholder = item?.urlMode ? msg("media.dialog.namePlaceholder") : "";
    cancel.querySelector("span").textContent = msg("action.cancel");
    submit.querySelector("span").textContent = msg("action.download");
    const close = shell.dialog.querySelector(".dialog-close");
    if (close) { close.title = msg("action.close"); close.setAttribute("aria-label", msg("action.close")); }
    if (item) {
      setFormats(format.value);
      setQualities(quality.value);
      renderLine();
    }
  }
  applyCopy();

  const probeOf = () => (item ? probes.get(slot(tabId, mediaKey(item))) : null);

  function setFormats(value) {
    const options = formatOptions(item, getContext().hostStatus);
    setOptions(format, options, value);
    const chosen = options.find((option) => option.value === format.value);
    if (!chosen || chosen.disabled) format.value = (options.find((option) => option.value === "mp4" && !option.disabled) || options.find((option) => !option.disabled)).value;
  }

  function setQualities(value = "") {
    const variants = Array.isArray(probeOf()?.variants) ? probeOf().variants : [];
    setOptions(quality, [{ value: "", label: msg("media.quality.best") }, ...variants.map((variant, index) => ({ value: variant.url, label: variantLabel(variant, index) }))], value);
    syncQualityVisibility();
  }

  function syncQualityVisibility() {
    const hasChoices = quality.options.length > 1;
    qualityStack.hidden = !hasChoices || ["mp3", "original"].includes(format.value);
  }

  function currentOptions() {
    const filename = String(name.value || "").trim();
    return downloadOptions(item, {
      filename: filename || (item.urlMode ? "" : defaultFilename(item, format.value)),
      format: format.value,
      variantUrl: qualityStack.hidden ? null : quality.value || null,
      settings: getContext().settings
    });
  }

  function renderLine() {
    if (!item) return;
    const block = manifestBlock(probeOf());
    // While a start is in flight the button stays disabled, whatever re-renders the line.
    submit.disabled = Boolean(block) || starting;
    if (error) {
      line.setAttribute("role", "alert");
      setStatusLine(line, { tone: "failed", text: errorText(error) });
      return;
    }
    line.setAttribute("role", "status");
    if (block) {
      setStatusLine(line, { tone: "warning", text: msg(`media.block.${block}`) });
      return;
    }
    const options = currentOptions();
    if (item.urlMode || downloadNeedsNative(item, options)) {
      const { hostStatus, permission } = getContext();
      const issue = engineIssue(hostStatus, { permission });
      const matters = issue && (issue !== "noConvert" || options.convert || options.extractAudio || isStreamKind(item));
      if (matters) {
        setStatusLine(line, engineLine(issue, { setUp, retry: (anchor) => void retryEngine(anchor) }));
        return;
      }
    }
    if (probeFailed) {
      setStatusLine(line, { tone: "warning", text: msg("media.probeFailed") });
      return;
    }
    setStatusLine(line, {});
  }

  async function retryEngine(anchor) {
    await runAction(anchor, "dialog:ping", async () => {
      const status = await ping();
      onHost?.(status);
      renderLine();
    });
  }

  function onFormat(value) {
    if (item && !(item.urlMode && !String(name.value || "").trim())) name.value = replaceFilenameExtension(name.value, value, item);
    syncQualityVisibility();
    error = null;
    renderLine();
  }

  function syncLink() {
    if (!item?.urlMode) return;
    item = urlItem(link.value);
    const stream = isStreamKind(item);
    let next = format.value;
    if (stream && next === "original") next = defaultFormat(item, getContext().settings);
    if (!stream && next !== "mp3") next = "original";
    setFormats(next);
    error = null;
    renderLine();
  }

  function show(focusTarget) {
    error = null;
    renderLine();
    shell.open();
    queueMicrotask(() => { if (shell.dialog.open) focusTarget.focus({ preventScroll: true }); });
  }

  /** Open for a detected item; probeFailed shows that the qualities could not be read. */
  function openItem(next, { failed = false } = {}) {
    item = next;
    probeFailed = failed;
    linkStack.hidden = true;
    const { settings } = getContext();
    setFormats(defaultFormat(item, settings));
    name.value = defaultFilename(item, format.value);
    name.placeholder = "";
    setQualities("");
    show(name);
  }

  /** The row's Download: streams read their qualities first (PROBE_MANIFEST),
   *  then the dialog opens whether or not that worked. */
  async function prepare(next, anchor) {
    const owner = getContext().tabId;
    if (!isStreamKind(next)) { trigger = anchor; tabId = owner; openItem(next); return; }
    const key = mediaKey(next);
    const entry = slot(owner, key);
    let failed = false;
    if (!probes.has(entry)) {
      if (busy.has(entry)) return;
      busy.add(entry);
      onBusy?.(key, true);
      try {
        const result = await call({ type: "PROBE_MANIFEST", tabId: owner, candidate: candidateReference(next) });
        probes.set(entry, result?.probe || null);
      } catch {
        failed = true;
      } finally {
        busy.delete(entry);
        onBusy?.(key, false);
      }
    }
    // The page moved to another tab during the probe: its rows are gone, so do not open.
    if (getContext().tabId !== owner) return;
    trigger = findDownloadButton(key) || anchor;
    tabId = owner;
    openItem(next, { failed });
  }

  /** Open for a pasted link (the top bar's "Download a link"). */
  function openUrl(anchor) {
    trigger = anchor;
    tabId = getContext().tabId;
    item = urlItem("");
    probeFailed = false;
    linkStack.hidden = false;
    link.value = "";
    name.value = "";
    name.placeholder = msg("media.dialog.namePlaceholder");
    setFormats("original");
    setQualities("");
    show(link);
  }

  async function startDownload() {
    if (!item) { shell.close("cancel"); return; }
    if (submit.disabled) return;
    const target = item;
    const options = currentOptions();
    const url = target.urlMode ? String(link.value || "").trim() : "";
    if (target.urlMode) {
      if (!/^https?:\/\/\S+$/i.test(url)) {
        error = userError(msg("toast.invalidUrl"));
        renderLine();
        link.focus({ preventScroll: true });
        return;
      }
      if (!options.filename) delete options.filename;
    }
    error = null;
    // A dialog opened before the page knew its tab takes the tab it knows now.
    const owner = tabId ?? getContext().tabId;
    starting = true;
    await runAction(submit, `dialog:start:${mediaKey(target)}`, async () => {
      if (target.urlMode || downloadNeedsNative(target, options)) {
        // Keep request() the first asynchronous call of the click, so the
        // optional-permission prompt keeps its user gesture. Probing after it
        // catches a worker whose API binding is still stale.
        const granted = await chrome.permissions.request({ permissions: ["nativeMessaging"] });
        if (!granted) throw userError(msg("toast.engineNeeded"));
        const host = await ping();
        onHost?.(host);
        requireEngineReady(host);
      }
      const result = target.urlMode
        ? await call({ type: "DOWNLOAD_URL", tabId: owner, url, options })
        : await call({ type: "DOWNLOAD", tabId: owner, candidate: candidateReference(target), options });
      shell.close("submit");
      onStarted?.(result || {}, { item: target, options });
    }, {
      onError: async (failure) => {
        if (failure?.jobId && await onRepresented?.(failure.jobId)) { shell.close("submit"); return; }
        if (item !== target) return;
        error = failure;
        renderLine();
      }
    });
    starting = false;
    if (item === target && shell.dialog.open) renderLine();
  }

  function restoreFocus() {
    const key = item?.urlMode ? "" : mediaKey(item);
    item = null;
    tabId = null;
    error = null;
    const usable = (element) => element?.isConnected && !element.closest?.("[hidden]") && !element.disabled;
    const candidate = trigger?.isConnected ? trigger : (key && findDownloadButton(key)) || null;
    trigger = null;
    queueMicrotask(() => {
      // A start that switched views has already placed focus; do not take it back.
      const active = globalThis.document?.activeElement;
      if (active && active !== document.body && !shell.dialog.contains(active)) return;
      const target = usable(candidate) ? candidate : fallbackFocus?.();
      target?.focus?.({ preventScroll: true });
    });
  }

  return {
    dialog: shell.dialog,
    prepare,
    openUrl,
    isOpen: () => shell.dialog.open,
    /** A quality probe for this item on the page's current tab is running. */
    isBusy: (key) => busy.has(slot(getContext().tabId, key)),
    /** Drop a cached probe (the worker regrouped the item's qualities), on every tab. */
    invalidate: (key) => {
      if (!key) { probes.clear(); return; }
      // An entry is "<tabId>:<key>"; the tab id never holds a colon.
      for (const entry of [...probes.keys()]) if (entry.slice(entry.indexOf(":") + 1) === key) probes.delete(entry);
    },
    /** The engine status changed while the dialog may be open: MP3 availability and the line follow. */
    syncHost() {
      if (!item || !shell.dialog.open) return;
      const before = format.value;
      setFormats(before);
      if (format.value !== before) onFormat(format.value);
      else renderLine();
    },
    applyCopy
  };
}

// ======================================================================
// The downloads list (popup Downloads view, side-panel Downloads section)
// ======================================================================

const FINISH_SETTLE_MS = 1200;
const FINISH_HOLD_MS = 1800;
const ENDED_FIELDS = ["status", "filename", "updatedAt", "finishedAt", "hasFile", "fileMissing", "retryable", "hasSource", "sourceHost", "total", "size", "bytes", "error", "message", "code"];

/**
 * Live jobs (rows.js live rows, updated in place; optionally the first as the
 * view's one focus panel) followed by ended jobs (history rows: Open or Retry
 * plus an overflow). Pause, Resume, Cancel (confirmed in place), Open, Retry,
 * Show in Finder, Open source page and Remove from history (confirmed).
 * @param {object} o
 * @param {HTMLUListElement} o.list
 * @param {HTMLElement} [o.focusSlot]   when given, the first live job becomes the focus panel
 * @param {object} o.menus              one createMenus() instance per page
 * @param {(text, tone?) => void} o.toast
 * @param {(error) => void} o.onError
 * @param {HTMLElement} [o.announcer]   a polite live region for status changes
 * @param {(stats: {total, shown, active, ended}) => void} [o.onChange]
 * setFilter(filter) shows only the jobs of one type (jobMatchesFilter: the
 * popup's all | video | audio | stream); size still counts every job.
 */
export function createJobList({ list, focusSlot = null, menus, toast, onError, announcer = null, onChange, call = callWorker } = {}) {
  const jobs = new Map();
  const speeds = new Map();
  const finishing = new Map();
  const live = { focusId: null, focus: null, rows: new Map() };
  const ended = new Map();
  let lastAnnouncement = "";
  let filter = "all";
  let shownCount = 0;

  function recordSpeed(job) {
    if (isTerminalStatus(job.status)) { speeds.delete(job.jobId); return; }
    speeds.set(job.jobId, recordSpeedSample(speeds.get(job.jobId) || [], job));
  }

  function announce(previous, current) {
    if (!announcer || !current || previous?.status === current.status) return;
    const key = `${current.jobId || current.updatedAt || current.filename || "media"}:${current.status || ""}`;
    if (lastAnnouncement === key) return;
    lastAnnouncement = key;
    const words = msg("media.announce", { name: displayFilename(current), status: msg(`status.${current.status}`) });
    announcer.textContent = "";
    queueMicrotask(() => { if (lastAnnouncement === key) announcer.textContent = words; });
  }

  function beginFinish(job) {
    finishing.set(job.jobId, { phase: "complete" });
    setTimeout(() => {
      const entry = finishing.get(job.jobId);
      if (entry) { entry.phase = "settled"; render(); }
    }, FINISH_SETTLE_MS);
    setTimeout(() => { finishing.delete(job.jobId); render(); }, FINISH_HOLD_MS);
  }

  function setJobs(next = []) {
    const before = new Map(jobs);
    jobs.clear();
    for (const job of next || []) {
      if (!job?.jobId) continue;
      jobs.set(job.jobId, job);
      recordSpeed(job);
      const previous = before.get(job.jobId);
      if (previous && job.status === "completed" && !isTerminalStatus(previous.status)) beginFinish(job);
    }
    render();
  }

  /** Merge one update (JOB_UPDATED, or a legacy HOST_EVENT event). */
  function upsert(update) {
    if (!update?.jobId) return;
    // An absent field in a partial event never erases what the row already knows.
    const event = Object.fromEntries(Object.entries(update).filter(([, value]) => value !== undefined));
    const previous = jobs.get(event.jobId);
    if (previous && Object.entries(event).every(([key, value]) => previous[key] === value)) return;
    // No filename yet: the row shows "Untitled media" until the worker names the file.
    const merged = { ...(previous || { jobId: event.jobId, progress: 0 }), ...event };
    jobs.set(merged.jobId, merged);
    recordSpeed(merged);
    announce(previous, merged);
    if (merged.status === "completed" && previous && !isTerminalStatus(previous.status)) beginFinish(merged);
    render();
  }

  // ----- rendering -----
  /** What a row draws: the job, with a display name when the worker sent none. */
  const shown = (job) => (String(job?.filename || "").trim() ? job : { ...job, filename: displayFilename(job) });

  function updateLive(view, job) {
    updateLiveRow(view, shown(job), { finishing: finishing.get(job.jobId) || null, samples: speeds.get(job.jobId) || [], onControl: transferControl });
  }

  function endedRow(job) {
    const signature = JSON.stringify(ENDED_FIELDS.map((field) => job[field] ?? null).concat(msg("action.open")));
    const cached = ended.get(job.jobId);
    if (cached?.signature === signature) return cached.node;
    const node = historyRow({ ...shown(job), finishedAt: job.finishedAt || job.updatedAt }, { poster: false, onAction: endedAction });
    ended.set(job.jobId, { signature, node });
    return node;
  }

  function render() {
    const focused = globalThis.document?.activeElement;
    const inside = focused && (list.contains?.(focused) || focusSlot?.contains?.(focused));
    const focusJob = inside ? focused.closest?.("[data-job-id]")?.dataset?.jobId || "" : "";
    const focusAction = inside ? focused.dataset?.action || "" : "";
    const all = [...jobs.values()].sort(compareJobs);
    const listed = all.filter((job) => jobMatchesFilter(job, filter));
    shownCount = listed.length;
    const active = listed.filter((job) => !isTerminalStatus(job.status) || finishing.has(job.jobId));
    const done = listed.filter((job) => isTerminalStatus(job.status) && !finishing.has(job.jobId));
    let rest = active;
    if (focusSlot) {
      const [first, ...others] = active;
      rest = others;
      if (!first) {
        focusSlot.replaceChildren();
        live.focusId = null;
        live.focus = null;
      } else if (live.focusId !== first.jobId || !live.focus) {
        live.focusId = first.jobId;
        live.focus = liveRow(shown(first), { focus: true, poster: false, compact: true });
        focusSlot.replaceChildren(live.focus.root);
      }
      if (first) updateLive(live.focus, first);
    }
    const keepLive = new Set(rest.map((job) => job.jobId));
    for (const [id, view] of live.rows) if (!keepLive.has(id)) { view.root.remove(); live.rows.delete(id); }
    const keepEnded = new Set(done.map((job) => job.jobId));
    for (const [id, entry] of ended) if (!keepEnded.has(id)) { entry.node.remove(); ended.delete(id); }
    const nodes = [];
    for (const job of rest) {
      let view = live.rows.get(job.jobId);
      if (!view) { view = liveRow(shown(job), { focus: false, poster: false, compact: true }); live.rows.set(job.jobId, view); }
      updateLive(view, job);
      nodes.push(view.root);
    }
    for (const job of done) nodes.push(endedRow(job));
    const wanted = new Set(nodes);
    for (const child of [...list.children]) if (!wanted.has(child)) child.remove();
    nodes.forEach((node, index) => {
      if (list.children[index] !== node) list.insertBefore(node, list.children[index] || null);
    });
    if (focusJob && !focused.isConnected) {
      const scope = [...list.querySelectorAll("[data-job-id]"), ...(focusSlot ? focusSlot.querySelectorAll("[data-job-id]") : [])].filter((element) => element.dataset.jobId === focusJob);
      const candidates = scope.flatMap((element) => (element.matches("button") ? [element] : [...element.querySelectorAll("button")]));
      (candidates.find((element) => element.dataset.action === focusAction) || candidates[0])?.focus({ preventScroll: true });
    }
    onChange?.({ total: jobs.size, shown: listed.length, active: active.length, ended: done.length });
  }

  // ----- actions -----
  function transferControl(action, job, control) {
    if (action === "resume") {
      void runAction(control, `resume:${job.jobId}`, async () => {
        await call({ type: "RESUME_JOB", jobId: job.jobId });
        toast(msg("toast.resumed"));
      }, { onError });
    } else if (action === "pause") {
      void runAction(control, `pause:${job.jobId}`, async () => {
        await call({ type: "PAUSE_JOB", jobId: job.jobId });
        toast(msg("toast.pausing"));
      }, { onError });
    } else if (action === "cancel") {
      void (async () => {
        if (!(await menus.confirm(control, { question: msg("job.cancelConfirm"), confirmLabel: msg("job.cancelAction") }))) return;
        await runAction(control, `cancel:${job.jobId}`, async () => {
          await call({ type: "CANCEL_JOB", jobId: job.jobId });
          toast(msg("toast.stopped"));
        }, { onError });
      })();
    }
  }

  function endedAction(action, record, control) {
    const job = jobs.get(record.jobId) || record;
    if (action === "more") { openEndedMenu(job, control); return; }
    void fileAction(action, job, control);
  }

  function openEndedMenu(job, anchor) {
    const items = [];
    const hasFile = job.status === "completed" && job.hasFile && !job.fileMissing;
    if (hasFile) items.push({ label: msg("action.showInFinder"), iconName: "folder", run: () => void fileAction("reveal", job, anchor) });
    if (job.hasSource) items.push({ label: msg("action.openSource"), iconName: "source", run: () => void fileAction("source", job, anchor) });
    items.push({ label: msg("action.remove"), iconName: "remove", tone: "destructive", keepOpen: true, run: () => void fileAction("remove", job, anchor) });
    menus.openItems(anchor, items);
  }

  async function fileAction(action, job, anchor) {
    const key = `job:${action}:${job.jobId}`;
    if (action === "remove") {
      if (!(await menus.confirm(anchor, { question: msg("job.removeConfirm"), confirmLabel: msg("action.remove") }))) return;
      await runAction(anchor, key, async () => {
        const result = await call({ type: "REMOVE_HISTORY", jobId: job.jobId });
        if (Array.isArray(result?.jobs)) setJobs(result.jobs);
        else { jobs.delete(job.jobId); render(); }
        toast(msg("toast.removed"));
      }, { onError });
      return;
    }
    if (action === "retry") {
      await runAction(anchor, key, async () => {
        await call({ type: "RETRY_JOB", jobId: job.jobId });
        toast(msg("toast.downloadStarted"));
      }, { onError });
      return;
    }
    if (action === "source") {
      await runAction(anchor, key, () => call({ type: "OPEN_JOB_SOURCE", jobId: job.jobId }), { onError });
      return;
    }
    await runAction(anchor, key, () => runFileAction(job, action, call), { onError });
  }

  return {
    setJobs,
    upsert,
    render,
    has: (jobId) => jobs.has(jobId),
    /** Say a job's status in the polite region (a failed start a row now shows). */
    announce: (jobId) => announce(null, jobs.get(jobId)),
    get size() { return jobs.size; },
    /** How many jobs the current filter shows. */
    get shown() { return shownCount; },
    setFilter(next = "all") {
      if (next === filter) return;
      filter = next;
      render();
    },
    get endedCount() { return [...jobs.values()].filter((job) => isTerminalStatus(job.status)).length; },
    /** Rebuild rows after a language change. */
    relabel() {
      ended.clear();
      for (const view of live.rows.values()) view.root.remove();
      live.rows.clear();
      live.focusId = null;
      live.focus = null;
      focusSlot?.replaceChildren();
      list.replaceChildren();
      render();
    }
  };
}
