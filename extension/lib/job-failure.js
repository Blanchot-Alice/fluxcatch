/**
 * Download failures as codes plus parameters (design review §7).
 *
 * The local engine (native-host/host.py) and the service worker still record
 * a failed job as free text: English Python exception chains, a few Chinese
 * engine strings and the extension's own Chinese messages. This module turns
 * that text into a stable `{ code, params }` pair once, and renders a short
 * localised sentence from the pair. Raw text never reaches a rendered
 * sentence: params form a small closed set of validated primitives, so no
 * URL, path, version string or exception text can leak through them.
 *
 * Pure ES module: no DOM, no chrome.* APIs, no imports.
 */

export const FAILURE_CODES = Object.freeze([
  // Network and HTTP
  "http_forbidden",
  "http_not_found",
  "http_rate_limited",
  "http_server_error",
  "http_unexpected_status",
  "network_connect_failed",
  "network_timeout",
  "network_tls_failed",
  "network_proxy_failed",
  "dns_failed",
  "playlist_timeout",
  "transfer_incomplete",
  "range_unsupported",
  "link_expired",
  "link_expiring",
  "private_network_blocked",
  "address_blocked",
  "insecure_redirect_blocked",
  "connection_changed",
  "invalid_address",
  // Parts of a stream and stream structure
  "segment_failed",
  "transfer_aborted",
  "quality_unavailable",
  "audio_track_missing",
  "stream_live",
  "stream_discontinuous",
  "stream_nested_audio",
  "stream_empty",
  "stream_invalid",
  "stream_too_large",
  "stream_unsupported",
  "media_info_incomplete",
  "selection_changed",
  "media_stale",
  // Local engine
  "engine_busy",
  "engine_rejected",
  "engine_disconnected",
  "engine_missing",
  "engine_permission_off",
  "engine_restarted",
  "component_missing",
  "mp3_encoder_missing",
  "external_tool_disabled",
  "youtube_tool_missing",
  "external_tool_failed",
  "internal_error",
  // Disk and folders
  "disk_full",
  "folder_unavailable",
  "folder_not_writable",
  "output_name_unavailable",
  "disk_write_failed",
  // Joining and converting
  "processing_failed",
  "processing_timeout",
  "processing_output_too_large",
  // Protected content
  "drm_protected",
  "key_fetch_failed",
  // A web page instead of the media
  "html_instead_of_media",
  // Statuses without a reason line
  "cancelled",
  "paused",
  // Chrome's own download lane
  "blocked_by_system",
  "browser_closed",
  "browser_interrupted",
  "browser_record_missing",
  // Answers the background worker gives to Havre pages
  "engine_not_set_up",
  "engine_unreachable",
  "engine_not_responding",
  "engine_finishing_setup",
  "engine_restart_needed",
  "engine_update_needed",
  "pause_unsupported",
  "invalid_request",
  "site_not_supported",
  "site_ignored",
  "ignored_by_settings",
  "download_not_allowed",
  "url_scheme_invalid",
  "not_media",
  "url_unreadable",
  "record_missing",
  "file_not_ready",
  "file_missing",
  "file_outside_folder",
  "trash_failed",
  "file_action_failed",
  "folder_change_failed",
  "not_retryable",
  "cannot_resume",
  "source_expired",
  "source_missing",
  "job_ended",
  "cannot_pause",
  "not_paused",
  // Anything else
  "unknown"
]);

const CODE_SET = new Set(FAILURE_CODES);

const STAGES = new Set([
  "file", "file_part", "playlist", "segment", "header", "dash_part", "key",
  "video_track", "audio_track", "merge", "extract_audio", "convert", "package", "plan"
]);
const PROCESSING_STAGES = new Set(["merge", "extract_audio", "convert", "package"]);
const TRACKS = new Set(["media", "video", "audio"]);
const FEATURES = new Set(["merge", "convert", "extract_audio", "decrypt"]);

// Stage precedence when wrappers stack (inventory §3): a track wins over a
// part of a stream, which wins over a byte range, which wins over the file or
// the playlist. Processing wrappers name the phase outright.
const STAGE_RANK = Object.freeze({
  merge: 5, extract_audio: 5, convert: 5, package: 5,
  video_track: 4, audio_track: 4,
  segment: 3, header: 3, dash_part: 3, key: 3,
  file_part: 2,
  playlist: 1, file: 1,
  plan: 0
});

// FFMPEG_MAX_WALL_SECONDS in host.py is 6 hours.
const PROCESSING_TIME_LIMIT_HOURS = 6;

const DOWNLOAD_CONTEXT = ["stage", "track", "segment", "retries"];
const PARAM_KEYS = Object.freeze({
  http_forbidden: ["status", "host", ...DOWNLOAD_CONTEXT],
  http_not_found: ["status", "host", ...DOWNLOAD_CONTEXT],
  http_rate_limited: ["status", "host", ...DOWNLOAD_CONTEXT],
  http_server_error: ["status", "host", ...DOWNLOAD_CONTEXT],
  http_unexpected_status: ["status", "host", ...DOWNLOAD_CONTEXT],
  network_connect_failed: ["host", ...DOWNLOAD_CONTEXT],
  network_timeout: ["host", ...DOWNLOAD_CONTEXT],
  network_tls_failed: ["host"],
  network_proxy_failed: ["host", "status"],
  dns_failed: ["host"],
  playlist_timeout: ["host", "seconds"],
  transfer_incomplete: DOWNLOAD_CONTEXT,
  range_unsupported: DOWNLOAD_CONTEXT,
  private_network_blocked: ["host"],
  address_blocked: ["host"],
  connection_changed: ["host"],
  segment_failed: DOWNLOAD_CONTEXT,
  stream_live: ["track"],
  stream_discontinuous: ["track"],
  stream_nested_audio: ["track"],
  stream_empty: ["track"],
  drm_protected: ["track"],
  component_missing: ["feature"],
  external_tool_failed: ["exit_code"],
  processing_failed: ["stage", "exit_code"],
  processing_timeout: ["hours"],
  key_fetch_failed: ["retries"],
  html_instead_of_media: ["stage", "track", "segment"]
});

// Codes a reason after "Network request failed for <origin>:" may take. Any
// other match there (e.g. an errno that also names a disk problem) is a
// connection failure, because the wrapper says the request itself failed.
const NETWORK_CODES = new Set([
  "http_forbidden", "http_not_found", "http_rate_limited", "http_server_error", "http_unexpected_status",
  "network_connect_failed", "network_timeout", "network_tls_failed", "network_proxy_failed", "dns_failed",
  "playlist_timeout", "private_network_blocked", "address_blocked", "insecure_redirect_blocked",
  "connection_changed", "invalid_address"
]);

// chrome.downloads.InterruptReason values: all 29 enum members listed at
// developer.chrome.com/docs/extensions/reference/api/downloads (checked
// 2026-10-21). An unlisted future value still falls back to
// browser_interrupted through BROWSER_REASON_SHAPE.
const BROWSER_REASONS = Object.freeze({
  FILE_FAILED: "disk_write_failed",
  FILE_ACCESS_DENIED: "folder_not_writable",
  FILE_NO_SPACE: "disk_full",
  FILE_NAME_TOO_LONG: "disk_write_failed",
  FILE_TOO_LARGE: "disk_write_failed",
  FILE_VIRUS_INFECTED: "blocked_by_system",
  FILE_TRANSIENT_ERROR: "disk_write_failed",
  FILE_BLOCKED: "blocked_by_system",
  FILE_SECURITY_CHECK_FAILED: "blocked_by_system",
  FILE_TOO_SHORT: "transfer_incomplete",
  FILE_HASH_MISMATCH: "transfer_incomplete",
  FILE_SAME_AS_SOURCE: "disk_write_failed",
  NETWORK_FAILED: "network_connect_failed",
  NETWORK_TIMEOUT: "network_timeout",
  NETWORK_DISCONNECTED: "network_connect_failed",
  NETWORK_SERVER_DOWN: "network_connect_failed",
  NETWORK_INVALID_REQUEST: "invalid_address",
  SERVER_FAILED: "http_server_error",
  SERVER_NO_RANGE: "range_unsupported",
  SERVER_BAD_CONTENT: "http_not_found",
  SERVER_UNAUTHORIZED: "http_forbidden",
  SERVER_CERT_PROBLEM: "network_tls_failed",
  SERVER_FORBIDDEN: "http_forbidden",
  SERVER_UNREACHABLE: "network_connect_failed",
  SERVER_CONTENT_LENGTH_MISMATCH: "transfer_incomplete",
  SERVER_CROSS_ORIGIN_REDIRECT: "http_unexpected_status",
  USER_CANCELED: "cancelled",
  USER_SHUTDOWN: "browser_closed",
  CRASH: "browser_closed"
});
const BROWSER_REASON_STATUS = Object.freeze({ SERVER_UNAUTHORIZED: 401, SERVER_FORBIDDEN: 403 });
const BROWSER_REASON_SHAPE = /^(?:(?:FILE|NETWORK|SERVER|USER)_[A-Z_]+|CRASH)$/;

