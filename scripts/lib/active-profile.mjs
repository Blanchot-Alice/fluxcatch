// Disposable-profile fixtures that let an audit screenshot the real Downloads
// page with live downloads: an extension copy whose optional permissions are
// granted up front, a launcher for the stand-in engine in
// fake-native-host.mjs, its native messaging registration inside the profile,
// and a helper that starts fixture downloads through the real worker.
//
// Same approach as prepareExtension/registerNativeHost in tools/live/live.mjs.
// Nothing outside the folders passed in is written; extension/ is only read.
//
// Order relative to Chrome: the copied manifest must exist before Chrome
// loads the extension and the registration before the worker first connects
// to the engine, so both are simplest done before launch:
//   1. prepareActiveExtension(repoExtensionDir, copyDir)
//   2. writeFakeHostLauncher(workDir, { scenario, extensionDir: copyDir, ... })
//   3. registerFakeHost(profileDir, launcher, extensionIdFromKey(manifest.key))
//   4. launch Chrome with --user-data-dir=profileDir --load-extension=copyDir
//   5. startFixtureDownloads(expression => evaluate(page, expression))
//      from an extension page that stays open (see the note on that function)
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { classifyMedia } from "../../extension/lib/media.js";
import { resolveScenario } from "./fake-native-host.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** extension/background.js HOST_NAME, scripts/validate.py NATIVE_HOST_NAME. */
export const NATIVE_HOST_NAME = "io.github.blanchot_alice.fluxcatch";
export const FAKE_HOST_SCRIPT = path.join(HERE, "fake-native-host.mjs");
export const GRANTED_PERMISSIONS = Object.freeze(["nativeMessaging", "notifications"]);
export const DEFAULT_FIXTURE_ITEMS = Object.freeze([
  Object.freeze({ url: "https://example.com/talks/lecture-12-pharmacokinetics.mp4" }),
  Object.freeze({ url: "https://example.com/media/keynote-2026.mp4" })
]);

/** Chrome's id for an unpacked extension with a manifest "key". */
export function extensionIdFromKey(base64Key) {
  if (typeof base64Key !== "string" || !base64Key.trim()) throw new TypeError("manifest key must be a base64 string");
  const der = Buffer.from(base64Key, "base64");
  if (!der.length) throw new TypeError("manifest key is not valid base64");
  const digest = crypto.createHash("sha256").update(der).digest("hex").slice(0, 32);
  return [...digest].map((char) => String.fromCharCode(97 + parseInt(char, 16))).join("");
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * Copies srcDir to outDir and grants nativeMessaging and notifications in the
 * copy's manifest: optional permissions need a user prompt that Chrome cannot
 * show unattended. "key" stays, so the extension id (and the origin the engine
 * registration trusts) is the same as the real one. outDir must be missing or
 * empty. Returns outDir.
 */
export function prepareActiveExtension(srcDir, outDir) {
  const source = path.resolve(srcDir);
  const target = path.resolve(outDir);
  if (!fs.existsSync(path.join(source, "manifest.json"))) throw new Error(`${source} has no manifest.json`);
  if (isInside(target, source) || isInside(source, target)) throw new Error("outDir must not overlap srcDir");
  if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} is not empty`);
  fs.cpSync(source, target, { recursive: true });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.key !== "string" || !manifest.key) throw new Error("manifest.json has no key; the extension id would change");
  const permissions = new Set(Array.isArray(manifest.permissions) ? manifest.permissions : []);
  for (const permission of GRANTED_PERMISSIONS) permissions.add(permission);
  manifest.permissions = [...permissions];
  manifest.optional_permissions = (Array.isArray(manifest.optional_permissions) ? manifest.optional_permissions : [])
    .filter((permission) => !permissions.has(permission));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return target;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`;
}

/**
 * Writes <dir>/fake-native-host.sh, which execs this Node binary on
 * fake-native-host.mjs with the given settings. Variables that are not given
 * are unset, so nothing leaks in from the environment Chrome was started
 * with; NODE_OPTIONS is always unset, because a --require or --import in it
 * could print to stdout, which Chrome reads as the message stream. Returns
 * the launcher path.
 */
export function writeFakeHostLauncher(dir, { scenario, downloadDir, extensionDir, logFile } = {}) {
  let scenarioJson = null;
  if (scenario !== undefined && scenario !== null) {
    scenarioJson = typeof scenario === "string" ? scenario : JSON.stringify(scenario);
    // Fail here, not inside Chrome: the engine exits on a scenario it
    // rejects, and the worker then only reports a missing engine.
    resolveScenario(scenarioJson);
  }
  if (downloadDir != null && !(typeof downloadDir === "string" && downloadDir.startsWith("/"))) {
    // The worker drops a folder that is not absolute (cleanLocalPath).
    throw new TypeError("downloadDir must be an absolute path");
  }
  const target = path.resolve(dir);
  fs.mkdirSync(target, { recursive: true });
  const variables = [
    ["FLUXCATCH_FAKE_HOST_SCENARIO", scenarioJson],
    ["FLUXCATCH_FAKE_HOST_DOWNLOAD_DIR", downloadDir ?? null],
    ["FLUXCATCH_FAKE_HOST_EXTENSION_DIR", extensionDir ? path.resolve(extensionDir) : null],
    ["FLUXCATCH_FAKE_HOST_LOG", logFile ? path.resolve(logFile) : null]
  ];
  const launcher = path.join(target, "fake-native-host.sh");
  fs.writeFileSync(launcher, [
    "#!/bin/sh",
    "# FluxCatch stand-in engine for a disposable Chrome profile (scripts/lib/active-profile.mjs).",
    "unset NODE_OPTIONS",
    ...variables.map(([name, value]) => (value === null ? `unset ${name}` : `export ${name}=${shellQuote(value)}`)),
    `exec ${shellQuote(process.execPath)} ${shellQuote(FAKE_HOST_SCRIPT)} "$@"`,
    ""
  ].join("\n"));
  fs.chmodSync(launcher, 0o755);
  return launcher;
}

