// Pure Settings state: the editable values, their validation and the payload
// the worker stores. No DOM, no copy: issues carry a code and params, and the
// page turns them into words through ui/v2/messages (settings.error.<code>).

export const FORM_LIMITS = Object.freeze({
  concurrencyMin: 1,
  concurrencyMax: 24,
  jobsMin: 1,
  jobsMax: 6,
  // Decimal kilobytes, like Finder: 1 KB = 1000 bytes. The ceiling is a round
  // 100,000 KB (100 MB), below the worker's own cap of 100 MiB
  // (104,857,600 bytes), so every value typed here is stored as is.
  minimumKBMin: 0,
  minimumKBMax: 100000,
  filenameTemplateMaxLength: 160,
  domainMaxCount: 500,
  domainMaxLength: 253,
  domainLineMaxLength: 2048
});

export const BYTES_PER_KB = 1000;

export const FILENAME_TOKENS = Object.freeze([
  "{title}",
  "{host}",
  "{kind}",
  "{height}",
  "{date}"
]);

/** The chip label for each token: settings.token.<name> (Title · Site · Type · Resolution · Date). */
export const TOKEN_LABELS = Object.freeze({
  "{title}": "title",
  "{host}": "site",
  "{kind}": "type",
  "{height}": "resolution",
  "{date}": "date"
});

// Balanced is the worker's own default (background.js DEFAULT_SETTINGS: 8
// fragments, 12 ranges), so a fresh install shows it selected.
export const PRESETS = Object.freeze([
  Object.freeze({ name: "stable", fragments: 4, ranges: 4 }),
  Object.freeze({ name: "balanced", fragments: 8, ranges: 12 }),
  Object.freeze({ name: "fast", fragments: 12, ranges: 12 })
]);

export const OUTPUT_CONTAINERS = Object.freeze(["mp4", "mkv", "webm"]);

const FILENAME_TOKEN_SET = new Set(FILENAME_TOKENS);
const GUARANTEED_FILENAME_TOKENS = new Set(["{title}", "{host}", "{kind}", "{date}"]);
const OUTPUT_CONTAINER_SET = new Set(OUTPUT_CONTAINERS);

export const DEFAULT_FORM_STATE = Object.freeze({
  concurrentFragments: 8,
  concurrentRanges: 12,
  concurrentJobs: 3,
  outputContainer: "mp4",
  minimumKB: 512,
  filenameTemplate: "{title}",
  blockedDomains: Object.freeze([]),
  saveAs: false,
  useNativeForDirect: false,
  allowPrivateNetworkMedia: false,
  autoEnrichSiteQuality: true,
  showNotifications: false
});

export const BOOLEAN_FIELDS = Object.freeze([
  "saveAs",
  "useNativeForDirect",
  "allowPrivateNetworkMedia",
  "autoEnrichSiteQuality",
  "showNotifications"
]);

/**
 * Convert editable values into a canonical, allowlisted UI state.
 * Validation is a separate step: invalid numbers are not clamped, so the page
 * can show the user their own input with an error instead of changing it.
 */
