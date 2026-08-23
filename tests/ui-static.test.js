import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

const popupHtml = readFileSync(new URL("../extension/popup/popup.html", import.meta.url), "utf8");
const popupCss = readFileSync(new URL("../extension/popup/popup.css", import.meta.url), "utf8");
const popupJs = readFileSync(new URL("../extension/popup/popup.js", import.meta.url), "utf8");
const optionsHtml = readFileSync(new URL("../extension/options/options.html", import.meta.url), "utf8");
const optionsCss = readFileSync(new URL("../extension/options/options.css", import.meta.url), "utf8");
const optionsJs = readFileSync(new URL("../extension/options/options.js", import.meta.url), "utf8");
const sidepanelHtml = readFileSync(new URL("../extension/sidepanel/sidepanel.html", import.meta.url), "utf8");
const sidepanelCss = readFileSync(new URL("../extension/sidepanel/sidepanel.css", import.meta.url), "utf8");
const sidepanelJs = readFileSync(new URL("../extension/sidepanel/sidepanel.js", import.meta.url), "utf8");
const tokensCss = readFileSync(new URL("../extension/ui/tokens.css", import.meta.url), "utf8");
const componentsCss = readFileSync(new URL("../extension/ui/components.css", import.meta.url), "utf8");

test("all extension surfaces load shared tokens and components before page styles", () => {
  for (const [html, pageStylesheet] of [
    [optionsHtml, "options.css"],
    [popupHtml, "popup.css"],
    [sidepanelHtml, "sidepanel.css"]
  ]) {
    const tokensIndex = html.indexOf('href="../ui/tokens.css"');
    const componentsIndex = html.indexOf('href="../ui/components.css"');
    const pageIndex = html.indexOf(`href="${pageStylesheet}"`);
    assert.ok(tokensIndex >= 0, `${pageStylesheet} page loads shared tokens`);
    assert.ok(tokensIndex < componentsIndex && componentsIndex < pageIndex,
      `${pageStylesheet} loads tokens, components and page styles in order`);
  }
});

test("options fields retain programmatic labels and keyboard-focusable switches", () => {
  for (const id of [
    "concurrentFragments",
    "concurrentRanges",
    "outputContainer",
    "minimumKiB",
    "filenameTemplate",
    "blockedDomains"
  ]) {
    assert.match(optionsHtml, new RegExp(`<label\\s+for="${id}">`));
    assert.match(optionsHtml, new RegExp(`<(?:input|select|textarea)\\s+id="${id}"`));
  }
  const switchRule = componentsCss.match(/\.opt-check input\s*\{([^}]+)\}/)?.[1] || "";
  assert.doesNotMatch(switchRule, /display\s*:\s*none/);
  assert.match(switchRule, /opacity\s*:\s*0/);
  assert.match(componentsCss, /\.opt-check input:focus-visible\s*\+\s*\.switch/);
  assert.match(optionsHtml, /id="nativePermissionButton"/);
  assert.match(optionsHtml, /id="nativePermissionStatus"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(optionsJs, /chrome\.permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\)/);
  assert.match(optionsJs, /type: "PING_HOST"/);
});

