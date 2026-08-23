# Chrome Web Store listing draft

## Product name

**FluxCatch — Media Stream Detector**

## Single purpose

Detect direct media, HLS, and DASH resources requested by the current page, then save a resource explicitly selected by the user to the local device.

## Short description

Detect direct media, HLS, and DASH resources requested by the current page and save selected files locally.

## Permission justifications

- `downloads`: starts and monitors user-selected Chrome downloads and opens the default download folder.
- `sidePanel`: provides a persistent, user-opened media and download-task workspace alongside the current tab.
- `storage`: stores local preferences and bounded per-tab detection state.
- `webRequest`: reads request/response metadata needed to identify media and temporarily associate the exact selected request headers.
- optional `nativeMessaging`: requested only from an explicit user action when the user authorizes or starts a mode that needs the separately installed local engine for HLS/DASH, remuxing, or parallel Range transfers.
- `http://*/*`, `https://*/*`: media can be embedded from a CDN different from the page origin; access is used only for passive detection, an explicit inspect/download action, or the off-by-default supported-site quality-enrichment setting. Extension-owned probes are limited by literal URL/host, purpose, provenance, and worker-derived origin checks and reject redirects. Native downloads additionally validate DNS answers, pin connected peers, and recheck redirects and manifest children.
- optional `notifications`: requested only when the user enables completion notifications.

The extension executes no remotely hosted code. Manifest and media responses are treated as data and parsed by code bundled in the extension/native host.

Passive detection observes the current page's own traffic. Opening FluxCatch,
rescanning, or explicitly enabling **自动补全站点画质** may use the current
site login session to call that supported site's fixed playback-metadata API.
The setting is off by default; page-provided URLs cannot select an arbitrary
metadata endpoint.

## User-data disclosure

Disclose **web browsing activity**, **website content/resources**, and **authentication information** because URLs, page/media metadata, cookies, or authorization headers may be handled locally for the selected transfer. State that there is no developer-operated collection, telemetry, sale, advertising use, or cloud sync. The dashboard disclosure must match `PRIVACY.md` exactly.

## Honest capability statements

Use:

- local-first processing;
- direct media, HLS, and DASH detection; the 0.2.4 native download path supports clear static HLS VOD and reports unsupported live, encrypted, discontinuous, or separate-audio playlists without downloading them;
- the stable build uses packaged media-type tiles instead of fetching page-derived remote thumbnails and exposes no YouTube, yt-dlp, or live-HLS controls;
- advanced local engine on macOS;
- DRM-protected media remains unavailable;
- performance depends on server/network support.
- Bilibili support currently covers standard `/video/` pages, not bangumi pages.

Do not claim universal compatibility, support for every site, guaranteed acceleration, access to protected content, or support for named copyright platforms.

## Submission checklist

- Replace `STORE_EXTENSION_ID`, publisher/support details, and the privacy-policy URL.
- Upload a draft, record its Item ID/public key outside the development identity, and generate the separate Store manifest plus matching native `allowed_origins` from that identity.
- Host `PRIVACY.md` at a stable public HTTPS URL.
- Supply the 128×128 icon, at least one 1280×800 or 640×400 screenshot, and a 440×280 promotional image.
- Explain how reviewers can test direct, HLS, DASH capability errors, native host connection, and DRM blocking with local fixtures.
- Mark the advanced native engine as macOS-only until other installers exist.
