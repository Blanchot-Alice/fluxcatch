# Detection E2E

Run the dependency-free Chrome for Testing suite with:

```bash
npm run test:e2e
```

Set `CHROME_PATH` when Chrome for Testing is not in the Playwright cache or a standard macOS location.

The runner creates a fresh profile and loopback fixture server, verifies the runtime extension ID/name/version, renders the Options, popup, and Side Panel extension pages at fixed viewports, checks their critical controls/ARIA/tab behavior/overflow, and writes local screenshots. The Side Panel case renders a real detected media row, loads its preview through the credential-free thumbnail path, starts a Chrome direct download, waits for its terminal job state, and verifies the saved bytes and SHA-256. It then clears and binds each detection case to a distinct tab and makes strict assertions for direct media, HLS, and DASH detection.

The HLS fixture mirrors the production-shaped Wistia case rather than using neat same-origin URLs. Its master is requested from a separate `localhost` "fast" host, while five observed rendition URLs use CDN-shaped `/deliveries/` paths and signed-query values that differ from the URLs referenced by the master. The page also requests an `/embed/captions/<id>.m3u8` subtitle playlist and exposes an internal `an_PHRM_…` asset token beside a readable lesson title. The test strictly requires all of that traffic to become exactly one visible video, keeps the fast-host master as its representative, excludes the caption playlist, uses the readable page title rather than the internal token, and preserves all five real quality choices.

The popup flow then opens the master download dialog at the extension's real `372 × 560` CSS-pixel viewport and asserts that it offers automatic plus five explicit quality choices, the card title and filename both derive from the readable page title, `MP3（仅音频）` is a normal output format, and the redundant parse/audio/concurrency controls are absent. It also measures `getBoundingClientRect()` against that viewport and requires the dialog to be geometrically centered on both axes (within 2 CSS pixels) and fully visible. Failures, missing browser binaries, timeouts, duplicate candidates, caption false positives, internal-token filenames, off-center dialogs, and missing controls return a non-zero exit code.

The task-lifecycle flow uses real Chrome browser downloads at the same `372 × 560` popup viewport. It renders long-filename completed, cancelled, and active jobs; requires every state label and card to remain inside the viewport without horizontal overflow; and requires the task badge to count every visible card. Clicking **清空检测结果** must clear the active tab's detected media and all terminal (`completed`, `failed`, `cancelled`) jobs while preserving active downloads. The test then creates another cancelled terminal state, closes the last popup, and reopens it: the terminal job must be gone while the still-running job remains. Slow loopback responses keep active jobs deterministic until explicit cleanup.

The latest local JSON result is written to `e2e/artifacts/latest.json`, with UI screenshots under `e2e/artifacts/screenshots/`; machine-specific paths are redacted, and artifacts and temporary profiles are ignored by Git.

## Evidence boundary

This suite validates generic detection, token-insensitive cross-host master/rendition grouping, subtitle-playlist exclusion, the popup HLS settings flow and dialog geometry, popup task cleanup/session semantics, direct rendering of the three extension pages, and ordinary Chrome-backed direct downloads (including one byte/hash assertion). `localhost` and `127.0.0.1` stand in for separate fast/CDN hosts; this proves relation logic against the fixture shape, not production DNS behavior. Directly opening the Side Panel document does not validate Chrome's surrounding Side Panel shell or a manual toolbar-open gesture. The suite does not establish native-host installation, HLS/DASH output validity, Range concurrency, public-network throughput, or compatibility with arbitrary websites. Those require separate native download fixtures and performance benchmarks with request-level server telemetry.
