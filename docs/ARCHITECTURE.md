# FluxCatch architecture

## Detection pipeline

1. `webRequest` classifies response URLs, MIME types, size, Range support, and content-disposition metadata.
2. A gated content script reads `video`, `audio`, `source`, and allowlisted inline site payloads; script nodes are scanned once and mutation work is batched. On top-level Instagram/X pages, small MAIN-world observers also clone eligible SPA JSON responses under strict byte/node/depth limits and post only allowlisted complete MP4 metadata to the isolated content script. The page's original response is never consumed or modified.
3. The service worker validates isolated-world messages, records candidate provenance, and stores only an explicit persisted-candidate allowlist per tab in `chrome.storage.session`. Stable, allowlisted page identity parameters may remain; media resources with other query parameters and separately modelled signed track URLs stay memory-only instead of persisting reversible access tokens. The Instagram/X isolated script retains a separate page-scoped cache capped at 256 entries and 15 minutes, allowing a still-open tab to repopulate a restarted MV3 worker without persistent storage. Extension pages receive a `PublicCandidate` containing a non-executable `displayUrl`, redaction/copyability state, and opaque `id`, `kind`, and `generation`. Probe/download actions send only that reference; the service worker re-resolves the current private candidate and never accepts `displayUrl` as the target.
4. HLS and DASH parsers expose manifest metadata to the popup and Side Panel. Protected manifests remain metadata-only.
5. A bounded, redacted job snapshot (maximum 200 entries) stays in session storage so popup closure and service-worker suspension do not erase current task status.

Bilibili uses a `blob:` MediaSource and separate complete video/audio `.m4s` tracks rather than exposing an MPD URL. For a supported Bilibili `/video/` tab, FluxCatch combines public playback metadata with tracks actually observed by `webRequest`, groups them by page/document and immutable asset family, and publishes one `dash_pair` candidate. Automatic enrichment defaults on but every automatic entry point checks `autoEnrichSiteQuality` before credentialed I/O. The first trusted playback/preload request starts the fixed-site lookup; repeated Range signals share an in-flight promise, successful discovery has a 45-second TTL, and failures wait at least five seconds before retrying. Turning the setting off blocks automatic enrichment, while an explicit rescan bypasses the automatic cooldown. Page completion and merely opening or closing popup/Side Panel remain read-only. Exact signed CDN addresses and per-track headers stay in bounded worker memory for two minutes. UI and session storage receive only the stable page address, redacted track metadata, and opaque quality selectors.

