function normalizedMessage(value) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim()
    : "";
}

function progressMessage(raw) {
  if (/正在无损合并\s+DASH\s+音视频/i.test(raw)) return "正在无损合并音视频";
  if (/DASH\s+分片/i.test(raw)) return raw.replace(/DASH\s+分片/gi, "视频片段");
  return raw.replace(/\bDASH(?:\s+pair)?\b\s*/gi, "").trim() || "正在处理视频";
}

/**
 * Present native DASH status without turning every transfer failure into an
 * unsupported-format claim. Native job text is already redacted before it
 * reaches extension pages; this mapper intentionally publishes only fixed,
 * action-oriented wording rather than echoing host-defined details.
 */
export function friendlyDashMessage(value, { failed = false } = {}) {
  const raw = normalizedMessage(value);
  if (!raw || !/\bDASH\b/i.test(raw)) return null;
  if (!failed) return progressMessage(raw);

  if (/签名链接已过期/i.test(raw)) {
    return "视频链接已过期，请刷新页面并重新播放后再下载";
  }
  if (/签名链接即将过期/i.test(raw)) {
    return "视频链接即将过期，请刷新页面并重新播放后再下载";
  }
  if (/expiresAt is invalid|missing an audio URL|video and audio URLs must be different|output must use the MP4 container/i.test(raw)) {
    return "检测到的视频信息不完整，请重新扫描后再下载";
  }
  if (/audio\/video merge failed/i.test(raw)) {
    return "画面与声音合并失败，请确认本地下载引擎已就绪后重试";
  }
  if (/audio extraction failed/i.test(raw)) {
    return "音频提取失败，请确认本地下载引擎已就绪后重试";
  }
  if (/video track download failed/i.test(raw)) {
    return "视频画面下载失败，请刷新页面并重新播放后重试";
  }
  if (/audio track download failed/i.test(raw)) {
    return "视频声音下载失败，请刷新页面并重新播放后重试";
  }
  if (/resource failed|unexpected .*response status|response ended early|download aborted/i.test(raw)) {
    return "视频片段下载失败，请刷新页面并重新播放后重试";
  }
  if (/invalid DASH MPD|invalid DASH (?:byte range|SegmentTimeline|template|representation)/i.test(raw)) {
    return "视频清单无效或已经过期，请刷新页面后重试";
  }
  if (/protected DASH|metadata-only|\bDRM\b/i.test(raw)) {
    return "检测到 DRM/内容保护，受保护内容暂不支持下载";
  }
  if (/could not handle this MPD|supports static MPDs only|requires exactly one Period|external DASH xlink|unsupported DASH|track is unsupported|no usable .*Representation|no (?:audio|video) Representation|no audio\/video Representations|segment limit|SegmentTemplate|SegmentList|template token/i.test(raw)) {
    return "这个视频使用了当前版本尚未支持的流媒体结构";
  }
  return "视频下载失败，请重新扫描后重试";
}
