# FluxCatch — Design Review v3.2: the mark, round 2

Audience: Claude Code. Owner: Andy. Date: 2026-10-24.

This replaces §1 of `fluxcatch-design-review-v3.1.md`. §2 (Settings section dividers), §3 and §4 of v3.1 stand; only the mark changes.

## 1. Why round 1 was withdrawn

Round 1 (`docs/design-review/icon-candidates/`, A Drift, B Haze, C Waterline) answered the question "does it look like Monet" and ignored the question "does it say what the product does". A pond, a haze and a horizon are scenery. A toolbar button has to say "download" at 16 px to someone who has never read the README. The brand line is *Keep what you see*: the icon has to show keeping.

Round 2 keeps the one glyph everyone reads as download, an arrow coming down to a line, and builds the Monet scene around it. The line is the waterline; the sky is above it, the pond below; the arrow's reflection is painted in the water, mirrored, faded and broken by ripples, the way a reflection breaks on a pond. The glyph carries the function, the scene carries the aesthetic, and the reflection joins them.

## 2. The three candidates

Files: `docs/design-review/icon-candidates-2/`. Each candidate has `fluxcatch-<name>.svg` (the 128 mark), `fluxcatch-<name>-16.svg` (the 16 px mark), and rasters `-128.png` / `-16.png`. `icon-sheet-round2.png` shows every candidate at 128/48/32/16 on Chrome's light and dark toolbars and on both canvases. `build2.py` regenerates everything (Python 3 with Playwright and Pillow).

All three are original vector work from the Morning tokens; no painting is referenced. The disc holds on light and dark toolbars alike; a dawn haze warms the sky just above the line; a few lilac, celadon and rose touches sit on the water.

- **D3 · Stroke arrow.** The plain download arrow, round-capped, in the system's text indigo (`#2B2E4A`). The most literal; reads instantly at every size. 16 px: the two-tone disc and a solid arrow.
- **G · Brush arrow.** The same arrow drawn as three tapered strokes, thicker where the brush was set down and thinner where it was lifted. The only candidate with a hand in it; the one to choose if the mark should feel made rather than typed. 16 px: the brush arrow, heavier. **Recommended.**
- **H · Filled arrow.** A solid arrow form in pond blue (`#4E7FA2`), the colour of the product's primary button, so the mark and the "Download" button are one shape family. Reads as an emblem rather than a glyph. `h2-filled-arrow-indigo` is the same form in indigo, for a harder silhouette. 16 px: the solid form.

Andy chooses. The steps below are written for G; substitute the name for D3, H or H2.

## 3. Installation (replaces v3.1 §1.3)

1. Replace `extension/icons/fluxcatch-mark.svg` with `docs/design-review/icon-candidates-2/fluxcatch-g-brush-arrow.svg` and `extension/icons/fluxcatch-mark-16.svg` with `fluxcatch-g-brush-arrow-16.svg`. Keep the file names the code expects.
2. Regenerate `icon16.png` from the 16 mark and `icon32.png`, `icon48.png`, `icon128.png` from the 128 mark with headless Chromium at exact size, no post-scaling. The SVGs use `feGaussianBlur` and a `mask`; rasterise with a browser engine, not with a library that drops filters or masks.
3. Also regenerate `docs/assets/icon.png` (the README logo, 110 px wide in the README) from the 128 mark at 256 px.
4. The in-app BrandMark uses the 128 mark at its S and M sizes; check it at 20–24 px against both canvases. If the reflection turns to noise there, use the 16 mark for sizes under 24 px.
5. Capture the mark at 128/48/32/16 on Chrome's light and dark toolbars and on both canvases, plus the popup header in both themes, in the atlas format.

## 4. Order of work

As v3.1 §4, with this document's §3 in place of v3.1 §1.3: install the mark and the Settings rule, update the audit exemption, run the audit, capture, write `docs/design-review/step-v3-1-mark-and-rules.md`, then stop and wait. Do not commit.

## 5. Do not

- Redraw, simplify or restyle the arrow or the reflection. If a size reads badly, report it with a capture and wait.
- Add a tray line, a folder, a cloud or any second glyph; the waterline is the tray.
- Rasterise with a tool that ignores SVG filters or masks.
