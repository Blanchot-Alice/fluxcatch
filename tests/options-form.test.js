import test from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_FORM_STATE,
  BYTES_PER_KB,
  FILENAME_TOKENS,
  FORM_LIMITS,
  TOKEN_LABELS,
  engineState,
  insertTemplateToken,
  matchPreset,
  normalizeDomainLines,
  normalizeFormState,
  renderTemplatePreview,
  resolveNotificationLoadState,
  settingsPayload,
  stateFromSettings,
  statesEqual,
  validateFilenameTemplate,
  validateSettings
} from "../extension/options/form-state.js";

const VALID_STATE = Object.freeze({
  concurrentFragments: 8,
  concurrentRanges: 8,
  concurrentJobs: 3,
  outputContainer: "mp4",
  minimumKB: 500,
  filenameTemplate: "{title}",
  blockedDomains: [],
  saveAs: false,
  useNativeForDirect: false,
  allowPrivateNetworkMedia: false,
  autoEnrichSiteQuality: false,
  showNotifications: false
});

test("normalizeFormState returns only the allowlisted Options schema", () => {
  const normalized = normalizeFormState({
    ...VALID_STATE,
    concurrentFragments: "08",
    minimumKB: "0500",
    outputContainer: " MP4 ",
    blockedDomains: " HTTPS://Example.COM.:8443/media?q=1#fragment\nexample.com ",
    showNotifications: "true",
    liveDuration: 3600,
    youtubeEnabled: true,
    url: "https://private.invalid/media",
    headers: { cookie: "secret" },
    token: "secret"
  });

  assert.deepEqual(normalized, {
    ...VALID_STATE,
    concurrentFragments: 8,
    minimumKB: 500,
    blockedDomains: ["example.com"],
    showNotifications: true
  });
  for (const forbidden of ["liveDuration", "youtubeEnabled", "url", "headers", "token"]) {
    assert.equal(Object.hasOwn(normalized, forbidden), false);
  }
});

test("automatic site-quality enrichment defaults on while preserving an explicit opt-out", () => {
  assert.equal(normalizeFormState({}).autoEnrichSiteQuality, true);
  assert.equal(normalizeFormState({ autoEnrichSiteQuality: false }).autoEnrichSiteQuality, false);
});

test("normalizeDomainLines strips URL decoration, lowercases and deduplicates", () => {
  const result = normalizeDomainLines([
    "HTTPS://Media.Example.COM.:8443/path/to/file?token=redacted#part",
    "media.example.com",
    "//SECOND.Example.COM/download",
    "例子.中国",
    "",
    "  "
  ]);

  assert.deepEqual(result.domains, [
    "media.example.com",
    "second.example.com",
    "xn--fsqu00a.xn--fiqs8s"
  ]);
  assert.equal(result.normalizedText, result.domains.join("\n"));
  assert.deepEqual(result.invalidLineNumbers, []);
});

test("normalizeDomainLines rejects unsafe and unreasonable host forms with line numbers", () => {
  const lines = [
    "*.example.com",
    "https://user:pass@example.com/path",
    "127.0.0.1:8080",
    "http://[::1]/",
    "localhost",
    "https://-bad.example.com/",
    "https://bad_.example.com/",
    "ftp://example.com/file",
    "https:///",
    "https://example.123/",
    ".example.com",
    "good.example.com"
  ];
  const result = normalizeDomainLines(lines.join("\n"));

  assert.deepEqual(result.domains, ["good.example.com"]);
  assert.deepEqual(result.invalidLineNumbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "wildcard",
    "userinfo",
    "ip_literal",
    "ip_literal",
    "single_label",
    "invalid_domain",
    "invalid_domain",
    "unsupported_scheme",
    "invalid_url",
    "invalid_url",
    "invalid_domain"
  ]);
});

test("normalizeDomainLines enforces per-line, domain and result-count limits", () => {
  const overlongLine = `https://${"a".repeat(FORM_LIMITS.domainLineMaxLength)}.example.com/path`;
  const overlongLabel = `${"a".repeat(64)}.example.com`;
  const domains = Array.from({ length: FORM_LIMITS.domainMaxCount + 1 }, (_, index) => `d${index}.example.com`);
  const result = normalizeDomainLines([overlongLine, overlongLabel, ...domains]);

  assert.equal(result.domains.length, FORM_LIMITS.domainMaxCount);
  assert.deepEqual(result.invalidLineNumbers, [1, 2, FORM_LIMITS.domainMaxCount + 3]);
  assert.deepEqual(result.issues.map((issue) => issue.code), [
    "line_too_long",
    "invalid_domain",
    "too_many_domains"
  ]);
  assert.ok(result.domains.every((domain) => /^[a-z0-9.-]+$/.test(domain)));
});

