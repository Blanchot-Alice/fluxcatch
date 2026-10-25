// The background worker's user-facing text (design review §7 and the rename
// table): the UI language it resolves, notifications, the toolbar tooltip,
// worker-built labels, and the codes it sends with error answers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { FAILURE_CODES, classifyJobFailure, describeJobFailure } from "../extension/lib/job-failure.js";
import { UI_LANGUAGE_STORAGE_KEY, resolveUiLanguage, setUiLanguage } from "../extension/ui/v2/locale.js";
import workerMessages from "../extension/ui/v2/messages/worker.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const BACKGROUND = read("extension/background.js");
const CJK = /[㐀-鿿　-〿＀-￯]/;
const EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(fn) { listeners.push(fn); },
    emit(...args) { for (const fn of listeners) fn(...args); }
  };
}

let loads = 0;

/**
 * Load a fresh copy of background.js against a small chrome stub.
 * Restored session jobs give the worker downloads to finish or fail.
 */
async function loadWorker({ chromeLanguage = "en-US", preference, sessionJobs = [], downloadItems = {}, nativePermission = false, platform = "mac", storedLocal = {}, connectNativeError = null, openTabs = [{ id: 3 }], tabTitle = "Fixture" } = {}) {
  const notifications = [];
  const cleared = [];
  const createdTabs = [];
  const badgeColors = [];
  const badgeTextColors = [];
  const titles = [];
  const nativeListeners = { message: event(), disconnect: event() };
  const nativeOutgoing = [];
  const local = { settings: { showNotifications: true }, ...structuredClone(storedLocal) };
  if (preference !== undefined) local[UI_LANGUAGE_STORAGE_KEY] = preference;
  const session = { jobs: sessionJobs };
  const onMessage = event();
  const storageChanged = event();
  const downloadsChanged = event();
  const tabActivated = event();
  const notificationClicked = event();
  const notificationButtonClicked = event();
  const fetches = [];
  globalThis.fetch = async (url) => {
    fetches.push(String(url));
    return { ok: false, status: 404, url: String(url), headers: { get: () => null }, text: async () => "" };
  };
  globalThis.chrome = {
    i18n: { getUILanguage: () => chromeLanguage },
    webRequest: { onBeforeSendHeaders: event(), onHeadersReceived: event(), onCompleted: event(), onErrorOccurred: event() },
    runtime: {
      id: EXTENSION_ID,
      getURL: (path = "") => `chrome-extension://${EXTENSION_ID}/${path}`,
      getManifest: () => ({ name: "Havre", version: "0.3.0" }),
      getPlatformInfo: async () => ({ os: platform, arch: "arm64" }),
      onConnect: event(),
      onMessage,
      lastError: null,
      connectNative: () => {
        if (connectNativeError) throw new Error(connectNativeError);
        return {
        onMessage: nativeListeners.message,
        onDisconnect: nativeListeners.disconnect,
        disconnect: () => {},
        postMessage: (message) => {
          nativeOutgoing.push(message);
          if (message.type === "ping") queueMicrotask(() => nativeListeners.message.emit({
            type: "pong", requestId: message.requestId, version: "0.3.0", protocolVersion: 1, capabilityProfileVersion: 1,
            ffmpeg: true, capabilities: { ffmpeg: { available: true, demuxers: { hls: true, dash: false }, encoders: { libmp3lame: true } }, dashPlanner: "static-v1", dashPair: "direct-v1", pause: "resume-v1" }
          }));
        }
        };
      }
    },
    tabs: {
      onRemoved: event(),
      onUpdated: event(),
      onActivated: tabActivated,
      get: async (tabId) => ({ id: tabId, title: tabTitle, url: "https://page.example.tv/watch" }),
      // Only tab 3 is active; openTabs are all the tabs that are open.
      query: async (filter = {}) => (filter.active ? [{ id: 3 }] : structuredClone(openTabs)),
      sendMessage: async () => ({ ok: true }),
      create: async (options) => { createdTabs.push(structuredClone(options)); return { id: 99 }; }
    },
    downloads: {
      onChanged: downloadsChanged,
      search: async ({ id }) => (downloadItems[id] ? [structuredClone(downloadItems[id])] : []),
      download: async () => 1
    },
    notifications: {
      create: async (id, options) => {
        notifications.push({ id, options: structuredClone(options) });
        return id;
      },
      clear: async (id) => { cleared.push(id); return true; },
      onClicked: notificationClicked,
      onButtonClicked: notificationButtonClicked
    },
    storage: {
      session: { get: async () => structuredClone(session), set: async (value) => Object.assign(session, structuredClone(value)) },
      local: {
        get: async () => structuredClone(local),
        set: async (value) => Object.assign(local, structuredClone(value)),
        remove: async (key) => { delete local[key]; }
      },
      onChanged: storageChanged
    },
    permissions: { contains: async ({ permissions = [] } = {}) => (permissions.includes("notifications") ? true : nativePermission), onAdded: event(), onRemoved: event() },
    action: {
      setBadgeText: async () => {},
      setBadgeBackgroundColor: async (value) => badgeColors.push(value),
      setBadgeTextColor: async (value) => badgeTextColors.push(value),
      setTitle: async (value) => titles.push(value)
    }
  };
  loads += 1;
  await import(`../extension/background.js?worker-i18n=${loads}`);
  for (let index = 0; index < 20; index += 1) await tick();
  const extensionSender = { id: EXTENSION_ID, url: `chrome-extension://${EXTENSION_ID}/downloads/downloads.html` };
  const send = (message, sender = extensionSender) => new Promise((resolve) => onMessage.listeners.at(-1)(message, sender, resolve));
  const settle = async (rounds = 30) => { for (let index = 0; index < rounds; index += 1) await tick(); };
  const titleFor = async (tabId) => {
    const before = titles.length;
    tabActivated.emit({ tabId });
    for (let index = 0; index < 50 && titles.length === before; index += 1) await tick();
    return titles.filter((entry) => entry.tabId === tabId).at(-1)?.title;
  };
  return { notifications, cleared, createdTabs, badgeColors, badgeTextColors, notificationClicked, notificationButtonClicked, titles, send, settle, titleFor, downloadsChanged, storageChanged, nativeListeners, nativeOutgoing, fetches };
}

