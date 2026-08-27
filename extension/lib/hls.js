import { parseAttributeList, resolveUrl } from "./media.js";

export const HLS_LIMITS = Object.freeze({
  textChars: 4 * 1024 * 1024,
  lines: 20_000,
  variants: 512,
  mediaTracks: 512,
  segments: 10_000,
  keys: 256,
  referencedUrlChars: 4 * 1024 * 1024
});

function hlsLimitError(kind) {
  throw new Error(`HLS 播放列表超过${kind}上限`);
}

export function parseHls(text, manifestUrl) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  if (source.length > HLS_LIMITS.textChars) hlsLimitError("文本大小");
  const rawLines = source.split(/\r?\n/);
  if (rawLines.length > HLS_LIMITS.lines) hlsLimitError("行数");
  const lines = rawLines.map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("这不是有效的 HLS 播放列表");

  const variants = [];
  const audioTracks = [];
  const subtitleTracks = [];
  const segments = [];
  const keys = [];
  let pendingStream = null;
  let pendingDuration = null;
  let byteRange = null;
  let initMap = null;
  let encrypted = false;
  let protection = "clear";
  let live = true;
  let discontinuity = false;
  let targetDuration = null;
  let referencedUrlChars = 0;

  const reference = (value) => {
    const url = resolveUrl(value, manifestUrl);
    if (!url) return "";
    referencedUrlChars += url.length;
    if (referencedUrlChars > HLS_LIMITS.referencedUrlChars) hlsLimitError("引用 URL 总长度");
    return url;
  };

  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingStream = parseAttributeList(line.slice(line.indexOf(":") + 1));
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attrs = parseAttributeList(line.slice(line.indexOf(":") + 1));
      if (attrs.URI) {
        const track = { ...attrs, url: reference(attrs.URI) };
        if (attrs.TYPE === "AUDIO") audioTracks.push(track);
        if (attrs.TYPE === "SUBTITLES" || attrs.TYPE === "CLOSED-CAPTIONS") subtitleTracks.push(track);
        if (audioTracks.length + subtitleTracks.length > HLS_LIMITS.mediaTracks) hlsLimitError("媒体轨道数量");
      }
      continue;
    }
    if (line.startsWith("#EXTINF:")) {
      pendingDuration = Number.parseFloat(line.slice(8).split(",", 1)[0]);
      continue;
    }
    if (line.startsWith("#EXT-X-BYTERANGE:")) {
      byteRange = line.slice(line.indexOf(":") + 1);
      continue;
    }
    if (line.startsWith("#EXT-X-MAP:")) {
      const attrs = parseAttributeList(line.slice(line.indexOf(":") + 1));
      initMap = { url: reference(attrs.URI), byteRange: attrs.BYTERANGE || null };
      continue;
    }
    if (line.startsWith("#EXT-X-KEY:")) {
      const attrs = parseAttributeList(line.slice(line.indexOf(":") + 1));
      const method = String(attrs.METHOD || "").toUpperCase();
      if (method && method !== "NONE") {
        encrypted = true;
        const keyFormat = (attrs.KEYFORMAT || "identity").toLowerCase();
        // Once any DRM/SAMPLE-AES key is observed, a later clear/AES-128
        // period must not downgrade the playlist-wide protection result.
        if (method !== "AES-128" || keyFormat !== "identity") protection = "drm";
        else if (protection !== "drm") protection = "aes128";
        if (attrs.URI) {
          keys.push({ method, keyFormat, url: reference(attrs.URI) });
          if (keys.length > HLS_LIMITS.keys) hlsLimitError("密钥引用数量");
        }
      }
      continue;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = Number.parseFloat(line.slice(line.indexOf(":") + 1));
      continue;
    }
    if (line === "#EXT-X-DISCONTINUITY") {
      discontinuity = true;
      continue;
    }
    if (line === "#EXT-X-ENDLIST") {
      live = false;
      continue;
    }
    if (line.startsWith("#")) continue;

    const url = reference(line);
    if (!url) continue;
    if (pendingStream) {
      const resolution = (pendingStream.RESOLUTION || "").split("x").map(Number);
      variants.push({
        url,
        bandwidth: Number(pendingStream.BANDWIDTH || pendingStream["AVERAGE-BANDWIDTH"] || 0),
        width: resolution[0] || null,
        height: resolution[1] || null,
        codecs: pendingStream.CODECS || "",
        frameRate: Number(pendingStream["FRAME-RATE"] || 0) || null,
        audioGroup: pendingStream.AUDIO || null,
        name: pendingStream.NAME || null,
        raw: pendingStream
      });
      if (variants.length > HLS_LIMITS.variants) hlsLimitError("变体数量");
      pendingStream = null;
    } else {
      segments.push({ url, duration: pendingDuration, byteRange, initMap });
      if (segments.length > HLS_LIMITS.segments) hlsLimitError("分片数量");
      pendingDuration = null;
      byteRange = null;
    }
  }

  return {
    type: variants.length ? "master" : "media",
    variants,
    audioTracks,
    subtitleTracks,
    segments,
    keys,
    encrypted,
    protection,
    live,
    discontinuity,
    targetDuration
  };
}

export function sortHlsVariants(variants) {
  return [...variants].sort((a, b) =>
    (b.height || 0) - (a.height || 0) ||
    (b.bandwidth || 0) - (a.bandwidth || 0) ||
    (b.frameRate || 0) - (a.frameRate || 0)
  );
}