test("validateFilenameTemplate accepts the five supported tokens", () => {
  assert.deepEqual(FILENAME_TOKENS, ["{title}", "{host}", "{kind}", "{height}", "{date}"]);
  const result = validateFilenameTemplate("{title} - {host} - {kind} - {height} - {date}");
  assert.equal(result.valid, true);
  assert.deepEqual(result.unknownTokens, []);
  assert.equal(result.mayRenderEmpty, false);
});

test("validateFilenameTemplate reports unknown, malformed, empty and risky output", () => {
  const unknown = validateFilenameTemplate("{title}-{quality}-{quality}-{codec}");
  assert.equal(unknown.valid, false);
  assert.deepEqual(unknown.unknownTokens, ["{quality}", "{codec}"]);
  assert.ok(unknown.errors.some((error) => error.code === "unknown_token"));

  const malformed = validateFilenameTemplate("{title");
  assert.equal(malformed.valid, false);
  assert.ok(malformed.errors.some((error) => error.code === "malformed_token"));

  const empty = validateFilenameTemplate("   ");
  assert.equal(empty.valid, false);
  assert.equal(empty.mayRenderEmpty, true);
  assert.ok(empty.errors.some((error) => error.code === "empty"));

  const risky = validateFilenameTemplate("({height}) - ");
  assert.equal(risky.valid, false);
  assert.equal(risky.mayRenderEmpty, true);
  assert.ok(risky.errors.some((error) => error.code === "may_render_empty"));

  assert.equal(validateFilenameTemplate("{height}p").mayRenderEmpty, false);
  assert.equal(validateFilenameTemplate("media-{height}").valid, true);
});

test("validateFilenameTemplate enforces length and rejects control characters", () => {
  const tooLong = validateFilenameTemplate("x".repeat(FORM_LIMITS.filenameTemplateMaxLength + 1));
  assert.equal(tooLong.valid, false);
  assert.ok(tooLong.errors.some((error) => error.code === "too_long"));
  assert.equal(tooLong.normalized.length, FORM_LIMITS.filenameTemplateMaxLength);

  const control = validateFilenameTemplate("{title}\u0000suffix");
  assert.equal(control.valid, false);
  assert.ok(control.errors.some((error) => error.code === "control_character"));
});

test("insertTemplateToken inserts or replaces at UTF-16 caret positions", () => {
  assert.deepEqual(insertTemplateToken("前后", "title", 1), {
    value: "前{title}后",
    selectionStart: 8,
    selectionEnd: 8
  });
  assert.deepEqual(insertTemplateToken("abc xyz", "{date}", 4, 7), {
    value: "abc {date}",
    selectionStart: 10,
    selectionEnd: 10
  });
  assert.deepEqual(insertTemplateToken("abc", "host", 99, -2), {
    value: "{host}",
    selectionStart: 6,
    selectionEnd: 6
  });
  assert.throws(() => insertTemplateToken("", "quality", 0), /Unsupported filename token/);
});

test("validateSettings enforces integer numeric boundaries", () => {
  for (const [field, min, max] of [
    ["concurrentFragments", 1, 24],
    ["concurrentRanges", 1, 24],
    ["concurrentJobs", 1, 6],
    ["minimumKB", 0, 100000]
  ]) {
    assert.equal(validateSettings({ ...VALID_STATE, [field]: min }).valid, true, `${field} accepts minimum`);
    assert.equal(validateSettings({ ...VALID_STATE, [field]: max }).valid, true, `${field} accepts maximum`);
    for (const value of [min - 1, max + 1]) {
      const result = validateSettings({ ...VALID_STATE, [field]: value });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.field === field && error.code === "out_of_range" && error.params.min === min && error.params.max === max));
    }
    for (const value of ["", "not-a-number", min + 0.5]) {
      const result = validateSettings({ ...VALID_STATE, [field]: value });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.field === field));
    }
  }
});

