# FluxCatch design audit — v3-mark

Run 2026-10-24T20:42:13.177Z · commit uncommitted · extension extension · Chrome for Testing · DPR 2 · pond seed 0x5EED1E5

Verdicts recomputed 2026-10-24T20:47:23.521Z with the acceptance in force then (captures and measurements unchanged).

Pond (v3 §3.1): seed 0x5EED1E5 stored before each run; margins of full pages with ≥ 48 px gutters: chroma coverage 3% to 12% (ΔC > 0.015 in OKLCH against the capture without the layer), p95 |ΔL| ≤ 0.03 Morning / 0.05 Dusk; no pond pixel under any text run on any screen. Cells read "coverage · p95", in parentheses where the screen is reported but not judged (popup, side panel, 960 wide). Header (v3 §3.6): at scroll 0 the top bar is the canvas (background alpha 0, no shadow, band at opacity 0, and the capture without the layer is canvas pixel for pixel outside the content box). Contrast (d) is measured against the composited background: the pond's pixels over the canvas.

Budgets: a ≤ 6 text styles per screen (≤ 8 app-wide) · Display ≤ 2 per screen outside the BrandMark · b ≤ 3 left edges · c 0 nested containers · d 0 contrast failures · e 0 clipped/covered · f 0 locale leaks · g 0 rules (hr.section-rule between Settings sections exempt) · names 0 end-truncated filenames · h 0 colour literals.

## Summary

- Screens audited: 40; screens meeting every budget: 40.
- App-wide text styles (a), per UI language: en 8, zh 8 (budget 8); 11 across both languages.
- Colour literals outside the token files (h): 0.

| Screen | Theme | Lang | a styles | Display | b edges | c nesting | d contrast | e clip | f locale | g rules | names | pond | header |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| popup-media | morning | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.001) | ✓ |
| popup-jobs | morning | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.001) | ✓ |
| popup-link-dialog | morning | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-results | morning | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-media-dialog | morning | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| settings-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.02 | ✓ |
| settings-960 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.002) | ✓ |
| settings-full-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.2% · 0.018 | ✓ |
| popup-media | dusk | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.003) | ✓ |
| popup-jobs | dusk | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.003) | ✓ |
| popup-link-dialog | dusk | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-results | dusk | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-media-dialog | dusk | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| settings-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5% · 0.044 | ✓ |
| settings-960 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (1.3% · 0.003) | ✓ |
| settings-full-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.1% · 0.046 | ✓ |
| popup-downloads-active | morning | en | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.7% · 0.003) | ✓ |
| settings-active-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.1% · 0.018 | ✓ |
| popup-downloads-active | dusk | en | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.6% · 0.007) | ✓ |
| settings-active-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.8% · 0.04 | ✓ |
| popup-media | morning | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.002) | ✓ |
| popup-jobs | morning | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.002) | ✓ |
| popup-link-dialog | morning | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-results | morning | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-media-dialog | morning | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| settings-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.02 | ✓ |
| settings-960 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.002) | ✓ |
| settings-full-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.021 | ✓ |
| popup-media | dusk | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.003) | ✓ |
| popup-jobs | dusk | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.004) | ✓ |
| popup-link-dialog | dusk | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-results | dusk | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-media-dialog | dusk | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| settings-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5% · 0.044 | ✓ |
| settings-960 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (1.3% · 0.003) | ✓ |
| settings-full-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.9% · 0.04 | ✓ |
| popup-downloads-active | morning | zh | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.6% · 0.003) | ✓ |
| settings-active-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.021 | ✓ |
| popup-downloads-active | dusk | zh | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.007) | ✓ |
| settings-active-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.1% · 0.046 | ✓ |

## App-wide text styles

- `Fraunces, Noto Serif SC` 17px / 20px · 600 — on 40 screen(s), e.g. “FluxCatch”
- `Instrument Sans, PingFang SC` 15px / 22px · 600 — on 28 screen(s), e.g. “Download”
- `Instrument Sans, PingFang SC` 13px / 20px · 500 — on 20 screen(s), e.g. “Media”
- `Instrument Sans, PingFang SC` 13px / 20px · 400 — on 20 screen(s), e.g. “Local engine isn’t set up”
- `Instrument Sans, PingFang SC` 13px / 22px · 500 — on 20 screen(s), e.g. “媒体”
- `Instrument Sans, PingFang SC` 13px / 22px · 400 — on 20 screen(s), e.g. “本地引擎尚未设置”
- `Fraunces, Noto Serif SC` 28px / 34px · 500 — on 16 screen(s), e.g. “Settings”
- `Instrument Sans, PingFang SC` 12px / 18px · 400 — on 14 screen(s), e.g. “3”
- `Instrument Sans, PingFang SC` 12px / 20px · 400 — on 14 screen(s), e.g. “3”
- `Fraunces, Noto Serif SC` 19px / 26px · 400 — on 8 screen(s), e.g. “No downloadable media on this page yet.”
- `Instrument Sans, PingFang SC` 12px / 16px · 600 — on 8 screen(s), e.g. “Link”

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
- pond (§3.1, whole frame, reported only): coverage 0.4% (ΔC > 0.015) · p95 |ΔL| 0.001 · mean |ΔL| 0.0004 · footprint 6.3% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 12288 px off the canvas → ok
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
- pond (§3.1, whole frame, reported only): coverage 0.4% (ΔC > 0.015) · p95 |ΔL| 0.001 · mean |ΔL| 0.0004 · footprint 6.4% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 12288 px off the canvas → ok
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
- pond (§3.1, whole frame, reported only): coverage 0% (ΔC > 0.015) · p95 |ΔL| 0 · mean |ΔL| 0 · footprint 1.1% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, pixels not checked under a dialog → ok
- screenshot: shots/popup-link-dialog-morning-en.png

