import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  FAILURE_CODES,
  jobFailure,
  classifyJobFailure,
  describeJobFailure,
  describeJobActivity,
  segmentsFromActivity
} from "../extension/lib/job-failure.js";

const read = (relative) => readFileSync(new URL(`../${relative}`, import.meta.url), "utf8");

const HOST_PY = read("native-host/host.py");
const POLICY_PY = read("native-host/fluxcatch_network_policy.py");
const BACKGROUND_JS = read("extension/background.js");

function pythonConstant(source, name) {
  const match = new RegExp(`^${name} = "([^"]*)"$`, "m").exec(source);
  assert.ok(match, `${name} is no longer a plain string constant`);
  return match[1];
}

function jsConstant(source, name) {
  const match = new RegExp(`^const ${name} = "([^"]*)";$`, "m").exec(source);
  assert.ok(match, `${name} is no longer a plain string constant`);
  return match[1];
}

// Use the extension's own redaction so samples look like stored records.
function extractJsFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  if (start < 0) return null;
  let depth = 0;
  for (let index = source.indexOf("{", start); index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    else if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  return null;
}

const { cleanText, redactJobText } = (() => {
  const clean = extractJsFunction(BACKGROUND_JS, "cleanText");
  const redact = extractJsFunction(BACKGROUND_JS, "redactJobText");
  assert.ok(clean && redact, "background.js no longer defines cleanText/redactJobText");
  return new Function(`${clean}\n${redact}\nreturn { cleanText, redactJobText };`)();
})();

// What a native failure looks like once stored: handleNativeMessage cuts the
// engine's error to 240 characters, then normalizeJob redacts it (and cuts
// to 240 again).
const storedNativeText = (raw) => redactJobText(cleanText(raw, 240), 240);

const HTML_MEDIA_MESSAGE = pythonConstant(HOST_PY, "HTML_MEDIA_MESSAGE");
const QUEUED_MESSAGE = pythonConstant(HOST_PY, "QUEUED_MESSAGE");
const PAUSED_MESSAGE = pythonConstant(HOST_PY, "PAUSED_MESSAGE");
const NATIVE_HOST_MISSING_MESSAGE = jsConstant(BACKGROUND_JS, "NATIVE_HOST_MISSING_MESSAGE");
const NATIVE_CONNECTION_FAILED_MESSAGE = jsConstant(BACKGROUND_JS, "NATIVE_CONNECTION_FAILED_MESSAGE");
const NATIVE_API_UNAVAILABLE_MESSAGE = jsConstant(BACKGROUND_JS, "NATIVE_API_UNAVAILABLE_MESSAGE");
const NATIVE_API_RESTART_MESSAGE = jsConstant(BACKGROUND_JS, "NATIVE_API_RESTART_MESSAGE");
const NATIVE_API_SELF_HEAL_MESSAGE = jsConstant(BACKGROUND_JS, "NATIVE_API_SELF_HEAL_MESSAGE");
const HOST_MISMATCH_MESSAGE = jsConstant(read("extension/lib/build-profile.js").replace(/^export /gm, ""), "HOST_MISMATCH_MESSAGE");

const PLANNER = (detail) =>
  `The pinned built-in static DASH planner could not handle this MPD: ${detail}. Direct network access by /opt/homebrew/bin/ffmpeg (version 7.1) is disabled; this structure needs pinned broker support`;

