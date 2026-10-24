# FluxCatch design audit — v3-step4

Run 2026-10-24T05:27:10.834Z · commit uncommitted · extension extension · Chrome for Testing · DPR 2 · pond seed 0x5EED1E5

Verdicts recomputed 2026-10-24T10:25:13.314Z with the acceptance in force then (captures and measurements unchanged).

Pond (v3 §3.1): seed 0x5EED1E5 stored before each run; margins of full pages with ≥ 48 px gutters: chroma coverage 3% to 12% (ΔC > 0.015 in OKLCH against the capture without the layer), p95 |ΔL| ≤ 0.03 Morning / 0.05 Dusk; no pond pixel under any text run on any screen. Cells read "coverage · p95", in parentheses where the screen is reported but not judged (popup, side panel, 960 wide). Header (v3 §3.6): at scroll 0 the top bar is the canvas (background alpha 0, no shadow, band at opacity 0, and the capture without the layer is canvas pixel for pixel outside the content box). Contrast (d) is measured against the composited background: the pond's pixels over the canvas.

Budgets: a ≤ 6 text styles per screen (≤ 8 app-wide) · Display ≤ 2 per screen outside the BrandMark · b ≤ 3 left edges · c 0 nested containers · d 0 contrast failures · e 0 clipped/covered · f 0 locale leaks · g 0 rules · names 0 end-truncated filenames · h 0 colour literals.

## Summary

- Screens audited: 108; screens meeting every budget: 108.
- App-wide text styles (a), per UI language: en 8, zh 8 (budget 8); 11 across both languages.
- Colour literals outside the token files (h): 0.

