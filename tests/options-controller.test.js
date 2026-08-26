import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extension/options/options.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} is missing`);
  const next = source.indexOf("\nfunction ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("Options controller owns a normalized baseline and dirty-only unload warning", () => {
  assert.match(source, /baseline = normalizeFormState/);
  assert.match(source, /statesEqual\(collectRawState\(\), baseline\)/);
  assert.match(source, /form\.dataset\.dirty = String\(dirty\)/);
  assert.match(source, /dirty \? "有未保存的更改"/);
  assert.match(source, /window\.addEventListener\("beforeunload", handleBeforeUnload\)/);
  assert.match(functionBody("handleBeforeUnload"), /if \(!dirty\) return/);
});

test("Save validates, preserves stable gates and never requests notification permission", () => {
  const body = functionBody("save");
  assert.match(body, /const submittedState = collectRawState\(\)/);
  assert.match(body, /validateSettings\(submittedState\)/);
  assert.match(body, /withPendingAction\(saveButton, "options-save"/);
  assert.match(body, /pendingText: "保存中…"/);
  assert.match(body, /successText: "已保存 ✓"/);
  assert.match(body, /liveDuration: 0/);
  assert.match(body, /youtubeEnabled: false/);
  assert.match(body, /blockedDomains: normalized\.blockedDomains/);
  assert.match(body, /reconcileSaveCompletion\(\{[\s\S]*submitted: submittedState,[\s\S]*current: collectRawState\(\),[\s\S]*saved/);
  assert.match(body, /if \(!completion\.changedDuringSave\) writeFormState\(completion\.formState\)/);
  assert.match(body, /保存期间有新的更改/);
  assert.doesNotMatch(body, /permissions\.request|permissions\.remove/);
});

test("notification permission begins in the switch change handler", () => {
  assert.match(source, /notificationInput\.addEventListener\("change"/);
  const body = functionBody("changeNotificationPermission");
  assert.match(body, /permissionRequest = chrome\.permissions\.request\(\{ permissions: \["notifications"\] \}\)/);
  assert.match(body, /withPendingAction\(notificationInput, "notification-permission"/);
  assert.match(body, /notificationInput\.checked = false/);
  const load = functionBody("load");
  assert.match(load, /resolveNotificationLoadState/);
  assert.match(load, /notificationLoad\.requiresRepair[\s\S]*type: "SAVE_SETTINGS"[\s\S]*showNotifications: false/);
});

test("native permission remains gesture-bound and host states distinguish installed from available", () => {
  const request = functionBody("requestNativeAccess");
  assert.match(request, /permissionRequest = chrome\.permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\)/);
  assert.match(request, /withPendingAction\(nativePermissionButton, "native-access"/);
  assert.match(request, /permissionDenied = true[\s\S]*throw new Error\("暂未开启本地下载引擎"\)/);
  assert.match(request, /recoverNativeApi\(host\)/);
  assert.doesNotMatch(source, /chrome\.runtime\.reload\(\)/);
  const refresh = functionBody("refreshNativeAccess");
  assert.match(refresh, /recoverNativeApi\(host\)/);
  assert.match(refresh, /finally[\s\S]*nativePermissionGranted = await chrome\.permissions\.contains[\s\S]*renderNativePermissionRequired/);
  const recover = functionBody("recoverNativeApi");
  assert.match(recover, /withPendingAction\(nativePermissionButton, "native-recovery"/);
  const complete = functionBody("completeNativeApiRecovery");
  assert.match(complete, /response\.retryAfterMs/);
  assert.match(complete, /if \(recoveredHost\.needsPermission\)[\s\S]*renderNativePermissionRequired\("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权"\)/);
  assert.match(complete, /await waitForNativeRecovery\(retryAfterMs\)/);
  assert.match(complete, /await pingNativeHost\(\)/);
  const waitIndex = complete.indexOf("await waitForNativeRecovery(retryAfterMs)");
  const retryIndex = complete.indexOf("recoveredHost = await pingNativeHost()", waitIndex);
  assert.ok(waitIndex >= 0 && retryIndex > waitIndex);
  assert.doesNotMatch(complete.slice(waitIndex, retryIndex), /runtime\.sendMessage/);
  assert.match(complete, /failureReason === "api_unavailable"[\s\S]*requestNativeApiRecovery\(\)/);
  assert.match(complete, /response\.recoveryBlocked/);
  assert.match(complete, /await refreshDiagnostics\(\)/);
  assert.match(complete, /完全退出并重新启动 Chrome[\s\S]*点击“重新检查”/);
  assert.doesNotMatch(complete, /手动重新加载 FluxCatch/);
  const recoveryRequest = functionBody("requestNativeApiRecovery");
  assert.match(recoveryRequest, /type: "RECOVER_NATIVE_API"/);
  const render = functionBody("renderHostStatus");
  assert.match(render, /ytdlp\?\.installed === true \|\| ytdlp\?\.available === true/);
  assert.match(render, /const ytdlpAvailable = ytdlp\?\.available === true/);
  assert.match(render, /"已安装 · 联网功能未开放"/);
  assert.match(render, /BUILD_PROFILE\.features\.externalToolNetwork === true/);
  assert.match(render, /"协议或能力配置不匹配"/);
  assert.match(render, /"未安装"/);
});

test("native permission changes refresh state and connection failures remain actionable", () => {
  assert.match(source, /chrome\.permissions\?\.onAdded\?\.addListener\(handleNativePermissionChange\)/);
  assert.match(source, /chrome\.permissions\?\.onRemoved\?\.addListener\(handleNativePermissionChange\)/);
  const permissionChange = functionBody("handleNativePermissionChange");
  assert.match(permissionChange, /permissions\?\.permissions\?\.includes\("nativeMessaging"\)/);
  assert.match(permissionChange, /void refreshNativeAccess\(\)/);

  const render = functionBody("renderHostStatus");
  assert.match(render, /failureReason === "api_unavailable"/);
  assert.match(render, /host\.restartRequired === true/);
  assert.match(render, /需要重启浏览器/);
  assert.match(render, /接口长期未恢复 · 请重启 Chrome/);
  assert.match(render, /failureReason === "host_missing"/);
  assert.match(render, /nativeInstallGuide\.open = failureReason === "host_missing"/);
  assert.match(render, /等待 Chrome 初始化连接接口/);
  assert.match(render, /FluxCatch 将自动重试/);
  assert.match(render, /\.\/scripts\/native-install-wrapper\.sh/);
  assert.doesNotMatch(source, /connectNative is not a function|TypeError/);
});

test("native access rechecks live permission after an ignored permission-change event", () => {
  const request = functionBody("requestNativeAccess");
  const finallyIndex = request.indexOf("} finally {");
  assert.ok(finallyIndex >= 0, "requestNativeAccess must reconcile permission state in finally");
  const finallyBody = request.slice(finallyIndex);
  assert.match(finallyBody, /nativePermissionGranted = await chrome\.permissions\.contains\(\{ permissions: \["nativeMessaging"\] \}\)/);
  assert.match(finallyBody, /if \(!nativePermissionGranted\)[\s\S]*renderNativePermissionRequired/);
  assert.match(finallyBody, /nativePermissionButton\.textContent = nativePermissionGranted \? "重新检查" : "开启本地下载引擎"/);
});

test("blocked recovery and permission removal use the failed action state without erasing detail", () => {
  const request = functionBody("requestNativeAccess");
  assert.match(request, /if \(recovery\.recoveryBlocked\)[\s\S]*throw nativeAccessFlowFailure\([\s\S]*"native_recovery_blocked"/);
  assert.match(request, /if \(recovery\.hostStatus\?\.needsPermission\)[\s\S]*renderNativePermissionRequired\("本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权"\)[\s\S]*throw nativeAccessFlowFailure/);
  const diagnosticsIndex = request.indexOf("await refreshDiagnostics()");
  const livePermissionIndex = request.indexOf("nativePermissionGranted = await chrome.permissions.contains", diagnosticsIndex);
  assert.ok(diagnosticsIndex >= 0 && livePermissionIndex > diagnosticsIndex,
    "the live permission check must follow all native diagnostics work");
  assert.match(request.slice(livePermissionIndex), /if \(!nativePermissionGranted\)[\s\S]*throw nativeAccessFlowFailure/);
  assert.match(request, /else if \(error\?\.preserveNativeStatus !== true\)/);
  assert.doesNotMatch(request, /if \(recovery\.recoveryBlocked\) return/);

  const failure = functionBody("nativeAccessFlowFailure");
  assert.match(failure, /preserveNativeStatus: true/);
});

test("presets, caret insertion and private-network confirmation are wired", () => {
  assert.match(source, /Object\.freeze\(\{ name: "stable", fragments: 4, ranges: 4 \}\)/);
  assert.match(source, /Object\.freeze\(\{ name: "balanced", fragments: 8, ranges: 8 \}\)/);
  assert.match(source, /Object\.freeze\(\{ name: "fast", fragments: 12, ranges: 12 \}\)/);
  assert.match(source, /insertTemplateToken\(templateInput\.value, token, templateSelection\.start, templateSelection\.end\)/);
  assert.match(source, /button\.setAttribute\("aria-pressed", String\(selected\)\)/);
  assert.match(source, /privateNetworkDialog\.showModal\(\)/);
  assert.match(source, /privateNetworkDialog\.returnValue === "confirm"/);
  assert.match(source, /const trigger = privateNetworkTrigger[\s\S]*setTimeout\(restoreTrigger, 0\)/);
});

test("validation exposes field errors, summary links and first-invalid focus", () => {
  const body = functionBody("renderValidation");
  assert.match(body, /setAttribute\("aria-invalid", "true"\)/);
  assert.match(body, /errorSummary\.hidden = false/);
  assert.match(body, /validation\.firstInvalidField/);
  assert.match(body, /\.focus\(\)/);
});
