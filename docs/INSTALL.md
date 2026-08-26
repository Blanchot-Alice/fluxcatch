# Installation

## Release identity

FluxCatch uses the Native Messaging name `io.github.blanchot_alice.fluxcatch`. The checked-in manifest key and native-host allowlist form one development identity and keep unpacked builds stable. The current package command produces a GitHub/development artifact only; it is not a Chrome Web Store artifact. A store installer must not be produced until the Web Store Item ID and public key exist and a separate store identity can generate the matching native-host origin. The E2E runner derives its expected development ID from the manifest key automatically.

## Load an unpacked development build

From the repository root:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `$REPO_ROOT/extension`.

The checked-in manifest public key keeps the development extension ID stable. Do not overwrite this identity merely to test a draft upload. A future Chrome Web Store build must be generated from the public key and Item ID issued for that listing and paired with its own native-host manifest.

Unpacked source reports commit `development` and no build timestamp. `npm run package` injects the current commit and a reproducible source timestamp only into a temporary staging copy and verifies that `extension/` remains unchanged. The timestamp comes from `SOURCE_DATE_EPOCH` when set, otherwise from the candidate commit time; it is not a wall-clock packaging claim.

## Verify the interface and permissions

After reloading the unpacked extension, open its gear menu. Settings starts
with **运行状态** and places the everyday controls under **基础下载**,
**性能**, **检测与命名**, **隐私与网络**, **本地能力**, and **通知**.
The **本地能力** matrix reports host connection, protocol compatibility,
FFmpeg/local processing, yt-dlp installation, and external-tool networking as
separate states. `已安装` does not mean a stable-profile feature is available.

The form's save action remains disabled until a normalized value changes.
Notification permission is requested when the notification control is enabled;
Native Messaging permission is requested from its authorization/download
control. If notification permission was revoked in Chrome, opening Settings
normalizes the ineffective saved preference to off before any later grant can
take effect. Enabling local-network media requires a confirmation and still does
not permit metadata, link-local, multicast, unspecified, or reserved targets.
The **实验室** section is informational in the stable profile and contains no
switch that can activate YouTube, live HLS, or encrypted HLS support.

## Install the macOS native host

Python 3.9 or newer is required. From a source checkout, use the checked wrapper:

```bash
cd "$REPO_ROOT"
./scripts/native-install-wrapper.sh
```

From the separately published native-host ZIP, extract the complete archive,
open Terminal in its root, and run:

```bash
./install-macos.sh
```

Both wrappers reject an older Python before the installer changes local files.
The ZIP keeps its implementation under `native-host/`; do not move individual
files out of the extracted directory.

The installer creates a private runtime copy under `~/Library/Application Support/FluxCatch/` and registers the host under Chrome's per-user `NativeMessagingHosts` directory. Return to **Settings → Local capabilities** and click **Recheck** after installation. Reload the extension only if Chrome still caches the old native-host registration.

Detection does not require the native host, but most save actions require its
Python 3.9+ pinned HTTP client. FFmpeg is required only for merge, remux, and MP3
work; FluxCatch gives it local files rather than network URLs. The only save path
that bypasses the native broker is the fixed, provenance-checked Instagram/X MP4
allowlist handled by Chrome; enabling **可信直链也使用本地下载引擎** routes even
that allowlist through the engine. Static DASH support depends on the built-in planner.
HLS download support in 0.2.5 covers clear static VOD, including masters with a
separate audio rendition; live, encrypted, discontinuous, and nested
separate-audio playlists fail closed instead of handing a network URL to FFmpeg.

The installer records FFmpeg as `FLUXCATCH_FFMPEG`. Advanced users may override the output directory with `FLUXCATCH_DOWNLOAD_DIR`. The stable GitHub profile exposes no YouTube or yt-dlp controls and never launches an external tool with a network URL. Installing yt-dlp does not alter the capability profile.

From a source checkout, uninstall the host with:

```bash
./scripts/native-uninstall-wrapper.sh
```

The native-host ZIP provides the equivalent root command
`./uninstall-macos.sh`.

The uninstaller removes the FluxCatch runtime and its registered Native Messaging manifest. It removes only known host files and leaves every Downloads directory untouched.

Downloaded files remain in `~/Downloads/FluxCatch/` until the user deletes them. Uninstalling the native host never removes downloaded media.

## Chrome Web Store ID workflow

1. Upload a development ZIP only as a draft and do not publish it.
2. Record the dashboard Item ID and public key outside source control.
3. Add a separate store build identity; keep the checked-in development key and origin intact.
4. Generate the store manifest and native-host `allowed_origins` from that one identity source, using `chrome-extension://STORE_EXTENSION_ID/` exactly.
5. Confirm `io.github.blanchot_alice.fluxcatch` is synchronized across the generated extension, host manifest, installer, validator, tests, and documentation.
6. Run validation, the full test suite, `npm run package`, and
   `npm run verify:package` against both identities. CI must retain the exact
   package set and run Chrome E2E against the unpacked extension ZIP.
7. Install the generated store native host and verify `ping` from the store-installed extension.

Native Messaging origins do not support wildcards. Until the separate store identity/build exists, no file produced by this repository should be submitted as a final store release. Treat any signing private key as a secret and keep it outside the repository.
