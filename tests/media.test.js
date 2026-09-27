import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalizeUrl,
  classifyBilibiliDashTrack,
  classifyMedia,
  filenameFromCandidate,
  getExtension,
  isBilibiliMediaUrl,
  isBilibiliVideoPage,
  isInstagramByteRangeFragment,
  isLikelySubtitleResource,
  parseAttributeList,
  sanitizeFilename
} from "../extension/lib/media.js";
import { HLS_LIMITS, parseHls, sortHlsVariants } from "../extension/lib/hls.js";
import { parseDash } from "../extension/lib/dash.js";

test("classifies manifests from URL and MIME", () => {
  assert.equal(classifyMedia({ url: "https://cdn.test/master.m3u8?token=x" }).kind, "hls");
  assert.equal(classifyMedia({ url: "https://cdn.test/manifest", mime: "application/dash+xml; charset=utf-8" }).kind, "dash");
  assert.equal(getExtension("https://cdn.test/a/video.MP4?q=1"), "mp4");
});

test("suppresses caption and text-track resources, including HLS-shaped endpoints", () => {
  assert.equal(classifyMedia({
    url: "https://fast.wistia.net/embed/captions/77994wpv0p.m3u8?language=eng",
    mime: "application/vnd.apple.mpegurl"
  }), null);
  assert.equal(classifyMedia({ url: "https://cdn.test/tracks/en.vtt", mime: "text/vtt", resourceType: "media" }), null);
  assert.equal(isLikelySubtitleResource({ url: "https://cdn.test/movie.m3u8?kind=subtitles" }), true);
  assert.equal(
    classifyMedia({ url: "https://cdn.test/deliveries/a-real-captions-documentary-1080.m3u8" })?.kind,
    "hls",
    "a loose word inside a media filename is not treated as a caption path"
  );
});

test("classifies direct media and suppresses tiny segment rows", () => {
  assert.equal(classifyMedia({ url: "https://cdn.test/movie", mime: "video/mp4", resourceType: "media" }).kind, "video");
  assert.equal(classifyMedia({ url: "https://cdn.test/audio.m4a", mime: "audio/mp4" }).kind, "audio");
  assert.equal(classifyMedia({ url: "https://cdn.test/chunk-00012.m4s", mime: "video/iso.segment", contentLength: 12345 }).kind, "segment");
  assert.equal(classifyMedia({ url: "https://cdn.test/12345.m4s", mime: "video/iso.segment", contentLength: 12345 }).kind, "segment");
  assert.equal(classifyMedia({ url: "https://cdn.test/fileSequence0.ts", mime: "video/mp2t", resourceType: "xmlhttprequest", contentLength: 12345 }).kind, "segment");
  assert.equal(classifyMedia({ url: "https://cdn.test/app.js", mime: "text/javascript" }), null);
});

test("suppresses Instagram query-range MP4 fragments without hiding full CDN assets", () => {
  const full = "https://scontent-lax7-1.cdninstagram.com/o1/v/t2/f2/m367/fixture.mp4?efg=SIGNED_VALUE&oe=67FFFFFF";
  const ranged = `${full}&bytestart=1588937&byteend=4876523`;
  const fbRanged = "https://video-lax3-2.xx.fbcdn.net/v/t42.1790-2/fixture.mp4?byteend=999999&bytestart=500000";

  assert.equal(isInstagramByteRangeFragment(ranged), true);
  assert.equal(classifyMedia({ url: ranged, mime: "video/mp4", resourceType: "media", contentLength: 3_287_587 })?.kind, "segment");
  assert.equal(classifyMedia({ url: fbRanged, mime: "video/mp4", resourceType: "xmlhttprequest", contentLength: 500_000 })?.kind, "segment");
  assert.equal(classifyMedia({ url: full, mime: "video/mp4", resourceType: "media", contentLength: 9_000_000 })?.kind, "video");
  assert.equal(
    classifyMedia({ url: `${full}&bytestart=0`, mime: "video/mp4", resourceType: "media" })?.kind,
    "video",
    "an ordinary full URL is not hidden when the complete query-range pair is absent"
  );
  assert.equal(
    classifyMedia({ url: "https://media.example.test/fixture.mp4?bytestart=0&byteend=999", mime: "video/mp4", resourceType: "media" })?.kind,
    "video",
    "the special query semantics are scoped to Meta media CDNs"
  );
});

