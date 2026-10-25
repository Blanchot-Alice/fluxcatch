#!/usr/bin/env node
// Havre live harness: real websites, real downloads, through Chrome for
// Testing with the unpacked extension and this checkout's native engine.
//
//   node tools/live/live.mjs --case direct-mp4,hls,dash,bilibili [--headed] [--keep] [--finder]
//
// What it does per case: open the page in a fresh profile, start playback,
// wait for Havre to detect media, screenshot the popup, start a download
// with the lowest quality, poll the job to its end, then check the history
// record, the file on disk (ffprobe) and the downloads page rendering.
//
// Side effects on this machine: none outside the run's own folders. The
// disposable Chrome profile carries a native-messaging registration that runs
// native-host/host.py with HAVRE_DOWNLOAD_DIR inside the output folder;
// the user's Chrome, profile and installed engine are never touched.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const SOURCE_EXTENSION = path.join(ROOT, "extension");
const HOST_NAME = "io.github.blanchot_alice.havre";
const START_TIMEOUT_MS = 25_000;
const POLL_INTERVAL_MS = 250;

const CASES = {
  "direct-mp4": {
    title: "Direct MP4 via <video> (W3Schools HTML5 video example)",
    url: "https://www.w3schools.com/html/html5_video.asp",
    expectKind: "video",
    play: true,
    detectTimeoutMs: 60_000,
    downloadTimeoutMs: 240_000
  },
  hls: {
    title: "HLS master via hls.js demo (Mux test stream)",
    url: "https://hlsjs.video-dev.org/demo/?src=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8",
    expectKind: "hls",
    play: true,
    preferLowestQuality: true,
    detectTimeoutMs: 75_000,
    downloadTimeoutMs: 600_000
  },
  dash: {
    title: "DASH MPD via dash.js getting-started sample (auto-load, muted autoplay)",
    url: "https://reference.dashif.org/dash.js/latest/samples/getting-started/auto-load-single-video.html",
    expectKind: "dash",
    play: true,
    preferLowestQuality: true,
    detectTimeoutMs: 75_000,
    downloadTimeoutMs: 600_000
  },
  bilibili: {
    title: "Bilibili DASH pair (public video, anonymous ladder)",
    url: "https://www.bilibili.com/video/BV1xx411c7mD/",
    expectKind: "dash_pair",
    play: true,
    preferLowestQuality: true,
    detectTimeoutMs: 90_000,
    downloadTimeoutMs: 600_000
  }
};

const options = parseArgs(process.argv.slice(2));
const runId = `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomBytes(2).toString("hex")}`;
const OUT = path.resolve(options.out || path.join(HERE, "out", runId));
const FILES_DIR = path.join(OUT, "files");
const SHOTS_DIR = path.join(OUT, "screenshots");
fs.mkdirSync(FILES_DIR, { recursive: true });
fs.mkdirSync(SHOTS_DIR, { recursive: true });
const logStream = fs.createWriteStream(path.join(OUT, "live.log"), { flags: "a" });
const report = { runId, startedAt: new Date().toISOString(), out: OUT, chrome: {}, cases: [] };