export function normalizeFormState(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  return {
    concurrentFragments: canonicalNumber(source.concurrentFragments, DEFAULT_FORM_STATE.concurrentFragments),
    concurrentRanges: canonicalNumber(source.concurrentRanges, DEFAULT_FORM_STATE.concurrentRanges),
    concurrentJobs: canonicalNumber(source.concurrentJobs, DEFAULT_FORM_STATE.concurrentJobs),
    outputContainer: canonicalText(source.outputContainer, DEFAULT_FORM_STATE.outputContainer).toLowerCase(),
    minimumKB: canonicalNumber(source.minimumKB, DEFAULT_FORM_STATE.minimumKB),
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

/** The editable state for stored worker settings (bytes become decimal KB). */
export function stateFromSettings(settings = {}) {
  const source = settings && typeof settings === "object" ? settings : {};
  const bytes = Number(source.minimumBytes);
  return normalizeFormState({
    concurrentFragments: source.concurrentFragments,
    concurrentRanges: source.concurrentRanges,
    concurrentJobs: source.concurrentJobs,
    outputContainer: source.outputContainer,
    minimumKB: Number.isFinite(bytes) && bytes >= 0 ? Math.min(Math.round(bytes / BYTES_PER_KB), FORM_LIMITS.minimumKBMax) : undefined,
    filenameTemplate: source.filenameTemplate,
    blockedDomains: Array.isArray(source.blockedDomains) ? source.blockedDomains : [],
    saveAs: source.saveAs === true,
    useNativeForDirect: source.useNativeForDirect === true,
    allowPrivateNetworkMedia: source.allowPrivateNetworkMedia === true,
    autoEnrichSiteQuality: typeof source.autoEnrichSiteQuality === "boolean" ? source.autoEnrichSiteQuality : true,
    showNotifications: source.showNotifications === true
  });
}

/**
 * The full settings object for SAVE_SETTINGS: the last stored settings with
 * the (valid, normalized) form state on top. The worker replaces the record,
 * so every field is always sent; the stable build gates stay closed.
 * With `changed` (the form fields this save touches), a stored byte size is
 * sent back exactly unless minimumKB is among them, so saving another setting
 * never rounds it to whole KB.
 */
export function settingsPayload(base = {}, state = {}, { changed } = {}) {
  const normalized = normalizeFormState(state);
  const source = base && typeof base === "object" ? base : {};
  const storedBytes = Number(source.minimumBytes);
  const keepBytes = Array.isArray(changed) && !changed.includes("minimumKB") && Number.isFinite(storedBytes) && storedBytes >= 0;
  return {
    ...source,
    concurrentFragments: normalized.concurrentFragments,
    concurrentRanges: normalized.concurrentRanges,
    concurrentJobs: normalized.concurrentJobs,
    outputContainer: normalized.outputContainer,
    liveDuration: 0,
    minimumBytes: keepBytes ? storedBytes : Number(normalized.minimumKB) * BYTES_PER_KB,
    filenameTemplate: normalized.filenameTemplate,
    blockedDomains: normalized.blockedDomains,
    saveAs: normalized.saveAs,
    useNativeForDirect: normalized.useNativeForDirect,
    allowPrivateNetworkMedia: normalized.allowPrivateNetworkMedia,
    autoEnrichSiteQuality: normalized.autoEnrichSiteQuality,
    youtubeEnabled: false,
    showNotifications: normalized.showNotifications
  };
}

/** The preset whose values match both connection counts, or null (custom). */
export function matchPreset(fragments, ranges) {
  const a = Number(fragments);
  const b = Number(ranges);
  return PRESETS.find((preset) => preset.fragments === a && preset.ranges === b)?.name || null;
}

const HOST_FAILURES = new Set(["api_unavailable", "host_missing", "connection_failed"]);

/**
 * What the Settings rows say about the local engine, as message keys:
 * { tone, label, description, params, action: "setUp" | "retry" | "", install, merging, checking }.
 * A Ready engine has no action (""): Retry follows a failure only. "Not set up"
 * uses the queued (harbour) tone, the colour every other surface gives it.
 * `install` is true when the install steps should open, false when they should
 * close. `merging` is true when the engine can join and convert (FFmpeg).
 */
export function engineState({ checking = false, permission = false, host = {}, failed = false, retrySeconds = 0, removed = false } = {}) {
  const source = host && typeof host === "object" ? host : {};
  const ffmpeg = source.capabilities?.ffmpeg;
  const connected = source.connected === true;
  const compatible = connected && source.compatible === true;
  const merging = compatible && Boolean(ffmpeg ? ffmpeg.available : source.ffmpeg);
  const view = (tone, label, description, action, extra = {}) => ({ tone, label, description, params: {}, action, install: false, merging, checking: false, ...extra });

  if (checking) return view("queued", "settings.engine.checking", "", permission ? "retry" : "setUp", { checking: true, install: undefined });
  if (!permission || source.needsPermission) {
    return view("queued", "settings.engine.notSetUp", removed ? "settings.engine.removed" : "settings.engine.descNotSetUp", "setUp", { merging: false });
  }
  const reason = HOST_FAILURES.has(source.failureReason) ? source.failureReason : failed ? "connection_failed" : null;
  if (reason === "api_unavailable") {
    if (source.restartRequired === true && source.selfHealing !== true) {
      return view("warning", "settings.engine.restart", "settings.engine.descRestart", "retry", { merging: false });
    }
    if (retrySeconds > 0) {
      return { ...view("progress", "settings.engine.finishing", "settings.engine.descRetryIn", "retry", { merging: false }), params: { seconds: retrySeconds } };
    }
    return view("progress", "settings.engine.finishing", source.selfHealing === true ? "settings.engine.descSelfHealing" : "settings.engine.descFinishing", "retry", { merging: false });
  }
  if (reason === "host_missing") return view("failed", "settings.engine.notInstalled", "settings.engine.descNotInstalled", "retry", { install: true, merging: false });
  if (!connected) return view("failed", "settings.engine.noConnection", "settings.engine.descNoConnection", "retry", { merging: false });
  if (!compatible) return view("warning", "settings.engine.updateNeeded", "settings.engine.descUpdate", "retry");
  return view("complete", "settings.engine.ready", "", "");
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
 * Normalize an ignored-domain list without ever returning URLs, ports,
 * credentials or IP literals. Blank lines and duplicates are harmless; every
 * other rejected input is reported with its one-based source line number.
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

/** Validate a filename template. Issues are { code, params }. */
export function validateFilenameTemplate(value) {
  const template = canonicalTemplate(value, "");
  const errors = [];
  const unknownTokens = [];
  const seenUnknown = new Set();

  if (!template) errors.push(issue("empty"));
  if (String(value ?? "").length > FORM_LIMITS.filenameTemplateMaxLength) {
    errors.push(issue("too_long", { max: FORM_LIMITS.filenameTemplateMaxLength }));
  }
  if (/\p{Cc}/u.test(String(value ?? ""))) errors.push(issue("control_character"));

  for (const match of template.matchAll(/\{([^{}]*)\}/g)) {
    const token = match[0];
    if (!FILENAME_TOKEN_SET.has(token) && !seenUnknown.has(token)) {
      seenUnknown.add(token);
      unknownTokens.push(token);
    }
  }
  if (unknownTokens.length) errors.push(issue("unknown_token", { tokens: [...unknownTokens] }));

  const withoutWellFormedTokens = template.replace(/\{[^{}]*\}/g, "");
  if (/[{}]/.test(withoutWellFormedTokens)) errors.push(issue("malformed_token"));

  const hasGuaranteedToken = FILENAME_TOKENS.some((token) =>
    GUARANTEED_FILENAME_TOKENS.has(token) && template.includes(token)
  );
  const literal = template.replace(/\{[^{}]*\}/g, "");
  const hasMeaningfulLiteral = /[\p{L}\p{N}]/u.test(literal);
  const mayRenderEmpty = !template || (!hasGuaranteedToken && !hasMeaningfulLiteral);
  if (template && mayRenderEmpty) errors.push(issue("may_render_empty"));

  return {
    valid: errors.length === 0,
    normalized: template,
    unknownTokens,
    mayRenderEmpty,
    errors
  };
}

/** Validate the whole editable state. Errors are { field, code, params }. */
export function validateSettings(value = {}) {
  const source = value && typeof value === "object" ? value : {};
  const errors = [];

  validateIntegerField(errors, "concurrentFragments", source.concurrentFragments,
    FORM_LIMITS.concurrencyMin, FORM_LIMITS.concurrencyMax);
  validateIntegerField(errors, "concurrentRanges", source.concurrentRanges,
    FORM_LIMITS.concurrencyMin, FORM_LIMITS.concurrencyMax);
  validateIntegerField(errors, "concurrentJobs", source.concurrentJobs,
    FORM_LIMITS.jobsMin, FORM_LIMITS.jobsMax);
  validateIntegerField(errors, "minimumKB", source.minimumKB,
    FORM_LIMITS.minimumKBMin, FORM_LIMITS.minimumKBMax);

  const outputContainer = canonicalText(source.outputContainer, "").toLowerCase();
  if (!OUTPUT_CONTAINER_SET.has(outputContainer)) errors.push(fieldIssue("outputContainer", "invalid_choice"));

  const filename = validateFilenameTemplate(source.filenameTemplate);
  for (const error of filename.errors) errors.push({ field: "filenameTemplate", ...error });

  const domainResult = normalizeDomainLines(source.blockedDomains);
  if (domainResult.invalidLineNumbers.length) {
    errors.push(fieldIssue("blockedDomains", "invalid_lines", { lines: domainResult.invalidLineNumbers }));
  }

  const fieldErrors = {};
  for (const error of errors) (fieldErrors[error.field] ||= []).push(error);

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

/** The file name a template produces for sample values ("" when it renders empty). */
export function renderTemplatePreview(template, values = {}, extension = "mp4") {
  const rendered = String(template || "")
    .replace(/\{(title|host|kind|height|date)\}/g, (_, key) => String(values[key] ?? ""))
    .trim();
  return rendered ? `${rendered}.${extension}` : "";
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

function validateIntegerField(errors, field, value, min, max) {
  if (value === "" || value === null || value === undefined || typeof value === "boolean") {
    errors.push(fieldIssue(field, "required", { min, max }));
    return;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    errors.push(fieldIssue(field, "not_integer", { min, max }));
  } else if (number < min || number > max) {
    errors.push(fieldIssue(field, "out_of_range", { min, max }));
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

function issue(code, params = {}) {
  return { code, params };
}

function domainIssue(line, code) {
  return { line, code };
}

function fieldIssue(field, code, params = {}) {
  return { field, code, params };
}
