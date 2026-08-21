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
- `http://*/*`, `https://*/*`: media can be embedded from a CDN different from the page origin; access is used only for the user-facing detector/downloader purpose.
- optional `notifications`: requested only when the user enables completion notifications.

The extension executes no remotely hosted code. Manifest and media responses are treated as data and parsed by code bundled in the extension/native host.

## User-data disclosure

Disclose **web browsing activity**, **website content/resources**, and **authentication information** because URLs, page/media metadata, cookies, or authorization headers may be handled locally for the selected transfer. State that there is no developer-operated collection, telemetry, sale, advertising use, or cloud sync. The dashboard disclosure must match `PRIVACY.md` exactly.

## Honest capability statements

Use:

- local-first processing;
- direct media, HLS, and DASH detection;
- advanced local engine on macOS;
- DRM-protected media remains unavailable;
- performance depends on server/network support.

Do not claim universal compatibility, support for every site, guaranteed acceleration, access to protected content, or support for named copyright platforms.

## Submission checklist

- Replace `STORE_EXTENSION_ID`, publisher/support details, and the privacy-policy URL.
- Upload a draft, copy its public key into `manifest.key`, and sync native `allowed_origins`.
- Host `PRIVACY.md` at a stable public HTTPS URL.
- Supply the 128×128 icon, at least one 1280×800 or 640×400 screenshot, and a 440×280 promotional image.
- Explain how reviewers can test direct, HLS, DASH capability errors, native host connection, and DRM blocking with local fixtures.
- Mark the advanced native engine as macOS-only until other installers exist.