test("recognizes only trusted Bilibili DASH tracks while generic m4s stays suppressed", () => {
  const videoUrl = "https://upos-sz-mirrorcoso1.edge.mountaintoys.cn:4483/v1/resource/upgcxcode/12/34/41067939286-1-30032.m4s?deadline=1999999999&upsig=VIDEO_SECRET";
  const audioUrl = "https://upos-sz-mirror08c.bilivideo.com/upgcxcode/12/34/41067939286-1-30280.m4s?deadline=1999999999&upsig=AUDIO_SECRET";
  assert.equal(isBilibiliVideoPage("https://www.bilibili.com/video/BV14N8G6pEAf/?spm_id_from=333.1"), true);
  assert.equal(isBilibiliVideoPage("https://www.bilibili.com/bangumi/play/ep123456"), false, "unsupported bangumi routes stay out of the adapter surface");
  assert.equal(isBilibiliVideoPage("https://space.bilibili.com/123"), false);
  assert.equal(isBilibiliMediaUrl(videoUrl), true, "partner CDN is limited to Bilibili's upgcxcode object shape");
  assert.equal(isBilibiliMediaUrl("https://cdn.mountaintoys.cn/unrelated/41067939286-1-30032.m4s"), false);

  const video = classifyBilibiliDashTrack({ url: videoUrl, mime: "video/mp4", contentLength: 5_000_000 });
  const audio = classifyBilibiliDashTrack({ url: audioUrl, mime: "audio/mp4", contentLength: 800_000 });
  assert.equal(video?.trackType, "video");
  assert.equal(video?.height, 480);
  assert.equal(video?.representationId, "30032");
  assert.equal(audio?.trackType, "audio");
  assert.equal(video?.assetFamily, audio?.assetFamily);
  assert.equal(video?.assetFamily, "/upgcxcode/12/34/41067939286-1-{track}", "family keeps the stable upgcxcode directory context across CDN prefixes");
  const sameTailDifferentDirectory = classifyBilibiliDashTrack({
    url: "https://upos-sz-mirror08c.bilivideo.com/upgcxcode/98/76/41067939286-1-30280.m4s?upsig=OTHER_ASSET",
    mime: "audio/mp4"
  });
  assert.notEqual(video?.assetFamily, sameTailDifferentDirectory?.assetFamily, "equal basenames in different object directories are not one asset family");
  const samePathDifferentHost = classifyBilibiliDashTrack({
    url: "https://another.bilivideo.com/v1/resource/upgcxcode/12/34/41067939286-1-30032.m4s?upsig=ROTATED_HOST",
    mime: "video/mp4"
  });
  assert.notEqual(video?.trackId, samePathDifferentHost?.trackId, "opaque selectors distinguish identical paths on different CDN hosts");
  assert.doesNotMatch(video?.trackId || "", /upgcxcode|deadline|upsig|VIDEO_SECRET/);
  assert.doesNotMatch(video?.identity || "", /deadline|upsig|VIDEO_SECRET/);
  assert.equal(classifyBilibiliDashTrack({ url: audioUrl, mime: "video/mp4" }), null, "MIME/representation role conflicts fail closed");
  assert.equal(classifyBilibiliDashTrack({ url: "https://cdn.test/41067939286-1-30032.m4s", mime: "video/mp4" }), null);
  assert.equal(classifyMedia({ url: "https://cdn.test/12345.m4s", mime: "video/iso.segment" })?.kind, "segment");
});

test("URL and filename normalization", () => {
  assert.equal(canonicalizeUrl("https://example.test/a.mp4#frag"), "https://example.test/a.mp4");
  assert.equal(canonicalizeUrl("file:///tmp/a"), null);
  assert.equal(canonicalizeUrl("https://user:secret@example.test/a.mp4"), null);
  assert.equal(canonicalizeUrl(`https://example.test/${"a".repeat(17_000)}.mp4`), null);
  assert.equal(sanitizeFilename('../bad:movie?.mp4'), "_bad_movie_.mp4");
  assert.equal(filenameFromCandidate({ url: "https://cdn.test/path/movie.webm", kind: "video", ext: "webm" }, "Page"), "movie.webm");
  assert.equal(filenameFromCandidate({ url: "https://cdn.test/path/id", kind: "video", ext: "mp4", suggestedFilename: "My Movie.mp4" }, "Page"), "My Movie.mp4");
});

