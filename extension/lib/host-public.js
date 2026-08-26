const HOST_EVENT_TYPES = new Set([
  "pong",
  "progress",
  "complete",
  "failed",
  "cancelled",
  "error",
  "host-disconnected"
]);
const HOST_FAILURE_REASONS = new Set(["api_unavailable", "host_missing", "connection_failed"]);

function cleanText(value, max) {
  return typeof value === "string" ? value.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max) : "";
}

function redactText(value, max = 240) {
  let text = cleanText(value, max * 3);
  text = text.replace(/\bhttps?:\/\/[^\s<>'"]+/gi, (match) => {
    try { return `${new URL(match.replace(/[),.;]+$/, "")).origin}/…`; } catch { return "<链接已隐藏>"; }
  });
  text = text
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer <已隐藏>")
    .replace(/\b(authorization|cookie|set-cookie|access[_-]?token|refresh[_-]?token|token|signature|sig|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, "$1=<已隐藏>")
    // Local paths may contain spaces, so token-based matching can leak every
    // component after the first space. Once a path prefix appears, redact the
    // remainder of this already single-line status string.
    .replace(/(?:\/Users\/|\/home\/|\/private\/|\/var\/|\/tmp\/|\/opt\/|\/usr\/|\/Applications\/|\/Library\/|[A-Za-z]:\\).*/g, "<本地路径已隐藏>");
  return cleanText(text, max);
}

function cleanVersion(value) {
  const version = cleanText(value, 80);
  return version && /^[\p{L}\p{N}._+() -]+$/u.test(version) ? version : null;
}

function toolCapabilityForUi(value, { ffmpeg = false } = {}) {
  if (!value || typeof value !== "object") return null;
  const result = {
    available: Boolean(value.available),
    version: cleanVersion(value.version)
  };
  if (ffmpeg) {
    result.networkInput = Boolean(value.networkInput);
    result.demuxers = {
      hls: Boolean(value.demuxers?.hls),
      dash: Boolean(value.demuxers?.dash)
    };
    result.encoders = { libmp3lame: Boolean(value.encoders?.libmp3lame) };
  } else {
    // Installation is presentation-only and cannot open the adapter gate.
    // Preserve it separately from availability so a locally present yt-dlp
    // is never described as usable while external networking is disabled.
    if (typeof value.installed === "boolean") result.installed = value.installed;
    if (typeof value.networkDisabled === "boolean") {
      // Preserve the distinction between an explicit `false` capability and
      // an older/unknown host that did not report the security gate at all.
      // The YouTube adapter is allowed only in the former case.
      result.networkDisabled = value.networkDisabled;
    }
  }
  return result;
}

function protocolVersion(value, allowed) {
  if (typeof value === "boolean") return value;
  const clean = cleanText(value, 32);
  return allowed.has(clean) ? clean : null;
}

function positiveProtocol(value) {
  return Number.isInteger(value) && value > 0 && value <= 1_000 ? value : null;
}

export function hostStatusForUi(status = {}) {
  const capabilities = status.capabilities && typeof status.capabilities === "object"
    ? {
        ffmpeg: toolCapabilityForUi(status.capabilities.ffmpeg, { ffmpeg: true }),
        ytdlp: toolCapabilityForUi(status.capabilities.ytdlp),
        dashPlanner: protocolVersion(status.capabilities.dashPlanner, new Set(["static-v1"])),
        dashPair: protocolVersion(status.capabilities.dashPair, new Set(["direct-v1"]))
      }
    : null;
  const compatibility = hostCompatibility(status);
  return {
    connected: Boolean(status.connected),
    version: cleanVersion(status.version),
    protocolVersion: positiveProtocol(status.protocolVersion),
    capabilityProfileVersion: positiveProtocol(status.capabilityProfileVersion),
    versionCompatible: compatibility.versionCompatible,
    protocolCompatible: compatibility.protocolCompatible,
    capabilityProfileCompatible: compatibility.capabilityProfileCompatible,
    compatible: compatibility.compatible,
    ffmpeg: Boolean(status.ffmpeg),
    capabilities,
    needsPermission: Boolean(status.needsPermission),
    failureReason: HOST_FAILURE_REASONS.has(status.failureReason) ? status.failureReason : null,
    lastError: redactText(status.lastError, 240) || null,
    restartRequired: Boolean(status.restartRequired)
  };
}

// Native task details are published only through jobForUi/JOB_UPDATED. A host
// lifecycle event intentionally carries no filename, path, progress payload,
// or future host-defined field.
export function hostEventForUi(event = {}) {
  const type = cleanText(event.type, 32).toLowerCase();
  return { type: HOST_EVENT_TYPES.has(type) ? type : "host-event" };
}
import { hostCompatibility } from "./build-profile.js";