const activeBrowserJob = (id, filename, progress = 0.42) => ({
  jobId: `browser:${id}`, method: "browser", downloadId: id, filename, status: "downloading", progress,
  bytes: 1, total: 2_200_000_000, createdAt: Date.now() - 5_000, updatedAt: Date.now() - 1_000
});
const inProgress = (filename) => ({ state: "in_progress", paused: false, bytesReceived: 1, totalBytes: 2_200_000_000, filename });

// ---------- 1. language ----------

test("the worker keeps the storage key ui/v2/locale.js saves and resolves Auto exactly as locale.js does", () => {
  assert.equal(/^const UI_LANGUAGE_STORAGE_KEY = "([^"]+)";$/m.exec(BACKGROUND)?.[1], UI_LANGUAGE_STORAGE_KEY);
  // locale.js: resolveUiLanguage(pref, chrome.i18n.getUILanguage() || "zh-CN").
  for (const [pref, chromeLanguage] of [["auto", "en-US"], ["auto", "en-GB"], ["auto", "zh-CN"], ["auto", "zh-TW"], ["auto", "fr"], ["en", "zh-CN"], ["zh", "en-US"], [undefined, "de"]]) {
    const expected = resolveUiLanguage(pref ?? "auto", chromeLanguage);
    assert.ok(["en", "zh"].includes(expected), `${pref} on ${chromeLanguage}`);
  }
});

test("Auto follows Chrome's UI language: English Chrome gets English, Chinese Chrome gets Chinese", async () => {
  for (const [chromeLanguage, preference, expected] of [
    ["en-US", "auto", "en"],
    ["en-GB", undefined, "en"],
    ["fr-FR", "auto", "en"],
    ["zh-CN", "auto", "zh"],
    ["zh-TW", "auto", "zh"],
    ["en-US", "zh", "zh"],
    ["zh-CN", "en", "en"],
    ["en-US", "something-else", "en"]
  ]) {
    assert.equal(resolveUiLanguage(preference === "something-else" ? "auto" : preference ?? "auto", chromeLanguage), expected, "the shared rule agrees");
    const worker = await loadWorker({ chromeLanguage, preference });
    const title = await worker.titleFor(3);
    const table = expected === "en" ? workerMessages.en : workerMessages.zh;
    assert.equal(title, table["worker.action.none"], `${chromeLanguage} · ${preference}`);
  }
});

test("the worker follows a language change at once, tooltips included", async () => {
  const worker = await loadWorker({ chromeLanguage: "en-US", preference: "auto" });
  assert.equal(await worker.titleFor(3), "Havre · No downloadable media on this page yet");
  const before = worker.titles.length;
  worker.storageChanged.emit({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "zh", oldValue: "auto" } }, "local");
  for (let index = 0; index < 50 && worker.titles.length === before; index += 1) await tick();
  assert.equal(worker.titles.at(-1)?.title, "Havre · 此页还没有可下载的媒体", "the open tab's tooltip is rewritten in Chinese");
  worker.storageChanged.emit({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "auto" } }, "local");
  assert.equal(await worker.titleFor(3), "Havre · No downloadable media on this page yet", "back to Auto, back to Chrome's English");
  worker.storageChanged.emit({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "zh" } }, "sync");
  assert.equal(await worker.titleFor(3), "Havre · No downloadable media on this page yet", "only chrome.storage.local carries the preference");
});

