import { parseHls } from "./hls.js";

// Media-playlist track-type sniffing for rendition-style HLS players whose
// master playlist is never observed. Each media playlist is probed once and
// the boolean result (video / audio) lets the background group sibling
// renditions into a single quality card. Every failure mode resolves to null:
// an inconclusive probe must keep today's independent-card behaviour instead
// of hiding media from the user.
//
// probeFetch contract (implemented by the caller inside the service worker so
// every request keeps flowing through requireNetworkRequest + the captured
// browser-context headers):
//   probeFetch(url, { purpose, range }) -> {
//     ok: boolean,
//     status: number,
//     text: () => Promise<string>,
//     bytes: () => Promise<Uint8Array>
//   }
// `bytes()` reads at most HEAD_BYTES bytes and releases the body early.

export const HEAD_BYTES = 64 * 1024;

function boxTypeAt(bytes, offset) {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function boxLengthAt(bytes, offset, end) {
  if (offset + 8 > end) return 0;
  const size = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
  // size==1 marks a 64-bit largesize box; size==0 spans to EOF. Neither fits a
  // truncated 64 KB head read without more framing than we can trust here.
  if (size < 8 || offset + size > end) return 0;
  return size;
}

const CONTAINER_BOXES = new Set(["moov", "trak", "mdia"]);

function collectHandlerTypes(bytes, start, end, depth, out, budget) {
  let offset = start;
  while (offset + 8 <= end && budget.visited < 256) {
    budget.visited += 1;
    const type = boxTypeAt(bytes, offset);
    const length = boxLengthAt(bytes, offset, end);
    if (!length) break;
    if (type === "hdlr") {
      // version/flags (4) + pre_defined (4) precede handler_type inside the box.
      if (offset + 20 <= offset + length) {
        const handler = String.fromCharCode(
          bytes[offset + 16],
          bytes[offset + 17],
          bytes[offset + 18],
          bytes[offset + 19]
        );
        out.push(handler);
      }
    } else if (CONTAINER_BOXES.has(type) && depth < 3) {
      collectHandlerTypes(bytes, offset + 8, offset + length, depth + 1, out, budget);
    }
    offset += length;
  }
}

/** Parse one ISO-BMFF sample (init segment preferred) for track handlers. */
export function detectFmp4TrackTypes(bytes) {
  const handlers = [];
  collectHandlerTypes(bytes, 0, bytes.length, 0, handlers, { visited: 0 });
  if (!handlers.length) return null;
  const result = { video: false, audio: false };
  for (const handler of handlers) {
    if (handler === "vide") result.video = true;
    else if (handler === "soun") result.audio = true;
  }
  return result.video || result.audio ? result : null;
}

const TS_PACKET_BYTES = 188;

/** Sniff an MPEG-TS head: 0x47 sync grid + PES stream_id classes. */
export function detectMpegTsTrackTypes(bytes) {
  if (!bytes.length || bytes[0] !== 0x47) return null;
  const packets = Math.floor(bytes.length / TS_PACKET_BYTES);
  if (packets < 2) return null;
  // Two aligned sync bytes make misidentified payloads unlikely.
  if (bytes[TS_PACKET_BYTES] !== 0x47) return null;
  const strideHoldsThird = packets >= 3;
  if (strideHoldsThird && bytes[TS_PACKET_BYTES * 2] !== 0x47) return null;

  let sawVideo = false;
  let sawAudio = false;
  let pesPackets = 0;
  const limit = Math.min(packets, 128);
  for (let packet = 0; packet < limit; packet += 1) {
    const base = packet * TS_PACKET_BYTES;
    const payloadStart = base + 4;
    // Adaptation field: payload starts after its announced length.
    const adaptationControl = (bytes[base + 3] >> 4) & 0x3;
    let offset = payloadStart;
    if (adaptationControl === 0b00 || adaptationControl === 0b10) continue;
    if (adaptationControl === 0b11) {
      const adaptationLength = bytes[payloadStart];
      offset = payloadStart + 1 + adaptationLength;
    }
    if (!bytes[base + 1] || !(bytes[base + 1] & 0x40)) continue; // payload_unit_start only
    if (offset + 5 > base + TS_PACKET_BYTES) continue;
    if (bytes[offset] !== 0 || bytes[offset + 1] !== 0 || bytes[offset + 2] !== 1) continue;
    const streamId = bytes[offset + 3];
    pesPackets += 1;
    if (streamId >= 0xe0 && streamId <= 0xef) sawVideo = true;
    else if (streamId >= 0xc0 && streamId <= 0xdf) sawAudio = true;
  }
  if (!pesPackets) return null;
  if (!sawVideo && !sawAudio) return null;
  return { video: sawVideo, audio: sawAudio };
}

/**
 * Decide the track mix of one media playlist from its leading sample bytes.
 * Returns null for unknown container framings instead of guessing.
 */
export function detectTrackTypesFromBytes(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 16) return null;
  return detectFmp4TrackTypes(bytes) || detectMpegTsTrackTypes(bytes);
}

