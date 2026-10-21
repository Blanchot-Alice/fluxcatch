// The local engine as the popup and the side panel show it (design review §7):
// one status line with "Set up", never an explanation, and never raw Chrome,
// worker or engine text. Both surfaces share these helpers (ui/v2/media.js).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setUiLanguage } from "../extension/ui/v2/locale.js";
import {
  engineError,
  engineIssue,
  engineIssueText,
  engineLine,
  hostStatusFromError,
  normalizeHostStatus,
  pingEngine,
  recheckEngine,
  requireEngineReady
} from "../extension/ui/v2/media.js";
import { recordFailureText } from "../extension/ui/v2/rows.js";
import { describeJobActivity } from "../extension/lib/job-failure.js";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const popupSource = read("extension/popup/popup.js");
const sidepanelSource = read("extension/sidepanel/sidepanel.js");
const mediaSource = read("extension/ui/v2/media.js");
const CJK = /[㐀-鿿　-〿＀-￯]/;
const RAW = /TypeError|connectNative|Specified native messaging host|Native host disconnected|forbidden/i;

test("connection failures map to explicit states whose words never echo the raw error", () => {
  setUiLanguage("en");
  const cases = [
    [new TypeError("chrome.runtime.connectNative is not a function"), "api_unavailable", "recover"],
    [new Error("Specified native messaging host not found."), "host_missing", "missing"],
    [new Error("Access to the specified native messaging host is forbidden."), "connection_failed", "noResponse"],
    [new Error("Native host disconnected before replying"), "connection_failed", "noResponse"]
  ];
  for (const [error, reason, issue] of cases) {
    const status = hostStatusFromError(error);
    assert.equal(status.connected, false);
    assert.equal(status.failureReason, reason);
    assert.equal(status.lastError, null, "the raw text is dropped");
    assert.equal(engineIssue(status), issue);
    const words = engineIssueText(issue);
    assert.ok(words && !RAW.test(words), words);
    assert.throws(() => requireEngineReady(status), (thrown) => thrown.userMessage === engineError(status).userMessage && !RAW.test(thrown.userMessage));
  }
  const permission = hostStatusFromError(new Error("尚未授权连接本地引擎"));
  assert.equal(permission.needsPermission, true);
  assert.equal(permission.failureReason, null);
  assert.equal(engineIssue(permission), "permission");
  assert.equal(engineIssueText("permission"), "Local engine isn’t set up");
  assert.throws(() => requireEngineReady(permission), { userMessage: "Set up the local engine first" });
});

test("host states: self-healing, restart, mismatch and missing tools each get one plain line", () => {
  setUiLanguage("en");
  assert.equal(engineIssue({ failureReason: "api_unavailable", selfHealing: true }), "finishing");
  assert.equal(engineIssue({ failureReason: "api_unavailable", recoveryBlocked: true }), "restart");
  assert.equal(engineIssue({ failureReason: "api_unavailable", restartRequired: true }), "restart");
  assert.equal(engineIssue({ connected: true, compatible: false }), "update");
  assert.equal(engineIssue({ connected: true, compatible: true, capabilities: { ffmpeg: { available: false } } }), "noConvert");
  assert.equal(engineIssue({ connected: true, compatible: true, capabilities: { ffmpeg: { available: true } } }), null);
  assert.equal(engineIssue({ connected: true, compatible: true }, { permission: false }), "permission", "a revoked permission wins");
  assert.equal(engineIssue({}), null, "unknown is not a problem to report");
  assert.doesNotThrow(() => requireEngineReady({ connected: true, compatible: true }));
  assert.throws(() => requireEngineReady({ connected: true, compatible: false }), { userMessage: "Local engine needs an update" });
  assert.equal(engineIssueText("restart"), "Quit and reopen Chrome to finish setup");
  assert.equal(engineIssueText("finishing"), "Finishing setup…");
});

test("engine line: the dot and one line, with Set up (and Retry wherever a fresh check can clear it)", () => {
  setUiLanguage("en");
  const setUp = () => {};
  const retry = () => {};
  assert.deepEqual(engineLine("permission", { setUp, retry }).actions.map((action) => action.label), ["Set up"]);
  // v1's Recheck: every state a fresh ping can change offers Retry.
  for (const issue of ["restart", "recover", "missing", "noResponse", "update", "noConvert"]) {
    assert.deepEqual(engineLine(issue, { setUp, retry }).actions.map((action) => action.label), ["Retry", "Set up"], issue);
  }
  assert.deepEqual(engineLine("finishing", { setUp, retry }).actions, [], "nothing to do while Chrome finishes");
  assert.equal(engineLine("finishing").tone, "progress");
  assert.equal(engineLine("permission").tone, "");
  assert.equal(engineLine(null).text, "", "a ready engine clears the line");
  setUiLanguage("zh");
  assert.equal(engineIssueText("permission"), "本地引擎尚未设置");
  for (const issue of ["permission", "finishing", "restart", "recover", "missing", "noResponse", "update", "noConvert"]) {
    assert.ok(CJK.test(engineIssueText(issue)), `zh ${issue}`);
  }
  setUiLanguage("en");
  for (const issue of ["permission", "finishing", "restart", "recover", "missing", "noResponse", "update", "noConvert"]) {
    assert.ok(!CJK.test(engineIssueText(issue)), `en ${issue}`);
  }
});