Three adult video sites get ladder adapters (`SITE_ADAPTERS` entries with `ladder: true`; parsing in `extension/lib/site-extract.js`, scanning in `content/content.js`). Each page names its own playlists in inline scripts: Pornhub keeps one signed HLS master per quality in the `flashvars_<id>` JSON (`mediaDefinitions`, plus the title, duration and poster); MissAV hides `source='…/playlist.m3u8'` inside a p,a,c,k,e,d-packed script, which the adapter decodes as data (no eval) and whose master lists the 360p–1080p renditions; Jable assigns an AES-128 media playlist to `hlsUrl`. The top-frame scanner reads a script only on a page whose route names one video, sends every rendition as an ordinary `CONTENT_MEDIA` HLS candidate carrying a `ladderKey` (`<site>:<video id>`) and its height, and keeps the page-scoped cache that lets a restarted worker re-ask the page. The worker accepts a ladder key only from the top frame of a page the adapter owns and only when the key names that adapter; `regroupHlsVariantGroups` then turns the key's members into one card whose quality menu holds opaque selectors, and the rendition the player is streaming (observed by `webRequest` under a fresher signature on the same path) joins that card instead of becoming a twin row. The card's title is the page's social-card or heading title with the site suffix removed; the worker records which source named a candidate (`titleRank`: page-supplied title, Content-Disposition filename, tab title, URL segment) so that a later observation with weaker naming, such as the player's own fetch of a declared address, keeps that title instead of re-deriving it from the tab title or the filesystem-safe filename. These CDNs answer 412/403 to bare requests, so the worker derives `adapterHeaders` (Referer and Origin from the page origin, the browser's own User-Agent, never a cookie) and hands them to the engine when no observed request headers exist for the URL. All ladder downloads take the native path; the dialog's ladder comes from the page even when the probed single-variant master lists one rendition.

The Economist Insider (subscriber video, `economist.com/insider/<show>/<episode>`) is a worker-side adapter in the Bilibili mould (`discoverEconomistInsider`). The site's own episode API, `GET /video-api/events/<slug>` on the page origin, is read with the browser session (`credentials: "include"`) on page completion (gated by `autoEnrichSiteQuality`, with a per-tab cooldown and a ten-minute TTL) and on an explicit rescan; it names Brightcove HLS masters that the site proxies under `/video-api/playback/hls.m3u8?u=<token>`, which the adapter accepts only on that origin and path. The worker fetches the master itself (the proxy answers 401 to anything without the session), keeps the text on the candidate as `manifestText` so the probe needs no second fetch, and publishes one HLS card named by the API with its duration and a `adapterExpiresAt` taken from the API's `manifest_url_ttl`. At download time the engine cannot present the session either, so `preloadEconomistManifests` re-reads the master and the chosen rendition playlist (`…&t=m`, also proxied) with the browser's credentials and sends their text as `options.preloadedManifests`; the engine (`preloaded_manifests`, `_PRELOADED_MANIFESTS`) accepts at most four same-origin HLS texts for the job and uses them in place of its own fetch for exactly those addresses, while the audio rendition (`manifest.prod.boltdns.net`, token-signed) and every fMP4 segment (`brightcovecdn.com`, token-signed) still go through the pinned client and the network policy. An expired token fails closed as `link_expired` and a rescan re-reads the API. Nothing is bypassed: the adapter only reaches what the signed-in subscriber's browser can already play.

YouTube publishes one `youtube` candidate per watch tab: the canonical watch URL itself, named after the video (the tab title without the site suffix, replaced by yt-dlp's title once probed). The row exists whenever the build carries the adapter (`externalToolNetwork`); whether the engine can act on it is answered at probe and download time through the job-failure codes (`engine_not_set_up`, `youtube_tool_missing`), never by hiding the row. Generic detection stays off `youtube.com` and `googlevideo.com` (`POLICY_BLOCKED_DOMAINS`), so no raw media URL from the player is ever a candidate. A pasted watch or `youtu.be` link in the link dialog takes the same path.

Request headers are first associated by `requestId`. Only requests classified as media are promoted to the short-lived per-tab download cache. The cache is memory-only, bounded, expires after five minutes, and is removed early after its native task reaches a terminal state.

## Interface layer

FluxCatch keeps the extension interface buildless and packaged with the
extension. Every surface is built on the v2 design system in `extension/ui/v2/`
(its `README.md` is the API reference): `tokens.css` holds the colour, type,
grid, shape and motion tokens, `system.css` the shared components, and the
builders in `components.js`, `controls.js` and `rows.js` emit only those
classes, while each page stylesheet owns only its layout. Copy comes from the
message modules in `messages/` through `messages.js`, in the one UI language
`locale.js` resolves. `runAction()` serializes the same named action and exposes
`aria-busy` without changing labels; `runtime.js` keeps each page's port to the
worker alive across MV3 idle shutdowns, without changing any background/native
protocol.

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

Detection does not require the native host. Generic direct files use the
controlled native transfer path even when FluxCatch observed the final response
in that tab: `chrome.downloads` does not expose DNS answers or the connected peer,
and redirects escape the worker's policy hook. Enabling local-network media only
expands the native broker's allowed target class; it does not switch the transfer
to Chrome. A narrow exception keeps complete Instagram/X progressive MP4s in
Chrome when they came from the corresponding top-level site's bounded response
observer and pass exact scheme, host, MIME, provenance, and fragment checks.
The `useNativeForDirect` setting opts those otherwise eligible exceptions back
into the native broker. The `saveAs` preference is consumed only by a Chrome
exception; native tasks use the engine's fixed output policy.
Other DOM hints, site payloads, generic observed responses, and user-supplied
URLs require the native path. Chrome handles cookies, its configured network
path, redirects, filename conflicts, user warnings, and its normal download
lifecycle only for those fixed eligible adapter downloads.

### Native backend

- Native Messaging host: `io.github.blanchot_alice.fluxcatch`.
- `nativeMessaging` is optional and requested from an explicit user gesture in the download dialog, Side Panel quick-download action, or Settings authorization control.
- Chrome binds `chrome.runtime.connectNative` only into a worker that starts with the permission already granted; the worker alive during the grant keeps a missing binding. `openNativePort` therefore self-heals: after a short binding wait it snapshots `tabMedia`/`tabPreviews`/`jobs` from `storage.session` into the `nativeApiSelfHeal` marker in `storage.local` (with the asking surface and the download that was requested), answers the caller with `failureReason: "api_unavailable", selfHealing: true`, and calls `chrome.runtime.reload()` 150 ms later. The replacement worker replays the snapshot before `restoreSession`, connects the engine eagerly, reopens the settings/downloads page or popup, restarts the pending download if its tab still shows the same page, and posts one notification. A five-minute cooldown (cleared when the permission is removed) guarantees at most one reload per episode; inside the cooldown the measured recovery marker (`nativeApiRecovery`: waiting → resumed → restart_required) remains the fallback.
- Control protocol: four-byte native-endian length followed by JSON.
- Media bytes never travel through the Native Messaging channel.
- HTTP Range responses require a matching `206` and `Content-Range`.
- Version-2 multipart checkpoints bind SHA-256 digests of the canonical URL and entity validators, plus length and completed ranges. Legacy checkpoints are discarded; full URLs, paths, query strings, fragments, raw validator values, and request headers are never persisted.
- Static HLS VOD playlists use the pinned native HTTP client for manifests and segments. When a selected variant references an external audio rendition, both media playlists are validated and downloaded locally before FFmpeg receives two local files for stream-copy merging; MP3 extraction stages only the audio rendition. Relative manifests and segments resolve from each final response URL. AES-128 playlists (Jable's shape) stage their raw segments and the 16-byte keys through the same pinned client, then FFmpeg's local HLS demuxer decrypts against a rewritten local playlist (`file,crypto` protocol whitelist only). Live, SAMPLE-AES, DRM, discontinuity, and nested separate-audio structures fail closed.
- DASH network reads always use the local static-manifest planner and pinned HTTP client; relative resources resolve from the final MPD response URL and FFmpeg is used only on downloaded local tracks. Unsupported MPD structures fail with a specific capability error.
- Direct DASH pairs use `mediaKind: "dash_pair"`: the selected video URL is `url`, the selected audio URL is `options.audioUrl`, optional `options.audioHeaders` remains scoped only to that audio URL, and `options.expiresAt` carries the earliest signed-URL expiry as Unix seconds or JavaScript milliseconds. Expiry is checked after executor queueing and again immediately before each track starts. Both complete tracks transfer in parallel before FFmpeg publishes an MP4 with stream copy; MP3 output downloads only the audio track before local encoding.
- Signed DASH-pair transfers deliberately disable multipart resume checkpoints, so `upsig`, `deadline`, `token`, and other query parameters never reach crash-persistent checkpoint JSON. Host startup removes legacy `.fluxcatch-dash-pair-*` work directories before accepting jobs.
- Completed output is staged privately and published without overwriting an existing path.

### YouTube through yt-dlp

- FluxCatch does not bundle yt-dlp. YouTube changes faster than FluxCatch releases, so the engine looks for an installed copy instead: `FLUXCATCH_YTDLP` pins an executable; otherwise `PATH`, `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` and `~/bin` are probed on every `ping`, so `brew install yt-dlp` (or `pip install yt-dlp`) takes effect at the next Retry in Settings without reinstalling the engine. The pong reports `capabilities.ytdlp` (`installed`, `available`, `networkDisabled`, `version`, `broker: "broker-v1"`) and `externalNetworkProcesses: "broker-v1"`; the Settings row "YouTube" reads Yes only when a Ready engine reports `available: true, networkDisabled: false`, and "Needs yt-dlp" otherwise.
- yt-dlp never reaches the network directly. Every job starts an `ExternalToolBroker`: a loopback HTTP CONNECT proxy with a per-process random credential, handed to yt-dlp as `--proxy`. Each `CONNECT host:port` is resolved and checked against the job's `NetworkPolicy` (public only unless the private-network setting is on; metadata, link-local, multicast, unspecified and reserved space always refused), dialled to one of the authorized addresses with the connected peer re-validated (or chained through the OS proxy when one is configured for that host), and relayed as an opaque TLS tunnel. Only ports 80 and 443 and only CONNECT are brokered, so the tool cannot use the broker as a plain-HTTP side door. The tool runs with a minimal environment (no inherited proxy variables, `--ignore-config`, `--no-cache-dir`, `--no-playlist`), in a private work directory beside the output, and is terminated as a process group on cancel or after the six-hour wall limit.
- `inspect_youtube` asks `yt-dlp -J --skip-download` through the broker and returns only the title, duration, live flag and one entry per distinct height (best bitrate); format URLs, signatures and cookies stay in the engine. The worker turns the heights into opaque quality selectors (`youtube-height/<n>`) for the dialog, caches the answer for ten minutes on the candidate, and sends the chosen height as `options.maxHeight`. The download selects `bv*[height<=N]+ba/b[height<=N]`, prefers H.264/AAC for MP4 (VP9/Opus for WebM), merges with `--merge-output-format`/`--remux-video` into the requested container (MP3 through `-x --audio-format mp3`), reports progress from `--progress-template` lines (fragment counts included) and a `remuxing` phase during the merge, and publishes the finished file under the reserved output name without overwriting. yt-dlp's own exit text is classified in `lib/job-failure.js` (`youtube_tool_missing`, `external_tool_failed` with the exit code, and the HTTP/live/quality codes for its well-known messages); the UI shows only the catalogued copy.

## Pause, resume and the job queue

- A job's stop signal is a `JobControl` event with a `reason`. `cancel` discards partial state as before; `pause` keeps it: `multipart_download` leaves the `.part` file and its schema-2 checkpoint in place, and `hls_fast_download` / `dash_static_download` keep their staged-segment directory and write `<target>.part.json` (schema 3: `kind`, `workDir`, `urlSha256`, `pausedAt`) next to an empty `<target>.part` placeholder. Staged objects are written to a `.tmp` name and renamed when whole, so on resume only complete objects are reused; `unique_path(..., allow_checkpoint=True)` hands the resuming job the same output name, `resume_segment_work_dir` consumes the marker, and `cleanup_stale_workdirs` keeps work directories that a fresh marker names while collecting expired markers with the weekly `.part` sweep. `discard` removes the part, the checkpoint and the named work directory for one output name.
- The engine reports `{"type": "paused", "status": "paused", "targetName": ...}`; the worker keeps the job in `storage.session` with a worker-private `resume` recipe (`tabId`, `kind`, `keySha256` of `kind:url`, `options`, the engine's `targetName`) and exposes only `pausable`/`resumable` to pages. `RESUME_JOB` resolves the recipe against the tab's current candidates by digest, starts a new job that asks for the recorded name, and replaces the paused row; `CANCEL_JOB` on a paused job sends `discard`. Chrome-method jobs pause and resume through `chrome.downloads`.
- Every native download message carries `options.concurrentJobs` (Settings, 1–6). The host admits that many jobs at once through a condition variable; a waiting job reports `status: "queued"` with the engine's own message. `MAX_NATIVE_ADMITTED_JOBS` still bounds what the host accepts at all.
- `DOWNLOAD_BATCH` runs `startDownload` for each supplied reference and reports per-item outcomes; `DOWNLOAD_URL` validates an http(s) address, classifies it (extension, else a credential-free HEAD / one-byte range probe), registers it through `addCandidate` as a `user_supplied` candidate of the current tab, and then takes the ordinary download path.
- The save folder is the engine's decision: `choose_folder` runs the macOS picker off the reader thread, `validate_download_dir` accepts only absolute, writable, non-symlinked directories, the choice (and the previous folders) persist in `~/Library/Application Support/FluxCatch/config.json`, `managed_path` confines Finder actions to the current folder plus the remembered ones, and `FLUXCATCH_DOWNLOAD_DIR` overrides everything for tests.

## Download history and file actions

Files saved by the native engine never pass through Chrome's download manager, so `chrome://downloads` cannot list them. The service worker therefore keeps two layers of task state:

1. **Session jobs** (`chrome.storage.session`, unchanged): the live control surface for running transfers (progress, speed, cancel) plus the rows ended in this browser session.
2. **Durable history** (`chrome.storage.local`, key `downloadHistory.v1`): written by `mergeJob` the moment a job becomes `completed`, `failed` or `cancelled`. A record carries the display file name, size, source page, media facts and poster frame from the engine's `complete` message, and the published path. The path and the retry recipe (opaque candidate reference + options) live in the worker-private `jobDetails` map and in the stored record; `jobForUi`/`historyRecordForUi` strip them and expose only `hasFile`, `fileMissing`, `hasSource` and `retryable`.

Messages: `GET_HISTORY`, `REMOVE_HISTORY`, `CLEAR_HISTORY`, `VERIFY_HISTORY` (asks the engine which recorded files still exist), `FILE_ACTION` (`open` · `reveal` · `trash`), `OPEN_DOWNLOAD_FOLDER` (engine first, Chrome's default folder as fallback), `RETRY_JOB` (re-resolves the candidate in its tab; fails closed once the tab's generation moved on), `OPEN_JOB_SOURCE` and `OPEN_DOWNLOADS_PAGE`. Chrome-saved files use `chrome.downloads.open/show` from the page that holds the click, because those APIs need the user gesture.

The engine side (`reveal`, `open`, `open_folder`, `trash`, `stat`, answered with `file_action_result` by `requestId`) resolves every path with `Host.managed_path`: absolute, no symlink, confined to the engine's download folder, regular files only, never an unfinished `.part`/staging name. `trash` moves the file into `~/.Trash` under a unique name; nothing is ever deleted outright. `pong` now reports `downloadDir` and the `fileActions: "finder-v1"` capability. Completion notifications (`notifications.onClicked` / `onButtonClicked`) call the same `performFileAction` path.

## Trust boundaries

- Active targets must use `http:` or `https:` and must not contain URL username/password credentials. Signed query URLs may exist only in private worker/native task state and are represented to extension pages by redacted display metadata and opaque references.
- Both layers follow the same purpose/provenance/scope model but expose different security primitives. DOM hints and generic site payloads cannot trigger arbitrary fetches; automatic manifest probes require an observed response, fixed adapter metadata uses code-defined boundaries, and the Instagram/X browser-direct exception requires the correct top-level site plus an exact approved CDN/MIME/provenance tuple and `useNativeForDirect=false`. The extension validates schemes, literal hosts/IPs, provenance, purpose, origin allowlists, and user gestures; browser APIs do not expose DNS answers or the connected socket peer.
- Public-network scope is the default. The native client validates DNS answers, pins the authorized peer, and rechecks redirects and manifest children against loopback, private, link-local, multicast, unspecified, reserved, and metadata ranges. Explicit local-network opt-in does not permit metadata or reserved ranges. External processes receive local files only and cannot bypass the connector by opening network inputs.
- The stable profile has `remoteThumbnails=false`. Popup and Side Panel render packaged media-type tiles and make no page-derived preview request. The retained bounded raster-fetch implementation belongs to a future experimental profile and does not carry native DNS/peer guarantees.
- The native host accepts no shell commands and no caller-chosen output directory. The one external tool it starts, yt-dlp, receives a fixed argument list, a watch URL the worker already validated, and a loopback broker as its only network path.
- Native downloads fail closed when extension version, native version, protocol version, or capability-profile version is missing or mismatched; ping and bounded diagnostics remain available to explain the mismatch.
- Only a small allowlist of request headers can cross to the native host.
- During native transfers, sensitive headers are removed on cross-origin redirects and manifest-introduced subresources. The effective header set can only lose credentials, so an A→B→A chain cannot restore them.
- Direct DASH video/audio header sets are isolated, Cookies are excluded, and video credentials are never inherited by a cross-origin audio URL.
- Manifest and Native Messaging payload sizes are bounded.
- DRM, SAMPLE-AES and CENC are rejected. AES-128 key material is fetched only through the pinned client, stored next to the staged segments and consumed by FFmpeg locally.
- Adapter pages (Pornhub, MissAV, Jable) contribute playlist addresses from their own scripts and a Referer/Origin/User-Agent triple derived from the page origin; they never contribute cookies, and nothing they say can keep a download in Chrome.
- Preloaded playlists (The Economist) are text the worker fetched with the browser session from the media origin itself; the engine re-authorises the address, never fetches it, and treats every child the text names as untrusted network input.
- Store-policy platform blocks are enforced both when candidates are registered and when downloads start.

## Performance model

| Setting | Default | Range |
|---|---:|---:|
| HLS fragment workers | 8 | 1–24 |
| Direct Range workers | 8 | 1–24 |
| Native jobs | 4 | fixed |
| Range chunk target | 8 MiB; 32 MiB for large files | automatic |
| Progress events | at most 4/s | fixed |

Displayed byte speed is the task-wide byte average for byte-preserving transfers. FFmpeg MP3 jobs instead report processed media time and an `×` real-time multiplier: FFmpeg exposes encoded output size, which is roughly the MP3 bitrate and is not source-network throughput. Supported HLS VOD progress covers every locally downloaded video/audio fragment and uses the selected media duration during FFmpeg processing. Live HLS is rejected in 0.2.5. A local fixture confirms mechanics, not public-internet throughput.
