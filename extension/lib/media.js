export const MEDIA_EXTENSIONS = new Set([
  "mp4", "m4v", "webm", "mkv", "mov", "avi", "flv", "ts", "m2ts",
  "m4s", "cmfv", "cmfa", "mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac",
  "m3u8", "m3u", "mpd"
]);

export const MANIFEST_MIMES = new Set([
  "application/vnd.apple.mpegurl",
  "application/x-mpegurl",
  "audio/mpegurl",
  "audio/x-mpegurl",
  "application/dash+xml"
]);

const MEDIA_MIME_RE = /^(video|audio)\//i;
const SEGMENT_RE = /(?:^|[./_-])(?:seg(?:ment)?|chunk|frag(?:ment)?|part)[-_]?\d+/i;
const MAX_URL_LENGTH = 16_384;
const SEGMENT_EXTENSIONS = new Set(["m4s", "cmfv", "cmfa"]);
const TEXT_TRACK_EXTENSIONS = new Set(["vtt", "srt", "ass", "ssa", "ttml", "dfxp"]);
const TEXT_TRACK_MIMES = new Set([
  "text/vtt",
  "text/srt",
  "application/x-subrip",
  "application/ttml+xml",
  "application/dfxp+xml"
]);
const BILIBILI_PAGE_HOSTS = new Set(["www.bilibili.com", "m.bilibili.com"]);
const BILIBILI_MEDIA_HOST_RE = /(?:^|\.)(?:bilivideo\.com|bilivideo\.cn)$/i;
const BILIBILI_PARTNER_MEDIA_HOST_RE = /(?:^|\.)mountaintoys\.cn$/i;
const BILIBILI_VIDEO_HEIGHTS = new Map([
  [6, 240], [16, 360], [32, 480], [64, 720], [74, 720], [80, 1080],
  [112, 1080], [116, 1080], [120, 2160], [125, 2160], [126, 2160], [127, 4320]
]);

export function isBilibiliVideoPage(value) {
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol)
      && BILIBILI_PAGE_HOSTS.has(url.hostname.toLowerCase())
      && /^\/video\/(?:BV|av)[a-z0-9]+(?:\/|$)/i.test(url.pathname);
  } catch {
    return false;
  }
}

export function isBilibiliMediaUrl(value) {
  try {
    const url = new URL(value);
    const trustedHost = BILIBILI_MEDIA_HOST_RE.test(url.hostname) || BILIBILI_PARTNER_MEDIA_HOST_RE.test(url.hostname);
    // The partner CDN is accepted only for Bilibili's immutable upgcxcode DASH
    // object shape, not as a blanket trust of the whole domain.
    const trackPath = /(?:^|\/)upgcxcode\/.*(?:^|[-_/])(30[0-2]\d{2})\.(?:m4s|cmfv|cmfa)$/i.test(url.pathname);
    return url.protocol === "https:" && trustedHost && trackPath;
  } catch {
    return false;
  }
}

export function bilibiliDashAssetFamily(value) {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (!isBilibiliMediaUrl(url.href)) return "";
    let pathname = url.pathname;
    try { pathname = decodeURIComponent(pathname); } catch { return ""; }
    // CDN products prepend different routing components (for example
    // /v1/resource), but the path from /upgcxcode onward is stable for a media
    // object. Keep that directory context so unrelated objects with the same
    // final filename cannot be paired.
    const marker = pathname.toLowerCase().lastIndexOf("/upgcxcode/");
    const scopedPath = marker >= 0 ? pathname.slice(marker) : pathname;
    const family = scopedPath.replace(/30[0-2]\d{2}\.(?:m4s|cmfv|cmfa)$/i, "{track}");
    return family === scopedPath ? "" : family;
  } catch {
    return "";
  }
}

export function bilibiliDashTrackId(value, trackType = "") {
  try {
    const url = value instanceof URL ? value : new URL(value);
    if (!isBilibiliMediaUrl(url.href)) return "";
    const source = `${trackType}|${url.hostname.toLowerCase()}${url.pathname}`;
    // Two independent 32-bit accumulators keep the selector compact and avoid
    // exposing the media path while still distinguishing identical paths on
    // different CDN hosts. Query signatures are deliberately excluded.
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (let index = 0; index < source.length; index += 1) {
      const code = source.charCodeAt(index);
      first = Math.imul(first ^ code, 16777619);
      second = Math.imul(second ^ (code + index), 2246822519);
    }
    return `bt-${(first >>> 0).toString(36)}-${(second >>> 0).toString(36)}`;
  } catch {
    return "";
  }
}

