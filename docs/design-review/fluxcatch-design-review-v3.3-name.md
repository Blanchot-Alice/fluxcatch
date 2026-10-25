# Design Review v3.3: the name is Havre

Audience: Claude Code. Owner: Andy. Date: 2026-10-24.

The product is renamed from **FluxCatch** to **Havre**. This document says what the name means, what changes, what must not change, and in which order. It sits on top of v3, v3.1 and v3.2; nothing else in those documents changes.

## 1. The name

Havre. Le Havre is the port Monet grew up in and the subject of *Impression, soleil levant*, the painting Impressionism is named after. The common noun *havre* means a harbour, a haven: a place where things come in off the water and are kept safe. For a local-first downloader that sends nothing through a cloud or a relay, that is the whole proposition in one word. The tagline stays: **Havre — Keep what you see.** / **Havre — 所见，即所得。**

Spelling and typography:

- Product name: `Havre`, capital H, no accent, no article (never "Le Havre", never "HAVRE" in running text). It is not translated: the Chinese UI says Havre too.
- Pronunciation note for the README, once: *ahv-ruh*.
- Wordmark: the BrandMark component unchanged, the string changed. Check the Fraunces wordmark at S and M in both themes; "Havre" is shorter than "FluxCatch", so re-check the popup and side-panel header alignment against the §5 grid.
- The mark (v3.2) carries no text and does not change.

## 2. What changes — three classes

Classify every occurrence of `FluxCatch` / `fluxcatch` (122 files; `grep -rIil fluxcatch . --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=live`) into one of these, and treat each class as below.

### 2.1 User-facing strings and brand assets: rename now

- `extension/_locales/en/messages.json`, `extension/_locales/zh_CN/messages.json` (extension name, "Open FluxCatch" command title, description).
- `extension/ui/v2/messages/*.js`: `brand.name`, every sentence that names the product ("FluxCatch stopped responding", "click the FluxCatch button in the toolbar", the Settings copy in `settings.js`, the worker notifications in `worker.js`, `media.js`, `downloads.js`).
- `extension/ui/v2/components.js` BrandMark comment and any default string.
- Icons: rename `extension/icons/fluxcatch-mark.svg` → `havre-mark.svg`, `fluxcatch-mark-16.svg` → `havre-mark-16.svg`, and the one reference in `extension/ui/v2/`. PNGs keep their generic names (`icon16.png` …).
- `README.md`, `README.zh-CN.md` (title, logo alt text, tagline block, every mention), with a two-sentence "Why Havre" under the tagline: Monet's port, and *havre* = haven. `docs/assets/icon.png` is regenerated from the v3.2 mark.
- `PRIVACY.md`, `DESIGN.md`, `docs/INSTALL.md`, `docs/ARCHITECTURE.md`, `docs/RELEASE.md`, `docs/STORE_LISTING.md`, `docs/CHROME_WEB_STORE_CHECKLIST.zh-CN.md`, `docs/NATIVE_HOST_PACKAGE.md`, `e2e/README.md`, `extension/ui/v2/README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `ACCEPTABLE_USE.md`.
- `extension/options/options.js` `DEFAULT_LOCATION`: `~/Downloads/Havre`. This changes the default for new installs only; a location the user has already chosen is stored and is never touched. `native-host/host.py` docstring at the same place.
- Native-host user-visible strings (install script echo lines, permission prompts, error sentences in `job-failure.js` and `host.py` that name the product).

### 2.2 Identifiers: rename with migration, in one release

These are machine names. Renaming them is right to do now, while the product is a beta with few installs, and wrong to do later. Each needs its migration written and tested, not just a search-and-replace.

- **Native messaging host ID** `io.github.blanchot_alice.fluxcatch` → `io.github.blanchot_alice.havre`: `native-host/io.github.blanchot_alice.fluxcatch.json.in` (rename the file), `native-host/install-macos.sh` (install the new manifest and remove the old one from `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`), `extension/background.js`, `scripts/build_packages.py`, `scripts/verify_packages.py`, `scripts/validate.py`, `scripts/lib/active-profile.mjs`, and the docs that quote it. The extension connects to the new ID only; the engine-not-set-up state already tells the user to run the installer, which is the migration path.
- **Python module** `native-host/fluxcatch_network_policy.py` → `havre_network_policy.py`, and its imports and tests.
- **Package name** in `package.json`: `havre`.
- **Extension-side keys and channel names** (`fluxcatch-popup`, `fluxcatch-sidepanel`, `fluxcatch-downloads`, `fluxcatch-hls`, `fluxcatch.ui`, `fluxcatch.pond`, `fluxcatch.invalid`, and any `chrome.storage` keys): list every one with what it is (storage key, port name, element id, CSS class, custom-element tag, header or error-code prefix) before renaming. Storage keys get a one-time read-old-write-new-delete-old migration on startup; port names, element ids, classes and prefixes are renamed outright. Error-code prefixes (`fluxcatch.invalid`…) are renamed together with `job-failure.js` and its tests.
- **CI** `.github/workflows/ci.yml`: artifact names and paths.
- **Version**: bump to 0.3.0; the native host and the extension both check the version, so keep whatever compatibility rule the code already has.

### 2.3 History: leave alone

Do not rewrite the past. `CHANGELOG.md` keeps every existing entry as written and gains a 0.3.0 entry whose first line is the rename. `docs/design-audit/*` reports, `docs/design-review/*` (including the file names `fluxcatch-design-review*.md` and the icon-candidate folders), `e2e/artifacts/latest.json`, and past step notes stay as they are. Tests that assert on the product name are code, not history: update them.

## 3. Outside the repository (Andy, not Claude Code)

- GitHub: rename the repository to `Blanchot-Alice/havre` (Settings → General → Rename, or `gh repo rename havre`). GitHub redirects the old URL. After that, Claude Code updates the remote (`git remote set-url origin …`), the badges and every `github.com/Blanchot-Alice/fluxcatch` link.
- Chrome Web Store: the extension ID does not change; the listing name changes with the next upload. Update `docs/STORE_LISTING.md` first.
- A trademark and Store-name check for "Havre" before the 0.3.0 upload. The informal search done on 2026-10-24 found no extension or downloader by that name; that is not a clearance.

## 4. Order of work

1. Produce the classification table (every file, every identifier, class 2.1 / 2.2 / 2.3) as `docs/design-review/step-v3-4-rename-table.md`, with the migration for each 2.2 item stated in one line. **Stop** and wait for approval of the 2.2 list.
2. After approval: class 2.1 and 2.2 together on one branch, `rename/havre`; run the unit tests, the native-host tests, the e2e matrix and the design audit; regenerate the icons and `docs/assets/icon.png` from the v3.2 mark; bump to 0.3.0; write the CHANGELOG entry.
3. Capture the popup, side panel, Downloads and Settings headers in both themes and both languages with the new wordmark, and write `docs/design-review/step-v3-4-rename.md` in the bilingual step format. Stop and wait. Do not commit until told to.

## 5. Do not

- Translate or transliterate the name, or add "Le".
- Touch a user's stored download location.
- Rewrite CHANGELOG history or past audit and review documents.
- Rename anything in class 2.2 without its migration.
