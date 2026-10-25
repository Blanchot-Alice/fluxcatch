import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_DOWNLOAD_DIR,
  PAUSED_MESSAGE,
  createFrameReader,
  encodeFrame,
  resolveScenario
} from "../scripts/lib/fake-native-host.mjs";
import {
  GRANTED_PERMISSIONS,
  NATIVE_HOST_NAME,
  extensionIdFromKey,
  prepareActiveExtension,
  registerFakeHost,
  startFixtureDownloads,
  writeFakeHostLauncher
} from "../scripts/lib/active-profile.mjs";
import { BUILD_IDENTITY, hostCompatibility } from "../extension/lib/build-profile.js";
import { hostStatusForUi } from "../extension/lib/host-public.js";
import { segmentsFromActivity } from "../extension/lib/job-failure.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION_DIR = path.join(ROOT, "extension");
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
const BACKGROUND = fs.readFileSync(path.join(EXTENSION_DIR, "background.js"), "utf8");
// background.js JOB_STATUSES: the statuses a native progress message may carry.
const JOB_STATUSES = new Set(["queued", "downloading", "remuxing", "pausing", "paused", "completed", "failed", "cancelled", "interrupted"]);

function tempDir(t, label) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `havre-${label}-`));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(fn, label, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await fn();
    if (last) return last;
    await delay(25);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Spawns a launcher the way Chrome does (origin as the only argument). */
function spawnHost(t, launcher, extensionId, { env = process.env, args = [] } = {}) {
  const child = spawn(launcher, [...args, `chrome-extension://${extensionId}/`], { stdio: ["pipe", "pipe", "pipe"], env });
  const messages = [];
  const errors = [];
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdout.on("data", createFrameReader((message) => messages.push(message), (error) => errors.push(error)));
  const exited = new Promise((resolve) => child.once("exit", (code, signal) => resolve({ code, signal })));
  t.after(() => { if (child.exitCode === null) child.kill("SIGKILL"); });
  return {
    child,
    messages,
    errors,
    exited,
    stderr: () => stderr,
    send: (message) => child.stdin.write(encodeFrame(message)),
    next: (predicate, label) => poll(() => messages.find(predicate), label),
    all: (predicate) => messages.filter(predicate)
  };
}

test("frames round-trip in pieces and malformed frames are reported", () => {
  const received = [];
  const errors = [];
  const read = createFrameReader((message) => received.push(message), (error) => errors.push(error));
  const frame = Buffer.concat([encodeFrame({ type: "ping", requestId: "a", text: "分片" }), encodeFrame({ type: "pong" })]);
  for (let index = 0; index < frame.length; index += 3) read(frame.subarray(index, index + 3));
  assert.deepEqual(received, [{ type: "ping", requestId: "a", text: "分片" }, { type: "pong" }]);
  assert.equal(frame.readUInt32LE(0), Buffer.byteLength(JSON.stringify({ type: "ping", requestId: "a", text: "分片" })), "little-endian byte length of the UTF-8 payload");
  read(Buffer.from([0, 0, 0, 0]));
  assert.equal(errors.length, 1, "a zero-length frame is a protocol error, as in host.py");
});

test("scenario parsing keeps the documented defaults and rejects bad values", () => {
  const defaults = resolveScenario(undefined);
  assert.equal(defaults.total, 812_000_000);
  assert.equal(defaults.hold, 0.62);
  assert.equal(defaults.rampMs, 6000);
  assert.equal(defaults.intervalMs, 250);
  assert.equal(defaults.segments, 96);
  const custom = resolveScenario(JSON.stringify({ total: 5, hold: 1, segments: 0, speeds: [1, 2], jobs: [{ hold: 0.3 }] }));
  assert.deepEqual([custom.total, custom.hold, custom.segments, custom.speeds, custom.jobs], [5, 1, 0, [1, 2], [{ hold: 0.3 }]]);
  assert.throws(() => resolveScenario({ hold: 1.5 }), /scenario\.hold/);
  assert.throws(() => resolveScenario({ speeds: [0] }), /scenario\.speeds/);
  assert.throws(() => resolveScenario({ jobs: [{ segments: 1.5 }] }), /scenario\.segments/);
  assert.throws(() => resolveScenario("{not json"));
});

test("extension id, host name and the prepared copy match the repository", (t) => {
  const id = extensionIdFromKey(MANIFEST.key);
  assert.match(id, /^[a-p]{32}$/);
  const template = JSON.parse(fs.readFileSync(path.join(ROOT, "native-host", `${NATIVE_HOST_NAME}.json.in`), "utf8"));
  assert.equal(template.name, NATIVE_HOST_NAME);
  assert.deepEqual(template.allowed_origins, [`chrome-extension://${id}/`], "the id derived from the key is the one the real engine trusts");
  assert.match(BACKGROUND, new RegExp(`const HOST_NAME = "${NATIVE_HOST_NAME.replace(/\./g, "\\.")}"`), "the worker connects to the same host name");
  assert.match(fs.readFileSync(path.join(ROOT, "scripts", "validate.py"), "utf8"), new RegExp(`NATIVE_HOST_NAME = "${NATIVE_HOST_NAME.replace(/\./g, "\\.")}"`));

  const work = tempDir(t, "active-extension");
  const copy = prepareActiveExtension(EXTENSION_DIR, path.join(work, "extension"));
  assert.equal(copy, path.join(work, "extension"));
  const prepared = JSON.parse(fs.readFileSync(path.join(copy, "manifest.json"), "utf8"));
  assert.equal(prepared.key, MANIFEST.key, "the key stays, so the extension id is unchanged");
  assert.equal(extensionIdFromKey(prepared.key), id);
  for (const permission of GRANTED_PERMISSIONS) {
    assert.ok(prepared.permissions.includes(permission), `${permission} is granted up front`);
    assert.ok(!prepared.optional_permissions.includes(permission), `${permission} is no longer optional`);
  }
  for (const permission of MANIFEST.permissions) assert.ok(prepared.permissions.includes(permission));
  assert.deepEqual({ ...prepared, permissions: undefined, optional_permissions: undefined }, { ...MANIFEST, permissions: undefined, optional_permissions: undefined }, "nothing else in the manifest changes");
  assert.equal(fs.readFileSync(path.join(copy, "background.js"), "utf8"), BACKGROUND);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8")), MANIFEST, "the source manifest is untouched");
  assert.throws(() => prepareActiveExtension(EXTENSION_DIR, copy), /not empty/);
  assert.throws(() => prepareActiveExtension(EXTENSION_DIR, path.join(EXTENSION_DIR, "copy")), /overlap/);

  const launcher = writeFakeHostLauncher(work, { scenario: { hold: 0.5 }, downloadDir: "/Users/you/Movies", extensionDir: copy, logFile: path.join(work, "host.log") });
  const script = fs.readFileSync(launcher, "utf8");
  assert.match(script, /^#!\/bin\/sh\n/);
  assert.ok(script.includes(`exec '${process.execPath}' '${path.join(ROOT, "scripts", "lib", "fake-native-host.mjs")}' "$@"`));
  assert.ok(script.includes(`export HAVRE_FAKE_HOST_SCENARIO='{"hold":0.5}'`));
  assert.ok(fs.statSync(launcher).mode & 0o100, "the launcher is executable");
  const bare = fs.readFileSync(writeFakeHostLauncher(path.join(work, "bare")), "utf8");
  for (const name of ["SCENARIO", "DOWNLOAD_DIR", "EXTENSION_DIR", "LOG"]) assert.match(bare, new RegExp(`^unset HAVRE_FAKE_HOST_${name}$`, "m"));
  assert.match(bare, /^unset NODE_OPTIONS$/m, "a --require in NODE_OPTIONS could print to stdout");
  assert.throws(() => writeFakeHostLauncher(work, { scenario: "{oops" }));
  // A scenario the engine would reject must fail here: inside Chrome the
  // engine just exits and every screen shows a missing engine.
  assert.throws(() => writeFakeHostLauncher(path.join(work, "bad"), { scenario: { hold: 1.5 } }), /scenario\.hold/);
  assert.throws(() => writeFakeHostLauncher(path.join(work, "bad"), { scenario: { jobs: [{ segments: -1 }] } }), /scenario\.segments/);
  assert.ok(!fs.existsSync(path.join(work, "bad")), "nothing is written for a rejected scenario");
  assert.throws(() => writeFakeHostLauncher(work, { downloadDir: "Downloads" }), /absolute/);
  assert.match(fs.readFileSync(writeFakeHostLauncher(path.join(work, "null-dir"), { downloadDir: null }), "utf8"), /^unset HAVRE_FAKE_HOST_DOWNLOAD_DIR$/m, "null means the default folder");

  const profile = path.join(work, "profile");
  const registration = registerFakeHost(profile, launcher, id);
  assert.equal(registration, path.join(profile, "NativeMessagingHosts", `${NATIVE_HOST_NAME}.json`));
  assert.deepEqual(JSON.parse(fs.readFileSync(registration, "utf8")), {
    name: NATIVE_HOST_NAME,
    description: "Havre stand-in engine (design audit)",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`]
  });
  assert.throws(() => registerFakeHost(profile, launcher, "not-an-id"), /32 letters/);
});

test("the stand-in engine answers with the shapes background.js consumes", async (t) => {
  const work = tempDir(t, "fake-host");
  const id = extensionIdFromKey(MANIFEST.key);
  const logFile = path.join(work, "host.log");
  const scenario = {
    total: 40_000_000, hold: 0.5, rampMs: 400, intervalMs: 50, holdIntervalMs: 100, segments: 8, pauseDelayMs: 60,
    jobs: [{}, { segments: 0, hold: 0.25, speeds: [1_000_000, 2_000_000, 3_000_000] }]
  };
  const launcher = writeFakeHostLauncher(work, { scenario, downloadDir: "/Users/you/Movies/Havre", extensionDir: EXTENSION_DIR, logFile });
  const host = spawnHost(t, launcher, id);

  // ping -> pong. background.js openNativePort() copies version,
  // protocolVersion, capabilityProfileVersion, ffmpeg, capabilities and
  // downloadDir, then requireCompatibleNativeHost() runs hostCompatibility().
  host.send({ type: "ping", requestId: "ping-1" });
  const pong = await host.next((message) => message.type === "pong", "pong");
  assert.equal(pong.requestId, "ping-1", "resolveHostPing matches the requestId");
  assert.equal(pong.version, BUILD_IDENTITY.extensionVersion, "hostCompatibility compares with BUILD_IDENTITY, not manifest.json");
  assert.equal(pong.downloadDir, "/Users/you/Movies/Havre");
  assert.equal(pong.ffmpeg, true);
  const status = { connected: true, ...pong };
  assert.equal(hostCompatibility(status).compatible, true);
  const forUi = hostStatusForUi(status);
  assert.equal(forUi.compatible, true);
  assert.deepEqual(
    { pause: forUi.capabilities.pause, fileActions: forUi.capabilities.fileActions, dashPlanner: forUi.capabilities.dashPlanner, dashPair: forUi.capabilities.dashPair },
    { pause: "resume-v1", fileActions: "finder-v1", dashPlanner: "static-v1", dashPair: "direct-v1" },
    "hostStatusForUi keeps only these exact capability versions"
  );
  assert.equal(forUi.capabilities.ffmpeg.available, true);
  assert.deepEqual(forUi.capabilities.ffmpeg.demuxers, { hls: true, dash: true });
  assert.equal(forUi.capabilities.ffmpeg.encoders.libmp3lame, true, "the popup's MP3 option reads this");

  // stat -> file_action_result with every path present (verifyHistoryFiles
  // reads items[].path and items[].exists).
  host.send({ type: "stat", requestId: "stat-1", paths: ["/Users/you/Movies/Havre/a.mp4", 7] });
  const stat = await host.next((message) => message.requestId === "stat-1", "stat");
  assert.deepEqual(stat, { type: "file_action_result", requestId: "stat-1", action: "stat", ok: true, items: [{ path: "/Users/you/Movies/Havre/a.mp4", exists: true }, { path: "", exists: false }] });

  // download -> progress stream (handleNativeHostMessage reads jobId, status,
  // filename, progress, speed, bytes, total, message).
  host.send({ type: "download", jobId: "job-a", url: "https://example.com/a.mp4", mediaKind: "video", filename: "a.mp4", options: {} });
  host.send({ type: "download", jobId: "job-b", url: "https://example.com/b.mp4", mediaKind: "video", filename: "b.mp4", options: {} });
  await host.next((message) => message.jobId === "job-a" && message.progress === 0.5, "job-a at hold");
  await host.next((message) => message.jobId === "job-b" && message.progress === 0.25, "job-b at hold");
  await poll(() => host.all((message) => message.jobId === "job-a" && message.progress === 0.5).length >= 3, "job-a holding");
  const streamA = host.all((message) => message.jobId === "job-a");
  const streamB = host.all((message) => message.jobId === "job-b");
  for (const message of [...streamA, ...streamB]) {
    assert.equal(message.type, "progress");
    assert.equal(message.status, "downloading");
    assert.ok(JOB_STATUSES.has(message.status));
    assert.ok(Number.isInteger(message.bytes) && message.bytes >= 0);
    assert.ok(message.speed > 0, "a positive speed gives the page an ETA and a speed graph");
    assert.ok(message.progress >= 0 && message.progress <= 1);
  }
  // host.py counts parts only with total 0 (an HLS or DASH size is unknown
  // until the last part lands); total still sets the bytes received.
  assert.ok(streamA.every((message) => message.total === 0), "a parts message never carries a known size");
  assert.equal(streamA.at(-1).bytes, 20_000_000);
  assert.ok(streamB.every((message) => message.total === 40_000_000), "a direct file keeps its size");
  assert.deepEqual(streamA.map((message) => message.progress), [...streamA.map((message) => message.progress)].sort((a, b) => a - b), "progress never goes backwards");
  assert.ok(new Set(streamA.map((message) => message.speed)).size >= 5, "the speed varies, so the graph has a shape");
  assert.ok(streamA.filter((message) => message.progress === 0.5).length >= 3, "the job keeps reporting while it holds");
  assert.deepEqual(segmentsFromActivity(streamA.at(-1).message), { done: 4, total: 8 }, "分片 n/m feeds the segment map");
  assert.equal(streamA.at(-1).message, "分片 4/8");
  assert.equal(streamB.at(-1).message, "", "a direct file sends an empty message, as host.py does");
  assert.equal(segmentsFromActivity(streamB.at(-1).message), null);
  assert.deepEqual(new Set(streamB.map((message) => message.speed)), new Set([1_000_000, 2_000_000, 3_000_000]), "a scenario speed curve is used as given");
  assert.equal(streamB.at(-1).bytes, 10_000_000);

  // pause -> "paused" (host.py's type) with targetName; the worker keeps the
  // resume recipe (resumeWithTargetName) and offers 继续.
  host.send({ type: "pause", jobId: "job-a" });
  const paused = await host.next((message) => message.jobId === "job-a" && message.status === "paused", "paused");
  assert.deepEqual(paused, { type: "paused", jobId: "job-a", filename: "a.mp4", status: "paused", message: PAUSED_MESSAGE, targetName: "a.mp4" });
  const afterPause = host.messages.length;
  await delay(250);
  assert.equal(host.messages.slice(afterPause).filter((message) => message.jobId === "job-a").length, 0, "a paused job goes quiet");

  // The worker resumes with a new jobId and the same filename.
  host.send({ type: "download", jobId: "job-a2", filename: "a.mp4", options: { filename: "a.mp4" } });
  const resumed = await host.next((message) => message.jobId === "job-a2", "resumed");
  assert.equal(resumed.progress, 0.5, "the resumed job continues from its checkpoint");

  // cancel -> cancelled; discard of a paused job's leftovers -> ok.
  host.send({ type: "cancel", jobId: "job-b" });
  const cancelled = await host.next((message) => message.jobId === "job-b" && message.type === "cancelled", "cancelled");
  assert.deepEqual(cancelled, { type: "cancelled", jobId: "job-b", filename: "b.mp4", status: "cancelled", message: "任务已取消" });
  host.send({ type: "cancel", jobId: "no-such-job" });
  host.send({ type: "pause", jobId: "job-a2" });
  await host.next((message) => message.jobId === "job-a2" && message.status === "paused", "job-a2 paused");
  host.send({ type: "discard", requestId: "discard-1", filename: "a.mp4" });
  assert.deepEqual(await host.next((message) => message.requestId === "discard-1", "discard"), { type: "file_action_result", requestId: "discard-1", action: "discard", ok: true, removed: ["checkpoint"] });

  // File actions resolve resolveHostFileAction(); choose_folder must carry
  // downloadDir (chooseDownloadFolder throws without it).
  for (const type of ["open_folder", "reveal", "open", "trash", "future_action"]) {
    host.send({ type, requestId: `${type}-1`, path: "/Users/you/Movies/Havre/a.mp4" });
    assert.deepEqual(await host.next((message) => message.requestId === `${type}-1`, type), { type: "file_action_result", requestId: `${type}-1`, action: type, ok: true });
  }
  host.send({ type: "choose_folder", requestId: "folder-1" });
  assert.equal((await host.next((message) => message.requestId === "folder-1", "choose_folder")).downloadDir, "/Users/you/Movies/Havre");
  host.send({ type: "inspect_hls", requestId: "inspect-1", url: "https://example.com/a.m3u8" });
  assert.equal((await host.next((message) => message.requestId === "inspect-1", "inspect")).type, "inspect_hls_result");
  host.send({ type: "mystery" });
  assert.equal((await host.next((message) => message.type === "error", "error")).error, "Unknown request type");
  assert.ok(!host.messages.some((message) => message.jobId === "no-such-job"), "a cancel for an unknown job is ignored, as in host.py");

  // Exit cleanly when Chrome closes stdin; stdout carried frames only.
  host.child.stdin.end();
  assert.deepEqual(await host.exited, { code: 0, signal: null });
  assert.deepEqual(host.errors, [], "every byte on stdout was a valid frame");
  assert.equal(host.stderr(), "");
  assert.match(fs.readFileSync(logFile, "utf8"), /<- ping[\s\S]*-> pong[\s\S]*exit 0/);
});

test("an inherited environment does not leak into the launcher", async (t) => {
  const work = tempDir(t, "fake-host-env");
  const launcher = writeFakeHostLauncher(work, {});
  // Chrome passes its own environment to the engine. A preload that prints
  // to stdout would corrupt the message stream.
  const noisy = path.join(work, "noisy.cjs");
  fs.writeFileSync(noisy, "process.stdout.write('noise from a preload\\n');\n");
  const env = { ...process.env, HAVRE_FAKE_HOST_DOWNLOAD_DIR: "/Users/somebody/Elsewhere", NODE_OPTIONS: `--require ${noisy}` };
  const id = extensionIdFromKey(MANIFEST.key);

  // Control: the same preload on a bare node really does break the framing.
  const bare = spawnHost(t, process.execPath, id, { env, args: [path.join(ROOT, "scripts", "lib", "fake-native-host.mjs")] });
  bare.send({ type: "ping", requestId: "p0" });
  await poll(() => bare.errors.length > 0, "corrupted frame on a bare node");
  bare.child.kill("SIGKILL");

  const host = spawnHost(t, launcher, id, { env });
  host.send({ type: "ping", requestId: "p" });
  const pong = await host.next((message) => message.type === "pong", "pong");
  assert.equal(pong.downloadDir, DEFAULT_DOWNLOAD_DIR);
  host.child.stdin.end();
  assert.equal((await host.exited).code, 0);
  assert.deepEqual(host.errors, [], "the launcher keeps stdout to frames only");
  assert.equal(host.messages.length, 1);
});

// ---------------------------------------------------------------------------
// The real service worker against the stand-in engine
// ---------------------------------------------------------------------------
function event() {
  const listeners = [];
  return { listeners, addListener(fn) { listeners.push(fn); }, removeListener(fn) { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); } };
}

test("the real worker runs DOWNLOAD_URL, pause, resume, cancel and file actions through the stand-in engine", async (t) => {
  const work = tempDir(t, "fake-host-worker");
  const extensionId = extensionIdFromKey(MANIFEST.key);
  const downloadDir = "/Users/you/Downloads";
  const launcher = writeFakeHostLauncher(work, {
    // jobs[1] is a direct file with host.py's empty message; jobs[2] sets
    // its own message.
    scenario: { rampMs: 300, intervalMs: 50, holdIntervalMs: 100, pauseDelayMs: 80, jobs: [{}, { hold: 0.31, segments: 0 }, { segments: 0, message: "下载中" }] },
    downloadDir,
    extensionDir: EXTENSION_DIR
  });
  const origin = `chrome-extension://${extensionId}/`;
  const children = [];
  const outgoing = [];
  const uiMessages = [];
  const local = {
    "downloadHistory.v1": [{
      jobId: "seed-1", method: "native", status: "completed", kind: "video", filename: "Seminar 3.mp4",
      path: `${downloadDir}/Seminar 3.mp4`, downloadDir, size: 120_000_000, createdAt: Date.now() - 60_000, finishedAt: Date.now() - 30_000
    }]
  };
  const session = {};
  const tabs = new Map([
    [7, { id: 7, title: "Havre 设置", url: `${origin}options/options.html` }],
    [8, { id: 8, title: "Havre 下载记录", url: `${origin}downloads/downloads.html` }]
  ]);
  const onMessage = event();
  const onConnect = event();

  function connectNative(name) {
    assert.equal(name, NATIVE_HOST_NAME);
    const child = spawn(launcher, [origin], { stdio: ["pipe", "pipe", "pipe"] });
    children.push(child);
    const port = { name, onMessage: event(), onDisconnect: event(), disconnected: false };
    port.postMessage = (message) => {
      if (port.disconnected) throw new Error("Attempting to use a disconnected port object");
      outgoing.push(message);
      child.stdin.write(encodeFrame(message));
    };
    port.disconnect = () => { port.disconnected = true; child.stdin.end(); };
    child.stdout.on("data", createFrameReader((message) => {
      for (const listener of port.onMessage.listeners) listener(message, port);
    }, (error) => { throw error; }));
    child.on("exit", () => {
      if (port.disconnected) return;
      port.disconnected = true;
      globalThis.chrome.runtime.lastError = { message: "Native host has exited." };
      for (const listener of port.onDisconnect.listeners) listener(port);
      globalThis.chrome.runtime.lastError = null;
    });
    return port;
  }

  // Every network request the worker makes lands here and fails. DOWNLOAD_URL
  // for the fixture addresses must not make any.
  const fetchCalls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    fetchCalls.push(String(input?.url || input));
    throw new TypeError("network is off in this test");
  };

  const asyncNoop = async () => {};
  globalThis.chrome = {
    webRequest: { onBeforeSendHeaders: event(), onHeadersReceived: event(), onCompleted: event(), onErrorOccurred: event() },
    runtime: {
      id: extensionId,
      getURL: (file = "") => `${origin}${file}`,
      getManifest: () => ({ ...MANIFEST }),
      onConnect,
      onMessage,
      lastError: null,
      connectNative
    },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      onActivated: event(),
      get: async (tabId) => {
        if (!tabs.has(tabId)) throw new Error(`No tab with id: ${tabId}.`);
        return { ...tabs.get(tabId) };
      },
      query: async () => [],
      sendMessage: async () => ({ ok: true })
    },
    notifications: { create: async (notificationId) => notificationId, clear: asyncNoop },
    downloads: { onChanged: event(), download: async () => { throw new Error("the browser downloader must not be used"); }, cancel: asyncNoop, search: async () => [] },
    storage: {
      session: { get: async () => structuredClone(session), set: async (value) => { Object.assign(session, structuredClone(value)); } },
      local: {
        get: async () => structuredClone(local),
        set: async (value) => { Object.assign(local, structuredClone(value)); },
        remove: async (key) => { for (const item of [key].flat()) delete local[item]; }
      }
    },
    permissions: { contains: async () => true, onAdded: event(), onRemoved: event() },
    action: { setBadgeText: asyncNoop, setBadgeBackgroundColor: asyncNoop, setBadgeTextColor: asyncNoop, setTitle: asyncNoop }
  };
  t.after(async () => {
    for (const child of children) if (child.exitCode === null) child.stdin.end();
    await delay(200);
    for (const child of children) if (child.exitCode === null) child.kill("SIGKILL");
    delete globalThis.chrome;
    globalThis.fetch = realFetch;
  });

  await import(`../extension/background.js?fake-native-host=${Date.now()}`);
  const senderFor = (tabId) => ({ id: extensionId, url: tabs.get(tabId).url, tab: { id: tabId } });
  const send = (message, tabId = 7) => new Promise((resolve) => onMessage.listeners[0](message, senderFor(tabId), resolve));
  const jobsNow = async () => (await send({ type: "GET_HISTORY" })).jobs;
  const jobNamed = async (filename) => (await jobsNow()).find((job) => job.filename === filename);

  // The Downloads page listens on this port for JOB_UPDATED.
  const uiPort = { name: "havre-downloads", sender: senderFor(8), postMessage: (message) => uiMessages.push(message), onDisconnect: event(), onMessage: event() };
  onConnect.listeners[0](uiPort);

  const ping = await send({ type: "PING_HOST" });
  assert.equal(ping.ok, true, ping.error);
  assert.equal(ping.hostStatus.connected, true);
  assert.equal(ping.hostStatus.compatible, true, "no version mismatch: DOWNLOAD/PAUSE/CANCEL would refuse otherwise");
  assert.equal(ping.hostStatus.downloadDir, downloadDir);
  assert.equal(ping.hostStatus.capabilities.pause, "resume-v1");

  // VERIFY_HISTORY sends stat for the seeded native record.
  assert.deepEqual(await send({ type: "VERIFY_HISTORY" }), { ok: true, checked: 1, missing: 0 });
  assert.deepEqual(outgoing.find((message) => message.type === "stat").paths, [`${downloadDir}/Seminar 3.mp4`]);

  // The fixture helper, evaluated as page script in the control tab (7).
  const pageChrome = { runtime: { sendMessage: (message) => send(message, 7) } };
  const evaluateInPage = (expression) => vm.runInNewContext(expression, { chrome: pageChrome, String });
  // Addresses the worker would fetch before starting are refused up front,
  // and nothing reaches the worker.
  for (const url of ["https://example.com/live/index.m3u8", "https://example.com/stream.mpd", "https://example.com/watch?v=1"]) {
    await assert.rejects(startFixtureDownloads(evaluateInPage, [{ url }]), /not a direct video or audio address/);
  }
  assert.equal(outgoing.filter((message) => message.type === "download").length, 0);
  const replies = await startFixtureDownloads(evaluateInPage);
  assert.equal(replies.length, 2);
  for (const reply of replies) {
    assert.equal(reply.ok, true, reply.error);
    assert.equal(reply.method, "native");
    assert.match(reply.jobId, /^[0-9a-f-]{36}$/);
  }
  const downloads = outgoing.filter((message) => message.type === "download");
  assert.deepEqual(downloads.map((message) => [message.url, message.mediaKind, message.filename]), [
    ["https://example.com/talks/lecture-12-pharmacokinetics.mp4", "video", "lecture-12-pharmacokinetics.mp4"],
    ["https://example.com/media/keynote-2026.mp4", "video", "keynote-2026.mp4"]
  ]);

  const lecture = await poll(async () => {
    const job = await jobNamed("lecture-12-pharmacokinetics.mp4");
    return job?.status === "downloading" && job.progress === 0.62 ? job : null;
  }, "lecture at hold");
  assert.equal(lecture.jobId, replies[0].jobId);
  assert.equal(lecture.method, "native");
  assert.equal(lecture.total, 0, "a stream counted in parts has no known size, as with host.py");
  assert.equal(lecture.bytes, Math.round(0.62 * 812_000_000));
  assert.ok(lecture.speed > 0);
  assert.equal(lecture.pausable, true, "capabilities.pause makes the job pausable");
  assert.equal(lecture.message, "分片 59/96");
  const keynote = await poll(async () => {
    const job = await jobNamed("keynote-2026.mp4");
    return job?.status === "downloading" && job.progress === 0.31 ? job : null;
  }, "keynote at hold");
  assert.equal(keynote.total, 812_000_000);
  assert.equal(keynote.pausable, true);
  // host.py's empty progress message for a direct file keeps the worker's
  // queued text on the job for the whole transfer.
  assert.equal(keynote.message, "等待本地引擎");

  const lectureUpdates = uiMessages.filter((message) => message.type === "JOB_UPDATED" && message.job.jobId === lecture.jobId && message.job.status === "downloading");
  assert.ok(lectureUpdates.length >= 6, "the Downloads page gets a stream of JOB_UPDATED broadcasts");
  assert.ok(new Set(lectureUpdates.map((message) => message.job.speed)).size >= 4, "with varying speeds for its graph");

  // Pause -> pausing -> paused with a resume recipe.
  const pauseReply = await send({ type: "PAUSE_JOB", jobId: lecture.jobId });
  assert.deepEqual(pauseReply, { ok: true, status: "pausing" });
  const paused = await poll(async () => {
    const job = await jobNamed("lecture-12-pharmacokinetics.mp4");
    return job?.status === "paused" ? job : null;
  }, "lecture paused");
  assert.equal(paused.resumable, true, "the recipe survives, so 继续 is offered");
  assert.equal(paused.message, PAUSED_MESSAGE);
  assert.equal(paused.progress, 0.62);

  // Resume -> a new job that continues from the checkpoint.
  const resumeReply = await send({ type: "RESUME_JOB", jobId: lecture.jobId });
  assert.equal(resumeReply.ok, true, resumeReply.error);
  assert.equal(resumeReply.replaced, lecture.jobId);
  assert.notEqual(resumeReply.jobId, lecture.jobId);
  assert.equal(outgoing.filter((message) => message.type === "download").at(-1).filename, "lecture-12-pharmacokinetics.mp4");
  const resumed = await poll(async () => {
    const job = (await jobsNow()).find((item) => item.jobId === resumeReply.jobId);
    return job?.status === "downloading" ? job : null;
  }, "resumed lecture");
  assert.equal(resumed.progress, 0.62);

  // Cancel a running job -> the engine's cancelled event ends it in history.
  assert.deepEqual(await send({ type: "CANCEL_JOB", jobId: resumed.jobId }), { ok: true });
  await poll(async () => (await send({ type: "GET_HISTORY" })).items.find((item) => item.jobId === resumed.jobId && item.status === "cancelled"), "cancelled record");

  // Reloading the tab that sent DOWNLOAD_URL drops its cards, so a paused job
  // from it can no longer resume. Hence startFixtureDownloads wants a control
  // tab that stays put, not the Downloads page being captured.
  await send({ type: "PAUSE_JOB", jobId: keynote.jobId });
  await poll(async () => (await jobNamed("keynote-2026.mp4"))?.status === "paused", "keynote paused");
  for (const listener of globalThis.chrome.tabs.onUpdated.listeners) listener(7, { status: "loading" });
  await delay(50);
  const staleResume = await send({ type: "RESUME_JOB", jobId: keynote.jobId });
  assert.equal(staleResume.ok, false);
  assert.match(staleResume.error, /来源页面的媒体信息已失效/);

  // Cancel a paused job -> the worker discards its leftovers with the engine.
  await send({ type: "CANCEL_JOB", jobId: keynote.jobId });
  await poll(() => outgoing.find((message) => message.type === "discard" && message.filename === "keynote-2026.mp4"), "discard request");

  // File actions on the seeded record and the folder button go to the engine.
  assert.deepEqual(await send({ type: "FILE_ACTION", action: "reveal", jobId: "seed-1" }), { ok: true, via: "native" });
  assert.deepEqual(await send({ type: "FILE_ACTION", action: "open", jobId: "seed-1" }), { ok: true, via: "native" });
  assert.deepEqual(await send({ type: "OPEN_DOWNLOAD_FOLDER" }), { ok: true, opened: "native" });

  // Without options.filename the job is named after the sending tab's title,
  // not after the URL.
  const unnamed = await send({ type: "DOWNLOAD_URL", url: "https://example.com/talks/lecture-12-pharmacokinetics.mp4", options: {} }, 8);
  assert.equal(unnamed.ok, true, unnamed.error);
  assert.equal(outgoing.filter((message) => message.type === "download").at(-1).filename, "Havre 下载记录.mp4");
  // A scenario message replaces the empty one.
  const unnamedJob = await poll(async () => {
    const job = (await jobsNow()).find((item) => item.jobId === unnamed.jobId);
    return job?.status === "downloading" && job.progress === 0.62 ? job : null;
  }, "unnamed job downloading");
  assert.equal(unnamedJob.message, "下载中");
  await send({ type: "CANCEL_JOB", jobId: unnamed.jobId });

  assert.equal(children.length, 1, "one engine process served the whole session");
  assert.equal(children[0].exitCode, null, "and it is still running");
  assert.deepEqual(fetchCalls, [], "the whole session ran without a network request");
});
