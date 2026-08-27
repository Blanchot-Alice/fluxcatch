# FluxCatch native engine for macOS

This archive is the local engine for the matching FluxCatch extension version.
Detection works without it, but most save actions use its policy-controlled
transfer path. HLS/DASH processing, parallel Range transfers, remuxing, and MP3
extraction also use this engine. Only the extension's narrow, provenance-checked
Instagram/X MP4 allowlist may save through Chrome without the engine, and the
**可信直链也使用本地下载引擎** setting routes even those files through it.

## Requirements

- macOS with Google Chrome, Chrome for Testing, or Chromium;
- Python 3.9 or newer;
- FFmpeg for merge, remux, and MP3 operations.

The packaged installer checks the Python version before changing any files.

## Install

Extract the complete archive, open Terminal in the extracted directory, and run:

```bash
./install-macos.sh
```

Do not move individual files out of the extracted directory before installation.
The wrapper verifies Python and then installs the versioned files under
`~/Library/Application Support/FluxCatch/`.

After installation, reload FluxCatch from `chrome://extensions`, open Settings,
authorize the optional local download engine, and choose **Recheck**.

## Uninstall

From the same extracted archive, run:

```bash
./uninstall-macos.sh
```

Downloaded media is not removed.

## Verification and policy

Verify this archive against the adjacent `SHA256SUMS` file before installing.
The release checksum covers the complete ZIP; the installer never downloads
executable code.

See [INSTALL.md](INSTALL.md), [PRIVACY.md](../PRIVACY.md),
[ACCEPTABLE_USE.md](../ACCEPTABLE_USE.md), and [LICENSE](../LICENSE).
