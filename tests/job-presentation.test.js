import test from "node:test";
import assert from "node:assert/strict";
import { friendlyDashMessage } from "../extension/lib/job-presentation.js";

test("DASH presentation separates retryable failures from unsupported structures", () => {
  const cases = [
    ["DASH 视频轨启动前签名链接已过期，请刷新页面后重试", /视频链接已过期/],
    ["DASH 音频轨启动前签名链接即将过期，请刷新页面后重试", /视频链接即将过期/],
    ["DASH video track download failed: HTTP Error 403: Forbidden", /视频画面下载失败/],
    ["DASH audio track download failed: HTTP Error 412: Precondition Failed", /视频声音下载失败/],
    ["DASH audio\/video merge failed: fixture", /画面与声音合并失败/],
    ["DASH audio extraction failed: fixture", /音频提取失败/],
    ["DASH resource failed: fixture", /视频片段下载失败/],
    ["Invalid DASH MPD", /视频清单无效/],
    ["DASH pair is missing an audio URL", /视频信息不完整/]
  ];
  for (const [raw, expected] of cases) {
    const visible = friendlyDashMessage(raw, { failed: true });
    assert.match(visible, expected);
    assert.doesNotMatch(visible, /这种流媒体暂不支持下载/);
  }
});

test("DASH presentation reserves unsupported wording for protected or unsupported structures", () => {
  assert.match(friendlyDashMessage("Protected DASH is metadata-only", { failed: true }), /受保护内容暂不支持/);
  assert.match(
    friendlyDashMessage("The pinned built-in static DASH planner could not handle this MPD: requires exactly one Period", { failed: true }),
    /尚未支持的流媒体结构/
  );
  assert.match(
    friendlyDashMessage("the selected DASH MPD has no audio Representation", { failed: true }),
    /尚未支持的流媒体结构/
  );
  assert.equal(friendlyDashMessage("ordinary download failure", { failed: true }), null);
});

test("DASH progress wording removes transport jargon without duplicating text", () => {
  assert.equal(friendlyDashMessage("正在无损合并 DASH 音视频"), "正在无损合并音视频");
  assert.equal(friendlyDashMessage("DASH 分片 3/8"), "视频片段 3/8");
});
