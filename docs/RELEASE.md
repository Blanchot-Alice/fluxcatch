# Release readiness

## Automated gates

- [x] Node tests pass (17/17, 2026-08-20).
- [x] Native-host tests pass (25/25, 2026-08-20).
- [x] Manifest/source validator passes for FluxCatch 0.2.3.
- [x] Chrome for Testing E2E assertions pass from a fresh profile (3 UI pages, 3 detection cases, direct-download hash).
- [x] Package files contain only release-ready public material and no private research notes, profiles, tokens, media, or signing keys.
- [x] SHA-256 checksums are generated and verified.

## Functional gates

- [x] Direct Chrome download matches fixture SHA-256.
- [ ] Native 1/4-worker Range outputs match fixture SHA-256 and request logs prove overlap.
- [x] HLS master variants resolve to genuinely different playlists.
- [ ] HLS media, byte-range, alternate audio, live duration, and protection fixtures behave as expected.
- [ ] DASH capability is shown accurately; supported static fixtures produce valid A/V output.
- [ ] Closing/reopening the popup does not present a stale job as current.

## Store gates

- [ ] Official Item ID/public key is synchronized with native `allowed_origins`.
- [x] Native Messaging uses the owned reverse-DNS name `io.github.blanchot_alice.fluxcatch` across release components.
- [ ] Privacy, permission, and data-use declarations match the code.
- [ ] Store-policy platform blocks are covered by tests.
- [ ] Listing assets, support URL, privacy URL, publisher identity, and reviewer instructions are complete.
- [ ] Native installer is signed/notarized and installs an independent runtime copy.

## GitHub gates

- [ ] Start the public repository from this sanitized tree and a fresh history.
- [ ] Enable private vulnerability reporting and branch protection.
- [ ] Publish extension/native archives separately with checksums.
- [ ] Keep private research material outside the repository.
