import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { friendlyDashMessage } from "../extension/lib/job-presentation.js";

const popupSource = readFileSync(new URL("../extension/popup/popup.js", import.meta.url), "utf8");
const sidepanelSource = readFileSync(new URL("../extension/sidepanel/sidepanel.js", import.meta.url), "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is present`);
  const signatureEnd = source.indexOf(") {", start);
  const bodyStart = source.indexOf("{", signatureEnd);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function loadNativePresentation(source) {
  const body = [
    "nativeFailureReasonFromMessage",
    "nativeStatusFromError",
    "normalizeNativeHostStatus",
    "nativeHostIssueMessage",
    "requireNativeHostReady",
    "statusLabel",
    "friendlyJobMessage",
    "friendlyErrorMessage"
  ].map((name) => extractFunction(source, name)).join("\n");
  return new Function(
    "HOST_MISMATCH_MESSAGE",
    "friendlyDashMessage",
    `${body}\nreturn { nativeStatusFromError, normalizeNativeHostStatus, nativeHostIssueMessage, requireNativeHostReady, friendlyJobMessage, friendlyErrorMessage };`
  )("测试版本不匹配", friendlyDashMessage);
}

function loadJobAnnouncer(source) {
  const state = { lastJobAnnouncementKey: "" };
  const node = { textContent: "" };
  const queued = [];
  const announce = new Function(
    "state",
    "$",
    "statusLabel",
    "queueMicrotask",
    `${extractFunction(source, "announceJobChange")}\nreturn announceJobChange;`
  )(
    state,
    () => node,
    (status) => status === "failed" ? "下载失败" : status,
    (callback) => queued.push(callback)
  );
  return { announce, state, node, queued };
}

for (const [surface, source] of [["popup", popupSource], ["side panel", sidepanelSource]]) {
  test(`${surface} maps native failures to explicit safe states`, () => {
    const helpers = loadNativePresentation(source);
    const cases = [
      [new TypeError("chrome.runtime.connectNative is not a function"), "api_unavailable"],
      [new Error("Specified native messaging host not found."), "host_missing"],
      [new Error("Access to the specified native messaging host is forbidden."), "connection_failed"],
      [new Error("Native host disconnected before replying"), "connection_failed"]
    ];
    for (const [error, reason] of cases) {
      const status = helpers.nativeStatusFromError(error);
      assert.equal(status.connected, false);
      assert.equal(status.failureReason, reason);
      const visible = helpers.nativeHostIssueMessage(status);
      assert.doesNotMatch(visible, /TypeError|connectNative|Specified native messaging host|Native host disconnected/i);
      assert.throws(() => helpers.requireNativeHostReady(status), new RegExp(visible.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    const permission = helpers.nativeStatusFromError(new Error("尚未授权连接本地引擎"));
    assert.equal(permission.needsPermission, true);
    assert.equal(permission.failureReason, null);
    assert.match(helpers.nativeHostIssueMessage(permission), /请先允许/);

    assert.doesNotThrow(() => helpers.requireNativeHostReady({ connected: true, compatible: true }));
    assert.throws(() => helpers.requireNativeHostReady({ connected: true, compatible: false }), /测试版本不匹配/);
    assert.match(helpers.nativeHostIssueMessage({ failureReason: "host_missing" }), /未安装或未注册/);
    assert.match(helpers.nativeHostIssueMessage({ failureReason: "connection_failed" }), /连接失败/);
    assert.match(helpers.nativeHostIssueMessage({ failureReason: "api_unavailable", recoveryBlocked: true }), /完全退出并重新启动 Chrome/);
    assert.match(helpers.nativeHostIssueMessage({ failureReason: "api_unavailable", restartRequired: true }), /完全退出并重新启动 Chrome/);

    const legacyStatus = helpers.normalizeNativeHostStatus({ connected: false, lastError: "chrome.runtime.connectNative is not a function" });
    assert.equal(legacyStatus.failureReason, "api_unavailable");
    assert.doesNotMatch(legacyStatus.lastError, /TypeError|connectNative/);
    assert.deepEqual(helpers.normalizeNativeHostStatus({ needsPermission: true, failureReason: "host_missing", lastError: "stale" }), {
      needsPermission: true,
      failureReason: null,
      lastError: null
    });
    assert.deepEqual(helpers.normalizeNativeHostStatus(null), {});

    const legacyTypeError = helpers.friendlyErrorMessage("TypeError: chrome.runtime.connectNative is not a function");
    assert.match(legacyTypeError, /连接接口/);
    assert.doesNotMatch(legacyTypeError, /TypeError|connectNative/);
  });

  test(`${surface} probes and requires a connected host before native actions succeed`, () => {
    assert.match(source, /const result = await call\(\{ type: "PING_HOST" \}\);/);
    assert.match(source, /const granted = await chrome\.permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\);[\s\S]{0,700}const host = await refreshNativeHost\(\);[\s\S]{0,120}requireNativeHostReady\(host\);/);
    assert.match(source, /本地下载引擎连接接口尚未就绪；请打开设置页完成自动恢复后重试/);
    assert.doesNotMatch(source, /type: "RECOVER_NATIVE_API"|nativeRecoveryPromise|NATIVE_RECOVERY_MAX_WAIT_MS/);
    assert.doesNotMatch(source, /updateHost\(\{ connected: false, lastError: error\.message \}\)/);
  });

  test(`${surface} keeps supported DASH failures distinct from unsupported media`, () => {
    const helpers = loadNativePresentation(source);
    const expired = "DASH 任务开始前签名链接已过期，请刷新页面后重试";
    const expiredJob = helpers.friendlyJobMessage({ status: "failed", message: expired, error: expired });
    assert.equal(expiredJob, "视频链接已过期，请刷新页面并重新播放后再下载");
    assert.equal(helpers.friendlyErrorMessage(expired), expiredJob);
    assert.equal(expiredJob.split("请刷新页面").length - 1, 1, "message/error duplicates produce one instruction");
    assert.doesNotMatch(expiredJob, /这种流媒体|暂不支持/);

    const trackFailure = helpers.friendlyJobMessage({
      status: "failed",
      message: "DASH video track download failed: HTTP Error 403: Forbidden"
    });
    assert.match(trackFailure, /视频画面下载失败/);
    assert.doesNotMatch(trackFailure, /暂不支持/);

    const unsupported = helpers.friendlyJobMessage({
      status: "failed",
      message: "The pinned built-in static DASH planner could not handle this MPD: built-in DASH planner requires exactly one Period"
    });
    assert.equal(unsupported, "这个视频使用了当前版本尚未支持的流媒体结构");
    assert.equal(unsupported.split("尚未支持").length - 1, 1);

    const ffmpeg = helpers.friendlyJobMessage({ status: "failed", message: "DASH pair download requires FFmpeg" });
    assert.match(ffmpeg, /视频处理失败/);
    assert.doesNotMatch(ffmpeg, /流媒体结构|这种流媒体/);

    assert.equal(helpers.friendlyJobMessage({ status: "remuxing", message: "正在无损合并 DASH 音视频" }), "正在无损合并音视频");
  });

  test(`${surface} announces one failure per job without suppressing a same-name retry`, () => {
    const fixture = loadJobAnnouncer(source);
    const first = { jobId: "job-a", filename: "相同文件名.mp4", status: "failed" };
    fixture.announce(null, first);
    assert.equal(fixture.queued.length, 1);
    fixture.queued.shift()();
    assert.equal(fixture.node.textContent, "相同文件名.mp4：下载失败");

    fixture.announce(null, first);
    assert.equal(fixture.queued.length, 0, "the port/catch race for one job is idempotent");

    fixture.announce(null, { ...first, jobId: "job-b" });
    assert.equal(fixture.queued.length, 1, "a retry with the same filename remains announceable");
    fixture.queued.shift()();
    assert.equal(fixture.node.textContent, "相同文件名.mp4：下载失败");
    assert.equal(fixture.state.lastJobAnnouncementKey, "job-b:failed");
  });
}

test("native status recheck cannot report success for ok:true with a disconnected host", () => {
  assert.match(popupSource, /"popup:ping-host"[\s\S]{0,300}refreshNativeHost\(\);[\s\S]{0,100}requireNativeHostReady\(host\);/);
  assert.match(sidepanelSource, /"sidepanel:ping-host"[\s\S]{0,300}refreshNativeHost\(\);[\s\S]{0,100}requireNativeHostReady\(host\);[\s\S]{0,120}showToast\("本地下载引擎状态已更新", "success"\)/);
});