// ---------- 2. notifications ----------

test("a failed download notifies in the UI language with the job-failure reason, never Chrome's code", async () => {
  for (const [chromeLanguage, lang] of [["en-US", "en"], ["zh-CN", "zh"]]) {
    const worker = await loadWorker({
      chromeLanguage,
      sessionJobs: [activeBrowserJob(7, "Lecture 12 · Pharmacokinetics.mp4")],
      downloadItems: { 7: inProgress("/Volumes/T7/Private Folder/Lecture 12 · Pharmacokinetics.mp4") }
    });
    worker.downloadsChanged.emit({ id: 7, state: { current: "interrupted" }, error: { current: "NETWORK_FAILED" } });
    await worker.settle();
    const notice = worker.notifications.find((entry) => entry.id === "havre:browser:7:failed");
    assert.ok(notice, `${lang}: one failure notification`);
    const reason = describeJobFailure(classifyJobFailure({ text: "NETWORK_FAILED" }), lang);
    assert.equal(notice.options.title, workerMessages[lang]["worker.notify.failedTitle"]);
    assert.equal(notice.options.message, `Lecture 12 · Pharmacokinetics.mp4\n${reason}`);
    assert.doesNotMatch(JSON.stringify(notice.options), /NETWORK_FAILED|Volumes|Private Folder/);
    if (lang === "en") assert.doesNotMatch(JSON.stringify(notice.options), CJK);
  }
});

test("a finished download notifies with the file name and a decimal meta line, in English or Chinese", async () => {
  for (const [chromeLanguage, title, meta] of [["en-US", "Download finished", "MP4 · 2.2 GB"], ["zh-CN", "下载完成", "MP4 · 2.2 GB"]]) {
    const worker = await loadWorker({
      chromeLanguage,
      sessionJobs: [activeBrowserJob(8, "Lecture 13.mp4")],
      downloadItems: { 8: inProgress("/Volumes/T7/Private Folder/Lecture 13.mp4") }
    });
    worker.downloadsChanged.emit({ id: 8, state: { current: "complete" }, bytesReceived: { current: 2_200_000_000 }, totalBytes: { current: 2_200_000_000 }, filename: { current: "/Volumes/T7/Private Folder/Lecture 13.mp4" } });
    await worker.settle();
    const notice = worker.notifications.find((entry) => entry.id === "havre:browser:8:completed");
    assert.ok(notice, chromeLanguage);
    assert.equal(notice.options.title, title);
    assert.equal(notice.options.message, `Lecture 13.mp4\n${meta}`, "no “Saved” word, sizes in GB like Finder");
    assert.deepEqual(notice.options.buttons.map((button) => button.title), chromeLanguage === "en-US" ? ["Show in Finder", "Open"] : ["在 Finder 中显示", "打开"]);
    assert.doesNotMatch(JSON.stringify(notice.options), /Volumes|Private Folder|GiB|已保存/);
  }
});

test("an engine failure notification shows the localised reason: no engine text, link or folder name", async () => {
  const worker = await loadWorker({ chromeLanguage: "en-US", nativePermission: true });
  const ping = await worker.send({ type: "PING_HOST" });
  assert.equal(ping.ok, true, ping.error);
  assert.equal(ping.hostStatus.connected, true);
  const raw = "HLS media segment 11 failed: HTTP 403 for https://cdn.example.tv/private/path/seg-12.ts?token=SECRET_TOKEN";
  worker.nativeListeners.message.emit({ type: "failed", jobId: "engine-job-1", filename: "Clip.mp4", error: raw });
  await worker.settle();
  const notice = worker.notifications.find((entry) => entry.id === "havre:engine-job-1:failed");
  assert.ok(notice, "the failure is announced");
  assert.equal(notice.options.title, "Download failed");
  assert.equal(notice.options.message, "Clip.mp4\nThe site refused to send part 12 of the video (HTTP 403) after 5 retries. Refresh the page, play the video once, then retry.");
  assert.doesNotMatch(JSON.stringify(notice.options), /https?:|SECRET|private|segment|HLS|cdn\.example/);

  // A save folder on another drive never reaches the record or the notification.
  worker.nativeListeners.message.emit({ type: "failed", jobId: "engine-job-2", filename: "Clip 2.mp4", error: "HLS media segment 3 failed: [Errno 28] No space left on device: '/Volumes/T7/Period Dramas/havre-hls-3f/media/00000003.ts.tmp'" });
  await worker.settle();
  const disk = worker.notifications.find((entry) => entry.id === "havre:engine-job-2:failed");
  assert.equal(disk.options.message, `Clip 2.mp4\n${describeJobFailure({ code: "disk_full" }, "en")}`);
  const jobs = (await worker.send({ type: "GET_JOBS" })).jobs;
  const stored = jobs.find((job) => job.jobId === "engine-job-2");
  assert.ok(stored);
  assert.doesNotMatch(`${stored.message} ${stored.error}`, /Volumes|T7|Period|havre-hls/, "the stored record hides the folder names");
});

