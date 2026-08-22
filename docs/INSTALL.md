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

## Install the macOS native host

```bash
cd "$REPO_ROOT"
./native-host/install-macos.sh
```

The installer creates a private runtime copy under `~/Library/Application Support/FluxCatch/` and registers the host under Chrome's per-user `NativeMessagingHosts` directory. Reload the extension after installation.

Advanced downloads require Python 3.9+ and FFmpeg. FluxCatch uses its built-in pinned HTTP client for network transfers and gives FFmpeg local files only for merge, remux, and MP3 work. Static DASH support depends on the built-in planner. HLS download support in 0.2.4 is limited to clear static VOD; live, encrypted, discontinuous, and separate-audio playlists fail closed instead of handing a network URL to FFmpeg.

The installer records FFmpeg as `FLUXCATCH_FFMPEG`. Advanced users may override the output directory with `FLUXCATCH_DOWNLOAD_DIR`. In 0.2.4, yt-dlp network execution is intentionally disabled until a pinned external-tool broker is available.

Uninstall the host with:

```bash
./native-host/uninstall-macos.sh
```

The uninstaller removes the FluxCatch runtime and its registered Native Messaging manifest. It removes only known host files and leaves every Downloads directory untouched.

Downloaded files remain in `~/Downloads/FluxCatch/` until the user deletes them. Uninstalling the native host never removes downloaded media.

## Chrome Web Store ID workflow

1. Upload a development ZIP only as a draft and do not publish it.
2. Record the dashboard Item ID and public key outside source control.
3. Add a separate store build identity; keep the checked-in development key and origin intact.
4. Generate the store manifest and native-host `allowed_origins` from that one identity source, using `chrome-extension://STORE_EXTENSION_ID/` exactly.
5. Confirm `io.github.blanchot_alice.fluxcatch` is synchronized across the generated extension, host manifest, installer, validator, tests, and documentation.
6. Run validation, the full test suite, package inspection, and checksum verification against both identities.
7. Install the generated store native host and verify `ping` from the store-installed extension.

Native Messaging origins do not support wildcards. Until the separate store identity/build exists, no file produced by this repository should be submitted as a final store release. Treat any signing private key as a secret and keep it outside the repository.
