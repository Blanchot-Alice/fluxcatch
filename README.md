# FluxCatch

FluxCatch is a local-first Manifest V3 Chrome extension that detects media resources requested by the current page and lets the user save selected files locally. An optional macOS native host adds parallel Range transfers, HLS processing, remuxing, and audio extraction.

## Interface

| Toolbar popup | Media workspace |
| --- | --- |
| ![FluxCatch toolbar popup](docs/assets/popup.png) | ![FluxCatch media workspace](docs/assets/sidepanel.png) |

![FluxCatch settings](docs/assets/options.png)

## Current capabilities

- Detect direct video/audio resources from response metadata and media elements.
- Detect and inspect HLS (`m3u8`) and MPEG-DASH (`mpd`) manifests.
- Detect the separate DASH video/audio tracks used by supported Bilibili pages and combine a selected quality into one MP4.
- Select HLS variants and download ordinary VOD playlists concurrently.
- Use Chrome for ordinary single-file downloads.
- Use the native host for parallel Range downloads, live HLS capture, remuxing, and MP3 extraction.
- Keep current-session download jobs visible across popup/service-worker restarts and expose a persistent Side Panel workbench.
- Reject DRM/SAMPLE-AES/CENC content rather than attempting decryption.
- Keep observed resource metadata and selected request headers on the local device.

## Release status

Version 0.2.x is beta software. The generic detection and download core is tested; real-site compatibility varies with each player, CDN, authentication scheme, and manifest profile. Current releases do not promise universal site support or a speed advantage over Chrome.

The Chrome Web Store build does not offer downloads from platforms prohibited by store policy. FluxCatch is intended for media that the user owns or is permitted to save. See [Acceptable Use](ACCEPTABLE_USE.md).

## Quick start

1. Clone or download this repository.
2. Open `chrome://extensions`, enable **Developer mode**, choose **Load unpacked**, and select `extension/`.
3. For advanced downloads on macOS, run:

   ```bash
   ./native-host/install-macos.sh
   ```

4. Reload FluxCatch, open a page that is playing media, and open the toolbar popup. Use **Open media workspace** for the persistent Side Panel.

See [Installation](docs/INSTALL.md) for native-host and Chrome Web Store ID details.

## Development

```bash
npm test
python3 -m unittest discover -s native-host/tests -v
python3 scripts/validate.py
npm run package
```

A Chrome for Testing detection suite is available through `npm run test:e2e` when a compatible browser binary is installed.

## Documentation

- [Architecture](docs/ARCHITECTURE.md)
- [Installation](docs/INSTALL.md)
- [Release readiness](docs/RELEASE.md)
- [Chrome Web Store 发布检查单（中文）](docs/CHROME_WEB_STORE_CHECKLIST.zh-CN.md)
- [Detection E2E](e2e/README.md)
- [Chrome Web Store listing draft](docs/STORE_LISTING.md)
- [Privacy](PRIVACY.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE)
