import { parseAttributeList, resolveUrl } from "./media.js";

export function parseHls(text, manifestUrl) {
  const source = String(text || "").replace(/^\uFEFF/, "");
  const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines[0] !== "#EXTM3U") throw new Error("这不是有效的 HLS 播放列表");

  const variants = [];
  const audioTracks = [];
  const subtitleTracks = [];
  const segments = [];
  let pendingStream = null;
  let pendingDuration = null;
  let byteRange = null;
  let initMap = null;
  let encrypted = false;
  let protection = "clear";
  let live = true;
  let targetDuration = null;

  for (const line of lines.slice(1)) {
    if (line.startsWith("#EXT-X-STREAM-INF:")) {
      pendingStream = parseAttributeList(line.slice(line.indexOf(":") + 1));
      continue;
    }
    if (line.startsWith("#EXT-X-MEDIA:")) {
      const attrs = parseAttributeList(line.slice(line.indexOf(":") + 1));
      if (attrs.URI) {
        const track = { ...attrs, url: resolveUrl(attrs.URI, manifestUrl) };
        if (attrs.TYPE === "AUDIO") audioTracks.push(track);
        if (attrs.TYPE === "SUBTITLES" || attrs.TYPE === "CLOSED-CAPTIONS") subtitleTracks.push(track);
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
      initMap = { url: resolveUrl(attrs.URI, manifestUrl), byteRange: attrs.BYTERANGE || null };
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
      }
      continue;
    }
    if (line.startsWith("#EXT-X-TARGETDURATION:")) {
      targetDuration = Number.parseFloat(line.slice(line.indexOf(":") + 1));
      continue;
    }
    if (line === "#EXT-X-ENDLIST") {
      live = false;
      continue;
    }
    if (line.startsWith("#")) continue;

    const url = resolveUrl(line, manifestUrl);
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
      pendingStream = null;
    } else {
      segments.push({ url, duration: pendingDuration, byteRange, initMap });
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
    encrypted,
    protection,
    live,
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
