# Release readiness

Checked command results below are the recorded 0.2.4 baseline. A 0.2.5 release
must replace or supplement them with evidence from the final candidate commit;
documentation changes alone do not carry test status forward.

## Historical baseline — not 0.2.5 evidence

- `0.2.4` Node baseline: 62/62 on 2026-08-23 at `3561670`.
- `0.2.4` native baseline: 43/43 on 2026-08-23 at `3561670`.
- `0.2.4` Chrome baseline: 3 UI pages, 3 detection cases, 2 interaction flows, and one direct-download byte/SHA-256 assertion.

These entries are provenance only. They do not carry a checked state into 0.2.5.

## Automated gates for 0.2.5

- [ ] One clean final commit is recorded; Node (at least 65% line/branch and 70% function coverage), validator, native-host Python 3.9/3.12, and packaged-extension Chrome jobs are green for that exact SHA.
- [ ] CI builds extension/native archives once, verifies them with `scripts/verify_packages.py`, uploads those exact bytes, and every later test/release step downloads the same artifact set.
- [ ] Chrome for Testing passes against the unpacked extension ZIP from a fresh profile: 3 UI pages, 3 detection cases, 3 interaction flows, 13 deterministic visual states, and the generic-direct native preflight/fail-closed assertion (no task and no browser file without authorization).
- [ ] A second build of the same tree and `SOURCE_DATE_EPOCH` produces byte-identical extension/native ZIP hashes.
- [ ] The native ZIP link/entry/mode audit passes, its root wrapper rejects Python below 3.9, and source/ZIP install and uninstall commands are smoke-tested.
- [ ] Perform and record a final archive inspection for secrets, private paths, signing material, profiles, and downloaded media before publishing.

### 0.2.5 product-interface gate

Phase B scope decision (Trinity): `autoEnrichSiteQuality` is intentionally
enabled by default so the toolbar badge can be completed automatically after
the first trusted Bilibili media request on the same page. The fixed-site
metadata requests use same-site cookies and retain the documented in-flight,
success-TTL, and failure-cooldown limits. Users can turn the setting off to
disable automatic enrichment. This is an explicit product decision within the
Phase B candidate scope, not an incidental working-tree difference.

Run this gate against one exact candidate commit and record its commit SHA,
Chrome for Testing version, assertion counts, and artifact manifest in the
draft pull request or CI summary:

`npm run package` is an identity gate as well as a build command: it must run
from a clean Git worktree and refuses modified or untracked files. A release
archive is acceptable only when the packaged `BUILD_IDENTITY.commit` equals
`git rev-parse --short=12 HEAD`. `npm run package -- --allow-dirty` exists only
for local diagnostics; it labels the archive
`uncommitted:extension@sha256:<digest>`. The digest covers the canonical complete
extension tree, including normalized file modes and the development build-profile
sentinels; `scripts/verify_packages.py` reconstructs and verifies it from the ZIP.
Such an archive never satisfies the exact-candidate gate. E2E evidence follows
the same boundary: a source-directory run reports the 12-character HEAD for a
clean worktree, `uncommitted` for a dirty worktree, and
`not-a-git-repository` only outside Git; an unpacked diagnostic ZIP reports its
full `uncommitted:extension@sha256:<digest>` runtime identity instead.
Verify package checksums, the exact two-archive set, a shared deterministic
timestamp, canonical regular-file paths/types, complete-tree/current-source
identity, native entry layout, executable modes, Python preflight, and Markdown
links with:

```sh
npm run verify:package
unzip -p dist/fluxcatch-extension-0.2.5.zip lib/build-profile.js | grep -E 'commit:|buildTimestamp:'
```

Package timestamps and modes derive from `SOURCE_DATE_EPOCH`, or from the Git
commit time when it is unset. The injected `buildTimestamp` is therefore a
reproducible source timestamp, not the wall-clock time of a particular runner.