// Bilibili's HTMLMediaElement normally points at a blob: MediaSource while the
// actual DASH tracks are requested as complete ISO-BMFF .m4s objects.  Keep the
// generic classifier's segment suppression, and recognize only the site's
// well-known representation IDs here so unrelated fragments never become rows.
export function classifyBilibiliDashTrack({ url, mime = "", contentLength = 0 }) {
  try {
    const parsed = new URL(url);
    if (!isBilibiliMediaUrl(parsed.href)) return null;
    const ext = getExtension(parsed.href);
    if (!["m4s", "cmfv", "cmfa"].includes(ext)) return null;
    const normalizedMime = normalizeMime(mime);
    const basename = decodeURIComponent(parsed.pathname.split("/").pop() || "");
    const representationMatch = basename.match(/(?:^|[-_.])(\d{5,6})(?:\.(?:m4s|cmfv|cmfa))$/i);
    const representationId = representationMatch ? Number.parseInt(representationMatch[1], 10) : 0;
    let trackType = "";
    if (ext === "cmfa" || (representationId >= 30200 && representationId < 30300)) trackType = "audio";
    else if (ext === "cmfv" || (representationId >= 30000 && representationId < 30200)) trackType = "video";
    else if (normalizedMime.startsWith("audio/")) trackType = "audio";
    else if (normalizedMime.startsWith("video/")) trackType = "video";
    if (!trackType) return null;
    if (normalizedMime.startsWith("audio/") && trackType !== "audio") return null;
    if (normalizedMime.startsWith("video/") && trackType !== "video") return null;
    const qualityId = trackType === "video" && representationId ? representationId % 1000 : null;
    const bandwidth = Number.parseInt(parsed.searchParams.get("bw") || "0", 10);
    const size = Number(contentLength);
    return {
      trackType,
      representationId: representationId ? String(representationId) : "",
      qualityId,
      height: qualityId ? BILIBILI_VIDEO_HEIGHTS.get(qualityId) || null : null,
      bandwidth: Number.isSafeInteger(bandwidth) && bandwidth > 0 ? bandwidth : 0,
      contentLength: Number.isSafeInteger(size) && size > 0 ? size : 0,
      mime: normalizedMime,
      ext,
      // Audio and video representations for one playback share this path
      // prefix even when Bilibili sends them through different CDN hosts.
      // It is therefore a safer pairing boundary than tab/title/timing alone.
      assetFamily: bilibiliDashAssetFamily(parsed),
      // Query values contain short-lived signatures. This key intentionally
      // excludes them and is only used to coalesce repeated Range requests.
      identity: `${parsed.hostname.toLowerCase()}${parsed.pathname}`,
      trackId: bilibiliDashTrackId(parsed, trackType)
    };
  } catch {
    return null;
  }
}

// Some players request caption indexes through an .m3u8 endpoint and even
// label the response with an HLS MIME type.  They are text-track resources,
// not separately downloadable videos.  Match only semantic path segments (or
// an explicit track query value), never loose words in a video title.
export function isLikelySubtitleResource({ url, mime = "" }) {
  const normalizedMime = normalizeMime(mime);
  if (TEXT_TRACK_MIMES.has(normalizedMime)) return true;
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((part) => {
        try { return decodeURIComponent(part).toLowerCase(); } catch { return part.toLowerCase(); }
      });
    const ext = getExtension(parsed.href);
    if (TEXT_TRACK_EXTENSIONS.has(ext)) return true;
    if (segments.some((part) => /^(?:captions?|closed[-_]?captions?|subtitles?|text[-_]?tracks?)$/.test(part))) return true;
    for (const key of ["kind", "type", "track", "role"]) {
      if (/^(?:captions?|closed[-_]?captions?|subtitles?|text[-_]?tracks?)$/i.test(parsed.searchParams.get(key) || "")) return true;
    }
  } catch {
    return false;
  }
  return false;
}

