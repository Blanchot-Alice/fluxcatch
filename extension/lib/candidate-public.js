function string(value) {
  return typeof value === "string" ? value : "";
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function strings(value, limit = 40) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === "string").slice(0, limit)
    : [];
}

const PATH_CREDENTIAL_KEY = /(?:^|[;._~-])(?:access[_-]?token|auth|authorization|bearer|credential|jwt|key|license|secret|session|signature|sig|token)(?:[=;._~-]|$)/i;
const JWT_PATH_SEGMENT = /^[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}$/;

function pathMayContainCredential(pathname) {
  let decoded = String(pathname || "");
  try { decoded = decodeURIComponent(decoded); } catch { /* Keep malformed escapes opaque. */ }
  const segments = decoded.split("/").filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (PATH_CREDENTIAL_KEY.test(segment)) return true;
    if (JWT_PATH_SEGMENT.test(segment)) return true;
    // Signed CDNs often put a bearer value directly after a key-named path
    // component rather than in the query string.
    if (/^(?:access[_-]?token|auth|bearer|credential|key|secret|session|signature|sig|token)$/i.test(segment)
      && segments[index + 1]) return true;
    // Treat long mixed/base64url-looking path components as opaque
    // capabilities. Ordinary filenames and stable page slugs remain useful.
    if (segment.length >= 32
      && /^[A-Za-z0-9_-]+$/.test(segment)
      && (/[A-Z]/.test(segment) && /[a-z]/.test(segment) && /\d/.test(segment))) return true;
  }
  return false;
}

function previewDisplayUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    url.search = "";
    if (pathMayContainCredential(url.pathname)) return `${url.origin}/…`;
    return url.href;
  } catch {
    return "";
  }
}

/** Explicit in-memory preview -> extension-page boundary. */
export function previewForUi(preview) {
  const thumbnailUrl = previewDisplayUrl(preview?.thumbnailUrl);
  if (!thumbnailUrl) return null;
  return {
    thumbnailUrl,
    thumbnailSource: string(preview?.thumbnailSource) || null,
    thumbnailFrameId: numberOrNull(preview?.thumbnailFrameId),
    thumbnailAt: numberOrNull(preview?.thumbnailAt),
    thumbnailAllowedOrigins: strings(preview?.thumbnailAllowedOrigins, 16),
    thumbnailAdapterImageHosts: strings(preview?.thumbnailAdapterImageHosts, 16)
  };
}

/** Explicit in-memory preview -> storage.session boundary. */
export function previewForPersistence(preview) {
  const rawUrl = string(preview?.thumbnailUrl);
  let normalized;
  try {
    normalized = new URL(rawUrl);
    if (!/^https?:$/.test(normalized.protocol) || normalized.username || normalized.password || normalized.search || normalized.hash) return null;
  } catch {
    return null;
  }
  const safe = previewForUi(preview);
  return safe && safe.thumbnailUrl === normalized.href ? safe : null;
}

export function publicDisplayUrl(value, { kind = "", site = "" } = {}) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return "";
    url.hash = "";
    if (kind === "youtube" || site === "youtube") {
      const videoId = url.searchParams.get("v");
      url.search = "";
      if (videoId) url.searchParams.set("v", videoId);
    } else if (site === "bilibili" || /(?:^|\.)bilibili\.com$/i.test(url.hostname)) {
      const page = url.searchParams.get("p");
      url.search = "";
      if (page && /^\d{1,5}$/.test(page)) url.searchParams.set("p", page);
    } else {
      // Signed media queries are private worker state. The opaque id sent next
      // to this display URL is the actual lookup key for probe/download.
      url.search = "";
    }
    // Query stripping is insufficient for CDNs that encode bearer material in
    // path segments (for example /token/VALUE/file.mp4 or ;sig=VALUE). Never
    // publish or persist those segments in reversible form.
    if (pathMayContainCredential(url.pathname)) return `${url.origin}/…`;
    return url.href;
  } catch {
    return "";
  }
}