test("download settings explain their effect in user-facing language", () => {
  const fields = [
    ["concurrentFragments", "concurrentFragmentsHelp", "HLS 视频片段并发数", /同时获取的视频片段数量，允许 1–24/],
    ["concurrentRanges", "concurrentRangesHelp", "直接文件 Range 并发数", /大文件分段同时获取的数量，允许 1–24/],
    ["outputContainer", "outputContainerHelp", "默认保存格式", /推荐 MP4，兼容性最好；合并流媒体或转换格式时生效/]
  ];
  for (const [id, helperId, label, helper] of fields) {
    assert.match(optionsHtml, new RegExp(`<label\\s+for="${id}">${label}</label>`));
    assert.match(optionsHtml, new RegExp(`<(?:input|select)\\s+id="${id}"[^>]+aria-describedby="${helperId}`));
    assert.match(optionsHtml, new RegExp(`<p\\s+id="${helperId}"\\s+class="field-help">[^<]+</p>`));
    assert.match(optionsHtml, helper);
  }
  assert.doesNotMatch(optionsHtml, /HLS 分片并发数|直接文件连接数|流媒体同时下载数量|大文件同时连接数量|大文件使用多连接加速|默认容器|直播录制时长（秒，0 为手动）/);
  assert.match(optionsHtml, /每次下载前选择保存位置/);
  assert.match(optionsHtml, /自动加速大文件/);
  assert.match(optionsHtml, /源站支持 Range.*高速下载功能可用/);
  assert.match(optionsHtml, /下载完成或失败时提醒我/);
  assert.match(optionsHtml, /id="allowPrivateNetworkMedia"/);
  assert.match(optionsHtml, /允许访问局域网媒体/);
  assert.match(optionsHtml, /云 metadata、link-local、multicast、unspecified 与 reserved 目标/);
  assert.match(optionsHtml, /id="autoEnrichSiteQuality"/);
  assert.match(optionsHtml, /自动补全支持站点的画质/);
  assert.match(optionsHtml, /使用当前站点登录会话，请求代码中固定的播放信息接口/);
  assert.match(optionsJs, /allowPrivateNetworkMedia: privateNetworkInput\.checked/);
  assert.match(optionsJs, /autoEnrichSiteQuality: form\.elements\.namedItem\("autoEnrichSiteQuality"\)\.checked/);
  assert.match(optionsJs, /allowPrivateNetworkMedia: normalized\.allowPrivateNetworkMedia/);
  assert.match(optionsJs, /autoEnrichSiteQuality: normalized\.autoEnrichSiteQuality/);
  assert.match(optionsJs, /liveDuration: 0/);
  assert.match(optionsJs, /import \{ BUILD_PROFILE, HOST_MISMATCH_MESSAGE \} from "\.\.\/lib\/build-profile\.js"/);
  assert.match(optionsJs, /youtubeEnabled: false/);
  for (const deadControl of ["liveDuration", "youtubeEnabled", "ytdlpStatus", "ytdlpRefreshButton", "ytdlpGuide"]) {
    assert.doesNotMatch(optionsHtml, new RegExp(`id="${deadControl}"`));
  }
  assert.doesNotMatch(optionsHtml, /id="(?:refreshYtdlp|ytdlpNetworkDisabled|youtubeEnabled|liveDuration)"/);
  assert.match(optionsHtml, /id="capabilityYtDlp"/);
  assert.match(optionsCss, /\.field-help\{[^}]*color:var\(--muted\)[^}]*line-height:1\.55/);
  assert.match(optionsHtml, /id="runtimeHeading"/);
  assert.match(optionsHtml, /id="copyDiagnosticsButton"/);
  assert.match(optionsHtml, /id="capabilityList"/);
  assert.match(optionsHtml, /id="privateNetworkDialog"/);
  assert.equal((optionsHtml.match(/<fieldset\b/g) || []).length, 6);
  assert.match(optionsHtml, /class="save-btn" disabled/);
  for (const feature of ["directMedia", "staticHls", "staticDash", "bilibiliDashPair", "liveHls", "encryptedHls", "separateAudioHls", "externalToolNetwork", "remoteThumbnails"]) {
    assert.match(optionsJs, new RegExp(`${feature}:`));
  }
  assert.match(optionsJs, /BUILD_PROFILE\.features\[feature\] === true/);
  assert.match(optionsJs, /value\.textContent = enabled \? "可用" : "未启用"/);
  assert.match(optionsJs, /type: "GET_DIAGNOSTICS"/);
  assert.match(optionsJs, /navigator\.clipboard\.writeText\(JSON\.stringify\(diagnostics, null, 2\)\)/);
});

