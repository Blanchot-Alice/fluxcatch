import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { captureMediaRefresh, isMediaRefreshCurrent } from "../extension/sidepanel/refresh-guard.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const extension = path.join(root, "extension");
const read = (file) => fs.readFileSync(path.join(extension, file), "utf8");

test("manifest exposes the Havre side panel workspace", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(manifest.permissions.includes("sidePanel"));
  assert.equal(manifest.side_panel?.default_path, "sidepanel/sidepanel.html");
  assert.ok(fs.existsSync(path.join(extension, manifest.side_panel.default_path)));
});

test("side panel ships its v2 assets, accessible states and the worker messages it relies on", () => {
  const html = read("sidepanel/sidepanel.html");
  const js = read("sidepanel/sidepanel.js");
  const media = read("ui/v2/media.js");
  // FILE_ACTION lives in jobs.js, which the Downloads page shares too.
  const shared = media + read("ui/v2/jobs.js");
  for (const id of ["mediaState", "mediaRows", "mediaEmptySlot", "engineLine", "jobsState", "focusSlot", "jobRows", "jobsEmptySlot", "urlButton", "settingsButton"]) {
    assert.match(html, new RegExp(`id="${id}"`), `#${id}`);
  }
  assert.match(html, /id="announcer"[^>]*role="status"[^>]*aria-live="polite"/);
  assert.match(html, /class="toast-region"/);
  assert.match(html, /class="menu-layer"[^>]*hidden/);
  assert.match(html, /class="pond" data-pond aria-hidden="true"/);
  assert.match(html, /sidepanel\.css/);
  assert.match(html, /sidepanel\.js/);

  assert.match(js, /name:\s*"havre-sidepanel"/);
  for (const type of ["GET_TAB_MEDIA", "GET_JOBS", "CLEAR_COMPLETED_JOBS", "OPEN_DOWNLOADS_PAGE", "SCAN_TAB", "DOWNLOAD_BATCH", "GET_SETTINGS"]) {
    assert.match(js, new RegExp(`type: "${type}"`), type);
  }
  for (const type of ["DOWNLOAD", "DOWNLOAD_URL", "PROBE_MANIFEST", "CANCEL_JOB", "PAUSE_JOB", "RESUME_JOB", "RETRY_JOB", "REMOVE_HISTORY", "OPEN_JOB_SOURCE", "FILE_ACTION", "PING_HOST"]) {
    assert.match(shared, new RegExp(`type: "${type}"`), `${type} (shared with the popup)`);
  }
  assert.match(js, /import \{[\s\S]*createJobList,[\s\S]*createMediaDialog,[\s\S]*mediaRow,[\s\S]*\} from "\.\.\/ui\/v2\/media\.js"/, "the popup's components");
  assert.match(media, /item\.kind !== "youtube" \|\| Boolean\(BUILD_PROFILE\.features\.externalToolNetwork\)/, "stable builds hide external-tool candidates");
  assert.match(media, /function downloadNeedsNative[\s\S]*\|\| !trustedBrowserDirect/, "only fixed trusted candidates skip the engine");
  assert.match(js, /chrome\.tabs\.onActivated\?\.addListener/);
  assert.match(js, /openOptionsPage/);
  assert.doesNotMatch(js, /chrome\.action\?\.openPopup|yt-dlp|innerHTML/);
});

test("side panel drops a tab A media response after tab B becomes active", () => {
  const js = read("sidepanel/sidepanel.js");
  const start = js.indexOf("async function refreshMedia()");
  const end = js.indexOf("\nasync function loadJobs", start);
  const refreshMedia = js.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(refreshMedia, /const request = captureMediaRefresh\(state\)/);
  const readable = refreshMedia.slice(refreshMedia.indexOf('type: "GET_TAB_MEDIA"'));
  assert.match(readable, /GET_TAB_MEDIA", tabId: request\.tabId/);
  assert.match(readable, /if \(!isMediaRefreshCurrent\(request, state\)\) return/);
  assert.ok(
    readable.indexOf("!isMediaRefreshCurrent(request, state)") < readable.indexOf("state.items ="),
    "the tab/token guard must run before a late response mutates Side Panel state"
  );

  const tabARequest = captureMediaRefresh({ tabId: 101, refreshToken: 7 });
  const stateAfterActivatingTabB = { tabId: 202, refreshToken: 8 };
  assert.equal(isMediaRefreshCurrent(tabARequest, stateAfterActivatingTabB), false,
    "a late tab A response must be rejected after tab B activation");
  assert.equal(isMediaRefreshCurrent(tabARequest, { tabId: 101, refreshToken: 7 }), true,
    "the originating tab response remains current before activation changes state");
});

test("popup and side panel show a type glyph, never remote thumbnails (design review §6.4: posters on full pages only)", () => {
  for (const file of ["popup/popup.js", "sidepanel/sidepanel.js", "ui/v2/media.js"]) {
    assert.doesNotMatch(read(file), /loadPrivacySafeThumbnail|thumbnailUrl/, file);
  }
  assert.match(read("ui/v2/media.js"), /rowLead\(item, \{ poster: false \}\)/);
});