### popup-results

- a: 5 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Instrument Sans 15px/22px 600
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=16 (3: div.segmented “Media3Downloads” | div.segmented “Media3Downloads”) · x=60 (13: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 29
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only): coverage 0% (ΔC > 0.015) · p95 |ΔL| 0 · mean |ΔL| 0 · footprint 1.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 12288 px off the canvas → ok
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
- pond (§3.1, whole frame, reported only): coverage 0% (ΔC > 0.015) · p95 |ΔL| 0 · mean |ΔL| 0 · footprint 0.8% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, pixels not checked under a dialog → ok
- screenshot: shots/popup-media-dialog-morning-en.png

### settings-1280

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=200 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=272 (1: span.t-wordmark “FluxCatch”) · x=448 (75: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 124
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.8% (ΔC > 0.015) · p95 |ΔL| 0.02 · mean |ΔL| 0.003 · footprint 29.5% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/settings-1280-morning-en.png

### settings-960

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=40 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=112 (1: span.t-wordmark “FluxCatch”) · x=288 (75: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 124
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only, 40 px gutters): coverage 0.4% (ΔC > 0.015) · p95 |ΔL| 0.002 · mean |ΔL| 0.0004 · footprint 6.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 17920 px off the canvas → ok
- screenshot: shots/settings-960-morning-en.png

### settings-full-1280

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=200 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=272 (1: span.t-wordmark “FluxCatch”) · x=448 (75: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 124
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.2% (ΔC > 0.015) · p95 |ΔL| 0.018 · mean |ΔL| 0.0029 · footprint 31.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/settings-full-1280-morning-en.png

### popup-downloads-active

- a: 4 styles — Instrument Sans 13px/20px 500 · Instrument Sans 12px/18px 400 · Fraunces 17px/20px 600 · Instrument Sans 13px/20px 400
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=16 (4: div.segmented “Media3Downloads2” | div.segmented “Media3Downloads2”) · x=60 (6: span.t-wordmark “FluxCatch” | span.filename-head “Lecture 12 · Pharmaco”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 20
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only): coverage 0.7% (ΔC > 0.015) · p95 |ΔL| 0.003 · mean |ΔL| 0.0006 · footprint 9.1% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 12288 px off the canvas → ok
- screenshot: shots/popup-downloads-active-morning-en.png

### settings-active-1280

- a: 6 styles — Instrument Sans 13px/20px 500 · Instrument Sans 13px/20px 400 · Instrument Sans 12px/18px 400 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#settingsTitle.t-display “Settings”
- b: 3 left edges — x=200 (12: h1#settingsTitle.t-display “Settings” | p#settingsSubtitle.t-body “Choose where and how FluxCatch saves your downlo”) · x=272 (1: span.t-wordmark “FluxCatch”) · x=448 (67: h2#status-heading.t-title.section-title “Status” | span#row-engine-name.setting-name.t-row “Local engine”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 115
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.1% (ΔC > 0.015) · p95 |ΔL| 0.018 · mean |ΔL| 0.0029 · footprint 31.8% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/settings-active-1280-morning-en.png

## Locale leaks (f)

- none

## Dusk contrast failures (d)

- none

## Pond acceptance (§3.1), judged screens

| Screen | Theme | Lang | gutters | coverage | p95 |ΔL| | mean |ΔL| | under text | verdict |
|---|---|---|---|---|---|---|---|---|
| settings-1280 | morning | en | 200 px | 4.8% | 0.02 | 0.003 | 0 | ok |
| settings-full-1280 | morning | en | 200 px | 4.2% | 0.018 | 0.0029 | 0 | ok |
| settings-1280 | dusk | en | 200 px | 5% | 0.044 | 0.0068 | 0 | ok |
| settings-full-1280 | dusk | en | 200 px | 5.1% | 0.046 | 0.0064 | 0 | ok |
| settings-active-1280 | morning | en | 200 px | 4.1% | 0.018 | 0.0029 | 0 | ok |
| settings-active-1280 | dusk | en | 200 px | 3.8% | 0.04 | 0.0064 | 0 | ok |
| settings-1280 | morning | zh | 200 px | 4.8% | 0.02 | 0.003 | 0 | ok |
| settings-full-1280 | morning | zh | 200 px | 5.4% | 0.021 | 0.0031 | 0 | ok |
| settings-1280 | dusk | zh | 200 px | 5% | 0.044 | 0.0068 | 0 | ok |
| settings-full-1280 | dusk | zh | 200 px | 3.9% | 0.04 | 0.0064 | 0 | ok |
| settings-active-1280 | morning | zh | 200 px | 5.4% | 0.021 | 0.0031 | 0 | ok |
| settings-active-1280 | dusk | zh | 200 px | 5.1% | 0.046 | 0.0064 | 0 | ok |

Pond under text: none on any screen.

## Pond seed sweep (§3.1)

- not run (downloads-1280 in English was not in this run).

## Header at scroll 0 (§3.6)

- every screen with a top bar passes (40 screens).

## Colour literals outside the token files (h)

- none

## Definitions

See the header of scripts/lib/page-audit.mjs for the exact definition of each check.