// [input, expected code, expected params (exact)]. Text follows the real
// templates in native-host/host.py, fluxcatch_network_policy.py and
// extension/background.js.
const SAMPLES = [
  ["HLS media segment 11 failed: HTTP 403 for https://example.tv/…", "http_forbidden",
    { status: 403, host: "example.tv", stage: "segment", track: "media", segment: 12, retries: 5 }],
  ["DASH audio track download failed: HTTP Error 412: Precondition Failed", "http_forbidden",
    { status: 412, stage: "audio_track", track: "audio" }],
  ["DASH video track download failed: Range 0-1048575 failed: HTTP 401 for https://cdn.example.tv/…", "http_forbidden",
    { status: 401, host: "cdn.example.tv", stage: "video_track", track: "video", retries: 3 }],
  ["HLS key fetch failed: HTTP 403 for https://keys.example.tv/…", "http_forbidden",
    { status: 403, host: "keys.example.tv", stage: "key", retries: 4 }],
  [{ browserReason: "SERVER_FORBIDDEN" }, "http_forbidden", { status: 403 }],
  ["Download failed after retries: HTTP 404 for https://cdn.example.tv/…", "http_not_found",
    { status: 404, host: "cdn.example.tv", stage: "file", retries: 3 }],
  ["HLS media segment -1 failed: HTTP 410 for https://example.tv/…", "http_not_found",
    { status: 410, host: "example.tv", stage: "header", track: "media", retries: 5 }],
  ["Manifest download failed after retries: HTTP 429 for https://example.tv/…", "http_rate_limited",
    { status: 429, host: "example.tv", stage: "playlist", retries: 5 }],
  ["DASH resource failed: HTTP 503 for https://example.tv/…", "http_server_error",
    { status: 503, host: "example.tv", stage: "dash_part", retries: 3 }],
  [{ browserReason: "SERVER_FAILED" }, "http_server_error", {}],
  ["Download failed after retries: unexpected media response status 206", "http_unexpected_status",
    { status: 206, stage: "file", retries: 3 }],
  ["HLS audio segment 4 failed: Unexpected HLS segment response status", "http_unexpected_status",
    { stage: "segment", track: "audio", segment: 5, retries: 5 }],
  ["HLS media segment 0 failed: Network request failed for https://cdn.example.tv/…: Could not connect to authorized network target cdn.example.tv", "network_connect_failed",
    { host: "cdn.example.tv", stage: "segment", track: "media", segment: 1, retries: 5 }],
  ["Range 0-1048575 failed: [Errno 54] Connection reset by peer", "network_connect_failed",
    { stage: "file_part", retries: 3 }],
  // The wrapper says the request failed, so an errno that also names a disk
  // problem is still a connection failure.
  ["Network request failed for https://example.tv/…: [Errno 13] Permission denied", "network_connect_failed",
    { host: "example.tv" }],
  [{ browserReason: "NETWORK_FAILED" }, "network_connect_failed", {}],
  ["HLS media segment 7 failed: The read operation timed out", "network_timeout",
    { stage: "segment", track: "media", segment: 8, retries: 5 }],
  // Stored records lose the colon after "<origin>/…" to the extension's redaction.
  [redactJobText("Network request failed for https://example.tv/…: timed out", 240), "network_timeout", { host: "example.tv" }],
  ["Network request failed for https://example.tv/…: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)", "network_tls_failed",
    { host: "example.tv" }],
  ["Network request failed for https://example.tv/…: Tunnel connection failed: 407 Proxy Authentication Required", "network_proxy_failed",
    { host: "example.tv", status: 407 }],
  ["Could not resolve network target media.example.tv", "dns_failed", { host: "media.example.tv" }],
  // yt-dlp behind the engine's broker (host.py youtube_download / youtube_inspect).
  ["yt-dlp is not installed; YouTube downloads need it", "youtube_tool_missing", {}],
  ["本地引擎未找到 yt-dlp，无法下载 YouTube 视频", "youtube_tool_missing", {}],
  ["yt-dlp failed (1): ERROR: [youtube] dQw4w9WgXcQ: Private video. Sign in if you've been granted access to this video", "http_forbidden", {}],
  ["yt-dlp failed (1): ERROR: [youtube] dQw4w9WgXcQ: Video unavailable", "http_not_found", {}],
  ["yt-dlp failed (1): ERROR: [youtube] dQw4w9WgXcQ: Requested format is not available. Use --list-formats for a list of available formats", "quality_unavailable", {}],
  ["yt-dlp failed (1): ERROR: unable to download video data: HTTP Error 403: Forbidden [network policy: Network target 10.0.0.5 is private; enable private-network media explicitly to continue]", "download_not_allowed", {}],
  ["yt-dlp failed (120): ERROR: [youtube] dQw4w9WgXcQ: Unable to extract player version", "external_tool_failed", { exit_code: 120 }],
  ["yt-dlp produced no output", "external_tool_failed", {}],
  ["yt-dlp exceeded the processing time limit", "processing_timeout", { hours: 6 }],
  ["yt-dlp did not answer within the inspection time limit", "engine_not_responding", {}],
  ["Network target example.tv resolved to no addresses", "dns_failed", { host: "example.tv" }],
  ["获取播放列表超时(20s): example.tv", "playlist_timeout", { seconds: 20, host: "example.tv" }],
  ["获取播放列表超时(20s): unknown", "playlist_timeout", { seconds: 20 }],
  ["Range 0-1048575 failed: Range response ended early", "transfer_incomplete", { stage: "file_part", retries: 3 }],
  ["Download failed after retries: IncompleteRead(1024 bytes read, 2048 more expected)", "transfer_incomplete",
    { stage: "file", retries: 3 }],
  [{ browserReason: "FILE_TOO_SHORT" }, "transfer_incomplete", {}],
  ["Range 1048576-2097151 failed: Server stopped honoring range requests", "range_unsupported",
    { stage: "file_part", retries: 3 }],
  ["DASH 任务开始前签名链接已过期，请刷新页面后重试", "link_expired", {}],
  ["视频清晰度地址已过期，请重新扫描页面", "link_expired", {}],
  ["DASH 音频轨启动前签名链接即将过期，请刷新页面后重试", "link_expiring", {}],
  ["Network target nas.local is private; enable private-network media explicitly to continue", "private_network_blocked",
    { host: "nas.local" }],
  ["Network target ::1 is private; enable private-network media explicitly to continue", "private_network_blocked",
    { host: "[::1]" }],
  ["Network target metadata.google.internal is a metadata service", "address_blocked", { host: "metadata.google.internal" }],
  ["Network target evil.example resolves to a forbidden address", "address_blocked", { host: "evil.example" }],
  ["HTTPS redirects may not downgrade transport security", "insecure_redirect_blocked", {}],
  ["Network target example.tv changed address during connection", "connection_changed", { host: "example.tv" }],
  ["HTTP response target did not match the authorized request", "connection_changed", {}],
  ["Only credential-free HTTP(S) URLs are accepted", "invalid_address", {}],
  [{ browserReason: "NETWORK_INVALID_REQUEST" }, "invalid_address", {}],
  ["HLS media segment 2 failed: 'NoneType' object has no attribute 'read'", "segment_failed",
    { stage: "segment", track: "media", segment: 3, retries: 5 }],
  // 240-character truncation can cut the cause; the wrapper still tells where.
  ["DASH video track download failed: Range 0-1048575 failed: HTTP 40", "segment_failed",
    { stage: "video_track", track: "video", retries: 3 }],
  ["Download aborted after another transfer failed", "transfer_aborted", {}],
  ["DASH download aborted", "transfer_aborted", {}],
  ["The selected HLS variant is no longer present; refresh the page and choose again", "quality_unavailable", {}],
  ["所选清晰度已失效，请重新读取清晰度", "quality_unavailable", {}],
  [PLANNER("selected DASH video Representation is no longer present"), "quality_unavailable", {}],
  ["Selected HLS variant references a missing external audio group", "audio_track_missing", {}],
  ["未找到可配对的音轨，请重新扫描页面", "audio_track_missing", {}],
  ["Live audio HLS recording is not supported in FluxCatch 0.2.5", "stream_live", { track: "audio" }],
  ["Discontinuous HLS is not supported in FluxCatch 0.2.5", "stream_discontinuous", {}],
  ["Nested separate-audio HLS is not supported", "stream_nested_audio", {}],
  ["HLS playlist has no downloadable static VOD segments", "stream_empty", {}],
  ["Invalid HLS playlist", "stream_invalid", {}],
  [PLANNER("invalid DASH SegmentTimeline repeat"), "stream_invalid", {}],
  ["HLS playlist exceeds the segment limit", "stream_too_large", {}],
  ["Manifest download failed after retries: Response exceeds the configured limit", "stream_too_large", {}],
  [redactJobText(PLANNER("built-in DASH planner requires exactly one Period"), 240), "stream_unsupported", {}],
  [PLANNER("video track is unsupported: unsupported DASH template token in '$Time%05d$'"), "stream_unsupported", {}],
  // host.py builds these two details as variables, so the drift guard below
  // cannot see them as constructor literals.
  [PLANNER("audio track is unsupported: no usable audio Representation was found"), "stream_unsupported", {}],
  [PLANNER("no audio/video Representations were found"), "stream_unsupported", {}],
  ["DASH pair is missing an audio URL", "media_info_incomplete", {}],
  ["所选清晰度已更新，请重新开始下载", "selection_changed", {}],
  ["该媒体候选项已失效，请重新扫描页面", "media_stale", {}],
  [{ nativeCode: "host_busy", text: "本地引擎任务队列已满，请稍后重试" }, "engine_busy", {}],
  ["Native job queue is full; retry after an active job finishes", "engine_busy", {}],
  ["cannot schedule new futures after shutdown", "engine_rejected", {}],
  ["本地引擎未接收任务", "engine_rejected", {}],
  ["Attempting to use a disconnected port object", "engine_rejected", {}],
  [NATIVE_CONNECTION_FAILED_MESSAGE, "engine_disconnected", {}],
  [NATIVE_HOST_MISSING_MESSAGE, "engine_missing", {}],
  ["本地下载引擎权限已关闭", "engine_permission_off", {}],
  ["浏览器后台已重启，原本地任务状态已失效", "engine_restarted", {}],
  ["请重新开始该下载任务", "engine_restarted", {}],
  ["Separate-audio HLS requires FFmpeg", "component_missing", { feature: "merge" }],
  ["AES-128 HLS requires FFmpeg", "component_missing", { feature: "decrypt" }],
  ["Conversion requires FFmpeg", "component_missing", { feature: "convert" }],
  ["DASH pair audio extraction requires FFmpeg", "component_missing", { feature: "extract_audio" }],
  [redactJobText("Audio extraction requires libmp3lame, but /opt/homebrew/bin/ffmpeg does not provide that encoder", 240), "mp3_encoder_missing", {}],
  ["FFmpeg 直接联网已由安全策略关闭；请使用内置受控下载路径。此媒体结构需要后续 pinned broker 支持", "external_tool_disabled", {}],
  ["Manifest download failed without a result", "internal_error", {}],
  ["Internal FFmpeg argument list is incomplete", "internal_error", {}],
  ["HLS media segment 5 failed: [Errno 28] No space left on device", "disk_full", {}],
  ["DASH audio/video merge failed: FFmpeg failed (228): av_interleaved_write_frame(): No space left on device", "disk_full", {}],
  [{ browserReason: "FILE_NO_SPACE" }, "disk_full", {}],
  [redactJobText("[Errno 2] No such file or directory: '/Users/me/Downloads/FluxCatch/.fluxcatch-dash-pair-1'", 240), "folder_unavailable", {}],
  [redactJobText("[Errno 13] Permission denied: '/Volumes/Drive/FluxCatch/clip.mp4'", 240), "folder_not_writable", {}],
  [{ browserReason: "FILE_ACCESS_DENIED" }, "folder_not_writable", {}],
  ["Could not allocate an output filename", "output_name_unavailable", {}],
  [redactJobText("Could not publish output safely: [Errno 18] Cross-device link: '/Users/me/a.part' -> '/Users/me/a.mp4'", 240), "disk_write_failed", {}],
  ["Temporary file write ended early", "disk_write_failed", {}],
  [{ browserReason: "FILE_FAILED" }, "disk_write_failed", {}],
  ["DASH audio/video merge failed: FFmpeg failed (1): Conversion failed!", "processing_failed", { stage: "merge", exit_code: 1 }],
  ["DASH audio extraction failed: FFmpeg produced no output", "processing_failed", { stage: "extract_audio" }],
  [{ text: "FFmpeg failed (1): Invalid data found when processing input", activity: "正在无损封装 · 0:12 / 2:28 · 1.50×" }, "processing_failed",
    { stage: "package", exit_code: 1 }],
  [{ text: "FFmpeg failed (-9): Killed", activity: "正在转换格式" }, "processing_failed", { stage: "convert", exit_code: -9 }],
  ["FFmpeg exceeded the processing time limit", "processing_timeout", { hours: 6 }],
  ["FFmpeg output exceeded the configured size limit", "processing_output_too_large", {}],
  ["DRM/SAMPLE-AES audio HLS is metadata-only", "drm_protected", { track: "audio" }],
  ["Protected DASH is metadata-only", "drm_protected", {}],
  ["HLS key fetch failed: HLS key response has 0 bytes, expected 16", "key_fetch_failed", { retries: 4 }],
  [`DASH video track download failed: ${HTML_MEDIA_MESSAGE}`, "html_instead_of_media", { stage: "video_track", track: "video" }],
  [HTML_MEDIA_MESSAGE, "html_instead_of_media", {}],
  [{ status: "cancelled", text: "HLS media segment 11 failed: HTTP 403 for https://example.tv/…" }, "cancelled", {}],
  [{ browserReason: "USER_CANCELED" }, "cancelled", {}],
  ["任务已取消", "cancelled", {}],
  [{ status: "paused", text: PAUSED_MESSAGE }, "paused", {}],
  [PAUSED_MESSAGE, "paused", {}],
  [{ browserReason: "FILE_VIRUS_INFECTED" }, "blocked_by_system", {}],
  [{ browserReason: "USER_SHUTDOWN" }, "browser_closed", {}],
  ["CRASH", "browser_closed", {}],
  [{ browserReason: "SERVER_SOMETHING_NEW" }, "browser_interrupted", {}],
  ["浏览器下载中断", "browser_interrupted", {}],
  ["浏览器下载记录已不存在", "browser_record_missing", {}],
  // The worker's answers to pages (background.js). The worker sends the code
  // itself; the Chinese text it keeps in `error` classifies the same way.
  ["需要授权连接本地引擎，才能使用此下载模式", "engine_not_set_up", {}],
  ["尚未授权连接本地引擎", "engine_not_set_up", {}],
  ["需要本地下载引擎权限才能打开文件", "engine_not_set_up", {}],
  ["本地下载引擎未连接，请先在设置里开启", "engine_not_set_up", {}],
  [{ nativeCode: "engine_unreachable" }, "engine_unreachable", {}],
  ["本地下载引擎未连接", "engine_unreachable", {}],
  ["本地引擎响应超时", "engine_not_responding", {}],
  [NATIVE_API_UNAVAILABLE_MESSAGE, "engine_finishing_setup", {}],
  [NATIVE_API_SELF_HEAL_MESSAGE, "engine_finishing_setup", {}],
  [NATIVE_API_RESTART_MESSAGE, "engine_restart_needed", {}],
  [HOST_MISMATCH_MESSAGE, "engine_update_needed", {}],
  ["当前安装的本地下载引擎不支持暂停，请更新引擎", "pause_unsupported", {}],
  ["消息来源未通过校验", "invalid_request", {}],
  ["Unknown message type: SOMETHING", "invalid_request", {}],
  ["商店版本不支持从此平台下载", "site_not_supported", {}],
  ["该域名已在 FluxCatch 设置中被忽略", "site_ignored", {}],
  ["该地址被当前设置忽略（域名屏蔽或小于最小媒体大小）", "ignored_by_settings", {}],
  ["网络策略已阻止 https://media.example.tv/…（download_requires_observation_or_user_action）", "download_not_allowed", {}],
  ["网络策略已阻止 http://192.168.1.20/…（blocked_private）", "private_network_blocked", { host: "192.168.1.20" }],
  ["网络策略已阻止 http://169.254.169.254/…（blocked_link_local）", "address_blocked", { host: "169.254.169.254" }],
  ["网络策略已阻止 <无效地址>（invalid_url）", "invalid_address", {}],
  ["请输入 http 或 https 的媒体地址", "url_scheme_invalid", {}],
  ["这个地址不是可下载的媒体（视频、音频或播放列表）", "not_media", {}],
  ["无法读取这个地址的类型，请确认链接可以直接打开（HTTP 403）", "url_unreadable", {}],
  ["读取媒体清单超时（12 秒无响应）", "playlist_timeout", { seconds: 12 }],
  ["所选 DASH 清晰度已失效，请重新读取清晰度", "quality_unavailable", {}],
  ["FluxCatch 0.2.5 暂不支持 HLS 直播录制", "stream_live", {}],
  ["FluxCatch 0.2.5 暂不支持包含时间线切换的 HLS 下载", "stream_discontinuous", {}],
  ["0.2.5 暂停外部引擎联网，等待受控网络代理", "external_tool_disabled", {}],
  ["媒体清单超出大小限制", "stream_too_large", {}],
  ["找不到这条下载记录", "record_missing", {}],
  ["只有已完成的下载才能打开文件", "file_not_ready", {}],
  ["文件已不在下载文件夹中", "file_missing", {}],
  ["这个文件不在 FluxCatch 的下载文件夹里，请在 Finder 中打开", "file_outside_folder", {}],
  ["无法移到废纸篓，请在 Finder 中操作", "trash_failed", {}],
  ["操作失败，请在 Finder 中手动打开", "file_action_failed", {}],
  ["无法更改保存位置", "folder_change_failed", {}],
  ["已取消选择", "cancelled", {}],
  ["这条任务无法重试，请回到来源页面重新下载", "not_retryable", {}],
  ["这条任务无法继续，请回到来源页面重新下载", "cannot_resume", {}],
  ["来源页面的媒体信息已失效，请重新打开页面后再下载", "source_expired", {}],
  ["这条记录没有来源页面", "source_missing", {}],
  ["任务不存在或已结束", "job_ended", {}],
  ["这条任务现在不能暂停", "cannot_pause", {}],
  ["这条任务不在暂停状态", "not_paused", {}],
  ["", "unknown", {}],
  ["KeyError: 'audio'", "unknown", {}]
];

