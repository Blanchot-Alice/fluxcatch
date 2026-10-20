<div align="center">

<img src="docs/assets/icon.png" width="110" alt="FluxCatch logo" />

# FluxCatch - A Local Download Helper

**Keep What You See.**

*Local-first media detection & acquisition for macOS + Chrome*

A passive Manifest V3 extension that watches what the page itself requests —
direct files, HLS, DASH — and saves through a policy-controlled local engine.
No cloud. No relay. Your bytes never leave your machine except toward the site
you are already visiting.

[![Version](https://img.shields.io/badge/version-0.2.5-007AFF?style=flat-square)](https://github.com/Blanchot-Alice/fluxcatch/releases)
[![Chrome MV3](https://img.shields.io/badge/Chrome-Manifest_V3-8E82AD?style=flat-square&logo=googlechrome&logoColor=white)](https://developer.chrome.com/docs/extensions/develop/migrate)
[![License: MIT](https://img.shields.io/badge/license-MIT-FF375F?style=flat-square)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-macOS_%2B_Chrome-486D80?style=flat-square)](docs/INSTALL.md)
[![Tests](https://img.shields.io/github/actions/workflow/status/Blanchot-Alice/fluxcatch/ci.yml?branch=main&label=tests&style=flat-square)](../../actions)

**English** · [简体中文](README.zh-CN.md)

</div>

---

## Why FluxCatch

Browser download helpers usually fall into two camps: cloud services that see
every byte you fetch, or page-injecting scrapers that fight every site redesign.
FluxCatch is a third path — **a transparent, local-first media inspector and
acquisition engine**. It only reports what the browser itself already received,
explains every boundary in plain language, and refuses closed doors instead of
picking them.

| | |
| --- | --- |
| 🔍 **Passive detection** | Rides on the page's own traffic. Optional quality enrichment is rate-limited, single-site, and one switch away from off. |
| 📺 **Honest quality ladder** | HLS variants and DASH representations listed explicitly — including the Bilibili ladder your logged-in account can actually play. |
| 🎚 **Grouped renditions** | Sites that never expose a master playlist still get one card with a resolution dropdown; video + audio merge losslessly via FFmpeg. |
| ⚡ **Conditional acceleration** | Parallel Range transfers when the server supports them; claimed honestly, guaranteed by nothing. |
| 🔒 **Local-first privacy** | No telemetry, account, or relay. Cookies stay scoped to their origin and are stripped on cross-origin hops. |
| 🛡️ **DRM stays DRM** | Protected content is detected and reported — never decrypted, never bypassed. |
| ⏯ **Pause, resume, queue** | Pause any running job and pick it up later: direct files resume from their checkpoint, HLS/DASH reuse every whole segment already staged. A download queue (1–6 at once) keeps the rest in line, and the engine says so. |
| 📥 **Batch and link downloads** | "Download all" for the whole page, a link icon to paste any media address, and a save folder you choose through the native macOS picker. ⌥⇧F / ⌥⇧D / ⌥⇧W open the popup, downloads and workspace. |
| 🗂 **A real download history** | Files the local engine saves never show up in `chrome://downloads`. FluxCatch keeps its own durable record with poster frame, duration, resolution and source page, plus Open / Show in Finder / Retry / Move to Trash, in the popup, the Side Panel and a full downloads page. |

## Site adapters

Generic detection covers many conventional requests. A few players need
first-class treatment:

| Site | Status | Notes |
| --- | --- | --- |
| **Bilibili** `/video/` | 🧪 beta | DASH pairing, opaque quality selectors, login-aware ladder, signed URLs kept in memory only. Bangumi not claimed. |
| **Instagram** | 🧪 beta | Best complete MP4 from page/SPA payloads; playback fragments suppressed. |
| **X / Twitter** | 🧪 beta | Highest-bitrate progressive `video_info` MP4 preferred over HLS. |
| **YouTube** | ⏸ source-only | Experimental code exists; the stable profile exposes no YouTube path and never launches yt-dlp. |

## Interface

The toolbar badge lights up as media is detected (and turns pool-green while
anything downloads). The popup handles quick saves and shows the newest
finished file with its poster frame, the Side Panel is the long-download
workbench, the downloads page (`下载记录`) is the complete day-by-day record
with search and Finder actions, and Settings explains build identity, privacy
boundaries, the save location and local capabilities in one honest reading
flow. Completion notifications lead straight to the file.

| Popup | Side Panel | Download dialog |
| :---: | :---: | :---: |
| <img src="docs/assets/en/popup.png" height="440" alt="Popup"> | <img src="docs/assets/en/sidepanel.png" height="440" alt="Side Panel"> | <img src="docs/assets/en/hls-download-dialog.png" height="440" alt="Download dialog"> |

<p align="center"><img src="docs/assets/en/options.png" width="720" alt="FluxCatch Settings"></p>

All three surfaces share packaged design tokens with keyboard operation,
visible focus, dark mode, narrow widths, and `prefers-reduced-motion`.

## Quick start

**1 · Load the extension**

```bash
git clone https://github.com/Blanchot-Alice/fluxcatch.git
```

Open `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
select `extension/`.

**2 · Install the native engine** *(macOS, required for most downloads)*

```bash
./scripts/native-install-wrapper.sh
```

Pins stable Homebrew paths, verifies Python 3.9+, detects FFmpeg. Or grab the
ready-made [`v0.2.5` packages](https://github.com/Blanchot-Alice/fluxcatch/releases/tag/v0.2.5):
unzip the native bundle whole and run `./install-macos.sh`.

**3 · Use it**

Play something. Watch the badge. Click. Download.

> Detection works without the engine. Most saves, merging, conversion and
> acceleration need it — Chrome-only saving is limited to the narrowly
> allowlisted Instagram/X MP4 set.

<details>
<summary><strong>Development</strong></summary>

```bash
npm test                                  # extension unit + UI static tests
npm run test:coverage                     # 65% lines/branches, 70% functions minimum
python3 -m unittest discover -s native-host/tests -v
python3 scripts/validate.py               # manifest + syntax validation
npm run test:e2e                          # Chrome detection, UI and interaction suite
npm run package                           # dist/ zips + SHA256SUMS
npm run verify:package                    # checksums, identity, safe ZIP metadata
```

CI builds release archives once, retains those exact bytes, and runs Chrome E2E
against that ZIP. Builds are byte-for-byte reproducible from
`SOURCE_DATE_EPOCH` or the commit time.

</details>

## How it fits together

```mermaid
flowchart LR
    subgraph Chrome
        CS["Content scripts<br/>DOM + bounded extraction"] --> BG["Service worker<br/>validation · pairing"]
        POP["Popup / Side Panel"]
        BG <--> POP
    end
    BG -- "native messaging<br/>1 MiB framed JSON" --> HOST["Native host<br/>Python"]
    HOST --> RANGES["Parallel Range<br/>transfers"]
    HOST --> FFMPEG["FFmpeg<br/>merge · remux · MP3"]
    RANGES --> DL[("Downloads")]
    FFMPEG --> DL
```

Extension probes validate URL syntax, host category, purpose, provenance and
origin allowlists. Native transfers additionally pin connected peers, re-check
redirects and manifest children, and strip sensitive headers monotonically on
cross-origin transitions. Signed URLs live in service-worker memory for at most
two minutes; UI surfaces receive redacted metadata plus opaque references only.

Deep dives: [Architecture](docs/ARCHITECTURE.md) · [Privacy](PRIVACY.md) ·
[Security](SECURITY.md) · [Release readiness](docs/RELEASE.md)

## License

[MIT](LICENSE) — FluxCatch is intended for media you own or are permitted to
save. It does not decrypt DRM content or bypass access controls.
