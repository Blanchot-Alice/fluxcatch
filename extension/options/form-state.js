export const FORM_LIMITS = Object.freeze({
  concurrencyMin: 1,
  concurrencyMax: 24,
  minimumKiBMin: 0,
  minimumKiBMax: 102400,
  filenameTemplateMaxLength: 160,
  domainMaxCount: 500,
  domainMaxLength: 253,
  domainLineMaxLength: 2048
});

export const FILENAME_TOKENS = Object.freeze([
  "{title}",
  "{host}",
  "{kind}",
  "{height}",
  "{date}"
]);

const FILENAME_TOKEN_SET = new Set(FILENAME_TOKENS);
const GUARANTEED_FILENAME_TOKENS = new Set(["{title}", "{host}", "{kind}", "{date}"]);
const OUTPUT_CONTAINERS = new Set(["mp4", "mkv", "webm"]);

const DEFAULT_FORM_STATE = Object.freeze({
  concurrentFragments: 8,
  concurrentRanges: 8,
  outputContainer: "mp4",
  minimumKiB: 500,
  filenameTemplate: "{title}",
  blockedDomains: Object.freeze([]),
  saveAs: false,
  useNativeForDirect: false,
  allowPrivateNetworkMedia: false,
  autoEnrichSiteQuality: true,
  showNotifications: false
});

/**
 * Convert the editable Options values into a canonical, allowlisted UI state.
 * Validation remains a separate step: invalid numbers are intentionally not
 * clamped, so the caller can show the user the original error instead of
 * silently changing their input.
 */
export function normalizeFormState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    concurrentFragments: canonicalNumber(source.concurrentFragments, DEFAULT_FORM_STATE.concurrentFragments),
    concurrentRanges: canonicalNumber(source.concurrentRanges, DEFAULT_FORM_STATE.concurrentRanges),
    outputContainer: canonicalText(source.outputContainer, DEFAULT_FORM_STATE.outputContainer).toLowerCase(),
    minimumKiB: canonicalNumber(source.minimumKiB, DEFAULT_FORM_STATE.minimumKiB),
    filenameTemplate: canonicalTemplate(source.filenameTemplate, DEFAULT_FORM_STATE.filenameTemplate),
    blockedDomains: normalizeDomainLines(source.blockedDomains).domains,
    saveAs: canonicalBoolean(source.saveAs),
    useNativeForDirect: canonicalBoolean(source.useNativeForDirect),
    allowPrivateNetworkMedia: canonicalBoolean(source.allowPrivateNetworkMedia),
    autoEnrichSiteQuality: typeof source.autoEnrichSiteQuality === "undefined"
      ? DEFAULT_FORM_STATE.autoEnrichSiteQuality
      : canonicalBoolean(source.autoEnrichSiteQuality),
    showNotifications: canonicalBoolean(source.showNotifications)
  };
}

export function notificationStatusText({ checked = false, baselineChecked = false, dirty = false, permissionGranted = false } = {}) {
  if (checked) {
    return baselineChecked && !dirty
      ? "通知已开启"
      : permissionGranted
        ? "通知权限已开启；保存后生效"
        : "需要先允许 Chrome 通知权限";
  }
  if (baselineChecked && dirty) return "保存后将停止提醒；已有浏览器授权会保留";
  return permissionGranted ? "通知保持关闭；已有浏览器授权会保留" : "通知保持关闭";
}

export function resolveNotificationLoadState({ persisted = false, permissionGranted = false } = {}) {
  const saved = persisted === true;
  const granted = permissionGranted === true;
  return {
    checked: saved && granted,
    requiresRepair: saved && !granted
  };
}

/**
 * Normalize an ignored-domain textarea without ever returning URLs, ports,
 * credentials or IP literals. Blank lines and duplicates are harmless; every
 * other rejected input is reported using its one-based source line number.
 */
export function normalizeDomainLines(value) {
  const lines = domainSourceLines(value);
  const domains = [];
  const seen = new Set();
  const issues = [];

  for (let index = 0; index < lines.length; index += 1) {
    const lineNumber = index + 1;
    const raw = String(lines[index] ?? "").trim();
    if (!raw) continue;

    if (raw.length > FORM_LIMITS.domainLineMaxLength) {
      issues.push(domainIssue(lineNumber, "line_too_long"));
      continue;
    }

    const parsed = parseOrdinaryDomain(raw);
    if (!parsed.ok) {
      issues.push(domainIssue(lineNumber, parsed.code));
      continue;
    }

    if (seen.has(parsed.domain)) continue;
    if (domains.length >= FORM_LIMITS.domainMaxCount) {
      issues.push(domainIssue(lineNumber, "too_many_domains"));
      continue;
    }
    seen.add(parsed.domain);
    domains.push(parsed.domain);
  }

  const invalidLineNumbers = issues.map((issue) => issue.line);
  return {
    domains,
    normalizedText: domains.join("\n"),
    invalidLineNumbers,
    issues
  };
}

