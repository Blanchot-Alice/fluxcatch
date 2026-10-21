# FluxCatch design audit — v2-final

Run 2026-10-21T19:48:00.050Z · commit 8758f45 · Chrome for Testing · DPR 2

Budgets: a ≤ 6 text styles per screen (≤ 8 app-wide) · Display ≤ 2 per screen outside the BrandMark · b ≤ 3 left edges · c 0 nested containers · d 0 contrast failures · e 0 clipped/covered · f 0 locale leaks · g 0 rules · names 0 end-truncated filenames · h 0 colour literals.

## Summary

- Screens audited: 108; screens meeting every budget: 108.
- App-wide text styles (a), per UI language: en 8, zh 8 (budget 8); 11 across both languages.
- Colour literals outside the token files (h): 0.

| Screen | Theme | Lang | a styles | Display | b edges | c nesting | d contrast | e clip | f locale | g rules | names | pond |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| popup-media | morning | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-jobs | morning | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-link-dialog | morning | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel | morning | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-results | morning | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media-dialog | morning | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-link-dialog | morning | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-results | morning | en | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-960 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-full-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview | morning | en | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-text | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-controls | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-rows | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-feedback | morning | en | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays-item | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media | dusk | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-jobs | dusk | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-link-dialog | dusk | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel | dusk | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-results | dusk | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media-dialog | dusk | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-link-dialog | dusk | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-results | dusk | en | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-960 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-full-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview | dusk | en | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-text | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-controls | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-rows | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-feedback | dusk | en | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays-item | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | morning | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | morning | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | dusk | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | dusk | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-downloads-active | morning | en | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-active | morning | en | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-active-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-downloads-active | dusk | en | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-active | dusk | en | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-active-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media | morning | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-jobs | morning | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-link-dialog | morning | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel | morning | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-results | morning | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media-dialog | morning | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-link-dialog | morning | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-results | morning | zh | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-960 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-full-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview | morning | zh | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-text | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-controls | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-rows | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-feedback | morning | zh | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays-item | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media | dusk | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-jobs | dusk | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-link-dialog | dusk | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel | dusk | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-results | dusk | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-media-dialog | dusk | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-link-dialog | dusk | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-results | dusk | zh | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-960 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-full-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview | dusk | zh | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-text | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-controls | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-rows | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-feedback | dusk | zh | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| preview-overlays-item | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | morning | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | morning | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | dusk | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | dusk | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-downloads-active | morning | zh | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-active | morning | zh | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-active-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| popup-downloads-active | dusk | zh | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| sidepanel-active | dusk | zh | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| settings-active-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |

## App-wide text styles

- `Fraunces, Noto Serif SC` 17px / 20px · 600 — on 108 screen(s), e.g. “FluxCatch”
- `Fraunces, Noto Serif SC` 28px / 34px · 500 — on 68 screen(s), e.g. “Downloads”
- `Instrument Sans, PingFang SC` 15px / 22px · 600 — on 60 screen(s), e.g. “Download”
- `Instrument Sans, PingFang SC` 12px / 16px · 600 — on 56 screen(s), e.g. “Link”
- `Instrument Sans, PingFang SC` 13px / 20px · 500 — on 54 screen(s), e.g. “Media”
- `Instrument Sans, PingFang SC` 13px / 22px · 500 — on 54 screen(s), e.g. “媒体”
- `Instrument Sans, PingFang SC` 13px / 20px · 400 — on 48 screen(s), e.g. “Local engine isn’t set up”
- `Instrument Sans, PingFang SC` 13px / 22px · 400 — on 48 screen(s), e.g. “本地引擎尚未设置”
- `Instrument Sans, PingFang SC` 12px / 18px · 400 — on 36 screen(s), e.g. “lectures.example.org”
- `Instrument Sans, PingFang SC` 12px / 20px · 400 — on 36 screen(s), e.g. “lectures.example.org”
- `Fraunces, Noto Serif SC` 19px / 26px · 400 — on 28 screen(s), e.g. “No downloadable media on this page yet.”

## Details per screen (Morning, English)

### popup-media

