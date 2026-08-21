# Security Policy

## Supported versions

Security fixes are applied to the newest published release.

## Reporting a vulnerability

Use GitHub private vulnerability reporting for this repository. Include the affected version, reproduction steps using a local fixture, expected and actual behavior, and the smallest useful log. Remove cookies, authorization values, private media URLs, personal data, and downloaded content.

## Security model

FluxCatch treats page messages, URLs, manifests, HTTP responses, filenames, native messages, and FFmpeg output as untrusted input. URL schemes, header names, payload sizes, ranges, redirects, filenames, output publication, and DRM state are validated before use.

Do not commit extension signing keys, tokens, browser profiles, authentication headers, downloaded media, or native-host registration files containing private paths.
