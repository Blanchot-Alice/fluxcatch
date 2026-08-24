import test from "node:test";
import assert from "node:assert/strict";

import {
  FILENAME_TOKENS,
  FORM_LIMITS,
  insertTemplateToken,
  normalizeDomainLines,
  normalizeFormState,
  notificationStatusText,
  resolveNotificationLoadState,
  statesEqual,
  validateFilenameTemplate,
  validateSettings
} from "../extension/options/form-state.js";

const VALID_STATE = Object.freeze({
  concurrentFragments: 8,
  concurrentRanges: 8,
  outputContainer: "mp4",
  minimumKiB: 500,
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
    minimumKiB: "0500",
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
    minimumKiB: 500,
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
    ["minimumKiB", 0, 102400]
  ]) {
    assert.equal(validateSettings({ ...VALID_STATE, [field]: min }).valid, true, `${field} accepts minimum`);
    assert.equal(validateSettings({ ...VALID_STATE, [field]: max }).valid, true, `${field} accepts maximum`);
    for (const value of [min - 1, max + 1]) {
      const result = validateSettings({ ...VALID_STATE, [field]: value });
      assert.equal(result.valid, false);
      assert.ok(result.errors.some((error) => error.field === field && error.code === "out_of_range"));
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
    result.errors.find((error) => error.field === "blockedDomains")?.lineNumbers,
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
    minimumKiB: "0500",
    outputContainer: "MP4",
    blockedDomains: ["https://example.com/path", "MEDIA.EXAMPLE.COM:443"]
  };
  assert.equal(statesEqual(first, equivalent), true);
  assert.equal(statesEqual(first, { ...equivalent, concurrentRanges: 9 }), false);
  assert.equal(statesEqual(first, { ...equivalent, blockedDomains: "example.com\n127.0.0.1" }), false,
    "invalid input must remain dirty instead of normalizing away");
});

test("notification status follows saved preference, dirty state and retained permission", () => {
  assert.equal(notificationStatusText(), "通知保持关闭");
  assert.equal(notificationStatusText({ checked: true, permissionGranted: true, dirty: true }), "通知权限已开启；保存后生效");
  assert.equal(notificationStatusText({ checked: true, baselineChecked: true }), "通知已开启");
  assert.equal(notificationStatusText({ baselineChecked: true, dirty: true, permissionGranted: true }), "保存后将停止提醒；已有浏览器授权会保留");
  assert.equal(notificationStatusText({ permissionGranted: true }), "通知保持关闭；已有浏览器授权会保留");
});

test("notification load state repairs a saved preference after browser permission is revoked", () => {
  assert.deepEqual(resolveNotificationLoadState(), { checked: false, requiresRepair: false });
  assert.deepEqual(resolveNotificationLoadState({ persisted: true, permissionGranted: true }), { checked: true, requiresRepair: false });
  assert.deepEqual(resolveNotificationLoadState({ persisted: true, permissionGranted: false }), { checked: false, requiresRepair: true });
});
