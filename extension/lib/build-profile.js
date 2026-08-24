export const NATIVE_PROTOCOL_VERSION = 1;
export const CAPABILITY_PROFILE_VERSION = 1;
export const HOST_MISMATCH_MESSAGE = "扩展与本地引擎版本不匹配，请重新加载扩展并重装本地引擎。";

export const BUILD_PROFILE = Object.freeze({
  channel: "github",
  profileVersion: CAPABILITY_PROFILE_VERSION,
  features: Object.freeze({
    directMedia: true,
    staticHls: true,
    staticDash: true,
    bilibiliDashPair: true,
    liveHls: false,
    encryptedHls: false,
    separateAudioHls: false,
    externalToolNetwork: false,
    remoteThumbnails: false
  })
});

// Package generation replaces only these two development sentinels inside a
// temporary staging directory. Loading extension/ unpacked must never claim
// to be an immutable release artifact from a commit it may no longer match.
export const BUILD_IDENTITY = Object.freeze({
  extensionVersion: "0.2.4",
  channel: BUILD_PROFILE.channel,
  commit: "development",
  buildTimestamp: null,
  nativeProtocolVersion: NATIVE_PROTOCOL_VERSION,
  capabilityProfileVersion: CAPABILITY_PROFILE_VERSION
});

function cleanText(value, max = 160) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function cleanVersion(value) {
  const clean = cleanText(value, 80);
  return /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/.test(clean) ? clean : null;
}

function cleanProtocol(value) {
  return Number.isInteger(value) && value > 0 && value <= 1_000 ? value : null;
}

export function hostCompatibility(status = {}, extensionVersion = BUILD_IDENTITY.extensionVersion) {
  if (!status?.connected) {
    return Object.freeze({
      versionCompatible: null,
      protocolCompatible: null,
      capabilityProfileCompatible: null,
      compatible: null
    });
  }
  const versionCompatible = cleanVersion(status.version) === cleanVersion(extensionVersion);
  const protocolCompatible = cleanProtocol(status.protocolVersion) === NATIVE_PROTOCOL_VERSION;
  const capabilityProfileCompatible = cleanProtocol(status.capabilityProfileVersion) === CAPABILITY_PROFILE_VERSION;
  return Object.freeze({
    versionCompatible,
    protocolCompatible,
    capabilityProfileCompatible,
    compatible: versionCompatible && protocolCompatible && capabilityProfileCompatible
  });
}

export function buildDiagnostics({ extensionId = "", manifestVersion = "", hostStatus = {} } = {}) {
  const compatibility = hostCompatibility(hostStatus, manifestVersion || BUILD_IDENTITY.extensionVersion);
  const ffmpeg = hostStatus?.capabilities?.ffmpeg;
  return Object.freeze({
    extension: Object.freeze({
      version: cleanVersion(manifestVersion) || BUILD_IDENTITY.extensionVersion,
      id: cleanText(extensionId, 64) || null,
      channel: BUILD_IDENTITY.channel,
      // Dirty diagnostic packages use
      // `uncommitted:background.js@sha256:<digest>` rather than impersonating
      // HEAD, so retain the complete verifiable identity string.
      commit: cleanText(BUILD_IDENTITY.commit, 128) || null,
      buildTimestamp: cleanText(BUILD_IDENTITY.buildTimestamp, 40) || null
    }),
    native: Object.freeze({
      connected: Boolean(hostStatus?.connected),
      version: cleanVersion(hostStatus?.version),
      protocolVersion: cleanProtocol(hostStatus?.protocolVersion),
      expectedProtocolVersion: NATIVE_PROTOCOL_VERSION,
      capabilityProfileVersion: cleanProtocol(hostStatus?.capabilityProfileVersion),
      expectedCapabilityProfileVersion: CAPABILITY_PROFILE_VERSION,
      versionCompatible: compatibility.versionCompatible,
      protocolCompatible: compatibility.protocolCompatible,
      capabilityProfileCompatible: compatibility.capabilityProfileCompatible,
      compatible: compatibility.compatible,
      ffmpegAvailable: Boolean(ffmpeg ? ffmpeg.available : hostStatus?.ffmpeg)
    }),
    capabilities: BUILD_PROFILE.features
  });
}