| Screen | Theme | Lang | a styles | Display | b edges | c nesting | d contrast | e clip | f locale | g rules | names | pond | header |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| popup-media | morning | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.001) | ✓ |
| popup-jobs | morning | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.001) | ✓ |
| popup-link-dialog | morning | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel | morning | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.002) | ✓ |
| popup-results | morning | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| popup-media-dialog | morning | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-link-dialog | morning | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-results | morning | en | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.001) | ✓ |
| downloads-1280 | morning | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.7% · 0.02 | ✓ |
| downloads-960 | morning | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0.001) | ✓ |
| settings-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.02 | ✓ |
| settings-960 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.002) | ✓ |
| settings-full-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.1% · 0.018 | ✓ |
| preview | morning | en | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.3% · 0.017 | ✓ |
| preview-text | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.9% · 0.018 | ✓ |
| preview-controls | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.4% · 0.017 | ✓ |
| preview-rows | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.6% · 0.017 | ✓ |
| preview-feedback | morning | en | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.2% · 0.017 | ✓ |
| preview-overlays | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.7% · 0.018 | ✓ |
| preview-overlays-item | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.7% · 0.018 | ✓ |
| popup-media | dusk | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.003) | ✓ |
| popup-jobs | dusk | en | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.003) | ✓ |
| popup-link-dialog | dusk | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel | dusk | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.003) | ✓ |
| popup-results | dusk | en | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.7% · 0) | ✓ |
| popup-media-dialog | dusk | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-link-dialog | dusk | en | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-results | dusk | en | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.002) | ✓ |
| downloads-1280 | dusk | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.044 | ✓ |
| downloads-960 | dusk | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.2% · 0.003) | ✓ |
| settings-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5% · 0.044 | ✓ |
| settings-960 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (1.3% · 0.003) | ✓ |
| settings-full-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.8% · 0.04 | ✓ |
| preview | dusk | en | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.036 | ✓ |
| preview-text | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 6.5% · 0.039 | ✓ |
| preview-controls | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.036 | ✓ |
| preview-rows | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5.3% · 0.036 | ✓ |
| preview-feedback | dusk | en | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.1% · 0.035 | ✓ |
| preview-overlays | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 6.1% · 0.037 | ✓ |
| preview-overlays-item | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 6.1% · 0.037 | ✓ |
| downloads-empty-1280 | morning | en | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 5.8% · 0.022 | ✓ |
| downloads-empty-960 | morning | en | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (5.9% · 0.022) | ✓ |
| downloads-empty-1280 | dusk | en | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 5.8% · 0.048 | ✓ |
| downloads-empty-960 | dusk | en | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (10.8% · 0.047) | ✓ |
| popup-downloads-active | morning | en | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.7% · 0.003) | ✓ |
| sidepanel-active | morning | en | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0) | ✓ |
| downloads-active-1280 | morning | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.7% · 0.02 | ✓ |
| downloads-active-960 | morning | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0.001) | ✓ |
| settings-active-1280 | morning | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.021 | ✓ |
| popup-downloads-active | dusk | en | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.6% · 0.007) | ✓ |
| sidepanel-active | dusk | en | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.2% · 0.001) | ✓ |
| downloads-active-1280 | dusk | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.044 | ✓ |
| downloads-active-960 | dusk | en | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.003) | ✓ |
| settings-active-1280 | dusk | en | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.1% · 0.046 | ✓ |
| popup-media | morning | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.002) | ✓ |
| popup-jobs | morning | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.002) | ✓ |
| popup-link-dialog | morning | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel | morning | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.002) | ✓ |
| popup-results | morning | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0) | ✓ |
| popup-media-dialog | morning | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-link-dialog | morning | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-results | morning | zh | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.001) | ✓ |
| downloads-1280 | morning | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.7% · 0.02 | ✓ |
| downloads-960 | morning | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0.001) | ✓ |
| settings-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.02 | ✓ |
| settings-960 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (0.4% · 0.002) | ✓ |
| settings-full-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 4.2% · 0.018 | ✓ |
| preview | morning | zh | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.3% · 0.017 | ✓ |
| preview-text | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.9% · 0.018 | ✓ |
| preview-controls | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.5% · 0.017 | ✓ |
| preview-rows | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 3.7% · 0.017 | ✓ |
| preview-feedback | morning | zh | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.3% · 0.017 | ✓ |
| preview-overlays | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.7% · 0.018 | ✓ |
| preview-overlays-item | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.7% · 0.018 | ✓ |
| popup-media | dusk | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.003) | ✓ |
| popup-jobs | dusk | zh | 4 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.004) | ✓ |
| popup-link-dialog | dusk | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel | dusk | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.003) | ✓ |
| popup-results | dusk | zh | 5 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.6% · 0) | ✓ |
| popup-media-dialog | dusk | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-link-dialog | dusk | zh | 6 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0) | ✓ |
| sidepanel-results | dusk | zh | 5 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.002) | ✓ |
| downloads-1280 | dusk | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.044 | ✓ |
| downloads-960 | dusk | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.003) | ✓ |
| settings-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5% · 0.044 | ✓ |
| settings-960 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | (1.3% · 0.003) | ✓ |
| settings-full-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 3.8% · 0.04 | ✓ |
| preview | dusk | zh | 6 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.036 | ✓ |
| preview-text | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 6.4% · 0.039 | ✓ |
| preview-controls | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.036 | ✓ |
| preview-rows | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | 5.3% · 0.036 | ✓ |
| preview-feedback | dusk | zh | 6 | 2 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.1% · 0.034 | ✓ |
| preview-overlays | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 6.1% · 0.037 | ✓ |
| preview-overlays-item | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 6.1% · 0.037 | ✓ |
| downloads-empty-1280 | morning | zh | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 5.8% · 0.022 | ✓ |
| downloads-empty-960 | morning | zh | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (5.9% · 0.022) | ✓ |
| downloads-empty-1280 | dusk | zh | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 5.8% · 0.048 | ✓ |
| downloads-empty-960 | dusk | zh | 5 | 2 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (10.8% · 0.047) | ✓ |
| popup-downloads-active | morning | zh | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.6% · 0.003) | ✓ |
| sidepanel-active | morning | zh | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.2% · 0) | ✓ |
| downloads-active-1280 | morning | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.7% · 0.02 | ✓ |
| downloads-active-960 | morning | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0% · 0.001) | ✓ |
| settings-active-1280 | morning | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.4% · 0.021 | ✓ |
| popup-downloads-active | dusk | zh | 4 | 0 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | (0.5% · 0.007) | ✓ |
| sidepanel-active | dusk | zh | 4 | 0 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.2% · 0.001) | ✓ |
| downloads-active-1280 | dusk | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 4.8% · 0.044 | ✓ |
| downloads-active-960 | dusk | zh | 6 | 1 | 1 | 0 | 0 | 0 | 0 | 0 | 0 | (0.3% · 0.003) | ✓ |
| settings-active-1280 | dusk | zh | 6 | 1 | 3 | 0 | 0 | 0 | 0 | 0 | 0 | 5.1% · 0.046 | ✓ |

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

