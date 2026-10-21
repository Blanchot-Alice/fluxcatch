# FluxCatch design audit — v1-baseline

Run 2026-10-21T16:56:10.409Z · commit 8758f45 · Chrome for Testing · DPR 2

Budgets: a ≤ 6 text styles per screen (≤ 8 app-wide) · Display ≤ 2 per screen outside the BrandMark · b ≤ 3 left edges · c 0 nested containers · d 0 contrast failures · e 0 clipped/covered · f 0 locale leaks · g 0 rules · names 0 end-truncated filenames · h 0 colour literals.

## Summary

- Screens audited: 80; screens meeting every budget: 0.
- App-wide text styles (a), per UI language: en 58 ✗, zh 58 ✗ (budget 8); 58 across both languages.
- Colour literals outside the token files (h): 12 ✗ (counted with v1's own token file, extension/ui/tokens.css).

| Screen | Theme | Lang | a styles | Display | b edges | c nesting | d contrast | e clip | f locale | g rules | names | pond |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| popup-media | morning | en | **8 ✗** | **3 ✗** | **6 ✗** | 0 | **1 ✗** | 0 | 0 | **2 ✗** | 0 | – |
| popup-jobs | morning | en | **8 ✗** | **3 ✗** | **6 ✗** | 0 | **1 ✗** | 0 | 0 | **2 ✗** | 0 | – |
| popup-link-dialog | morning | en | **12 ✗** | **4 ✗** | 3 | **1 ✗** | 0 | **2 ✗** | 0 | **12 ✗** | 0 | – |
| sidepanel | morning | en | **11 ✗** | **5 ✗** | **12 ✗** | **2 ✗** | **1 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| popup-results | morning | en | **10 ✗** | **5 ✗** | **9 ✗** | **14 ✗** | **6 ✗** | 0 | 0 | **2 ✗** | **3 ✗** | – |
| popup-media-dialog | morning | en | **13 ✗** | **6 ✗** | 3 | **1 ✗** | 0 | **2 ✗** | 0 | **12 ✗** | 0 | – |
| sidepanel-link-dialog | morning | en | **11 ✗** | **5 ✗** | **12 ✗** | **2 ✗** | **1 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| sidepanel-results | morning | en | **15 ✗** | **4 ✗** | **14 ✗** | **14 ✗** | **6 ✗** | 0 | 0 | **5 ✗** | **3 ✗** | – |
| downloads-1280 | morning | en | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **5 ✗** | 0 | **5 ✗** | **9 ✗** | 0 | – |
| downloads-960 | morning | en | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **5 ✗** | 0 | **5 ✗** | **9 ✗** | 0 | – |
| settings-1280 | morning | en | **21 ✗** | **10 ✗** | **25 ✗** | **39 ✗** | **2 ✗** | **12 ✗** | **4 ✗** | **35 ✗** | 0 | – |
| settings-960 | morning | en | **21 ✗** | **10 ✗** | **25 ✗** | **39 ✗** | **2 ✗** | **12 ✗** | **4 ✗** | **35 ✗** | 0 | – |
| preview | morning | en | **17 ✗** | **29 ✗** | **23 ✗** | **64 ✗** | **26 ✗** | 0 | **124 ✗** | **57 ✗** | 0 | – |
| popup-media | dusk | en | **8 ✗** | **3 ✗** | **6 ✗** | 0 | **1 ✗** | 0 | 0 | **2 ✗** | 0 | – |
| popup-jobs | dusk | en | **8 ✗** | **3 ✗** | **6 ✗** | 0 | **2 ✗** | 0 | 0 | **2 ✗** | 0 | – |
| popup-link-dialog | dusk | en | **12 ✗** | **4 ✗** | 3 | **1 ✗** | **1 ✗** | **2 ✗** | 0 | **12 ✗** | 0 | – |
| sidepanel | dusk | en | **11 ✗** | **5 ✗** | **12 ✗** | **2 ✗** | 0 | 0 | 0 | **5 ✗** | 0 | – |
| popup-results | dusk | en | **10 ✗** | **5 ✗** | **9 ✗** | **14 ✗** | **10 ✗** | 0 | 0 | **2 ✗** | **3 ✗** | – |
| popup-media-dialog | dusk | en | **13 ✗** | **6 ✗** | 3 | **1 ✗** | **1 ✗** | **2 ✗** | 0 | **12 ✗** | 0 | – |
| sidepanel-link-dialog | dusk | en | **11 ✗** | **5 ✗** | **12 ✗** | **2 ✗** | 0 | 0 | 0 | **5 ✗** | 0 | – |
| sidepanel-results | dusk | en | **15 ✗** | **4 ✗** | **14 ✗** | **14 ✗** | **9 ✗** | 0 | 0 | **5 ✗** | **3 ✗** | – |
| downloads-1280 | dusk | en | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **9 ✗** | 0 | **5 ✗** | **9 ✗** | 0 | – |
| downloads-960 | dusk | en | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **9 ✗** | 0 | **5 ✗** | **9 ✗** | 0 | – |
| settings-1280 | dusk | en | **21 ✗** | **10 ✗** | **25 ✗** | **39 ✗** | **16 ✗** | **12 ✗** | **4 ✗** | **35 ✗** | 0 | – |
| settings-960 | dusk | en | **21 ✗** | **10 ✗** | **25 ✗** | **39 ✗** | **16 ✗** | **12 ✗** | **4 ✗** | **35 ✗** | 0 | – |
| preview | dusk | en | **17 ✗** | **29 ✗** | **23 ✗** | **64 ✗** | **26 ✗** | 0 | **124 ✗** | **57 ✗** | 0 | – |
| downloads-empty-1280 | morning | en | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| downloads-empty-960 | morning | en | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| downloads-empty-1280 | dusk | en | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| downloads-empty-960 | dusk | en | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| popup-downloads-active | morning | en | **9 ✗** | 2 | **5 ✗** | **2 ✗** | **1 ✗** | 0 | **2 ✗** | **4 ✗** | 0 | – |
| sidepanel-active | morning | en | **14 ✗** | **3 ✗** | **12 ✗** | **16 ✗** | **6 ✗** | 0 | **2 ✗** | **7 ✗** | **3 ✗** | – |
| downloads-active-1280 | morning | en | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **6 ✗** | 0 | **7 ✗** | **9 ✗** | 0 | – |
| downloads-active-960 | morning | en | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **6 ✗** | 0 | **7 ✗** | **9 ✗** | 0 | – |
| settings-active-1280 | morning | en | **21 ✗** | **10 ✗** | **25 ✗** | **39 ✗** | **2 ✗** | 0 | **4 ✗** | **35 ✗** | 0 | – |
| popup-downloads-active | dusk | en | **9 ✗** | 2 | **5 ✗** | **2 ✗** | **2 ✗** | 0 | **2 ✗** | **4 ✗** | 0 | – |
| sidepanel-active | dusk | en | **14 ✗** | **3 ✗** | **12 ✗** | **16 ✗** | **9 ✗** | 0 | **2 ✗** | **7 ✗** | **3 ✗** | – |
| downloads-active-1280 | dusk | en | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **9 ✗** | 0 | **7 ✗** | **9 ✗** | 0 | – |
| downloads-active-960 | dusk | en | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **9 ✗** | 0 | **7 ✗** | **9 ✗** | 0 | – |
| settings-active-1280 | dusk | en | **21 ✗** | **10 ✗** | **25 ✗** | **39 ✗** | **16 ✗** | 0 | **4 ✗** | **35 ✗** | 0 | – |
| popup-media | morning | zh | **8 ✗** | **3 ✗** | **5 ✗** | 0 | **1 ✗** | 0 | **1 ✗** | **2 ✗** | 0 | – |
| popup-jobs | morning | zh | **8 ✗** | **3 ✗** | **5 ✗** | 0 | **1 ✗** | 0 | **1 ✗** | **2 ✗** | 0 | – |
| popup-link-dialog | morning | zh | **12 ✗** | **4 ✗** | 3 | **1 ✗** | 0 | 0 | 0 | **12 ✗** | 0 | – |
| sidepanel | morning | zh | **11 ✗** | **5 ✗** | **13 ✗** | **2 ✗** | **1 ✗** | 0 | **1 ✗** | **5 ✗** | 0 | – |
| popup-results | morning | zh | **10 ✗** | **5 ✗** | **8 ✗** | **14 ✗** | **6 ✗** | 0 | **11 ✗** | **2 ✗** | **3 ✗** | – |
| popup-media-dialog | morning | zh | **13 ✗** | **6 ✗** | 3 | **1 ✗** | 0 | 0 | 0 | **12 ✗** | 0 | – |
| sidepanel-link-dialog | morning | zh | **11 ✗** | **5 ✗** | **13 ✗** | **2 ✗** | **1 ✗** | 0 | **1 ✗** | **5 ✗** | 0 | – |
| sidepanel-results | morning | zh | **15 ✗** | **4 ✗** | **15 ✗** | **14 ✗** | **6 ✗** | 0 | **13 ✗** | **5 ✗** | 0 | – |
| downloads-1280 | morning | zh | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **5 ✗** | 0 | **16 ✗** | **9 ✗** | 0 | – |
| downloads-960 | morning | zh | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **5 ✗** | 0 | **16 ✗** | **9 ✗** | 0 | – |
| settings-1280 | morning | zh | **21 ✗** | **10 ✗** | **24 ✗** | **39 ✗** | **2 ✗** | **10 ✗** | **26 ✗** | **35 ✗** | 0 | – |
| settings-960 | morning | zh | **21 ✗** | **10 ✗** | **24 ✗** | **39 ✗** | **2 ✗** | **10 ✗** | **26 ✗** | **35 ✗** | 0 | – |
| preview | morning | zh | **17 ✗** | **29 ✗** | **23 ✗** | **64 ✗** | **26 ✗** | 0 | **82 ✗** | **57 ✗** | 0 | – |
| popup-media | dusk | zh | **8 ✗** | **3 ✗** | **5 ✗** | 0 | **1 ✗** | 0 | **1 ✗** | **2 ✗** | 0 | – |
| popup-jobs | dusk | zh | **8 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | **1 ✗** | **2 ✗** | 0 | – |
| popup-link-dialog | dusk | zh | **12 ✗** | **4 ✗** | 3 | **1 ✗** | **1 ✗** | 0 | 0 | **12 ✗** | 0 | – |
| sidepanel | dusk | zh | **11 ✗** | **5 ✗** | **13 ✗** | **2 ✗** | 0 | 0 | **1 ✗** | **5 ✗** | 0 | – |
| popup-results | dusk | zh | **10 ✗** | **5 ✗** | **8 ✗** | **14 ✗** | **10 ✗** | 0 | **11 ✗** | **2 ✗** | **3 ✗** | – |
| popup-media-dialog | dusk | zh | **13 ✗** | **6 ✗** | 3 | **1 ✗** | **1 ✗** | 0 | 0 | **12 ✗** | 0 | – |
| sidepanel-link-dialog | dusk | zh | **11 ✗** | **5 ✗** | **13 ✗** | **2 ✗** | 0 | 0 | **1 ✗** | **5 ✗** | 0 | – |
| sidepanel-results | dusk | zh | **15 ✗** | **4 ✗** | **15 ✗** | **14 ✗** | **9 ✗** | 0 | **13 ✗** | **5 ✗** | 0 | – |
| downloads-1280 | dusk | zh | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **9 ✗** | 0 | **16 ✗** | **9 ✗** | 0 | – |
| downloads-960 | dusk | zh | **11 ✗** | **11 ✗** | **6 ✗** | **11 ✗** | **9 ✗** | 0 | **16 ✗** | **9 ✗** | 0 | – |
| settings-1280 | dusk | zh | **21 ✗** | **10 ✗** | **24 ✗** | **39 ✗** | **16 ✗** | **10 ✗** | **26 ✗** | **35 ✗** | 0 | – |
| settings-960 | dusk | zh | **21 ✗** | **10 ✗** | **24 ✗** | **39 ✗** | **16 ✗** | **10 ✗** | **26 ✗** | **35 ✗** | 0 | – |
| preview | dusk | zh | **17 ✗** | **29 ✗** | **23 ✗** | **64 ✗** | **26 ✗** | 0 | **82 ✗** | **57 ✗** | 0 | – |
| downloads-empty-1280 | morning | zh | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| downloads-empty-960 | morning | zh | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| downloads-empty-1280 | dusk | zh | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| downloads-empty-960 | dusk | zh | **9 ✗** | **3 ✗** | **5 ✗** | 0 | **2 ✗** | 0 | 0 | **5 ✗** | 0 | – |
| popup-downloads-active | morning | zh | **9 ✗** | 2 | **6 ✗** | **2 ✗** | **1 ✗** | 0 | **5 ✗** | **4 ✗** | 0 | – |
| sidepanel-active | morning | zh | **14 ✗** | **3 ✗** | **13 ✗** | **16 ✗** | **6 ✗** | 0 | **17 ✗** | **7 ✗** | 0 | – |
| downloads-active-1280 | morning | zh | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **6 ✗** | 0 | **21 ✗** | **9 ✗** | 0 | – |
| downloads-active-960 | morning | zh | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **6 ✗** | 0 | **21 ✗** | **9 ✗** | 0 | – |
| settings-active-1280 | morning | zh | **21 ✗** | **10 ✗** | **24 ✗** | **39 ✗** | **2 ✗** | 0 | **26 ✗** | **35 ✗** | 0 | – |
| popup-downloads-active | dusk | zh | **9 ✗** | 2 | **6 ✗** | **2 ✗** | **2 ✗** | 0 | **5 ✗** | **4 ✗** | 0 | – |
| sidepanel-active | dusk | zh | **14 ✗** | **3 ✗** | **13 ✗** | **16 ✗** | **9 ✗** | 0 | **17 ✗** | **7 ✗** | 0 | – |
| downloads-active-1280 | dusk | zh | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **9 ✗** | 0 | **21 ✗** | **9 ✗** | 0 | – |
| downloads-active-960 | dusk | zh | **15 ✗** | **14 ✗** | **7 ✗** | **11 ✗** | **9 ✗** | 0 | **21 ✗** | **9 ✗** | 0 | – |
| settings-active-1280 | dusk | zh | **21 ✗** | **10 ✗** | **24 ✗** | **39 ✗** | **16 ✗** | 0 | **26 ✗** | **35 ✗** | 0 | – |

## App-wide text styles

- `IBM Plex Sans, Inter` 12.5px / 18.125px · 500 — on 64 screen(s), e.g. “Media”
- `Fraunces, Source Serif 4` 18px / 19.8px · 400 — on 64 screen(s), e.g. “FluxCatch”
- `IBM Plex Sans, Inter` 12px / 17.4px · 400 — on 56 screen(s), e.g. “The format follows the address type; lin”
- `IBM Plex Sans, Inter` 11.5px / 16.675px · 500 — on 48 screen(s), e.g. “0”
- `IBM Plex Sans, Inter` 13px / 18.85px · 400 — on 40 screen(s), e.g. “Rescan this page”
- `IBM Plex Sans, Inter` 12px / 17.4px · 500 — on 40 screen(s), e.g. “May request local engine permission afte”
- `IBM Plex Sans, Inter` 12px / 18.6px · 400 — on 40 screen(s), e.g. “Files saved by the local engine never ap”
- `IBM Plex Sans, Inter` 12px / 12px · 500 — on 36 screen(s), e.g. “Workspace”
- `IBM Plex Sans, Inter` 12.5px / 19.375px · 400 — on 36 screen(s), e.g. “Play the video, then rescan; scanning ne”
- `IBM Plex Sans, Inter` 12px / 16.8px · 400 — on 36 screen(s), e.g. “Not enabled yet; you will be asked for p”
- `Fraunces, Source Serif 4` 32px / 35.2px · 400 — on 36 screen(s), e.g. “Downloads”
- `Fraunces, Source Serif 4` 18px / 26.1px · 400 — on 28 screen(s), e.g. “Download link”
- `IBM Plex Sans, Inter` 12px / 16.2px · 400 — on 28 screen(s), e.g. “lectures.example.org”
- `Fraunces, Source Serif 4` 12px / 15.6px · 400 — on 24 screen(s), e.g. “Keep What You See.”
- `IBM Plex Sans, Inter` 13px / 17.55px · 500 — on 24 screen(s), e.g. “Reading list”
- `IBM Plex Sans, Inter` 11px / 15.95px · 500 — on 24 screen(s), e.g. “HLS”
- `Fraunces, Source Serif 4` 18px / 21.6px · 400 — on 16 screen(s), e.g. “Media on this page”
- `IBM Plex Sans, Inter` 13px / 16.9px · 500 — on 16 screen(s), e.g. “Local download engine is not ready”
- `IBM Plex Sans, Inter` 11.5px / 16.1px · 500 — on 16 screen(s), e.g. “HLS”
- `Fraunces, Source Serif 4` 15px / 20.25px · 450 — on 16 screen(s), e.g. “Interstellar Trailer 4K.mp4”
- `Fraunces, Source Serif 4` 15px / 21.75px · 400 — on 16 screen(s), e.g. “Today”
- `IBM Plex Sans, Inter` 13px / 19.5px · 500 — on 16 screen(s), e.g. “Skip to settings content”
- `IBM Plex Sans, Inter` 12px / 18px · 500 — on 16 screen(s), e.g. “Language”
- `IBM Plex Sans, Inter` 12px / 18px · 400 — on 16 screen(s), e.g. “Extension version”
- `IBM Plex Sans, Inter` 13px / 19.5px · 400 — on 16 screen(s), e.g. “Tune the download experience and confirm”
- `IBM Plex Sans, Inter` 13px / 18.85px · 500 — on 16 screen(s), e.g. “Trusted Instagram/X only”
- `Fraunces, Source Serif 4` 13px / 19.5px · 400 — on 16 screen(s), e.g. “Local-first media instrument”
- `Fraunces, Source Serif 4` 20px / 29px · 400 — on 12 screen(s), e.g. “No media detected yet”
- `IBM Plex Sans, Inter` 12px / 19.2px · 400 — on 12 screen(s), e.g. “Most media is saved safely through the l”
- `Fraunces, Source Serif 4` 18px / 23.4px · 400 — on 12 screen(s), e.g. “Runtime identity & capabilities”
- `ui-monospace, SF Mono` 12px / 12px · 500 — on 12 screen(s), e.g. “{title}”
- `IBM Plex Sans, Inter` 12px / 19.2px · 500 — on 12 screen(s), e.g. “Save path:”
- `ui-monospace, SF Mono` 12px / 17.4px · 500 — on 12 screen(s), e.g. “gpnojfocoanelgibidlhholjobljefab”
- `ui-monospace, SF Mono` 12px / normal · 400 — on 12 screen(s), e.g. “./scripts/native-install-wrapper.sh”
- `IBM Plex Sans, Inter` 14px / 21px · 500 — on 12 screen(s), e.g. “Supported in this build”
- `ui-monospace, SF Mono` 13px / 19.5px · 400 — on 12 screen(s), e.g. “~/Downloads/FluxCatch”
- `IBM Plex Sans, Inter` 12px / 18.6px · 700 — on 12 screen(s), e.g. “Always blocked:”
- `ui-monospace, SF Mono` 13px / 20.15px · 400 — on 12 screen(s), e.g. “ads.example.com”
- `IBM Plex Sans, Inter` 18px / 18px · 400 — on 8 screen(s), e.g. “×”
- `Fraunces, Source Serif 4` 13px / 16.9px · 500 — on 8 screen(s), e.g. “Lecture 12 · Pharmacokinetics”
- `IBM Plex Sans, Inter` 12px / 15.6px · 400 — on 8 screen(s), e.g. “just now”
- `IBM Plex Sans, Inter` 12.5px / 18.125px · 400 — on 8 screen(s), e.g. “Check & download”
- `IBM Plex Sans, Inter` 10.5px / 15.225px · 500 — on 8 screen(s), e.g. “HLS”
- `Fraunces, Source Serif 4` 24px / 34.8px · 400 — on 8 screen(s), e.g. “No downloads yet”
- `IBM Plex Sans, Inter` 13px / 20.8px · 400 — on 8 screen(s), e.g. “Start a download from the toolbar icon o”
- `IBM Plex Sans, Inter` 13px / 17.55px · 400 — on 8 screen(s), e.g. “2:31 left”
- `IBM Plex Sans, Inter` 12.5px / 18.75px · 500 — on 4 screen(s), e.g. “媒体”
- `IBM Plex Sans, Inter` 11.5px / 17.25px · 500 — on 4 screen(s), e.g. “12”
- `IBM Plex Sans, Inter` 11px / 16.5px · 400 — on 4 screen(s), e.g. “action”
- `Fraunces, Source Serif 4` 18px / 27px · 400 — on 4 screen(s), e.g. “FluxCatch”
- `Fraunces, Source Serif 4` 15px / 22.5px · 450 — on 4 screen(s), e.g. “Lecture 12 · Pharmacokinetics.mp4”
- `IBM Plex Sans, Inter` 12.5px / 17.5px · 500 — on 4 screen(s), e.g. “已保存到 ~/Downloads/FluxCatch”
- `IBM Plex Sans, Inter` 12.5px / 18.75px · 400 — on 4 screen(s), e.g. “两个时刻的同一片水面：左为清晨（浅色），右为黄昏（深色）。所有颜色、纹理与动效均”
- `Fraunces, Source Serif 4` 32px / 48px · 400 — on 4 screen(s), e.g. “清晨 · Morning”
- `Fraunces, Source Serif 4` 12px / 18px · 400 — on 4 screen(s), e.g. “Keep What You See.”
- `Fraunces, Source Serif 4` 24px / 36px · 400 — on 4 screen(s), e.g. “没有正在下载的内容。池水静止。”
- `Fraunces, Source Serif 4` 24px / 27.6px · 400 — on 4 screen(s), e.g. “组件预览 · Component preview”
- `IBM Plex Sans, Inter` 12px / 16.2px · 500 — on 4 screen(s), e.g. “5.5 MiB/s”

## Details per screen (Morning, English)

### popup-media

- a: 8 styles — IBM Plex Sans 12px/12px 500 · IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 11.5px/16.675px 500 · Fraunces 18px/19.8px 400 · Fraunces 12px/15.6px 400 · Fraunces 20px/29px 400 · IBM Plex Sans 12.5px/19.375px 400 · IBM Plex Sans 13px/18.85px 400
- Display outside BrandMark: 3 — h1 “FluxCatch”; p.tagline “Keep What You See.”; h2 “No media detected yet”
- b: 6 left edges — x=16 (4: div.segmented “Media0 Jobs0” | div.segmented “Media0 Jobs0”) · x=20.9 (1: button#workspaceButton.foot-btn “Workspace”) · x=41.5 (1: p “Play the video, then rescan; scanning never relo”) · x=56 (2: h1 “FluxCatch” | p.tagline “Keep What You See.”) · x=86.2 (1: h2 “No media detected yet”) · x=118.7 (1: button#forceButton.dl-btn “Rescan this page”)
- c: 0 nested containers (max depth 1)
- d: 1 contrast failures of 14
  - 4.17:1 < 4.5 — span#jobCount.count “0” (#57667B on #DAD9DC, 11.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 2 rules
  - section.control-row “Media0 Jobs0 Download all All Video Audio Stream”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - footer.foot-actions “Workspace Downloads Folder Clear results”: hairline shadow “rgba(43, 46, 74, 0.1) 0px -1px 0px 0px”
- names: 0 end-truncated filenames
- screenshot: shots/popup-media-morning-en.png

### popup-jobs

- a: 8 styles — IBM Plex Sans 12px/12px 500 · IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 11.5px/16.675px 500 · Fraunces 18px/19.8px 400 · Fraunces 12px/15.6px 400 · Fraunces 20px/29px 400 · IBM Plex Sans 12.5px/19.375px 400 · IBM Plex Sans 13px/18.85px 400
- Display outside BrandMark: 3 — h1 “FluxCatch”; p.tagline “Keep What You See.”; h2 “No jobs yet”
- b: 6 left edges — x=16 (4: div.segmented “Media0 Jobs0” | div.segmented “Media0 Jobs0”) · x=20.9 (1: button#workspaceButton.foot-btn “Workspace”) · x=56 (2: h1 “FluxCatch” | p.tagline “Keep What You See.”) · x=57.7 (1: p “Live speed and progress show up here once a down”) · x=136.2 (1: h2 “No jobs yet”) · x=139 (1: button#emptyHistoryButton.text-button “View downloads”)
- c: 0 nested containers (max depth 1)
- d: 1 contrast failures of 13
  - 4.24:1 < 4.5 — span#jobCount.count “0” (#3B6A8D on #D9DDE2, 11.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 2 rules
  - section.control-row “Media0 Jobs0 Download all All Video Audio Stream”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - footer.foot-actions “Workspace Downloads Folder Clear results”: hairline shadow “rgba(43, 46, 74, 0.1) 0px -1px 0px 0px”
- names: 0 end-truncated filenames
- screenshot: shots/popup-jobs-morning-en.png

### popup-link-dialog

- a: 12 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 13px/18.85px 400 · IBM Plex Sans 12px/12px 500 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 12px/17.4px 500 · Fraunces 18px/19.8px 400 · Fraunces 12px/15.6px 400 · Fraunces 20px/29px 400 · IBM Plex Sans 12.5px/19.375px 400 · Fraunces 18px/26.1px 400 · IBM Plex Sans 18px/18px 400
- Display outside BrandMark: 4 — h1 “FluxCatch”; p.tagline “Keep What You See.”; h2 “No media detected yet”; h2#downloadDialogTitle “Download link”
- b: 3 left edges — x=34 (8: h2#downloadDialogTitle “Download link” | label#urlLabel “Media address”) · x=46 (3: strong#dialogRequirementTitle “May request local engine permission after submit” | p#dialogRequirementText “This source must be saved through the local down”) · x=108.4 (1: button.secondary “Cancel”)
- c: 1 nested containers (max depth 2)
  - dialog#downloadDialog “Download link× Media address File name Save form” ⊃ div#dialogRequirement.permission-explainer “May request local engine permission after submit”
- d: 0 contrast failures of 14
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 2
  - button.secondary “Cancel” — action not fully visible at rest (bottom 549 > 546)
  - button#confirmDownload.primary “Continue & download” — action not fully visible at rest (bottom 549 > 546)
- g: 12 rules
  - input#urlInput “https://example.com/clip.mp4”: top border 1px solid
  - input#urlInput “https://example.com/clip.mp4”: right border 1px solid
  - input#urlInput “https://example.com/clip.mp4”: bottom border 1px solid
  - input#urlInput “https://example.com/clip.mp4”: left border 1px solid
  - input#filenameInput “Leave empty to name automatically”: top border 1px solid
  - input#filenameInput “Leave empty to name automatically”: right border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/popup-link-dialog-morning-en.png

### sidepanel

- a: 11 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · Fraunces 18px/21.6px 400 · Fraunces 18px/26.1px 400 · IBM Plex Sans 12.5px/19.375px 400 · Fraunces 18px/19.8px 400 · IBM Plex Sans 13px/17.55px 500 · IBM Plex Sans 12px/16.2px 400 · IBM Plex Sans 13px/16.9px 500 · IBM Plex Sans 12px/16.8px 400 · IBM Plex Sans 12px/17.4px 500
- Display outside BrandMark: 5 — strong “FluxCatch”; h2#mediaHeading “Media on this page”; h3 “No media detected yet”; h2#jobsHeading “Download jobs”; h3 “No downloads yet”
- b: 12 left edges — x=20 (4: h2#mediaHeading “Media on this page” | p “Downloadable video, audio and streams found here”) · x=30 (1: p#localEngineBoundary.action-boundary “Items marked “Check & download” need the local d”) · x=32.2 (1: p “Play the video, then click “Rescan”; scanning ne”) · x=45.9 (1: p “Start a download from the popup or this workspac”) · x=50 (2: h2#hostTitle “Local download engine is not ready” | p#hostDetail “Not enabled yet; you will be asked for permissio”) · x=56 (2: strong “FluxCatch” | small “Media workspace”) · x=82 (2: h1#pageTitle “Reading list” | p#pageUrl “lectures.example.org”) · x=91 (1: button#scanButton.quiet-button “Rescan”) · x=120 (1: h3 “No media detected yet”) · x=137.5 (1: h3 “No downloads yet”) · x=211.9 (1: button#historyButton.quiet-button “All downloads”) · x=384.3 (1: span#mediaCount.count “0”)
- c: 2 nested containers (max depth 3)
  - section.page-context “Reading list lectures.example.org Rescan Downloa” ⊃ div.page-mark
  - div.page-mark ⊃ span
- d: 1 contrast failures of 22
  - 4.45:1 < 4.5 — span#mediaCount.count “0” (#57667B on #E1E1DE, 12px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 5 rules
  - header.topbar “FluxCatchMedia workspace Open settings”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - span: top border 2px solid
  - span: right border 2px solid
  - span: bottom border 2px solid
  - span: left border 2px solid
- names: 0 end-truncated filenames
- screenshot: shots/sidepanel-morning-en.png

### popup-results

- a: 10 styles — IBM Plex Sans 11.5px/16.1px 500 · IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 12px/12px 500 · Fraunces 13px/16.9px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 11.5px/16.675px 500 · Fraunces 18px/19.8px 400 · Fraunces 12px/15.6px 400 · IBM Plex Sans 11px/15.95px 500
- Display outside BrandMark: 5 — h1 “FluxCatch”; p.tagline “Keep What You See.”; h2.media-title “Lecture 12 · Pharmacokinetics”; h2.media-title “Lecture 12 · Pharmacokinetics”; h2.media-title “Lecture 12 · Pharmacokinetics”
- b: 9 left edges — x=16 (4: div.segmented “Media3 Jobs0” | div.segmented “Media3 Jobs0”) · x=20.9 (1: button#workspaceButton.foot-btn “Workspace”) · x=43.1 (1: div.kind-icon.stream “HLS”) · x=47.9 (2: div.kind-icon.audio “♫” | div.kind-icon.video “▶”) · x=56 (2: h1 “FluxCatch” | p.tagline “Keep What You See.”) · x=90 (5: h2.media-title “Lecture 12 · Pharmacokinetics” | h2.media-title “Lecture 12 · Pharmacokinetics”) · x=98 (5: span.chip.hls “HLS” | span.chip “774.4 MiB”) · x=256.8 (1: button.download-button “Download”) · x=273.6 (1: button.more-button “Copy link”)
- c: 14 nested containers (max depth 3)
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ div.kind-icon.stream “HLS”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.hls “HLS”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.live “Pick”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.hd “1080p”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ li.media-card “▶Lecture 12 · Pharmacokineticsmedia.example.net/”
  - li.media-card “▶Lecture 12 · Pharmacokineticsmedia.example.net/” ⊃ div.kind-icon.video “▶”
- d: 6 contrast failures of 36
  - 4.17:1 < 4.5 — span#jobCount.count “0” (#57667B on #DAD9DC, 11.5px 500)
  - 4.46:1 < 4.5 — div.kind-icon.video “▶” (#3B6A8D on #D8E4EB, 12px 500)
  - 4.46:1 < 4.5 — span.chip.hd “360p” (#3B6A8D on #D8E4EB, 11.5px 500)
  - 4.38:1 < 4.5 — span.chip “774.4 MiB” (#57667B on #D9E0E5, 11.5px 500)
  - 4.38:1 < 4.5 — span.chip “Multi-connection” (#57667B on #D9E0E5, 11.5px 500)
  - 4.46:1 < 4.5 — button.download-button “Download” (#3B6A8D on #D8E4EB, 12.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 2 rules
  - section.control-row “Media3 Jobs0 Download all All Video Audio Stream”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - footer.foot-actions “Workspace Downloads Folder Clear results”: hairline shadow “rgba(43, 46, 74, 0.1) 0px -1px 0px 0px”
- names: 3 end-truncated filenames
  - h2.media-title “Lecture 12 · Pharmacokinetics”
  - h2.media-title “Lecture 12 · Pharmacokinetics”
  - h2.media-title “Lecture 12 · Pharmacokinetics”
- screenshot: shots/popup-results-morning-en.png

### popup-media-dialog

- a: 13 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 11.5px/16.1px 500 · IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 13px/18.85px 400 · IBM Plex Sans 12px/12px 500 · Fraunces 13px/16.9px 500 · IBM Plex Sans 11.5px/16.675px 500 · Fraunces 18px/19.8px 400 · Fraunces 12px/15.6px 400 · IBM Plex Sans 11px/15.95px 500 · Fraunces 18px/26.1px 400 · IBM Plex Sans 18px/18px 400
- Display outside BrandMark: 6 — h1 “FluxCatch”; p.tagline “Keep What You See.”; h2.media-title “Lecture 12 · Pharmacokinetics”; h2.media-title “Lecture 12 · Pharmacokinetics”; h2.media-title “Lecture 12 · Pharmacokinetics”; h2#downloadDialogTitle “Download settings”
- b: 3 left edges — x=34 (8: h2#downloadDialogTitle “Download settings” | label “File name”) · x=46 (3: strong#dialogRequirementTitle “May request local engine permission after submit” | p#dialogRequirementText “This media is downloaded and merged on your mach”) · x=108.4 (1: button.secondary “Cancel”)
- c: 1 nested containers (max depth 2)
  - dialog#downloadDialog “Download settings× Media address File name Save ” ⊃ div#dialogRequirement.permission-explainer “May request local engine permission after submit”
- d: 0 contrast failures of 14
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 2
  - button.secondary “Cancel” — action not fully visible at rest (bottom 601 > 546)
  - button#confirmDownload.primary “Continue & download” — action not fully visible at rest (bottom 601 > 546)
- g: 12 rules
  - input#filenameInput “Lecture 12 · Pharmacokinetics.mp4”: top border 1px solid
  - input#filenameInput “Lecture 12 · Pharmacokinetics.mp4”: right border 1px solid
  - input#filenameInput “Lecture 12 · Pharmacokinetics.mp4”: bottom border 1px solid
  - input#filenameInput “Lecture 12 · Pharmacokinetics.mp4”: left border 1px solid
  - select#containerSelect “Original (no conversion)MP4MKVWebMMP3 (needs the”: top border 1px solid
  - select#containerSelect “Original (no conversion)MP4MKVWebMMP3 (needs the”: right border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/popup-media-dialog-morning-en.png

### sidepanel-link-dialog

- a: 11 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · Fraunces 18px/21.6px 400 · Fraunces 18px/26.1px 400 · IBM Plex Sans 12.5px/19.375px 400 · Fraunces 18px/19.8px 400 · IBM Plex Sans 13px/17.55px 500 · IBM Plex Sans 12px/16.2px 400 · IBM Plex Sans 13px/16.9px 500 · IBM Plex Sans 12px/16.8px 400 · IBM Plex Sans 12px/17.4px 500
- Display outside BrandMark: 5 — strong “FluxCatch”; h2#mediaHeading “Media on this page”; h3 “No media detected yet”; h2#jobsHeading “Download jobs”; h3 “No downloads yet”
- b: 12 left edges — x=20 (4: h2#mediaHeading “Media on this page” | p “Downloadable video, audio and streams found here”) · x=30 (1: p#localEngineBoundary.action-boundary “Items marked “Check & download” need the local d”) · x=32.2 (1: p “Play the video, then click “Rescan”; scanning ne”) · x=45.9 (1: p “Start a download from the popup or this workspac”) · x=50 (2: h2#hostTitle “Local download engine is not ready” | p#hostDetail “Not enabled yet; you will be asked for permissio”) · x=56 (2: strong “FluxCatch” | small “Media workspace”) · x=82 (2: h1#pageTitle “Reading list” | p#pageUrl “lectures.example.org”) · x=91 (1: button#scanButton.quiet-button “Rescan”) · x=120 (1: h3 “No media detected yet”) · x=137.5 (1: h3 “No downloads yet”) · x=211.9 (1: button#historyButton.quiet-button “All downloads”) · x=384.3 (1: span#mediaCount.count “0”)
- c: 2 nested containers (max depth 3)
  - section.page-context “Reading list lectures.example.org Rescan Downloa” ⊃ div.page-mark
  - div.page-mark ⊃ span
- d: 1 contrast failures of 22
  - 4.45:1 < 4.5 — span#mediaCount.count “0” (#57667B on #E1E1DE, 12px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 5 rules
  - header.topbar “FluxCatchMedia workspace Open settings”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - span: top border 2px solid
  - span: right border 2px solid
  - span: bottom border 2px solid
  - span: left border 2px solid
- names: 0 end-truncated filenames
- screenshot: shots/sidepanel-link-dialog-morning-en.png

### sidepanel-results

- a: 15 styles — IBM Plex Sans 11.5px/16.1px 500 · IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 12px/16.2px 400 · IBM Plex Sans 13px/16.9px 500 · IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 12px/15.6px 400 · IBM Plex Sans 12.5px/18.125px 400 · Fraunces 18px/21.6px 400 · Fraunces 18px/19.8px 400 · IBM Plex Sans 13px/17.55px 500 · IBM Plex Sans 12px/16.8px 400 · IBM Plex Sans 10.5px/15.225px 500 · Fraunces 18px/26.1px 400 · IBM Plex Sans 12.5px/19.375px 400
- Display outside BrandMark: 4 — strong “FluxCatch”; h2#mediaHeading “Media on this page”; h2#jobsHeading “Download jobs”; h3 “No downloads yet”
- b: 14 left edges — x=20 (4: h2#mediaHeading “Media on this page” | p “Downloadable video, audio and streams found here”) · x=30 (1: p#localEngineBoundary.action-boundary “Items marked “Check & download” need the local d”) · x=32.8 (2: span.kind-icon.audio “AUDIO” | span.kind-icon.video “VIDEO”) · x=41.5 (1: span.kind-icon.stream “HLS”) · x=45.9 (1: p “Start a download from the popup or this workspac”) · x=50 (2: h2#hostTitle “Local download engine is not ready” | p#hostDetail “Not enabled yet; you will be asked for permissio”) · x=56 (2: strong “FluxCatch” | small “Media workspace”) · x=82 (2: h1#pageTitle “Lecture 12 · Pharmacokinetics” | p#pageUrl “lectures.example.org”) · x=86 (4: h3.media-title “Lecture 12 · Pharmacokinetics” | h3.media-title “Lecture 12 · Pharmacokinetics”) · x=91 (1: button#scanButton.quiet-button “Rescan”) · x=94 (4: span.chip.stream “HLS” | span.chip “VIDEO”) · x=137.5 (1: h3 “No downloads yet”) · x=211.9 (1: button#historyButton.quiet-button “All downloads”) · x=275.3 (1: button#urlDownloadButton.quiet-button “Download a link”)
- c: 14 nested containers (max depth 3)
  - section.page-context “Lecture 12 · Pharmacokinetics lectures.example.o” ⊃ div.page-mark
  - div.page-mark ⊃ span
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.kind-icon.stream “HLS”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.stream “HLS”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.quality “Pick”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.quality “1080p”
- d: 6 contrast failures of 44
  - 4.45:1 < 4.5 — span#mediaCount.count “3” (#57667B on #E1E1DE, 12px 500)
  - 4.46:1 < 4.5 — span.kind-icon.video “VIDEO” (#3B6A8D on #D8E4EB, 12px 500)
  - 4.38:1 < 4.5 — span.chip “VIDEO” (#57667B on #D9E0E5, 11.5px 500)
  - 4.46:1 < 4.5 — span.chip.quality “360p” (#3B6A8D on #D8E4EB, 11.5px 500)
  - 4.38:1 < 4.5 — span.chip “774.4 MiB” (#57667B on #D9E0E5, 11.5px 500)
  - 4.46:1 < 4.5 — button.media-download “Check & download” (#3B6A8D on #D8E4EB, 12.5px 400)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 5 rules
  - header.topbar “FluxCatchMedia workspace Open settings”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - span: top border 2px solid
  - span: right border 2px solid
  - span: bottom border 2px solid
  - span: left border 2px solid
- names: 3 end-truncated filenames
  - h3.media-title “Lecture 12 · Pharmacokinetics”
  - h3.media-title “Lecture 12 · Pharmacokinetics”
  - h3.media-title “Lecture 12 · Pharmacokinetics”
- screenshot: shots/sidepanel-results-morning-en.png

### downloads-1280

- a: 11 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 11px/15.95px 500 · Fraunces 15px/20.25px 450 · Fraunces 15px/21.75px 400 · IBM Plex Sans 12px/16.8px 400 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 13px/18.85px 400 · Fraunces 18px/19.8px 400 · Fraunces 32px/35.2px 400 · IBM Plex Sans 12px/18.6px 400
- Display outside BrandMark: 11 — strong “FluxCatch”; h1#pageTitle “Downloads”; h2.day-head “Today”; h3.job-title “Interstellar Trailer 4K.mp4”; h2.day-head “Yesterday”; h3.job-title “Keynote Highlights.m4a”
- b: 6 left edges — x=64 (2: strong “FluxCatch” | small “Downloads”) · x=204 (8: h1#pageTitle “Downloads” | p#pageSummary.page-summary “3 file(s) saved · 3.0 GiB in total”) · x=208 (5: h2.day-head “Today” | h2.day-head “Yesterday”) · x=248.9 (4: span.kind-icon.job-tile.audio “AUDIO” | span.kind-icon.job-tile.video “VIDEO”) · x=256.2 (1: span.kind-icon.job-tile.stream “HLS”) · x=331.5 (10: h3.job-title “Interstellar Trailer 4K.mp4” | a “YouTube”)
- c: 11 nested containers (max depth 3)
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.kind-icon.job-tile.video “VIDEO”
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.kind-icon.job-tile.audio “AUDIO”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7”
  - li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7” ⊃ span.kind-icon.job-tile.video “VIDEO”
- d: 5 contrast failures of 56
  - 4.01:1 < 4.5 — span#countCompleted.count “3” (#57667B on #D6D5D7, 11.5px 500)
  - 4.01:1 < 4.5 — span#countFailed.count “2” (#57667B on #D6D5D7, 11.5px 500)
  - 2.04:1 < 4.5 — button#clearHistoryButton.quiet-button.danger “Clear history” (#AAAAB6 on #F4F0E9, 12.5px 500)
  - 4.46:1 < 4.5 — span.kind-icon.job-tile.video “VIDEO” (#3B6A8D on #D8E4EB, 11px 500)
  - 4.46:1 < 4.5 — span “Open” (#3B6A8D on #D8E4EB, 12.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 9 rules
  - header.topbar “FluxCatchDownloads New download Open folder”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - input#searchInput “Search file name or source”: top border 1px solid
  - input#searchInput “Search file name or source”: right border 1px solid
  - input#searchInput “Search file name or source”: bottom border 1px solid
  - input#searchInput “Search file name or source”: left border 1px solid
  - h2.day-head “Today”::after: thin filled pseudo-element 811.781px×1px
- names: 0 end-truncated filenames
- screenshot: shots/downloads-1280-morning-en.png

### downloads-960

- a: 11 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 11px/15.95px 500 · Fraunces 15px/20.25px 450 · Fraunces 15px/21.75px 400 · IBM Plex Sans 12px/16.8px 400 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 13px/18.85px 400 · Fraunces 18px/19.8px 400 · Fraunces 32px/35.2px 400 · IBM Plex Sans 12px/18.6px 400
- Display outside BrandMark: 11 — strong “FluxCatch”; h1#pageTitle “Downloads”; h2.day-head “Today”; h3.job-title “Interstellar Trailer 4K.mp4”; h2.day-head “Yesterday”; h3.job-title “Keynote Highlights.m4a”
- b: 6 left edges — x=44 (8: h1#pageTitle “Downloads” | p#pageSummary.page-summary “3 file(s) saved · 3.0 GiB in total”) · x=48 (5: h2.day-head “Today” | h2.day-head “Yesterday”) · x=64 (2: strong “FluxCatch” | small “Downloads”) · x=88.9 (4: span.kind-icon.job-tile.audio “AUDIO” | span.kind-icon.job-tile.video “VIDEO”) · x=96.2 (1: span.kind-icon.job-tile.stream “HLS”) · x=171.5 (10: h3.job-title “Interstellar Trailer 4K.mp4” | a “YouTube”)
- c: 11 nested containers (max depth 3)
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.kind-icon.job-tile.video “VIDEO”
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.kind-icon.job-tile.audio “AUDIO”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7”
  - li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7” ⊃ span.kind-icon.job-tile.video “VIDEO”
- d: 5 contrast failures of 56
  - 4.01:1 < 4.5 — span#countCompleted.count “3” (#57667B on #D6D5D7, 11.5px 500)
  - 4.01:1 < 4.5 — span#countFailed.count “2” (#57667B on #D6D5D7, 11.5px 500)
  - 2.04:1 < 4.5 — button#clearHistoryButton.quiet-button.danger “Clear history” (#AAAAB6 on #F4F0E9, 12.5px 500)
  - 4.46:1 < 4.5 — span.kind-icon.job-tile.video “VIDEO” (#3B6A8D on #D8E4EB, 11px 500)
  - 4.46:1 < 4.5 — span “Open” (#3B6A8D on #D8E4EB, 12.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 9 rules
  - header.topbar “FluxCatchDownloads New download Open folder”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - input#searchInput “Search file name or source”: top border 1px solid
  - input#searchInput “Search file name or source”: right border 1px solid
  - input#searchInput “Search file name or source”: bottom border 1px solid
  - input#searchInput “Search file name or source”: left border 1px solid
  - h2.day-head “Today”::after: thin filled pseudo-element 811.781px×1px
- names: 0 end-truncated filenames
- screenshot: shots/downloads-960-morning-en.png

### settings-1280

- a: 21 styles — IBM Plex Sans 13px/19.5px 500 · IBM Plex Sans 12px/18px 500 · IBM Plex Sans 12px/18px 400 · IBM Plex Sans 12px/18.6px 400 · IBM Plex Sans 13px/19.5px 400 · IBM Plex Sans 12px/19.2px 400 · IBM Plex Sans 12px/12px 500 · Fraunces 18px/23.4px 400 · IBM Plex Sans 12.5px/19.375px 400 · IBM Plex Sans 13px/18.85px 500 · ui-monospace 12px/12px 500 · IBM Plex Sans 12px/19.2px 500 · IBM Plex Sans 12px/16.2px 400 · ui-monospace 12px/17.4px 500 · ui-monospace 12px/normal 400 · Fraunces 13px/19.5px 400 · Fraunces 32px/35.2px 400 · IBM Plex Sans 14px/21px 500 · ui-monospace 13px/19.5px 400 · IBM Plex Sans 12px/18.6px 700 · ui-monospace 13px/20.15px 400
- Display outside BrandMark: 10 — p.eyebrow “Local-first media instrument”; h1 “FluxCatch Settings”; h2#runtimeHeading “Runtime identity & capabilities”; strong “Basic downloads”; strong “Performance”; strong “Detection & naming”
- b: 25 left edges — x=8 (1: a.skip-link “Skip to settings content”) · x=184 (8: a “Runtime” | a “Basic downloads”) · x=234 (3: p.eyebrow “Local-first media instrument” | h1 “FluxCatch Settings”) · x=412 (26: label “Default save format” | p#outputContainerHelp.field-help “MP4 is recommended for compatibility; applies wh”) · x=414 (8: dt “Extension version” | dd#diagnosticExtensionVersion “0.2.5”) · x=419 (8: span.section-index “01” | span.section-index “02”) · x=424 (6: span “Ordinary video and audio files” | span “Static DASH videos”) · x=426 (12: summary “First time here? Download paths, site completion” | strong “Save path:”) · x=428 (9: span#downloadLocationLabel.location-label “Save location” | code#downloadLocationPath.location-path “~/Downloads/FluxCatch”) · x=432 (1: summary “How does concurrency affect downloads?”) · x=434 (2: summary “View build & capability details” | p “HLS concurrency handles segments of clean, stati”) · x=447 (1: summary “Local engine setup”) · x=449 (9: small “Chrome direct lane” | strong “Trusted Instagram/X only”) · x=453.4 (8: small “Permission is requested immediately when enabled” | p “First confirm that the extension, the local help”) · x=482 (6: span.txt “Ask where to save trusted direct linksOnly affec” | small#saveAsHelp “Only affects fixed Instagram/X links saved by Ch”) · x=486 (3: span.txt “Allow LAN media accessOnly enable this to save m” | small#privateNetworkHelp “Only enable this to save media from devices on y”) · x=527.3 (1: li “From source: open Terminal in the FluxCatch repo”) · x=758 (3: label “Direct-file Range concurrency” | p#concurrentRangesHelp.field-help “How many parts of a large file to fetch at once;”) · x=770 (4: span “Static HLS videos” | span “Bilibili split-stream merging”) · x=879.4 (1: button#nativePermissionButton.secondary-btn “Enable local download engine”) · x=939.3 (1: label.language-label “Language”) · x=947.9 (1: button#copyDiagnosticsButton.secondary-btn “Copy diagnostics”) · x=988.2 (1: span.roadmap-status “Not available”) · x=1010.3 (1: span.roadmap-status “Available”) · x=1014.8 (1: span.roadmap-status “Planned”)
- c: 39 nested containers (max depth 4)
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ span.section-index “01”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Chrome direct laneTrusted Instagram/X only”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Local download engineNot authorized yet”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “FFmpeg local processingNot checked yet”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Network scopePublic networks only”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ details.runtime-details “View build & capability details Extension versio”
- d: 2 contrast failures of 182
  - 4.38:1 < 4.5 — span.roadmap-status “Planned” (#57667B on #D9E0E5, 12px 500)
  - 4.38:1 < 4.5 — span.roadmap-status “Available” (#57667B on #D9E0E5, 12px 500)
- e: clipped 0, covered at rest 12, focus obscured 0, dialog actions 0
  - button#chooseDownloadFolderButton.secondary-btn “Change…” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - button#openDownloadFolderButton.secondary-btn “Open folder” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - button#openHistoryButton.secondary-btn “Downloads” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - span “Static DASH videos” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - strong “Available” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - span “Bilibili split-stream merging” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
- g: 35 rules
  - details.runtime-details “View build & capability details Extension versio”: top border 1px solid
  - div.capability-summary “Supported in this build Actual configuration gov”: top border 1px solid
  - select#outputContainer “MP4 MKV WebM”: top border 1px solid
  - select#outputContainer “MP4 MKV WebM”: right border 1px solid
  - select#outputContainer “MP4 MKV WebM”: bottom border 1px solid
  - select#outputContainer “MP4 MKV WebM”: left border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/settings-1280-morning-en.png

### settings-960

- a: 21 styles — IBM Plex Sans 13px/19.5px 500 · IBM Plex Sans 12px/18px 500 · IBM Plex Sans 12px/18px 400 · IBM Plex Sans 12px/18.6px 400 · IBM Plex Sans 13px/19.5px 400 · IBM Plex Sans 12px/19.2px 400 · IBM Plex Sans 12px/12px 500 · Fraunces 18px/23.4px 400 · IBM Plex Sans 12.5px/19.375px 400 · IBM Plex Sans 13px/18.85px 500 · ui-monospace 12px/12px 500 · IBM Plex Sans 12px/19.2px 500 · IBM Plex Sans 12px/16.2px 400 · ui-monospace 12px/17.4px 500 · ui-monospace 12px/normal 400 · Fraunces 13px/19.5px 400 · Fraunces 32px/35.2px 400 · IBM Plex Sans 14px/21px 500 · ui-monospace 13px/19.5px 400 · IBM Plex Sans 12px/18.6px 700 · ui-monospace 13px/20.15px 400
- Display outside BrandMark: 10 — p.eyebrow “Local-first media instrument”; h1 “FluxCatch Settings”; h2#runtimeHeading “Runtime identity & capabilities”; strong “Basic downloads”; strong “Performance”; strong “Detection & naming”
- b: 25 left edges — x=8 (1: a.skip-link “Skip to settings content”) · x=28 (8: a “Runtime” | a “Basic downloads”) · x=90 (3: p.eyebrow “Local-first media instrument” | h1 “FluxCatch Settings”) · x=256 (26: label “Default save format” | p#outputContainerHelp.field-help “MP4 is recommended for compatibility; applies wh”) · x=258 (8: dt “Extension version” | dd#diagnosticExtensionVersion “0.2.5”) · x=263 (8: span.section-index “01” | span.section-index “02”) · x=268 (6: span “Ordinary video and audio files” | span “Static DASH videos”) · x=270 (12: summary “First time here? Download paths, site completion” | strong “Save path:”) · x=272 (9: span#downloadLocationLabel.location-label “Save location” | code#downloadLocationPath.location-path “~/Downloads/FluxCatch”) · x=276 (1: summary “How does concurrency affect downloads?”) · x=278 (2: summary “View build & capability details” | p “HLS concurrency handles segments of clean, stati”) · x=291 (1: summary “Local engine setup”) · x=293 (9: small “Chrome direct lane” | strong “Trusted Instagram/X only”) · x=297.2 (8: small “Permission is requested immediately when enabled” | p “First confirm that the extension, the local help”) · x=326 (6: span.txt “Ask where to save trusted direct linksOnly affec” | small#saveAsHelp “Only affects fixed Instagram/X links saved by Ch”) · x=330 (3: span.txt “Allow LAN media accessOnly enable this to save m” | small#privateNetworkHelp “Only enable this to save media from devices on y”) · x=371.3 (1: li “From source: open Terminal in the FluxCatch repo”) · x=598 (3: label “Direct-file Range concurrency” | p#concurrentRangesHelp.field-help “How many parts of a large file to fetch at once;”) · x=610 (4: span “Static HLS videos” | span “Bilibili split-stream merging”) · x=715.4 (1: button#nativePermissionButton.secondary-btn “Enable local download engine”) · x=763.3 (1: label.language-label “Language”) · x=783.9 (1: button#copyDiagnosticsButton.secondary-btn “Copy diagnostics”) · x=824.2 (1: span.roadmap-status “Not available”) · x=846.3 (1: span.roadmap-status “Available”) · x=850.8 (1: span.roadmap-status “Planned”)
- c: 39 nested containers (max depth 4)
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ span.section-index “01”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Chrome direct laneTrusted Instagram/X only”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Local download engineNot authorized yet”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “FFmpeg local processingNot checked yet”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Network scopePublic networks only”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ details.runtime-details “View build & capability details Extension versio”
- d: 2 contrast failures of 182
  - 4.38:1 < 4.5 — span.roadmap-status “Planned” (#57667B on #D9E0E5, 12px 500)
  - 4.38:1 < 4.5 — span.roadmap-status “Available” (#57667B on #D9E0E5, 12px 500)
- e: clipped 0, covered at rest 12, focus obscured 0, dialog actions 0
  - button#chooseDownloadFolderButton.secondary-btn “Change…” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - button#openDownloadFolderButton.secondary-btn “Open folder” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - button#openHistoryButton.secondary-btn “Downloads” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - span “Static DASH videos” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - strong “Available” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
  - span “Bilibili split-stream merging” — under div#saveBar.opt-actions “All changes saved Discard changes Save settings”
- g: 35 rules
  - details.runtime-details “View build & capability details Extension versio”: top border 1px solid
  - div.capability-summary “Supported in this build Actual configuration gov”: top border 1px solid
  - select#outputContainer “MP4 MKV WebM”: top border 1px solid
  - select#outputContainer “MP4 MKV WebM”: right border 1px solid
  - select#outputContainer “MP4 MKV WebM”: bottom border 1px solid
  - select#outputContainer “MP4 MKV WebM”: left border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/settings-960-morning-en.png

### preview

- a: 17 styles — IBM Plex Sans 13px/19.5px 500 · IBM Plex Sans 13px/19.5px 400 · IBM Plex Sans 12.5px/18.75px 500 · IBM Plex Sans 12px/18px 500 · IBM Plex Sans 12px/18px 400 · IBM Plex Sans 11.5px/17.25px 500 · IBM Plex Sans 11px/16.5px 400 · Fraunces 18px/27px 400 · Fraunces 15px/22.5px 450 · IBM Plex Sans 12.5px/17.5px 500 · IBM Plex Sans 12.5px/18.75px 400 · IBM Plex Sans 12px/18.6px 400 · Fraunces 32px/48px 400 · Fraunces 12px/18px 400 · Fraunces 24px/36px 400 · Fraunces 13px/19.5px 400 · Fraunces 24px/27.6px 400
- Display outside BrandMark: 29 — h1 “组件预览 · Component preview”; h2#lightHeading.pane-heading “清晨 · Morning”; strong “FluxCatch”; small “Keep What You See.”; strong.pv-name “Lecture 12 · Pharmacokinetics.mp4”; strong.pv-name “Keynote Highlights.m4a”
- b: 23 left edges — x=28 (11: h2#lightHeading.pane-heading “清晨 · Morning” | h3.pv-label “1 · 窗口框架与侧栏 Window chrome / sidebar”) · x=37 (7: span.job-chip.done “✓ 已完成” | a.is-current “全部12”) · x=42 (12: strong.pv-name “Lecture 12 · Pharmacokinetics.mp4” | span.pv-domain “lecturecast.ucl.ac.uk”) · x=48 (24: strong “FluxCatch” | small “Keep What You See.”) · x=59 (2: span “暂停” | span “继续”) · x=86 (2: h1 “组件预览 · Component preview” | p “两个时刻的同一片水面：左为清晨（浅色），右为黄昏（深色）。所有颜色、纹理与动效均由 token ”) · x=118 (2: span.txt “下载完成或失败时提醒我系统通知自带“在 Finder 中显示”和“打开”按钮。” | small “系统通知自带“在 Finder 中显示”和“打开”按钮。”) · x=182.7 (1: p.display “没有正在下载的内容。池水静止。”) · x=212 (5: div.segmented “媒体4任务2” | div.segmented “媒体4任务2”) · x=241 (1: small “Nothing downloading. The pond is still.”) · x=248.1 (1: button.secondary “取消”) · x=300 (1: p.pv-note “lily pad · ripple · blossom on a cream disc — pr”) · x=748 (11: h2#darkHeading.pane-heading “黄昏 · Dusk” | h3.pv-label “1 · 窗口框架与侧栏 Window chrome / sidebar”) · x=757 (7: span.job-chip.done “✓ 已完成” | a.is-current “全部12”) · x=762 (12: strong.pv-name “Lecture 12 · Pharmacokinetics.mp4” | span.pv-domain “lecturecast.ucl.ac.uk”) · x=768 (24: strong “FluxCatch” | small “Keep What You See.”) · x=779 (2: span “暂停” | span “继续”) · x=838 (2: span.txt “下载完成或失败时提醒我系统通知自带“在 Finder 中显示”和“打开”按钮。” | small “系统通知自带“在 Finder 中显示”和“打开”按钮。”) · x=902.7 (1: p.display “没有正在下载的内容。池水静止。”) · x=932 (5: div.segmented “媒体4任务2” | div.segmented “媒体4任务2”) · x=961 (1: small “Nothing downloading. The pond is still.”) · x=968.1 (1: button.secondary “取消”) · x=1020 (1: p.pv-note “lily pad · ripple · blossom on a cream disc — pr”)
- c: 64 nested containers (max depth 3)
  - section.preview-pane.fc-atmosphere “清晨 · Morning 1 · 窗口框架与侧栏 Window chrome / sidebar” ⊃ div.pv-window “FluxCatchKeep What You See. 全部12 进行中2 已完成9 失败1 已”
  - div.pv-window “FluxCatchKeep What You See. 全部12 进行中2 已完成9 失败1 已” ⊃ aside.pv-sidebar “FluxCatchKeep What You See. 全部12 进行中2 已完成9 失败1 已”
  - section.preview-pane.fc-atmosphere “清晨 · Morning 1 · 窗口框架与侧栏 Window chrome / sidebar” ⊃ ul.pv-list “Lecture 12 · Pharmacokinetics.mp4下载中 lecturecast”
  - ul.pv-list “Lecture 12 · Pharmacokinetics.mp4下载中 lecturecast” ⊃ li.pv-row.is-live “Lecture 12 · Pharmacokinetics.mp4下载中 lecturecast”
  - ul.pv-list “Lecture 12 · Pharmacokinetics.mp4下载中 lecturecast” ⊃ li.pv-row.is-paused “Keynote Highlights.m4a‖ 已暂停 developer.apple.com2”
  - ul.pv-list “Lecture 12 · Pharmacokinetics.mp4下载中 lecturecast” ⊃ li.pv-row.is-selected “Interstellar Trailer 4K.mp4✓ 已完成 youtube.com2.35”
- d: 26 contrast failures of 269
  - 4.26:1 < 4.5 — i.count “12” (#57667B on #D8DDE0, 11.5px 500)
  - 4.22:1 < 4.5 — span.count “2” (#57667B on #DBDBDE, 11.5px 500)
  - 4.37:1 < 4.5 — span.toast-message “源站拒绝了第 12 个片段” (#AF421D on #F3DBCF, 12.5px 500)
  - 4.45:1 < 4.5 — span.job-chip.wait “等待中” (#57667B on #E1E1DE, 11.5px 500)
  - 4.38:1 < 4.5 — span.job-chip.bad “× 失败” (#AF421D on #F0DCD0, 11.5px 500)
  - 4.45:1 < 4.5 — span.chip “MP4” (#57667B on #E1E1DE, 11.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 57 rules
  - header.preview-bar “组件预览 · Component preview 两个时刻的同一片水面：左为清晨（浅色），右为黄”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - select#densitySelect “舒适 comfortable 紧凑 compact”: top border 1px solid
  - select#densitySelect “舒适 comfortable 紧凑 compact”: right border 1px solid
  - select#densitySelect “舒适 comfortable 紧凑 compact”: bottom border 1px solid
  - select#densitySelect “舒适 comfortable 紧凑 compact”: left border 1px solid
  - select#motionSelect “完整 full 减弱 reduced”: top border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/preview-morning-en.png

### downloads-empty-1280

- a: 9 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 13px/18.85px 400 · Fraunces 18px/19.8px 400 · IBM Plex Sans 12px/17.4px 400 · Fraunces 32px/35.2px 400 · Fraunces 24px/34.8px 400 · IBM Plex Sans 13px/20.8px 400 · IBM Plex Sans 12px/18.6px 400
- Display outside BrandMark: 3 — strong “FluxCatch”; h1#pageTitle “Downloads”; h3#emptyTitle “No downloads yet”
- b: 5 left edges — x=64 (2: strong “FluxCatch” | small “Downloads”) · x=204 (8: h1#pageTitle “Downloads” | p#pageSummary.page-summary “Every file the local engine saves is recorded he”) · x=208 (1: p.page-foot “Files saved by the local engine never appear in ”) · x=426.9 (1: p#emptyCopy “Start a download from the toolbar icon on a vide”) · x=544 (1: h3#emptyTitle “No downloads yet”)
- c: 0 nested containers (max depth 1)
- d: 2 contrast failures of 16
  - 4.01:1 < 4.5 — span#countCompleted.count “0” (#57667B on #D6D5D7, 11.5px 500)
  - 4.01:1 < 4.5 — span#countFailed.count “0” (#57667B on #D6D5D7, 11.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 5 rules
  - header.topbar “FluxCatchDownloads New download Open folder”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - input#searchInput “Search file name or source”: top border 1px solid
  - input#searchInput “Search file name or source”: right border 1px solid
  - input#searchInput “Search file name or source”: bottom border 1px solid
  - input#searchInput “Search file name or source”: left border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/downloads-empty-1280-morning-en.png

### downloads-empty-960

- a: 9 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 13px/18.85px 400 · Fraunces 18px/19.8px 400 · IBM Plex Sans 12px/17.4px 400 · Fraunces 32px/35.2px 400 · Fraunces 24px/34.8px 400 · IBM Plex Sans 13px/20.8px 400 · IBM Plex Sans 12px/18.6px 400
- Display outside BrandMark: 3 — strong “FluxCatch”; h1#pageTitle “Downloads”; h3#emptyTitle “No downloads yet”
- b: 5 left edges — x=44 (8: h1#pageTitle “Downloads” | p#pageSummary.page-summary “Every file the local engine saves is recorded he”) · x=48 (1: p.page-foot “Files saved by the local engine never appear in ”) · x=64 (2: strong “FluxCatch” | small “Downloads”) · x=266.9 (1: p#emptyCopy “Start a download from the toolbar icon on a vide”) · x=384 (1: h3#emptyTitle “No downloads yet”)
- c: 0 nested containers (max depth 1)
- d: 2 contrast failures of 16
  - 4.01:1 < 4.5 — span#countCompleted.count “0” (#57667B on #D6D5D7, 11.5px 500)
  - 4.01:1 < 4.5 — span#countFailed.count “0” (#57667B on #D6D5D7, 11.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 5 rules
  - header.topbar “FluxCatchDownloads New download Open folder”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - input#searchInput “Search file name or source”: top border 1px solid
  - input#searchInput “Search file name or source”: right border 1px solid
  - input#searchInput “Search file name or source”: bottom border 1px solid
  - input#searchInput “Search file name or source”: left border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/downloads-empty-960-morning-en.png

### popup-downloads-active

- a: 9 styles — IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/12px 500 · IBM Plex Sans 13px/18.85px 500 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 12px/17.4px 400 · Fraunces 18px/19.8px 400 · Fraunces 12px/15.6px 400 · IBM Plex Sans 12px/16.8px 400
- Display outside BrandMark: 2 — h1 “FluxCatch”; p.tagline “Keep What You See.”
- b: 5 left edges — x=16 (4: div.segmented “Media3 Jobs2” | div.segmented “Media3 Jobs2”) · x=20.9 (1: button#workspaceButton.foot-btn “Workspace”) · x=30 (4: strong.job-title “Lecture 12 · Pharmacokinetics.mp4” | span “分片 74/120”) · x=50 (2: strong#hostTitle “Local download engine is ready” | small#hostDetail “Speeds up large files, merges segments and conve”) · x=56 (2: h1 “FluxCatch” | p.tagline “Keep What You See.”)
- c: 2 nested containers (max depth 2)
  - ul#jobsList.jobs-list “Lecture 12 · Pharmacokinetics.mp462%分片 74/1205.1” ⊃ li.job-card “Lecture 12 · Pharmacokinetics.mp462%分片 74/1205.1”
  - ul#jobsList.jobs-list “Lecture 12 · Pharmacokinetics.mp462%分片 74/1205.1” ⊃ li.job-card “Keynote 2026.mp431%等待本地下载引擎3.4 MiB/s3:53 leftPau”
- d: 1 contrast failures of 27
  - 4.24:1 < 4.5 — span#jobCount.count “2” (#3B6A8D on #D9DDE2, 11.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 4 rules
  - section.control-row “Media3 Jobs2 Download all All Video Audio Stream”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - li.job-card “Lecture 12 · Pharmacokinetics.mp462%分片 74/1205.1”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 0px 0px 1px inset”
  - li.job-card “Keynote 2026.mp431%等待本地下载引擎3.4 MiB/s3:53 leftPau”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 0px 0px 1px inset”
  - footer.foot-actions “Workspace Downloads Folder Clear results”: hairline shadow “rgba(43, 46, 74, 0.1) 0px -1px 0px 0px”
- names: 0 end-truncated filenames
- screenshot: shots/popup-downloads-active-morning-en.png

### sidepanel-active

- a: 14 styles — IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 11.5px/16.1px 500 · IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 12px/16.2px 400 · IBM Plex Sans 13px/16.9px 500 · IBM Plex Sans 13px/17.55px 500 · IBM Plex Sans 12px/16.8px 400 · IBM Plex Sans 12px/15.6px 400 · IBM Plex Sans 12.5px/18.125px 400 · IBM Plex Sans 12px/16.2px 500 · Fraunces 18px/21.6px 400 · Fraunces 18px/19.8px 400 · IBM Plex Sans 10.5px/15.225px 500
- Display outside BrandMark: 3 — strong “FluxCatch”; h2#mediaHeading “Media on this page”; h2#jobsHeading “Download jobs”
- b: 12 left edges — x=20 (4: h2#mediaHeading “Media on this page” | p “Downloadable video, audio and streams found here”) · x=30 (5: p#localEngineBoundary.action-boundary “Items marked “Check & download” need the local d” | h3.job-title “Lecture 12 · Pharmacokinetics.mp4”) · x=32.8 (2: span.kind-icon.audio “AUDIO” | span.kind-icon.video “VIDEO”) · x=41.5 (1: span.kind-icon.stream “HLS”) · x=50 (2: h2#hostTitle “Local download engine is ready” | p#hostDetail “Speeds up large files, merges segments and conve”) · x=56 (2: strong “FluxCatch” | small “Media workspace”) · x=82 (2: h1#pageTitle “Lecture 12 · Pharmacokinetics” | p#pageUrl “lectures.example.org”) · x=86 (4: h3.media-title “Lecture 12 · Pharmacokinetics” | h3.media-title “Lecture 12 · Pharmacokinetics”) · x=91 (1: button#scanButton.quiet-button “Rescan”) · x=94 (4: span.chip.stream “HLS” | span.chip “VIDEO”) · x=211.9 (1: button#historyButton.quiet-button “All downloads”) · x=275.3 (1: button#urlDownloadButton.quiet-button “Download a link”)
- c: 16 nested containers (max depth 3)
  - section.page-context “Lecture 12 · Pharmacokinetics lectures.example.o” ⊃ div.page-mark
  - div.page-mark ⊃ span
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.kind-icon.stream “HLS”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.stream “HLS”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.quality “Pick”
  - ul#mediaList.media-list “HLSLecture 12 · Pharmacokineticslectures.example” ⊃ span.chip.quality “1080p”
- d: 6 contrast failures of 55
  - 4.45:1 < 4.5 — span#mediaCount.count “3” (#57667B on #E1E1DE, 12px 500)
  - 4.46:1 < 4.5 — span.kind-icon.video “VIDEO” (#3B6A8D on #D8E4EB, 12px 500)
  - 4.38:1 < 4.5 — span.chip “VIDEO” (#57667B on #D9E0E5, 11.5px 500)
  - 4.46:1 < 4.5 — span.chip.quality “360p” (#3B6A8D on #D8E4EB, 11.5px 500)
  - 4.38:1 < 4.5 — span.chip “774.4 MiB” (#57667B on #D9E0E5, 11.5px 500)
  - 4.46:1 < 4.5 — button.media-download “Check & download” (#3B6A8D on #D8E4EB, 12.5px 400)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 7 rules
  - header.topbar “FluxCatchMedia workspace Open settings”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - span: top border 2px solid
  - span: right border 2px solid
  - span: bottom border 2px solid
  - span: left border 2px solid
  - li.job-row.downloading “Lecture 12 · Pharmacokinetics.mp462%Lecture 12 ·”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 0px 0px 1px inset”
- names: 3 end-truncated filenames
  - h3.media-title “Lecture 12 · Pharmacokinetics”
  - h3.media-title “Lecture 12 · Pharmacokinetics”
  - h3.media-title “Lecture 12 · Pharmacokinetics”
- screenshot: shots/sidepanel-active-morning-en.png

### downloads-active-1280

- a: 15 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 11px/15.95px 500 · Fraunces 15px/20.25px 450 · IBM Plex Sans 12px/16.8px 400 · Fraunces 15px/21.75px 400 · IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 13px/18.85px 400 · IBM Plex Sans 13px/17.55px 500 · Fraunces 18px/19.8px 400 · Fraunces 32px/35.2px 400 · Fraunces 18px/26.1px 400 · IBM Plex Sans 13px/17.55px 400 · IBM Plex Sans 12px/18.6px 400
- Display outside BrandMark: 14 — strong “FluxCatch”; h1#pageTitle “Downloads”; h2#activeHeading “In progress”; h3.job-title “Lecture 12 · Pharmacokinetics.mp4”; h3.job-title “Keynote 2026.mp4”; h2.day-head “Today”
- b: 7 left edges — x=64 (2: strong “FluxCatch” | small “Downloads”) · x=204 (8: h1#pageTitle “Downloads” | p#pageSummary.page-summary “3 file(s) saved · 3.0 GiB in total”) · x=208 (6: h2#activeHeading “In progress” | h2.day-head “Today”) · x=222 (4: h3.job-title “Lecture 12 · Pharmacokinetics.mp4” | span.job-message “分片 74/120”) · x=248.9 (4: span.kind-icon.job-tile.audio “AUDIO” | span.kind-icon.job-tile.video “VIDEO”) · x=256.2 (1: span.kind-icon.job-tile.stream “HLS”) · x=331.5 (10: h3.job-title “Interstellar Trailer 4K.mp4” | a “YouTube”)
- c: 11 nested containers (max depth 3)
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.kind-icon.job-tile.video “VIDEO”
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.kind-icon.job-tile.audio “AUDIO”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7”
  - li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7” ⊃ span.kind-icon.job-tile.video “VIDEO”
- d: 6 contrast failures of 72
  - 4.45:1 < 4.5 — span#activeCount.count “2” (#57667B on #E1E1DE, 12px 500)
  - 4.01:1 < 4.5 — span#countCompleted.count “3” (#57667B on #D6D5D7, 11.5px 500)
  - 4.01:1 < 4.5 — span#countFailed.count “2” (#57667B on #D6D5D7, 11.5px 500)
  - 2.04:1 < 4.5 — button#clearHistoryButton.quiet-button.danger “Clear history” (#AAAAB6 on #F4F0E9, 12.5px 500)
  - 4.46:1 < 4.5 — span.kind-icon.job-tile.video “VIDEO” (#3B6A8D on #D8E4EB, 11px 500)
  - 4.46:1 < 4.5 — span “Open” (#3B6A8D on #D8E4EB, 12.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 9 rules
  - header.topbar “FluxCatchDownloads New download Open folder”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - input#searchInput “Search file name or source”: top border 1px solid
  - input#searchInput “Search file name or source”: right border 1px solid
  - input#searchInput “Search file name or source”: bottom border 1px solid
  - input#searchInput “Search file name or source”: left border 1px solid
  - h2.day-head “Today”::after: thin filled pseudo-element 811.781px×1px
- names: 0 end-truncated filenames
- screenshot: shots/downloads-active-1280-morning-en.png

### downloads-active-960

- a: 15 styles — IBM Plex Sans 12.5px/18.125px 500 · IBM Plex Sans 12px/17.4px 400 · IBM Plex Sans 11px/15.95px 500 · Fraunces 15px/20.25px 450 · IBM Plex Sans 12px/16.8px 400 · Fraunces 15px/21.75px 400 · IBM Plex Sans 12px/17.4px 500 · IBM Plex Sans 11.5px/16.675px 500 · IBM Plex Sans 13px/18.85px 400 · IBM Plex Sans 13px/17.55px 500 · Fraunces 18px/19.8px 400 · Fraunces 32px/35.2px 400 · Fraunces 18px/26.1px 400 · IBM Plex Sans 13px/17.55px 400 · IBM Plex Sans 12px/18.6px 400
- Display outside BrandMark: 14 — strong “FluxCatch”; h1#pageTitle “Downloads”; h2#activeHeading “In progress”; h3.job-title “Lecture 12 · Pharmacokinetics.mp4”; h3.job-title “Keynote 2026.mp4”; h2.day-head “Today”
- b: 7 left edges — x=44 (8: h1#pageTitle “Downloads” | p#pageSummary.page-summary “3 file(s) saved · 3.0 GiB in total”) · x=48 (6: h2#activeHeading “In progress” | h2.day-head “Today”) · x=62 (4: h3.job-title “Lecture 12 · Pharmacokinetics.mp4” | span.job-message “分片 74/120”) · x=64 (2: strong “FluxCatch” | small “Downloads”) · x=88.9 (4: span.kind-icon.job-tile.audio “AUDIO” | span.kind-icon.job-tile.video “VIDEO”) · x=96.2 (1: span.kind-icon.job-tile.stream “HLS”) · x=171.5 (10: h3.job-title “Interstellar Trailer 4K.mp4” | a “YouTube”)
- c: 11 nested containers (max depth 3)
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.kind-icon.job-tile.video “VIDEO”
  - ul.jobs-list “VIDEOInterstellar Trailer 4K.mp4Completed2.2 GiB” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.kind-icon.job-tile.audio “AUDIO”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ span.job-chip.done “Completed”
  - ul.jobs-list “AUDIOKeynote Highlights.m4aCompleted46.1 MiB · 3” ⊃ li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7”
  - li.record.completed “VIDEOLecture 12 · Pharmacokinetics.mp4Completed7” ⊃ span.kind-icon.job-tile.video “VIDEO”
- d: 6 contrast failures of 72
  - 4.45:1 < 4.5 — span#activeCount.count “2” (#57667B on #E1E1DE, 12px 500)
  - 4.01:1 < 4.5 — span#countCompleted.count “3” (#57667B on #D6D5D7, 11.5px 500)
  - 4.01:1 < 4.5 — span#countFailed.count “2” (#57667B on #D6D5D7, 11.5px 500)
  - 2.04:1 < 4.5 — button#clearHistoryButton.quiet-button.danger “Clear history” (#AAAAB6 on #F4F0E9, 12.5px 500)
  - 4.46:1 < 4.5 — span.kind-icon.job-tile.video “VIDEO” (#3B6A8D on #D8E4EB, 11px 500)
  - 4.46:1 < 4.5 — span “Open” (#3B6A8D on #D8E4EB, 12.5px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 9 rules
  - header.topbar “FluxCatchDownloads New download Open folder”: hairline shadow “rgba(43, 46, 74, 0.1) 0px 1px 0px 0px”
  - input#searchInput “Search file name or source”: top border 1px solid
  - input#searchInput “Search file name or source”: right border 1px solid
  - input#searchInput “Search file name or source”: bottom border 1px solid
  - input#searchInput “Search file name or source”: left border 1px solid
  - h2.day-head “Today”::after: thin filled pseudo-element 811.781px×1px
- names: 0 end-truncated filenames
- screenshot: shots/downloads-active-960-morning-en.png

### settings-active-1280

- a: 21 styles — IBM Plex Sans 13px/19.5px 500 · IBM Plex Sans 12px/18px 500 · IBM Plex Sans 12px/18px 400 · IBM Plex Sans 12px/18.6px 400 · IBM Plex Sans 13px/19.5px 400 · IBM Plex Sans 12px/19.2px 400 · IBM Plex Sans 12px/12px 500 · Fraunces 18px/23.4px 400 · IBM Plex Sans 12.5px/19.375px 400 · IBM Plex Sans 13px/18.85px 500 · ui-monospace 12px/12px 500 · IBM Plex Sans 12px/19.2px 500 · IBM Plex Sans 12px/16.2px 400 · ui-monospace 12px/17.4px 500 · ui-monospace 12px/normal 400 · Fraunces 13px/19.5px 400 · Fraunces 32px/35.2px 400 · IBM Plex Sans 14px/21px 500 · ui-monospace 13px/19.5px 400 · IBM Plex Sans 12px/18.6px 700 · ui-monospace 13px/20.15px 400
- Display outside BrandMark: 10 — p.eyebrow “Local-first media instrument”; h1 “FluxCatch Settings”; h2#runtimeHeading “Runtime identity & capabilities”; strong “Basic downloads”; strong “Performance”; strong “Detection & naming”
- b: 25 left edges — x=8 (1: a.skip-link “Skip to settings content”) · x=184 (8: a “Runtime” | a “Basic downloads”) · x=234 (3: p.eyebrow “Local-first media instrument” | h1 “FluxCatch Settings”) · x=412 (26: label “Default save format” | p#outputContainerHelp.field-help “MP4 is recommended for compatibility; applies wh”) · x=414 (8: dt “Extension version” | dd#diagnosticExtensionVersion “0.2.5”) · x=419 (8: span.section-index “01” | span.section-index “02”) · x=424 (6: span “Ordinary video and audio files” | span “Static DASH videos”) · x=426 (12: summary “First time here? Download paths, site completion” | strong “Save path:”) · x=428 (9: span#downloadLocationLabel.location-label “Save location” | code#downloadLocationPath.location-path “~/Downloads/FluxCatch”) · x=432 (1: summary “How does concurrency affect downloads?”) · x=434 (2: summary “View build & capability details” | p “HLS concurrency handles segments of clean, stati”) · x=447 (1: summary “Local engine setup”) · x=449 (9: small “Chrome direct lane” | strong “Trusted Instagram/X only”) · x=453.4 (8: small “Permission is requested immediately when enabled” | p “First confirm that the extension, the local help”) · x=482 (6: span.txt “Ask where to save trusted direct linksOnly affec” | small#saveAsHelp “Only affects fixed Instagram/X links saved by Ch”) · x=486 (3: span.txt “Allow LAN media accessOnly enable this to save m” | small#privateNetworkHelp “Only enable this to save media from devices on y”) · x=527.3 (1: li “From source: open Terminal in the FluxCatch repo”) · x=758 (3: label “Direct-file Range concurrency” | p#concurrentRangesHelp.field-help “How many parts of a large file to fetch at once;”) · x=770 (4: span “Static HLS videos” | span “Bilibili split-stream merging”) · x=939.3 (1: label.language-label “Language”) · x=947.9 (1: button#copyDiagnosticsButton.secondary-btn “Copy diagnostics”) · x=988.2 (1: span.roadmap-status “Not available”) · x=1000 (1: button#nativePermissionButton.secondary-btn “Recheck”) · x=1010.3 (1: span.roadmap-status “Available”) · x=1014.8 (1: span.roadmap-status “Planned”)
- c: 39 nested containers (max depth 4)
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ span.section-index “01”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Chrome direct laneTrusted Instagram/X only”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Local download engineConnected”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “FFmpeg local processingLocal processing availabl”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ div.status-item “Network scopePublic networks only”
  - section#runtime.settings-section.runtime-section “01 Runtime identity & capabilities First confirm” ⊃ details.runtime-details “View build & capability details Extension versio”
- d: 2 contrast failures of 182
  - 4.38:1 < 4.5 — span.roadmap-status “Planned” (#57667B on #D9E0E5, 12px 500)
  - 4.38:1 < 4.5 — span.roadmap-status “Available” (#57667B on #D9E0E5, 12px 500)
- e: clipped 0, covered at rest 0, focus obscured 0, dialog actions 0
- g: 35 rules
  - details.runtime-details “View build & capability details Extension versio”: top border 1px solid
  - div.capability-summary “Supported in this build Actual configuration gov”: top border 1px solid
  - select#outputContainer “MP4 MKV WebM”: top border 1px solid
  - select#outputContainer “MP4 MKV WebM”: right border 1px solid
  - select#outputContainer “MP4 MKV WebM”: bottom border 1px solid
  - select#outputContainer “MP4 MKV WebM”: left border 1px solid
- names: 0 end-truncated filenames
- screenshot: shots/settings-active-1280-morning-en.png

## Locale leaks (f)

- downloads-1280 · morning · en: “· 1 小时前”, “· 昨天 16:56”, “· 昨天 16:56”, “· 10月19日”, “· 10月12日”
- downloads-960 · morning · en: “· 1 小时前”, “· 昨天 16:56”, “· 昨天 16:56”, “· 10月19日”, “· 10月12日”
- settings-1280 · morning · en: “预览”, “示例视频.mp4”, “。”, “。”
- settings-960 · morning · en: “预览”, “示例视频.mp4”, “。”, “。”
- preview · morning · en: “组件预览 · Component preview”, “两个时刻的同一片水面：左为清晨（浅色），右为黄昏（深色）。所有颜色、纹理与动效均由 token 与代码生成，无任何图片资”, “密度 Density”, “动效 Motion”, “页面主题 Page theme”, “重放下载 Replay”, “清晨 · Morning”, “1 · 窗口框架与侧栏” … (+116)
- downloads-1280 · dusk · en: “· 1 小时前”, “· 昨天 16:56”, “· 昨天 16:56”, “· 10月19日”, “· 10月12日”
- downloads-960 · dusk · en: “· 1 小时前”, “· 昨天 16:56”, “· 昨天 16:56”, “· 10月19日”, “· 10月12日”
- settings-1280 · dusk · en: “预览”, “示例视频.mp4”, “。”, “。”
- settings-960 · dusk · en: “预览”, “示例视频.mp4”, “。”, “。”
- preview · dusk · en: “组件预览 · Component preview”, “两个时刻的同一片水面：左为清晨（浅色），右为黄昏（深色）。所有颜色、纹理与动效均由 token 与代码生成，无任何图片资”, “密度 Density”, “动效 Motion”, “页面主题 Page theme”, “重放下载 Replay”, “清晨 · Morning”, “1 · 窗口框架与侧栏” … (+116)
- popup-downloads-active · morning · en: “分片 74/120”, “等待本地下载引擎”
- sidepanel-active · morning · en: “分片 74/120”, “等待本地下载引擎”
- downloads-active-1280 · morning · en: “分片 74/120”, “等待本地下载引擎”, “· 1 小时前”, “· 昨天 16:58”, “· 昨天 16:58”, “· 10月19日”, “· 10月12日”
- downloads-active-960 · morning · en: “分片 74/120”, “等待本地下载引擎”, “· 1 小时前”, “· 昨天 16:58”, “· 昨天 16:58”, “· 10月19日”, “· 10月12日”
- settings-active-1280 · morning · en: “预览”, “示例视频.mp4”, “。”, “。”
- popup-downloads-active · dusk · en: “分片 74/120”, “等待本地下载引擎”
- sidepanel-active · dusk · en: “分片 74/120”, “等待本地下载引擎”
- downloads-active-1280 · dusk · en: “分片 74/120”, “等待本地下载引擎”, “· 1 小时前”, “· 昨天 16:58”, “· 昨天 16:58”, “· 10月19日”, “· 10月12日”
- downloads-active-960 · dusk · en: “分片 74/120”, “等待本地下载引擎”, “· 1 小时前”, “· 昨天 16:58”, “· 昨天 16:58”, “· 10月19日”, “· 10月12日”
- settings-active-1280 · dusk · en: “预览”, “示例视频.mp4”, “。”, “。”
- popup-media · morning · zh: “Keep What You See.”
- popup-jobs · morning · zh: “Keep What You See.”
- sidepanel · morning · zh: “Reading list”
- popup-results · morning · zh: “Keep What You See.”, “Lecture 12 · Pharmacokinetics”, “lectures.example.org/media/hls/master.m3u8”, “Lecture 12 · Pharmacokinetics”, “media.example.net/media/lecture-12-pharmacokinetics.mp4”, “VIDEO”, “774.4 MiB”, “Lecture 12 · Pharmacokinetics” … (+3)
- sidepanel-link-dialog · morning · zh: “Reading list”
- sidepanel-results · morning · zh: “Lecture 12 · Pharmacokinetics”, “Lecture 12 · Pharmacokinetics”, “lectures.example.org/media/hls/master.m3u8”, “VIDEO”, “Lecture 12 · Pharmacokinetics”, “media.example.net/media/lecture-12-pharmacokinetics.mp4”, “VIDEO”, “774.4 MiB” … (+5)
- downloads-1280 · morning · zh: “已保存 3 个文件 · 共 3.0 GiB”, “VIDEO”, “Interstellar Trailer 4K.mp4”, “2.2 GiB · 2:28 · 2160p”, “AUDIO”, “Keynote Highlights.m4a”, “46.1 MiB · 31:00”, “Apple Developer” … (+8)
- downloads-960 · morning · zh: “已保存 3 个文件 · 共 3.0 GiB”, “VIDEO”, “Interstellar Trailer 4K.mp4”, “2.2 GiB · 2:28 · 2160p”, “AUDIO”, “Keynote Highlights.m4a”, “46.1 MiB · 31:00”, “Apple Developer” … (+8)
- settings-1280 · morning · zh: “Local-first media instrument”, “Language”, “默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。”, “FFmpeg 本地处理”, “扩展 ID”, “gpnojfocoanelgibidlhholjobljefab”, “github · development”, “~/Downloads/FluxCatch” … (+18)
- settings-960 · morning · zh: “Local-first media instrument”, “Language”, “默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。”, “FFmpeg 本地处理”, “扩展 ID”, “gpnojfocoanelgibidlhholjobljefab”, “github · development”, “~/Downloads/FluxCatch” … (+18)
- preview · morning · zh: “组件预览 · Component preview”, “两个时刻的同一片水面：左为清晨（浅色），右为黄昏（深色）。所有颜色、纹理与动效均由 token 与代码生成，无任何图片资”, “密度 Density”, “动效 Motion”, “页面主题 Page theme”, “重放下载 Replay”, “清晨 · Morning”, “Window chrome / sidebar” … (+74)
- popup-media · dusk · zh: “Keep What You See.”
- popup-jobs · dusk · zh: “Keep What You See.”
- sidepanel · dusk · zh: “Reading list”
- popup-results · dusk · zh: “Keep What You See.”, “Lecture 12 · Pharmacokinetics”, “lectures.example.org/media/hls/master.m3u8”, “Lecture 12 · Pharmacokinetics”, “media.example.net/media/lecture-12-pharmacokinetics.mp4”, “VIDEO”, “774.4 MiB”, “Lecture 12 · Pharmacokinetics” … (+3)
- sidepanel-link-dialog · dusk · zh: “Reading list”
- sidepanel-results · dusk · zh: “Lecture 12 · Pharmacokinetics”, “Lecture 12 · Pharmacokinetics”, “lectures.example.org/media/hls/master.m3u8”, “VIDEO”, “Lecture 12 · Pharmacokinetics”, “media.example.net/media/lecture-12-pharmacokinetics.mp4”, “VIDEO”, “774.4 MiB” … (+5)
- downloads-1280 · dusk · zh: “已保存 3 个文件 · 共 3.0 GiB”, “VIDEO”, “Interstellar Trailer 4K.mp4”, “2.2 GiB · 2:28 · 2160p”, “AUDIO”, “Keynote Highlights.m4a”, “46.1 MiB · 31:00”, “Apple Developer” … (+8)
- downloads-960 · dusk · zh: “已保存 3 个文件 · 共 3.0 GiB”, “VIDEO”, “Interstellar Trailer 4K.mp4”, “2.2 GiB · 2:28 · 2160p”, “AUDIO”, “Keynote Highlights.m4a”, “46.1 MiB · 31:00”, “Apple Developer” … (+8)
- settings-1280 · dusk · zh: “Local-first media instrument”, “Language”, “默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。”, “FFmpeg 本地处理”, “扩展 ID”, “gpnojfocoanelgibidlhholjobljefab”, “github · development”, “~/Downloads/FluxCatch” … (+18)
- settings-960 · dusk · zh: “Local-first media instrument”, “Language”, “默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。”, “FFmpeg 本地处理”, “扩展 ID”, “gpnojfocoanelgibidlhholjobljefab”, “github · development”, “~/Downloads/FluxCatch” … (+18)
- preview · dusk · zh: “组件预览 · Component preview”, “两个时刻的同一片水面：左为清晨（浅色），右为黄昏（深色）。所有颜色、纹理与动效均由 token 与代码生成，无任何图片资”, “密度 Density”, “动效 Motion”, “页面主题 Page theme”, “重放下载 Replay”, “清晨 · Morning”, “Window chrome / sidebar” … (+74)
- popup-downloads-active · morning · zh: “Keep What You See.”, “Lecture 12 · Pharmacokinetics.mp4”, “5.1 MiB/s”, “Keynote 2026.mp4”, “3.4 MiB/s”
- sidepanel-active · morning · zh: “Lecture 12 · Pharmacokinetics”, “Lecture 12 · Pharmacokinetics”, “lectures.example.org/media/hls/master.m3u8”, “VIDEO”, “Lecture 12 · Pharmacokinetics”, “media.example.net/media/lecture-12-pharmacokinetics.mp4”, “VIDEO”, “774.4 MiB” … (+9)
- downloads-active-1280 · morning · zh: “已保存 3 个文件 · 共 3.0 GiB”, “~/Downloads/FluxCatch”, “Lecture 12 · Pharmacokinetics.mp4”, “4.9 MiB/s”, “Keynote 2026.mp4”, “5.2 MiB/s”, “VIDEO”, “Interstellar Trailer 4K.mp4” … (+13)
- downloads-active-960 · morning · zh: “已保存 3 个文件 · 共 3.0 GiB”, “~/Downloads/FluxCatch”, “Lecture 12 · Pharmacokinetics.mp4”, “3.6 MiB/s”, “Keynote 2026.mp4”, “5.9 MiB/s”, “VIDEO”, “Interstellar Trailer 4K.mp4” … (+13)
- settings-active-1280 · morning · zh: “Local-first media instrument”, “Language”, “默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。”, “FFmpeg 本地处理”, “扩展 ID”, “gpnojfocoanelgibidlhholjobljefab”, “github · development”, “~/Downloads/FluxCatch” … (+18)
- popup-downloads-active · dusk · zh: “Keep What You See.”, “Lecture 12 · Pharmacokinetics.mp4”, “5.9 MiB/s”, “Keynote 2026.mp4”, “3.8 MiB/s”
- sidepanel-active · dusk · zh: “Lecture 12 · Pharmacokinetics”, “Lecture 12 · Pharmacokinetics”, “lectures.example.org/media/hls/master.m3u8”, “VIDEO”, “Lecture 12 · Pharmacokinetics”, “media.example.net/media/lecture-12-pharmacokinetics.mp4”, “VIDEO”, “774.4 MiB” … (+9)
- downloads-active-1280 · dusk · zh: “已保存 3 个文件 · 共 3.0 GiB”, “~/Downloads/FluxCatch”, “Lecture 12 · Pharmacokinetics.mp4”, “3.1 MiB/s”, “Keynote 2026.mp4”, “6.2 MiB/s”, “VIDEO”, “Interstellar Trailer 4K.mp4” … (+13)
- downloads-active-960 · dusk · zh: “已保存 3 个文件 · 共 3.0 GiB”, “~/Downloads/FluxCatch”, “Lecture 12 · Pharmacokinetics.mp4”, “3.1 MiB/s”, “Keynote 2026.mp4”, “4.9 MiB/s”, “VIDEO”, “Interstellar Trailer 4K.mp4” … (+13)
- settings-active-1280 · dusk · zh: “Local-first media instrument”, “Language”, “默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。”, “FFmpeg 本地处理”, “扩展 ID”, “gpnojfocoanelgibidlhholjobljefab”, “github · development”, “~/Downloads/FluxCatch” … (+18)

## Dusk contrast failures (d)

- popup-media: 3.61:1 span#jobCount.count “0”
- popup-jobs: 4.1:1 span#mediaCount.count “0”; 4.11:1 span#jobCount.count “0”
- popup-link-dialog: 4.35:1 button.close-button “×”
- popup-results: 3.61:1 span#jobCount.count “0”; 4.04:1 div.kind-icon.stream “HLS”; 4.04:1 span.chip.hls “HLS”; 4.28:1 div.kind-icon.video “▶”; 4.28:1 span.chip.hd “360p”; 3.75:1 span.chip “774.4 MiB”
- popup-media-dialog: 4.35:1 button.close-button “×”
- sidepanel-results: 4.04:1 span.kind-icon.stream “HLS”; 4.04:1 span.chip.stream “HLS”; 4.28:1 span.kind-icon.video “VIDEO”; 3.75:1 span.chip “VIDEO”; 4.28:1 span.chip.quality “360p”; 3.75:1 span.chip “774.4 MiB”
- downloads-1280: 3.93:1 span#countCompleted.count “3”; 3.93:1 span#countFailed.count “2”; 2.55:1 button#clearHistoryButton.quiet-button.danger “Clear history”; 4.28:1 span.kind-icon.job-tile.video “VIDEO”; 4.32:1 span.job-chip.done “Completed”; 4.28:1 span “Open”
- downloads-960: 3.93:1 span#countCompleted.count “3”; 3.93:1 span#countFailed.count “2”; 2.55:1 button#clearHistoryButton.quiet-button.danger “Clear history”; 4.28:1 span.kind-icon.job-tile.video “VIDEO”; 4.32:1 span.job-chip.done “Completed”; 4.28:1 span “Open”
- settings-1280: 4.1:1 span.section-index “01”; 4.1:1 span.status-badge “Actual configuration governs”; 4.1:1 span.section-index “02”; 2.26:1 code#downloadLocationPath.location-path “~/Downloads/FluxCatch”; 4.1:1 span.section-index “03”; 4.1:1 span.section-index “04”
- settings-960: 4.1:1 span.section-index “01”; 4.1:1 span.status-badge “Actual configuration governs”; 4.1:1 span.section-index “02”; 2.26:1 code#downloadLocationPath.location-path “~/Downloads/FluxCatch”; 4.1:1 span.section-index “03”; 4.1:1 span.section-index “04”
- preview: 4.26:1 i.count “12”; 4.22:1 span.count “2”; 4.37:1 span.toast-message “源站拒绝了第 12 个片段”; 4.45:1 span.job-chip.wait “等待中”; 4.38:1 span.job-chip.bad “× 失败”; 4.45:1 span.chip “MP4”
- downloads-empty-1280: 3.93:1 span#countCompleted.count “0”; 3.93:1 span#countFailed.count “0”
- downloads-empty-960: 3.93:1 span#countCompleted.count “0”; 3.93:1 span#countFailed.count “0”
- popup-downloads-active: 4.1:1 span#mediaCount.count “3”; 4.11:1 span#jobCount.count “2”
- sidepanel-active: 4.04:1 span.kind-icon.stream “HLS”; 4.04:1 span.chip.stream “HLS”; 4.28:1 span.kind-icon.video “VIDEO”; 3.75:1 span.chip “VIDEO”; 4.28:1 span.chip.quality “360p”; 3.75:1 span.chip “774.4 MiB”
- downloads-active-1280: 3.93:1 span#countCompleted.count “3”; 3.93:1 span#countFailed.count “2”; 2.55:1 button#clearHistoryButton.quiet-button.danger “Clear history”; 4.28:1 span.kind-icon.job-tile.video “VIDEO”; 4.32:1 span.job-chip.done “Completed”; 4.28:1 span “Open”
- downloads-active-960: 3.93:1 span#countCompleted.count “3”; 3.93:1 span#countFailed.count “2”; 2.55:1 button#clearHistoryButton.quiet-button.danger “Clear history”; 4.28:1 span.kind-icon.job-tile.video “VIDEO”; 4.32:1 span.job-chip.done “Completed”; 4.28:1 span “Open”
- settings-active-1280: 4.1:1 span.section-index “01”; 4.1:1 span.status-badge “Actual configuration governs”; 4.1:1 span.section-index “02”; 2.26:1 code#downloadLocationPath.location-path “~/Downloads/FluxCatch”; 4.1:1 span.section-index “03”; 4.1:1 span.section-index “04”

## Colour literals outside the token files (h)

Counted with v1's own token file (extension/ui/tokens.css), as in the first v1 baseline.

- extension/background.js: 4 — L4697 #0A66D6, L4697 #3A3A3C, L4697 #8E8E93, L4705 #FFFFFF
- extension/preview/preview.css: 2 — L151 #2B2E4A, L152 #1C2140
- extension/ui/components.css: 3 — L156 %235F6382, L514 rgba(0…, L515 rgba(0…
- extension/ui/customization.js: 3 — L9 #3E6E92, L130 #FAF7F2, L131 #2B2E4A

## Definitions

See the header of scripts/lib/page-audit.mjs for the exact definition of each check.
