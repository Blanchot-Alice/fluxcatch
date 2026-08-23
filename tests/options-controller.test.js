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
  assert.match(body, /validateSettings\(collectRawState\(\)\)/);
  assert.match(body, /withPendingAction\(saveButton, "options-save"/);
  assert.match(body, /pendingText: "保存中…"/);
  assert.match(body, /successText: "已保存 ✓"/);
  assert.match(body, /liveDuration: 0/);
  assert.match(body, /youtubeEnabled: false/);
  assert.match(body, /blockedDomains: normalized\.blockedDomains/);
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
  assert.match(request, /permissionDenied = true[\s\S]*throw new Error\("暂未开启高速下载功能"\)/);
  const render = functionBody("renderHostStatus");
  assert.match(render, /ytdlp\?\.installed === true \|\| ytdlp\?\.available === true/);
  assert.match(render, /const ytdlpAvailable = ytdlp\?\.available === true/);
  assert.match(render, /"已安装 · 联网功能未开放"/);
  assert.match(render, /BUILD_PROFILE\.features\.externalToolNetwork === true/);
  assert.match(render, /"协议或能力配置不匹配"/);
  assert.match(render, /"未安装"/);
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