test("notification and tooltip code paths hold no Chinese literals and no v1 translator calls", () => {
  for (const name of ["maybeNotifyJob", "notifySelfHealOutcome", "completionSummary", "jobFailureText", "updateBadge", "workerText"]) {
    const start = BACKGROUND.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `${name} exists`);
    let depth = 0;
    let body = "";
    for (let index = BACKGROUND.indexOf("{", start); index < BACKGROUND.length; index += 1) {
      if (BACKGROUND[index] === "{") depth += 1;
      else if (BACKGROUND[index] === "}" && --depth === 0) { body = BACKGROUND.slice(start, index + 1); break; }
    }
    assert.ok(!CJK.test(body), `${name} has no CJK copy`);
    assert.doesNotMatch(body, /\btr\(|translateMessage|humanBytes/, `${name} uses worker.js and decimal units`);
  }
});

// ---------- 3. tooltip plurals and worker-built labels ----------

test("the toolbar tooltip pluralises with Intl and names downloads, not jobs", async () => {
  const one = await loadWorker({ chromeLanguage: "en-US", sessionJobs: [activeBrowserJob(11, "a.mp4", 0.42)], downloadItems: { 11: inProgress("a.mp4") } });
  assert.match(await one.titleFor(3), /^Havre · 1 download in progress · \d+%$/);
  const two = await loadWorker({
    chromeLanguage: "en-US",
    sessionJobs: [activeBrowserJob(12, "a.mp4"), activeBrowserJob(13, "b.mp4")],
    downloadItems: { 12: inProgress("a.mp4"), 13: inProgress("b.mp4") }
  });
  assert.match(await two.titleFor(3), /^Havre · 2 downloads in progress · \d+%$/);
  const zh = await loadWorker({ chromeLanguage: "zh-CN", sessionJobs: [activeBrowserJob(14, "a.mp4")], downloadItems: { 14: inProgress("a.mp4") } });
  assert.match(await zh.titleFor(3), /^Havre · 正在下载 1 项 · \d+%$/);
  const en = workerMessages.en;
  assert.equal(en["worker.action.downloading"]({ count: 1, fraction: 0.42 }), "Havre · 1 download in progress · 42%");
  assert.equal(en["worker.action.downloading"]({ count: 1200, fraction: 0.5, locale: "en-US" }), "Havre · 1,200 downloads in progress · 50%");
  assert.equal(en["worker.action.found"]({ count: 1 }), "Havre · 1 media item on this page");
  assert.equal(en["worker.action.found"]({ count: 3 }), "Havre · 3 media items on this page");
  assert.equal(workerMessages.zh["worker.action.found"]({ count: 3 }), "Havre · 此页面有 3 项媒体");
  assert.equal(workerMessages.zh["worker.action.downloading"]({ count: 2, fraction: 0.42 }), "Havre · 正在下载 2 项 · 42%");
  assert.equal(en["worker.qualityRank"]({ rank: 2, size: "24 MB" }), "Quality 2 · 24 MB");
  assert.equal(workerMessages.zh["worker.qualityRank"]({ rank: 2, size: "24 MB" }), "清晰度 2 · 24 MB");
  for (const table of [workerMessages.en, workerMessages.zh]) {
    for (const [key, entry] of Object.entries(table)) {
      const text = typeof entry === "function" ? entry({}) : entry;
      assert.doesNotMatch(text, /\(s\)|undefined|NaN|job|任务|—/, key);
    }
  }
});

test("messages/worker.js imports nothing, keeps identical keys, and has no locale leaks", () => {
  const source = read("extension/ui/v2/messages/worker.js");
  assert.doesNotMatch(source, /^\s*import\b/m, "the worker reads this module without messages.js or locale.js");
  assert.deepEqual(Object.keys(workerMessages.zh).sort(), Object.keys(workerMessages.en).sort());
  assert.deepEqual(workerMessages.display, []);
  const LATIN_OK = new Set(["Havre", "Finder", "GB", "MB"]);
  for (const key of Object.keys(workerMessages.en)) {
    assert.ok(key.startsWith("worker."), key);
    const en = workerMessages.en[key];
    const zh = workerMessages.zh[key];
    const sample = { count: 2, fraction: 0.5, rank: 2, size: "24 MB" };
    const english = typeof en === "function" ? en(sample) : en;
    const chinese = typeof zh === "function" ? zh(sample) : zh;
    assert.ok(!CJK.test(english), `en ${key}: ${english}`);
    assert.deepEqual((chinese.match(/[A-Za-z]{2,}/g) || []).filter((word) => !LATIN_OK.has(word)), [], `zh ${key}: ${chinese}`);
  }
});