function log(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.map((part) => typeof part === "string" ? part : JSON.stringify(part)).join(" ")}`;
  console.log(line);
  logStream.write(`${line}\n`);
}

function parseArgs(argv) {
  const parsed = { cases: ["direct-mp4"], headed: false, keep: false, finder: false, out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--case") parsed.cases = String(argv[++index] || "").split(",").map((item) => item.trim()).filter(Boolean);
    else if (arg === "--headed") parsed.headed = true;
    else if (arg === "--keep") parsed.keep = true;
    else if (arg === "--finder") parsed.finder = true;
    else if (arg === "--out") parsed.out = String(argv[++index] || "");
  }
  if (parsed.cases.includes("all")) parsed.cases = Object.keys(CASES);
  return parsed;
}

// ---------------------------------------------------------------------------
// Chrome discovery / launch / CDP (mirrors e2e/run.mjs)
// ---------------------------------------------------------------------------
function walk(root, maxDepth) {
  const found = [];
  (function visit(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full, depth + 1);
      else if (entry.isFile()) found.push(full);
    }
  })(root, 0);
  return found;
}

function discoverChrome() {
  const candidates = [];
  if (process.env.CHROME_PATH) candidates.push(process.env.CHROME_PATH);
  for (const file of walk(path.join(os.homedir(), "Library", "Caches", "ms-playwright"), 8)) {
    if (file.endsWith("/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing")) candidates.push(file);
  }
  candidates.push("/Applications/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing");
  const usable = [...new Set(candidates)].filter((candidate) => {
    try { fs.accessSync(candidate, fs.constants.X_OK); return true; } catch { return false; }
  });
  usable.sort((a, b) => rank(b) - rank(a) || b.localeCompare(a));
  if (!usable.length) throw new Error("Chrome for Testing was not found (set CHROME_PATH)");
  return usable[0];
  function rank(candidate) {
    return (candidate.includes("Google Chrome for Testing") ? 1_000_000 : 0) + Number(candidate.match(/ms-playwright\/chromium-(\d+)/)?.[1] || 0);
  }
}

function launchChrome(executable, profile, extensionDir) {
  const args = [
    ...(options.headed ? [] : ["--headless=new"]),
    "--lang=zh-CN",
    "--window-size=1280,900",
    "--remote-debugging-port=0",
    "--remote-allow-origins=*",
    `--user-data-dir=${profile}`,
    `--disable-extensions-except=${extensionDir}`,
    `--load-extension=${extensionDir}`,
    "--autoplay-policy=no-user-gesture-required",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-default-apps",
    "--disable-sync",
    "--metrics-recording-only",
    "--password-store=basic",
    "--use-mock-keychain",
    "about:blank"
  ];
  const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
  const stderr = [];
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => fail(new Error(`Chrome did not expose DevTools within ${START_TIMEOUT_MS} ms\n${stderr.slice(-30).join("")}`)), START_TIMEOUT_MS);
    const onExit = (code, signal) => fail(new Error(`Chrome exited early (code=${code}, signal=${signal})\n${stderr.slice(-30).join("")}`));
    const fail = (error) => { clearTimeout(timeout); child.stderr.off("data", onData); child.off("exit", onExit); reject(error); };
    const onData = (chunk) => {
      stderr.push(chunk.toString());
      if (stderr.length > 200) stderr.shift();
      const match = stderr.join("").match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timeout);
      child.off("exit", onExit);
      const parsed = new URL(match[1]);
      resolve({ process: child, browserWebSocketUrl: match[1], httpOrigin: `http://${parsed.host}` });
    };
    child.stderr.on("data", onData);
    child.once("exit", onExit);
    child.once("error", fail);
  });
}

