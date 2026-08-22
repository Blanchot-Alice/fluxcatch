# Changelog

## 0.2.4 — 2026-08-23

- Added fail-closed extension and native NetworkPolicy gates for active targets, redirects, DNS results, manifest children, and thumbnails; native HTTP connections pin authorized peers, private-network media requires explicit opt-in, and metadata/reserved ranges remain blocked. FFmpeg remains available for local post-processing, while direct FFmpeg/yt-dlp network input is gated until a pinned broker exists.
- Replaced crash-resume URLs with version-2 checkpoints containing only SHA-256 digests of the URL and entity validators, plus length and completed byte ranges; legacy checkpoints are discarded.
- Replaced denylist-style candidate exposure with explicit UI/session field allowlists and opaque handling for paired DASH selections.
- Kept passive detection as the default: Bilibili quality enrichment now runs only after the popup or Side Panel opens, a manual rescan, or the off-by-default automatic-enrichment setting.
- Removed the unsupported Bilibili bangumi matcher, routed Side Panel YouTube actions through the guarded settings flow, and bounded/batched content-script payload scanning.
- Made the current HLS boundary explicit in code and UI: only clear static VOD is downloadable in 0.2.4; live, AES-128/SAMPLE-AES, discontinuity, and separate-audio playlists fail closed.
- Expanded security and lifecycle regression tests and made native tests, Python compilation, validation, and pinned Chrome for Testing E2E mandatory CI jobs.

## 0.2.3 — 2026-08-21

- Detect Bilibili's MediaSource playback as one paired DASH item instead of discarding its separate `.m4s` video and audio tracks.
- Expose available Bilibili resolutions through opaque selectors while keeping signed CDN addresses and per-track headers out of UI messages and session storage.
- Download paired DASH tracks with isolated request headers, parallel Range transfers, and local FFmpeg stream-copy merging; MP3 mode downloads only the audio track.
- Replace the task-title flex row with bounded two-column grids in both popup and Side Panel so long hashes cannot displace the status label.

## 0.2.2 — 2026-08-21

- Clear completed, failed, and cancelled task rows when the last popup closes while preserving active downloads.
- Make “Clear records” remove current-page detections and ended task history together, with explicit feedback when active tasks remain.
- Keep long filenames from pushing task states outside the popup, count every visible task, and compact ended task cards.
- Extend the deterministic task-lifecycle regression flow for clearing, popup close/reopen, and long-filename layout.

## 0.2.1 — 2026-08-20

- Fold HLS master playlists and their cross-CDN rendition URLs into one video entry while keeping independently detected videos separate.
- Recognize HLS caption/text-track playlists so they no longer appear as duplicate downloadable videos.
- Keep all discovered quality choices on the master entry and replace internal media-pipeline names with the readable page title.
- Center the download settings dialog in the real popup viewport and add a production-shaped Wistia regression flow.

## 0.2.0 — 2026-08-20

- Completed FluxCatch naming across release metadata, public documentation, packaging, and native-host user-visible surfaces.
- Moved native-host installations and advanced downloads to FluxCatch directories with `FLUXCATCH_FFMPEG` and `FLUXCATCH_DOWNLOAD_DIR` configuration.
- Adopted the owned Native Messaging name `io.github.blanchot_alice.fluxcatch` while keeping the checked-in manifest key and development extension ID stable.
- Added a persistent Side Panel workspace with current-page media, quick download, host status, redacted session task history, progress, cancellation, and completed-task cleanup.
- Added explicit Settings authorization for the optional native engine, keyboard/ARIA/contrast/reduced-motion fixes, and transparent toolbar icons that remain legible on light and dark Chrome themes.
- Extended Chrome for Testing E2E to render and assert Options, popup, and Side Panel pages, perform a hashed Chrome direct-download check, and verify direct/HLS/DASH detection.

- Brand refresh: renamed the extension to FluxCatch.
- Adopted the approved Monet palette (morning-mist lily pond): light canvas `#F1F2F2`, soft surface, pool-green primary `#5E8F84`, pink/blue/gold accents, and matching dark-mode tokens.
- Added the approved viewfinder logo (`extension/icons/fluxcatch-mark.svg`) and regenerated the toolbar icons at 16/32/48/128 px.
- Redesigned the popup: FluxCatch brand top bar, segmented media/jobs views, media cards with type-colored chips (HLS mist-blue / HD rise-gold / format pond-green / live lily-pink), pure-color job progress bars, and a data-aware ripple empty state.
- Replaced the old popup footer bar with a quiet text-action row (open media workspace / downloads folder / clear results).
- Redesigned the options page as card sections with Monet tokens and toggle switches.
- Version pinned to 0.2.0; manifest `key` untouched so the installed native-host extension ID is preserved.
- Reduced request-header retention and associated headers by request ID.
- Added immutable Chrome Web Store platform restrictions.
- Made notification and Native Messaging permissions optional.
- Hardened HLS protection-state and alternate-audio validation.
- Removed the unused MAIN-world page monkey patch; network detection now uses `webRequest` and isolated DOM observation.
- Added exact FFmpeg capability reporting and a fail-closed static DASH planner.
- Added strict Chrome for Testing detection E2E and release ZIP checksums.
- Prevented sensitive request headers from crossing redirect or manifest-introduced origins.
- Added release, privacy, security, and store-listing documentation.

## 0.1.0 — 2026-08-19

- Initial beta with direct media, HLS, DASH metadata, native parallel downloads, remuxing, and audio extraction.
