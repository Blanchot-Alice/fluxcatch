import test from "node:test";
import assert from "node:assert/strict";

import {
  byteRangeToHeader,
  detectFmp4TrackTypes,
  detectMpegTsTrackTypes,
  detectTrackTypesFromBytes,
  firstSampleResource,
  probeHlsTrackTypes
} from "../extension/lib/hls-probe.js";

function box(type, payload) {
  const size = 8 + payload.length;
  const bytes = new Uint8Array(size);
  bytes[0] = (size >>> 24) & 0xff;
  bytes[1] = (size >>> 16) & 0xff;
  bytes[2] = (size >>> 8) & 0xff;
  bytes[3] = size & 0xff;
  for (let index = 0; index < 4; index += 1) bytes[4 + index] = type.charCodeAt(index);
  bytes.set(payload, 8);
  return bytes;
}

function concat(...parts) {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.length;
  }
  return merged;
}

function hdlrBox(handlerType) {
  // FullBox version/flags (4) + pre_defined (4) + handler_type (4).
  return box("hdlr", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, ...handlerType.split("").map((char) => char.charCodeAt(0)), 0, 0, 0, 0]));
}

function fmp4Init(handlerTypes) {
  const moovChildren = handlerTypes.map((handlerType) =>
    box("trak", box("mdia", concat(box("mdhd", new Uint8Array(24)), hdlrBox(handlerType))))
  );
  return concat(
    box("ftyp", new Uint8Array([0x6d, 0x70, 0x34, 0x32, 0, 0, 0, 0])),
    box("moov", concat(...moovChildren))
  );
}

function tsPacket(pesStreamId, { withAdaptation = false } = {}) {
  const packet = new Uint8Array(188);
  packet[0] = 0x47;
  packet[1] = 0x41; // PUSI set
  packet[2] = 0x00;
  packet[3] = withAdaptation ? 0x30 : 0x10; // payload only, AFC bits
  let payloadOffset = 4;
  if (withAdaptation) {
    packet[4] = 7; // adaptation field length
    payloadOffset = 5 + 7;
  }
  packet[payloadOffset] = 0;
  packet[payloadOffset + 1] = 0;
  packet[payloadOffset + 2] = 1;
  packet[payloadOffset + 3] = pesStreamId;
  for (let index = payloadOffset + 4; index < 188; index += 1) packet[index] = index & 0xff;
  return packet;
}

const videoTsPacket = tsPacket(0xe0);
const audioTsPacket = tsPacket(0xc0);

test("fMP4 init segments expose their track handlers", () => {
  assert.deepEqual(detectFmp4TrackTypes(fmp4Init(["vide"])), { video: true, audio: false });
  assert.deepEqual(detectFmp4InitSoun(), { video: false, audio: true });
  function detectFmp4InitSoun() {
    return detectFmp4TrackTypes(fmp4Init(["soun"]));
  }
  assert.deepEqual(detectFmp4TrackTypes(fmp4Init(["vide", "soun"])), { video: true, audio: true });
});

test("MPEG-TS packets classify PES stream ids", () => {
  assert.deepEqual(detectMpegTsTrackTypes(concat(videoTsPacket, videoTsPacket)), { video: true, audio: false });
  assert.deepEqual(detectMpegTsTrackTypes(concat(audioTsPacket, audioTsPacket)), { video: false, audio: true });
  assert.deepEqual(detectMpegTsTrackTypes(concat(videoTsPacket, audioTsPacket, tsPacket(0xbd))), { video: true, audio: true });
  assert.equal(detectMpegTsTrackTypes(new Uint8Array([0x47, ...new Array(187).fill(1)])), null,
    "a single packet has no confirmable sync grid");
  assert.equal(detectMpegTsTrackTypes(new Uint8Array(376)), null,
    "sync-aligned zero bytes contain no PES headers");
  const brokenStride = concat(videoTsPacket, tsPacket(0xc0));
  brokenStride[188] = 0x46;
  assert.equal(detectMpegTsTrackTypes(brokenStride), null);
});

test("unknown or damaged bytes fail closed to null instead of guessing", () => {
  assert.equal(detectTrackTypesFromBytes(new Uint8Array(8)), null);
  assert.equal(detectTrackTypesFromBytes(null), null);
  assert.equal(detectTrackTypesFromBytes(new TextEncoder().encode("just some text that is long enough!!")), null);
  const truncatedMoov = concat(box("ftyp", new Uint8Array(8)), box("moov", new Uint8Array(20)));
  assert.equal(detectTrackTypesFromBytes(truncatedMoov), null, "truncated containers never fabricate handlers");
  // A TS packet wrapped inside an unknown top-level box must not be classified.
  assert.equal(detectTrackTypesFromBytes(concat(videoTsPacket, videoTsPacket).reverse().subarray(2)), null);
});

function fakeProbeFetch(routes) {
  return async (url) => {
    const route = routes.get(url);
    if (!route) throw new Error(`fixture missing for ${url}`);
    if (route.error === "http") return { ok: false, status: 503, text: async () => "", bytes: async () => new Uint8Array() };
    const payload = route.bytes || route.rangeBody || new Uint8Array();
    return {
      ok: true,
      status: route.rangeBody ? 206 : 200,
      text: async () => route.text || "",
      bytes: async () => payload
    };
  };
}

