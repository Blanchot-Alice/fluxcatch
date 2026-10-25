// Static and behavioural guards on the v2 surfaces, ported from the v1
// assertions that pinned behaviour (labels, ARIA, privacy, the download flow,
// the native-path gate). v1 markup, CSS and Chinese literals are gone; the
// presentation itself is covered by the ui-v2-*.test.js files and the design
// audit (scripts/design-audit.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { setUiLanguage } from "../extension/ui/v2/locale.js";

const read = (relative) => readFileSync(new URL(`../extension/${relative}`, import.meta.url), "utf8");
const stripComments = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const popupHtml = read("popup/popup.html");
const popupCss = read("popup/popup.css");
const popupJs = read("popup/popup.js");
const sidepanelHtml = read("sidepanel/sidepanel.html");
const sidepanelJs = read("sidepanel/sidepanel.js");
const optionsJs = read("options/options.js");
const formStateJs = read("options/form-state.js");
const mediaJs = read("ui/v2/media.js");
const systemCss = read("ui/v2/system.css");
const componentsJs = read("ui/v2/components.js");

// A tiny stand-in for the few DOM calls the pure media helpers make.
globalThis.document ??= { createElement: () => ({ dataset: {}, append() {}, setAttribute() {} }), createTextNode: () => ({}) };
const media = await import("../extension/ui/v2/media.js");
const { compareJobs } = await import("../extension/ui/v2/jobs.js");

test("every surface loads the v2 tokens, the system, the shared media sheet where used, then its own sheet", () => {
  for (const [page, sheets] of [
    ["popup/popup.html", ["../ui/v2/tokens.css", "../ui/v2/system.css", "../ui/v2/media.css", "popup.css"]],
    ["sidepanel/sidepanel.html", ["../ui/v2/tokens.css", "../ui/v2/system.css", "../ui/v2/media.css", "sidepanel.css"]],
    ["preview/preview.html", ["../ui/v2/tokens.css", "../ui/v2/system.css", "../ui/v2/media.css", "preview.css"]],
    ["options/options.html", ["../ui/v2/tokens.css", "../ui/v2/system.css", "options.css"]],
    ["designer/designer.html", ["../ui/v2/tokens.css", "../ui/v2/system.css", "designer.css"]],
    ["downloads/downloads.html", ["../ui/v2/tokens.css", "../ui/v2/system.css", "downloads.css"]]
  ]) {
    const html = read(page);
    const order = sheets.map((href) => html.indexOf(`href="${href}"`));
    assert.ok(order.every((index) => index >= 0), `${page} loads ${sheets.join(", ")}`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, `${page} keeps the cascade order`);
    assert.doesNotMatch(html, /ui\/(?:tokens|components|atmosphere)\.css/, `${page} loads no v1 sheet`);
  }
  for (const retired of ["ui/tokens.css", "ui/components.css", "ui/atmosphere.css", "ui/interactions.js", "ui/speed-graph.js", "ui/job-rows.js", "ui/i18n.js"]) {
    assert.equal(existsSync(new URL(`../extension/${retired}`, import.meta.url)), false, `${retired} is retired`);
  }
});

