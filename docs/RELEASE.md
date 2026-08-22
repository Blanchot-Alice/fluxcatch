# Release readiness

## Automated gates

- [ ] Record the final FluxCatch 0.2.4 Node-test command, count, date, and commit.
- [ ] Record the final FluxCatch 0.2.4 native-test command, count, date, and commit.
- [ ] Record the FluxCatch 0.2.4 validator output, date, and commit.
- [x] CI enforces Node tests, native-host tests, manifest validation, Python compilation, and pinned-action Chrome for Testing E2E.
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
- [ ] Privacy, permission, active-network behavior, and data-use declarations match the final code and test evidence.
- [ ] Store-policy platform blocks are covered by tests.
- [ ] Listing assets, support URL, privacy URL, publisher identity, and reviewer instructions are complete.
- [ ] Native installer is signed/notarized and installs an independent runtime copy.

## GitHub gates

- [x] Public repository exists from the sanitized project tree; private research material remains outside it.
- [x] Private vulnerability reporting enabled and API-verified on 2026-08-23.
- [ ] Enable branch protection.
- [ ] Publish extension/native archives separately with checksums.
- [ ] Keep private research material outside the repository.