test("validateSettings reports field errors, invalid domain lines and the first target", () => {
  const result = validateSettings({
    ...VALID_STATE,
    concurrentFragments: 0,
    outputContainer: "avi",
    filenameTemplate: "{unknown}",
    blockedDomains: "good.example.com\n127.0.0.1\n*.example.com"
  });

  assert.equal(result.valid, false);
  assert.equal(result.firstInvalidField, "concurrentFragments");
  assert.ok(result.fieldErrors.concurrentFragments.length > 0);
  assert.ok(result.fieldErrors.outputContainer.length > 0);
  assert.ok(result.fieldErrors.filenameTemplate.length > 0);
  assert.deepEqual(
    result.errors.find((error) => error.field === "blockedDomains")?.params.lines,
    [2, 3]
  );
  assert.deepEqual(result.normalized.blockedDomains, ["good.example.com"]);
});

test("statesEqual compares valid semantic state rather than raw formatting", () => {
  const first = {
    ...VALID_STATE,
    blockedDomains: "Example.com.\nmedia.example.com\nexample.com"
  };
  const equivalent = {
    ...VALID_STATE,
    concurrentFragments: "08",
    concurrentRanges: "8",
    minimumKB: "0500",
    outputContainer: "MP4",
    blockedDomains: ["https://example.com/path", "MEDIA.EXAMPLE.COM:443"]
  };
  assert.equal(statesEqual(first, equivalent), true);
  assert.equal(statesEqual(first, { ...equivalent, concurrentRanges: 9 }), false);
  assert.equal(statesEqual(first, { ...equivalent, blockedDomains: "example.com\n127.0.0.1" }), false,
    "invalid input must remain dirty instead of normalizing away");
});

test("notification load state repairs a saved preference after browser permission is revoked", () => {
  assert.deepEqual(resolveNotificationLoadState(), { checked: false, requiresRepair: false });
  assert.deepEqual(resolveNotificationLoadState({ persisted: true, permissionGranted: true }), { checked: true, requiresRepair: false });
  assert.deepEqual(resolveNotificationLoadState({ persisted: true, permissionGranted: false }), { checked: false, requiresRepair: true });
});

test("validation issues carry codes and params, never prose", () => {
  const unknown = validateFilenameTemplate("{title}-{quality}");
  assert.deepEqual(unknown.errors, [{ code: "unknown_token", params: { tokens: ["{quality}"] } }]);
  const lines = validateSettings({ ...VALID_STATE, blockedDomains: "ok.example.com\n*.example.com" });
  assert.deepEqual(lines.fieldErrors.blockedDomains, [{ field: "blockedDomains", code: "invalid_lines", params: { lines: [2] } }]);
  for (const error of [...unknown.errors, ...lines.errors]) assert.equal(Object.hasOwn(error, "message"), false);
});

test("minimum size uses decimal kilobytes in both directions", () => {
  assert.equal(BYTES_PER_KB, 1000);
  assert.equal(stateFromSettings({ minimumBytes: 512000 }).minimumKB, 512);
  assert.equal(stateFromSettings({ minimumBytes: 500 * 1024 }).minimumKB, 512, "the old 500 KiB default reads as 512 KB");
  assert.equal(settingsPayload({}, { ...VALID_STATE, minimumKB: 750 }).minimumBytes, 750000);
  assert.ok(FORM_LIMITS.minimumKBMax * BYTES_PER_KB <= 100 * 1024 * 1024, "the maximum fits the worker's stored cap");
  assert.equal(FORM_LIMITS.minimumKBMax, 100000, "a round ceiling (100 MB), not a leftover binary figure");
  assert.equal(stateFromSettings({ minimumBytes: 100 * 1024 * 1024 }).minimumKB, FORM_LIMITS.minimumKBMax, "the worker's cap reads as the largest editable value");
});

test("saving another setting sends a stored byte size back exactly; editing the size converts it", () => {
  const base = { minimumBytes: 307200 };
  const state = stateFromSettings(base);
  assert.equal(state.minimumKB, 307);
  assert.equal(settingsPayload(base, { ...state, saveAs: true }, { changed: ["saveAs"] }).minimumBytes, 307200);
  assert.equal(settingsPayload(base, { ...state, minimumKB: 400 }, { changed: ["minimumKB"] }).minimumBytes, 400000);
  assert.equal(settingsPayload({}, { ...state, saveAs: true }, { changed: ["saveAs"] }).minimumBytes, 307000, "nothing stored: the form value is sent");
  assert.equal(settingsPayload(base, state).minimumBytes, 307000, "without a change list the form value is sent");
});