function publicAlias(alias) {
  if (!alias || typeof alias !== "object") return null;
  const rawUrl = string(alias.url);
  const displayUrl = publicDisplayUrl(rawUrl);
  return {
    id: string(alias.id),
    displayUrl,
    urlIsRedacted: Boolean(rawUrl && displayUrl !== rawUrl),
    source: string(alias.source),
    manifestType: string(alias.manifestType) || null,
    width: numberOrNull(alias.width),
    height: numberOrNull(alias.height),
    manifestSize: Math.max(0, numberOrNull(alias.manifestSize) || 0)
  };
}

function publicTrack(track) {
  if (!track || typeof track !== "object") return null;
  return {
    id: string(track.id),
    role: track.role === "audio" ? "audio" : "video",
    mime: string(track.mime),
    bytes: Math.max(0, numberOrNull(track.bytes) || 0),
    bandwidth: Math.max(0, numberOrNull(track.bandwidth) || 0),
    width: numberOrNull(track.width),
    height: numberOrNull(track.height),
    codecs: string(track.codecs)
  };
}

function publicUrlForPersistence(value) {
  const rawUrl = string(value);
  try {
    const normalized = new URL(rawUrl);
    const displayUrl = publicDisplayUrl(rawUrl);
    return displayUrl && displayUrl === normalized.href ? displayUrl : null;
  } catch {
    return null;
  }
}

/**
 * Explicit PrivateCandidate -> PublicCandidate boundary. Adding a property to
 * the private worker model never exposes it to extension pages by default.
 */
export function candidateForUi(candidate, dashPair = null) {
  const aliases = Array.isArray(candidate?.aliases) ? candidate.aliases.map(publicAlias).filter(Boolean).slice(0, 400) : [];
  const preview = previewForUi(candidate);
  const rawUrl = string(candidate?.url);
  const displayUrl = publicDisplayUrl(rawUrl, { kind: candidate?.kind, site: candidate?.site });
  const urlIsRedacted = Boolean(rawUrl && displayUrl !== rawUrl);
  const direct = candidate?.kind === "video" || candidate?.kind === "audio";
  const result = {
    id: string(candidate?.id),
    generation: string(candidate?.generation),
    kind: string(candidate?.kind),
    displayUrl,
    urlIsRedacted,
    copyable: Boolean(direct && displayUrl && !urlIsRedacted),
    requiresRefresh: Boolean(urlIsRedacted || candidate?.kind === "dash_pair"),
    mime: string(candidate?.mime),
    ext: string(candidate?.ext),
    title: string(candidate?.title),
    displayTitle: string(candidate?.displayTitle),
    suggestedFilename: string(candidate?.suggestedFilename),
    pageTitle: string(candidate?.pageTitle),
    contentLength: Math.max(0, numberOrNull(candidate?.contentLength) || 0),
    manifestSize: numberOrNull(candidate?.manifestSize),
    rangeSupported: Boolean(candidate?.rangeSupported),
    width: numberOrNull(candidate?.width),
    height: numberOrNull(candidate?.height),
    duration: numberOrNull(candidate?.duration),
    codecs: string(candidate?.codecs),
    site: string(candidate?.site),
    confidence: numberOrNull(candidate?.confidence) || 0,
    source: string(candidate?.source),
    sources: strings(candidate?.sources),
    provenance: string(candidate?.provenance),
    sourceFilenames: strings(candidate?.sourceFilenames),
    thumbnailUrl: preview?.thumbnailUrl || null,
    thumbnailSource: preview?.thumbnailSource || null,
    thumbnailFrameId: preview?.thumbnailFrameId ?? null,
    thumbnailAt: preview?.thumbnailAt || null,
    thumbnailAllowedOrigins: preview?.thumbnailAllowedOrigins || [],
    thumbnailAdapterImageHosts: preview?.thumbnailAdapterImageHosts || [],
    manifestType: string(candidate?.manifestType) || null,
    manifestVariantCount: Math.max(0, numberOrNull(candidate?.manifestVariantCount) || 0),
    manifestAudioTrackCount: Math.max(0, numberOrNull(candidate?.manifestAudioTrackCount) || 0),
    manifestSubtitleTrackCount: Math.max(0, numberOrNull(candidate?.manifestSubtitleTrackCount) || 0),
    manifestProbeStatus: string(candidate?.manifestProbeStatus) || null,
    manifestInspectedAt: numberOrNull(candidate?.manifestInspectedAt),
    groupSize: Math.max(1, numberOrNull(candidate?.groupSize) || 1),
    aliases,
    firstSeen: numberOrNull(candidate?.firstSeen),
    lastSeen: numberOrNull(candidate?.lastSeen)
  };

  if (candidate?.kind !== "dash_pair") return result;
  const tracks = Array.isArray(dashPair?.tracks) ? dashPair.tracks.map(publicTrack).filter(Boolean).slice(0, 64) : [];
  return {
    ...result,
    tracks,
    videoTrackCount: Math.max(0, Number(dashPair?.videoTrackCount) || 0),
    audioTrackCount: Math.max(0, Number(dashPair?.audioTrackCount) || 0),
    available: Boolean(dashPair?.available),
    expiresAt: numberOrNull(dashPair?.expiresAt)
  };
}