// ---------- 4. error answers carry code and params ----------

test("error answers keep the legacy text and add a FAILURE_CODES code with clean params", async () => {
  const worker = await loadWorker({ chromeLanguage: "en-US" });
  const contentSender = { id: EXTENSION_ID, url: "https://page.example.tv/watch", tab: { id: 3, url: "https://page.example.tv/watch" }, frameId: 0 };
  const cases = [
    [{ type: "RETRY_JOB", jobId: "nope" }, "not_retryable", {}, /无法重试/],
    [{ type: "RETRY_JOB", jobId: "" }, "invalid_request", {}, /任务编号无效/],
    [{ type: "FILE_ACTION", action: "bogus", jobId: "x" }, "invalid_request", {}, /不支持的文件操作/],
    [{ type: "FILE_ACTION", action: "open", jobId: "nope" }, "record_missing", {}, /找不到这条下载记录/],
    [{ type: "PAUSE_JOB", jobId: "nope" }, "job_ended", {}, /任务不存在或已结束/],
    [{ type: "RESUME_JOB", jobId: "nope" }, "not_paused", {}, /不在暂停状态/],
    [{ type: "OPEN_JOB_SOURCE", jobId: "nope" }, "source_missing", {}, /没有来源页面/],
    [{ type: "CHOOSE_DOWNLOAD_FOLDER" }, "engine_not_set_up", {}, /尚未授权连接本地引擎/],
    [{ type: "DOWNLOAD_URL", tabId: 3, url: "file:///Users/me/secret.mp4" }, "url_scheme_invalid", {}, /http 或 https/],
    [{ type: "DOWNLOAD_URL", tabId: 3, url: "http://192.168.1.20/movies/a.mp4" }, "private_network_blocked", { host: "192.168.1.20" }, /网络策略已阻止/],
    [{ type: "DOWNLOAD_URL", tabId: 3, url: "http://169.254.169.254/latest/a.mp4" }, "address_blocked", { host: "169.254.169.254" }, /网络策略已阻止/],
    [{ type: "NO_SUCH_MESSAGE" }, "invalid_request", {}, /Unknown message type/],
    [{ type: "GET_JOBS", sender: contentSender }, "invalid_request", {}, /来源未通过校验/]
  ];
  setUiLanguage("en");
  const { workerError } = await import("../extension/ui/v2/runtime.js");
  const { errorText } = await import("../extension/ui/v2/errors.js");
  for (const [message, code, params, legacy] of cases) {
    const { sender, ...body } = message;
    const response = await worker.send(body, sender);
    const label = JSON.stringify(body);
    assert.equal(response.ok, false, label);
    assert.match(response.error, legacy, `${label}: the error text stays for v1 pages`);
    assert.equal(response.code, code, label);
    assert.ok(FAILURE_CODES.includes(response.code), label);
    assert.deepEqual(response.params, params, label);
    // A v2 page localises from the code, never from the text.
    const shown = errorText(workerError(response));
    assert.equal(shown, describeJobFailure({ code, params }, "en"), label);
    assert.ok(!CJK.test(shown), `${label}: ${shown}`);
  }
  setUiLanguage("zh");
  assert.equal(errorText(workerError(await worker.send({ type: "CHOOSE_DOWNLOAD_FOLDER" }))), "请先设置本地引擎。");
});

test("batch results carry code and params per failed item", async () => {
  const worker = await loadWorker({ chromeLanguage: "en-US" });
  const response = await worker.send({ type: "DOWNLOAD_BATCH", tabId: 3, candidates: [{ id: "gone", url: "https://media.example.tv/a.mp4" }] });
  assert.equal(response.ok, true);
  assert.equal(response.failed, 1);
  const [result] = response.results;
  assert.equal(result.ok, false);
  assert.match(result.error, /已失效/);
  assert.equal(result.code, "media_stale");
  assert.deepEqual(result.params, {});
});

