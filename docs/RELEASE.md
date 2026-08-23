# Release readiness

Checked command results below are the recorded 0.2.4 baseline. A 0.2.5 release
must replace or supplement them with evidence from the final candidate commit;
documentation changes alone do not carry test status forward.

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

### 0.2.5 product-interface gate

Run this gate against one exact candidate commit and record its commit SHA,
Chrome for Testing version, assertion counts, and artifact manifest in the
draft pull request or CI summary:

- [ ] All three extension pages load the shared packaged tokens and control primitives; no remote font, CSS, UI SDK, or executable code is introduced.
- [ ] Settings is initially clean, enables Save only after a normalized change, resets its baseline after success, and preserves dirty state after failure.
- [ ] Numeric limits, unknown filename tokens, empty-output risk, and invalid ignored-domain lines produce field errors plus an accessible summary and first-invalid-field focus.
- [ ] Notification and Native Messaging permission requests originate from the activating control; private-network enablement requires confirmation.
- [ ] Installed, connected, compatible, gated, and available capability states remain distinct; Lab roadmap items expose no operative primary control.
- [ ] Popup and Side Panel suppress duplicate actions and expose pending, success, failure, typed-toast, focus-restoration, long-string, and manifest-card loading states.
- [ ] Keyboard-only operation, helper/error relationships, live regions, light/dark focus rings, 40 px targets, and state labels are verified.
- [ ] At 125% and 150% zoom, Settings has no horizontal overflow and its sticky save bar does not cover the final field.
- [ ] `prefers-reduced-motion` removes press transforms and continuous loading animation without hiding progress state.
- [ ] Existing media detection, selection, and download behavior remains covered and unchanged.

The deterministic visual matrix must include:

| Surface/state | CSS viewport |
| --- | ---: |
| Settings, light | 980 × 900 |
| Settings, dark | 980 × 900 |
| Settings, narrow | 390 × 844 |
| Settings, dirty state | 980 × 900 |
| Settings, validation errors | 980 × 900 |
| Settings, private-network confirmation | 980 × 900 |
| Settings, native host missing | 980 × 900 |
| Settings, native host ready | 980 × 900 |
| Popup | 372 × 560 |
| Popup, manifest loading | 372 × 560 |
| Side Panel | 420 × 820 |
| Download dialog | 372 × 560 |
| Reduced-motion state | matching surface viewport |

Per-run screenshots stay under `e2e/artifacts/` with the machine-readable
artifact manifest; selected, reviewed images may then replace the stable files
under `docs/assets/`. No checkbox in this section should be marked from a CSS
review alone.

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

The automated tests prove only the assertions recorded for their exact tested
commit: static planning, byte equality, redirect/header lineage, deterministic
UI behavior, and fail-closed capability boundaries. A screenshot proves a
rendered state, not keyboard completion, security isolation, or backend
correctness; those require their own assertions. The suite does not yet prove
1/4-worker Range overlap under server telemetry, `ffprobe` playback of final
HLS/DASH/MP3 products, public-network throughput, Store identity, or a
signed/notarized installer. Those items remain unchecked above. Per-run package
hashes and GitHub Actions run IDs belong in the draft PR body and CI job summary
so they identify the exact tested PR head without creating a self-referential
documentation commit.