test("legacy host statuses are normalised; a permission state carries no failure", () => {
  const legacy = normalizeHostStatus({ connected: false, lastError: "chrome.runtime.connectNative is not a function" });
  assert.equal(legacy.failureReason, "api_unavailable");
  assert.equal(legacy.lastError, null);
  assert.deepEqual(normalizeHostStatus({ needsPermission: true, failureReason: "host_missing", lastError: "stale" }), { needsPermission: true, failureReason: null, lastError: null });
  assert.deepEqual(normalizeHostStatus(null), {});
});

test("PING_HOST: a fresh status, or a failure status when the worker cannot answer", async () => {
  const ok = await pingEngine(async (message) => { assert.equal(message.type, "PING_HOST"); return { ok: true, hostStatus: { connected: true, compatible: true } }; });
  assert.equal(ok.connected, true);
  const failed = await pingEngine(async () => { throw new Error("Specified native messaging host not found."); });
  assert.equal(failed.failureReason, "host_missing");
});

test("both surfaces ask for the engine on the click, then probe and require a connected engine", () => {
  for (const source of [popupSource, sidepanelSource]) {
    assert.match(source, /const granted = await chrome\.permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\);[\s\S]{0,200}const host = await pingEngine\(call\);[\s\S]{0,60}updateHost\(host\);[\s\S]{0,40}requireEngineReady\(host\);/);
    assert.doesNotMatch(source, /type: "RECOVER_NATIVE_API"|nativeRecoveryPromise|NATIVE_RECOVERY_MAX_WAIT_MS/, "Settings owns the recovery");
    assert.match(source, /from "\.\.\/ui\/v2\/media\.js"/, "one implementation, shared");
    assert.doesNotMatch(source, /function (?:nativeStatusFromError|nativeHostIssueMessage|friendlyJobMessage|friendlyErrorMessage)\(/, "no per-surface copies");
  }
  assert.match(mediaSource, /const granted = await chrome\.permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\);[\s\S]{0,120}const host = await ping\(\);[\s\S]{0,40}onHost\?\.\(host\);[\s\S]{0,40}requireEngineReady\(host\);/, "the dialog too");
  for (const [source, key] of [[popupSource, "popup:ping-host"], [sidepanelSource, "sidepanel:ping-host"]]) {
    assert.match(source, new RegExp(`"${key}"[\\s\\S]{0,120}await recheckEngine\\(\\{ call, onHost: updateHost, permission: state\\.nativePermission \\}\\);[\\s\\S]{0,40}toast\\(msg\\("media\\.engine\\.ready"\\)\\)`), `${key}: a recheck never reports success while an issue remains`);
  }
});

test("Retry rechecks: success only when no issue remains, otherwise the remaining issue in plain words", async () => {
  setUiLanguage("en");
  const seen = [];
  const ready = await recheckEngine({ call: async () => ({ ok: true, hostStatus: { connected: true, compatible: true, capabilities: { ffmpeg: { available: true } } } }), onHost: (host) => seen.push(host), permission: true });
  assert.equal(ready.connected, true);
  assert.equal(seen.length, 1, "the page keeps the fresh status");
  await assert.rejects(recheckEngine({ call: async () => ({ ok: true, hostStatus: { connected: true, compatible: true, capabilities: { ffmpeg: { available: false } } } }) }), { userMessage: "Merging & converting isn’t available" }, "a connected engine without its tools is not 'ready'");
  await assert.rejects(recheckEngine({ call: async () => { throw new Error("Specified native messaging host not found."); } }), (error) => error.userMessage === "Local engine isn’t installed" && !RAW.test(error.userMessage));
  await assert.rejects(recheckEngine({ call: async () => ({ ok: true, hostStatus: { connected: true, compatible: true } }), permission: false }), { userMessage: "Local engine isn’t set up" });
});

test("failed rows and progress text are localised from codes, never shown raw (DASH included)", () => {
  setUiLanguage("en");
  const expired = recordFailureText({ status: "failed", message: "DASH 任务开始前签名链接已过期，请刷新页面后重试" });
  assert.ok(!CJK.test(expired), expired);
  assert.match(expired, /expired/i);
  const track = recordFailureText({ status: "failed", message: "DASH video track download failed: HTTP Error 403: Forbidden" });
  assert.doesNotMatch(track, /not supported|can’t save this kind|HTTP Error/i, track);
  const unsupported = recordFailureText({ status: "failed", message: "The pinned built-in static DASH planner could not handle this MPD: built-in DASH planner requires exactly one Period" });
  assert.ok(unsupported && !/MPD|Period/.test(unsupported), unsupported);
  assert.equal(describeJobActivity("正在无损合并 DASH 音视频", "en"), "Joining picture and sound");
  assert.equal(describeJobActivity("DASH 分片 3/10", "en"), "Part 3 of 10");
  setUiLanguage("zh");
  assert.ok(CJK.test(recordFailureText({ status: "failed", message: "DASH video track download failed: HTTP Error 403: Forbidden" })));
  setUiLanguage("en");
});