test("the save payload keeps unknown stored fields, sends every setting and closes the build gates", () => {
  const payload = settingsPayload({ futureField: 1, youtubeEnabled: true, liveDuration: 3600 }, { ...VALID_STATE, saveAs: true });
  assert.equal(payload.futureField, 1);
  assert.equal(payload.youtubeEnabled, false);
  assert.equal(payload.liveDuration, 0);
  assert.equal(payload.saveAs, true);
  assert.equal(payload.minimumBytes, 500000);
  assert.equal(Object.hasOwn(payload, "minimumKB"), false);
});

test("presets match only when both connection counts agree", () => {
  assert.equal(matchPreset(4, 4), "stable");
  assert.equal(matchPreset("8", "12"), "balanced");
  assert.equal(matchPreset(12, 12), "fast");
  assert.equal(matchPreset(8, 8), null);
});

test("the worker's default connection counts select Balanced, and the form defaults agree", async () => {
  const source = await import("node:fs").then((fs) => fs.readFileSync(new URL("../extension/background.js", import.meta.url), "utf8"));
  const defaults = source.match(/const DEFAULT_SETTINGS = \{([\s\S]*?)\n\};/)[1];
  const fragments = Number(defaults.match(/concurrentFragments:\s*(\d+)/)[1]);
  const ranges = Number(defaults.match(/concurrentRanges:\s*(\d+)/)[1]);
  assert.equal(matchPreset(fragments, ranges), "balanced");
  assert.equal(matchPreset(DEFAULT_FORM_STATE.concurrentFragments, DEFAULT_FORM_STATE.concurrentRanges), "balanced");
  const empty = stateFromSettings({});
  assert.equal(matchPreset(empty.concurrentFragments, empty.concurrentRanges), "balanced", "nothing stored reads as Balanced too");
});

test("file-name chips map every token to its label and the preview renders sample values", () => {
  assert.deepEqual(FILENAME_TOKENS.map((token) => TOKEN_LABELS[token]), ["title", "site", "type", "resolution", "date"]);
  assert.equal(renderTemplatePreview("{title} - {height}", { title: "Clip", height: "1080" }), "Clip - 1080.mp4");
  assert.equal(renderTemplatePreview("{height}", {}), "");
});

test("engine state names every host condition with one label, one line and one action", () => {
  assert.equal(engineState({ checking: true }).label, "settings.engine.checking");
  assert.deepEqual(
    [engineState({ permission: false }).label, engineState({ permission: false }).action],
    ["settings.engine.notSetUp", "setUp"]
  );
  assert.equal(engineState({ permission: false }).tone, "queued", "Not set up is harbour, as on the popup, side panel and Downloads");
  assert.equal(engineState({ permission: false, removed: true }).description, "settings.engine.removed");
  assert.equal(engineState({ permission: true, host: { failureReason: "api_unavailable" } }).label, "settings.engine.finishing");
  assert.equal(engineState({ permission: true, host: { failureReason: "api_unavailable", selfHealing: true } }).description, "settings.engine.descSelfHealing");
  assert.equal(engineState({ permission: true, host: { failureReason: "api_unavailable", restartRequired: true } }).label, "settings.engine.restart");
  assert.deepEqual(engineState({ permission: true, host: { failureReason: "api_unavailable" }, retrySeconds: 35 }).params, { seconds: 35 });
  const missing = engineState({ permission: true, host: { failureReason: "host_missing" } });
  assert.equal(missing.label, "settings.engine.notInstalled");
  assert.equal(missing.install, true);
  assert.equal(engineState({ permission: true, host: {}, failed: true }).label, "settings.engine.noConnection");
  assert.equal(engineState({ permission: true, host: { connected: true, compatible: false } }).label, "settings.engine.updateNeeded");
  const ready = engineState({ permission: true, host: { connected: true, compatible: true, capabilities: { ffmpeg: { available: true } } } });
  assert.deepEqual([ready.tone, ready.label, ready.action, ready.merging], ["complete", "settings.engine.ready", "", true], "a Ready engine offers no Retry");
  for (const host of [{ failureReason: "host_missing" }, {}, { connected: true, compatible: false }, { failureReason: "api_unavailable" }, { failureReason: "api_unavailable", restartRequired: true }]) {
    assert.equal(engineState({ permission: true, host, failed: true }).action, "retry", `Retry stays for ${JSON.stringify(host)}`);
  }
  assert.equal(engineState({ permission: true, host: { connected: true, compatible: true, ffmpeg: false } }).merging, false);
});
