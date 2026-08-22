import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "extension");

test("manifest exposes the FluxCatch side panel workspace", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, "manifest.json"), "utf8"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel?.default_path, "sidepanel/sidepanel.html");
  assert.ok(fs.existsSync(path.join(extension, manifest.side_panel.default_path)));
});

test("side panel ships complete workspace assets and accessible states", () => {
  const html = fs.readFileSync(path.join(extension, "sidepanel/sidepanel.html"), "utf8");
  const css = fs.readFileSync(path.join(extension, "sidepanel/sidepanel.css"), "utf8");
  const js = fs.readFileSync(path.join(extension, "sidepanel/sidepanel.js"), "utf8");

  assert.match(html, /id="mediaLoading"/);
  assert.match(html, /id="mediaEmpty"/);
  assert.match(html, /id="globalError"[^>]*role="alert"/);
  assert.match(html, /id="jobsList"/);
  assert.match(html, /id="jobAnnouncer"[^>]*role="status"/);
  assert.match(html, /id="clearCompletedButton"/);
  assert.match(html, /<h3>少女祈祷中……<\/h3>/);
  assert.match(html, /<p>播放视频后自动检测可下载的视频、音频与流媒体<\/p>/);
  assert.match(html, /sidepanel\.css/);
  assert.match(html, /sidepanel\.js/);

  assert.match(css, /--primary:#5E8F84/);
  assert.match(css, /prefers-color-scheme:\s*dark/);
  assert.match(css, /prefers-reduced-motion:\s*reduce/);
  assert.match(css, /button:focus-visible/);

  assert.match(js, /name:\s*"fluxcatch-sidepanel"/);
  assert.match(js, /type:\s*"GET_TAB_MEDIA"/);
  assert.match(js, /type:\s*"GET_JOBS"/);
  assert.match(js, /type:\s*"CANCEL_JOB"/);
  assert.match(js, /type:\s*"CLEAR_COMPLETED_JOBS"/);
  assert.match(js, /focusedJobId/);
  assert.match(js, /type:\s*"DOWNLOAD"/);
  assert.match(js, /kind === "dash_pair"/);
  assert.match(js, /streamTypeLabel/);
  assert.match(js, /youtube \? "打开下载设置" : "快速下载"/);
  assert.match(js, /chrome\.action\?\.openPopup/);
  assert.match(js, /请点击浏览器工具栏中的 FluxCatch 图标打开下载设置/);
  assert.match(js, /permissions\.request\(\{ permissions: \["nativeMessaging"\] \}\)/);
  assert.match(js, /item\.provenance !== "observed_response"/);
  assert.match(js, /openOptionsPage/);
});

test("side panel task rows keep long hashes inside the card", () => {
  const css = fs.readFileSync(path.join(extension, "sidepanel/sidepanel.css"), "utf8");
  assert.match(css, /\.jobs-list\s*\{[^}]*grid-template-columns:minmax\(0,1fr\)[^}]*min-width:0[^}]*width:100%/);
  assert.match(css, /\.job-row\s*\{[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0[^}]*overflow:hidden/);
  assert.match(css, /\.job-head\s*\{[^}]*grid-template-columns:minmax\(0,1fr\) max-content[^}]*width:100%[^}]*max-width:100%/);
  assert.match(css, /\.job-title\s*\{[^}]*width:100%[^}]*max-width:100%[^}]*min-width:0[^}]*text-overflow:ellipsis/);
  assert.match(css, /\.job-state\s*\{[^}]*min-width:max-content[^}]*white-space:nowrap/);
});

test("popup and side panel render privacy-safe thumbnails with kind fallbacks", () => {
  const popupJs = fs.readFileSync(path.join(extension, "popup/popup.js"), "utf8");
  const popupCss = fs.readFileSync(path.join(extension, "popup/popup.css"), "utf8");
  const sidepanelJs = fs.readFileSync(path.join(extension, "sidepanel/sidepanel.js"), "utf8");
  const sidepanelCss = fs.readFileSync(path.join(extension, "sidepanel/sidepanel.css"), "utf8");
  const thumbnailJs = fs.readFileSync(path.join(extension, "lib/thumbnail.js"), "utf8");

  for (const source of [popupJs, sidepanelJs]) {
    assert.match(source, /import \{ loadPrivacySafeThumbnail \} from "\.\.\/lib\/thumbnail\.js"/);
    assert.match(source, /loadPrivacySafeThumbnail\(item\.thumbnailUrl, fallback,\s*\{/);
    assert.match(source, /allowedThumbnailOrigins:\s*item\.thumbnailAllowedOrigins/);
    assert.match(source, /allowPrivateNetworkMedia\s*\?\s*"private_network_opt_in"/);
  }
  assert.match(thumbnailJs, /credentials:\s*"omit"/);
  assert.match(thumbnailJs, /referrerPolicy:\s*"no-referrer"/);
  assert.match(thumbnailJs, /cache:\s*"force-cache"/);
  assert.match(thumbnailJs, /redirect:\s*"error"/);
  assert.match(thumbnailJs, /contentType\.startsWith\("image\/"\)/);
  assert.match(thumbnailJs, /DEFAULT_MAX_THUMBNAIL_BYTES = 8 \* 1024 \* 1024/);
  assert.match(thumbnailJs, /URL\.createObjectURL\(blob\)/);
  assert.match(thumbnailJs, /URL\.revokeObjectURL\(objectUrl\)/);
  assert.match(thumbnailJs, /thumbnail\.replaceWith\(fallback\)/);

  assert.match(popupCss, /\.media-thumbnail\{[^}]*width:40px[^}]*height:40px[^}]*border-radius:11px[^}]*object-fit:cover/);
  assert.match(sidepanelCss, /\.media-thumbnail \{[^}]*width:38px[^}]*height:38px[^}]*border-radius:10px[^}]*object-fit:cover/);
});
