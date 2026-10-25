#!/usr/bin/env node
// Havre stand-in local engine for screenshots and design audits.
//
// Chrome starts this script as the native messaging host of a disposable
// profile (see scripts/lib/active-profile.mjs). It speaks the same subset of
// the engine protocol the service worker uses, with the same message shapes as
// native-host/host.py, but it never touches the network or the file system:
// downloads are a deterministic progress stream that ramps to a fixed fraction
// and then holds there for as long as the process lives, so the real
// Downloads page shows a real, controllable in-progress job.
//
// Wire format: 4-byte little-endian length + UTF-8 JSON in both directions.
// Nothing else is ever written to stdout.
//
// Environment (all optional):
//   HAVRE_FAKE_HOST_SCENARIO       JSON, see DEFAULT_SCENARIO below
//   HAVRE_FAKE_HOST_DOWNLOAD_DIR   absolute folder reported in pong
//   HAVRE_FAKE_HOST_EXTENSION_DIR  extension copy whose build identity
//                                      the pong must match
//   HAVRE_FAKE_HOST_LOG            file to append a protocol log to
//
// Scenario keys: total (the job's size in bytes; 0 reports an unknown size),
// hold (0..1, the fraction to ramp to and then keep), rampMs, intervalMs (tick
// during the ramp), holdIntervalMs (tick while holding), segments (> 0 sends
// "分片 done/segments" with total 0, the only way host.py reports parts: HLS
// and DASH sizes are unknown until the last part lands, so total then only
// sets how many bytes have arrived), speeds (optional B/s samples, one per
// tick, looped), pauseDelayMs (time spent in "pausing"), message (progress
// message when segments is 0; host.py sends "" for a direct file, which keeps
// the worker's queued text on the job) and jobs (per-download overrides of
// the same keys, by arrival order; a resumed download keeps the plan it was
// paused with).
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_EXTENSION_DIR = path.resolve(HERE, "..", "..", "extension");

export const DEFAULT_DOWNLOAD_DIR = "/Users/you/Downloads/Havre";
export const DEFAULT_SCENARIO = Object.freeze({
  total: 812_000_000,
  hold: 0.62,
  rampMs: 6000,
  intervalMs: 250,
  holdIntervalMs: 1000,
  segments: 96,
  speeds: null,
  pauseDelayMs: 300,
  // Same as host.py for a direct file: the worker keeps its queued text
  // ("等待本地引擎") on the job for the whole transfer. Screens must show
  // what users see, so the default does not paper over that.
  message: "",
  jobs: Object.freeze([])
});

// Copied from native-host/host.py so the worker sees identical text.
export const PAUSED_MESSAGE = "已暂停，可随时继续";
export const CANCELLED_MESSAGE = "任务已取消";
const MAX_MESSAGE = 1024 * 1024;
const MAX_FILE_STAT_PATHS = 300;
// Mean of the default speed curve, about 4.6 MiB/s.
const BASE_SPEED = 4_800_000;
const PLAN_KEYS = ["total", "hold", "rampMs", "intervalMs", "holdIntervalMs", "segments", "speeds", "pauseDelayMs", "message"];

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------
export function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  return Buffer.concat([header, payload]);
}

/** Returns a chunk handler that calls onMessage once per complete frame. */
export function createFrameReader(onMessage, onError, maxLength = MAX_MESSAGE) {
  let buffer = Buffer.alloc(0);
  return (chunk) => {
    buffer = buffer.length ? Buffer.concat([buffer, chunk]) : Buffer.from(chunk);
    while (buffer.length >= 4) {
      const length = buffer.readUInt32LE(0);
      if (length === 0 || length > maxLength) {
        buffer = Buffer.alloc(0);
        onError(new Error(`native message length ${length} is out of range`));
        return;
      }
      if (buffer.length < 4 + length) return;
      const payload = buffer.subarray(4, 4 + length);
      buffer = buffer.subarray(4 + length);
      let message;
      try {
        message = JSON.parse(payload.toString("utf8"));
      } catch (error) {
        onError(error);
        return;
      }
      if (!message || typeof message !== "object" || Array.isArray(message)) {
        onError(new Error("native message must be an object"));
        return;
      }
      onMessage(message);
    }
  };
}