test("popup tabs expose complete ARIA state and keyboard navigation", () => {
  assert.match(popupHtml, /role="tablist"/);
  assert.match(popupHtml, /id="mediaTab"[^>]+role="tab"[^>]+aria-selected="true"[^>]+aria-controls="mediaView"/);
  assert.match(popupHtml, /id="jobsTab"[^>]+role="tab"[^>]+aria-selected="false"[^>]+aria-controls="jobsView"/);
  assert.match(popupHtml, /id="mediaView"[^>]+role="tabpanel"[^>]+aria-labelledby="mediaTab"/);
  assert.match(popupHtml, /id="jobsView"[^>]+role="tabpanel"[^>]+aria-labelledby="jobsTab"/);
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(popupJs, new RegExp(`event\\.key === "${key}"`));
  assert.match(popupJs, /setAttribute\("aria-selected", String\(selected\)\)/);
});

test("popup requests the controlled native path for candidates not observed by the browser", () => {
  assert.match(popupJs, /item\.provenance !== "observed_response"/);
  assert.match(popupJs, /if \(advanced\) \{\s*const granted = await chrome\.permissions\.request/);
});

test("extension pages display public URLs but return only opaque candidate references", () => {
  for (const source of [popupJs, sidepanelJs]) {
    assert.match(source, /item\.displayUrl/);
    assert.match(source, /return \{ id: item\?\.id, kind: item\?\.kind, generation: item\?\.generation \}/);
    assert.doesNotMatch(source, /candidate:\s*item/);
    assert.doesNotMatch(source, /item\.url\b/);
  }
  assert.match(popupJs, /if \(item\.copyable === true\)/);
  assert.match(popupJs, /navigator\.clipboard\.writeText\(item\.displayUrl\)/);
});

test("stable popup and side panel hide external-tool candidates and dead setup paths", () => {
  assert.match(popupJs, /import \{ BUILD_PROFILE, HOST_MISMATCH_MESSAGE \} from "\.\.\/lib\/build-profile\.js"/);
  for (const source of [popupJs, sidepanelJs]) {
    assert.match(source, /item\.kind !== "youtube" \|\| BUILD_PROFILE\.features\.externalToolNetwork/);
    assert.doesNotMatch(source, /yt-dlp|ytdlpReady|ytdlpNetworkDisabled|打开下载设置/);
  }
});

test("popup and side panel report native build mismatches without hiding ordinary downloads", () => {
  for (const source of [popupJs, sidepanelJs]) {
    assert.match(source, /HOST_MISMATCH_MESSAGE/);
    assert.match(source, /status\.connected && status\.compatible !== true/);
  }
});

test("HLS UI exposes the clear static VOD boundary and blocks unsupported modes", () => {
  for (const marker of ["aes128", "probe.type === \"media\" && probe.live", "probe.discontinuity", "probe.audioTrackCount"]) {
    assert.match(popupJs, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(popupJs, /manifestDownloadBlockReason\(probe\)/);
  assert.match(popupJs, /state\.probes\.get\(mediaKey\(item\)\)/);
  assert.match(popupJs, /当前版本暂不支持 AES-128 加密的 HLS 下载/);
  assert.doesNotMatch(popupJs, /检测到可处理的加密流媒体/);
});

test("dynamic status, task history and progress are exposed without duplicate rows", () => {
  assert.match(popupHtml, /class="tagline"/);
  assert.match(popupHtml, /id="toast"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(popupHtml, /id="jobAnnouncer"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(optionsHtml, /id="saveStatus"[^>]+role="status"[^>]+aria-live="polite"/);
  assert.match(popupJs, /setAttribute\("role", "progressbar"\)/);
  assert.match(popupJs, /setAttribute\("aria-valuenow", String\(progressPercent\)\)/);
  assert.match(popupJs, /type === "JOB_UPDATED"/);
  assert.match(popupJs, /type === "JOBS_UPDATED"/);
  assert.match(popupJs, /type: "GET_JOBS"/);
  assert.match(popupJs, /state\.jobs\.set\(event\.jobId/);
  assert.match(popupJs, /focusedJobId/);
  assert.match(popupHtml, /id="workspaceButton"/);
  assert.match(popupJs, /chrome\.sidePanel\.open\(\{ windowId: state\.windowId \}\)/);
});

test("popup task cards keep long filenames, terminal states and counts readable", () => {
  assert.match(popupJs, /\$\("#jobCount"\)\.textContent = jobs\.length/);
  assert.match(popupJs, /name\.title = name\.textContent/);
  assert.match(popupJs, /terminal \? statusLabel\(job\.status\) : `\$\{progressPercent\}%`/);
  assert.match(popupJs, /completed: "已完成"/);
  assert.match(popupJs, /cancelled: "已取消"/);
  assert.match(popupJs, /if \(terminal\) card\.classList\.add\("terminal"\)/);
  const nameRule = popupCss.match(/\.job-line strong\{([^}]+)\}/)?.[1] || "";
  assert.match(nameRule, /min-width:0/);
  assert.match(nameRule, /width:100%/);
  assert.match(nameRule, /max-width:100%/);
  assert.match(nameRule, /text-overflow:ellipsis/);
  assert.match(popupCss, /\.jobs-list\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*min-width:0[^}]*width:100%/);
  assert.match(popupCss, /\.job-card\{[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(popupCss, /\.job-line\{[^}]*grid-template-columns:minmax\(0,1fr\) max-content[^}]*width:100%[^}]*max-width:100%/);
  assert.match(popupCss, /\.job-line \.job-state\{[^}]*min-width:max-content[^}]*white-space:nowrap/);
  assert.match(popupCss, /\.job-card\.terminal\{[^}]*padding:9px 12px[^}]*gap:5px/);
  assert.match(popupCss, /\.job-meta>span:first-child\{[^}]*min-width:0[^}]*flex:1[^}]*text-overflow:ellipsis/);
});

test("empty state, host state and motion preferences retain correct semantics", () => {
  assert.match(popupJs, /emptyState\.hidden = items\.length > 0/);
  assert.match(popupJs, /当前筛选下没有媒体/);
  assert.match(componentsCss, /\.host-card \.dot\.ok/);
  assert.match(componentsCss, /\.host-card \.dot\.bad/);
  assert.match(componentsCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)/);
  assert.match(componentsCss, /button:focus-visible/);
});

