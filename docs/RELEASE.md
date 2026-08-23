# Release readiness

## Automated gates

- [x] `npm test`: 62/62 passed on 2026-08-23 against code commit `3561670` (`github / capability profile v1`). The final PR head is rerun by CI and recorded in the PR body.
- [x] `python3 -m unittest discover -s native-host/tests -v`: 43/43 passed on 2026-08-23 against code commit `3561670`.
- [x] `python3 scripts/validate.py`: `valid` on 2026-08-23 against code commit `3561670`.
- [x] `python3 -m compileall -q native-host`: exited 0 on 2026-08-23 against code commit `3561670`.
- [x] CI enforces Node tests, native-host tests, manifest validation, Python compilation, and pinned-action Chrome for Testing E2E.
- [x] Chrome for Testing E2E passes from a fresh profile: 3 UI pages, 3 detection cases, 2 interaction flows, and one direct-download byte/SHA-256 assertion.
- [x] Package generation uses bounded inputs, injects release identity only in a temporary staging copy, and verifies that the checked-in source identity is unchanged.
- [x] SHA-256 checksums are generated and verified.
- [ ] Perform and record a final manual archive inspection for secrets, private paths, signing material, profiles, and downloaded media before publishing a release.

## Functional gates

- [x] Direct Chrome download matches fixture SHA-256.
- [ ] Native 1/4-worker Range outputs match fixture SHA-256 and request logs prove overlap.
- [x] HLS master variants resolve to genuinely different playlists.
- [ ] HLS media, byte-range, alternate audio, live duration, and protection fixtures behave as expected.
- [ ] DASH capability is shown accurately; supported static fixtures produce valid A/V output.
- [x] Closing and reopening the popup removes terminal rows while preserving and accurately reporting an active task in the browser E2E fixture.

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

## Evidence boundary

The automated tests prove static planning, byte equality, redirect/header
lineage, stable UI behavior, and fail-closed capability boundaries. They do not
yet prove 1/4-worker Range overlap under server telemetry, `ffprobe` playback of
final HLS/DASH/MP3 products, public-network throughput, Store identity, or a
signed/notarized installer. Those items remain unchecked above. Per-run package
hashes and GitHub Actions run IDs belong in the draft PR body and CI job summary
so they identify the exact tested PR head without creating a self-referential
documentation commit.