function inputOf(sample) {
  return typeof sample === "string" ? { text: sample } : sample;
}

const PARAM_TYPES = {
  status: (value) => Number.isInteger(value) && value >= 100 && value <= 599,
  host: (value) => typeof value === "string" && value.length <= 253 && /^(?:[a-z0-9_.-]+|\[[0-9a-f:.]+\])$/.test(value),
  stage: (value) => ["file", "file_part", "playlist", "segment", "header", "dash_part", "key", "video_track", "audio_track", "merge", "extract_audio", "convert", "package", "plan"].includes(value),
  track: (value) => ["media", "video", "audio"].includes(value),
  segment: (value) => Number.isInteger(value) && value >= 1,
  retries: (value) => Number.isInteger(value) && value >= 1,
  seconds: (value) => Number.isInteger(value) && value >= 1,
  hours: (value) => Number.isInteger(value) && value >= 1,
  exit_code: (value) => Number.isInteger(value),
  feature: (value) => ["merge", "convert", "extract_audio", "decrypt"].includes(value)
};

function assertCleanParams(params, context) {
  for (const [key, value] of Object.entries(params)) {
    assert.ok(Object.hasOwn(PARAM_TYPES, key), `${context}: unexpected param ${key}`);
    assert.ok(PARAM_TYPES[key](value), `${context}: bad ${key}=${JSON.stringify(value)}`);
  }
}

test("FAILURE_CODES is a frozen list of unique codes", () => {
  assert.ok(Object.isFrozen(FAILURE_CODES));
  assert.equal(new Set(FAILURE_CODES).size, FAILURE_CODES.length);
  assert.ok(FAILURE_CODES.includes("unknown"));
  for (const code of FAILURE_CODES) assert.match(code, /^[a-z0-9_]+$/);
});

test("realistic engine and extension failures classify to the right code and params", () => {
  for (const [sample, code, params] of SAMPLES) {
    const result = classifyJobFailure(inputOf(sample));
    const label = JSON.stringify(sample);
    assert.equal(result.code, code, label);
    assert.deepEqual(result.params, params, label);
    assertCleanParams(result.params, label);
  }
});

test("every code has at least one realistic sample", () => {
  const covered = new Set(SAMPLES.map(([, code]) => code));
  const missing = FAILURE_CODES.filter((code) => !covered.has(code));
  assert.deepEqual(missing, []);
});

test("nativeCode and browserReason win over text", () => {
  assert.equal(classifyJobFailure({ text: "HTTP 403 for https://example.tv/…", nativeCode: "host_busy" }).code, "engine_busy");
  assert.equal(classifyJobFailure({ text: "HTTP 403 for https://example.tv/…", browserReason: "NETWORK_TIMEOUT" }).code, "network_timeout");
  assert.equal(classifyJobFailure({ text: "anything", browserReason: "not a reason" }).code, "browser_interrupted");
  assert.deepEqual(classifyJobFailure(), { code: "unknown", params: {} });
});

const CJK = /[⺀-〿㐀-䶿一-鿿豈-﫿＀-￯]/;
const ZH_LATIN_ALLOWED = new Set(["FluxCatch", "Chrome", "Mac", "HTTP", "MP3", "MP4", "Finder", "macOS", "http", "https", "YouTube", "yt-dlp"]);
const JARGON = /FFmpeg|\bHLS\b|\bDASH\b|\brange\b|manifest|native host|\bsegments?\b|protocol|Errno|https?:|undefined|NaN|\bnull\b|[{}<>]|\(s\)/i;

function checkRendered(text, lang, params, context) {
  assert.equal(typeof text, "string", context);
  assert.ok(text.trim().length > 0, `${context}: empty`);
  assert.doesNotMatch(text, JARGON, `${context}: ${text}`);
  if (lang === "en") {
    assert.doesNotMatch(text, CJK, `${context}: CJK in English: ${text}`);
  } else {
    // The host is the one Latin token allowed verbatim (an IPv6 literal such
    // as [2001:db8::1] splits into several "words", so cut it out first).
    const withoutHost = params.host ? text.split(params.host).join(" ") : text;
    for (const word of withoutHost.match(/[A-Za-z][A-Za-z0-9.-]*/g) || []) {
      const clean = word.replace(/\.+$/, "");
      assert.ok(ZH_LATIN_ALLOWED.has(clean), `${context}: Latin word "${clean}" in Chinese: ${text}`);
    }
    assert.doesNotMatch(text.replace(params.host || "\u0000", ""), /[,;()!?]/, `${context}: ASCII punctuation in Chinese: ${text}`);
  }
}

