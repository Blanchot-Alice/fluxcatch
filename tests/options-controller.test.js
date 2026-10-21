// Source-level contracts of the v2 Settings controller (extension/options/options.js).
// Behaviour in a DOM is covered by tests/ui-v2-settings.test.js.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../extension/options/options.js", import.meta.url), "utf8");

function functionBody(name) {
  const start = source.search(new RegExp(`(?:async )?function ${name}\\(`));
  assert.notEqual(start, -1, `${name} is missing`);
  const next = source.slice(start + 1).search(/\n(?:async )?function |\nexport function /);
  return source.slice(start, next === -1 ? source.length : start + 1 + next);
}

test("autosave replaces the save bar: one serialized save per change, on top of the stored settings", () => {
  assert.doesNotMatch(source, /saveBar|discardChanges|dirtyStatus|save-btn/);
  const persist = functionBody("persist");
  assert.match(persist, /saveChain\.then\(run\)/, "saves run one at a time");
  assert.match(persist, /settingsPayload\(base, \{ \.\.\.stateFromSettings\(base\), \.\.\.patch \}, \{ changed: Object\.keys\(patch\) \}\)/, "only the changed field is laid over the stored record");
  assert.match(persist, /const generation = buildGeneration;[\s\S]*const run = /, "the controls in place are noted when the save is asked for");
  assert.match(persist, /if \(generation !== buildGeneration\) syncControls\(Object\.keys\(patch\)\)/, "a rebuild during the save is caught up");
  assert.match(persist, /const rowElement = ui\.rows\[rowKey\]/, "the row is looked up when the save ends");
  assert.match(persist, /callWorker\(\{ type: "SAVE_SETTINGS", settings: payload \}\)/);
  assert.match(persist, /markSaved\(rowElement\)/);
  assert.match(persist, /setSettingError\(rowElement, errorText\(error\)\)/, "errors go through errors.js");
  const commit = functionBody("commitField");
  assert.match(commit, /validateSettings\(/);
  assert.match(commit, /state\.invalid\.add\(field\)/);
  assert.match(commit, /if \(rawValue\(field\) !== raw\) return/, "typing during a save is never overwritten");
  assert.match(commit, /else \{[\s\S]*state\.invalid\.add\(field\)/, "a failed save keeps the typed value as unsaved");
});

test("the unload warning fires only for typed values that could not be saved", () => {
  assert.match(source, /addEventListener\?\.\("beforeunload"[\s\S]*if \(!state\.invalid\.size\) return;/);
});

test("permission requests stay first in their own gesture", () => {
  for (const [name, permission] of [["requestNativeAccess", "nativeMessaging"], ["changeDownloadFolder", "nativeMessaging"], ["changeNotifications", "notifications"]]) {
    const body = functionBody(name);
    const request = body.indexOf(`permissions.request({ permissions: ["${permission}"] })`);
    assert.ok(request > 0, `${name} requests ${permission}`);
    assert.equal(body.slice(0, request).includes("await "), false, `${name} awaits nothing before the request`);
  }
});

test("the engine check reconciles the live permission and recovers Chrome's API without messaging the worker while waiting", () => {
  const check = functionBody("checkEngine");
  assert.match(check, /await pingHost\(\)/);
  assert.match(check, /await recoverNativeApi\(host\)/);
  assert.match(check, /finally \{[\s\S]*permissionsContains\("nativeMessaging"\)[\s\S]*permissionRemoved = true/);
  const recover = functionBody("recoverNativeApi");
  assert.match(recover, /failureReason !== "api_unavailable" \|\| host\.selfHealing === true/);
  const complete = functionBody("completeNativeApiRecovery");
  assert.match(complete, /type: "RECOVER_NATIVE_API"/);
  const wait = complete.indexOf("await waitForNativeRecovery(retryAfterMs)");
  const ping = complete.indexOf("recovered = await pingHost()", wait);
  assert.ok(wait > 0 && ping > wait);
  assert.doesNotMatch(complete.slice(wait, ping), /callWorker|sendMessage/);
  assert.match(complete, /response\.recoveryBlocked === true[\s\S]*restartRequired: true/);
  assert.doesNotMatch(source, /chrome\.runtime\.reload\(\)/);
});

test("home-network downloads ask with the shared confirm popover before saving", () => {
  const body = functionBody("changePrivateNetwork");
  const confirm = body.indexOf("menus.confirm(element");
  const save = body.indexOf('saveBoolean("allowPrivateNetworkMedia", true');
  assert.ok(confirm > 0 && save > confirm);
  assert.match(body, /if \(!confirmed\) return;/);
  assert.equal((source.match(/createMenus\(/g) || []).length, 1, "one menus instance per page");
});

test("messages travel unchanged: the same worker message types as v1, through callWorker", () => {
  for (const type of ["GET_SETTINGS", "SAVE_SETTINGS", "PING_HOST", "RECOVER_NATIVE_API", "GET_DIAGNOSTICS", "CHOOSE_DOWNLOAD_FOLDER", "OPEN_DOWNLOAD_FOLDER", "OPEN_DOWNLOADS_PAGE"]) {
    assert.match(source, new RegExp(`type: "${type}"`), type);
  }
  assert.doesNotMatch(source, /chrome\.runtime\.sendMessage/, "worker calls go through ui/v2/runtime.js");
  assert.doesNotMatch(source, /\.message\b(?!s)/, "raw error text is never shown");
});

test("Set up links land here: #local-engine, and the legacy #localCapabilities", () => {
  assert.match(source, /id: "local-engine"/);
  assert.match(source, /localCapabilities: "local-engine"/);
  assert.match(functionBody("jumpToHash"), /history\?\.replaceState/);
});

test("developer tools gate the UI editor and the version info", () => {
  assert.match(source, /href = DESIGNER_URL/);
  assert.match(functionBody("renderDeveloper"), /ui\.developerRows\.hidden = !state\.developer/);
  assert.match(source, /bindUiCustomization\(\{ onChange: onCustomizationChange \}\)/, "layout overrides only");
  assert.doesNotMatch(source, /copyRoot|uiCopy|data-ui-copy/, "the UI editor never replaces v2 copy");
  assert.match(functionBody("copyVersionInfo"), /navigator\.clipboard\.writeText\(JSON\.stringify\(diagnostics, null, 2\)\)/);
});

test("action buttons keep their own words as names; the shared settingRow describes them", () => {
  assert.doesNotMatch(source, /function (nameActions|actionGroup|setFieldError)\(/, "no local copies of the shared row wiring");
  assert.doesNotMatch(source, /actions: true/);
  for (const call of ["row(\"history\"", "row(\"shortcuts\"", "row(\"editor\"", "row(\"version\"", "row(\"location\""]) {
    assert.ok(source.indexOf(call) > 0, call);
  }
  assert.match(source, /control: \[statusNode, action\]/, "the engine row's status word and action share one group");
});

test("a cancelled folder pick is silent", () => {
  assert.match(functionBody("changeDownloadFolder"), /error\?\.code === "cancelled" \? "" : errorText\(error\)/);
});