test("download acceleration status uses plain, consistent user-facing language", () => {
  assert.match(popupHtml, /id="hostTitle">高速下载功能</);
  assert.match(sidepanelHtml, /id="hostTitle">高速下载功能</);
  assert.match(optionsHtml, /<strong>高速下载功能<\/strong>/);
  assert.match(optionsHtml, />开启高速下载功能<\/button>/);
  for (const js of [popupJs, sidepanelJs]) {
    assert.match(js, /高速下载功能已就绪/);
    assert.match(js, /高速下载功能暂未就绪/);
    assert.match(js, /可加速大文件、合并视频片段并转换格式/);
    assert.match(js, /请先允许使用高速下载功能，再继续下载/);
    assert.doesNotMatch(js, /本地高速引擎已连接|本地高速引擎未连接|DASH 静态规划|DASH 原生|FFmpeg 缺失|FFmpeg 可用/);
  }
  assert.match(popupJs, /检测到 DRM\/内容保护，受保护内容暂不支持下载/);
  assert.match(popupJs, /在线视频由许多小片段组成.*逐段下载并自动组合.*可直接播放的文件/);
  assert.match(sidepanelJs, /高速下载任务已开始/);
  assert.doesNotMatch(`${popupHtml}\n${sidepanelHtml}\n${optionsHtml}`, /本地高速引擎|授权本地引擎/);
});

