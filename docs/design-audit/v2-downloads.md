# FluxCatch design audit — v2-downloads

Run 2026-10-21T00:29:58.406Z · commit 8758f45 · Chrome for Testing · DPR 2

Budgets: a ≤ 6 text styles per screen (≤ 8 app-wide) · Display ≤ 2 per screen outside the BrandMark · b ≤ 3 left edges · c 0 nested containers · d 0 contrast failures · e 0 clipped/covered · f 0 locale leaks · g 0 rules · names 0 end-truncated filenames · h 0 colour literals.

## Summary

- Screens audited: 24; screens meeting every budget: 24.
- App-wide text styles (a), per UI language: en 7, zh 7 (budget 8); 10 across both languages.
- Colour literals outside the token files (h): 12 ✗.

| Screen | Theme | Lang | a styles | Display | b edges | c nesting | d contrast | e clip | f locale | g rules | names | pond |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| downloads-1280 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | morning | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | morning | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | dusk | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | dusk | en | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | morning | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | dusk | en | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-1280 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-960 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | morning | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | morning | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-1280 | dusk | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-empty-960 | dusk | zh | 5 | 2 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | morning | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-1280 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |
| downloads-active-960 | dusk | zh | 6 | 1 | 2 | 0 | 0 | 0 | 0 | 0 | 0 | ✓ |

## App-wide text styles

- `Fraunces, Noto Serif SC` 17px / 20px · 600 — on 24 screen(s), e.g. “FluxCatch”
- `Fraunces, Noto Serif SC` 28px / 34px · 500 — on 24 screen(s), e.g. “Downloads”
- `Instrument Sans, PingFang SC` 12px / 16px · 600 — on 16 screen(s), e.g. “Today”
- `Instrument Sans, PingFang SC` 13px / 20px · 500 — on 12 screen(s), e.g. “Download”
- `Instrument Sans, PingFang SC` 13px / 20px · 400 — on 12 screen(s), e.g. “Local engine isn’t set up”
- `Instrument Sans, PingFang SC` 13px / 22px · 500 — on 12 screen(s), e.g. “下载”
- `Instrument Sans, PingFang SC` 13px / 22px · 400 — on 12 screen(s), e.g. “本地引擎尚未设置”
- `Instrument Sans, PingFang SC` 12px / 18px · 400 — on 8 screen(s), e.g. “3 files · 3.2 GB”
- `Fraunces, Noto Serif SC` 19px / 26px · 400 — on 8 screen(s), e.g. “Nothing downloaded yet.”
- `Instrument Sans, PingFang SC` 12px / 20px · 400 — on 8 screen(s), e.g. “3 个文件 · 3.2 GB”

## Details per screen (Morning, English)

### downloads-1280

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=200 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=272 (22: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 44
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.2% · mean ΔL* 0.27 · p95 ΔL* 0.65 · mean Δchroma 4.21 → colour without value ✓
- screenshot: shots/downloads-1280-morning-en.png

### downloads-960

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=40 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=112 (22: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 44
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 9.9% · mean ΔL* 0.26 · p95 ΔL* 0.63 · mean Δchroma 3.85 → colour without value ✓
- screenshot: shots/downloads-960-morning-en.png

### downloads-empty-1280

- a: 5 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#pageTitle.t-display “Downloads”; p#emptySentence.t-empty “Nothing downloaded yet.”
- b: 2 left edges — x=200 (1: label.field.url-field “Media link”) · x=272 (5: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 8
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.5% · mean ΔL* 0.27 · p95 ΔL* 0.65 · mean Δchroma 4.2 → colour without value ✓
- screenshot: shots/downloads-empty-1280-morning-en.png

### downloads-empty-960

- a: 5 styles — Instrument Sans 13px/20px 400 · Instrument Sans 13px/20px 500 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500 · Fraunces 19px/26px 400
- Display outside BrandMark: 2 — h1#pageTitle.t-display “Downloads”; p#emptySentence.t-empty “Nothing downloaded yet.”
- b: 2 left edges — x=40 (1: label.field.url-field “Media link”) · x=112 (5: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 8
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 11% · mean ΔL* 0.25 · p95 ΔL* 0.62 · mean Δchroma 3.81 → colour without value ✓
- screenshot: shots/downloads-empty-960-morning-en.png

### downloads-active-1280

- a: 6 styles — Instrument Sans 12px/18px 400 · Instrument Sans 13px/20px 500 · Instrument Sans 12px/16px 600 · Instrument Sans 13px/20px 400 · Fraunces 17px/20px 600 · Fraunces 28px/34px 500
- Display outside BrandMark: 1 — h1#pageTitle.t-display “Downloads”
- b: 2 left edges — x=200 (7: div#filters.segmented “All5 Completed3 Failed & cancelled2” | div#filters.segmented “All5 Completed3 Failed & cancelled2”) · x=272 (28: span.t-wordmark “FluxCatch” | h1#pageTitle.t-display “Downloads”)
- c: 0 nested containers (max depth 1)
- d: 0 contrast failures of 57
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 0 rules
- names: 0 end-truncated filenames
- pond: footprint 2.5% · mean ΔL* 0.26 · p95 ΔL* 0.6 · mean Δchroma 3.92 → colour without value ✓
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
- pond: footprint 10.9% · mean ΔL* 0.26 · p95 ΔL* 0.6 · mean Δchroma 3.74 → colour without value ✓
- screenshot: shots/downloads-active-960-morning-en.png

## Locale leaks (f)

- none

## Dusk contrast failures (d)

- none

## Colour literals outside the token files (h)

- extension/background.js: 4 — L4697 #0A66D6, L4697 #3A3A3C, L4697 #8E8E93, L4705 #FFFFFF
- extension/preview/preview.css: 2 — L151 #2B2E4A, L152 #1C2140
- extension/ui/components.css: 3 — L156 %235F6382, L514 rgba(0…, L515 rgba(0…
- extension/ui/customization.js: 3 — L9 #3E6E92, L130 #FAF7F2, L131 #2B2E4A

## Definitions

See the header of scripts/lib/page-audit.mjs for the exact definition of each check.
