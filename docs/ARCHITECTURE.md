# FluxCatch architecture

## Detection pipeline

1. `webRequest` classifies response URLs, MIME types, size, Range support, and content-disposition metadata.
2. A content script reads `video`, `audio`, `source`, and relevant page metadata.
3. The service worker validates isolated-world messages and stores a bounded candidate registry per tab in `chrome.storage.session`.
4. HLS and DASH parsers expose manifest metadata to the popup and Side Panel. Protected manifests remain metadata-only.
5. A bounded, redacted job snapshot (maximum 200 entries) stays in session storage so popup closure and service-worker suspension do not erase current task status.

Bilibili uses a `blob:` MediaSource and separate complete video/audio `.m4s` tracks rather than exposing an MPD URL. For a Bilibili video tab, FluxCatch combines public playback metadata with the tracks actually observed by `webRequest`, groups them by page/document and immutable asset family, and publishes one `dash_pair` candidate. Exact signed CDN addresses and per-track headers stay in bounded worker memory for two minutes. UI and session storage receive only the stable page address, redacted track metadata, and opaque quality selectors.

Request headers are first associated by `requestId`. Only requests classified as media are promoted to the short-lived per-tab download cache. The cache is memory-only, bounded, expires after five minutes, and is removed early after its native task reaches a terminal state.

## Download backends

### Chrome backend

Ordinary single files use `chrome.downloads.download`. Chrome handles cookies, filename conflicts, user warnings, and its normal download lifecycle.

### Native backend

- Native Messaging host: `io.github.blanchot_alice.fluxcatch`.
- `nativeMessaging` is optional and requested from an explicit user gesture in the download dialog, Side Panel quick-download action, or Settings authorization control.
- Control protocol: four-byte native-endian length followed by JSON.
- Media bytes never travel through the Native Messaging channel.
- HTTP Range responses require a matching `206` and `Content-Range`.
- Multipart checkpoints bind URL, entity identity, length, and completed ranges.
- Simple HLS VOD playlists use concurrent segment transfers; advanced profiles use FFmpeg when supported.
- DASH support is determined by an explicit capability probe and, where supported, a local static-manifest planner.
- Direct DASH pairs use `mediaKind: "dash_pair"`: the selected video URL is `url`, the selected audio URL is `options.audioUrl`, optional `options.audioHeaders` remains scoped only to that audio URL, and `options.expiresAt` carries the earliest signed-URL expiry as Unix seconds or JavaScript milliseconds. Expiry is checked after executor queueing and again immediately before each track starts. Both complete tracks transfer in parallel before FFmpeg publishes an MP4 with stream copy; MP3 output downloads only the audio track before local encoding.
- Signed DASH-pair transfers deliberately disable multipart resume checkpoints, so `upsig`, `deadline`, `token`, and other query parameters never reach crash-persistent checkpoint JSON. Host startup removes legacy `.fluxcatch-dash-pair-*` work directories before accepting jobs.
- Completed output is staged privately and published without overwriting an existing path.

## Trust boundaries

- Only credential-free `http:` and `https:` resource URLs are accepted.
- The native host accepts no shell commands and no caller-chosen output directory.
- Only a small allowlist of request headers can cross to the native host.
- Sensitive headers are removed on cross-origin redirects and manifest-introduced subresources.
- Direct DASH video/audio header sets are isolated, Cookies are excluded, and video credentials are never inherited by a cross-origin audio URL.
- Manifest and Native Messaging payload sizes are bounded.
- DRM, SAMPLE-AES, and CENC are rejected.
- Store-policy platform blocks are enforced both when candidates are registered and when downloads start.

## Performance model

| Setting | Default | Range |
|---|---:|---:|
| HLS fragment workers | 8 | 1–24 |
| Direct Range workers | 8 | 1–24 |
| Native jobs | 4 | fixed |
| Range chunk target | 8 MiB; 32 MiB for large files | automatic |
| Progress events | at most 4/s | fixed |

Displayed byte speed is the task-wide byte average for byte-preserving transfers. FFmpeg MP3 jobs instead report processed media time and an `×` real-time multiplier: FFmpeg exposes encoded output size, which is roughly the MP3 bitrate and is not source-network throughput. HLS VOD progress uses the finite sum of validated `EXTINF` durations; an unlimited live stream remains indeterminate. A local fixture confirms mechanics, not public-internet throughput.