- a: 4 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 19px/26px 400
- Display outside BrandMark: 1 — p.t-empty “No downloadable media on this page yet.”
- b: 2 left edges — x=16 (2: div.segmented “MediaDownloads” | div.segmented “MediaDownloads”) · x=60 (6: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 10
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 5.9% · mean ΔL* 0.26 · p95 ΔL* 0.52 · mean Δchroma 2.4 → colour without value ✓
- screenshot: shots/popup-media-morning-en.png

### popup-jobs

- a: 4 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 19px/26px 400
- Display outside BrandMark: 1 — p.t-empty “No downloads yet.”
- b: 2 left edges — x=16 (2: div.segmented “MediaDownloads” | div.segmented “MediaDownloads”) · x=60 (5: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 9
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 5.9% · mean ΔL* 0.27 · p95 ΔL* 0.52 · mean Δchroma 2.52 → colour without value ✓
- screenshot: shots/popup-jobs-morning-en.png

### popup-link-dialog

- a: 5 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/16px 600 · Fraunces 17px/20px 600 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=32 (8: h2#downloadDialog-title.t-title “Download” | label.t-label “Link”) · x=188.6 (1: span “Cancel”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 11
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1% · mean ΔL* 0.2 · p95 ΔL* 0.49 · mean Δchroma 1.73 → colour without value ✓
- screenshot: shots/popup-link-dialog-morning-en.png

### sidepanel

- a: 6 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Instrument Sans 12px/18px 400 · Fraunces 19px/26px 400
- Display outside BrandMark: 1 — p.t-empty “No downloadable media on this page yet.”
- b: 1 left edges — x=64 (8: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 11
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.2% · mean ΔL* 0.18 · p95 ΔL* 0.45 · mean Δchroma 1.85 → colour without value ✓
- screenshot: shots/sidepanel-morning-en.png

### popup-results

- a: 5 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=16 (3: div.segmented “Media3Downloads” | div.segmented “Media3Downloads”) · x=60 (13: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 29
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 0.9% · mean ΔL* 0.17 · p95 ΔL* 0.47 · mean Δchroma 1.86 → colour without value ✓
- screenshot: shots/popup-results-morning-en.png

### popup-media-dialog

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/16px 600 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=32 (8: h2#downloadDialog-title.t-title “Download” | label.t-label “File name”) · x=188.6 (1: span “Cancel”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 11
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 0.9% · mean ΔL* 0.18 · p95 ΔL* 0.47 · mean Δchroma 1.41 → colour without value ✓
- screenshot: shots/popup-media-dialog-morning-en.png

### sidepanel-link-dialog

- a: 6 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 15px/22px 600 · Instrument Sans 12px/16px 600 · Fraunces 17px/20px 600 · Instrument Sans 12px/18px 400
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=32 (8: h2#downloadDialog-title.t-title “Download” | label.t-label “Link”) · x=236.6 (1: span “Cancel”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 11
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.5% · mean ΔL* 0.19 · p95 ΔL* 0.44 · mean Δchroma 1.74 → colour without value ✓
- screenshot: shots/sidepanel-link-dialog-morning-en.png

### sidepanel-results

- a: 5 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600
- Display outside BrandMark: 0 — none
- b: 1 left edges — x=64 (14: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 26
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.5% · mean ΔL* 0.17 · p95 ΔL* 0.4 · mean Δchroma 1.46 → colour without value ✓
- screenshot: shots/sidepanel-results-morning-en.png

### downloads-1280

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=200 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=272 (22: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 44
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.1% · mean ΔL* 0.26 · p95 ΔL* 0.65 · mean Δchroma 4.3 → colour without value ✓
- screenshot: shots/downloads-1280-morning-en.png

### downloads-960

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=40 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=112 (22: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 44
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.1% · mean ΔL* 0.24 · p95 ΔL* 0.59 · mean Δchroma 3.47 → colour without value ✓
- screenshot: shots/downloads-960-morning-en.png

### settings-1280

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=200 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=272 (1: span.t-wordmark “FluxCatch”) · x=448 (75: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 124
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.1% · mean ΔL* 0.26 · p95 ΔL* 0.65 · mean Δchroma 4.3 → colour without value ✓
- screenshot: shots/settings-1280-morning-en.png

### settings-960

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=40 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=112 (1: span.t-wordmark “FluxCatch”) · x=288 (75: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 124
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.3% · mean ΔL* 0.21 · p95 ΔL* 0.51 · mean Δchroma 2.38 → colour without value ✓
- screenshot: shots/settings-960-morning-en.png

### settings-full-1280

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=200 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=272 (1: span.t-wordmark “FluxCatch”) · x=448 (75: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 124
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 0.6% · mean ΔL* 0.26 · p95 ΔL* 0.65 · mean Δchroma 4.16 → colour without value ✓
- screenshot: shots/settings-full-1280-morning-en.png

### preview

- a: 6 styles — Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 2 — h1#previewTitle.t-display “Components”; p.t-empty “No downloads yet.”
- b: 2 left edges — x=280 (6: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (9: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 19
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.5% · mean ΔL* 0.27 · p95 ΔL* 0.68 · mean Δchroma 4.07 → colour without value ✓
- screenshot: shots/preview-morning-en.png

### preview-text

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/16px 600
- Display outside BrandMark: 1 — h1#previewTitle.t-display “Components”
- b: 2 left edges — x=280 (6: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (6: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 17
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.5% · mean ΔL* 0.27 · p95 ΔL* 0.68 · mean Δchroma 4.07 → colour without value ✓
- screenshot: shots/preview-text-morning-en.png

### preview-controls

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/16px 600 · Instrument Sans 12px/18px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#previewTitle.t-display “Components”
- b: 2 left edges — x=280 (6: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (26: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 46
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.2% · mean ΔL* 0.27 · p95 ΔL* 0.68 · mean Δchroma 4.07 → colour without value ✓
- screenshot: shots/preview-controls-morning-en.png

### preview-rows

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Instrument Sans 12px/16px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 1 — h1#previewTitle.t-display “Components”
- b: 2 left edges — x=280 (10: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (40: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 92
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1% · mean ΔL* 0.27 · p95 ΔL* 0.62 · mean Δchroma 3.45 → colour without value ✓
- screenshot: shots/preview-rows-morning-en.png

### preview-feedback

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/16px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#previewTitle.t-display “Components”; p.t-empty “No downloadable media on this page yet.”
- b: 3 left edges — x=280 (6: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (18: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”) · x=380.6 (1: span “Keep”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 30
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.2% · mean ΔL* 0.26 · p95 ΔL* 0.6 · mean Δchroma 3.88 → colour without value ✓
- screenshot: shots/preview-feedback-morning-en.png

### preview-overlays

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 1 — h1#previewTitle.t-display “Components”
- b: 3 left edges — x=280 (8: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (16: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”) · x=568.6 (1: span “Cancel”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 27
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.4% · mean ΔL* 0.27 · p95 ΔL* 0.68 · mean Δchroma 4.07 → colour without value ✓
- screenshot: shots/preview-overlays-morning-en.png

### preview-overlays-item

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 1 — h1#previewTitle.t-display “Components”
- b: 3 left edges — x=280 (8: div.segmented “Type and brandText stylesControlsRows and progre” | div.segmented “Type and brandText stylesControlsRows and progre”) · x=352 (16: span.t-wordmark “FluxCatch” | h1#previewTitle.t-display “Components”) · x=568.6 (1: span “Cancel”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 27
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 1.4% · mean ΔL* 0.27 · p95 ΔL* 0.68 · mean Δchroma 4.07 → colour without value ✓
- screenshot: shots/preview-overlays-item-morning-en.png

### downloads-empty-1280

- a: 5 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#pageTitle.t-display “Downloads”; p#emptySentence.t-empty “No downloads yet.”
- b: 2 left edges — x=200 (1: label.field.url-field “Media link”) · x=272 (5: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 8
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2% · mean ΔL* 0.28 · p95 ΔL* 0.72 · mean Δchroma 4.09 → colour without value ✓
- screenshot: shots/downloads-empty-1280-morning-en.png

### downloads-empty-960

- a: 5 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#pageTitle.t-display “Downloads”; p#emptySentence.t-empty “No downloads yet.”
- b: 2 left edges — x=40 (1: label.field.url-field “Media link”) · x=112 (5: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 8
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 0.9% · mean ΔL* 0.25 · p95 ΔL* 0.6 · mean Δchroma 3.24 → colour without value ✓
- screenshot: shots/downloads-empty-960-morning-en.png

### popup-downloads-active

- a: 4 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Fraunces 17px/20px 600 · Instrument Sans 13px/20px 400
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=16 (4: div.segmented “Media3Downloads2” | div.segmented “Media3Downloads2”) · x=60 (6: span.t-wordmark “FluxCatch” | span.filename-head “Lecture 12 · Pharmaco”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 20
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.4% · mean ΔL* 0.17 · p95 ΔL* 0.42 · mean Δchroma 2.2 → colour without value ✓
- screenshot: shots/popup-downloads-active-morning-en.png

### sidepanel-active

- a: 4 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600
- Display outside BrandMark: 0 — none
- b: 1 left edges — x=64 (18: span.t-wordmark “FluxCatch” | span “Media on this page”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 37
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.8% · mean ΔL* 0.18 · p95 ΔL* 0.42 · mean Δchroma 1.71 → colour without value ✓
- screenshot: shots/sidepanel-active-morning-en.png

### downloads-active-1280

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=200 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=272 (28: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 57
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.3% · mean ΔL* 0.27 · p95 ΔL* 0.65 · mean Δchroma 4.11 → colour without value ✓
- screenshot: shots/downloads-active-1280-morning-en.png

### downloads-active-960

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=40 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=112 (28: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 57
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.1% · mean ΔL* 0.26 · p95 ΔL* 0.64 · mean Δchroma 3.67 → colour without value ✓
- screenshot: shots/downloads-active-960-morning-en.png

### settings-active-1280

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=200 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=272 (1: span.t-wordmark “FluxCatch”) · x=448 (67: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 115
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 0.7% · mean ΔL* 0.27 · p95 ΔL* 0.65 · mean Δchroma 3.99 → colour without value ✓
- screenshot: shots/settings-active-1280-morning-en.png

## Locale leaks (f)

- none

## Dusk contrast failures (d)

- none

## Colour literals outside the token files (h)

- none

## Definitions

See the header of scripts/lib/page-audit.mjs for the exact definition of each check.
