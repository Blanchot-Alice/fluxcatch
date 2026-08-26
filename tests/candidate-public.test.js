import test from "node:test";
import assert from "node:assert/strict";
import {
  candidateForPersistence,
  candidateForUi,
  previewForPersistence,
  previewForUi,
  publicDisplayUrl
} from "../extension/lib/candidate-public.js";

test("public candidate is an explicit allowlist and redacts signed queries", () => {
  const privateCandidate = {
    id: "opaque-id",
    generation: "opaque-generation",
    kind: "hls",
    url: "https://cdn.example/media/master.m3u8?token=VERY_SECRET&deadline=999",
    mime: "application/vnd.apple.mpegurl",
    ext: "m3u8",
    title: "Fixture",
    pageTitle: "Fixture page",
    provenance: "observed_response",
    aliases: [{ id: "alias-id", url: "https://cdn.example/media/high.m3u8?signature=ALIAS_SECRET" }],
    headers: { cookie: "COOKIE_SECRET", authorization: "AUTH_SECRET" },
    signedUrl: "https://private.example/file?secret=SIGNED_SECRET",
    manifestText: "#EXTM3U\nSECRET_BODY",
    pairedAudioUrl: "https://private.example/audio?token=AUDIO_SECRET",
    thumbnailUrl: "https://images.example/poster.jpg?token=THUMB_SECRET#private",
    thumbnailSource: "og:image",
    thumbnailAllowedOrigins: ["https://images.example"],
    thumbnailFutureField: "THUMB_FUTURE_SECRET",
    debugPayload: { futureSecret: "FUTURE_SECRET" }
  };
  const publicCandidate = candidateForUi(privateCandidate);
  const serialized = JSON.stringify(publicCandidate);

  assert.equal(publicCandidate.displayUrl, "https://cdn.example/media/master.m3u8");
  assert.equal(publicCandidate.aliases[0].displayUrl, "https://cdn.example/media/high.m3u8");
  assert.equal(publicCandidate.urlIsRedacted, true);
  assert.equal(publicCandidate.copyable, false);
  assert.equal(publicCandidate.requiresRefresh, true);
  assert.equal(publicCandidate.aliases[0].urlIsRedacted, true);
  assert.equal(Object.hasOwn(publicCandidate, "url"), false);
  assert.equal(publicCandidate.thumbnailUrl, "https://images.example/poster.jpg");
  assert.deepEqual(Object.keys(publicCandidate).sort(), [
    "aliases", "codecs", "confidence", "contentLength", "copyable", "displayTitle", "displayUrl", "duration", "ext", "firstSeen",
    "generation", "groupSize", "height", "id", "kind", "lastSeen", "manifestAudioTrackCount", "manifestInspectedAt",
    "manifestProbeStatus", "manifestSize", "manifestSubtitleTrackCount", "manifestType", "manifestVariantCount",
    "mime", "pageTitle", "provenance", "rangeSupported", "site", "source", "sourceFilenames", "sources",
    "suggestedFilename", "thumbnailAdapterImageHosts", "thumbnailAllowedOrigins", "thumbnailAt", "thumbnailFrameId",
    "thumbnailSource", "thumbnailUrl", "title", "urlIsRedacted", "requiresRefresh", "width"
  ].sort());
  assert.doesNotMatch(serialized, /VERY_SECRET|ALIAS_SECRET|COOKIE_SECRET|AUTH_SECRET|SIGNED_SECRET|SECRET_BODY|AUDIO_SECRET|THUMB_SECRET|THUMB_FUTURE_SECRET|FUTURE_SECRET/);
  assert.equal(candidateForPersistence(privateCandidate), null, "signed candidates remain memory-only instead of leaking into session storage");
});