const PLAYLIST_720_URL = "https://boomi.example.test/hls/eiaj/720.m3u8";
const INIT_VIDEO_URL = "https://boomi.example.test/hls/eiaj/init-720.m4s";

const fmp4Playlist = [
  "#EXTM3U",
  "#EXT-X-TARGETDURATION:4",
  `#EXT-X-MAP:URI="${INIT_VIDEO_URL}"`,
  "#EXTINF:4,",
  "https://boomi.example.test/hls/eiaj/seg-720-0.m4s",
  "#EXT-X-ENDLIST"
].join("\n");

test("probeHlsTrackTypes reads the init segment and returns its hints", async () => {
  const initBytes = fmp4Init(["vide"]);
  const fetcher = fakeProbeFetch(new Map([
    [PLAYLIST_720_URL, { text: fmp4Playlist }],
    [INIT_VIDEO_URL, { rangeBody: initBytes }]
  ]));
  assert.deepEqual(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, fetcher), { video: true, audio: false });
});

test("probeHlsTrackTypes falls back to the first segment without an EXT-X-MAP", async () => {
  const segmentUrl = "https://ts.example.test/live/media-0.ts";
  const playlistText = ["#EXTM3U", "#EXTINF:4,", segmentUrl, "#EXT-X-ENDLIST"].join("\n");
  const fetcher = fakeProbeFetch(new Map([
    [PLAYLIST_720_URL, { text: playlistText }],
    [segmentUrl, { rangeBody: concat(audioTsPacket, audioTsPacket, audioTsPacket) }]
  ]));
  assert.deepEqual(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, fetcher), { video: false, audio: true });
});

test("probeHlsTrackTypes reuses cached manifest text without a second playlist request", async () => {
  let playlistRequests = 0;
  const fetcher = async (url) => {
    if (url === PLAYLIST_720_URL) {
      playlistRequests += 1;
      return { ok: true, status: 200, text: async () => fmp4Playlist, bytes: async () => new Uint8Array() };
    }
    if (url === INIT_VIDEO_URL) {
      return { ok: true, status: 206, text: async () => "", bytes: async () => fmp4Init(["soun"]) };
    }
    throw new Error(`unexpected url ${url}`);
  };
  assert.deepEqual(
    await probeHlsTrackTypes({ url: PLAYLIST_720_URL, manifestText: fmp4Playlist }, fetcher),
    { video: false, audio: true }
  );
  assert.equal(playlistRequests, 0);
});

test("probeHlsTrackTypes fails open on empty playlists, bad media and network errors", async () => {
  const emptyFetcher = fakeProbeFetch(new Map([[PLAYLIST_720_URL, { text: "" }]]));
  assert.equal(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, emptyFetcher), null);

  const masterFetcher = fakeProbeFetch(new Map([
    [PLAYLIST_720_URL, { text: ["#EXTM3U", "#EXT-X-STREAM-INF:BANDWIDTH=1", "child.m3u8"].join("\n") }]
  ]));
  assert.equal(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, masterFetcher), null,
    "master playlists are not samples and stay inconclusive");

  const badBytesFetcher = fakeProbeFetch(new Map([
    [PLAYLIST_720_URL, { text: fmp4Playlist }],
    [INIT_VIDEO_URL, { rangeBody: new Uint8Array(Array.from({ length: 96 }, (_, index) => (index * 31) & 0xff)) }]
  ]));
  assert.equal(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, badBytesFetcher), null);

  const httpErrorFetcher = fakeProbeFetch(new Map([
    [PLAYLIST_720_URL, { error: "http" }],
    [INIT_VIDEO_URL, { rangeBody: fmp4Init(["vide"]) }]
  ]));
  assert.equal(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, httpErrorFetcher), null);

  const throwingFetcher = async () => {
    throw new Error("offline");
  };
  assert.equal(await probeHlsTrackTypes({ url: PLAYLIST_720_URL }, throwingFetcher), null);
  assert.equal(await probeHlsTrackTypes({ url: "not a url" }, fakeProbeFetch(new Map())), null);
  assert.equal(await probeHlsTrackTypes(null, null), null);
});

test("byte ranges convert to bounded Range headers and reject malformed values", () => {
  assert.equal(byteRangeToHeader(""), null);
  assert.equal(byteRangeToHeader(null), null);
  assert.equal(byteRangeToHeader("4@0"), "bytes=0-3");
  assert.equal(byteRangeToHeader("999999"), "bytes=0-65535", "oversized bare ranges clamp at the head limit");
  assert.equal(byteRangeToHeader("10@1000000"), "bytes=1000000-1000009");
  assert.equal(byteRangeToHeader("-4@0"), null);
});

test("firstSampleResource prefers the EXT-X-MAP target over data segments", () => {
  const resource = firstSampleResource(fmp4Playlist, PLAYLIST_720_URL);
  assert.deepEqual(resource, { url: INIT_VIDEO_URL, range: null });
  const byterangeResource = firstSampleResource(
    [
      "#EXTM3U",
      "#EXTINF:4,",
      "#EXT-X-MAP:URI=\"init.m4s\",BYTERANGE=800@4096",
      "https://cdn.example.test/live/media-0.ts",
      "#EXT-X-ENDLIST"
    ].join("\n"),
    "https://cdn.example.test/live/media.m3u8"
  );
  assert.deepEqual(byterangeResource, { url: "https://cdn.example.test/live/init.m4s", range: "bytes=4096-4895" });
});