test("every coded throw in the worker names a known code, and the copy for an engine that is not set up is one sentence", () => {
  const coded = [...BACKGROUND.matchAll(/codedError\("([a-z_]+)"/g)].map((match) => match[1]);
  assert.ok(coded.length >= 70, `only ${coded.length} coded throws`);
  for (const code of coded) assert.ok(FAILURE_CODES.includes(code), code);
  for (const code of new Set(coded)) {
    assert.notEqual(describeJobFailure({ code }, "en"), describeJobFailure({ code: "unknown" }, "en"), `${code} has its own sentence`);
  }
  assert.doesNotMatch(BACKGROUND, /throw new Error\("[^"]*[㐀-鿿]/, "no uncoded worker-copy throw is left");
  assert.equal(describeJobFailure({ code: "engine_not_set_up" }, "en"), "Set up the local engine first.");
  assert.equal(describeJobFailure({ code: "engine_not_set_up" }, "zh"), "请先设置本地引擎。");
});

// ---------- 5. no dependency on the v1 translator ----------

test("the worker's import graph does not load ui/i18n.js", () => {
  const seen = new Set();
  const visit = (url) => {
    const key = url.href;
    if (seen.has(key)) return;
    seen.add(key);
    const source = readFileSync(url, "utf8");
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+"(\.[^"]+)"|(?:^|\n)\s*import\s+"(\.[^"]+)"/g)) {
      visit(new URL(match[1] || match[2], url));
    }
  };
  visit(new URL("../extension/background.js", import.meta.url));
  const files = [...seen].map((href) => href.slice(href.indexOf("/extension/") + 1));
  assert.ok(files.includes("extension/ui/v2/messages/worker.js"));
  assert.ok(files.includes("extension/lib/job-failure.js"));
  assert.ok(!files.some((file) => file.endsWith("ui/i18n.js")), files.join(", "));
  assert.ok(!files.some((file) => /ui\/v2\/(?:locale|messages|errors)\.js$/.test(file)), "the worker does not need the page-side locale state either");
});

test("a coded error's text classifies to the same code, so older pages and records agree", () => {
  for (const match of BACKGROUND.matchAll(/codedError\("([a-z_]+)", "([^"]+)"\)/g)) {
    const [, code, text] = match;
    const classified = classifyJobFailure({ text }).code;
    assert.equal(classified, code, text);
  }
});

// ---------- 6. review fixes ----------

/** The source of one top-level function in background.js. */
function functionSource(name) {
  const start = BACKGROUND.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  let depth = 0;
  for (let index = BACKGROUND.indexOf("{", start); index < BACKGROUND.length; index += 1) {
    if (BACKGROUND[index] === "{") depth += 1;
    else if (BACKGROUND[index] === "}" && --depth === 0) return BACKGROUND.slice(start, index + 1);
  }
  throw new Error(`${name} has no end`);
}

