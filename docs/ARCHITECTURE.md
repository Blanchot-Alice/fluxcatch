# FluxCatch architecture

## Detection pipeline

1. `webRequest` classifies response URLs, MIME types, size, Range support, and content-disposition metadata.
2. A gated, top-frame content script reads `video`, `audio`, `source`, and allowlisted site payloads. Script nodes are scanned once and mutation work is batched.
3. The service worker validates isolated-world messages, records candidate provenance, and stores only an explicit persisted-candidate allowlist per tab in `chrome.storage.session`. Stable, allowlisted page identity parameters may remain; media resources with other query parameters and separately modelled signed track URLs stay memory-only instead of persisting reversible access tokens. Extension pages receive a `PublicCandidate` containing a non-executable `displayUrl`, redaction/copyability state, and opaque `id`, `kind`, and `generation`. Probe/download actions send only that reference; the service worker re-resolves the current private candidate and never accepts `displayUrl` as the target.
4. HLS and DASH parsers expose manifest metadata to the popup and Side Panel. Protected manifests remain metadata-only.
5. A bounded, redacted job snapshot (maximum 200 entries) stays in session storage so popup closure and service-worker suspension do not erase current task status.

Bilibili uses a `blob:` MediaSource and separate complete video/audio `.m4s` tracks rather than exposing an MPD URL. For a supported Bilibili `/video/` tab, FluxCatch combines public playback metadata with tracks actually observed by `webRequest`, groups them by page/document and immutable asset family, and publishes one `dash_pair` candidate. Metadata enrichment runs only after the popup or Side Panel opens, an explicit rescan, or the off-by-default automatic-enrichment setting. Exact signed CDN addresses and per-track headers stay in bounded worker memory for two minutes. UI and session storage receive only the stable page address, redacted track metadata, and opaque quality selectors.

Request headers are first associated by `requestId`. Only requests classified as media are promoted to the short-lived per-tab download cache. The cache is memory-only, bounded, expires after five minutes, and is removed early after its native task reaches a terminal state.

## Interface layer

FluxCatch keeps the extension interface buildless and packaged with the
extension. `extension/ui/tokens.css` defines the shared color, type, spacing,
radius, control, focus, shadow, and motion values. `extension/ui/components.css`
implements reusable controls and status primitives, while each page stylesheet
owns only its layout and surface-specific composition. Shared asynchronous
interaction helpers live in `extension/ui/interactions.js`; they serialize the
same named action, keep control width stable while pending, expose `aria-busy`,
and restore focus without changing any background/native protocol.

Settings is a normalized form rather than a direct view of storage. On load it
creates an allowlisted baseline, compares normalized values after input, and
writes only validated setting fields. Concurrency is bounded to 1–24, minimum
media size to 0–102400 KiB, filename placeholders to the documented token set,
and ignored domains are normalized and validated line by line. URLs, request
headers, opaque candidate references, signed tokens, and other security-sensitive
transfer state are not part of the form model or persistent UI state.

Optional notification and Native Messaging permissions are requested from the
originating switch or button gesture. Local-network media access remains a
separate explicit setting with an additional confirmation; enabling it does not
relax metadata, link-local, multicast, unspecified, or reserved-address blocks.
If Chrome revokes a previously granted notification permission outside
FluxCatch, Settings repairs the now-ineffective saved notification preference
to off before establishing its clean form baseline; granting it again therefore
cannot bypass the explicit Save step.
The capability matrix distinguishes installation, connection, protocol
compatibility, local processing, external-tool networking gates, and actual
build availability. Stable-profile Lab entries are explanatory roadmap states,
not disabled controls that imply hidden functionality.

Popup and Side Panel retain the same `PublicCandidate` and job DTO boundaries.
Their pending states, typed toasts, local manifest-card loading, and focus
restoration are presentation behavior only; they do not create a new fetch path
or persist private targets. Responsive, dark-mode, reduced-motion, keyboard, and
long-text behavior is verified against deterministic Chrome for Testing
fixtures before a product-interface release is marked ready.

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
- Clear static HLS VOD playlists use the pinned native HTTP client for manifests and segments; FFmpeg receives local files only for remuxing or MP3 extraction. Relative manifests and segments resolve from each final response URL. Live, AES-128/SAMPLE-AES, DRM, discontinuity, and separate-audio HLS structures fail closed pending support through the same pinned client.
- DASH network reads always use the local static-manifest planner and pinned HTTP client; relative resources resolve from the final MPD response URL and FFmpeg is used only on downloaded local tracks. Unsupported MPD structures fail with a specific capability error.
- Direct DASH pairs use `mediaKind: "dash_pair"`: the selected video URL is `url`, the selected audio URL is `options.audioUrl`, optional `options.audioHeaders` remains scoped only to that audio URL, and `options.expiresAt` carries the earliest signed-URL expiry as Unix seconds or JavaScript milliseconds. Expiry is checked after executor queueing and again immediately before each track starts. Both complete tracks transfer in parallel before FFmpeg publishes an MP4 with stream copy; MP3 output downloads only the audio track before local encoding.
- Signed DASH-pair transfers deliberately disable multipart resume checkpoints, so `upsig`, `deadline`, `token`, and other query parameters never reach crash-persistent checkpoint JSON. Host startup removes legacy `.fluxcatch-dash-pair-*` work directories before accepting jobs.
- Completed output is staged privately and published without overwriting an existing path.

## Trust boundaries

- Active targets must use `http:` or `https:` and must not contain URL username/password credentials. Signed query URLs may exist only in private worker/native task state and are represented to extension pages by redacted display metadata and opaque references.
- Both layers follow the same purpose/provenance/scope model but expose different security primitives. DOM hints and site payloads cannot trigger arbitrary fetches; automatic manifest probes require an observed response, and adapter metadata uses fixed code-defined endpoints. The extension validates schemes, literal hosts/IPs, provenance, purpose, origin allowlists, and user gestures; browser APIs do not expose DNS answers or the connected socket peer.
- Public-network scope is the default. The native client validates DNS answers, pins the authorized peer, and rechecks redirects and manifest children against loopback, private, link-local, multicast, unspecified, reserved, and metadata ranges. Explicit local-network opt-in does not permit metadata or reserved ranges. External processes receive local files only and cannot bypass the connector by opening network inputs.
- The stable profile has `remoteThumbnails=false`. Popup and Side Panel render packaged media-type tiles and make no page-derived preview request. The retained bounded raster-fetch implementation belongs to a future experimental profile and does not carry native DNS/peer guarantees.
- The native host accepts no shell commands and no caller-chosen output directory.
- Native downloads fail closed when extension version, native version, protocol version, or capability-profile version is missing or mismatched; ping and bounded diagnostics remain available to explain the mismatch.
- Only a small allowlist of request headers can cross to the native host.
- During native transfers, sensitive headers are removed on cross-origin redirects and manifest-introduced subresources. The effective header set can only lose credentials, so an A→B→A chain cannot restore them.
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