class CdpClient {
  static async connect(url) { const client = new CdpClient(url); await client.open(); return client; }
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); }
  open() {
    this.socket = new WebSocket(this.url);
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting to ${this.url}`)), START_TIMEOUT_MS);
      this.socket.addEventListener("open", () => { clearTimeout(timeout); resolve(); }, { once: true });
      this.socket.addEventListener("error", () => { clearTimeout(timeout); reject(new Error(`WebSocket error ${this.url}`)); }, { once: true });
      this.socket.addEventListener("message", (event) => this.onMessage(event));
      this.socket.addEventListener("close", () => this.rejectPending(new Error("CDP socket closed")));
    });
  }
  send(method, params = {}, timeoutMs = START_TIMEOUT_MS) {
    if (this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error(`CDP socket not open for ${method}`));
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, timeoutMs);
      this.pending.set(id, { resolve, reject, timeout, method });
    });
  }
  onMessage(event) {
    let message;
    try { message = JSON.parse(String(event.data)); } catch { return; }
    if (!message.id) return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timeout);
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(`${pending.method}: ${message.error.message}`));
    else pending.resolve(message.result || {});
  }
  rejectPending(error) { for (const pending of this.pending.values()) { clearTimeout(pending.timeout); pending.reject(error); } this.pending.clear(); }
  close() { this.rejectPending(new Error("closed")); try { this.socket?.close(); } catch { /* closed */ } }
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function poll(operation, timeoutMs, label, intervalMs = POLL_INTERVAL_MS) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  do {
    try { const value = await operation(); if (value) return value; } catch (error) { lastError = error; }
    await delay(intervalMs);
  } while (Date.now() < deadline);
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function listTargets(origin) {
  const response = await fetch(`${origin}/json/list`, { cache: "no-store" });
  if (!response.ok) throw new Error(`DevTools list HTTP ${response.status}`);
  return response.json();
}

async function waitForTarget(origin, predicate, timeoutMs, label) {
  return poll(async () => (await listTargets(origin)).find(predicate) || null, timeoutMs, label);
}

async function evaluate(client, expression) {
  const response = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true }, 60_000);
  if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text || "evaluate failed");
  if (response.result?.subtype === "error") throw new Error(response.result.description || "evaluate error");
  return response.result?.value;
}

function extensionIdFromManifestKey(key) {
  const digest = crypto.createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...digest].map((char) => String.fromCharCode("a".charCodeAt(0) + parseInt(char, 16))).join("");
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise((resolve) => child.once("exit", resolve)), delay(3000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

// ---------------------------------------------------------------------------
// Test fixtures: extension copy, native host registration
// ---------------------------------------------------------------------------
function prepareExtension() {
  const dir = path.join(OUT, "extension");
  fs.cpSync(SOURCE_EXTENSION, dir, { recursive: true });
  const manifestPath = path.join(dir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // Optional permissions need a user-gesture prompt Chrome cannot show
  // unattended; the live build grants them up front. The key (and so the
  // extension ID the native host trusts) stays identical.
  const optional = new Set(manifest.optional_permissions || []);
  manifest.permissions = [...new Set([...(manifest.permissions || []), "nativeMessaging", "notifications"])];
  manifest.optional_permissions = [...optional].filter((item) => !manifest.permissions.includes(item));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return { dir, id: extensionIdFromManifestKey(manifest.key), version: manifest.version };
}

// Chrome resolves user-level native messaging hosts relative to the user data
// directory (the default profile location is why they normally live under
// ~/Library/Application Support/Google/Chrome). With a disposable
// --user-data-dir the registration therefore goes inside that profile, and
// nothing outside the run's own folders is modified.
function registerNativeHost(extensionId, profile) {
  const registrationDir = path.join(profile, "NativeMessagingHosts");
  fs.mkdirSync(registrationDir, { recursive: true });
  const manifestPath = path.join(registrationDir, `${HOST_NAME}.json`);
  const launcher = path.join(OUT, "host-launcher.sh");
  const ffmpeg = ["/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg"].find((candidate) => fs.existsSync(candidate)) || "ffmpeg";
  const python = ["/opt/homebrew/bin/python3", "/usr/bin/python3"].find((candidate) => fs.existsSync(candidate)) || "python3";
  fs.writeFileSync(launcher, [
    "#!/bin/sh",
    `export HAVRE_FFMPEG=${shellQuote(ffmpeg)}`,
    `export HAVRE_DOWNLOAD_DIR=${shellQuote(FILES_DIR)}`,
    `exec ${shellQuote(python)} ${shellQuote(path.join(ROOT, "native-host", "host.py"))} "$@"`,
    ""
  ].join("\n"));
  fs.chmodSync(launcher, 0o700);
  fs.writeFileSync(manifestPath, `${JSON.stringify({
    name: HOST_NAME,
    description: "Havre local download engine (live harness)",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  }, null, 2)}\n`);
  return manifestPath;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

function ffprobe(file) {
  const binary = ["/opt/homebrew/bin/ffprobe", "/usr/local/bin/ffprobe"].find((candidate) => fs.existsSync(candidate));
  if (!binary) return null;
  const result = spawnSync(binary, ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", file], { encoding: "utf8", timeout: 20_000 });
  if (result.status !== 0) return { error: (result.stderr || "ffprobe failed").trim().slice(0, 300) };
  try {
    const data = JSON.parse(result.stdout);
    const video = (data.streams || []).find((stream) => stream.codec_type === "video");
    const audio = (data.streams || []).find((stream) => stream.codec_type === "audio");
    return {
      format: data.format?.format_name,
      duration: Number(data.format?.duration) || null,
      video: video ? `${video.codec_name} ${video.width}x${video.height}` : null,
      audio: audio ? `${audio.codec_name}` : null
    };
  } catch {
    return { error: "ffprobe output unreadable" };
  }
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------
async function main() {
  const executable = discoverChrome();
  const extension = prepareExtension();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "havre-live-"));
  const registration = registerNativeHost(extension.id, profile);
  report.chrome = { executable, extensionId: extension.id, extensionVersion: extension.version, profile, headed: options.headed, nativeHostRegistration: registration };
  log("Chrome:", executable);
  log("Extension:", extension.dir, "id", extension.id);
  log("Native host registration:", registration);
  log("Files land in:", FILES_DIR);

  let chrome;
  let browser;
  let control;
  const cleanups = [];
  try {
    chrome = await launchChrome(executable, profile, extension.dir);
    browser = await CdpClient.connect(chrome.browserWebSocketUrl);
    await waitForTarget(chrome.httpOrigin, (target) => target.type === "service_worker" && target.url === `chrome-extension://${extension.id}/background.js`, START_TIMEOUT_MS, "service worker");
    const { targetId } = await browser.send("Target.createTarget", { url: `chrome-extension://${extension.id}/options/options.html`, background: true });
    const controlTarget = await waitForTarget(chrome.httpOrigin, (target) => target.id === targetId, START_TIMEOUT_MS, "control page");
    control = await CdpClient.connect(controlTarget.webSocketDebuggerUrl);
    await control.send("Runtime.enable");
    const call = (fnSource) => evaluate(control, `(${fnSource})()`);
    await call(`async () => chrome.storage.local.set({ "havre.uiLanguage.v1": "zh" })`);
    const diagnostics = await call(`async () => chrome.runtime.sendMessage({ type: "GET_DIAGNOSTICS" })`);
    log("Diagnostics:", { version: diagnostics?.diagnostics?.extension?.version, channel: diagnostics?.diagnostics?.extension?.channel });
    const host = await call(`async () => chrome.runtime.sendMessage({ type: "PING_HOST" })`);
    log("Host status:", { connected: host?.hostStatus?.connected, version: host?.hostStatus?.version, ffmpeg: host?.hostStatus?.ffmpeg, downloadDir: host?.hostStatus?.downloadDir, failure: host?.hostStatus?.failureReason, lastError: host?.hostStatus?.lastError });
    report.host = host?.hostStatus || null;
    if (!host?.hostStatus?.connected) throw new Error(`native host did not connect: ${host?.hostStatus?.lastError || host?.hostStatus?.failureReason || "unknown"}`);

    for (const name of options.cases) {
      const spec = CASES[name];
      if (!spec) { log(`Unknown case ${name}`); continue; }
      const result = { name, title: spec.title, url: spec.url, status: "running", steps: [] };
      report.cases.push(result);
      try {
        await runCase(name, spec, result, { browser, call, chrome, extension });
        result.status = result.steps.some((step) => step.ok === false) ? "failed" : "passed";
      } catch (error) {
        result.status = "failed";
        result.error = error?.message || String(error);
        log(`CASE ${name} FAILED:`, result.error);
      } finally {
        if (Number.isInteger(result.tabId)) {
          try { await call(`async () => chrome.tabs.remove(${result.tabId})`); } catch { /* already closed */ }
        }
      }
      log(`CASE ${name}: ${result.status}`);
    }

    // Final captures: downloads page with every record of this run, the Side
    // Panel workbench and the settings page with the save-location row.
    await capturePage(browser, chrome.httpOrigin, `chrome-extension://${extension.id}/downloads/downloads.html`, path.join(SHOTS_DIR, "downloads-page.png"), { width: 1100, height: 820, wait: 2500 });
    await capturePage(browser, chrome.httpOrigin, `chrome-extension://${extension.id}/sidepanel/sidepanel.html`, path.join(SHOTS_DIR, "sidepanel.png"), { width: 420, height: 900, wait: 2500 });
    await capturePage(browser, chrome.httpOrigin, `chrome-extension://${extension.id}/options/options.html`, path.join(SHOTS_DIR, "options.png"), { width: 1100, height: 1400, wait: 3000 });
    const history = await call(`async () => chrome.runtime.sendMessage({ type: "GET_HISTORY" })`);
    report.history = (history?.items || []).map(summarizeRecord);
    const verify = await call(`async () => chrome.runtime.sendMessage({ type: "VERIFY_HISTORY" })`);
    report.verify = verify;
    log("History:", report.history);
    log("Verify:", verify);
    if (options.finder) {
      const opened = await call(`async () => chrome.runtime.sendMessage({ type: "OPEN_DOWNLOAD_FOLDER" })`);
      log("OPEN_DOWNLOAD_FOLDER:", opened);
    }
  } finally {
    try { control?.close(); } catch { /* ignore */ }
    try { await browser?.send("Browser.close", {}, 3000); } catch { /* ignore */ }
    try { browser?.close(); } catch { /* ignore */ }
    await stopProcess(chrome?.process);
    for (const cleanup of cleanups) cleanup();
    if (!options.keep) fs.rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
    log("Report:", path.join(OUT, "report.json"));
  }
  const failed = report.cases.filter((item) => item.status !== "passed");
  process.exitCode = failed.length ? 1 : 0;
}

