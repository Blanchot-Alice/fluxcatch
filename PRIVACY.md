# Privacy Policy

Effective date: 2026-08-19

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

- Candidate metadata is stored in Chrome session storage and is removed when the relevant tab state is cleared or the browser session ends.
- Settings are stored in Chrome local extension storage until changed or the extension is removed.
- Captured request headers remain only in service-worker memory, are bounded, and expire after at most five minutes; the service worker removes a selected capture earlier when its native task ends. They are not written to extension storage.
- On a supported Bilibili video page, opening or explicitly rescanning FluxCatch may request Bilibili's public page-list and playback metadata without cookies or account credentials. Short-lived signed video/audio track addresses remain only in service-worker memory for at most two minutes; the popup, Side Panel, broadcasts, and Chrome session storage receive only redacted track metadata and opaque quality selectors.
- Download-task snapshots use an explicit field allowlist in Chrome session storage, are capped at 200 entries, omit media URLs/headers/manifests/output paths, and redact credentials, query strings, and local paths from status text.
- Authentication, cookie, origin, and referrer headers are not forwarded to a different origin introduced by a redirect or manifest.
- The optional native host receives only the headers and URL needed for the download the user starts. It writes media and validated resume metadata locally.
- Downloaded files remain on the device until the user deletes them.

## Data sharing and network services

FluxCatch has no developer-operated telemetry, advertising, analytics, account, or cloud-sync service. It contacts only resource servers and public playback-metadata endpoints belonging to the page's media service, and only as needed to inspect or download selected media. Control messages to the native host stay on the same device.

FluxCatch does not sell user data. It does not transfer user data to third parties except the resource server selected by the user as necessary to perform the requested download.

## User controls

Users can clear detected items from the popup, clear completed session tasks from the Side Panel, disable notifications, remove the native host, clear extension storage, uninstall the extension, and delete downloaded files using operating-system controls.

## Protected and restricted content

FluxCatch does not decrypt DRM-protected media or bypass paywalls, access controls, or login systems. Store-policy platform restrictions are built into the store release.

## Limited Use

FluxCatch's use of information received from Chrome APIs is limited to providing and improving the extension's user-facing single purpose. The data is not used for personalized advertising, is not made available for human review except when the user deliberately includes it in a support report, and is not transferred for unrelated purposes.

## Contact

Privacy questions can be filed through the public repository's issue tracker without attaching private URLs, cookies, authorization headers, or downloaded media.
