# Security Policy

## Supported versions

Security fixes are applied to the newest published release.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** form for confidential reports. Include the affected version, reproduction steps using a local fixture, expected and actual behavior, and the smallest useful log. Remove cookies, authorization values, private media URLs, personal data, and downloaded content. If that private form is not visible, open a public issue containing only a request for private contact—do not include vulnerability details or secrets in the issue.

## Security model

FluxCatch treats page messages, URLs, manifests, HTTP responses, filenames, native messages, and FFmpeg output as untrusted input. The extension layer validates URL schemes, URL userinfo, literal host/IP categories, request purpose, provenance, worker-derived origin allowlists, payload bounds, and required user gestures. Browser fetch APIs do not expose DNS answers or connected socket peers, so the extension does not claim DNS pinning, peer verification, or DNS-rebinding protection.

The native client independently validates DNS answers, authorizes and pins the connected peer, rechecks every redirect and manifest child, and ensures sensitive headers removed at a cross-origin transition cannot later reappear. Public networks are the default; explicit local-network opt-in never permits cloud metadata or reserved ranges. The stable profile does not fetch page-derived remote thumbnails. FFmpeg receives local files only, and external-tool networking remains disabled.

Do not commit extension signing keys, tokens, browser profiles, authentication headers, downloaded media, or native-host registration files containing private paths.