const NATIVE_CODES = Object.freeze({ host_busy: "engine_busy" });

// ---------------------------------------------------------------------------
// Parameter hygiene

function integerIn(value, min, max) {
  const number = typeof value === "string" && /^-?\d{1,9}$/.test(value.trim()) ? Number(value) : value;
  return Number.isInteger(number) && number >= min && number <= max ? number : undefined;
}

const HOSTNAME = /^[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?(?:\.[a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?)*$/;
const IPV6_LITERAL = /^\[[0-9a-f:.]{2,45}\]$/;

function cleanHost(value) {
  if (typeof value !== "string") return undefined;
  let host = value.trim().toLowerCase();
  if (host.startsWith("[")) {
    host = host.replace(/^(\[[^\]]*\])(?::\d+)?.*$/, "$1");
    return IPV6_LITERAL.test(host) ? host : undefined;
  }
  host = host.replace(/[.,;)'"。，；]+$/u, "");
  // Python's urlsplit().hostname drops the brackets of an IPv6 literal.
  if (/^[0-9a-f.]*:[0-9a-f.]*:[0-9a-f:.]*$/.test(host)) {
    const literal = `[${host}]`;
    return IPV6_LITERAL.test(literal) ? literal : undefined;
  }
  host = host.replace(/:(?:\d+)?$/, "").replace(/\.$/, "");
  if (!host || host.length > 253 || host === "unknown") return undefined;
  return HOSTNAME.test(host) ? host : undefined;
}

function hostFromUrl(value) {
  const match = /^https?:\/\/(\[[0-9a-f:.]+\]|[^/\s:?#]+)/i.exec(String(value || ""));
  return match ? cleanHost(match[1]) : undefined;
}

const PARAM_CLEANERS = Object.freeze({
  status: (value) => integerIn(value, 100, 599),
  host: cleanHost,
  stage: (value) => (STAGES.has(value) ? value : undefined),
  track: (value) => (TRACKS.has(value) ? value : undefined),
  segment: (value) => integerIn(value, 1, 10_000_000),
  retries: (value) => integerIn(value, 1, 100),
  seconds: (value) => integerIn(value, 1, 86_400),
  hours: (value) => integerIn(value, 1, 48),
  exit_code: (value) => integerIn(value, -255, 255),
  feature: (value) => (FEATURES.has(value) ? value : undefined)
});

function cleanParams(code, params) {
  const keys = PARAM_KEYS[code] || [];
  const source = params && typeof params === "object" ? params : {};
  const result = {};
  for (const key of keys) {
    const value = PARAM_CLEANERS[key](source[key]);
    if (value !== undefined) result[key] = value;
  }
  return result;
}

function failure(code, params = {}) {
  const known = CODE_SET.has(code) ? code : "unknown";
  return { code: known, params: cleanParams(known, params) };
}

// ---------------------------------------------------------------------------
// Classification

function normalise(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

// The extension's redaction placeholder for a local path.
const LOCAL_PATH = "<本地路径已隐藏>";

// Python quotes the file name of an OSError ("[Errno 28] No space left on
// device: '/Volumes/T7/Havre/havre-hls-1f/media/00000003.ts.tmp'").
// background.js now hides every absolute local path before storing a record,
// but records stored by older builds kept folders on other drives, and their
// names ("havre-hls-…", "Period Dramas") would otherwise trip the stream
// rules. A quoted absolute path never says what failed; replace it (closed or
// cut off by the 240-character limit) with the redaction placeholder.
function maskQuotedPaths(text) {
  return text.replace(/(['"])~?\/(?:(?!\1).)*(?:\1|$)/g, LOCAL_PATH);
}

function httpCodeFor(status) {
  if ([401, 403, 412, 451].includes(status)) return "http_forbidden";
  if (status === 404 || status === 410) return "http_not_found";
  if (status === 429) return "http_rate_limited";
  if (status >= 500 && status <= 599) return "http_server_error";
  return "http_unexpected_status";
}

function featureFor(prefix) {
  const text = String(prefix || "");
  if (/AES-128/i.test(text)) return "decrypt";
  if (/audio extraction/i.test(text)) return "extract_audio";
  if (/conversion/i.test(text)) return "convert";
  if (/separate-audio|DASH/i.test(text)) return "merge";
  return undefined;
}

function audioScope(text) {
  return /(?:^|\s)audio HLS\b/i.test(text) ? "audio" : undefined;
}

// Wrappers say where a failure happened; the innermost text says what failed.
// Each entry may set a stage, a track, a part number, the retry count of its
// engine loop (attempts - 1) and the code to use when the cause underneath
// is not recognised. Later (inner) wrappers override earlier fallbacks.
const WRAPPERS = [
  {
    // host.py _dash_demuxer_error. The tail names the FFmpeg path and
    // version; the extension's redaction cuts it at the path anyway.
    pattern: /^The pinned built-in static DASH planner could not handle this MPD: (.*?)(?:\. Direct network access by .*)?$/i,
    apply: (match, context) => {
      context.stages.push("plan");
      context.fallback = "stream_unsupported";
      return match[1];
    }
  },
  {
    pattern: /^(video|audio|unknown) track is unsupported: /i,
    apply: (match, context) => {
      const track = match[1].toLowerCase();
      if (track !== "unknown") context.track ??= track;
      context.fallback = "stream_unsupported";
    }
  },
  {
    pattern: /^DASH (video|audio) track download failed: /i,
    apply: (match, context) => {
      const track = match[1].toLowerCase();
      context.stages.push(`${track}_track`);
      context.track ??= track;
      context.fallback = "segment_failed";
    }
  },
  {
    pattern: /^DASH audio\/video merge failed: /i,
    apply: (_match, context) => {
      context.stages.push("merge");
      context.fallback = "processing_failed";
    }
  },
  {
    pattern: /^DASH audio extraction failed: /i,
    apply: (_match, context) => {
      context.stages.push("extract_audio");
      context.fallback = "processing_failed";
    }
  },
  {
    // fetch_file: range(6) attempts; index is 0-based, -1 is the init part.
    pattern: /^HLS (media|video|audio) segment (-?\d+) failed: /i,
    apply: (match, context) => {
      const index = Number(match[2]);
      context.stages.push(index < 0 ? "header" : "segment");
      if (index >= 0) context.segment = index + 1;
      context.track ??= match[1].toLowerCase();
      context.retries = 5;
      context.fallback = "segment_failed";
    }
  },
  {
    // fetch_hls_key: range(5) attempts.
    pattern: /^HLS key fetch failed: /i,
    apply: (_match, context) => {
      context.stages.push("key");
      context.retries = 4;
      context.fallback = "key_fetch_failed";
    }
  },
  {
    // _fetch_dash_resource: range(4) attempts.
    pattern: /^DASH resource failed: /i,
    apply: (_match, context) => {
      context.stages.push("dash_part");
      context.retries = 3;
      context.fallback = "segment_failed";
    }
  },
  {
    // multipart fetch_chunk: range(4) attempts. The byte range is noise.
    pattern: /^Range \d+-\d+ failed: /i,
    apply: (_match, context) => {
      context.stages.push("file_part");
      context.retries = 3;
      context.fallback = "segment_failed";
    }
  },
  {
    // single_download: range(4) attempts.
    pattern: /^Download failed after retries: /i,
    apply: (_match, context) => {
      context.stages.push("file");
      context.retries = 3;
      context.fallback = "segment_failed";
    }
  },
  {
    // fetch_manifest: range(6) attempts.
    pattern: /^Manifest download failed after retries: /i,
    apply: (_match, context) => {
      context.stages.push("playlist");
      context.retries = 5;
      context.fallback = "segment_failed";
    }
  },
  {
    // request(): the reason is urllib's or the OS's own text. The extension's
    // URL redaction swallows the colon after "<origin>/…", so it is optional.
    pattern: /^Network request failed for (\[redacted URL\]|\S+?):?\s/i,
    apply: (match, context) => {
      context.host ??= hostFromUrl(match[1]);
      context.network = true;
      context.fallback = "network_connect_failed";
    }
  },
  {
    pattern: /^Could not publish output safely: /i,
    apply: (_match, context) => {
      context.fallback = "disk_write_failed";
    }
  }
];

function rule(pattern, code, params) {
  return { pattern, code, params };
}

// Ordered rules for the innermost cause. Order matters: exact engine and
// extension strings first, then processing, policy, HTTP, network, transfer,
// structure, engine and disk texts, and the broad stream vocabulary last.
const CAUSE_RULES = [
  // Extension-side statuses kept in old records.
  rule(/任务已取消|已取消选择/, "cancelled"),
  rule(/已暂停，可随时继续/, "paused"),
  rule(/浏览器下载记录已不存在/, "browser_record_missing"),
  rule(/浏览器下载中断/, "browser_interrupted"),

  // The worker's own answers to Havre pages (background.js). The worker
  // also sends the code itself; these rules keep the Chinese text it still
  // puts in `error` (and older records) classifiable.
  rule(/需要授权连接本地引擎|尚未授权连接本地引擎|需要本地下载引擎权限|本地下载引擎未连接，请先在设置里开启|请先设置本地引擎/, "engine_not_set_up"),
  rule(/^本地下载引擎未连接$/, "engine_unreachable"),
  rule(/正在初始化连接接口|正在自动重新加载以完成连接/, "engine_finishing_setup"),
  rule(/连接接口长期未恢复/, "engine_restart_needed"),
  rule(/与本地引擎版本不匹配/, "engine_update_needed"),
  rule(/本地引擎响应超时/, "engine_not_responding"),
  rule(/本地下载引擎不支持暂停/, "pause_unsupported"),
  rule(/消息格式无效|消息来源未通过校验|任务编号无效|标签页编号无效|不支持的文件操作|^Unknown message type\b/, "invalid_request"),
  rule(/商店版本不支持从此平台下载|此版本不支持从此平台下载/, "site_not_supported"),
  rule(/该域名已在 Havre 设置中被忽略/, "site_ignored"),
  rule(/该地址被当前设置忽略/, "ignored_by_settings"),
  rule(/网络策略已阻止\s*(\S*?)（blocked_(?:private|local_name)）/, "private_network_blocked", (match) => ({ host: hostFromUrl(match[1]) })),
  rule(/网络策略已阻止\s*(\S*?)（blocked_[a-z_]+）/, "address_blocked", (match) => ({ host: hostFromUrl(match[1]) })),
  rule(/网络策略已阻止.*（(?:invalid_url|invalid_scheme|embedded_credentials)）/, "invalid_address"),
  rule(/网络策略已阻止.*（invalid_[a-z_]+）/, "internal_error"),
  rule(/网络策略已阻止/, "download_not_allowed"),
  rule(/请输入 http 或 https/, "url_scheme_invalid"),
  rule(/不是可下载的媒体/, "not_media"),
  rule(/无法读取这个地址的类型/, "url_unreadable"),
  rule(/清单地址无效|媒体地址无效/, "invalid_address"),
  rule(/媒体清单超出大小限制/, "stream_too_large"),
  rule(/读取媒体清单超时\s*[(（]\s*(\d+)\s*秒/, "playlist_timeout", (match) => ({ seconds: Number(match[1]) })),
  rule(/本地引擎读取播放列表超时/, "playlist_timeout"),
  rule(/本地引擎读取播放列表失败|播放列表地址发生了跳转/, "stream_invalid"),
  // Worker-preloaded playlists (The Economist): a malformed preload is the
  // worker's own fault, never something the user can act on.
  rule(/^(?:Too many preloaded playlists|Preloaded playlist is not on the media origin)/i, "internal_error"),
  rule(/HLS 直播录制/, "stream_live"),
  rule(/包含时间线切换/, "stream_discontinuous"),
  rule(/暂停外部引擎联网/, "external_tool_disabled"),
  rule(/找不到这条下载记录/, "record_missing"),
  rule(/只有已完成的下载才能打开文件/, "file_not_ready"),
  rule(/文件已不在下载文件夹中|这条记录没有保存文件位置/, "file_missing"),
  rule(/不在 Havre 的下载文件夹里/, "file_outside_folder"),
  rule(/无法移到废纸篓/, "trash_failed"),
  rule(/操作失败，请在 Finder 中手动打开|本地引擎未能完成文件操作/, "file_action_failed"),
  rule(/无法更改保存位置/, "folder_change_failed"),
  rule(/这条任务无法重试/, "not_retryable"),
  rule(/这条任务无法继续/, "cannot_resume"),
  rule(/来源页面的媒体信息已失效/, "source_expired"),
  rule(/这条记录没有来源页面/, "source_missing"),
  rule(/任务不存在或已结束/, "job_ended"),
  rule(/这条任务现在不能暂停/, "cannot_pause"),
  rule(/这条任务不在暂停状态/, "not_paused"),

  // YouTube through yt-dlp (host.py youtube_download / youtube_inspect and
  // the worker's own gate). Specific causes first, the generic exit last.
  rule(/本地引擎未找到 yt-dlp|yt-dlp is not installed/i, "youtube_tool_missing"),
  rule(/本地引擎读取 YouTube 清晰度超时|yt-dlp did not answer within/i, "engine_not_responding"),
  rule(/暂不支持录制 YouTube 直播/, "stream_live"),
  rule(/^yt-dlp failed \(-?\d+\):.*\[network policy:/i, "download_not_allowed"),
  rule(/^yt-dlp failed \(-?\d+\):.*(?:Private video|Sign in to confirm|members-only|channel's members|confirm your age|age-restricted|requires login|not available in your country|HTTP Error 403)/i, "http_forbidden"),
  rule(/^yt-dlp failed \(-?\d+\):.*Requested format is not available/i, "quality_unavailable"),
  rule(/^yt-dlp failed \(-?\d+\):.*(?:Video unavailable|has been removed|does not exist|is not available|no longer available|HTTP Error 404)/i, "http_not_found"),
  rule(/^yt-dlp failed \(-?\d+\):.*(?:is live|live event|livestream|premieres? in|premiere will begin)/i, "stream_live"),
  rule(/^yt-dlp failed \(-?\d+\):.*(?:No space left on device|Disc quota exceeded)/i, "disk_full"),
  rule(/^yt-dlp failed \((-?\d+)\)/i, "external_tool_failed", (match) => ({ exit_code: Number(match[1]) })),
  rule(/^yt-dlp exceeded the processing time limit/i, "processing_timeout", () => ({ hours: PROCESSING_TIME_LIMIT_HOURS })),
  rule(/^yt-dlp (?:produced no output|returned (?:no|unreadable) media information|media information exceeded)/i, "external_tool_failed"),

  // Engine tools and processing.
  rule(/直接联网已由安全策略关闭/, "external_tool_disabled"),
  rule(/requires libmp3lame/i, "mp3_encoder_missing"),
  rule(/^(.*?)\brequires FFmpeg\b/i, "component_missing", (match) => ({ feature: featureFor(match[1]) })),
  rule(/^Internal FFmpeg|^FFmpeg input must be an existing local regular file/i, "internal_error"),
  rule(/^FFmpeg exceeded the processing time limit/i, "processing_timeout", () => ({ hours: PROCESSING_TIME_LIMIT_HOURS })),
  rule(/^FFmpeg output exceeded the configured size limit/i, "processing_output_too_large"),
  rule(/^FFmpeg failed \(-?\d+\):.*(?:No space left on device|Disc quota exceeded)/i, "disk_full"),
  rule(/^FFmpeg failed \((-?\d+)\)/i, "processing_failed", (match) => ({ exit_code: Number(match[1]) })),
  rule(/^FFmpeg produced no output/i, "processing_failed"),
  rule(/^Manifest download failed without a result/i, "internal_error"),

  // Signed links and pages answered in place of media.
  rule(/签名链接即将过期/, "link_expiring"),
  rule(/签名链接已过期|视频清晰度地址已过期/, "link_expired"),
  rule(/服务器返回了网页/, "html_instead_of_media"),

  // Network policy (havre_network_policy.py and the pinned client).
  rule(/Network target (\S+) is private\b/i, "private_network_blocked", (match) => ({ host: match[1] })),
  rule(/Network target (\S+) (?:resolves to|is) a metadata service/i, "address_blocked", (match) => ({ host: match[1] })),
  rule(/Network target (\S+) resolves to a forbidden address/i, "address_blocked", (match) => ({ host: match[1] })),
  rule(/Network target (\S+) changed address during connection/i, "connection_changed", (match) => ({ host: match[1] })),
  rule(/Network target (\S+) resolved to (?:an invalid address|no addresses)/i, "dns_failed", (match) => ({ host: match[1] })),
  rule(/Could not resolve network target (\S+)/i, "dns_failed", (match) => ({ host: match[1] })),
  rule(/Resolver returned an invalid address for (\S+)/i, "dns_failed", (match) => ({ host: match[1] })),
  rule(/Could not verify the connected peer for (\S+)/i, "connection_changed", (match) => ({ host: match[1] })),
  rule(/target did not match the authorized|No authorized network target is active/i, "connection_changed"),
  rule(/Could not connect to authorized network target (\S+)/i, "network_connect_failed", (match) => ({ host: match[1] })),
  rule(/HTTPS redirects may not downgrade/i, "insecure_redirect_blocked"),
  rule(/URL contains control characters|Only credential-free HTTP\(S\) URLs|URL is too long|Malformed network URL|IPv6 zone identifiers/i, "invalid_address"),
  rule(/Manifest exceeds the child resource limit|Manifest child URLs exceed/i, "stream_too_large"),

  // HTTP status, in host.py's own form and urllib's "HTTP Error 403: Forbidden".
  rule(/\bHTTP (?:Error )?(\d{3})\b/, (match) => httpCodeFor(Number(match[1])), (match, text) => ({
    status: Number(match[1]),
    host: hostFromUrl((/\bfor (https?:\/\/\S+)/i.exec(text) || [])[1])
  })),
  rule(/unexpected media response status (\d{3})/i, "http_unexpected_status", (match) => ({ status: Number(match[1]) })),
  rule(/Unexpected (?:DASH|HLS) segment response status/i, "http_unexpected_status"),

  // Playlist deadline (host.py MANIFEST_FETCH_TIMEOUT_SECONDS).
  rule(/获取播放列表超时\s*[(（]\s*(\d+)\s*s\s*[)）]\s*[:：]?\s*(\S*)/, "playlist_timeout", (match) => ({
    seconds: Number(match[1]),
    host: match[2]
  })),

  // Connection-level reasons from urllib, ssl and the OS.
  rule(/Tunnel connection failed:?\s*(\d{3})?/i, "network_proxy_failed", (match) => ({ status: match[1] ? Number(match[1]) : undefined })),
  rule(/timed out|\btimeout\b/i, "network_timeout"),
  rule(/\[SSL\b|\bSSL:|certificate verify failed|CERTIFICATE_VERIFY_FAILED|SSLError|SSL error|TLSV1_ALERT|WRONG_VERSION_NUMBER|EOF occurred in violation|_ssl\.c/i, "network_tls_failed"),
  rule(/nodename nor servname|Name or service not known|Temporary failure in name resolution|getaddrinfo failed|No address associated with hostname|\[Errno 8\]/i, "dns_failed"),
  rule(/Connection refused|Network is unreachable|No route to host|Connection reset|Remote end closed connection|Broken pipe|Network is down|Host is down|Connection aborted|RemoteDisconnected|BadStatusLine|urlopen error|\[Errno (?:32|50|51|54|57|61|64|65)\]/i, "network_connect_failed"),

  // Local file writes whose words overlap the transfer rules below.
  rule(/Temporary output is not a regular file|Temporary file write ended early/i, "disk_write_failed"),

  // Transfers that stopped or changed shape partway.
  rule(/ended early|Content-Length mismatch|length mismatch|ended before Content-Length|IncompleteRead/i, "transfer_incomplete"),
  rule(/stopped honoring range requests|returned a mismatched byte range/i, "range_unsupported"),
  rule(/download aborted|aborted after another transfer failed/i, "transfer_aborted"),

  // Choices made on the page that no longer hold.
  rule(/variant is no longer present|Representation is no longer present|所选(?: ?DASH ?)?清晰度(?:已失效|无效)/i, "quality_unavailable"),
  rule(/missing external audio group|has no audio Representation|未找到可配对的音轨/i, "audio_track_missing"),
  rule(/所选清晰度已更新|视频清晰度地址已更新/, "selection_changed"),
  rule(/该媒体候选项已失效|该媒体候选项已更新/, "media_stale"),
  rule(/DASH pair (?:expiresAt is invalid|is missing an audio URL|video and audio URLs must be different|output must use the MP4 container|audio extraction must use an MP3 output)/i, "media_info_incomplete"),

  // Protected and encrypted content.
  rule(/HLS key response has \d+ bytes/i, "key_fetch_failed"),
  rule(/\bDRM\b|SAMPLE-AES|Protected DASH|metadata-only|内容保护/i, "drm_protected", (_match, text) => ({ track: audioScope(text) })),

  // Stream structure.
  rule(/^Live (.*?) recording is not supported/i, "stream_live", (match) => ({ track: audioScope(match[1]) })),
  // A non-static (type="dynamic") MPD is a live DASH stream.
  rule(/supports static MPDs only/i, "stream_live"),
  rule(/^Discontinuous (.*?) is not supported/i, "stream_discontinuous", (match) => ({ track: audioScope(match[1]) })),
  rule(/Nested separate-audio/i, "stream_nested_audio", (_match, text) => ({ track: audioScope(text) })),
  rule(/^(.*?)playlist has no downloadable static VOD segments/i, "stream_empty", (match) => ({ track: audioScope(match[1]) })),
  rule(/\bexceeds? the [\w -]*limit\b|exceed the configured limit/i, "stream_too_large"),
  rule(/Invalid HLS|Invalid DASH|invalid literal for int\(\)|could not convert string to float/i, "stream_invalid"),

  // Local engine and its connection to Chrome.
  rule(/本地引擎任务队列已满|Native job queue is full/i, "engine_busy"),
  rule(/本地引擎未接收任务|cannot schedule new futures|disconnected port object/i, "engine_rejected"),
  rule(/本地下载引擎尚未安装|native messaging host.*not found/i, "engine_missing"),
  rule(/暂时未能连接本地引擎|Native host has exited|communicating with the native messaging host/i, "engine_disconnected"),
  rule(/本地下载引擎权限已关闭/, "engine_permission_off"),
  rule(/浏览器后台已重启|请重新开始该下载任务/, "engine_restarted"),

  // Disk and folders (raw OSError text; Darwin errno numbers).
  rule(/No space left on device|Disc quota exceeded|\[Errno (?:28|69)\]/i, "disk_full"),
  rule(/Read-only file system|Permission denied|Operation not permitted|\[Errno (?:1|13|30)\]/i, "folder_not_writable"),
  rule(/No such file or directory|\[Errno 2\]/i, "folder_unavailable"),
  rule(/Could not allocate an output filename|Output filename became occupied/i, "output_name_unavailable"),
  rule(/File name too long|Is a directory|Not a directory|Cross-device link|Input\/output error|File too large|Too many levels of symbolic links|\[Errno (?:5|18|20|21|27|62|63)\]/i, "disk_write_failed"),
  // Any other errno about a local path (redacted or masked).
  rule(new RegExp(`\\[Errno \\d+\\].*${LOCAL_PATH}`), "disk_write_failed"),

  // Stream vocabulary is the broadest rule, so it runs last: a disk or
  // engine text must never read as a streaming-format problem.
  rule(/\b(?:DASH|HLS|MPDs?|ISO-8601|Segment\w*|Representation\w*|xlink|Period|template token)\b/i, "stream_unsupported")
];

function classifyCause(text) {
  if (!text) return null;
  for (const entry of CAUSE_RULES) {
    const match = entry.pattern.exec(text);
    if (!match) continue;
    const code = typeof entry.code === "function" ? entry.code(match, text) : entry.code;
    return { code, params: entry.params ? entry.params(match, text) || {} : {} };
  }
  return null;
}

function peelWrappers(text) {
  const context = { stages: [], track: undefined, segment: undefined, retries: undefined, host: undefined, network: false, fallback: undefined };
  let rest = text;
  for (let depth = 0; depth < 12 && rest; depth += 1) {
    let peeled = false;
    for (const wrapper of WRAPPERS) {
      const match = wrapper.pattern.exec(rest);
      if (!match) continue;
      const replacement = wrapper.apply(match, context);
      rest = (typeof replacement === "string" ? replacement : rest.slice(match[0].length)).trim();
      peeled = true;
      break;
    }
    if (!peeled) break;
  }
  return { context, rest };
}

function bestStage(stages) {
  let best;
  for (const stage of stages) {
    if (best === undefined || STAGE_RANK[stage] > STAGE_RANK[best]) best = stage;
  }
  return best;
}

function processingStageFromActivity(activity) {
  const text = normalise(activity);
  if (!text) return undefined;
  if (/合并.*音视频|音视频.*合并/.test(text)) return "merge";
  if (/提取音频/.test(text)) return "extract_audio";
  if (/转换格式/.test(text)) return "convert";
  if (/无损封装/.test(text)) return "package";
  return undefined;
}

function browserFailure(reason) {
  const key = normalise(reason).toUpperCase();
  if (!key) return null;
  const code = BROWSER_REASONS[key];
  if (code) return failure(code, { status: BROWSER_REASON_STATUS[key] });
  return BROWSER_REASON_SHAPE.test(key) ? failure("browser_interrupted") : null;
}

/**
 * Classify a failed, cancelled or paused job.
 *
 * @param {object} input
 * @param {string} [input.text] record.message or record.error (raw engine or extension text)
 * @param {string} [input.status] the job status; "cancelled" and "paused" short-circuit
 * @param {string} [input.nativeCode] a machine code sent by the engine (today only "host_busy")
 * @param {string} [input.browserReason] Chrome's InterruptReason for the browser lane
 * @param {string} [input.activity] optional last progress text, used only to name a processing phase
 * @returns {{ code: string, params: object }}
 */
export function classifyJobFailure(input) {
  const { text = "", status = "failed", nativeCode = "", browserReason = "", activity = "" } = input && typeof input === "object" ? input : {};
  if (status === "cancelled") return failure("cancelled");
  if (status === "paused") return failure("paused");

  const native = normalise(nativeCode).toLowerCase();
  if (NATIVE_CODES[native]) return failure(NATIVE_CODES[native]);
  if (native && native !== "unknown" && CODE_SET.has(native)) return failure(native);

  if (normalise(browserReason)) {
    const fromBrowser = browserFailure(browserReason);
    return fromBrowser || failure("browser_interrupted");
  }

  const raw = normalise(text);
  if (!raw) return failure("unknown");

  // Chrome lane records keep the InterruptReason itself as their text.
  const fromBrowserText = browserFailure(raw);
  if (fromBrowserText) return fromBrowserText;

  const { context, rest } = peelWrappers(maskQuotedPaths(raw));
  let cause = classifyCause(rest);
  if (context.network && cause && !NETWORK_CODES.has(cause.code)) cause = null;
  const code = cause?.code || context.fallback || "unknown";
  const causeParams = cause?.params || {};

  let stage = bestStage(context.stages);
  if (code.startsWith("processing_")) {
    if (!PROCESSING_STAGES.has(stage)) stage = processingStageFromActivity(activity);
  }

  return failure(code, {
    ...causeParams,
    host: cleanHost(causeParams.host) || context.host,
    stage,
    track: context.track || causeParams.track,
    segment: context.segment,
    retries: context.retries
  });
}

// ---------------------------------------------------------------------------
// Rendering

function languageOf(lang) {
  return String(lang || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

const EN_PLURAL = new Intl.PluralRules("en");

function countEn(count, one, other) {
  return `${count} ${EN_PLURAL.select(count) === "one" ? one : other}`;
}

function capitalise(text) {
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : text;
}

function stageEn(params) {
  const sound = params.track === "audio";
  switch (params.stage) {
    case "file": return "the file";
    case "file_part": return "part of the file";
    case "playlist": return "the video's details";
    case "segment":
      if (params.segment) return sound ? `part ${params.segment} of the sound` : `part ${params.segment} of the video`;
      return sound ? "a part of the sound" : "a part of the video";
    case "header": return sound ? "the start of the sound" : "the start of the video";
    case "dash_part": return sound ? "a part of the sound" : "a part of the video";
    case "key": return "the video's unlock key";
    case "video_track": return "the picture";
    case "audio_track": return "the sound";
    case "merge": return "the joined video";
    case "extract_audio": return "the audio";
    case "convert": return "the converted file";
    case "package": return "the finished file";
    case "plan": return "the video";
    default: return "the file";
  }
}

function stageZh(params) {
  const sound = params.track === "audio";
  switch (params.stage) {
    case "file": return "文件";
    case "file_part": return "文件的一部分";
    case "playlist": return "视频信息";
    case "segment":
      if (params.segment) return sound ? `声音第 ${params.segment} 段` : `视频第 ${params.segment} 段`;
      return sound ? "声音的一段" : "视频的一段";
    case "header": return sound ? "声音开头部分" : "视频开头部分";
    case "dash_part": return sound ? "声音的一段" : "视频的一段";
    case "key": return "视频的解锁密钥";
    case "video_track": return "画面";
    case "audio_track": return "声音";
    case "merge": return "合并后的视频";
    case "extract_audio": return "音频";
    case "convert": return "转换后的文件";
    case "package": return "最终文件";
    case "plan": return "视频";
    default: return "文件";
  }
}

const statusEn = (params) => (params.status ? ` (HTTP ${params.status})` : "");
const statusZh = (params) => (params.status ? `（HTTP ${params.status}）` : "");
const afterRetriesEn = (params) => (params.retries ? ` after ${countEn(params.retries, "retry", "retries")}` : "");
const evenAfterRetriesEn = (params) => (params.retries ? `, even after ${countEn(params.retries, "retry", "retries")}` : "");
const retriesZh = (params) => (params.retries ? `，已重试 ${params.retries} 次` : "");

const REFRESH_EN = "Refresh the page, play the video once, then retry.";
const REFRESH_ZH = "请刷新页面并播放一下视频，再重试。";
const ENGINE_SETTINGS_EN = "Settings → Local engine";
const ENGINE_SETTINGS_ZH = "“设置 → 本地引擎”";

const COMPONENT_EN = Object.freeze({
  merge: "Joining the picture and sound",
  extract_audio: "Extracting the audio",
  convert: "Converting the file",
  decrypt: "Unlocking this video"
});
const COMPONENT_ZH = Object.freeze({
  merge: "合并画面和声音",
  extract_audio: "提取音频",
  convert: "转换格式",
  decrypt: "解锁这个视频"
});

const PROCESSING_EN = Object.freeze({
  merge: "Joining the picture and sound failed.",
  extract_audio: "Extracting the audio failed.",
  convert: "Converting the file to the chosen format failed.",
  package: "Finishing the video file failed."
});
const PROCESSING_ZH = Object.freeze({
  merge: "画面和声音合并失败。",
  extract_audio: "提取音频失败。",
  convert: "转换成所选格式时失败。",
  package: "生成最终视频文件时失败。"
});

const CATALOG = Object.freeze({
  http_forbidden: {
    en: (p) => `The site refused to send ${stageEn(p)}${statusEn(p)}${afterRetriesEn(p)}. ${REFRESH_EN}`,
    zh: (p) => `网站拒绝提供${stageZh(p)}${statusZh(p)}${retriesZh(p)}。${REFRESH_ZH}`
  },
  http_not_found: {
    en: (p) => `The site no longer has ${stageEn(p)}${statusEn(p)}. Refresh the page, then retry.`,
    zh: (p) => `网站上已经找不到${stageZh(p)}${statusZh(p)}。请刷新页面后重试。`
  },
  http_rate_limited: {
    en: (p) => `The site is limiting downloads right now${statusEn(p)}. Wait a few minutes, then retry.`,
    zh: (p) => `网站暂时限制了下载次数${statusZh(p)}。请等几分钟再重试。`
  },
  http_server_error: {
    en: (p) => `The site had a problem sending ${stageEn(p)}${statusEn(p)}${afterRetriesEn(p)}. Retry later.`,
    zh: (p) => `网站发送${stageZh(p)}时出错${statusZh(p)}${retriesZh(p)}。请稍后重试。`
  },
  http_unexpected_status: {
    en: (p) => `The site gave an unexpected answer while sending ${stageEn(p)}${statusEn(p)}${afterRetriesEn(p)}. Retry the download.`,
    zh: (p) => `网站发送${stageZh(p)}时给出了异常回应${statusZh(p)}${retriesZh(p)}。请重试。`
  },
  network_connect_failed: {
    en: (p) => `Couldn't connect to ${p.host || "the site"}${afterRetriesEn(p)}. Check your internet connection, then retry.`,
    zh: (p) => `无法连接到${p.host ? ` ${p.host}` : "网站"}${retriesZh(p)}。请检查网络连接后重试。`
  },
  network_timeout: {
    en: (p) => `${p.host || "The site"} stopped responding while sending ${stageEn(p)}${afterRetriesEn(p)}. Retry the download.`,
    zh: (p) => `${p.host ? `${p.host} ` : "网站"}发送${stageZh(p)}时没有响应${retriesZh(p)}。请重试。`
  },
  network_tls_failed: {
    en: (p) => `Havre couldn't verify the secure connection to ${p.host || "the site"}, so it stopped. Check your network or proxy settings.`,
    zh: (p) => `无法验证与${p.host ? ` ${p.host} ` : "网站"}的安全连接，Havre 已停止下载。请检查网络或代理设置。`
  },
  network_proxy_failed: {
    en: (p) => `Your network proxy refused the connection to ${p.host || "the site"}${statusEn(p)}. Check your proxy settings.`,
    zh: (p) => `网络代理拒绝了到${p.host ? ` ${p.host} ` : "网站"}的连接${statusZh(p)}。请检查代理设置。`
  },
  dns_failed: {
    en: (p) => `Couldn't find ${p.host || "the site"}. Check your internet connection, then retry.`,
    zh: (p) => `找不到${p.host ? ` ${p.host}` : "这个网站"}。请检查网络连接后重试。`
  },
  playlist_timeout: {
    en: (p) => {
      const who = p.host || "The site";
      const within = p.seconds ? `within ${countEn(p.seconds, "second", "seconds")}` : "in time";
      return `${who} didn't respond ${within}, so the download couldn't start. Retry later.`;
    },
    zh: (p) => {
      const who = p.host ? `${p.host} ` : "网站";
      const within = p.seconds ? `在 ${p.seconds} 秒内没有响应` : "没有及时响应";
      return `${who}${within}，下载没能开始。请稍后重试。`;
    }
  },
  transfer_incomplete: {
    en: (p) => `The connection dropped before ${stageEn(p)} finished${evenAfterRetriesEn(p)}. Retry the download.`,
    zh: (p) => `${stageZh(p)}还没传完连接就断了${retriesZh(p)}。请重试。`
  },
  range_unsupported: {
    en: (p) => `The site stopped sending ${stageEn(p)} in pieces partway through. Retry the download.`,
    zh: (p) => `网站中途停止了分段传送${stageZh(p)}。请重试。`
  },
  link_expired: {
    en: () => "The video link expired. Refresh the page, play the video once, then download again.",
    zh: () => "视频链接已经过期。请刷新页面并播放一下视频，再重新下载。"
  },
  link_expiring: {
    en: () => "The video link was about to expire, so the download didn't start. Refresh the page, play the video once, then download again.",
    zh: () => "视频链接即将过期，下载没有开始。请刷新页面并播放一下视频，再重新下载。"
  },
  private_network_blocked: {
    en: (p) => `${p.host || "This address"} is on your home network. To download from it, turn on “Allow downloads from my home network” in Settings.`,
    zh: (p) => `${p.host ? `${p.host} ` : "这个地址"}位于你的家庭网络内。如需从这里下载，请在设置中开启“允许从家庭网络下载”。`
  },
  address_blocked: {
    en: (p) => `For your safety, Havre doesn't download from ${p.host || "this address"}.`,
    zh: (p) => `为了安全，Havre 不会从${p.host ? ` ${p.host} ` : "这个地址"}下载。`
  },
  insecure_redirect_blocked: {
    en: () => "The site tried to move this download to an unencrypted connection, so Havre stopped.",
    zh: () => "网站试图把下载转到未加密的连接上，Havre 已停止。"
  },
  connection_changed: {
    en: (p) => `The connection to ${p.host || "the site"} changed unexpectedly, so Havre stopped for safety. Retry the download.`,
    zh: (p) => `与${p.host ? ` ${p.host} ` : "网站"}的连接出现了意外变化，Havre 出于安全考虑已停止。请重试。`
  },
  invalid_address: {
    en: () => "This media address can't be downloaded.",
    zh: () => "这个媒体地址无法下载。"
  },
  segment_failed: {
    en: (p) => `${capitalise(stageEn(p))} couldn't be downloaded${afterRetriesEn(p)}. Retry later.`,
    zh: (p) => `${stageZh(p)}下载失败${retriesZh(p)}。请稍后重试。`
  },
  transfer_aborted: {
    en: () => "The download stopped because another part of it failed. Retry the download.",
    zh: () => "下载的另一部分出错，整个下载随之停止。请重试。"
  },
  quality_unavailable: {
    en: () => "The quality you picked is no longer offered. Refresh the page and pick it again.",
    zh: () => "你选的清晰度已不再提供。请刷新页面后重新选择。"
  },
  audio_track_missing: {
    en: () => "Havre couldn't find this video's sound. Refresh the page, then retry.",
    zh: () => "找不到这个视频的声音。请刷新页面后重试。"
  },
  stream_live: {
    en: () => "This is a live stream. Havre can't record live streams yet.",
    zh: () => "这是直播，Havre 暂时还不能录制直播。"
  },
  stream_discontinuous: {
    en: () => "This video is stitched together from separate pieces, often with ads in between. Havre can't save this kind yet.",
    zh: () => "这个视频由几段互不衔接的内容拼成（常见于插播广告），Havre 暂时还不能保存这类视频。"
  },
  stream_nested_audio: {
    en: () => "This video's sound is packaged in a way Havre can't handle yet.",
    zh: () => "这个视频的声音封装方式比较特殊，Havre 暂时还处理不了。"
  },
  stream_empty: {
    en: () => "This video has nothing Havre can download.",
    zh: () => "这个视频里没有 Havre 能下载的内容。"
  },
  stream_invalid: {
    en: () => "The site sent video details Havre couldn't read. Refresh the page, then retry.",
    zh: () => "网站返回的视频信息无法读取。请刷新页面后重试。"
  },
  stream_too_large: {
    en: () => "This video has more parts than Havre can handle in one download.",
    zh: () => "这个视频分成的段数太多，超出了 Havre 单次下载能处理的数量。"
  },
  stream_unsupported: {
    en: () => "This video uses a streaming format Havre can't save yet.",
    zh: () => "这个视频使用的播放格式，Havre 暂时还不能保存。"
  },
  media_info_incomplete: {
    en: () => "Some details Havre needs for this video are missing. Rescan the page, then retry.",
    zh: () => "这个视频缺少下载所需的部分信息。请重新扫描页面后重试。"
  },
  selection_changed: {
    en: () => "The video's options changed while the download was starting. Download it again.",
    zh: () => "下载开始时视频的可选项发生了变化。请重新下载。"
  },
  media_stale: {
    en: () => "This video's details are out of date. Rescan the page, then retry.",
    zh: () => "这个视频的信息已经过时。请重新扫描页面后重试。"
  },
  engine_busy: {
    en: () => "Too many downloads are waiting. Retry when one of them finishes.",
    zh: () => "等待中的下载太多了。请等其中一个完成后再重试。"
  },
  engine_rejected: {
    en: () => "The local engine didn't accept this download. Retry the download.",
    zh: () => "本地引擎没有接收这个下载。请重试。"
  },
  engine_disconnected: {
    en: () => `The local engine stopped during the download. Retry the download; if it keeps happening, check ${ENGINE_SETTINGS_EN}.`,
    zh: () => `本地引擎在下载途中停止了。请重试；如果反复出现，请到${ENGINE_SETTINGS_ZH}查看。`
  },
  engine_missing: {
    en: () => `The local engine isn't set up. Set it up in ${ENGINE_SETTINGS_EN}.`,
    zh: () => `本地引擎尚未设置。请到${ENGINE_SETTINGS_ZH}完成设置。`
  },
  engine_permission_off: {
    en: () => `The local engine was turned off, so the download stopped. Set it up again in ${ENGINE_SETTINGS_EN}.`,
    zh: () => `本地引擎被关闭了，下载因此停止。请到${ENGINE_SETTINGS_ZH}重新设置。`
  },
  engine_restarted: {
    en: () => "Chrome restarted Havre in the background, so this download stopped. Download it again.",
    zh: () => "Chrome 在后台重启了 Havre，这个下载因此中断。请重新下载。"
  },
  component_missing: {
    en: (p) => `${COMPONENT_EN[p.feature] || "This download"} needs video tools that aren't installed yet. Finish setup in ${ENGINE_SETTINGS_EN}.`,
    zh: (p) => `${COMPONENT_ZH[p.feature] || "这个下载"}需要的视频处理工具还没有安装。请到${ENGINE_SETTINGS_ZH}完成设置。`
  },
  mp3_encoder_missing: {
    en: () => `The installed video tools can't create MP3 files. Reinstall them from ${ENGINE_SETTINGS_EN}.`,
    zh: () => `已安装的视频处理工具无法生成 MP3 文件。请到${ENGINE_SETTINGS_ZH}重新安装。`
  },
  external_tool_disabled: {
    en: () => "Havre can't download this kind of video yet.",
    zh: () => "Havre 暂时还不能下载这类视频。"
  },
  youtube_tool_missing: {
    en: () => `YouTube downloads need yt-dlp on this Mac. Install it, then choose Retry in ${ENGINE_SETTINGS_EN}.`,
    zh: () => `下载 YouTube 视频需要这台 Mac 上装有 yt-dlp。请先安装它，再到${ENGINE_SETTINGS_ZH}点“重试”。`
  },
  external_tool_failed: {
    en: (p) => `The YouTube engine couldn't finish this download${Number.isInteger(p.exit_code) ? ` (exit code ${p.exit_code})` : ""}. Retry; if it keeps failing, update yt-dlp.`,
    zh: (p) => `YouTube 引擎没能完成这个下载${Number.isInteger(p.exit_code) ? `（退出码 ${p.exit_code}）` : ""}。请重试；反复失败时请更新 yt-dlp。`
  },
  internal_error: {
    en: () => "Something went wrong inside Havre. Retry the download.",
    zh: () => "Havre 内部出了问题。请重试。"
  },
  disk_full: {
    // The save folder may sit on an external drive, so don't blame "your Mac".
    en: () => "The drive you save to is full. Free up some space, then retry.",
    zh: () => "磁盘空间不足。请腾出一些空间后重试。"
  },
  folder_unavailable: {
    en: () => "The save folder can't be found. Reconnect its drive or choose another folder in Settings.",
    zh: () => "找不到保存文件夹。请重新连接所在的磁盘，或在设置中换一个文件夹。"
  },
  folder_not_writable: {
    en: () => "Havre isn't allowed to save in this folder. Choose another folder in Settings.",
    zh: () => "Havre 没有权限保存到这个文件夹。请在设置中换一个文件夹。"
  },
  output_name_unavailable: {
    en: () => "Havre couldn't find a free file name in the save folder. Rename or move files with the same name, then retry.",
    zh: () => "保存文件夹里找不到可用的文件名。请整理同名文件后重试。"
  },
  disk_write_failed: {
    en: () => "Havre couldn't finish writing the file. Retry the download.",
    zh: () => "文件没能写完。请重试。"
  },
  processing_failed: {
    en: (p) => `${PROCESSING_EN[p.stage] || "Processing the downloaded video failed."} Retry the download.`,
    zh: (p) => `${PROCESSING_ZH[p.stage] || "处理已下载的视频时失败。"}请重试。`
  },
  processing_timeout: {
    en: (p) => (p.hours
      ? `Processing took longer than ${countEn(p.hours, "hour", "hours")}, so Havre stopped it.`
      : "Processing took too long, so Havre stopped it."),
    zh: (p) => (p.hours ? `处理时间超过 ${p.hours} 小时，Havre 已停止。` : "处理时间太长，Havre 已停止。")
  },
  processing_output_too_large: {
    en: () => "The finished file grew unusually large, so Havre stopped.",
    zh: () => "生成的文件异常庞大，Havre 已停止。"
  },
  drm_protected: {
    en: () => "This video is copy-protected, so Havre can't save it.",
    zh: () => "这个视频受版权保护，Havre 无法保存。"
  },
  key_fetch_failed: {
    en: (p) => `The site didn't provide the key needed to unlock this video${evenAfterRetriesEn(p)}. ${REFRESH_EN}`,
    zh: (p) => `网站没有提供解锁这个视频所需的密钥${retriesZh(p)}。${REFRESH_ZH}`
  },
  html_instead_of_media: {
    en: (p) => `The site sent a web page instead of ${stageEn(p)}; the link may have expired. ${REFRESH_EN}`,
    zh: (p) => `网站返回了一个网页，没有返回${stageZh(p)}，链接可能已经过期。${REFRESH_ZH}`
  },
  cancelled: {
    en: () => "Cancelled",
    zh: () => "已取消"
  },
  paused: {
    en: () => "Paused",
    zh: () => "已暂停"
  },
  blocked_by_system: {
    en: () => "Chrome or your Mac blocked this file for security reasons.",
    zh: () => "出于安全原因，Chrome 或你的 Mac 拦截了这个文件。"
  },
  browser_closed: {
    en: () => "Chrome closed before the download finished. Retry the download.",
    zh: () => "下载完成前 Chrome 关闭了。请重试。"
  },
  browser_interrupted: {
    en: () => "Chrome interrupted this download. Retry the download.",
    zh: () => "Chrome 中断了这个下载。请重试。"
  },
  browser_record_missing: {
    en: () => "Chrome no longer has a record of this download.",
    zh: () => "Chrome 里已经没有这个下载的记录了。"
  },
  // One phrasing for "the local engine is not set up" (rename table §4).
  engine_not_set_up: {
    en: () => "Set up the local engine first.",
    zh: () => "请先设置本地引擎。"
  },
  engine_unreachable: {
    en: () => `Havre couldn't reach the local engine. Check ${ENGINE_SETTINGS_EN}.`,
    zh: () => `无法连接本地引擎。请到${ENGINE_SETTINGS_ZH}查看。`
  },
  engine_not_responding: {
    en: () => `The local engine didn't respond. Try again; if it keeps happening, check ${ENGINE_SETTINGS_EN}.`,
    zh: () => `本地引擎没有响应。请再试一次；如果反复出现，请到${ENGINE_SETTINGS_ZH}查看。`
  },
  engine_finishing_setup: {
    en: () => "Finishing setup… Try again in a few seconds.",
    zh: () => "正在完成设置…请过几秒再试。"
  },
  engine_restart_needed: {
    en: () => "Quit and reopen Chrome to finish setting up the local engine.",
    zh: () => "请完全退出并重新打开 Chrome，以完成本地引擎的设置。"
  },
  engine_update_needed: {
    en: () => `The local engine needs an update. See ${ENGINE_SETTINGS_EN}.`,
    zh: () => `本地引擎需要更新。请到${ENGINE_SETTINGS_ZH}查看。`
  },
  pause_unsupported: {
    en: () => `Update the local engine to pause downloads. See ${ENGINE_SETTINGS_EN}.`,
    zh: () => `当前的本地引擎不支持暂停。请到${ENGINE_SETTINGS_ZH}更新。`
  },
  invalid_request: {
    en: () => "Havre couldn't handle that request. Reload the page and try again.",
    zh: () => "Havre 无法处理这个请求。请重新载入页面后再试。"
  },
  site_not_supported: {
    en: () => "Havre can't download from this site.",
    zh: () => "Havre 不支持从这个网站下载。"
  },
  site_ignored: {
    en: () => "This site is in “Ignored sites” in Settings.",
    zh: () => "这个网站在设置的“忽略的网站”里。"
  },
  ignored_by_settings: {
    en: () => "Settings skip this link: its site is in “Ignored sites”, or the file is smaller than your “Ignore files smaller than” size.",
    zh: () => "这个链接被设置略过了：它的网站在“忽略的网站”里，或文件小于“忽略小于此大小的文件”中设定的大小。"
  },
  download_not_allowed: {
    en: () => "For your safety, Havre can't download this address. Play the video on the page, then retry.",
    zh: () => "为了安全，Havre 不能下载这个地址。请先在页面上播放一下视频，再重试。"
  },
  url_scheme_invalid: {
    en: () => "Enter a link that starts with http or https.",
    zh: () => "请输入以 http 或 https 开头的链接。"
  },
  not_media: {
    en: () => "This link isn't a video, audio file or playlist Havre can download.",
    zh: () => "这个链接不是可下载的视频、音频或播放列表。"
  },
  url_unreadable: {
    en: () => "Havre couldn't read this link. Check that it opens on its own, then retry.",
    zh: () => "无法读取这个链接。请确认它可以直接打开，再重试。"
  },
  record_missing: {
    en: () => "This download is no longer in your history.",
    zh: () => "下载记录里已经没有这一条了。"
  },
  file_not_ready: {
    en: () => "This download hasn't finished yet.",
    zh: () => "这个下载还没有完成。"
  },
  file_missing: {
    en: () => "File not found. It may have been moved or deleted.",
    zh: () => "找不到文件，它可能已被移走或删除。"
  },
  file_outside_folder: {
    en: () => "This file isn't in the Havre folder. Open it from Finder.",
    zh: () => "这个文件不在 Havre 文件夹里，请在 Finder 中打开。"
  },
  trash_failed: {
    en: () => "Couldn't move the file to the Trash. Try it in Finder.",
    zh: () => "没能移到废纸篓。请在 Finder 中操作。"
  },
  file_action_failed: {
    en: () => "Couldn't open the file. Open it from Finder.",
    zh: () => "无法打开文件，请在 Finder 中打开。"
  },
  folder_change_failed: {
    en: () => "Couldn't change the save folder. Try again.",
    zh: () => "无法更改保存位置，请重试。"
  },
  not_retryable: {
    en: () => "This download can't be retried. Download it again from its page.",
    zh: () => "这个下载无法重试，请回到来源页面重新下载。"
  },
  cannot_resume: {
    en: () => "This download can't continue. Download it again from its page.",
    zh: () => "这个下载无法继续，请回到来源页面重新下载。"
  },
  source_expired: {
    en: () => "The page this came from has changed. Open it again, then download.",
    zh: () => "来源页面的信息已经过期。请重新打开页面后再下载。"
  },
  source_missing: {
    en: () => "This download has no source page.",
    zh: () => "这条下载记录没有来源页面。"
  },
  job_ended: {
    en: () => "This download has already ended.",
    zh: () => "这个下载已经结束了。"
  },
  cannot_pause: {
    en: () => "This download can't be paused right now.",
    zh: () => "这个下载现在不能暂停。"
  },
  not_paused: {
    en: () => "This download isn't paused.",
    zh: () => "这个下载没有暂停。"
  },
  unknown: {
    en: () => "The download failed. Retry the download.",
    zh: () => "下载失败。请重试。"
  }
});

/**
 * A failure from a known code and raw params, with the params cleaned the
 * same way classifyJobFailure cleans them (an unknown code becomes
 * "unknown"). The background worker uses it for the { code, params } it
 * sends with an error answer, so nothing but validated primitives travels.
 *
 * @param {string} code
 * @param {object} [params]
 * @returns {{ code: string, params: object }}
 */
export function jobFailure(code, params = {}) {
  return failure(code, params);
}

/**
 * Render a classified failure as one or two short sentences.
 *
 * @param {{ code: string, params?: object }} failureValue
 * @param {"en"|"zh"} lang
 * @returns {string}
 */
export function describeJobFailure(failureValue, lang) {
  const code = failureValue && CODE_SET.has(failureValue.code) ? failureValue.code : "unknown";
  const params = cleanParams(code, failureValue?.params);
  return CATALOG[code][languageOf(lang)](params);
}

// ---------------------------------------------------------------------------
// Progress text shown while a job runs

const PARTS = /^(?:DASH\s*分片|视频片段|分片)\s*(\d{1,9})\s*\/\s*(\d{1,9})$/i;
const PARTS_ANYWHERE = /(?:DASH\s*分片|视频片段|分片)\s*(\d{1,9})\s*\/\s*(\d{1,9})/i;
const MEDIA_TIME = "\\d{1,3}:\\d{2}(?::\\d{2})?";
const TIME_OF = new RegExp(`^(${MEDIA_TIME})\\s*/\\s*(${MEDIA_TIME})$`);
const TIME_DONE = new RegExp(`^已处理\\s*(${MEDIA_TIME})$`);

const ACTIVITIES = [
  [/^正在获取播放列表/, "Getting video info…", "正在读取视频信息…"],
  [/^正在探测媒体/, "Checking the file…", "正在检查文件…"],
  [/^正在下载视频轨/, "Downloading picture", "正在下载画面"],
  [/^正在下载音频轨/, "Downloading sound", "正在下载声音"],
  [/^正在(?:无损)?合并\s*(?:DASH|HLS)?\s*音视频/i, "Joining picture and sound", "正在合并画面和声音"],
  [/^正在无损封装/, "Finishing the file", "正在生成最终文件"],
  [/^正在转换格式/, "Converting the file", "正在转换格式"],
  [/^正在(?:从本地媒体)?提取音频/, "Extracting audio", "正在提取音频"],
  [/^正在处理(?:媒体|视频)/, "Processing the file", "正在处理文件"],
  [/^排队中|^等待本地引擎/, "Waiting to start", "等待开始"],
  [/^正在暂停/, "Pausing…", "正在暂停…"],
  [/^已暂停/, "Paused", "已暂停"],
  [/^浏览器正在下载/, "Downloading", "正在下载"],
  [/^已保存到 ?Havre ?文件夹/, "Saved to the Havre folder", "已保存到 Havre 文件夹"],
  [/^已保存到下载目录/, "Saved to your Downloads folder", "已保存到“下载”文件夹"],
  [/^任务已取消/, "Cancelled", "已取消"]
];

function partsText(done, total, language) {
  return language === "zh" ? `第 ${done}/${total} 段` : `Part ${done} of ${total}`;
}

function timeSuffix(details, language) {
  for (const detail of details) {
    const of = TIME_OF.exec(detail);
    if (of) return language === "zh" ? ` · ${of[1]} / ${of[2]}` : ` · ${of[1]} of ${of[2]}`;
    const done = TIME_DONE.exec(detail);
    if (done) return language === "zh" ? ` · 已处理 ${done[1]}` : ` · ${done[1]} done`;
  }
  return "";
}

/**
 * Localise the engine's progress text for a running job.
 *
 * @param {string} message the raw progress text (record.message)
 * @param {"en"|"zh"} lang
 * @returns {string|null} null for empty input; never the raw text
 */
export function describeJobActivity(message, lang) {
  const text = normalise(message);
  if (!text) return null;
  const language = languageOf(lang);
  const [head, ...details] = text.split(/\s+·\s+/);
  const parts = PARTS.exec(head);
  if (parts) return partsText(Number(parts[1]), Number(parts[2]), language);
  for (const [pattern, en, zh] of ACTIVITIES) {
    if (pattern.test(head)) return `${language === "zh" ? zh : en}${timeSuffix(details, language)}`;
  }
  return language === "zh" ? "正在下载…" : "Downloading…";
}

/**
 * Read "parts done / parts total" from the engine's progress text.
 *
 * @param {string} message
 * @returns {{ done: number, total: number } | null}
 */
export function segmentsFromActivity(message) {
  const match = PARTS_ANYWHERE.exec(normalise(message));
  if (!match) return null;
  const done = Number(match[1]);
  const total = Number(match[2]);
  if (!Number.isSafeInteger(done) || !Number.isSafeInteger(total) || total <= 0 || done > total) return null;
  return { done, total };
}