export function validateFilenameTemplate(value) {
  const template = canonicalTemplate(value, "");
  const errors = [];
  const unknownTokens = [];
  const seenUnknown = new Set();

  if (!template) {
    errors.push(filenameIssue("empty", "文件名模板不能为空。"));
  }
  if (String(value ?? "").length > FORM_LIMITS.filenameTemplateMaxLength) {
    errors.push(filenameIssue("too_long", `文件名模板不能超过 ${FORM_LIMITS.filenameTemplateMaxLength} 个字符。`));
  }
  if (/\p{Cc}/u.test(String(value ?? ""))) {
    errors.push(filenameIssue("control_character", "文件名模板不能包含控制字符。"));
  }

  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const token = match[0];
    if (!FILENAME_TOKEN_SET.has(token) && !seenUnknown.has(token)) {
      seenUnknown.add(token);
      unknownTokens.push(token);
    }
  }
  if (unknownTokens.length) {
    errors.push(filenameIssue("unknown_token", `不支持的文件名字段：${unknownTokens.join("、")}。`));
  }

  const withoutWellFormedTokens = template.replace(/\{[^{}]*\}/g, "");
  if (/[{}]/.test(withoutWellFormedTokens)) {
    errors.push(filenameIssue("malformed_token", "文件名字段的大括号不完整。"));
  }

  const hasGuaranteedToken = FILENAME_TOKENS.some((token) =>
    GUARANTEED_FILENAME_TOKENS.has(token) && template.includes(token)
  );
  const literal = template.replace(/\{[^{}]*\}/g, "");
  const hasMeaningfulLiteral = /[\p{L}\p{N}]/u.test(literal);
  const mayRenderEmpty = !template || (!hasGuaranteedToken && !hasMeaningfulLiteral);
  if (template && mayRenderEmpty) {
    errors.push(filenameIssue("may_render_empty", "这个模板在部分媒体上可能生成空文件名，请加入标题、站点、类型、日期或固定文字。"));
  }

  return {
    valid: errors.length === 0,
    normalized: template,
    unknownTokens,
    mayRenderEmpty,
    errors
  };
}

export function validateSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const errors = [];

  validateIntegerField(errors, "concurrentFragments", source.concurrentFragments,
    FORM_LIMITS.concurrencyMin, FORM_LIMITS.concurrencyMax, "视频片段并发数");
  validateIntegerField(errors, "concurrentRanges", source.concurrentRanges,
    FORM_LIMITS.concurrencyMin, FORM_LIMITS.concurrencyMax, "大文件并发数");
  validateIntegerField(errors, "minimumKiB", source.minimumKiB,
    FORM_LIMITS.minimumKiBMin, FORM_LIMITS.minimumKiBMax, "最小媒体大小");

  const outputContainer = canonicalText(source.outputContainer, "").toLowerCase();
  if (!OUTPUT_CONTAINERS.has(outputContainer)) {
    errors.push(settingIssue("outputContainer", "invalid_choice", "请选择支持的保存格式。"));
  }

  const filename = validateFilenameTemplate(source.filenameTemplate);
  for (const error of filename.errors) {
    errors.push(settingIssue("filenameTemplate", error.code, error.message));
  }

  const domainResult = normalizeDomainLines(source.blockedDomains);
  if (domainResult.invalidLineNumbers.length) {
    errors.push(settingIssue(
      "blockedDomains",
      "invalid_lines",
      `忽略域名第 ${domainResult.invalidLineNumbers.join("、")} 行无效。`,
      { lineNumbers: domainResult.invalidLineNumbers }
    ));
  }

  const fieldErrors = {};
  for (const error of errors) {
    (fieldErrors[error.field] ||= []).push(error.message);
  }

  return {
    valid: errors.length === 0,
    normalized: normalizeFormState({
      ...source,
      outputContainer,
      filenameTemplate: filename.normalized,
      blockedDomains: domainResult.domains
    }),
    errors,
    fieldErrors,
    firstInvalidField: errors[0]?.field || null
  };
}