function summarizeRecord(record) {
  return {
    jobId: record.jobId,
    filename: record.filename,
    status: record.status,
    size: record.size,
    media: record.media,
    thumbnail: record.thumbnail ? `${record.thumbnail.length} chars` : null,
    hasFile: record.hasFile,
    fileMissing: record.fileMissing,
    sourceHost: record.sourceHost,
    message: record.message,
    error: record.error
  };
}

async function runCase(name, spec, result, { browser, call, chrome, extension }) {
  const step = (label, ok, detail) => { result.steps.push({ label, ok, detail }); log(`  [${ok ? "ok" : "FAIL"}] ${name}: ${label}`, detail ?? ""); };

  const tab = await call(`async () => chrome.tabs.create({ url: ${JSON.stringify(spec.url)}, active: true })`);
  const tabId = tab.id;
  result.tabId = tabId;
  await poll(async () => (await call(`async () => chrome.tabs.get(${tabId})`))?.status === "complete", 60_000, "tab load", 500);
  step("page loaded", true, spec.url);
  await delay(1500);

  if (spec.play) {
    const played = await tryPlay(chrome.httpOrigin, tabId, call);
    step("playback started", played !== "no-video", played);
  }

  let media = null;
  try {
    media = await poll(async () => {
      const response = await call(`async () => chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: ${tabId} })`);
      const items = response?.items || [];
      if (!items.length) return null;
      if (spec.expectKind && !items.some((item) => item.kind === spec.expectKind)) return null;
      return response;
    }, spec.detectTimeoutMs, `media detection (${spec.expectKind})`, 1000);
  } catch (error) {
    const response = await call(`async () => chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: ${tabId} })`);
    media = response;
    step(`detected ${spec.expectKind}`, false, { error: error.message, items: (response?.items || []).map(summarizeCandidate) });
  }
  const items = media?.items || [];
  result.candidates = items.map(summarizeCandidate);
  if (items.length) step(`detected ${items.length} candidate(s)`, items.some((item) => item.kind === spec.expectKind) || !spec.expectKind, result.candidates.slice(0, 5));
  const badge = await call(`async () => ({ text: await chrome.action.getBadgeText({ tabId: ${tabId} }), title: await chrome.action.getTitle({ tabId: ${tabId} }) })`);
  step("badge", Boolean(badge?.text), badge);

  await capturePage(browser, chrome.httpOrigin, `chrome-extension://${extension.id}/popup/popup.html`, path.join(SHOTS_DIR, `${name}-popup-media.png`), { width: 372, height: 560, wait: 1800, activateTab: tabId, call });

  // SPA pages (Bilibili) can rewrite their URL right after load, which rotates
  // the tab generation and invalidates earlier candidate references. Settle,
  // then take the freshest reference right before probing and downloading.
  await delay(3000);
  const fresh = await call(`async () => chrome.runtime.sendMessage({ type: "GET_TAB_MEDIA", tabId: ${tabId} })`);
  const freshItems = fresh?.items?.length ? fresh.items : items;
  const candidate = freshItems.find((item) => item.kind === spec.expectKind) || freshItems[0];
  if (!candidate) throw new Error("nothing detected; cannot download");
  const reference = { id: candidate.id, kind: candidate.kind, generation: candidate.generation };
  const downloadOptions = { filename: `${name}-${runId}.mp4`, outputContainer: "mp4", outputFormat: "mp4", convert: false, extractAudio: false };
  if (["hls", "dash", "dash_pair"].includes(candidate.kind)) {
    try {
      const probe = await call(`async () => chrome.runtime.sendMessage({ type: "PROBE_MANIFEST", tabId: ${tabId}, candidate: ${JSON.stringify(reference)} })`);
      const variants = probe?.probe?.variants || [];
      result.variants = variants.map((variant) => ({ height: variant.height, bandwidth: variant.bandwidth, name: variant.name || "" }));
      step("probed quality ladder", true, { count: variants.length, heights: variants.map((variant) => variant.height) });
      if (spec.preferLowestQuality && variants.length) {
        const lowest = variants.slice().sort((a, b) => (a.height || 1e9) - (b.height || 1e9) || (a.bandwidth || 0) - (b.bandwidth || 0))[0];
        downloadOptions.variantUrl = lowest.url;
        step("chose lowest quality", true, { height: lowest.height, bandwidth: lowest.bandwidth });
      }
    } catch (error) {
      step("probed quality ladder", false, error.message);
    }
  }

  const started = Date.now();
  const download = await call(`async () => chrome.runtime.sendMessage({ type: "DOWNLOAD", tabId: ${tabId}, candidate: ${JSON.stringify(reference)}, options: ${JSON.stringify(downloadOptions)} })`);
  step("download accepted", Boolean(download?.ok), download);
  if (!download?.ok) return;
  const jobId = download.jobId;
  result.jobId = jobId;

  let lastLogged = 0;
  const finalJob = await poll(async () => {
    const response = await call(`async () => chrome.runtime.sendMessage({ type: "GET_JOBS" })`);
    const job = (response?.jobs || []).find((item) => item.jobId === jobId);
    if (!job) return null;
    if (Date.now() - lastLogged > 5000) {
      lastLogged = Date.now();
      log(`    ${name} job: ${job.status} ${(job.progress * 100).toFixed(1)}% ${job.speed ? `${(job.speed / 1048576).toFixed(2)} MiB/s` : ""} ${job.message || ""}`);
    }
    return ["completed", "failed", "cancelled"].includes(job.status) ? job : null;
  }, spec.downloadTimeoutMs, "job completion", 1000);
  result.job = { status: finalJob.status, message: finalJob.message, error: finalJob.error, total: finalJob.total, bytes: finalJob.bytes, elapsedMs: Date.now() - started, media: finalJob.media, thumbnail: finalJob.thumbnail ? `${finalJob.thumbnail.length} chars` : null, hasFile: finalJob.hasFile, retryable: finalJob.retryable };
  step("job finished", finalJob.status === "completed", result.job);

  const history = await call(`async () => chrome.runtime.sendMessage({ type: "GET_HISTORY" })`);
  const record = (history?.items || []).find((item) => item.jobId === jobId);
  result.record = record ? summarizeRecord(record) : null;
  step("history record", Boolean(record) && record.status === finalJob.status, result.record);

  if (finalJob.status === "completed") {
    const expectedFile = path.join(FILES_DIR, record?.filename || downloadOptions.filename);
    const exists = fs.existsSync(expectedFile);
    const size = exists ? fs.statSync(expectedFile).size : 0;
    const probe = exists ? ffprobe(expectedFile) : null;
    result.file = { path: expectedFile, exists, size, probe };
    step("file on disk", exists && size > 0 && !probe?.error, result.file);
    step("history has media facts", Boolean(record?.media?.duration), record?.media || null);
    step("history has poster frame", Boolean(record?.thumbnail), record?.thumbnail || null);
    const verify = await call(`async () => chrome.runtime.sendMessage({ type: "VERIFY_HISTORY" })`);
    step("engine confirms the file exists", verify?.checked >= 1 && verify?.missing === 0, verify);
  }

  await capturePage(browser, chrome.httpOrigin, `chrome-extension://${extension.id}/popup/popup.html`, path.join(SHOTS_DIR, `${name}-popup-jobs.png`), {
    width: 372, height: 560, wait: 1800, activateTab: tabId, call, before: `document.querySelector('[data-view="downloads"]')?.click()`
  });
  try { await call(`async () => chrome.tabs.remove(${tabId})`); } catch { /* closed */ }
}