const FULL_PARAMS = {
  status: 403, host: "example.tv", stage: "segment", track: "media", segment: 12, retries: 5,
  seconds: 20, hours: 6, exit_code: 1, feature: "merge"
};
const STAGE_VALUES = ["file", "file_part", "playlist", "segment", "header", "dash_part", "key", "video_track", "audio_track", "merge", "extract_audio", "convert", "package", "plan", undefined];
const FEATURE_VALUES = ["merge", "convert", "extract_audio", "decrypt", undefined];

test("every code renders plain text in English and Chinese", () => {
  for (const code of FAILURE_CODES) {
    const variants = [{}, FULL_PARAMS, { ...FULL_PARAMS, host: "[::1]", track: "audio" }];
    for (const stage of STAGE_VALUES) variants.push({ ...FULL_PARAMS, stage }, { stage, retries: 1 });
    for (const feature of FEATURE_VALUES) variants.push({ feature });
    for (const params of variants) {
      for (const lang of ["en", "zh"]) {
        checkRendered(describeJobFailure({ code, params }, lang), lang, params, `${code} ${lang} ${JSON.stringify(params)}`);
      }
    }
  }
});

test("rendered samples never echo the raw input", () => {
  for (const [sample] of SAMPLES) {
    const input = inputOf(sample);
    const failure = classifyJobFailure(input);
    for (const lang of ["en", "zh"]) {
      const text = describeJobFailure(failure, lang);
      checkRendered(text, lang, failure.params, `${JSON.stringify(sample)} ${lang}`);
      if (input.text && input.text.length > 8) assert.ok(!text.includes(input.text), `${lang} echoes ${input.text}`);
    }
  }
});

test("rendering ignores unknown codes and tampered params", () => {
  const tampered = {
    code: "http_forbidden",
    params: { host: "https://evil.example/?token=secret", status: "403<script>", stage: "{stage}", segment: -4, retries: "NaN", extra: "raw text" }
  };
  for (const lang of ["en", "zh"]) {
    const text = describeJobFailure(tampered, lang);
    assert.doesNotMatch(text, /evil|token|secret|script|raw text|-4/);
    checkRendered(text, lang, {}, `tampered ${lang}`);
  }
  assert.equal(describeJobFailure({ code: "not_a_code" }, "en"), describeJobFailure({ code: "unknown" }, "en"));
  assert.equal(describeJobFailure(null, "zh"), describeJobFailure({ code: "unknown" }, "zh"));
  assert.equal(describeJobFailure({ code: "disk_full" }, "zh-CN"), describeJobFailure({ code: "disk_full" }, "zh"));
});

test("English pluralises retries, seconds and hours", () => {
  const one = describeJobFailure({ code: "segment_failed", params: { stage: "segment", segment: 3, retries: 1 } }, "en");
  assert.match(one, /after 1 retry\./);
  assert.doesNotMatch(one, /retries/);
  const five = describeJobFailure({ code: "segment_failed", params: { stage: "segment", segment: 3, retries: 5 } }, "en");
  assert.match(five, /after 5 retries\./);
  assert.equal(five, "Part 3 of the video couldn't be downloaded after 5 retries. Retry later.");
  assert.match(describeJobFailure({ code: "http_forbidden", params: { retries: 1 } }, "en"), /after 1 retry\./);
  assert.match(describeJobFailure({ code: "transfer_incomplete", params: { retries: 1 } }, "en"), /even after 1 retry\./);
  assert.match(describeJobFailure({ code: "playlist_timeout", params: { seconds: 1 } }, "en"), /within 1 second,/);
  assert.match(describeJobFailure({ code: "playlist_timeout", params: { seconds: 20 } }, "en"), /within 20 seconds,/);
  assert.match(describeJobFailure({ code: "processing_timeout", params: { hours: 1 } }, "en"), /longer than 1 hour,/);
  assert.match(describeJobFailure({ code: "processing_timeout", params: { hours: 6 } }, "en"), /longer than 6 hours,/);
});

test("the review's segment example reads naturally in both languages", () => {
  const failure = classifyJobFailure({ text: "HLS media segment 11 failed: HTTP 403 for https://example.tv/…" });
  assert.equal(
    describeJobFailure(failure, "en"),
    "The site refused to send part 12 of the video (HTTP 403) after 5 retries. Refresh the page, play the video once, then retry."
  );
  assert.equal(
    describeJobFailure(failure, "zh"),
    "网站拒绝提供视频第 12 段（HTTP 403），已重试 5 次。请刷新页面并播放一下视频，再重试。"
  );
});

// ---------------------------------------------------------------------------
// Adversarial records: engine text as host.py raises it, stored through the
// extension's own truncate-then-redact pipeline. background.js hides every
// absolute local path, a save folder on an external drive (/Volumes/…)
// included; classification must survive the placeholder.

const LONG_HOST = "edge-cache-0042-ams-primary-origin-cluster-b.video-delivery-network-europe-west.example-streaming-platform-content.cdn-backbone-secondary.example.tv";
const LONG_TLS_HOST = "video-edge-01.ams3.streaming-cdn.example-media-company.tv";

const STORED_SAMPLES = [
  // Wrapper chains up to three deep.
  ["HLS video segment 0 failed: Network request failed for https://cdn.example.tv/…: [Errno 61] Connection refused", "network_connect_failed",
    { host: "cdn.example.tv", stage: "segment", track: "video", segment: 1, retries: 5 }],
  ["HLS audio segment -1 failed: Network request failed for https://cdn.example.tv/…: timed out", "network_timeout",
    { host: "cdn.example.tv", stage: "header", track: "audio", retries: 5 }],
  ["DASH video track download failed: Range 0-1048575 failed: Network request failed for https://cdn.example.tv:8443/…: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)", "network_tls_failed",
    { host: "cdn.example.tv" }],
  // Cut at 240 characters inside the SSL reason.
  [`DASH video track download failed: Range 104857600-209715199 failed: Network request failed for https://${LONG_TLS_HOST}/…: [SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed: unable to get local issuer certificate (_ssl.c:1006)`, "network_tls_failed",
    { host: LONG_TLS_HOST }],
  // Cut at 240 characters inside the host: no partial host may surface.
  [`DASH audio track download failed: Range 104857600-209715199 failed: Network request failed for https://${LONG_HOST}/…: timed out`, "segment_failed",
    { stage: "audio_track", track: "audio", retries: 3 }],
  ["DASH audio track download failed: Download failed after retries: HTTP 404 for https://cdn.example.tv/…", "http_not_found",
    { status: 404, host: "cdn.example.tv", stage: "audio_track", track: "audio", retries: 3 }],
  ["DASH video track download failed: Network target cdn.example.tv changed address during connection", "connection_changed", { host: "cdn.example.tv" }],
  ["Manifest download failed after retries: Network request failed for https://example.tv/: Tunnel connection failed: 407 Proxy Authentication Required", "network_proxy_failed",
    { host: "example.tv", status: 407 }],
  ["Manifest download failed after retries: 获取播放列表超时(20s): ::1", "playlist_timeout", { host: "[::1]", seconds: 20 }],
  ["HLS media segment 4 failed: Network request failed for https://[2001:db8::1]:8443/…: [Errno 65] No route to host", "network_connect_failed",
    { host: "[2001:db8::1]", stage: "segment", track: "media", segment: 5, retries: 5 }],
  ["Download failed after retries: Network request failed for https://example.tv/…: _ssl.c:989: The handshake operation timed out", "network_timeout",
    { host: "example.tv", stage: "file", retries: 3 }],
  ["DASH resource failed: Network request failed for https://example.tv/…: Remote end closed connection without response", "network_connect_failed",
    { host: "example.tv", stage: "dash_part", retries: 3 }],
  ["Network target 192.168.1.20 is private; enable private-network media explicitly to continue", "private_network_blocked", { host: "192.168.1.20" }],
  ["Network target fd00::12 is private; enable private-network media explicitly to continue", "private_network_blocked", { host: "[fd00::12]" }],
  ["Download failed after retries: Response ended before Content-Length", "transfer_incomplete", { stage: "file", retries: 3 }],
  ["HLS media segment 3 failed: HLS download aborted", "transfer_aborted", {}],
  [`HLS media segment 9 failed: ${HTML_MEDIA_MESSAGE}`, "html_instead_of_media", { stage: "segment", track: "media", segment: 10 }],
  // FFmpeg tails keep newlines and local paths.
  ["DASH audio/video merge failed: FFmpeg failed (234): [mp4 @ 0x7f8a1c00] Could not find tag for codec opus in stream #1, codec not currently supported in container\nError initializing output stream 0:1 --\nConversion failed!", "processing_failed",
    { stage: "merge", exit_code: 234 }],
  ["FFmpeg failed (1): /Users/me/Downloads/FluxCatch/.fluxcatch-convert-abc/source.mp4: Invalid data found when processing input", "processing_failed", { exit_code: 1 }],
  ["FFmpeg failed (1): /Volumes/T7/FluxCatch/fluxcatch-hls-1/joined-media.ts: No space left on device", "disk_full", {}],
  // Local paths are redacted under /Users and /Volumes alike. Folder names
  // such as "fluxcatch-hls-…" or "Period Dramas" must not read as a
  // streaming-format problem (classifyJobFailure also masks quoted paths
  // in records stored before the redaction covered other drives).
  ["[Errno 28] No space left on device: '/Users/me/Downloads/FluxCatch/clip.mp4.part'", "disk_full", {}],
  ["HLS media segment 3 failed: [Errno 28] No space left on device: '/Volumes/T7/FluxCatch/fluxcatch-hls-3f9a2c/media/00000003.ts.tmp'", "disk_full", {}],
  ["HLS media segment 3 failed: [Errno 2] No such file or directory: '/Volumes/T7/FluxCatch/fluxcatch-hls-3f9a2c/media/00000003.ts.tmp'", "folder_unavailable", {}],
  ["DASH resource failed: [Errno 5] Input/output error: '/Volumes/NAS/FluxCatch/fluxcatch-dash-77aa/video/00000012.m4s.tmp'", "disk_write_failed", {}],
  ["[Errno 17] File exists: '/Volumes/NAS/FluxCatch/fluxcatch-dash-77aa'", "disk_write_failed", {}],
  ["[Errno 13] Permission denied: \"/Volumes/Bob's NAS/Period Dramas/FluxCatch/clip.mp4\"", "folder_not_writable", {}],
  ["[Errno 30] Read-only file system: '/Volumes/Disk/FluxCatch/clip.mp4'", "folder_not_writable", {}],
  ["Could not publish output safely: [Errno 18] Cross-device link: '/Volumes/A/x.part' -> '/Volumes/B/x.mp4'", "disk_write_failed", {}],
  // Cut at 240 characters inside the quoted path (no closing quote).
  ["DASH video track download failed: Range 0-1048575 failed: [Errno 28] No space left on device: '/Volumes/Media Drive With A Very Long Name/Downloads/FluxCatch Videos/Season 01 Period Dramas/HLS and DASH tests/fluxcatch-dash-pair-abcdef0123456789/video.m4s'", "disk_full", {}],
  // A type="dynamic" MPD is a live stream.
  [PLANNER("built-in DASH planner supports static MPDs only"), "stream_live", {}],
  [PLANNER("Protected DASH is metadata-only"), "drm_protected", {}],
  // Chinese engine and extension strings.
  ["DASH 视频轨启动前签名链接即将过期，请刷新页面后重试", "link_expiring", {}],
  ["所选清晰度无效，请重新选择", "quality_unavailable", {}],
  ["视频清晰度地址已更新，请重新开始下载", "selection_changed", {}],
  ["浏览器后台已重启，原本地任务状态已失效", "engine_restarted", {}],
  ["   ", "unknown", {}]
];