### sidepanel

- a: 6 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 15px/22px 600 · Fraunces 17px/20px 600 · Instrument Sans 12px/18px 400 · Fraunces 19px/26px 400
- Display outside BrandMark: 1 — p.t-empty “No downloadable media on this page yet.”
- b: 1 left edges — x=64 (8: span.t-wordmark “FluxCatch” | span “Local engine isn’t set up”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 11
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only, 20 px gutters): coverage 0.5% (ΔC > 0.015) · p95 |ΔL| 0.002 · mean |ΔL| 0.0004 · footprint 6.5% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 8960 px off the canvas → ok
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

### sidepanel-link-dialog

- a: 6 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 15px/22px 600 · Instrument Sans 12px/16px 600 · Fraunces 17px/20px 600 · Instrument Sans 12px/18px 400
- Display outside BrandMark: 0 — none
- b: 2 left edges — x=32 (8: h2#downloadDialog-title.t-title “Download” | label.t-label “Link”) · x=236.6 (1: span “Cancel”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 11
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only, 20 px gutters): coverage 0% (ΔC > 0.015) · p95 |ΔL| 0 · mean |ΔL| 0.0002 · footprint 3.1% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, pixels not checked under a dialog → ok
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
- pond (§3.1, whole frame, reported only, 20 px gutters): coverage 0.4% (ΔC > 0.015) · p95 |ΔL| 0.001 · mean |ΔL| 0.0004 · footprint 5.5% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 8960 px off the canvas → ok
- screenshot: shots/sidepanel-results-morning-en.png

### downloads-1280

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 1 left edges — x=272 (29: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 44
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.7% (ΔC > 0.015) · p95 |ΔL| 0.02 · mean |ΔL| 0.003 · footprint 29.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/downloads-1280-morning-en.png

### downloads-960

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 1 left edges — x=112 (29: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 44
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only, 40 px gutters): coverage 0% (ΔC > 0.015) · p95 |ΔL| 0.001 · mean |ΔL| 0.0003 · footprint 6.1% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 17920 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.8% (ΔC > 0.015) · p95 |ΔL| 0.02 · mean |ΔL| 0.003 · footprint 29.5% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
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
- pond (§3.1, whole frame, reported only, 40 px gutters): coverage 0.4% (ΔC > 0.015) · p95 |ΔL| 0.002 · mean |ΔL| 0.0004 · footprint 6.6% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 17920 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.1% (ΔC > 0.015) · p95 |ΔL| 0.018 · mean |ΔL| 0.0029 · footprint 31.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.3% (ΔC > 0.015) · p95 |ΔL| 0.017 · mean |ΔL| 0.0025 · footprint 26.4% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.9% (ΔC > 0.015) · p95 |ΔL| 0.018 · mean |ΔL| 0.0027 · footprint 27.1% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.4% (ΔC > 0.015) · p95 |ΔL| 0.017 · mean |ΔL| 0.0025 · footprint 25.3% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.6% (ΔC > 0.015) · p95 |ΔL| 0.017 · mean |ΔL| 0.0025 · footprint 23.6% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.2% (ΔC > 0.015) · p95 |ΔL| 0.017 · mean |ΔL| 0.0025 · footprint 25.4% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.7% (ΔC > 0.015) · p95 |ΔL| 0.018 · mean |ΔL| 0.0027 · footprint 26.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 280 px gutters): coverage 3.7% (ΔC > 0.015) · p95 |ΔL| 0.018 · mean |ΔL| 0.0027 · footprint 26.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 125440 px off the canvas → ok
- screenshot: shots/preview-overlays-item-morning-en.png

