# Installation

## Release identity

FluxCatch uses the Native Messaging name `io.github.blanchot_alice.fluxcatch`. The checked-in manifest key keeps the development extension ID stable. Before the first public release, create the Chrome Web Store draft, copy its public key into `extension/manifest.json`, and synchronize the resulting Item ID with the host manifest's `allowed_origins`. The E2E runner derives its expected ID from the manifest key automatically.

## Load an unpacked development build

From the repository root:

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Choose **Load unpacked**.
4. Select `$REPO_ROOT/extension`.

The checked-in manifest public key keeps the development extension ID stable. A Chrome Web Store release must use the public key and Item ID issued for that store listing.

## Install the macOS native host

```bash
cd "$REPO_ROOT"
./native-host/install-macos.sh
```

The installer creates a private runtime copy under `~/Library/Application Support/FluxCatch/` and registers the host under Chrome's per-user `NativeMessagingHosts` directory. Reload the extension after installation.

Advanced downloads require Python 3.11+ and FFmpeg. FluxCatch probes actual FFmpeg demuxer/encoder capabilities; the presence of an `ffmpeg` executable alone does not guarantee DASH support.

The installer records FFmpeg as `FLUXCATCH_FFMPEG`. Advanced users may override the output directory with `FLUXCATCH_DOWNLOAD_DIR`.

Uninstall the host with:

```bash
./native-host/uninstall-macos.sh
```

The uninstaller removes the FluxCatch runtime and its registered Native Messaging manifest. It removes only known host files and leaves every Downloads directory untouched.

Downloaded files remain in `~/Downloads/FluxCatch/` until the user deletes them. Uninstalling the native host never removes downloaded media.

## Chrome Web Store ID workflow

1. Upload an initial extension ZIP as a draft.
2. Record the dashboard Item ID and public key.
3. Replace the development `manifest.key` with the store public key.
4. Confirm `io.github.blanchot_alice.fluxcatch` is synchronized across the extension, host manifest, installer, validator, tests, and documentation.
5. Update the native-host `allowed_origins` to `chrome-extension://STORE_EXTENSION_ID/`.
6. Run validation, the full test suite, and packaging again.
7. Install the resulting native host and verify `ping` from the store-installed extension.

Native Messaging origins do not support wildcards. Treat any signing private key as a secret and keep it outside the repository.