test("records keep no local folder names: the home folder, other drives, shares and Windows paths", () => {
  const cases = [
    ["[Errno 28] No space left on device: '/Volumes/T7/Period Dramas/clip.mp4.part'", "[Errno 28] No space left on device: <本地路径已隐藏>"],
    ["[Errno 13] Permission denied: \"/Volumes/Bob's NAS/Period Dramas/clip.mp4\"", "[Errno 13] Permission denied: <本地路径已隐藏>"],
    ["FFmpeg failed (1): /Volumes/T7/FluxCatch/fluxcatch-hls-1/joined-media.ts: No space left on device", "FFmpeg failed (1): <本地路径已隐藏>: No space left on device"],
    ["Error writing /Volumes/Media Drive/Season 01/clip.mp4 after 3 tries", "Error writing <本地路径已隐藏>"],
    ["/Network/Servers/nas/Movies/Holiday 2026/a.mp4: Input/output error", "<本地路径已隐藏>"],
    ["/mnt/storage/Movies/a.mp4: Disc quota exceeded", "<本地路径已隐藏>: Disc quota exceeded"],
    ["~/Movies/Secret Project/a.mp4: No such file or directory", "<本地路径已隐藏>: No such file or directory"],
    ["D:\\Movies\\Family\\a.mp4: access denied", "<本地路径已隐藏>: access denied"],
    ["\\\\nas\\share\\Family\\a.mp4 failed", "<本地路径已隐藏>"],
    ["file:///Volumes/T7/Family/a.mp4", "<本地路径已隐藏>"],
    ["无法写入/Volumes/T7/家庭录像/a.mp4", "无法写入<本地路径已隐藏>"],
    ["/Users/me/Movies/a.mp4", "<本地路径已隐藏>"]
  ];
  for (const [raw, stored] of cases) {
    const text = storedNativeText(raw);
    assert.equal(text, stored, raw);
    assert.doesNotMatch(text, /Volumes|T7|Period|Bob|Media Drive|Season|Holiday|Secret|Family|家庭|nas\b|share|Movies/, raw);
  }
  // Text that only looks like a path stays readable.
  for (const plain of ["DASH 分片 3/120", "正在转换格式 · 0:12 / 2:28 · 1.50×", "DASH audio/video merge failed: FFmpeg failed (1): Conversion failed!", "HLS media segment 11 failed: HTTP 403 for https://example.tv/…"]) {
    assert.equal(storedNativeText(plain), plain, plain);
  }
  // A redacted path keeps the failure's code.
  assert.equal(classifyJobFailure({ text: storedNativeText("FFmpeg failed (1): /Volumes/T7/x/joined.ts: No space left on device") }).code, "disk_full");
  assert.equal(classifyJobFailure({ text: storedNativeText("[Errno 17] File exists: '/Volumes/NAS/FluxCatch/fluxcatch-dash-77aa'") }).code, "disk_write_failed");
});

test("the worker's one phrasing for an engine that is not set up", () => {
  assert.equal(describeJobFailure({ code: "engine_not_set_up" }, "en"), "Set up the local engine first.");
  assert.equal(describeJobFailure({ code: "engine_not_set_up" }, "zh"), "请先设置本地引擎。");
  for (const text of ["需要授权连接本地引擎，才能使用此下载模式", "尚未授权连接本地引擎", "需要本地下载引擎权限才能打开文件", "本地下载引擎未连接，请先在设置里开启"]) {
    assert.equal(classifyJobFailure({ text }).code, "engine_not_set_up", text);
  }
  // Rename table: "Allow downloads from my home network"; "Set up", never "permission".
  assert.match(describeJobFailure({ code: "private_network_blocked", params: { host: "nas.local" } }, "en"), /“Allow downloads from my home network”/);
  for (const code of FAILURE_CODES.filter((item) => /^(?:engine_|pause_|component_|mp3_|private_network)/.test(item))) {
    for (const lang of ["en", "zh"]) {
      assert.doesNotMatch(describeJobFailure({ code, params: FULL_PARAMS }, lang), /permission|authori[sz]e|LAN\b|授权|权限/i, `${code} ${lang}`);
    }
  }
});

test("jobFailure cleans params like classifyJobFailure and maps unknown codes to unknown", () => {
  assert.deepEqual(jobFailure("playlist_timeout", { seconds: 12, host: "https://evil.example/?x", extra: "raw" }), { code: "playlist_timeout", params: { seconds: 12 } });
  assert.deepEqual(jobFailure("private_network_blocked", { host: "NAS.local." }), { code: "private_network_blocked", params: { host: "nas.local" } });
  assert.deepEqual(jobFailure("not_a_code", { status: 403 }), { code: "unknown", params: {} });
  assert.deepEqual(jobFailure("file_missing"), { code: "file_missing", params: {} });
});

test("stored records of realistic engine failures classify and render cleanly", () => {
  for (const [raw, code, params] of STORED_SAMPLES) {
    const text = storedNativeText(raw);
    const result = classifyJobFailure({ text });
    const label = JSON.stringify(text);
    assert.equal(result.code, code, label);
    assert.deepEqual(result.params, params, label);
    for (const lang of ["en", "zh"]) {
      const rendered = describeJobFailure(result, lang);
      checkRendered(rendered, lang, result.params, `${label} ${lang}`);
      assert.doesNotMatch(rendered, /Volumes|Bob|Period|fluxcatch-|edge-cache|secondary|本地路径/, `${label} ${lang}: ${rendered}`);
    }
  }
  // The truncated-host and truncated-path samples really are cut.
  assert.ok(STORED_SAMPLES.filter(([raw]) => raw.length > 240).length >= 3);
  // Redacted and placeholder URLs carry no host.
  assert.deepEqual(classifyJobFailure({ text: "Network request failed for <链接已隐藏> timed out" }), { code: "network_timeout", params: {} });
  assert.deepEqual(classifyJobFailure({ text: "Network request failed for [redacted URL]: [Errno 61] Connection refused" }), { code: "network_connect_failed", params: {} });
});