### downloads-empty-1280

- a: 5 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#pageTitle.t-display “Downloads”; p#emptySentence.t-empty “No downloads yet.”
- b: 1 left edges — x=272 (6: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 8
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, judged in the margins, 200 px gutters): coverage 5.8% (ΔC > 0.015) · p95 |ΔL| 0.022 · mean |ΔL| 0.0034 · footprint 30.4% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/downloads-empty-1280-morning-en.png

### downloads-empty-960

- a: 5 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#pageTitle.t-display “Downloads”; p#emptySentence.t-empty “No downloads yet.”
- b: 1 left edges — x=112 (6: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 0)
- d: 0 contrast failures of 8
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only, 40 px gutters): coverage 5.9% (ΔC > 0.015) · p95 |ΔL| 0.022 · mean |ΔL| 0.0032 · footprint 26.7% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 17920 px off the canvas → ok
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
- pond (§3.1, whole frame, reported only): coverage 0.7% (ΔC > 0.015) · p95 |ΔL| 0.003 · mean |ΔL| 0.0006 · footprint 9.1% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 12288 px off the canvas → ok
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
- pond (§3.1, whole frame, reported only, 20 px gutters): coverage 0.3% (ΔC > 0.015) · p95 |ΔL| 0 · mean |ΔL| 0.0003 · footprint 4.9% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 8960 px off the canvas → ok
- screenshot: shots/sidepanel-active-morning-en.png

### downloads-active-1280

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 1 left edges — x=272 (35: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 57
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, judged in the margins, 200 px gutters): coverage 4.7% (ΔC > 0.015) · p95 |ΔL| 0.02 · mean |ΔL| 0.003 · footprint 29.8% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/downloads-active-1280-morning-en.png