function summarizeCandidate(item) {
  return { kind: item.kind, title: item.displayTitle || item.title || "", url: item.displayUrl, mime: item.mime, size: item.contentLength, site: item.site, provenance: item.provenance, groupSize: item.groupSize };
}

async function tryPlay(origin, tabId, call) {
  const tab = await call(`async () => chrome.tabs.get(${tabId})`);
  const pageTarget = (await listTargets(origin)).find((target) => target.type === "page" && target.url === tab.url)
    || (await listTargets(origin)).find((target) => target.type === "page" && target.url.startsWith(new URL(tab.url).origin));
  if (!pageTarget) return "no-page-target";
  const page = await CdpClient.connect(pageTarget.webSocketDebuggerUrl);
  try {
    await page.send("Runtime.enable");
    return await evaluate(page, `(async () => {
      const videos = [...document.querySelectorAll("video")];
      if (!videos.length) return "no-video";
      const video = videos.find((item) => item.offsetWidth > 0) || videos[0];
      video.muted = true;
      try { video.scrollIntoView({ block: "center" }); } catch {}
      // play() can stay pending forever on a stalled player; never let that
      // hang the harness.
      const outcome = await Promise.race([
        video.play().then(() => "ok", (error) => "play-failed: " + error.message),
        new Promise((resolve) => setTimeout(() => resolve("play-pending"), 6000))
      ]);
      await new Promise((resolve) => setTimeout(resolve, 2500));
      return outcome + " t=" + video.currentTime.toFixed(1) + " paused=" + video.paused + " src=" + (video.currentSrc || "").slice(0, 80);
    })()`);
  } finally {
    page.close();
  }
}

async function capturePage(browser, origin, url, file, { width, height, wait = 1000, activateTab = null, call = null, before = null } = {}) {
  if (activateTab !== null && call) {
    try { await call(`async () => chrome.tabs.update(${activateTab}, { active: true })`); } catch { /* tab gone */ }
  }
  const { targetId } = await browser.send("Target.createTarget", { url, background: true });
  const target = await waitForTarget(origin, (item) => item.id === targetId, START_TIMEOUT_MS, `page ${url}`);
  const client = await CdpClient.connect(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    await client.send("Page.enable");
    await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
    await poll(() => evaluate(client, `document.readyState === "complete"`), 15_000, "readyState");
    if (before) { await delay(600); await evaluate(client, before); }
    await delay(wait);
    const shot = await client.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }, 30_000);
    fs.writeFileSync(file, Buffer.from(shot.data, "base64"));
    log("  screenshot:", file);
  } finally {
    client.close();
    try { await browser.send("Target.closeTarget", { targetId }); } catch { /* closed */ }
  }
}

main().catch((error) => {
  log("FATAL:", error?.stack || error?.message || String(error));
  process.exitCode = 1;
});
