# Privacy Policy

Effective date: 2026-08-23

FluxCatch processes media information on the user's device to provide its single purpose: detecting media requested by the current page and saving a resource selected by the user.

## Data processed

FluxCatch may process:

- page URL and title;
- media resource URLs, MIME types, dimensions, duration, codecs, size, and response metadata;
- short-lived request headers needed to repeat a selected media request, limited to `Accept`, `Authorization`, `Cookie`, `Origin`, `Referer`, and `User-Agent`;
- extension settings and download options;
- redacted local download status and error messages for the current browser session.

## How data is used

This data is used only to show detected media, inspect a selected manifest, repeat a user-selected request, and save the resulting file. FluxCatch does not use browsing activity or authentication data for advertising, profiling, credit decisions, or unrelated analytics.

## Storage and retention

- Candidate metadata with credential-free display URLs may be stored in Chrome session storage and is removed when the relevant tab state is cleared or the browser session ends. Only explicitly allowlisted, non-secret page identity parameters (such as Bilibili's page number) may remain. Media resource candidates with other query parameters, plus separately modelled signed Bilibili track URLs, stay only in service-worker memory and are rediscovered after suspension rather than persisted.
- Settings are stored in Chrome local extension storage until changed or the extension is removed.
- Captured request headers remain only in service-worker memory, are bounded, and expire after at most five minutes; the service worker removes a selected capture earlier when its native task ends. They are not written to extension storage.
- On a supported Bilibili `/video/` page, opening the popup or Side Panel, explicitly rescanning, or enabling the off-by-default **自动补全站点画质** setting may request Bilibili's page-list and playback metadata with the browser's existing bilibili.com cookies, so a logged-in user sees the qualities their account can play. These fixed adapter requests go only to `api.bilibili.com`; no credentials are sent elsewhere. Signed video/audio track addresses remain only in service-worker memory for at most two minutes; the popup, Side Panel, broadcasts, and Chrome session storage receive only redacted track metadata and opaque quality selectors. Bangumi pages are not currently claimed as supported.
- On supported top-level Instagram and X pages, the content script scans the page's own inline script text in memory for direct media URLs (Instagram CDN / `twimg.com` hosts only) and discards everything else; no page content is stored or transmitted. A download replays the cookie the page itself sent only to the exact CDN origin that received it.
- The experimental YouTube adapter remains in GitHub source, but its setting, candidate, and download gates are closed in 0.2.4. The native host does not allow yt-dlp to open network connections, so installing yt-dlp alone does not enable this path. The gate remains until external-tool traffic can use the same pinned network broker as native transfers.
- Download-task snapshots use an explicit field allowlist in Chrome session storage, are capped at 200 entries, omit media URLs/headers/manifests/output paths, and redact credentials, query strings, and local paths from status text.
- Authentication, cookie, origin, and referrer headers are not forwarded to a different origin introduced by a redirect or manifest.
- The optional native host receives only the headers and URL needed for the download the user starts. Version-2 resume checkpoints store SHA-256 digests of the URL and entity validators, plus byte length and completed ranges; they do not store the URL, path, query, fragment, raw validator values, Cookie, Authorization value, or other request headers.
- Downloaded files remain on the device until the user deletes them.

## Data sharing and network services

FluxCatch has no developer-operated telemetry, advertising, analytics, account, or cloud-sync service. Passive detection observes the page's own requests. FluxCatch itself contacts a resource only when the user inspects or downloads it, or when a supported site's fixed playback-metadata endpoint is triggered by opening FluxCatch, rescanning, or the explicit automatic-enrichment setting. Control messages to the native host stay on the same device.

FluxCatch-owned active fetches default to public targets. Extension probes and thumbnails reject redirects; the native engine checks DNS answers, pins the connected peer, and rechecks redirects and manifest children. Users may explicitly enable local-network media for devices they control; cloud metadata and reserved network ranges remain blocked even then. Ordinary Chrome-backed direct downloads are offered only for a final media response the browser actually observed, and Chrome owns that transfer lifecycle.

FluxCatch does not sell user data. It does not transfer user data to third parties except the resource server selected by the user as necessary to perform the requested download.

## User controls

Users can clear detected items from the popup, clear completed session tasks from the Side Panel, disable notifications, remove the native host, clear extension storage, uninstall the extension, and delete downloaded files using operating-system controls.

## Protected and restricted content

FluxCatch does not decrypt DRM-protected media or bypass paywalls, access controls, or login systems. Version 0.2.4 is a development/GitHub candidate; a future Store artifact must physically enforce the capabilities accepted for that listing.

## Limited Use

FluxCatch's use of information received from Chrome APIs is limited to providing and improving the extension's user-facing single purpose. The data is not used for personalized advertising, is not made available for human review except when the user deliberately includes it in a support report, and is not transferred for unrelated purposes.

## Contact

Privacy questions can be filed through the public repository's issue tracker without attaching private URLs, cookies, authorization headers, or downloaded media.