/** Insert an allowlisted template token using DOM selectionStart semantics. */
export function insertTemplateToken(value, token, selectionStart, selectionEnd = selectionStart) {
  const source = String(value ?? "");
  const normalizedToken = normalizeToken(token);
  if (!FILENAME_TOKEN_SET.has(normalizedToken)) {
    throw new RangeError(`Unsupported filename token: ${String(token)}`);
  }

  const first = clampSelection(selectionStart, source.length);
  const second = clampSelection(selectionEnd, source.length);
  const start = Math.min(first, second);
  const end = Math.max(first, second);
  const nextValue = `${source.slice(0, start)}${normalizedToken}${source.slice(end)}`;
  const nextSelection = start + normalizedToken.length;
  return {
    value: nextValue,
    selectionStart: nextSelection,
    selectionEnd: nextSelection
  };
}

/** Compare only valid, normalized, allowlisted settings. */
export function statesEqual(first, second) {
  const firstValidation = validateSettings(first);
  const secondValidation = validateSettings(second);
  if (!firstValidation.valid || !secondValidation.valid) return false;
  return JSON.stringify(firstValidation.normalized) === JSON.stringify(secondValidation.normalized);
}

function domainSourceLines(value) {
  if (Array.isArray(value)) return value.flatMap((item) => String(item ?? "").split(/\r?\n/));
  return String(value ?? "").split(/\r?\n/);
}

function parseOrdinaryDomain(raw) {
  if (raw.includes("*")) return { ok: false, code: "wildcard" };
  if (/\s/u.test(raw)) return { ok: false, code: "whitespace" };

  const explicitScheme = raw.match(/^([a-z][a-z0-9+.-]*):\/\//i)?.[1]?.toLowerCase();
  if (explicitScheme && explicitScheme !== "http" && explicitScheme !== "https") {
    return { ok: false, code: "unsupported_scheme" };
  }

  let candidate = raw;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  else if (!explicitScheme) candidate = `https://${candidate}`;

  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, code: "invalid_url" };
  }
  if (!/^https?:$/.test(parsed.protocol)) return { ok: false, code: "unsupported_scheme" };
  if (parsed.username || parsed.password) return { ok: false, code: "userinfo" };

  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/g, "");
  if (!hostname) return { ok: false, code: "empty_host" };
  if (hostname.length > FORM_LIMITS.domainMaxLength) return { ok: false, code: "domain_too_long" };
  if (isIpLiteral(hostname)) return { ok: false, code: "ip_literal" };

  const labels = hostname.split(".");
  if (labels.length < 2) return { ok: false, code: "single_label" };
  if (labels.some((label) => !isDomainLabel(label))) return { ok: false, code: "invalid_domain" };
  if (!/[a-z]/.test(labels.at(-1))) return { ok: false, code: "invalid_tld" };
  return { ok: true, domain: hostname };
}

function isDomainLabel(label) {
  return label.length >= 1
    && label.length <= 63
    && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label);
}

function isIpLiteral(hostname) {
  if (hostname.includes(":") || hostname.startsWith("[") || hostname.endsWith("]")) return true;
  const parts = hostname.split(".");
  return parts.length === 4 && parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

function validateIntegerField(errors, field, value, min, max, label) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") {
    errors.push(settingIssue(field, "required", `${label}不能为空。`));
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    errors.push(settingIssue(field, "not_integer", `${label}必须是整数。`));
  } else if (number < min || number > max) {
    errors.push(settingIssue(field, "out_of_range", `${label}必须在 ${min} 到 ${max} 之间。`));
  }
}

function canonicalNumber(value, fallback) {
  if (value === undefined) return fallback;
  if (value === null || value === "" || typeof value === "boolean") return "";
  const number = Number(value);
  return Number.isFinite(number) ? number : String(value).trim();
}

function canonicalText(value, fallback = "") {
  if (value === undefined) return fallback;
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : fallback;
}

function canonicalTemplate(value, fallback = "") {
  if (value === undefined) return fallback;
  return typeof value === "string" || typeof value === "number"
    ? String(value).replace(/[\u0000-\u001f]/g, " ").trim().slice(0, FORM_LIMITS.filenameTemplateMaxLength)
    : fallback;
}

function canonicalBoolean(value) {
  return value === true || value === 1 || value === "true" || value === "on";
}

function normalizeToken(token) {
  const value = String(token ?? "").trim();
  return value.startsWith("{") && value.endsWith("}") ? value : `{${value}}`;
}

function clampSelection(value, length) {
  const number = Number(value);
  if (!Number.isFinite(number)) return length;
  return Math.min(length, Math.max(0, Math.trunc(number)));
}

function filenameIssue(code, message) {
  return { code, message };
}

function domainIssue(line, code) {
  return { line, code };
}

function settingIssue(field, code, message, details = {}) {
  return { field, code, message, ...details };
}