// developer.chrome.com/docs/extensions/reference/api/downloads, enum
// InterruptReason (checked 2026-10-21).
const CHROME_INTERRUPT_REASONS = [
  "FILE_FAILED", "FILE_ACCESS_DENIED", "FILE_NO_SPACE", "FILE_NAME_TOO_LONG", "FILE_TOO_LARGE",
  "FILE_VIRUS_INFECTED", "FILE_TRANSIENT_ERROR", "FILE_BLOCKED", "FILE_SECURITY_CHECK_FAILED",
  "FILE_TOO_SHORT", "FILE_HASH_MISMATCH", "FILE_SAME_AS_SOURCE",
  "NETWORK_FAILED", "NETWORK_TIMEOUT", "NETWORK_DISCONNECTED", "NETWORK_SERVER_DOWN", "NETWORK_INVALID_REQUEST",
  "SERVER_FAILED", "SERVER_NO_RANGE", "SERVER_BAD_CONTENT", "SERVER_UNAUTHORIZED", "SERVER_CERT_PROBLEM",
  "SERVER_FORBIDDEN", "SERVER_UNREACHABLE", "SERVER_CONTENT_LENGTH_MISMATCH", "SERVER_CROSS_ORIGIN_REDIRECT",
  "USER_CANCELED", "USER_SHUTDOWN", "CRASH"
];

test("every documented Chrome interruption reason has its own code, as a field or as stored text", () => {
  for (const reason of CHROME_INTERRUPT_REASONS) {
    const fromField = classifyJobFailure({ browserReason: reason });
    // updateBrowserDownload stores the reason itself as the record text.
    const fromText = classifyJobFailure({ text: storedNativeText(reason) });
    assert.notEqual(fromField.code, "browser_interrupted", reason);
    assert.deepEqual(fromText, fromField, reason);
  }
});

test("classifyJobFailure tolerates missing or malformed input", () => {
  for (const input of [undefined, null, "HTTP 403", 42, { text: null }, { text: 403 }, { status: null }]) {
    assert.deepEqual(classifyJobFailure(input), { code: "unknown", params: {} }, JSON.stringify(input));
  }
  assert.deepEqual(classifyJobFailure({ status: "paused", text: "HLS media segment 1 failed: HTTP 403 for https://example.tv/…" }), { code: "paused", params: {} });
});

// ---------------------------------------------------------------------------
// Drift guard: every failure template the engine can raise must classify.

const ERROR_CONSTRUCTORS = [
  "DownloadError",
  "UnsupportedDashError",
  "NetworkPolicyError",
  "NetworkPolicyDownloadError",
  "HtmlMediaResponseError",
  "ManifestFetchDeadlineExceeded",
  "OSError"
];

// Templates that cannot reach a job record, keyed by their source form.
const UNREACHABLE_TEMPLATES = new Map([
  // probe_ffmpeg / probe_ytdlp catch these and keep them as probe_error;
  // they describe the installation, never a job.
  ["version probe exited {version_result.returncode}", "capability probe only"],
  ["demuxer probe exited {demuxer_result.returncode}", "capability probe only"],
  ["encoder probe exited {encoder_result.returncode}", "capability probe only"],
  // validate_download_dir: resolve_download_dir swallows these and the
  // folder picker reports them in a file_action_result, not a job.
  ["Folder path is invalid", "folder picker reply only"],
  ["Folder path must be absolute", "folder picker reply only"],
  ["Symlinked folders are not accepted", "folder picker reply only"],
  ["Folder path is reserved", "folder picker reply only"],
  ["Folder path is not a directory", "folder picker reply only"],
  ["Folder is not writable", "folder picker reply only"],
  ["Folder dialog failed", "folder picker reply only"],
  // Finder actions (move_to_trash, run_opener, managed_path,
  // handle_file_action) answer with a file_action_result.
  ["Trash folder is unavailable", "file action reply only"],
  ["Could not allocate a Trash filename", "file action reply only"],
  ["Could not hand the file to macOS", "file action reply only"],
  ["macOS could not open the file", "file action reply only"],
  ["Path is invalid", "file action reply only"],
  ["Path must be absolute", "file action reply only"],
  ["Symlinks are not managed", "file action reply only"],
  ["File no longer exists", "file action reply only"],
  ["Path is outside the download folder", "file action reply only"],
  ["Path is not a file", "file action reply only"],
  ["Path is not a regular file", "file action reply only"],
  ["Unfinished files cannot be opened", "file action reply only"],
  ["Unknown file action", "file action reply only"],
  // read_messages: framing errors end the host process with a stderr line.
  ["Truncated native message header", "host exits; stderr only"],
  ["Native message is empty", "host exits; stderr only"],
  ["Native message exceeds 1 MiB", "host exits; stderr only"],
  ["Truncated native message", "host exits; stderr only"],
  ["Native message must be an object", "host exits; stderr only"],
  // Dict-literal replies that never become a job record: nativeJobStatus in
  // background.js ignores {"type": "error"} messages, and the folder picker
  // answers with a file_action_result.
  ["Host message exceeded 1 MiB", "type \"error\" reply; no job"],
  ["Unknown request type", "type \"error\" reply; no job"],
  // ExternalToolBroker._dial: the broker answers the tool's CONNECT with a
  // 502; the job sees yt-dlp's own text, never these.
  ["Unsupported system proxy", "broker CONNECT reply only"],
  ["System proxy closed the CONNECT", "broker CONNECT reply only"],
  ["System proxy refused the CONNECT", "broker CONNECT reply only"],
  ["Could not connect to authorized network target {host}", "broker CONNECT reply only"],
  ["Duplicate job ID", "type \"error\" reply; no job"],
  ["cancelled", "folder picker reply only"]
]);

// A cause no rule recognises: a wrapper must classify on its own.
const UNCLASSIFIED_CAUSE = "'NoneType' object has no attribute 'read'";

// Sample values for every placeholder expression found in an engine template.
const PLACEHOLDER_SAMPLES = {
  "version_result.returncode": ["1"],
  "demuxer_result.returncode": ["1"],
  "encoder_result.returncode": ["1"],
  phase: ["任务开始", "视频轨启动", "音频轨启动"],
  hostname: ["media.example.tv", "localhost"],
  "target.hostname": ["media.example.tv"],
  host_name: ["media.example.tv", "unknown"],
  MANIFEST_FETCH_TIMEOUT_SECONDS: ["20"],
  "redact_url(safe_url)": ["https://media.example.tv/…", "https://media.example.tv/", "[redacted URL]"],
  code: ["401", "403", "404", "410", "412", "416", "429", "451", "500", "503"],
  "redact_text(reason)": [
    UNCLASSIFIED_CAUSE,
    "[Errno 61] Connection refused",
    "timed out",
    "[SSL: CERTIFICATE_VERIFY_FAILED] certificate verify failed (_ssl.c:1006)",
    "Tunnel connection failed: 403 Forbidden",
    "No authorized network target is active"
  ],
  last_error: [UNCLASSIFIED_CAUSE, "HTTP 403 for https://media.example.tv/…", "The read operation timed out", "[Errno 28] No space left on device"],
  error: [UNCLASSIFIED_CAUSE, "HTTP 403 for https://media.example.tv/…", "FFmpeg failed (1): Conversion failed!"],
  key: ["0-1048575"],
  "response.status": ["206", "302"],
  value: ["P1Y2M"],
  name: ["SegmentTimeline duration", "startNumber"],
  template: ["$Bandwidth%08d$"],
  "kind or 'unknown'": ["text", "unknown"],
  kind: ["video", "audio"],
  detail: [UNCLASSIFIED_CAUSE, "unsupported DASH template token in '$Time%05d$'", "built-in DASH planner requires exactly one Period"],
  identity: ["FFmpeg", "/opt/homebrew/bin/ffmpeg (version 7.1)"],
  label: ["video", "audio"],
  index: ["11", "0", "-1"],
  "len(key_bytes)": ["0", "32"],
  scope: ["HLS", "audio HLS"],
  VERSION: ["0.2.5"],
  "self.ffmpeg": ["/opt/homebrew/bin/ffmpeg"],
  "proc.returncode": ["1", "-9"],
  "redact_text(tail.strip())": ["Conversion failed!", UNCLASSIFIED_CAUSE],
  tool: ["FFmpeg", "yt-dlp"]
};
// Placeholder values that depend on the template they appear in.
const TEMPLATE_SAMPLES = [
  { when: /^HLS \{label\} segment/, samples: { label: ["media", "video", "audio"] } }
];