/**
 * Explicit PrivateCandidate -> PersistedCandidate boundary. Volatile body
 * text, signed track arrays, captured headers and future debug fields are not
 * part of this schema.
 */
export function candidateForPersistence(candidate) {
  const rawUrl = string(candidate?.url);
  const displayUrl = publicDisplayUrl(rawUrl, { kind: candidate?.kind, site: candidate?.site });
  // A query-bearing media URL may contain a bearer token. It remains in the
  // worker's private in-memory model and is rediscovered after suspension,
  // rather than being written to storage.session in reversible form.
  if (!displayUrl || displayUrl !== rawUrl) return null;
  const safe = candidateForUi(candidate);
  const preview = previewForPersistence(candidate);
  return {
    id: safe.id,
    kind: safe.kind,
    url: displayUrl,
    mime: safe.mime,
    ext: safe.ext,
    title: safe.title,
    displayTitle: safe.displayTitle,
    suggestedFilename: safe.suggestedFilename,
    pageTitle: safe.pageTitle,
    contentLength: safe.contentLength,
    manifestSize: safe.manifestSize,
    rangeSupported: safe.rangeSupported,
    width: safe.width,
    height: safe.height,
    duration: safe.duration,
    codecs: safe.codecs,
    site: safe.site,
    confidence: safe.confidence,
    source: safe.source,
    sources: safe.sources,
    provenance: safe.provenance,
    sourceFilenames: safe.sourceFilenames,
    thumbnailUrl: preview?.thumbnailUrl || null,
    thumbnailSource: preview?.thumbnailSource || null,
    thumbnailFrameId: preview?.thumbnailFrameId ?? null,
    thumbnailAt: preview?.thumbnailAt || null,
    thumbnailAllowedOrigins: preview?.thumbnailAllowedOrigins || [],
    thumbnailAdapterImageHosts: preview?.thumbnailAdapterImageHosts || [],
    manifestType: safe.manifestType,
    manifestVariantCount: safe.manifestVariantCount,
    manifestAudioTrackCount: safe.manifestAudioTrackCount,
    manifestSubtitleTrackCount: safe.manifestSubtitleTrackCount,
    manifestProbeStatus: safe.manifestProbeStatus,
    manifestInspectedAt: safe.manifestInspectedAt,
    manifestReferences: strings(candidate?.manifestReferences, 400).map(publicUrlForPersistence).filter(Boolean),
    manifestRedirectUrl: publicUrlForPersistence(candidate?.manifestRedirectUrl),
    manifestFingerprint: string(candidate?.manifestFingerprint) || null,
    groupSize: safe.groupSize,
    aliases: safe.aliases,
    firstSeen: safe.firstSeen,
    lastSeen: safe.lastSeen
  };
}