// ---------------------------------------------------------------------------
// Scenario
// ---------------------------------------------------------------------------
function finiteNumber(value, name, { min = 0, max = Number.MAX_SAFE_INTEGER, integer = false } = {}) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isInteger(value))) {
    throw new TypeError(`scenario.${name} must be ${integer ? "an integer" : "a number"} between ${min} and ${max}`);
  }
  return value;
}

function normalizePlan(input, base, label) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError(`${label} must be an object`);
  const plan = { ...base };
  for (const key of PLAN_KEYS) {
    if (input[key] === undefined) continue;
    const value = input[key];
    if (key === "total") plan.total = finiteNumber(value, key, { integer: true });
    else if (key === "hold") plan.hold = finiteNumber(value, key, { max: 1 });
    else if (key === "rampMs") plan.rampMs = finiteNumber(value, key, { max: 3_600_000 });
    else if (key === "intervalMs") plan.intervalMs = finiteNumber(value, key, { min: 20, max: 60_000 });
    else if (key === "holdIntervalMs") plan.holdIntervalMs = finiteNumber(value, key, { min: 50, max: 60_000 });
    else if (key === "segments") plan.segments = finiteNumber(value, key, { max: 100_000, integer: true });
    else if (key === "pauseDelayMs") plan.pauseDelayMs = finiteNumber(value, key, { max: 60_000 });
    else if (key === "message") {
      if (typeof value !== "string") throw new TypeError("scenario.message must be a string");
      plan.message = value.slice(0, 240);
    } else if (key === "speeds") {
      if (value === null) plan.speeds = null;
      else if (Array.isArray(value) && value.length && value.every((item) => typeof item === "number" && Number.isFinite(item) && item > 0)) plan.speeds = [...value];
      else throw new TypeError("scenario.speeds must be null or a non-empty array of positive numbers");
    }
  }
  return plan;
}

/** Parses HAVRE_FAKE_HOST_SCENARIO (a JSON string or an object). */
export function resolveScenario(raw) {
  let input = raw;
  if (typeof raw === "string") input = raw.trim() ? JSON.parse(raw) : {};
  if (input === undefined || input === null) input = {};
  const scenario = normalizePlan(input, DEFAULT_SCENARIO, "scenario");
  const jobs = input.jobs === undefined ? [] : input.jobs;
  if (!Array.isArray(jobs)) throw new TypeError("scenario.jobs must be an array");
  scenario.jobs = jobs.map((item, index) => normalizePlan(item, {}, `scenario.jobs[${index}]`));
  return scenario;
}

function planForJob(scenario, index) {
  const { jobs, ...base } = scenario;
  return { ...base, ...(jobs[index] || {}) };
}

/** Deterministic, always-positive speed in B/s: a sum of slow sines. */
export function speedAt(elapsedMs, phase = 0, base = BASE_SPEED) {
  const t = elapsedMs / 1000;
  const factor = 1
    + 0.22 * Math.sin((2 * Math.PI * t) / 7.3 + phase)
    + 0.12 * Math.sin((2 * Math.PI * t) / 2.9 + 1.1 + phase * 1.7)
    + 0.06 * Math.sin((2 * Math.PI * t) / 1.3 + 2.3 + phase * 0.6);
  return Math.round(base * factor);
}

// ---------------------------------------------------------------------------
// Engine identity: the pong must pass hostCompatibility()
// ---------------------------------------------------------------------------
/**
 * hostCompatibility() in extension/lib/build-profile.js compares the pong's
 * version with BUILD_IDENTITY.extensionVersion (not with manifest.json) and
 * the protocol numbers with its own constants, so those are read from the
 * module itself. manifest.json is only a fallback.
 */