test("Settings fields keep programmatic labels, switches stay native buttons, and the engine is set up from a gesture", () => {
  for (const field of ["concurrentFragments", "concurrentRanges", "concurrentJobs", "minimumKB"]) {
    assert.ok(optionsJs.includes(`numberRow("${field}")`), `${field} is a labelled number row`);
  }
  for (const id of ["field-outputContainer", "field-filenameTemplate", "field-blockedDomains", "field-language", "field-preset"]) {
    assert.match(optionsJs, new RegExp(`id: "${id}"`), id);
  }
  assert.match(optionsJs, /id: `field-\$\{field\}`/, "number and switch rows get stable field ids");
  assert.match(optionsJs, /settingRow\(\{ id: `row-\$\{key\}`/, "every row goes through the shared settingRow (label for, describedby)");
  // The one boolean control is a <button role=switch>: focusable and operable without script tricks.
  const controls = read("ui/v2/controls.js");
  assert.match(controls, /element\.setAttribute\("role", "switch"\)/);
  assert.match(controls, /const LABEL_FOR = "input, select, textarea, \[role=switch\]"/);
  assert.doesNotMatch(systemCss, /\.switch[^{]*\{[^}]*display:\s*none/, "the switch is never hidden from the keyboard");
  assert.match(optionsJs, /chrome\.permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\)/);
  assert.match(optionsJs, /callWorker\(\{ type: "PING_HOST" \}\)/);
  assert.match(optionsJs, /"\.\/scripts\/native-install-wrapper\.sh"/);
  assert.match(optionsJs, /"\.\/install-macos\.sh"/);
});

test("Settings saves keep the closed gates and the capability list follows the build profile", () => {
  assert.match(formStateJs, /liveDuration: 0,/, "live recording stays off on every save");
  assert.match(formStateJs, /youtubeEnabled: false,/, "the external-tool path stays closed on every save");
  assert.match(formStateJs, /allowPrivateNetworkMedia/);
  assert.match(formStateJs, /autoEnrichSiteQuality/);
  assert.match(optionsJs, /import \{ BUILD_PROFILE \} from "\.\.\/lib\/build-profile\.js"/);
  assert.match(optionsJs, /const features = BUILD_PROFILE\.features;/);
  for (const dead of ["liveDuration", "youtubeEnabled", "ytdlp"]) {
    assert.doesNotMatch(read("options/options.html") + optionsJs.replace(/liveDuration: 0|youtubeEnabled: false/g, ""), new RegExp(`id(?:=|: )"(?:field-)?${dead}`), `no ${dead} control`);
  }
  assert.match(optionsJs, /callWorker\(\{ type: "GET_DIAGNOSTICS" \}\)/);
  assert.match(optionsJs, /navigator\.clipboard\.writeText\(JSON\.stringify\(diagnostics, null, 2\)\)/);
});

test("the popup's view switch is a tablist with panels and the shared keyboard model", () => {
  assert.match(popupJs, /controls: "mediaView"/);
  assert.match(popupJs, /controls: "downloadsView"/);
  assert.match(popupJs, /tab\.dataset\.view = tab\.dataset\.value;/, "views are addressed as data-view, not #jobsTab");
  assert.match(popupHtml, /id="mediaView" role="tabpanel" aria-labelledby="tab-media"/);
  assert.match(popupHtml, /id="downloadsView" role="tabpanel" aria-labelledby="tab-downloads"/);
  const controls = read("ui/v2/controls.js");
  for (const key of ["ArrowRight", "ArrowLeft", "Home", "End"]) assert.match(controls, new RegExp(key), key);
  assert.match(controls, /tab\.setAttribute\(stateAttribute, String\(selected\)\)/);
});

test("only fixed trusted browser candidates skip the controlled native path", () => {
  const instagram = { site: "instagram", kind: "video", provenance: "site_payload", displayUrl: "https://scontent.cdninstagram.com/v/a.mp4" };
  const x = { site: "twitter", kind: "video", provenance: "observed_response", displayUrl: "https://video.twimg.com/ext_tw_video/1/a.mp4" };
  assert.equal(media.downloadNeedsNative(instagram), false);
  assert.equal(media.downloadNeedsNative(x), false);
  assert.equal(media.downloadNeedsNative(instagram, { convert: true }), true, "conversion needs the engine");
  assert.equal(media.downloadNeedsNative(instagram, { useNativeForDirect: true }), true);
  assert.equal(media.downloadNeedsNative({ ...instagram, displayUrl: "https://evil.example/cdninstagram.com/a.mp4" }), true);
  assert.equal(media.downloadNeedsNative({ ...instagram, displayUrl: "https://scontent.cdninstagram.com/v/a.webm" }), true);
  assert.equal(media.downloadNeedsNative({ ...x, displayUrl: "https://video.twimg.com.evil.example/a.mp4" }), true);
  assert.equal(media.downloadNeedsNative({ ...x, provenance: "dom_metadata" }), true);
  assert.equal(media.downloadNeedsNative({ kind: "hls", displayUrl: "https://video.twimg.com/a.m3u8" }), true, "streams always need the engine");
  assert.equal(media.downloadNeedsNative({ kind: "video", displayUrl: "https://example.com/a.mp4" }), true);
  for (const source of [popupJs, sidepanelJs]) assert.match(source, /downloadNeedsNative/, "both surfaces gate through media.js");
});

test("pages show public URLs but send only opaque candidate references", () => {
  assert.deepEqual(media.candidateReference({ id: "c1", kind: "hls", generation: 4, displayUrl: "https://a.example/x.m3u8", url: "https://secret" }), { id: "c1", kind: "hls", generation: 4 });
  for (const source of [mediaJs, popupJs, sidepanelJs].map(stripComments)) {
    assert.doesNotMatch(source, /candidate:\s*item\b/);
    assert.doesNotMatch(source, /\bitem\.url\b/);
  }
  assert.match(mediaJs, /if \(item\.copyable === true && onMore\)/, "Copy link only for copyable items");
  assert.match(mediaJs, /navigator\.clipboard\.writeText\(item\.displayUrl\)/);
});

test("stable builds hide external-tool candidates and setup paths", () => {
  assert.equal(media.isOfferedCandidate({ kind: "youtube" }), true, "the GitHub build carries the brokered yt-dlp adapter");
  assert.equal(media.isOfferedCandidate({ kind: "segment" }), false);
  assert.equal(media.isOfferedCandidate({ kind: "video" }), true);
  for (const source of [mediaJs, popupJs, sidepanelJs]) assert.doesNotMatch(source, /yt-dlp|ytdlp/);
});

test("a native build mismatch is reported without hiding ordinary downloads", () => {
  assert.equal(media.engineIssue({ connected: true, compatible: false }), "update");
  assert.equal(media.engineIssue({ connected: true, compatible: true, capabilities: { ffmpeg: { available: true } } }), null);
  assert.equal(media.mp3Available({ connected: true, compatible: false }), false);
  const trusted = { site: "twitter", kind: "video", provenance: "observed_response", displayUrl: "https://video.twimg.com/a.mp4" };
  assert.equal(media.downloadNeedsNative(trusted), false, "a trusted file still downloads through Chrome");
});

test("the static VOD boundary: copy-protected, live and discontinuous streams are blocked", () => {
  assert.equal(media.manifestBlock({ kind: "hls", protection: "drm" }), "drm");
  assert.equal(media.manifestBlock({ kind: "hls", type: "media", live: true }), "live");
  assert.equal(media.manifestBlock({ kind: "hls", discontinuity: true }), "discontinuous");
  assert.equal(media.manifestBlock({ kind: "dash", protected: true }), "drm");
  assert.equal(media.manifestBlock({ kind: "hls", type: "master", variants: [] }), "");
  assert.match(mediaJs, /submit\.disabled = Boolean\(block\) \|\| starting;/, "a blocked stream disables Download");
});

test("live status, task history and progress are announced once, with no duplicate rows", () => {
  for (const html of [popupHtml, sidepanelHtml]) {
    assert.match(html, /id="announcer" role="status" aria-live="polite"/);
    assert.match(html, /class="toast-region"[^>]*aria-live="polite"/);
  }
  assert.match(componentsJs, /element\.setAttribute\("role", "progressbar"\)/);
  assert.match(componentsJs, /element\.setAttribute\("aria-valuenow", String\(percent\)\)/);
  assert.match(componentsJs, /element\.setAttribute\("aria-valuetext", `\$\{percent\}%`\)/);
  for (const source of [popupJs, sidepanelJs]) {
    assert.match(source, /message\.type === "JOBS_UPDATED"/);
    assert.match(source, /type: "GET_JOBS"/);
    assert.match(source, /jobList\.announce\(/, "a failed start that a row now shows is announced");
  }
  assert.match(mediaJs, /if \(lastAnnouncement === key\) return;/, "one announcement per status change");
  assert.match(mediaJs, /queueMicrotask\(\(\) => \{ if \(lastAnnouncement === key\) announcer\.textContent = words; \}\)/);
  assert.match(popupJs, /chrome\.sidePanel\.open\(\{ windowId: state\.windowId \}\)/);
});

test("download rows order live jobs first, then the newest finished file", () => {
  const jobs = [
    { jobId: "old-done", status: "completed", updatedAt: 10, createdAt: 1 },
    { jobId: "running-old", status: "downloading", createdAt: 5 },
    { jobId: "new-done", status: "failed", updatedAt: 20, createdAt: 2 },
    { jobId: "running-new", status: "queued", createdAt: 9 }
  ];
  assert.deepEqual([...jobs].sort(compareJobs).map((job) => job.jobId), ["running-new", "running-old", "new-done", "old-done"]);
  assert.match(mediaJs, /const all = \[\.\.\.jobs\.values\(\)\]\.sort\(compareJobs\);/);
  assert.match(read("downloads/downloads.js"), /return list\.sort\(compareJobs\);/);
});

test("motion and focus keep their semantics in the shared system", () => {
  assert.match(systemCss, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(systemCss, /:focus-visible \{\s*outline: 2px solid var\(--pond-text\);/);
  assert.match(componentsJs, /actionNode\.hidden = !spec;/, "an empty state shows at most one action");
});

test("the local engine has one plain name and one setup phrasing in both languages", async () => {
  const { MESSAGES } = await import("../extension/ui/v2/messages.js");
  assert.equal(MESSAGES.en["status.engineNotSetUp"], "Local engine isn’t set up");
  assert.equal(MESSAGES.en["action.setUp"], "Set up");
  const zh = JSON.stringify(Object.values(MESSAGES.zh).filter((value) => typeof value === "string"));
  assert.doesNotMatch(zh, /本地高速引擎|授权本地引擎|本地下载引擎/, "no retired engine names");
  const en = JSON.stringify(Object.values(MESSAGES.en).filter((value) => typeof value === "string"));
  assert.doesNotMatch(en, /native host|native messaging|helper app/i, "no developer names for the engine");
});

test("one download flow: format-driven names, MP3 only when the engine can make it, quality from the probe", () => {
  setUiLanguage("en");
  const file = { kind: "video", displayTitle: "Concert.mp4", displayUrl: "https://a.example/v/concert.mp4", mime: "video/mp4" };
  assert.equal(media.defaultFilename(file, "original"), "Concert.mp4");
  assert.equal(media.defaultFilename(file, "mkv"), "Concert.mkv");
  assert.equal(media.replaceFilenameExtension("Concert.mp4", "mp3", file), "Concert.mp3");
  assert.equal(media.originalExtension({ mime: "audio/mp4" }), "m4a");
  assert.equal(media.originalExtension({ mime: "audio/mpeg" }), "mp3");
  assert.equal(media.readableMediaTitle({ displayTitle: "", title: "", suggestedFilename: "", pageTitle: "Page" }), "Page");
  assert.equal(media.readableMediaTitle({}), "Untitled media");
  const stream = { kind: "hls" };
  assert.equal(media.formatOptions(stream).find((option) => option.value === "original").disabled, true, "streams have no original format");
  const pair = media.formatOptions({ kind: "dash_pair" });
  assert.deepEqual(pair.filter((option) => option.disabled).map((option) => option.value), ["original", "mkv", "webm"]);
  const noLame = { connected: true, compatible: true, capabilities: { ffmpeg: { available: true, encoders: { libmp3lame: false } } } };
  assert.equal(media.formatOptions(file, noLame).find((option) => option.value === "mp3").disabled, true);
  const mp3 = media.downloadOptions(file, { filename: "Concert.mp3", format: "mp3" });
  assert.equal(mp3.extractAudio, true);
  assert.equal(mp3.convert, true);
  assert.equal(media.downloadOptions(file, { filename: "Concert.mp4", format: "mp4" }).convert, false, "same container: no conversion");
  assert.equal(media.downloadOptions(file, { filename: "a", format: "mkv", variantUrl: "https://a.example/720.m3u8" }).variantUrl, "https://a.example/720.m3u8");
  assert.match(mediaJs, /type: "PROBE_MANIFEST", tabId: owner, candidate: candidateReference\(next\)/);
  assert.match(mediaJs, /Array\.isArray\(probeOf\(\)\?\.variants\)/);
});

test("Clear results asks in place and clears this page's results and finished downloads", () => {
  assert.match(popupJs, /menus\.confirm\(control, \{ question: msg\("media\.clearConfirm"\)/);
  assert.match(popupJs, /type: "CLEAR_TAB"/);
  for (const source of [popupJs, sidepanelJs, mediaJs]) assert.doesNotMatch(source, /window\.confirm/);
});

test("the download dialog stays centred and inside a 372 × 600 popup", () => {
  const rule = systemCss.slice(systemCss.indexOf(".dialog-shell {"), systemCss.indexOf("}", systemCss.indexOf(".dialog-shell {")));
  assert.match(rule, /margin: auto;/);
  assert.match(rule, /width: min\(var\(--dialog-width\), calc\(100vw - 2 \* var\(--space-4\)\)\);/);
  assert.match(rule, /max-height: calc\(100vh - 2 \* var\(--space-4\)\);/);
  assert.match(systemCss, /\.dialog-actions \{\s*position: sticky;/, "the action row is never clipped");
});

test("stream rows never present manifest bytes as a media size", () => {
  setUiLanguage("en");
  assert.doesNotMatch(media.mediaMeta({ kind: "hls", contentLength: 4096, height: 1080 }), /KB|kB|bytes|byte/);
  assert.match(media.mediaMeta({ kind: "video", displayUrl: "https://a.example/a.mp4", contentLength: 812e6 }), /812 MB/);
});

test("the toolbar popup keeps an intrinsic Chrome action size and scrolls only its body", () => {
  const htmlRule = popupCss.match(/html \{[^}]+\}/)?.[0] || "";
  assert.match(htmlRule, /width: 372px;/);
  assert.match(htmlRule, /height: 600px;/);
  assert.doesNotMatch(htmlRule, /\d+v[wh]/, "viewport-relative sizes collapse the real toolbar popup");
  assert.match(popupCss, /\.popup-main \{[^}]*overflow-y: auto;/s);
  assert.doesNotMatch(popupCss, /scrollbar-width:\s*none/, "the scroll affordance stays visible");
});

test("all exported PNG icons preserve transparency, the indigo arrow and the pond water (design review v3.2)", () => {
  for (const size of [16, 32, 48, 128]) {
    const png = decodeRgbaPng(readFileSync(new URL(`../extension/icons/icon${size}.png`, import.meta.url)));
    assert.equal(png.width, size);
    assert.equal(png.height, size);
    // The disc is clipped: every corner is transparent, the disc itself opaque.
    for (const [x, y] of [[0, 0], [size - 1, 0], [0, size - 1], [size - 1, size - 1]]) {
      assert.equal(png.pixels[(y * size + x) * 4 + 3], 0, `icon${size} corner ${x},${y} is transparent`);
    }
    assert.ok(png.pixels.some((_, index) => index % 4 === 3 && png.pixels[index] === 255), `icon${size} has opaque pixels`);
    let hasArrow = false;
    let hasWater = false;
    for (let index = 0; index < png.pixels.length; index += 4) {
      const [r, g, b, a] = png.pixels.slice(index, index + 4);
      if (a <= 150) continue;
      // The arrow: the review's indigo (#2B2E4A), antialiased edges allowed.
      if (r < 70 && g < 70 && b < 100 && b > r) hasArrow = true;
      // The water: pond blue, from #9DBBD1 at the waterline to #4E7FA2 at the foot.
      if (b > r + 30 && b > 120 && g > r) hasWater = true;
      if (hasArrow && hasWater) break;
    }
    assert.equal(hasArrow, true, `icon${size} carries the indigo arrow`);
    assert.equal(hasWater, true, `icon${size} carries the pond water`);
  }
});

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
