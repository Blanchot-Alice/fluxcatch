# Security Policy

## Supported versions

Security fixes are applied to the newest published release.

## Reporting a vulnerability

Use the repository's **Security → Report a vulnerability** form for confidential reports. Include the affected version, reproduction steps using a local fixture, expected and actual behavior, and the smallest useful log. Remove cookies, authorization values, private media URLs, personal data, and downloaded content. If that private form is not visible, open a public issue containing only a request for private contact—do not include vulnerability details or secrets in the issue.

## Security model

FluxCatch treats page messages, URLs, manifests, HTTP responses, filenames, native messages, and FFmpeg output as untrusted input. URL schemes, network scope, DNS answers, connected peers, header names, payload sizes, ranges, redirects, manifest children, filenames, output publication, and DRM state are validated before use. Public networks are the default; an explicit local-network-media setting never permits cloud metadata or reserved ranges. FFmpeg receives local files only, and yt-dlp network execution is fail-closed until external tools can use the pinned network broker.

Do not commit extension signing keys, tokens, browser profiles, authentication headers, downloaded media, or native-host registration files containing private paths.