export async function engineIdentity(extensionDir = DEFAULT_EXTENSION_DIR, log = () => {}) {
  const identity = { version: null, protocolVersion: 1, capabilityProfileVersion: 1, manifestVersion: null, source: "default" };
  try {
    identity.manifestVersion = JSON.parse(fs.readFileSync(path.join(extensionDir, "manifest.json"), "utf8")).version || null;
  } catch (error) {
    log(`manifest.json unreadable in ${extensionDir}: ${error.message}`);
  }
  try {
    const source = fs.readFileSync(path.join(extensionDir, "lib", "build-profile.js"), "utf8");
    // The module has no imports, so it evaluates on its own from a data: URL.
    const profile = await import(`data:text/javascript;base64,${Buffer.from(source, "utf8").toString("base64")}`);
    if (typeof profile.BUILD_IDENTITY?.extensionVersion === "string") {
      identity.version = profile.BUILD_IDENTITY.extensionVersion;
      identity.source = "build-profile.js";
    }
    if (Number.isInteger(profile.NATIVE_PROTOCOL_VERSION)) identity.protocolVersion = profile.NATIVE_PROTOCOL_VERSION;
    if (Number.isInteger(profile.CAPABILITY_PROFILE_VERSION)) identity.capabilityProfileVersion = profile.CAPABILITY_PROFILE_VERSION;
  } catch (error) {
    log(`build-profile.js unreadable in ${extensionDir}: ${error.message}`);
  }
  if (!identity.version && identity.manifestVersion) {
    identity.version = identity.manifestVersion;
    identity.source = "manifest.json";
  }
  if (identity.manifestVersion && identity.version !== identity.manifestVersion) {
    log(`warning: BUILD_IDENTITY ${identity.version} differs from manifest ${identity.manifestVersion}; the pong uses BUILD_IDENTITY`);
  }
  return identity;
}