test("the toolbar badge uses the Morning tokens of ui/v2/tokens.css, two fills and one text colour", async () => {
  const tokens = read("extension/ui/v2/tokens.css");
  const morning = (name) => new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`).exec(tokens)?.[1];
  const { BADGE_COLORS } = await import("../extension/ui/v2/tokens.js");
  assert.equal(BADGE_COLORS.active, morning("--primary-fill"));
  assert.equal(BADGE_COLORS.idle, morning("--text-secondary"));
  assert.equal(BADGE_COLORS.text, morning("--text-on-accent"));
  assert.match(BACKGROUND, /^import \{ BADGE_COLORS \} from "\.\/ui\/v2\/tokens\.js";$/m, "the worker takes the badge colours from the token mirror");
  assert.doesNotMatch(BACKGROUND, /#[0-9A-Fa-f]{6}\b|const BADGE_COLORS/, "no colour literals left in background.js");

  const idle = await loadWorker({ chromeLanguage: "en-US" });
  await idle.titleFor(3);
  assert.deepEqual([...new Set(idle.badgeColors.map((entry) => entry.color))], [morning("--text-secondary")]);
  assert.deepEqual([...new Set(idle.badgeTextColors.map((entry) => entry.color))], [morning("--text-on-accent")]);
  const busy = await loadWorker({ chromeLanguage: "en-US", sessionJobs: [activeBrowserJob(21, "a.mp4")], downloadItems: { 21: inProgress("a.mp4") } });
  await busy.titleFor(3);
  assert.equal(busy.badgeColors.at(-1).color, morning("--primary-fill"));
});

test("a language switch rewrites the tooltip of every open tab, including background tabs with no media", async () => {
  const worker = await loadWorker({ chromeLanguage: "en-US", preference: "auto", openTabs: [{ id: 3 }, { id: 5 }] });
  assert.equal(await worker.titleFor(5), "Havre · No downloadable media on this page yet");
  const before = worker.titles.length;
  worker.storageChanged.emit({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "zh", oldValue: "auto" } }, "local");
  for (let index = 0; index < 50 && !worker.titles.slice(before).some((entry) => entry.tabId === 5); index += 1) await tick();
  const rewritten = worker.titles.slice(before).filter((entry) => entry.tabId === 5).at(-1);
  assert.equal(rewritten?.title, workerMessages.zh["worker.action.none"], "background tab 5 follows the switch");
});

test("a finished download offers Show in Finder on macOS and Show in folder elsewhere", async () => {
  for (const [platform, chromeLanguage, expected] of [
    ["mac", "en-US", ["Show in Finder", "Open"]],
    ["win", "en-US", ["Show in folder", "Open"]],
    ["linux", "zh-CN", ["在文件夹中显示", "打开"]],
    ["cros", "en-US", ["Show in folder", "Open"]]
  ]) {
    const worker = await loadWorker({ chromeLanguage, platform, sessionJobs: [activeBrowserJob(31, "Clip.mp4")], downloadItems: { 31: inProgress("Clip.mp4") } });
    worker.downloadsChanged.emit({ id: 31, state: { current: "complete" }, bytesReceived: { current: 2_000_000 }, totalBytes: { current: 2_000_000 }, filename: { current: "/Users/me/Downloads/Clip.mp4" } });
    await worker.settle();
    const notice = worker.notifications.find((entry) => entry.id === "havre:browser:31:completed");
    assert.deepEqual(notice?.options.buttons.map((button) => button.title), expected, platform);
  }
});

test("a local engine that is still not ready after the self-heal reload says why and offers Set up, which opens Settings", async () => {
  const marker = { nativeApiSelfHeal: { attemptedAt: Date.now(), surface: null, pendingDownload: null } };
  for (const [nativePermission, lang, title] of [
    [true, "en", "Local engine isn’t connected"],
    [false, "en", "Local engine isn’t set up"],
    [true, "zh", "本地引擎未连接"],
    [false, "zh", "本地引擎尚未设置"]
  ]) {
    const worker = await loadWorker({
      chromeLanguage: lang === "en" ? "en-US" : "zh-CN",
      nativePermission,
      connectNativeError: "Specified native messaging host not found.",
      storedLocal: marker
    });
    for (let index = 0; index < 100 && !worker.notifications.length; index += 1) await tick();
    const notice = worker.notifications.find((entry) => entry.id.startsWith("havre:self-heal:"));
    assert.ok(notice, `${lang} · permission ${nativePermission}`);
    assert.equal(notice.options.title, title);
    assert.equal(notice.options.message, workerMessages[lang]["worker.notify.engineNotReadyBody"]);
    assert.deepEqual(notice.options.buttons.map((button) => button.title), [workerMessages[lang]["worker.notify.setUp"]]);
    if (lang === "en") assert.doesNotMatch(JSON.stringify(notice.options), CJK);
    // The button and the body both open Settings at the local engine section.
    worker.notificationButtonClicked.emit(notice.id, 0);
    worker.notificationClicked.emit(notice.id);
    await worker.settle();
    assert.deepEqual(worker.createdTabs.map((tab) => tab.url), [
      `chrome-extension://${EXTENSION_ID}/options/options.html#local-engine`,
      `chrome-extension://${EXTENSION_ID}/options/options.html#local-engine`
    ]);
    assert.ok(worker.cleared.includes(notice.id));
  }
});

test("Open and Show in Finder keep the engine's own code when the engine is missing", async () => {
  const record = { jobId: "native:done-1", method: "native", status: "completed", filename: "Clip.mp4", path: "/Users/me/Downloads/Havre/Clip.mp4", createdAt: Date.now() - 10_000, finishedAt: Date.now() - 5_000 };
  const worker = await loadWorker({
    chromeLanguage: "en-US",
    nativePermission: true,
    connectNativeError: "Specified native messaging host not found.",
    storedLocal: { "downloadHistory.v1": [record] }
  });
  for (const action of ["open", "reveal"]) {
    const response = await worker.send({ type: "FILE_ACTION", action, jobId: record.jobId });
    assert.equal(response.ok, false, action);
    assert.equal(response.code, "engine_missing", `${action}: ${response.error}`);
  }
});

test("a path with a quote inside it is hidden completely, and the reason after it stays readable", () => {
  const redact = new Function(`${functionSource("cleanText")}\n${functionSource("redactJobText")}\nreturn redactJobText;`)();
  const hidden = "<本地路径已隐藏>";
  for (const [input, expected] of [
    [`[Errno 13] Permission denied: '/Users/andy/Bob\\'s "Tax" Stuff/clip.mp4'`, `[Errno 13] Permission denied: ${hidden}`],
    ["Opening '/Users/andy/Bob's Stuff/clip.mp4' for writing failed", `Opening ${hidden} for writing failed`],
    ["[Errno 28] No space left on device: '/Volumes/T7/Period Dramas/x.ts.tmp'", `[Errno 28] No space left on device: ${hidden}`],
    ["/Users/andy/My Videos/clip.mp4: No space left on device", `${hidden}: No space left on device`]
  ]) {
    const output = redact(input, 240);
    assert.equal(output, expected, input);
    assert.doesNotMatch(output, /andy|Bob|Tax|Stuff|Period|clip/);
  }
  assert.equal(classifyJobFailure({ text: redact("/Users/andy/My Videos/clip.mp4: No space left on device", 240) }).code, "disk_full");
});