### downloads-active-960

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 1 left edges — x=112 (35: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 57
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond (§3.1, whole frame, reported only, 40 px gutters): coverage 0% (ΔC > 0.015) · p95 |ΔL| 0.001 · mean |ΔL| 0.0002 · footprint 5.9% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 17920 px off the canvas → ok
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
- pond (§3.1, judged in the margins, 200 px gutters): coverage 5.4% (ΔC > 0.015) · p95 |ΔL| 0.021 · mean |ΔL| 0.0031 · footprint 25.8% · under text 0 → ok
- header at scroll 0 (§3.6): background alpha 0, box-shadow none, band opacity 0, capture without the layer: 0 of 89600 px off the canvas → ok
- screenshot: shots/settings-active-1280-morning-en.png

## Locale leaks (f)

- none

## Dusk contrast failures (d)

- none

## Pond acceptance (§3.1), judged screens

| Screen | Theme | Lang | gutters | coverage | p95 |ΔL| | mean |ΔL| | under text | verdict |
|---|---|---|---|---|---|---|---|---|
| downloads-1280 | morning | en | 200 px | 4.7% | 0.02 | 0.003 | 0 | ok |
| settings-1280 | morning | en | 200 px | 4.8% | 0.02 | 0.003 | 0 | ok |
| settings-full-1280 | morning | en | 200 px | 4.1% | 0.018 | 0.0029 | 0 | ok |
| preview | morning | en | 280 px | 3.3% | 0.017 | 0.0025 | 0 | ok |
| preview-text | morning | en | 280 px | 3.9% | 0.018 | 0.0027 | 0 | ok |
| preview-controls | morning | en | 280 px | 3.4% | 0.017 | 0.0025 | 0 | ok |
| preview-rows | morning | en | 280 px | 3.6% | 0.017 | 0.0025 | 0 | ok |
| preview-feedback | morning | en | 280 px | 3.2% | 0.017 | 0.0025 | 0 | ok |
| preview-overlays | morning | en | 280 px | 3.7% | 0.018 | 0.0027 | 0 | ok |
| preview-overlays-item | morning | en | 280 px | 3.7% | 0.018 | 0.0027 | 0 | ok |
| downloads-1280 | dusk | en | 200 px | 4.8% | 0.044 | 0.0067 | 0 | ok |
| settings-1280 | dusk | en | 200 px | 5% | 0.044 | 0.0068 | 0 | ok |
| settings-full-1280 | dusk | en | 200 px | 3.8% | 0.04 | 0.0064 | 0 | ok |
| preview | dusk | en | 280 px | 5.4% | 0.036 | 0.0053 | 0 | ok |
| preview-text | dusk | en | 280 px | 6.5% | 0.039 | 0.0058 | 0 | ok |
| preview-controls | dusk | en | 280 px | 5.4% | 0.036 | 0.0049 | 0 | ok |
| preview-rows | dusk | en | 280 px | 5.3% | 0.036 | 0.0049 | 0 | ok |
| preview-feedback | dusk | en | 280 px | 5.1% | 0.035 | 0.0048 | 0 | ok |
| preview-overlays | dusk | en | 280 px | 6.1% | 0.037 | 0.0053 | 0 | ok |
| preview-overlays-item | dusk | en | 280 px | 6.1% | 0.037 | 0.0053 | 0 | ok |
| downloads-empty-1280 | morning | en | 200 px | 5.8% | 0.022 | 0.0034 | 0 | ok |
| downloads-empty-1280 | dusk | en | 200 px | 5.8% | 0.048 | 0.0076 | 0 | ok |
| downloads-active-1280 | morning | en | 200 px | 4.7% | 0.02 | 0.003 | 0 | ok |
| settings-active-1280 | morning | en | 200 px | 5.4% | 0.021 | 0.0031 | 0 | ok |
| downloads-active-1280 | dusk | en | 200 px | 4.8% | 0.044 | 0.0067 | 0 | ok |
| settings-active-1280 | dusk | en | 200 px | 5.1% | 0.046 | 0.0064 | 0 | ok |
| downloads-1280 | morning | zh | 200 px | 4.7% | 0.02 | 0.003 | 0 | ok |
| settings-1280 | morning | zh | 200 px | 4.8% | 0.02 | 0.003 | 0 | ok |
| settings-full-1280 | morning | zh | 200 px | 4.2% | 0.018 | 0.0029 | 0 | ok |
| preview | morning | zh | 280 px | 3.3% | 0.017 | 0.0025 | 0 | ok |
| preview-text | morning | zh | 280 px | 3.9% | 0.018 | 0.0027 | 0 | ok |
| preview-controls | morning | zh | 280 px | 3.5% | 0.017 | 0.0025 | 0 | ok |
| preview-rows | morning | zh | 280 px | 3.7% | 0.017 | 0.0025 | 0 | ok |
| preview-feedback | morning | zh | 280 px | 3.3% | 0.017 | 0.0025 | 0 | ok |
| preview-overlays | morning | zh | 280 px | 3.7% | 0.018 | 0.0027 | 0 | ok |
| preview-overlays-item | morning | zh | 280 px | 3.7% | 0.018 | 0.0027 | 0 | ok |
| downloads-1280 | dusk | zh | 200 px | 4.8% | 0.044 | 0.0067 | 0 | ok |
| settings-1280 | dusk | zh | 200 px | 5% | 0.044 | 0.0068 | 0 | ok |
| settings-full-1280 | dusk | zh | 200 px | 3.8% | 0.04 | 0.0064 | 0 | ok |
| preview | dusk | zh | 280 px | 5.4% | 0.036 | 0.0053 | 0 | ok |
| preview-text | dusk | zh | 280 px | 6.4% | 0.039 | 0.0058 | 0 | ok |
| preview-controls | dusk | zh | 280 px | 5.4% | 0.036 | 0.0049 | 0 | ok |
| preview-rows | dusk | zh | 280 px | 5.3% | 0.036 | 0.0049 | 0 | ok |
| preview-feedback | dusk | zh | 280 px | 5.1% | 0.034 | 0.0048 | 0 | ok |
| preview-overlays | dusk | zh | 280 px | 6.1% | 0.037 | 0.0053 | 0 | ok |
| preview-overlays-item | dusk | zh | 280 px | 6.1% | 0.037 | 0.0053 | 0 | ok |
| downloads-empty-1280 | morning | zh | 200 px | 5.8% | 0.022 | 0.0034 | 0 | ok |
| downloads-empty-1280 | dusk | zh | 200 px | 5.8% | 0.048 | 0.0076 | 0 | ok |
| downloads-active-1280 | morning | zh | 200 px | 4.7% | 0.02 | 0.003 | 0 | ok |
| settings-active-1280 | morning | zh | 200 px | 5.4% | 0.021 | 0.0031 | 0 | ok |
| downloads-active-1280 | dusk | zh | 200 px | 4.8% | 0.044 | 0.0067 | 0 | ok |
| settings-active-1280 | dusk | zh | 200 px | 5.1% | 0.046 | 0.0064 | 0 | ok |

Pond under text: none on any screen.

## Pond seed sweep (§3.1)

The shipped module's layer for 16 seeds on downloads-1280 (1280 × 900, margins x < 200 and x ≥ 1080), unmasked, English; the audit's pinned seed is first, the reference script's second. Masking takes the feather's share off these numbers; the judged table above has the pinned seed as seen.

| Seed | morning coverage | dusk coverage | morning p95 |ΔL| | dusk p95 |ΔL| |
|---|---|---|---|---|
| 0x5EED1E5 | 6.9% | 6.6% | 0.025 | 0.053 ✗ |
| 0xF1C4C7 | 4.4% | 4.4% | 0.019 | 0.044 |
| 0xB | 3.5% | 5.7% | 0.017 | 0.038 |
| 0x16 | 5.8% | 2.2% ✗ | 0.021 | 0.048 |
| 0x21 | 6.8% | 8.8% | 0.024 | 0.054 ✗ |
| 0x2C | 4.5% | 4.6% | 0.019 | 0.042 |
| 0x1 | 3.5% | 6.5% | 0.018 | 0.039 |
| 0x2 | 4.3% | 2% ✗ | 0.016 | 0.035 |
| 0x3 | 5.3% | 9.9% | 0.022 | 0.05 |
| 0x7 | 4.7% | 7.2% | 0.022 | 0.046 |
| 0x1234567 | 5.1% | 0.1% ✗ | 0.018 | 0.045 |
| 0xABCDEF | 4.1% | 13.2% ✗ | 0.024 | 0.051 ✗ |
| 0xC0FFEE | 11.8% | 5.4% | 0.031 ✗ | 0.07 ✗ |
| 0xBADC0DE | 6.3% | 10% | 0.026 | 0.055 ✗ |
| 0xFACADE | 7.9% | 7.7% | 0.026 | 0.058 ✗ |
| 0x9E3779B9 | 8.8% | 16.2% ✗ | 0.03 | 0.064 ✗ |

- morning: 16 of 16 seeds inside the band unmasked.

- dusk: 11 of 16 seeds inside the band unmasked.

## Header at scroll 0 (§3.6)

- every screen with a top bar passes (108 screens).

## Colour literals outside the token files (h)

- none

## Definitions

See the header of scripts/lib/page-audit.mjs for the exact definition of each check.