export function pongMessage(requestId, identity, downloadDir) {
  return {
    type: "pong",
    requestId,
    version: identity.version,
    protocolVersion: identity.protocolVersion,
    capabilityProfileVersion: identity.capabilityProfileVersion,
    ffmpeg: true,
    downloadDir,
    capabilities: {
      // Same keys as host.py FfmpegCapabilities.as_dict(). There is no real
      // binary behind this engine, so path stays null; the UI never shows it.
      ffmpeg: {
        available: true,
        localProcessing: true,
        networkInput: false,
        networkDisabled: true,
        path: null,
        version: "7.1",
        demuxers: { hls: true, dash: true },
        encoders: { libmp3lame: true },
        probeError: null
      },
      ytdlp: { available: false, installed: false, networkDisabled: true, path: null, version: null, probeError: null },
      dashPlanner: "static-v1",
      dashPair: "direct-v1",
      externalNetworkProcesses: "disabled",
      fileActions: "finder-v1",
      pause: "resume-v1"
    }
  };
}

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------
export function createFakeEngine({ send, scenario = resolveScenario(), identity, downloadDir = DEFAULT_DOWNLOAD_DIR, log = () => {} }) {
  const jobs = new Map();
  // filename -> { fraction, plan, phase, tick, elapsedMs }: what a paused job leaves behind,
  // so the resuming download (same filename, new jobId) continues from it.
  const checkpoints = new Map();
  let arrivals = 0;
  let closed = false;
  let folder = downloadDir;

  function progressMessage(job, speed) {
    const { plan } = job;
    const fraction = Math.min(1, Math.max(0, job.fraction));
    const sizeForBytes = plan.total || DEFAULT_SCENARIO.total;
    const parts = plan.segments > 0;
    const message = parts
      ? `分片 ${Math.min(plan.segments, Math.floor(fraction * plan.segments + 1e-9))}/${plan.segments}`
      : plan.message;
    return {
      type: "progress",
      jobId: job.jobId,
      filename: job.filename,
      status: "downloading",
      bytes: Math.round(fraction * sizeForBytes),
      // host.py never pairs a parts message with a known size (host.py:3011,
      // the DASH branch near 2609): total is 0 whenever it counts parts.
      total: parts ? 0 : plan.total,
      progress: Math.round(fraction * 1e6) / 1e6,
      speed,
      message
    };
  }

  function speedForTick(job, tick, elapsedMs) {
    const { speeds } = job.plan;
    return speeds ? Math.round(speeds[tick % speeds.length]) : speedAt(elapsedMs, job.phase);
  }

  function stopTimers(job) {
    clearTimeout(job.timer);
    clearTimeout(job.pauseTimer);
    job.timer = null;
    job.pauseTimer = null;
  }

  function startDownload(message) {
    const jobId = String(message.jobId || randomUUID()).slice(0, 100);
    if (jobs.has(jobId)) {
      send({ type: "error", jobId, error: "Duplicate job ID" });
      return;
    }
    const filename = String(message.filename || "media").slice(0, 500);
    const checkpoint = checkpoints.get(filename);
    checkpoints.delete(filename);
    const index = checkpoint ? null : arrivals++;
    const plan = checkpoint ? checkpoint.plan : planForJob(scenario, index);
    const phase = checkpoint ? checkpoint.phase : index * 2.4;
    const start = checkpoint ? checkpoint.fraction : 0;
    const target = Math.max(plan.hold, start);
    // tick and elapsedMs carry over from a checkpoint, so a resumed job
    // continues its speed curve instead of replaying it from the start.
    const job = {
      jobId, filename, plan, phase, fraction: start,
      tick: checkpoint ? checkpoint.tick : 0,
      elapsedMs: checkpoint ? checkpoint.elapsedMs : 0,
      timer: null, pauseTimer: null, state: "downloading"
    };
    jobs.set(jobId, job);
    log(`download ${jobId} "${filename}" from ${start} to ${target}${checkpoint ? " (resumed)" : ` (plan ${index})`}`);

    // Cumulative speed over the ramp decides how far each tick moves, so the
    // progress curve has the same shape as the reported speed.
    const rampTicks = plan.rampMs > 0 ? Math.max(1, Math.ceil(plan.rampMs / plan.intervalMs)) : 0;
    const rampSpeeds = Array.from({ length: rampTicks }, (_, i) => speedForTick(job, job.tick + i + 1, job.elapsedMs + (i + 1) * plan.intervalMs));
    const rampTotal = rampSpeeds.reduce((sum, value) => sum + value, 0);
    let rampIndex = 0;
    let covered = 0;

    const emit = (speed) => send(progressMessage(job, speed));
    const holdTick = () => {
      if (job.state !== "downloading" || closed) return;
      job.tick += 1;
      job.elapsedMs += plan.holdIntervalMs;
      emit(speedForTick(job, job.tick, job.elapsedMs));
      job.timer = setTimeout(holdTick, plan.holdIntervalMs);
    };
    const rampTick = () => {
      if (job.state !== "downloading" || closed) return;
      const speed = rampSpeeds[rampIndex];
      covered += speed;
      rampIndex += 1;
      job.tick += 1;
      job.elapsedMs += plan.intervalMs;
      job.fraction = rampIndex >= rampTicks ? target : start + ((target - start) * covered) / rampTotal;
      emit(speed);
      job.timer = rampIndex >= rampTicks
        ? setTimeout(holdTick, plan.holdIntervalMs)
        : setTimeout(rampTick, plan.intervalMs);
    };

    if (!rampTicks) job.fraction = target;
    emit(speedForTick(job, job.tick, job.elapsedMs));
    job.timer = rampTicks ? setTimeout(rampTick, plan.intervalMs) : setTimeout(holdTick, plan.holdIntervalMs);
  }

  function pause(jobId) {
    const job = jobs.get(jobId);
    if (!job || job.state !== "downloading") return;
    stopTimers(job);
    job.state = "pausing";
    job.pauseTimer = setTimeout(() => {
      if (job.state !== "pausing" || closed) return;
      jobs.delete(jobId);
      checkpoints.set(job.filename, { fraction: job.fraction, plan: job.plan, phase: job.phase, tick: job.tick, elapsedMs: job.elapsedMs });
      log(`paused ${jobId} at ${job.fraction}`);
      // host.py sends type "paused" (not "progress"); the worker reads status
      // first and keeps the resume recipe under targetName.
      send({ type: "paused", jobId, filename: job.filename, status: "paused", message: PAUSED_MESSAGE, targetName: job.filename });
    }, job.plan.pauseDelayMs);
  }

  function cancel(jobId) {
    const job = jobs.get(jobId);
    // host.py ignores a cancel for a job it does not run; so does this one.
    if (!job) return;
    stopTimers(job);
    job.state = "cancelled";
    jobs.delete(jobId);
    checkpoints.delete(job.filename);
    log(`cancelled ${jobId}`);
    send({ type: "cancelled", jobId, filename: job.filename, status: "cancelled", message: CANCELLED_MESSAGE });
  }

  function fileAction(type, message) {
    const reply = { type: "file_action_result", requestId: message.requestId, action: type, ok: true };
    if (type === "stat") {
      const paths = Array.isArray(message.paths) ? message.paths.slice(0, MAX_FILE_STAT_PATHS) : [];
      reply.items = paths.map((item) => (typeof item === "string" ? { path: item, exists: true } : { path: "", exists: false }));
    } else if (type === "choose_folder") {
      if (message.reset) folder = downloadDir;
      reply.downloadDir = folder;
    } else if (type === "discard") {
      const name = String(message.filename || "");
      reply.removed = checkpoints.delete(name) ? ["checkpoint"] : [];
    }
    return reply;
  }

  function handle(message) {
    if (closed) return;
    const type = typeof message?.type === "string" ? message.type : "";
    log(`<- ${type || "(no type)"}${message?.jobId ? ` ${message.jobId}` : ""}`);
    if (type === "ping") {
      send(pongMessage(message.requestId, identity, folder));
      return;
    }
    if (type === "download") {
      startDownload(message);
      return;
    }
    if (type === "pause") {
      pause(String(message.jobId || ""));
      return;
    }
    if (type === "cancel") {
      cancel(String(message.jobId || ""));
      return;
    }
    if (type === "inspect_hls") {
      // Fail fast instead of letting the worker wait 12 s. A user-started
      // probe can show this text, so it is plain copy that the English
      // catalog already translates ("Could not read media").
      send({ type: "inspect_hls_result", requestId: message.requestId, ok: false, error: "读取媒体失败" });
      return;
    }
    if (message?.requestId !== undefined && message?.requestId !== null) {
      // stat, open_folder, reveal, open, trash, discard, choose_folder and any
      // future request that expects a correlated answer.
      send(fileAction(type, message));
      return;
    }
    send({ type: "error", requestId: message?.requestId ?? null, error: "Unknown request type" });
  }

  function close() {
    closed = true;
    for (const job of jobs.values()) stopTimers(job);
    jobs.clear();
  }

  return { handle, close, jobs, checkpoints };
}