test("popup offers one parsed download flow with format-driven filenames", () => {
  assert.match(popupHtml, /<option value="mp3">MP3（仅音频）<\/option>/);
  assert.doesNotMatch(popupHtml, /id="extractAudioInput"|id="concurrencyInput"|同时下载数量/);
  assert.match(popupJs, /download\.addEventListener\("click", \(\) => void prepareDownload\(item, download\)\)/);
  assert.doesNotMatch(popupJs, /more\.textContent = stream \? "解析"|function probeAndOpen/);
  assert.match(popupJs, /type: "PROBE_MANIFEST"/);
  assert.match(popupJs, /Array\.isArray\(probe\?\.variants\) && probe\.variants\.length > 0/);
  assert.match(popupJs, /automatic\.textContent = "自动选择最高画质"/);
  assert.match(popupJs, /variantOptionLabel\(variant, index\)/);
  assert.match(popupJs, /variantUrl: .*\? null : .*\.value \|\| null/);
  assert.match(popupJs, /extractAudio: outputFormat === "mp3"/);
  assert.match(popupJs, /kind === "dash_pair"/);
  assert.match(popupJs, /streamTypeLabel/);
  assert.match(popupJs, /pairedDash && \["mkv", "webm"\]\.includes/);
  assert.match(popupJs, /value === "mp3"/);
  assert.match(popupJs, /把画面和声音分开传送.*分别下载并无损合并/);
  assert.match(popupJs, /在线视频由许多小片段组成.*逐段下载并自动组合.*可直接播放的文件/);
  assert.match(popupJs, /replaceFilenameExtension\(.*containerSelect/);
  assert.match(popupJs, /\[item\.displayTitle, item\.title, item\.suggestedFilename, item\.pageTitle\]/);
  assert.match(popupJs, /title\.textContent = readableMediaTitle\(item\)/);
  assert.match(popupJs, /defaultFilename\(item, outputFormat\)/);
  assert.match(popupCss, /#downloadForm label\.check\{display:flex;align-items:center/);
  assert.match(popupCss, /#downloadForm label\.check input\{[^}]*width:15px[^}]*height:15px[^}]*margin:0[^}]*flex:none/);
});

test("popup clear action names and explains its combined history scope", () => {
  assert.match(popupHtml, /id="clearButton"[^>]*title="清空媒体检测与已结束任务"[^>]*>清空记录<\/button>/);
  assert.match(popupJs, /removedJobs/);
  assert.match(popupJs, /个进行中任务保留/);
});

test("download dialog stays centered inside the popup viewport", () => {
  const dialogRule = popupCss.match(/dialog\{([^}]+)\}/)?.[1] || "";
  assert.match(dialogRule, /position:fixed/);
  assert.match(dialogRule, /inset:0/);
  assert.match(dialogRule, /margin:auto/);
  assert.match(dialogRule, /height:fit-content/);
  assert.match(dialogRule, /max-width:calc\(100vw - 28px\)/);
  assert.match(dialogRule, /max-height:calc\(100dvh - 28px\)/);
  assert.match(dialogRule, /overflow:auto/);
});

test("stream cards do not present manifest bytes or range support as media facts", () => {
  assert.match(popupJs, /if \(!stream && item\.contentLength\)/);
  assert.match(popupJs, /if \(!stream && item\.rangeSupported\)/);
  assert.match(popupJs, /支持多连接/);
  assert.doesNotMatch(popupJs, /text: "RANGE"/);
});

test("popup preserves long text and a visible scroll affordance", () => {
  assert.match(popupCss, /\.brand>div\{min-width:0\}/);
  assert.match(popupCss, /\.host-card>div\{min-width:0;flex:1\}/);
  assert.match(popupCss, /overflow-wrap:anywhere/);
  assert.match(popupCss, /scrollbar-width:thin/);
  assert.match(popupCss, /\.body::-webkit-scrollbar-thumb/);
  assert.doesNotMatch(popupCss, /scrollbar-width:none/);
});

test("light and dark UI tokens meet text and control contrast floors", () => {
  const light = parseVariables(tokensCss.match(/:root\s*\{([\s\S]*?)\}/)?.[1] || "");
  const dark = parseVariables(tokensCss.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] || "");
  for (const [mode, variables] of [["light", light], ["dark", dark]]) {
    assert.ok(contrast("#FFFFFF", variables["--primary-action"]) >= 4.5, `${mode} primary action text contrast`);
    assert.ok(contrast(variables["--muted"], variables["--surface"]) >= 4.5, `${mode} muted text contrast`);
    assert.ok(contrast(variables["--control-border"], variables["--surface"]) >= 3, `${mode} control boundary contrast`);
  }
  assert.match(sidepanelJs, /setAttribute\("aria-valuetext"/);
});

test("all exported PNG icons preserve transparency and the neutral frame", () => {
  for (const size of [16, 32, 48, 128]) {
    const png = decodeRgbaPng(readFileSync(new URL(`../extension/icons/icon${size}.png`, import.meta.url)));
    assert.equal(png.width, size);
    assert.equal(png.height, size);
    assert.ok(png.pixels.some((_, index) => index % 4 === 3 && png.pixels[index] === 0), `icon${size} has transparent pixels`);
    assert.ok(png.pixels.some((_, index) => index % 4 === 3 && png.pixels[index] === 255), `icon${size} has opaque pixels`);
    let hasNeutralFrame = false;
    for (let index = 0; index < png.pixels.length; index += 4) {
      const [r, g, b, a] = png.pixels.slice(index, index + 4);
      if (a > 150 && Math.abs(r - 102) < 20 && Math.abs(g - 113) < 20 && Math.abs(b - 109) < 20) {
        hasNeutralFrame = true;
        break;
      }
    }
    assert.equal(hasNeutralFrame, true, `icon${size} retains a visible neutral frame`);
  }
});

function parseVariables(block) {
  return Object.fromEntries([...block.matchAll(/(--[\w-]+)\s*:\s*(#[\da-f]{6})/gi)].map((match) => [match[1], match[2]]));
}

function contrast(first, second) {
  const values = [first, second].map(relativeLuminance).sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

function relativeLuminance(hex) {
  const channels = [1, 3, 5].map((index) => Number.parseInt(hex.slice(index, index + 2), 16) / 255);
  const [r, g, b] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function decodeRgbaPng(buffer) {
  assert.deepEqual([...buffer.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  let offset = 8;
  let width;
  let height;
  const imageData = [];
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      assert.equal(data[8], 8, "icon uses 8-bit channels");
      assert.equal(data[9], 6, "icon uses RGBA color type");
      assert.equal(data[12], 0, "icon is non-interlaced");
    } else if (type === "IDAT") imageData.push(data);
    else if (type === "IEND") break;
    offset += length + 12;
  }
  const encoded = inflateSync(Buffer.concat(imageData));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  let source = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = encoded[source++];
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const raw = encoded[source++];
      const left = column >= 4 ? pixels[rowOffset + column - 4] : 0;
      const up = row > 0 ? pixels[rowOffset - stride + column] : 0;
      const upperLeft = row > 0 && column >= 4 ? pixels[rowOffset - stride + column - 4] : 0;
      const predictor = filter === 0 ? 0
        : filter === 1 ? left
          : filter === 2 ? up
            : filter === 3 ? Math.floor((left + up) / 2)
              : filter === 4 ? paeth(left, up, upperLeft)
                : assert.fail(`unsupported PNG filter ${filter}`);
      pixels[rowOffset + column] = (raw + predictor) & 255;
    }
  }
  return { width, height, pixels };
}

function paeth(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const cornerDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= upDistance && leftDistance <= cornerDistance ? left : upDistance <= cornerDistance ? up : upperLeft;
}
