import test from "node:test";
import assert from "node:assert/strict";
import { parseDash } from "../extension/lib/dash.js";

// Node has no DOMParser, exactly like the MV3 service worker, so these tests
// exercise the parser path that runs in production.

const TEMPLATE_MPD = `<?xml version="1.0" encoding="UTF-8"?>
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" profiles="urn:mpeg:dash:profile:isoff-live:2011" type="static" mediaPresentationDuration="PT634.566S" minBufferTime="PT2.0S">
  <!-- Comments must not confuse the scanner -->
  <Period>
    <AdaptationSet mimeType="video/mp4" segmentAlignment="true" startWithSAP="1" maxWidth="3840" maxHeight="2160">
      <SegmentTemplate timescale="30000" duration="60000" media="$RepresentationID$/$RepresentationID$_$Number$.m4v" startNumber="1" initialization="$RepresentationID$/$RepresentationID$_0.m4v"/>
      <Representation id="v576" codecs="avc1.64001f" bandwidth="3134488" width="1024" height="576" frameRate="30" sar="1:1" scanType="progressive"/>
      <Representation id="v1080" codecs="avc1.640028" bandwidth="9914554" width="1920" height="1080" frameRate="30" sar="1:1" scanType="progressive"/>
      <Representation id="v180" codecs="avc1.64000d" bandwidth="254320" width="320" height="180" frameRate="30" sar="1:1" scanType="progressive"/>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4" segmentAlignment="true" startWithSAP="1">
      <SegmentTemplate timescale="48000" duration="96000" media="$RepresentationID$/$RepresentationID$_$Number$.m4a" startNumber="1" initialization="$RepresentationID$/$RepresentationID$_0.m4a"/>
      <Representation id="a64k" codecs="mp4a.40.5" bandwidth="67071" audioSamplingRate="48000">
        <AudioChannelConfiguration schemeIdUri="urn:mpeg:dash:23003:3:audio_channel_configuration:2011" value="2"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

const WHOLE_OBJECT_MPD = `<MPD xmlns="urn:mpeg:dash:schema:mpd:2011" type="static" mediaPresentationDuration="PT2S">
  <BaseURL>https://cdn.example.test/root/</BaseURL>
  <Period>
    <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f">
      <BaseURL>video/</BaseURL>
      <Representation id="hi" bandwidth="5000000" width="1920" height="1080"><BaseURL>v1080.m4s</BaseURL></Representation>
      <Representation id="lo" bandwidth="2500000" width="1280" height="720"><BaseURL>v720.m4s</BaseURL></Representation>
    </AdaptationSet>
    <AdaptationSet mimeType="audio/mp4">
      <Representation id="aud" bandwidth="128000"><BaseURL>audio.m4s</BaseURL><AudioChannelConfiguration schemeIdUri="x" value="2"/></Representation>
    </AdaptationSet>
  </Period>
</MPD>`;

test("portable DASH parser keeps every self-closing Representation with inherited mime and duration", () => {
  const out = parseDash(TEMPLATE_MPD, "https://dash.example.test/bbb/manifest.mpd");
  assert.equal(out.type, "static");
  assert.equal(out.duration, "PT634.566S");
  assert.equal(out.protected, false);
  assert.deepEqual(out.representations.map((item) => [item.index, item.id, item.mime, item.height, item.codecs, item.url]), [
    [0, "v576", "video/mp4", 576, "avc1.64001f", null],
    [1, "v1080", "video/mp4", 1080, "avc1.640028", null],
    [2, "v180", "video/mp4", 180, "avc1.64000d", null],
    [3, "a64k", "audio/mp4", null, "mp4a.40.5", null]
  ], "template-addressed Representations have no single object URL and stay index-addressable");
});

test("portable DASH parser resolves nested BaseURLs in document order and flags protection", () => {
  const out = parseDash(WHOLE_OBJECT_MPD, "https://origin.example.test/manifest.mpd");
  assert.equal(out.duration, "PT2S");
  assert.deepEqual(out.representations.map((item) => [item.id, item.mime, item.codecs, item.url]), [
    ["hi", "video/mp4", "avc1.4d401f", "https://cdn.example.test/root/video/v1080.m4s"],
    ["lo", "video/mp4", "avc1.4d401f", "https://cdn.example.test/root/video/v720.m4s"],
    ["aud", "audio/mp4", "", "https://cdn.example.test/root/audio.m4s"]
  ]);
  const protectedMpd = WHOLE_OBJECT_MPD.replace("<Period>", '<Period><AdaptationSet><ContentProtection schemeIdUri="urn:uuid:fixture"/></AdaptationSet>');
  assert.equal(parseDash(protectedMpd, "https://origin.example.test/manifest.mpd").protected, true);
  assert.throws(() => parseDash("<html></html>", "https://origin.example.test/manifest.mpd"), /DASH MPD/);
});