// ---------------------------------------------------------------------------
// Process entry
// ---------------------------------------------------------------------------
function createLogger(file) {
  if (!file) return () => {};
  return (text) => {
    try { fs.appendFileSync(file, `${new Date().toISOString()} [${process.pid}] ${text}\n`); } catch { /* logging must never break the protocol */ }
  };
}

async function main() {
  const log = createLogger(process.env.HAVRE_FAKE_HOST_LOG);
  log(`start argv=${JSON.stringify(process.argv.slice(2))}`);
  let scenario;
  try {
    scenario = resolveScenario(process.env.HAVRE_FAKE_HOST_SCENARIO);
  } catch (error) {
    log(`invalid scenario: ${error.message}`);
    // stderr is safe here (Chrome only reads stdout) and ends up in Chrome's
    // own stderr, where a harness can find it.
    process.stderr.write(`havre fake engine: invalid scenario: ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const extensionDir = process.env.HAVRE_FAKE_HOST_EXTENSION_DIR || DEFAULT_EXTENSION_DIR;
  const identity = await engineIdentity(extensionDir, log);
  const downloadDir = process.env.HAVRE_FAKE_HOST_DOWNLOAD_DIR || DEFAULT_DOWNLOAD_DIR;
  log(`identity ${JSON.stringify(identity)} downloadDir=${downloadDir} scenario=${JSON.stringify(scenario)}`);

  let stdoutOpen = true;
  process.stdout.on("error", (error) => {
    // Chrome closed the pipe; nothing left to talk to.
    stdoutOpen = false;
    log(`stdout error: ${error.message}`);
    shutdown(0);
  });
  const send = (message) => {
    if (!stdoutOpen) return;
    log(`-> ${message.type}${message.jobId ? ` ${message.jobId}` : ""}${message.type === "progress" ? ` ${message.progress} ${message.speed}B/s ${message.message}` : ""}`);
    process.stdout.write(encodeFrame(message));
  };
  const engine = createFakeEngine({ send, scenario, identity, downloadDir, log });
  let stopping = false;
  function shutdown(code) {
    if (stopping) return;
    stopping = true;
    engine.close();
    process.stdin.destroy();
    process.exitCode = code;
    log(`exit ${code}`);
    // Let pending stdout writes drain; with no timers left the loop ends.
  }
  const onChunk = createFrameReader((message) => {
    try {
      engine.handle(message);
    } catch (error) {
      log(`handler error: ${error.stack || error.message}`);
    }
  }, (error) => {
    // host.py treats a malformed frame as fatal; mirror that.
    log(`protocol error: ${error.message}`);
    shutdown(1);
  });
  process.stdin.on("data", onChunk);
  process.stdin.on("end", () => shutdown(0));
  process.stdin.on("error", () => shutdown(0));
  process.on("SIGTERM", () => { shutdown(0); process.exit(); });
  process.on("SIGINT", () => { shutdown(0); process.exit(); });
}

function isEntryPoint() {
  if (!process.argv[1]) return false;
  try {
    return fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) await main();