test("persisted candidate has an independent allowlist", () => {
  const persisted = candidateForPersistence({
    id: "safe-id",
    kind: "video",
    url: "https://media.example/video.mp4",
    mime: "video/mp4",
    title: "Safe",
    provenance: "observed_response",
    thumbnailUrl: "https://images.example/poster.jpg?token=THUMB_SECRET",
    thumbnailSource: "poster",
    thumbnailFutureField: "THUMB_FUTURE_SECRET",
    manifestReferences: ["https://media.example/child.m3u8?token=CHILD_SECRET"],
    manifestRedirectUrl: "https://media.example/final.m3u8?signature=REDIRECT_SECRET",
    cookie: "COOKIE_SECRET",
    futureInternalField: "FUTURE_SECRET"
  });
  const serialized = JSON.stringify(persisted);
  assert.equal(persisted.url, "https://media.example/video.mp4");
  assert.deepEqual(persisted.manifestReferences, [], "signed child identities are omitted rather than rewritten into collision-prone queryless URLs");
  assert.equal(persisted.manifestRedirectUrl, null);
  assert.equal(persisted.thumbnailUrl, null, "query-bearing previews are omitted from storage instead of rewriting a different fetch target");
  assert.doesNotMatch(serialized, /CHILD_SECRET|REDIRECT_SECRET|THUMB_SECRET|THUMB_FUTURE_SECRET|COOKIE_SECRET|FUTURE_SECRET/);
});

test("preview boundaries use explicit schemas and persistence fails closed on tokens", () => {
  const privatePreview = {
    thumbnailUrl: "https://images.example/poster.jpg?signature=PREVIEW_SECRET#fragment",
    thumbnailSource: "poster",
    thumbnailFrameId: 7,
    thumbnailAt: 123,
    thumbnailAllowedOrigins: ["https://images.example"],
    thumbnailAdapterImageHosts: ["images.example"],
    futurePath: "/Users/private/PREVIEW_PATH",
    futureSecret: "PREVIEW_FUTURE_SECRET"
  };
  const ui = previewForUi(privatePreview);
  assert.deepEqual(Object.keys(ui).sort(), [
    "thumbnailAdapterImageHosts", "thumbnailAllowedOrigins", "thumbnailAt", "thumbnailFrameId",
    "thumbnailSource", "thumbnailUrl"
  ].sort());
  assert.equal(ui.thumbnailUrl, "https://images.example/poster.jpg");
  assert.doesNotMatch(JSON.stringify(ui), /PREVIEW_SECRET|PREVIEW_PATH|PREVIEW_FUTURE_SECRET/);
  assert.equal(previewForPersistence(privatePreview), null);
  assert.deepEqual(previewForPersistence({ ...privatePreview, thumbnailUrl: "https://images.example/poster.jpg" }), ui);
});

test("public display URL preserves only non-secret adapter identity parameters", () => {
  assert.equal(
    publicDisplayUrl("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42", { kind: "youtube", site: "youtube" }),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
  );
  assert.equal(
    publicDisplayUrl("https://www.bilibili.com/video/BV1fixture/?p=2&vd_source=SECRET", { site: "bilibili" }),
    "https://www.bilibili.com/video/BV1fixture/?p=2"
  );
});

test("only exact queryless direct candidates publish a copyable address", () => {
  const direct = candidateForUi({
    id: "direct-id",
    generation: "generation-id",
    kind: "video",
    url: "https://media.example/video.mp4",
    provenance: "observed_response"
  });
  assert.equal(direct.displayUrl, "https://media.example/video.mp4");
  assert.equal(direct.urlIsRedacted, false);
  assert.equal(direct.copyable, true);
  assert.equal(direct.requiresRefresh, false);

  const signed = candidateForUi({
    id: "signed-id",
    generation: "generation-id",
    kind: "video",
    url: "https://media.example/video.mp4?token=SECRET",
    provenance: "observed_response"
  });
  assert.equal(signed.displayUrl, "https://media.example/video.mp4");
  assert.equal(signed.urlIsRedacted, true);
  assert.equal(signed.copyable, false);
  assert.equal(signed.requiresRefresh, true);
  assert.doesNotMatch(JSON.stringify(signed), /SECRET/);
});

test("path-encoded capabilities are neither published nor persisted", () => {
  const raw = "https://media.example/token/PathBearerABC1234567890/video.mp4";
  const candidate = candidateForUi({
    id: "path-secret",
    generation: "generation-id",
    kind: "video",
    url: raw,
    provenance: "observed_response"
  });
  assert.equal(candidate.displayUrl, "https://media.example/…");
  assert.equal(candidate.urlIsRedacted, true);
  assert.equal(candidate.copyable, false);
  assert.doesNotMatch(JSON.stringify(candidate), /PathBearer/);
  assert.equal(candidateForPersistence({ ...candidate, url: raw }), null);

  const preview = previewForUi({ thumbnailUrl: "https://images.example/session/PRIVATE_PATH/poster.jpg" });
  assert.equal(preview.thumbnailUrl, "https://images.example/…");
});
