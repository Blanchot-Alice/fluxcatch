# FluxCatch architecture

## Detection pipeline

1. `webRequest` classifies response URLs, MIME types, size, Range support, and content-disposition metadata.
2. A gated, top-frame content script reads `video`, `audio`, `source`, and allowlisted site payloads. Script nodes are scanned once and mutation work is batched.
3. The service worker validates isolated-world messages, records candidate provenance, and stores only an explicit persisted-candidate allowlist per tab in `chrome.storage.session`. Stable, allowlisted page identity parameters may remain; media resources with other query parameters and separately modelled signed track URLs stay memory-only instead of persisting reversible access tokens.
4. HLS and DASH parsers expose manifest metadata to the popup and Side Panel. Protected manifests remain metadata-only.
5. A bounded, redacted job snapshot (maximum 200 entries) stays in session storage so popup closure and service-worker suspension do not erase current task status.

Bilibili uses a `blob:` MediaSource and separate complete video/audio `.m4s` tracks rather than exposing an MPD URL. For a supported Bilibili `/video/` tab, FluxCatch combines public playback metadata with tracks actually observed by `webRequest`, groups them by page/document and immutable asset family, and publishes one `dash_pair` candidate. Metadata enrichment runs only after the popup or Side Panel opens, an explicit rescan, or the off-by-default automatic-enrichment setting. Exact signed CDN addresses and per-track headers stay in bounded worker memory for two minutes. UI and session storage receive only the stable page address, redacted track metadata, and opaque quality selectors.

Request headers are first associated by `requestId`. Only requests classified as media are promoted to the short-lived per-tab download cache. The cache is memory-only, bounded, expires after five minutes, and is removed early after its native task reaches a terminal state.

## Download backends

### Chrome backend

Ordinary single files use `chrome.downloads.download` only after FluxCatch observed the final media response in that tab. DOM hints, site payloads, and user-supplied URLs require the controlled native path instead. Chrome handles cookies, redirects, filename conflicts, user warnings, and its normal download lifecycle for eligible browser downloads.

### Native backend

- Native Messaging host: `io.github.blanchot_alice.fluxcatch`.
- `nativeMessaging` is optional and requested from an explicit user gesture in the download dialog, Side Panel quick-download action, or Settings authorization control.
- Control protocol: four-byte native-endian length followed by JSON.
- Media bytes never travel through the Native Messaging channel.
- HTTP Range responses require a matching `206` and `Content-Range`.
- Version-2 multipart checkpoints bind SHA-256 digests of the canonical URL and entity validators, plus length and completed ranges. Legacy checkpoints are discarded; full URLs, paths, query strings, fragments, raw validator values, and request headers are never persisted.
- Clear static HLS VOD playlists use the pinned native HTTP client for manifests and segments; FFmpeg receives local files only for remuxing or MP3 extraction. Live, AES-128/SAMPLE-AES, DRM, discontinuity, and separate-audio HLS structures fail closed pending support through the same pinned client.
- DASH network reads always use the local static-manifest planner and pinned HTTP client; FFmpeg is used only on the downloaded local tracks. Unsupported MPD structures fail with a specific capability error.
- Direct DASH pairs use `mediaKind: "dash_pair"`: the selected video URL is `url`, the selected audio URL is `options.audioUrl`, optional `options.audioHeaders` remains scoped only to that audio URL, and `options.expiresAt` carries the earliest signed-URL expiry as Unix seconds or JavaScript milliseconds. Expiry is checked after executor queueing and again immediately before each track starts. Both complete tracks transfer in parallel before FFmpeg publishes an MP4 with stream copy; MP3 output downloads only the audio track before local encoding.
- Signed DASH-pair transfers deliberately disable multipart resume checkpoints, so `upsig`, `deadline`, `token`, and other query parameters never reach crash-persistent checkpoint JSON. Host startup removes legacy `.fluxcatch-dash-pair-*` work directories before accepting jobs.
- Completed output is staged privately and published without overwriting an existing path.

## Trust boundaries

- Only credential-free `http:` and `https:` resource URLs are accepted.
- A shared NetworkPolicy classifies each active request by purpose, provenance, and scope. DOM hints and site payloads cannot trigger arbitrary fetches; automatic manifest probes require an observed response, and adapter metadata uses fixed code-defined endpoints.
- Public-network scope is the default. The extension rejects unsafe literal targets and untrusted active-fetch provenance; the native client checks DNS answers, pins the connected peer, and rechecks redirects and manifest children against loopback, private, link-local, multicast, unspecified, reserved, and metadata ranges. Explicit local-network opt-in does not permit metadata or reserved ranges. External processes receive local files only and cannot bypass the connector by opening network inputs.
- Thumbnail requests are same-page, same-observed-media-origin, or adapter-image-host only and reject redirects; query-bearing preview URLs are removed at the UI/session boundary, and rejection falls back to the existing media-type artwork.
- The native host accepts no shell commands and no caller-chosen output directory.
- Only a small allowlist of request headers can cross to the native host.
- Sensitive headers are removed on cross-origin redirects and manifest-introduced subresources.
- Direct DASH video/audio header sets are isolated, Cookies are excluded, and video credentials are never inherited by a cross-origin audio URL.
- Manifest and Native Messaging payload sizes are bounded.
- DRM, AES-128, SAMPLE-AES, and CENC are rejected; 0.2.4 does not download HLS key material.
- Store-policy platform blocks are enforced both when candidates are registered and when downloads start.

## Performance model

| Setting | Default | Range |
|---|---:|---:|
| HLS fragment workers | 8 | 1–24 |
| Direct Range workers | 8 | 1–24 |
| Native jobs | 4 | fixed |
| Range chunk target | 8 MiB; 32 MiB for large files | automatic |
| Progress events | at most 4/s | fixed |

Displayed byte speed is the task-wide byte average for byte-preserving transfers. FFmpeg MP3 jobs instead report processed media time and an `×` real-time multiplier: FFmpeg exposes encoded output size, which is roughly the MP3 bitrate and is not source-network throughput. Supported HLS VOD progress uses the finite sum of validated `EXTINF` durations. Live HLS is rejected in 0.2.4. A local fixture confirms mechanics, not public-internet throughput.
