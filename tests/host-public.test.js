import test from "node:test";
import assert from "node:assert/strict";
import { hostEventForUi, hostStatusForUi } from "../extension/lib/host-public.js";

test("host status exposes capabilities without executable paths, probe errors or future fields", () => {
  const status = hostStatusForUi({
    connected: true,
    version: "0.2.4",
    protocolVersion: 1,
    capabilityProfileVersion: 1,
    ffmpeg: true,
    capabilities: {
      ffmpeg: {
        available: true,
        networkInput: false,
        path: "/Users/private/FFMPEG_PATH",
        version: "8.1",
        probeError: "PROBE_SECRET",
        demuxers: { hls: true, dash: false, future: "DEMUX_SECRET" },
        encoders: { libmp3lame: true },
        future: "FFMPEG_FUTURE"
      },
      ytdlp: { available: false, installed: true, networkDisabled: true, path: "/Users/private/YTDLP_PATH", version: "2026.08", probeError: "YTDLP_PROBE" },
      dashPlanner: "static-v1",
      dashPair: "direct-v1",
      future: "CAPABILITY_FUTURE"
    },
    lastError: "failed at /opt/homebrew/bin/STATUS_PATH token=STATUS_SECRET",
    future: "STATUS_FUTURE"
  });
  assert.deepEqual(Object.keys(status).sort(), [
    "capabilities", "capabilityProfileCompatible", "capabilityProfileVersion", "compatible", "connected", "ffmpeg",
    "lastError", "needsPermission", "protocolCompatible", "protocolVersion", "version", "versionCompatible"
  ].sort());
  assert.deepEqual(Object.keys(status.capabilities).sort(), ["dashPair", "dashPlanner", "ffmpeg", "ytdlp"].sort());
  assert.deepEqual(Object.keys(status.capabilities.ffmpeg).sort(), ["available", "demuxers", "encoders", "networkInput", "version"].sort());
  assert.equal(status.capabilities.ffmpeg.networkInput, false);
  assert.deepEqual(Object.keys(status.capabilities.ytdlp).sort(), ["available", "installed", "networkDisabled", "version"].sort());
  assert.equal(status.capabilities.ytdlp.installed, true);
  assert.equal(status.capabilities.ytdlp.available, false);
  assert.equal(status.capabilities.ytdlp.networkDisabled, true);
  assert.equal(status.compatible, true);
  assert.doesNotMatch(JSON.stringify(status), /FFMPEG_PATH|PROBE_SECRET|DEMUX_SECRET|FFMPEG_FUTURE|YTDLP_PATH|YTDLP_PROBE|CAPABILITY_FUTURE|STATUS_PATH|STATUS_SECRET|STATUS_FUTURE/);
});

test("host status does not turn an unknown network gate into explicit permission", () => {
  const status = hostStatusForUi({
    connected: true,
    capabilities: { ytdlp: { available: true, version: "legacy" } }
  });
  assert.equal(status.capabilities.ytdlp.available, true);
  assert.equal(Object.hasOwn(status.capabilities.ytdlp, "installed"), false);
  assert.equal(Object.hasOwn(status.capabilities.ytdlp, "networkDisabled"), false);
  assert.equal(status.compatible, false, "a legacy host without protocol metadata fails closed");
});

test("host compatibility requires exact extension, protocol and profile versions", () => {
  const base = { connected: true, version: "0.2.4", protocolVersion: 1, capabilityProfileVersion: 1 };
  assert.equal(hostStatusForUi(base).compatible, true);
  assert.equal(hostStatusForUi({ ...base, version: "0.2.3" }).versionCompatible, false);
  assert.equal(hostStatusForUi({ ...base, protocolVersion: 2 }).protocolCompatible, false);
  assert.equal(hostStatusForUi({ ...base, capabilityProfileVersion: 2 }).capabilityProfileCompatible, false);
});

test("host status redacts local paths containing spaces through the end of the status line", () => {
  const status = hostStatusForUi({
    lastError: "failed at /Users/Alice Smith/Secret Folder/movie.mp4 token=SECRET_AFTER_PATH"
  });
  assert.doesNotMatch(status.lastError, /Alice|Smith|Secret Folder|movie\.mp4|SECRET_AFTER_PATH/);
  assert.match(status.lastError, /本地路径已隐藏/);
});

test("host events expose only a fixed lifecycle type; jobs use JOB_UPDATED", () => {
  const event = hostEventForUi({
    type: "complete",
    jobId: "job-secret",
    filename: "/Users/private/movie.mp4",
    path: "/Users/private/COMPLETE_PATH",
    progress: 1,
    future: "HOST_EVENT_FUTURE"
  });
  assert.deepEqual(event, { type: "complete" });
  assert.deepEqual(hostEventForUi({ type: "future-event", path: "SECRET" }), { type: "host-event" });
});