`npm run test:coverage` uses Node's built-in V8 report and includes the MV3
service worker. Its aggregate floor is deliberately recorded rather than
presented as exhaustive path proof: the worker smoke fixture exercises many
branches through a VM harness, while packaged Chrome E2E independently covers
runtime registration, detection, UI messages, and the native fail-closed path.

- [ ] All three extension pages load the shared packaged tokens and control primitives; no remote font, CSS, UI SDK, or executable code is introduced.
- [ ] Settings is initially clean, enables Save only after a normalized change, resets its baseline after success, and preserves dirty state after failure.
- [ ] Numeric limits, unknown filename tokens, empty-output risk, and invalid ignored-domain lines produce field errors plus an accessible summary and first-invalid-field focus.
- [ ] Notification and Native Messaging permission requests originate from the activating control; private-network enablement requires confirmation.
- [ ] Installed, connected, compatible, gated, and available capability states remain distinct; Lab roadmap items expose no operative primary control.
- [ ] Popup and Side Panel suppress duplicate actions and expose pending, success, failure, typed-toast, focus-restoration, long-string, and manifest-card loading states.
- [ ] Keyboard-only operation, helper/error relationships, live regions, light/dark focus rings, 40 px targets, and state labels are verified.
- [ ] At 125% and 150% zoom, Settings has no horizontal overflow and its sticky save bar does not cover the final field.
- [ ] `prefers-reduced-motion` removes press transforms and continuous loading animation without hiding progress state.
- [ ] Existing media detection and selection remain covered; documented download changes are explicit: generic observed resources use the native pinned broker, only the strict Instagram/X allowlist may use Chrome by default, **可信直链也使用本地下载引擎** forces those exceptions back to Native, the save-location prompt applies only to Chrome-backed saves, and terminal task rows persist until the user invokes completed-task cleanup. The Bilibili setting defaults on, every automatic path obeys it, only a trusted playback/preload request triggers enrichment, same-site cookies stay on the fixed API, and in-flight/TTL/failure-cooldown guards suppress repeated Range traffic.
- [ ] Bilibili, Instagram, and X adapter-beta claims each have browser-level SPA/navigation, worker-restart restoration, provenance, and Chrome/native download coverage before any status is upgraded to Stable.

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

- [ ] Generic observed direct media requires the native preflight; a fresh profile without authorization produces no task or browser file.
- [ ] Strictly allowlisted Instagram/X downloads have browser-level provenance plus saved-byte/SHA-256 evidence for both the default Chrome route and the `useNativeForDirect=true` Native override before either adapter claim is upgraded; `saveAs` is verified only on the Chrome route.
- [ ] Native 1/4-worker Range outputs match fixture SHA-256 and request logs prove overlap.
- [x] HLS master variants resolve to genuinely different playlists.
- [ ] HLS media, byte-range, alternate audio, live duration, and protection fixtures behave as expected.
- [ ] DASH capability is shown accurately; supported static fixtures produce valid A/V output.
- [ ] Closing/reopening the popup and clearing detections preserve terminal task rows; the explicit completed-task cleanup removes terminal rows while preserving active tasks, with final browser evidence recorded.

## Store gates

- [ ] Official Item ID/public key is synchronized with native `allowed_origins`.
- [x] Native Messaging uses the owned reverse-DNS name `io.github.blanchot_alice.fluxcatch` across release components.
- [ ] Privacy, permission, active-network behavior, and data-use declarations match the final code and test evidence.
- [ ] Store-policy platform blocks are covered by tests.
- [ ] Listing assets, support URL, privacy URL, publisher identity, and reviewer instructions are complete.
- [ ] Native installer is signed/notarized and installs an independent runtime copy.
- [ ] English and Simplified Chinese manifest name/description catalogs render correctly in installed Store builds.

## GitHub gates

- [x] Public repository exists from the sanitized project tree; private research material remains outside it.
- [x] Private vulnerability reporting enabled and API-verified on 2026-08-23.
- [ ] Enable branch protection.
- [ ] Publish extension/native archives separately with checksums.
- [ ] Publish the exact CI-retained ZIP/SHA artifact set; do not rebuild locally for the release upload.
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
