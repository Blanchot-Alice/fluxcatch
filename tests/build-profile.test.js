import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  BUILD_IDENTITY,
  BUILD_PROFILE,
  CAPABILITY_PROFILE_VERSION,
  NATIVE_PROTOCOL_VERSION,
  buildDiagnostics,
  hostCompatibility
} from "../extension/lib/build-profile.js";

const manifest = JSON.parse(readFileSync(new URL("../extension/manifest.json", import.meta.url), "utf8"));

test("checked-in build identity matches the manifest and identifies unpacked source", () => {
  assert.equal(BUILD_IDENTITY.extensionVersion, manifest.version);
  assert.equal(BUILD_IDENTITY.commit, "development");
  assert.equal(BUILD_IDENTITY.buildTimestamp, null);
  assert.equal(BUILD_IDENTITY.nativeProtocolVersion, NATIVE_PROTOCOL_VERSION);
  assert.equal(BUILD_IDENTITY.capabilityProfileVersion, CAPABILITY_PROFILE_VERSION);
  assert.equal(BUILD_PROFILE.channel, "github");
  for (const feature of ["liveHls", "encryptedHls", "separateAudioHls", "externalToolNetwork", "remoteThumbnails"]) {
    assert.equal(BUILD_PROFILE.features[feature], false);
  }
});

test("native compatibility fails closed on missing or mismatched identity", () => {
  const compatible = { connected: true, version: manifest.version, protocolVersion: 1, capabilityProfileVersion: 1 };
  assert.equal(hostCompatibility(compatible).compatible, true);
  assert.equal(hostCompatibility({ ...compatible, protocolVersion: undefined }).compatible, false);
  assert.equal(hostCompatibility({ ...compatible, version: "0.2.3" }).compatible, false);
  assert.equal(hostCompatibility({ connected: false }).compatible, null);
});

test("diagnostics use a strict scalar and capability allowlist", () => {
  const diagnostics = buildDiagnostics({
    extensionId: "abcdefghijklmnopabcdefghijklmnop",
    manifestVersion: manifest.version,
    hostStatus: {
      connected: true,
      version: manifest.version,
      protocolVersion: 1,
      capabilityProfileVersion: 1,
      ffmpeg: true,
      capabilities: {
        ffmpeg: { available: true, path: "/Users/private/FFMPEG_SECRET" },
        future: { url: "https://secret.example/?token=SECRET" }
      },
      lastError: "Cookie=COOKIE_SECRET Authorization=AUTH_SECRET /Users/private/PATH_SECRET",
      mediaTitle: "PRIVATE_MEDIA_TITLE"
    }
  });
  assert.deepEqual(Object.keys(diagnostics).sort(), ["capabilities", "extension", "native"]);
  assert.deepEqual(Object.keys(diagnostics.extension).sort(), ["buildTimestamp", "channel", "commit", "id", "version"]);
  assert.deepEqual(Object.keys(diagnostics.native).sort(), [
    "capabilityProfileCompatible", "capabilityProfileVersion", "compatible", "connected", "expectedCapabilityProfileVersion",
    "expectedProtocolVersion", "ffmpegAvailable", "protocolCompatible", "protocolVersion", "version", "versionCompatible"
  ].sort());
  assert.doesNotMatch(JSON.stringify(diagnostics), /https?:|COOKIE_SECRET|AUTH_SECRET|FFMPEG_SECRET|PATH_SECRET|PRIVATE_MEDIA_TITLE/);
});
