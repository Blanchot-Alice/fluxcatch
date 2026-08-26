# Chrome Web Store listing draft

## Product name

**FluxCatch — Media Stream Detector**

Packaged manifest localization currently provides Simplified Chinese (`zh_CN`,
default) and English (`en`) name/description catalogs. The Store dashboard text
must be entered and reviewed separately for both locales.

## Single purpose

Detect direct media, HLS, and DASH resources requested by the current page, then save a resource explicitly selected by the user to the local device.

## Short description

Detect direct media, HLS, and DASH resources requested by the current page and save selected files locally.

## Permission justifications

- `downloads`: starts and monitors user-selected Chrome downloads and opens the default download folder.
- `sidePanel`: provides a persistent, user-opened media and download-task workspace alongside the current tab.
- `storage`: stores local preferences and bounded per-tab detection state.
- `webRequest`: reads request/response metadata needed to identify media and temporarily associate the exact selected request headers.
- optional `nativeMessaging`: detection does not use the local engine. This permission is requested only from an explicit user action when the user authorizes or starts one of the majority of save paths that use the separately installed policy-controlled engine, including generic direct media, HLS/DASH, remuxing, conversion, or parallel Range transfers. Only the fixed, provenance-checked Instagram/X MP4 allowlist may save through Chrome without it, and **可信直链也使用本地下载引擎** routes even those files through Native. The save-location prompt affects only a Chrome-backed exception, not native-engine output.
- `http://*/*`, `https://*/*`: media can be embedded from a CDN different from the page origin; access is used only for passive detection, an explicit inspect/download action, or default-on but user-disableable supported-site quality enrichment after a trusted media request. Extension-owned probes are limited by literal URL/host, purpose, provenance, and worker-derived origin checks and reject redirects. Native downloads additionally validate DNS answers, pin connected peers, and recheck redirects and manifest children.
- optional `notifications`: requested only when the user enables completion notifications.

The extension executes no remotely hosted code. Manifest and media responses are treated as data and parsed by code bundled in the extension/native host.

Passive detection observes the current page's own traffic. On a supported
Bilibili `/video/` page, the default-on **自动补全站点画质** setting may use
same-site cookies to call the fixed `api.bilibili.com` page-list and
playback-metadata APIs after the first trusted playback/preload request.
Repeated Range signals are coalesced and cooldown-limited. Turning the setting
off blocks every automatic metadata call; an explicit rescan remains available.
Page completion and opening or closing FluxCatch only read current results.
Page-provided URLs cannot select an arbitrary metadata endpoint.

## User-data disclosure

Disclose **web browsing activity**, **website content/resources**, and **authentication information** because URLs, page/media metadata, cookies, or authorization headers may be handled locally for supported-site quality enrichment or the selected transfer. State that there is no developer-operated collection, telemetry, sale, advertising use, or cloud sync. Describe the default-on fixed-site metadata endpoints separately from explicit inspect/download requests; the dashboard disclosure must match `PRIVACY.md` exactly.

## Honest capability statements

Use:

- local-first processing;
- direct media, HLS, and DASH detection; the 0.2.5 native download path supports clear static HLS VOD, including local merging of separate audio renditions, and reports unsupported live, encrypted, discontinuous, or nested separate-audio playlists without downloading them;
- the stable build uses packaged media-type tiles instead of fetching page-derived remote thumbnails and exposes no YouTube, yt-dlp, or live-HLS controls;
- local engine on macOS for most save actions and all advanced processing; detection itself does not require it;
- DRM-protected media remains unavailable;
- performance depends on server/network support.
- Bilibili support currently covers standard `/video/` pages, not bangumi pages.
- Bilibili, Instagram, and X are adapter-beta capabilities backed by bounded unit/native fixtures; do not label them Stable until the release candidate also has browser-level SPA/navigation, worker-restart restoration, provenance, and download evidence.
- Settings reports tool installation, native connection, protocol compatibility, networking gates, and build availability separately; a detected yt-dlp installation is not presented as enabled YouTube support.
- YouTube, live HLS, and encrypted HLS remain non-interactive roadmap states rather than disabled controls that imply hidden functionality.

Do not claim universal compatibility, support for every site, guaranteed acceleration, access to protected content, or support for named copyright platforms.

## Submission checklist

- Replace `STORE_EXTENSION_ID`, publisher/support details, and the privacy-policy URL.
- Upload a draft, record its Item ID/public key outside the development identity, and generate the separate Store manifest plus matching native `allowed_origins` from that identity.
- Host `PRIVACY.md` at a stable public HTTPS URL.
- Supply the 128×128 icon, at least one 1280×800 or 640×400 screenshot, and a 440×280 promotional image.
- Explain how reviewers can test direct, HLS, DASH capability errors, native host connection, and DRM blocking with local fixtures.
- In reviewer instructions, point to Settings → **本地能力** for the truthful runtime matrix and **实验室** for the stable profile's non-interactive gated states.
- Mark the advanced native engine as macOS-only until other installers exist.
