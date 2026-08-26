# Detection E2E

Run the dependency-free Chrome for Testing suite with:

```bash
npm run test:e2e
```

GitHub Actions 在固定的 `macos-14` runner 上运行同一套测试，Chrome for Testing 版本与 `CHROME_PATH` 均由工作流显式固定。CI 先在 fast job 中生成并验证唯一一组 ZIP，再下载该 artifact、解压 extension ZIP，并通过 `FLUXCATCH_EXTENSION_DIR` 与 `FLUXCATCH_EXPECTED_BUILD_COMMIT` 对实际交付内容运行浏览器门槛；browser job 不再重新构建扩展。

Set `CHROME_PATH` when Chrome for Testing is not in the Playwright cache or a standard macOS location.

To reproduce the packaged-extension boundary locally from a clean checkout:

```bash
npm run package
npm run verify:package
rm -rf /tmp/fluxcatch-packaged-extension
mkdir -p /tmp/fluxcatch-packaged-extension
unzip -q dist/fluxcatch-extension-*.zip -d /tmp/fluxcatch-packaged-extension
FLUXCATCH_EXTENSION_DIR=/tmp/fluxcatch-packaged-extension \
FLUXCATCH_EXPECTED_BUILD_COMMIT="$(git rev-parse --short=12 HEAD)" \
npm run test:e2e
```

The runner creates a fresh profile and loopback fixture server, verifies the runtime extension ID/name/version plus build identity and capability profile, renders the Options, popup, and Side Panel extension pages at fixed viewports, checks their critical controls/ARIA/tab behavior/overflow, and writes local screenshots. The fixture supplies page-derived preview metadata, while Popup and Side Panel must keep the stable media-type fallback tile and create no `.media-thumbnail`; a unit gate separately proves that `remoteThumbnails=false` performs zero fetch calls. Generic observed direct media must show the native-engine preflight rather than a Chrome-download promise. The suite also sends the same opaque candidate reference directly to the background worker to prove that a fresh profile without native authorization fails closed, creates no task, and writes no browser file. It asserts that stable Options contains no YouTube, yt-dlp, or live-HLS controls, then clears and binds each detection case to a distinct tab and makes strict assertions for direct media, HLS, and DASH detection.

Before creating any fixture tab, the runner asserts that **允许本地网络媒体** defaults to off and then explicitly enables it only inside the disposable E2E profile. This is required because all fixture traffic uses loopback addresses; the profile is deleted at the end and the product default remains public-network-only.

The HLS fixture mirrors the production-shaped Wistia case rather than using neat same-origin URLs. Its master is requested from a separate `localhost` "fast" host, while five observed rendition URLs use CDN-shaped `/deliveries/` paths and signed-query values that differ from the URLs referenced by the master. The page also requests an `/embed/captions/<id>.m3u8` subtitle playlist and exposes an internal `an_PHRM_…` asset token beside a readable lesson title. The test strictly requires all of that traffic to become exactly one visible video, keeps the fast-host master as its representative, excludes the caption playlist, uses the readable page title rather than the internal token, and preserves all five real quality choices.

The popup flow then opens the master download dialog at the extension's real `372 × 560` CSS-pixel viewport and asserts that it offers automatic plus five explicit quality choices, the card title and filename both derive from the readable page title, `MP3（需本地下载引擎）` is a normal output format, and the redundant parse/audio/concurrency controls are absent. It also measures `getBoundingClientRect()` against that viewport and requires the dialog to be geometrically centered on both axes (within 2 CSS pixels) and fully visible. Failures, missing browser binaries, timeouts, duplicate candidates, caption false positives, internal-token filenames, off-center dialogs, and missing controls return a non-zero exit code.

The latest local JSON result is written to `e2e/artifacts/latest.json`, with UI screenshots under `e2e/artifacts/screenshots/`; machine-specific paths are redacted, and artifacts and temporary profiles are ignored by Git. A complete 0.2.5 run contains 3 detection cases, 3 UI pages, 3 interaction flows, and 13 deterministic visual states.

## Evidence boundary

This suite validates generic detection, token-insensitive cross-host master/rendition grouping, subtitle-playlist exclusion, runtime build/profile identity, stable capability controls and fallback tiles, the popup HLS settings flow and dialog geometry, the generic native-authorization fail-closed boundary, direct rendering of the three extension pages, and manifest-loading behavior. `localhost` and `127.0.0.1` stand in for separate fast/CDN hosts; this proves relation logic against the fixture shape, not production DNS behavior. Directly opening the Side Panel document does not validate Chrome's surrounding Side Panel shell or a manual toolbar-open gesture. The suite does not yet exercise full Bilibili/Instagram/X adapter journeys, including real SPA navigation, worker-restart restoration, the default strict Instagram/X Chrome route, the `useNativeForDirect=true` Native override, `saveAs` isolation, or saved-byte assertions; those capabilities remain adapter beta. It does not exercise the source-only experimental YouTube/yt-dlp implementation; it verifies only that the stable profile does not expose it. It also does not establish native-host installation, HLS/DASH output validity, Range concurrency, public-network throughput, task-list session semantics, or compatibility with arbitrary websites. Those require separate native download fixtures and performance benchmarks with request-level server telemetry.