test("attribute parser preserves quoted commas", () => {
  const attrs = parseAttributeList('BANDWIDTH=800000,CODECS="avc1.4d401f,mp4a.40.2",NAME="HD"');
  assert.equal(attrs.BANDWIDTH, "800000");
  assert.equal(attrs.CODECS, "avc1.4d401f,mp4a.40.2");
  assert.equal(attrs.NAME, "HD");
});

test("parses and sorts HLS master playlists", () => {
  const parsed = parseHls(`#EXTM3U
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="a",NAME="English",URI="audio/en.m3u8"
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="s",NAME="English CC",LANGUAGE="eng",URI="captions/en.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2",AUDIO="a"
v720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4200000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2",AUDIO="a"
v1080/index.m3u8`, "https://cdn.test/master.m3u8");
  assert.equal(parsed.type, "master");
  assert.equal(parsed.audioTracks[0].url, "https://cdn.test/audio/en.m3u8");
  assert.equal(parsed.subtitleTracks[0].url, "https://cdn.test/captions/en.m3u8");
  assert.equal(parsed.subtitleTracks[0].LANGUAGE, "eng");
  assert.equal(sortHlsVariants(parsed.variants)[0].height, 1080);
});

test("parses HLS VOD metadata, byte ranges and encryption", () => {
  const parsed = parseHls(`#EXTM3U
#EXT-X-TARGETDURATION:6
#EXT-X-MAP:URI="init.mp4",BYTERANGE="1000@0"
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXT-X-DISCONTINUITY
#EXTINF:6.0,
#EXT-X-BYTERANGE:100@1000
media.m4s
#EXT-X-ENDLIST`, "https://cdn.test/v/index.m3u8");
  assert.equal(parsed.type, "media");
  assert.equal(parsed.live, false);
  assert.equal(parsed.encrypted, true);
  assert.equal(parsed.discontinuity, true);
  assert.equal(parsed.segments[0].byteRange, "100@1000");
  assert.equal(parsed.segments[0].initMap.url, "https://cdn.test/v/init.mp4");

  const mixed = parseHls(`#EXTM3U
#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://key"
#EXTINF:6,
one.ts
#EXT-X-KEY:METHOD=AES-128,URI="key.bin"
#EXTINF:6,
two.ts`, "https://cdn.test/v/index.m3u8");
  assert.equal(mixed.protection, "drm");
});

test("HLS parser rejects structurally amplified manifests", () => {
  const tooManySegments = [
    "#EXTM3U",
    ...Array.from({ length: HLS_LIMITS.segments + 1 }, (_, index) => `segment-${index}.ts`)
  ].join("\n");
  assert.throws(
    () => parseHls(tooManySegments, "https://media.example/master.m3u8"),
    /分片数量上限/
  );

  const tooManyVariants = ["#EXTM3U"];
  for (let index = 0; index <= HLS_LIMITS.variants; index += 1) {
    tooManyVariants.push("#EXT-X-STREAM-INF:BANDWIDTH=1", `variant-${index}.m3u8`);
  }
  assert.throws(
    () => parseHls(tooManyVariants.join("\n"), "https://media.example/master.m3u8"),
    /变体数量上限/
  );
});

test("portable DASH parser extracts representations", () => {
  const parsed = parseDash(`<?xml version="1.0"?><MPD type="static"><Period><AdaptationSet mimeType="video/mp4"><Representation id="v1" mimeType="video/mp4" codecs="avc1.4d401f" bandwidth="2200000" width="1280" height="720"><BaseURL>video.mp4</BaseURL></Representation></AdaptationSet></Period></MPD>`, "https://cdn.test/manifest.mpd");
  assert.equal(parsed.type, "static");
  assert.equal(parsed.representations.length, 1);
  assert.equal(parsed.representations[0].index, 0);
  assert.equal(parsed.representations[0].height, 720);
  assert.equal(parsed.representations[0].url, "https://cdn.test/video.mp4");
});