function isIdentifierChar(character) {
  return /[A-Za-z0-9_]/.test(character || "");
}

function decodePython(body) {
  return body.replace(/\\(.)/gs, (all, character) => ({ n: "\n", t: "\t", "\\": "\\", "'": "'", '"': '"' })[character] ?? all);
}

function readStringLiteral(source, index) {
  const match = /^([rRbBfFuU]{0,2})('''|"""|'|")/.exec(source.slice(index, index + 5));
  if (!match || (match[1] && isIdentifierChar(source[index - 1]))) return null;
  const quote = match[2];
  let cursor = index + match[0].length;
  const bodyStart = cursor;
  while (cursor < source.length) {
    if (source[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (source.startsWith(quote, cursor)) break;
    if (quote.length === 1 && source[cursor] === "\n") throw new Error(`Unterminated string at ${index}`);
    cursor += 1;
  }
  const prefix = match[1].toLowerCase();
  const body = source.slice(bodyStart, cursor);
  return {
    part: { text: prefix.includes("r") ? body : decodePython(body), formatted: prefix.includes("f") },
    end: cursor + quote.length
  };
}

// Literal groups passed at the top level of one constructor call; adjacent
// literals concatenate as in Python.
function readCallLiterals(source, start) {
  const groups = [];
  let depth = 1;
  let cursor = start;
  let current = null;
  while (cursor < source.length && depth > 0) {
    const literal = readStringLiteral(source, cursor);
    if (literal) {
      if (depth === 1) {
        if (!current) {
          current = [];
          groups.push(current);
        }
        current.push(literal.part);
      } else {
        current = null;
      }
      cursor = literal.end;
      continue;
    }
    const character = source[cursor];
    if (character === "#") {
      cursor = source.indexOf("\n", cursor);
      if (cursor < 0) cursor = source.length;
      continue;
    }
    if (!/\s/.test(character)) {
      current = null;
      if ("([{".includes(character)) depth += 1;
      else if (")]}".includes(character)) depth -= 1;
    }
    cursor += 1;
  }
  return groups;
}

// Split an f-string into literal text and placeholder expressions.
function templatePieces(parts) {
  const pieces = [];
  const pushText = (text) => {
    if (!text) return;
    const last = pieces.at(-1);
    if (last && last.text !== undefined) last.text += text;
    else pieces.push({ text });
  };
  for (const part of parts) {
    if (!part.formatted) {
      pushText(part.text);
      continue;
    }
    const text = part.text;
    let cursor = 0;
    while (cursor < text.length) {
      if (text.startsWith("{{", cursor) || text.startsWith("}}", cursor)) {
        pushText(text[cursor]);
        cursor += 2;
        continue;
      }
      if (text[cursor] !== "{") {
        pushText(text[cursor]);
        cursor += 1;
        continue;
      }
      let depth = 1;
      let end = cursor + 1;
      let quote = "";
      for (; end < text.length && depth > 0; end += 1) {
        const character = text[end];
        if (quote) {
          if (character === quote) quote = "";
        } else if (character === "'" || character === '"') {
          quote = character;
        } else if ("([{".includes(character)) {
          depth += 1;
        } else if (")]}".includes(character)) {
          depth -= 1;
        }
      }
      let expression = text.slice(cursor + 1, end - 1).trim();
      let conversion = "";
      const converted = /^(.*?)!([rsa])(?::.*)?$/s.exec(expression);
      if (converted) {
        expression = converted[1].trim();
        conversion = converted[2];
      } else {
        const formatted = /^([^:'"[\]()]*?):[^:]*$/.exec(expression);
        if (formatted) expression = formatted[1].trim();
      }
      pieces.push({ expression, conversion });
      cursor = end;
    }
  }
  return pieces;
}

function sourceForm(pieces) {
  return pieces.map((piece) => (piece.text !== undefined ? piece.text : `{${piece.expression}}`)).join("");
}

function pythonRepr(value) {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function expand(pieces, form) {
  const overrides = TEMPLATE_SAMPLES.filter((entry) => entry.when.test(form)).map((entry) => entry.samples);
  let instances = [""];
  const missing = [];
  for (const piece of pieces) {
    if (piece.text !== undefined) {
      instances = instances.map((instance) => instance + piece.text);
      continue;
    }
    const override = overrides.find((samples) => samples[piece.expression]);
    const values = override?.[piece.expression] || PLACEHOLDER_SAMPLES[piece.expression];
    if (!values) {
      missing.push(piece.expression);
      continue;
    }
    const rendered = values.map((value) => (piece.conversion === "r" ? pythonRepr(value) : value));
    instances = instances.flatMap((instance) => rendered.map((value) => instance + value)).slice(0, 256);
  }
  return { instances, missing };
}

function extractTemplates(source, file) {
  const templates = [];
  let passThrough = 0;
  const pattern = new RegExp(`\\b(${ERROR_CONSTRUCTORS.join("|")})\\(`, "g");
  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1;
    if (/^\s*class\s/.test(source.slice(lineStart, match.index))) continue;
    const line = source.slice(0, match.index).split("\n").length;
    const groups = readCallLiterals(source, match.index + match[0].length);
    if (!groups.length) passThrough += 1;
    for (const parts of groups) {
      const pieces = templatePieces(parts);
      templates.push({ file, line, constructor: match[1], pieces, form: sourceForm(pieces) });
    }
  }
  // Failures the engine sends as dict literals ({"type": "failed", "error":
  // "…"}) never pass through a constructor; scan those values too.
  const errorKey = /"error"\s*:\s*/g;
  for (let match = errorKey.exec(source); match; match = errorKey.exec(source)) {
    const literal = readStringLiteral(source, match.index + match[0].length);
    if (!literal) continue;
    const line = source.slice(0, match.index).split("\n").length;
    const pieces = templatePieces([literal.part]);
    templates.push({ file, line, constructor: '"error" value', pieces, form: sourceForm(pieces) });
  }
  return { templates, passThrough };
}

function engineTemplates(sources) {
  const templates = [];
  let passThrough = 0;
  for (const [file, source] of Object.entries(sources)) {
    const found = extractTemplates(source, file);
    templates.push(...found.templates);
    passThrough += found.passThrough;
    const html = /^HTML_MEDIA_MESSAGE = "([^"]*)"$/m.exec(source);
    if (html) {
      const line = source.slice(0, html.index).split("\n").length;
      templates.push({ file, line, constructor: "HTML_MEDIA_MESSAGE", pieces: [{ text: html[1] }], form: html[1] });
    }
  }
  return { templates, passThrough };
}

function driftFailures(templates) {
  const failures = [];
  for (const template of templates) {
    if (UNREACHABLE_TEMPLATES.has(template.form)) continue;
    const { instances, missing } = expand(template.pieces, template.form);
    const where = `${template.file}:${template.line} ${template.constructor}("${template.form}")`;
    if (missing.length) {
      failures.push(`${where}: add a sample for placeholder(s) ${missing.join(", ")}`);
      continue;
    }
    for (const instance of instances) {
      for (const text of [instance, redactJobText(instance, 240)]) {
        const result = classifyJobFailure({ text });
        if (result.code === "unknown") failures.push(`${where}: "${text}" classifies as unknown`);
      }
    }
  }
  return failures;
}

const ENGINE_SOURCES = {
  "native-host/host.py": HOST_PY,
  "native-host/fluxcatch_network_policy.py": POLICY_PY
};

test("drift guard: every engine failure template classifies to a known code", (t) => {
  assert.equal(classifyJobFailure({ text: UNCLASSIFIED_CAUSE }).code, "unknown", "the unclassified probe cause must stay unknown");
  const { templates, passThrough } = engineTemplates(ENGINE_SOURCES);
  // A broken extractor must not pass silently.
  assert.ok(templates.length >= 180, `only ${templates.length} templates extracted`);
  assert.ok(templates.some((template) => template.constructor === "HTML_MEDIA_MESSAGE"));
  assert.ok(templates.some((template) => template.form === "HLS {label} segment {index} failed: {last_error}"));
  assert.ok(templates.some((template) => template.form.startsWith("Network target {hostname} is private;")));

  const failures = driftFailures(templates);
  assert.deepEqual(failures, [], `Unclassified engine failure text:\n${failures.join("\n")}`);

  const forms = new Set(templates.map((template) => template.form));
  const stale = [...UNREACHABLE_TEMPLATES.keys()].filter((form) => !forms.has(form));
  assert.deepEqual(stale, [], "allowlisted templates no longer exist in the engine; remove them");

  const allowlisted = templates.filter((template) => UNREACHABLE_TEMPLATES.has(template.form)).length;
  t.diagnostic(`templates: ${templates.length} (${new Set(templates.map((template) => template.form)).size} distinct), classified: ${templates.length - allowlisted}, allowlisted: ${allowlisted}, pass-through calls without a literal: ${passThrough}`);
});

test("drift guard fails on a new, unmapped engine message", () => {
  const fake = {
    "fake.py": [
      "class DownloadError(Exception):",
      "    pass",
      "raise DownloadError(\"Brand-new engine failure nobody mapped yet\")",
      "raise UnsupportedDashError(",
      "    f\"Fresh structure {kind_name} \"",
      "    \"is odd\"",
      ")",
      "self.send({\"type\": \"failed\", \"jobId\": job_id, \"error\": \"Dict-literal failure nobody mapped\"})",
      "self.send({\"type\": \"failed\", \"jobId\": job_id, \"error\": detail})"
    ].join("\n")
  };
  const { templates } = engineTemplates(fake);
  assert.deepEqual(templates.map((template) => template.form), [
    "Brand-new engine failure nobody mapped yet",
    "Fresh structure {kind_name} is odd",
    "Dict-literal failure nobody mapped"
  ]);
  const failures = driftFailures(templates);
  // The raw text and its redacted form both fail, plus the missing sample.
  assert.equal(failures.filter((line) => /Brand-new engine failure.*classifies as unknown/.test(line)).length, 2);
  assert.equal(failures.filter((line) => /Dict-literal failure.*classifies as unknown/.test(line)).length, 2);
  assert.equal(failures.filter((line) => /add a sample for placeholder\(s\) kind_name/.test(line)).length, 1);
  assert.equal(failures.length, 5);
});

// ---------------------------------------------------------------------------
// Progress text

test("describeJobActivity localises the engine's progress text", () => {
  const cases = [
    ["分片 31/50", "Part 31 of 50", "第 31/50 段"],
    ["DASH 分片 3/120", "Part 3 of 120", "第 3/120 段"],
    ["视频片段 7/9", "Part 7 of 9", "第 7/9 段"],
    ["正在获取播放列表", "Getting video info…", "正在读取视频信息…"],
    ["正在探测媒体", "Checking the file…", "正在检查文件…"],
    ["正在下载视频轨", "Downloading picture", "正在下载画面"],
    ["正在下载音频轨", "Downloading sound", "正在下载声音"],
    ["正在合并 DASH 音视频", "Joining picture and sound", "正在合并画面和声音"],
    ["正在无损合并 HLS 音视频", "Joining picture and sound", "正在合并画面和声音"],
    ["正在无损合并 DASH 音视频 · 1:02 / 4:10 · 3.20×", "Joining picture and sound · 1:02 of 4:10", "正在合并画面和声音 · 1:02 / 4:10"],
    ["正在无损封装", "Finishing the file", "正在生成最终文件"],
    ["正在转换格式", "Converting the file", "正在转换格式"],
    ["正在转换格式 · 0:12 / 2:28 · 1.50×", "Converting the file · 0:12 of 2:28", "正在转换格式 · 0:12 / 2:28"],
    ["正在提取音频 · 已处理 1:05:09", "Extracting audio · 1:05:09 done", "正在提取音频 · 已处理 1:05:09"],
    ["正在从本地媒体提取音频", "Extracting audio", "正在提取音频"],
    ["正在处理媒体 · 2.00×", "Processing the file", "正在处理文件"],
    [QUEUED_MESSAGE, "Waiting to start", "等待开始"],
    ["等待本地引擎", "Waiting to start", "等待开始"],
    ["正在暂停…", "Pausing…", "正在暂停…"],
    [PAUSED_MESSAGE, "Paused", "已暂停"],
    ["浏览器正在下载", "Downloading", "正在下载"],
    ["Something the engine has never said", "Downloading…", "正在下载…"]
  ];
  for (const [message, en, zh] of cases) {
    assert.equal(describeJobActivity(message, "en"), en, message);
    assert.equal(describeJobActivity(message, "zh"), zh, message);
    assert.doesNotMatch(en, CJK, message);
    assert.doesNotMatch(`${en} ${zh}`, /DASH|HLS|FFmpeg|×/, message);
  }
  assert.equal(describeJobActivity("", "en"), null);
  assert.equal(describeJobActivity("   ", "zh"), null);
  assert.equal(describeJobActivity(undefined, "en"), null);
});

test("segmentsFromActivity reads part counts", () => {
  assert.deepEqual(segmentsFromActivity("分片 31/50"), { done: 31, total: 50 });
  assert.deepEqual(segmentsFromActivity("DASH 分片 3/120"), { done: 3, total: 120 });
  assert.deepEqual(segmentsFromActivity("视频片段 0/9"), { done: 0, total: 9 });
  assert.equal(segmentsFromActivity("分片 3/0"), null);
  assert.equal(segmentsFromActivity("分片 9/3"), null);
  assert.equal(segmentsFromActivity("正在转换格式 · 0:12 / 2:28"), null);
  assert.equal(segmentsFromActivity(""), null);
  assert.equal(segmentsFromActivity(null), null);
});

// errors.js no longer translates raw Chinese text (ui/i18n.js is gone): every
// Chinese error the worker or the engine can hand a page must carry a code or
// classify to one. This scan keeps it that way: a new Chinese literal that is
// neither classified nor engine activity fails here until it gets a code.
test("every Chinese error text the worker, the engine and lib/ emit classifies to a known code", async () => {
  const { readdirSync } = await import("node:fs");
  const root = new URL("../", import.meta.url);
  const lib = readdirSync(new URL("extension/lib/", root)).filter((file) => file.endsWith(".js") && !["job-failure.js", "job-presentation.js"].includes(file)).map((file) => `extension/lib/${file}`);
  // Not error text: redaction placeholders, the folder picker's title, the
  // names composed into longer messages (checked whole below), activity the
  // rows show through describeJobActivity, and the tail of a two-line message.
  const NOT_ERRORS = new Set([
    "<链接已隐藏>", "Bearer <已隐藏>", "$1=<已隐藏>", "<本地路径已隐藏>", "<无效地址>",
    "选择 FluxCatch 的保存位置",
    "视频轨", "音频轨", "文本大小", "行数", "引用 URL 总长度", "媒体轨道数量", "密钥引用数量", "变体数量", "分片数量",
    "正在下载20", "视频轨启动", "音频轨启动", " · 已处理 20", "任务开始",
    "正在启动 YouTube 引擎", "正在通过 YouTube 引擎下载", "20 · 分片 20/20",
    "此媒体结构需要后续 pinned broker 支持"
  ]);
  const left = [];
  for (const file of ["extension/background.js", "native-host/host.py", ...lib]) {
    for (const line of readFileSync(new URL(file, root), "utf8").split("\n")) {
      if (/^\s*(\/\/|#|\*)/.test(line)) continue;
      for (const match of line.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\]|\\.)*)`/g)) {
        const text = (match[1] ?? match[2]).replace(/\$\{[^}]*\}|\{[^{}]*\}/g, "20");
        if (!/[㐀-鿿]/.test(text) || NOT_ERRORS.has(text)) continue;
        if (classifyJobFailure({ text }).code !== "unknown") continue;
        if (describeJobActivity(text, "en") !== "Downloading…") continue;
        left.push(`${file}: ${text}`);
      }
    }
  }
  assert.deepEqual(left, [], "Chinese text with no code: add a classification rule or send a code");
  // Messages composed from the pieces above, as the engine and lib/ build them.
  for (const [text, code] of [
    ...["文本大小", "行数", "引用 URL 总长度", "媒体轨道数量", "密钥引用数量", "变体数量", "分片数量"].map((kind) => [`HLS 播放列表超过${kind}上限`, "stream_unsupported"]),
    ["这不是有效的 HLS 播放列表", "stream_unsupported"],
    ["这不是有效的 DASH MPD", "stream_unsupported"],
    ["网络策略已阻止 https://nas.local/a.m3u8（blocked_private）", "private_network_blocked"],
    ["获取播放列表超时(20s): https://example.com/a.m3u8", "playlist_timeout"],
    ["yt-dlp 直接联网已由安全策略关闭；请使用内置受控下载路径。此媒体结构需要后续 pinned broker 支持", "external_tool_disabled"]
  ]) {
    assert.equal(classifyJobFailure({ text }).code, code, text);
  }
  // Every uncoded Error the worker builds is English plumbing (HTTP status), never Chinese copy.
  const worker = readFileSync(new URL("extension/background.js", root), "utf8");
  for (const match of worker.matchAll(/new Error\(([^)]*)\)/g)) assert.ok(!/[㐀-鿿]/.test(match[1]), match[0]);
});