export function byteRangeToHeader(byteRange) {
  const raw = String(byteRange || "").trim();
  if (!raw) return null;
  const parts = raw.split("@", 2);
  const amount = Number.parseInt(parts[0], 10);
  const offset = parts.length === 2 ? Number.parseInt(parts[1], 10) : 0;
  if (!Number.isFinite(amount) || amount <= 0 || !Number.isFinite(offset) || offset < 0) return null;
  const lastByte = Math.min(offset + amount - 1, offset + HEAD_BYTES - 1);
  return `bytes=${offset}-${lastByte}`;
}

export function firstSampleResource(playlistText, manifestUrl) {
  let parsed;
  try {
    parsed = parseHls(playlistText, manifestUrl);
  } catch {
    return null;
  }
  if (parsed.type !== "media" || !parsed.segments.length) return null;
  const segment = parsed.segments[0];
  const resourceUrl = canonicalResourceUrl(segment.initMap?.url || segment.url);
  if (!resourceUrl) return null;
  const range = byteRangeToHeader(segment.initMap?.byteRange || segment.byteRange);
  return { url: resourceUrl, range };
}

function canonicalResourceUrl(value) {
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.href;
  } catch {
    return "";
  }
}

async function readLimitedBytes(response, limit) {
  const reader = typeof response.body?.getReader === "function" ? response.body.getReader() : null;
  if (!reader) {
    const buffer = await response.arrayBuffer();
    return new Uint8Array(buffer.byteLength > limit ? buffer.slice(0, limit) : buffer);
  }
  try {
    const collected = [];
    let received = 0;
    while (received < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      collected.push(value);
      received += value.byteLength;
    }
    if (received > limit) {
      // Trim an oversized final chunk after releasing the body reader.
      const merged = mergeChunks(collected, limit);
      await safelyCancel(reader);
      return merged;
    }
    return mergeChunks(collected, limit);
  } finally {
    reader.releaseLock?.();
  }
}

function mergeChunks(chunks, limit) {
  const total = Math.min(limit, chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0));
  const merged = new Uint8Array(total);
  let filled = 0;
  for (const chunk of chunks) {
    if (filled >= total) break;
    const view = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
    merged.set(view.subarray(0, Math.min(view.byteLength, total - filled)), filled);
    filled += view.byteLength;
  }
  return merged;
}

async function safelyCancel(reader) {
  try {
    await reader.cancel();
  } catch {
    // Bodies may already be detached; aborting stays best-effort.
  }
}

/**
 * Probe whether one media playlist carries video, audio, or both.
 * Never throws: any network/parse/format problem returns null so callers can
 * fall back to showing the candidate exactly as before.
 */
export async function probeHlsTrackTypes(candidate, probeFetch) {
  try {
    if (typeof probeFetch !== "function") return null;
    const playlistUrl = canonicalResourceUrl(candidate?.url);
    if (!playlistUrl) return null;
    const cachedText = typeof candidate?.manifestText === "string"
      && candidate.manifestText.startsWith("#EXTM3U")
      ? candidate.manifestText
      : null;
    let response;
    if (cachedText !== null) {
      response = { ok: true, status: 200, text: async () => cachedText, bytes: async () => new Uint8Array() };
    } else {
      response = await probeFetch(playlistUrl, { purpose: "manifest_probe", range: null });
      if (!response?.ok) return null;
    }
    const playlistText = await response.text();
    const resource = firstSampleResource(playlistText, playlistUrl);
    if (!resource) return null;
    const sampleResponse = await probeFetch(resource.url, { purpose: "manifest_child", range: resource.range });
    if (!sampleResponse?.ok) return null;
    return detectTrackTypesFromBytes(await sampleResponse.bytes());
  } catch {
    return null;
  }
}