test("worker-named titles follow the UI language and are flagged for pages", async () => {
  const worker = await loadWorker({ chromeLanguage: "en-US", preference: "en", tabTitle: "" });
  const contentSender = { id: EXTENSION_ID, url: "https://page.example.tv/watch", tab: { id: 3, url: "https://page.example.tv/watch", title: "" }, frameId: 0 };
  const added = await worker.send({ type: "CONTENT_MEDIA", data: { url: "https://media.example.tv/v/master.mp4", mime: "video/mp4", contentLength: 2_000_000, source: "dom" } }, contentSender);
  assert.notEqual(added?.ok, false, added?.error);
  await worker.settle();
  const english = (await worker.send({ type: "GET_TAB_MEDIA", tabId: 3 })).items;
  assert.equal(english.length, 1, JSON.stringify(english));
  assert.equal(english[0].title, "Media");
  assert.equal(english[0].titleIsFallback, true);
  assert.match(english[0].suggestedFilename, /^Media\.mp4$/);
  worker.storageChanged.emit({ [UI_LANGUAGE_STORAGE_KEY]: { newValue: "zh" } }, "local");
  const chinese = (await worker.send({ type: "GET_TAB_MEDIA", tabId: 3 })).items;
  assert.equal(chinese[0].title, "媒体");
  assert.equal(chinese[0].suggestedFilename, "媒体.mp4");
  assert.equal(chinese[0].titleIsFallback, true);
});

test("the worker's byte formatter is lib/format.js, which matches ui/v2/locale.js formatBytes in both languages", async () => {
  assert.match(BACKGROUND, /^import \{ formatBytes \} from "\.\/lib\/format\.js";$/m, "the worker imports the shared formatter");
  assert.doesNotMatch(BACKGROUND, /function formatDecimalBytes|DECIMAL_UNITS/, "no private copy left");
  const { formatBytes: formatDecimalBytes } = await import("../extension/lib/format.js");
  const { formatBytes } = await import("../extension/ui/v2/locale.js");
  const savedChrome = globalThis.chrome;
  try {
    for (const [chromeLanguage, lang, tag] of [["en-US", "en", "en-US"], ["en-GB", "en", "en-GB"], ["zh-CN", "zh", "zh-CN"]]) {
      globalThis.chrome = { i18n: { getUILanguage: () => chromeLanguage } };
      setUiLanguage(lang);
      for (const bytes of [0, -1, Number.NaN, 1, 999, 1_000, 1_499, 24_000_000, 99_960_000, 150_000_000, 2_200_000_000, 1.25e12]) {
        assert.equal(formatDecimalBytes(bytes, tag), formatBytes(bytes), `${tag} ${bytes}`);
      }
    }
  } finally {
    globalThis.chrome = savedChrome;
  }
});

test("worker and engine sentences quote Settings by its exact names, in both languages", async () => {
  const { default: settings } = await import("../extension/ui/v2/messages/settings.js");
  assert.equal(settings.zh["settings.lan.name"], "允许从家庭网络下载", "the label the worker quotes");
  for (const lang of ["en", "zh"]) {
    const names = settings[lang];
    const quoted = (text, name) => assert.ok(text.includes(`“${name}”`), `${lang}: “${name}” in ${text}`);
    quoted(describeJobFailure({ code: "private_network_blocked", params: { host: "nas.local" } }, lang), names["settings.lan.name"]);
    quoted(describeJobFailure({ code: "site_ignored", params: {} }, lang), names["settings.blocked.name"]);
    quoted(describeJobFailure({ code: "ignored_by_settings", params: {} }, lang), names["settings.minimum.name"]);
    quoted(describeJobFailure({ code: "ignored_by_settings", params: {} }, lang), names["settings.blocked.name"]);
    const engine = `${names["settings.title"]} → ${names["settings.section.localEngine"]}`;
    assert.ok(workerMessages[lang]["worker.notify.engineNotReadyBody"].includes(engine), `${lang}: ${engine}`);
    assert.ok(describeJobFailure({ code: "engine_missing", params: {} }, lang).includes(engine), `${lang}: engine_missing names ${engine}`);
  }
});