/**
 * Registers the launcher as the FluxCatch engine for one disposable profile.
 * Chrome looks for user-level hosts in <user-data-dir>/NativeMessagingHosts,
 * so the real engine registration under ~/Library is never touched. Returns
 * the registration file path.
 */
export function registerFakeHost(profileDir, launcherPath, extensionId) {
  if (!/^[a-p]{32}$/.test(String(extensionId))) throw new TypeError("extensionId must be 32 letters a-p");
  const launcher = path.resolve(launcherPath);
  fs.accessSync(launcher, fs.constants.X_OK);
  const registrationDir = path.join(path.resolve(profileDir), "NativeMessagingHosts");
  fs.mkdirSync(registrationDir, { recursive: true });
  const registration = path.join(registrationDir, `${NATIVE_HOST_NAME}.json`);
  fs.writeFileSync(registration, `${JSON.stringify({
    name: NATIVE_HOST_NAME,
    description: "FluxCatch stand-in engine (design audit)",
    path: launcher,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`]
  }, null, 2)}\n`);
  return registration;
}

/**
 * Starts one download per item through the real worker, the way the URL form
 * on the Downloads page does: DOWNLOAD_URL, which always goes to the engine
 * for a pasted address. Only direct video or audio addresses (".mp4",
 * ".m4a", ...) are accepted: the worker classifies those from the path alone
 * and hands them straight to the engine. Any other address would make the
 * worker fetch it first (a HEAD request for an address without a media
 * extension, the playlist itself for ".m3u8" or ".mpd"), so it is rejected
 * here instead of reaching the network during an audit.
 *
 * evaluateInPage(expression) must evaluate the expression in an extension
 * page that is a tab (the worker uses sender.tab.id) and resolve to the
 * awaited, by-value result (CDP Runtime.evaluate with awaitPromise and
 * returnByValue, e.g. chrome-harness.mjs evaluate()).
 *
 * Use a page that stays open and is not reloaded (a separate control tab,
 * not the Downloads page being captured): the worker files the address as a
 * card of that tab and drops it when the tab reloads or closes, after which
 * pause still works but resume fails with "来源页面的媒体信息已失效".
 *
 * Filenames: without options.filename the worker names the file after the
 * sending tab's title ("FluxCatch 下载记录.mp4" from the Downloads page, the
 * same name for both items), not after the URL. Each item therefore sends
 * options.filename, defaulting to the URL's last path segment
 * ("lecture-12-pharmacokinetics.mp4", "keynote-2026.mp4"). Pass
 * { url, filename } to choose another name, or { url, options } to send the
 * options object unchanged.
 *
 * Items are sent one after another, so the stand-in engine sees them in this
 * order (scenario.jobs[0] applies to the first). Returns the worker replies:
 * { ok: true, method: "native", jobId } or { ok: false, error }.
 */
export async function startFixtureDownloads(evaluateInPage, items = DEFAULT_FIXTURE_ITEMS) {
  if (typeof evaluateInPage !== "function") throw new TypeError("evaluateInPage must be a function");
  const specs = items.map((item) => {
    const spec = typeof item === "string" ? { url: item } : item;
    if (!spec || typeof spec.url !== "string") throw new TypeError("each item needs a url");
    // Same classifier the worker runs in downloadUserUrl().
    let kind = null;
    try { kind = classifyMedia({ url: spec.url })?.kind || null; } catch { kind = null; }
    if (kind !== "video" && kind !== "audio") {
      throw new TypeError(`${spec.url} is not a direct video or audio address; the worker would fetch it before starting`);
    }
    return spec;
  });
  const replies = [];
  for (const spec of specs) {
    let options = spec.options;
    if (!options) {
      let filename = spec.filename;
      if (!filename) {
        try { filename = decodeURIComponent(new URL(spec.url).pathname.split("/").filter(Boolean).pop() || ""); } catch { filename = ""; }
      }
      options = filename ? { filename } : {};
    }
    const request = JSON.stringify({ type: "DOWNLOAD_URL", url: spec.url, options });
    const expression = `(async () => {
      try { return await chrome.runtime.sendMessage(${request}); }
      catch (error) { return { ok: false, error: String(error && error.message || error) }; }
    })()`;
    replies.push(await evaluateInPage(expression));
  }
  return replies;
}