export function getExtension(rawUrl) {
  try {
    const path = new URL(rawUrl).pathname;
    const match = path.match(/\.([a-zA-Z0-9]{2,6})$/);
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

export function normalizeMime(value = "") {
  return String(value).split(";", 1)[0].trim().toLowerCase();
}

export function classifyMedia({ url, mime = "", resourceType = "", contentLength = 0 }) {
  const ext = getExtension(url);
  const normalizedMime = normalizeMime(mime);
  if (isLikelySubtitleResource({ url, mime: normalizedMime })) return null;
  const isManifest = ext === "m3u8" || ext === "m3u" || ext === "mpd" || MANIFEST_MIMES.has(normalizedMime);

  if (isManifest) {
    return {
      kind: ext === "mpd" || normalizedMime === "application/dash+xml" ? "dash" : "hls",
      confidence: 1,
      ext,
      mime: normalizedMime
    };
  }

  const isMediaMime = MEDIA_MIME_RE.test(normalizedMime);
  const isMediaExt = MEDIA_EXTENSIONS.has(ext);
  if (!isMediaMime && !isMediaExt && resourceType !== "media") return null;

  // Small numbered fragments are useful as evidence of a stream but should not
  // flood the popup as individually downloadable files.
  const likelyTransportSegment = ["ts", "m2ts", "aac"].includes(ext) && resourceType !== "media" && contentLength > 0 && contentLength < 32 * 1024 * 1024;
  if (SEGMENT_EXTENSIONS.has(ext) || likelyTransportSegment || (SEGMENT_RE.test(new URL(url).pathname) && contentLength > 0 && contentLength < 32 * 1024 * 1024)) {
    return { kind: "segment", confidence: 0.45, ext, mime: normalizedMime };
  }

  return {
    kind: normalizedMime.startsWith("audio/") || ["mp3", "m4a", "aac", "ogg", "oga", "opus", "wav", "flac"].includes(ext)
      ? "audio"
      : "video",
    confidence: isMediaMime && isMediaExt ? 1 : isMediaMime || resourceType === "media" ? 0.9 : 0.72,
    ext,
    mime: normalizedMime
  };
}

export function canonicalizeUrl(rawUrl) {
  try {
    if (typeof rawUrl !== "string" || rawUrl.length > MAX_URL_LENGTH) return null;
    const url = new URL(rawUrl);
    if (!/^https?:$/.test(url.protocol)) return null;
    // Credentials embedded in a URL are easy to leak to the popup/native host
    // and are never needed for candidates observed by the browser.
    if (url.username || url.password) return null;
    url.hash = "";
    return url.href.length <= MAX_URL_LENGTH ? url.href : null;
  } catch {
    return null;
  }
}

export function sanitizeFilename(value, fallback = "media") {
  const clean = String(value || fallback)
    .normalize("NFKC")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_")
    .replace(/\s+/g, " ")
    .replace(/^\.+|[ .]+$/g, "")
    .slice(0, 180);
  return clean || fallback;
}

export function filenameFromCandidate(candidate, pageTitle = "media") {
  const ext = candidate.ext || (candidate.kind === "audio" ? "m4a" : ["hls", "dash", "dash_pair"].includes(candidate.kind) ? "mp4" : "mp4");
  if (candidate.suggestedFilename) {
    const suggested = sanitizeFilename(candidate.suggestedFilename);
    return /\.[a-z0-9]{1,8}$/i.test(suggested) ? suggested : `${suggested}.${ext}`;
  }
  let base = pageTitle;
  try {
    const pathname = new URL(candidate.url).pathname;
    const last = decodeURIComponent(pathname.split("/").filter(Boolean).pop() || "");
    if (last && !/^index\.(?:m3u8|mpd)$/i.test(last)) base = last.replace(/\.[^.]+$/, "");
  } catch {
    // Keep page title.
  }
  return `${sanitizeFilename(base)}.${ext}`;
}

export function humanBytes(value) {
  const n = Number(value) || 0;
  if (!n) return "";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), units.length - 1);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

export function parseAttributeList(text) {
  const result = {};
  const re = /([A-Z0-9-]+)=("(?:[^"\\]|\\.)*"|[^,]*)/gi;
  for (const match of text.matchAll(re)) {
    let value = match[2].trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[match[1].toUpperCase()] = value;
  }
  return result;
}

export function resolveUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}
