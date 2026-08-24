import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

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
    "friendlyErrorMessage"
  ].map((name) => extractFunction(source, name)).join("\n");
  return new Function("HOST_MISMATCH_MESSAGE", `${body}\nreturn { nativeStatusFromError, normalizeNativeHostStatus, nativeHostIssueMessage, requireNativeHostReady, friendlyErrorMessage };`)("测试版本不匹配");
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
    assert.match(helpers.nativeHostIssueMessage({ failureReason: "api_unavailable", recoveryBlocked: true }), /chrome:\/\/extensions/);

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
    assert.match(source, /高速下载连接接口尚未就绪；请打开设置页完成自动恢复后重试/);
    assert.doesNotMatch(source, /type: "RECOVER_NATIVE_API"|nativeRecoveryPromise|NATIVE_RECOVERY_MAX_WAIT_MS/);
    assert.doesNotMatch(source, /updateHost\(\{ connected: false, lastError: error\.message \}\)/);
  });
}

test("native status recheck cannot report success for ok:true with a disconnected host", () => {
  assert.match(popupSource, /"popup:ping-host"[\s\S]{0,300}refreshNativeHost\(\);[\s\S]{0,100}requireNativeHostReady\(host\);/);
  assert.match(sidepanelSource, /"sidepanel:ping-host"[\s\S]{0,300}refreshNativeHost\(\);[\s\S]{0,100}requireNativeHostReady\(host\);[\s\S]{0,120}showToast\("高速下载功能状态已更新", "success"\)/);
});
