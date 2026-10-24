# FluxCatch — Design Review v2 → v3

Audience: Claude Code. Owner: Andy. Reviewed: the design atlas dated 2026-10-23 (99 pages; audit run 2026-10-22 19:44 UTC on the working tree above 3a66300, plus the 15 e2e visual states).

Read this whole document before changing code. It supersedes §6.7, §6.10 and part of §5 of `fluxcatch-design-review.md` (v1→v2). Everything else in that document still stands.

Companion files, in `docs/design-review/pond-reference/`:

- `pond_layer.py` — the normative algorithm for the pond layer and the progress-colour check. Run `python3 pond_layer.py out` (needs numpy and Pillow; the machine's default python3 does not have them, so use a venv or `pip install numpy pillow`) to regenerate every reference image and `metrics.txt`. Port this algorithm into `extension/ui/v2/pond.js`, keeping its existing mulberry32 PRNG, OKLCH helpers and gamut clamp, and replacing `planTouches`; do not reinterpret the parameters.
- `pond-morning-1280x900.png`, `pond-dusk-1280x900.png`, `pond-morning-grey.png`, `pond-dusk-grey.png` — the full-size references and their greyscale checks; `metrics.txt` — the measured numbers; `pond-v2-spec-as-written.png` — the old spec for comparison.
- `pond-contact-sheet.png` — A: the v2 spec rendered exactly as written; B/C: the v3 layer in Morning and Dusk; D: the greyscale check; E: why the progress hue is dropped (`progress-hue-paths.png` is the strip on its own).
- `pond-mock-empty-morning.png`, `pond-mock-empty-dusk.png` — the Downloads empty state over the v3 layer with the content mask applied. This is the target look for every empty state. The fonts in the mock are placeholders; take the layout from the atlas, not from the mock.

Also placed in `docs/design-review/`: `monet-download-manager-design-brief.md` (the original brief) and `fluxcatch-design-review.md` (v1→v2), which `DESIGN.md` says were missing from the repository. Update that sentence in `DESIGN.md`.

## 1. Verdict

Structure passed. v2 did what the v1→v2 review asked: one column, no nested containers, one skeleton across popup, side panel, Downloads and Settings, one BrandMark, the type roles respected, no tracked caps, no hard rules, decimal units, real plurals, consistent locale, developer vocabulary mostly gone, dialogs that fit the popup, autosave instead of a save bar. The atlas itself (per-surface, four variants each, with viewport and DPR stated) is the right way to deliver.

Atmosphere failed. v2 is a competent, quiet, generic-minimal interface, and almost nothing in it says Monet. v1 had Monet's colour without his structure; v2 has his structure without his light. The one device that was supposed to carry the atmosphere, the pond layer, renders as a handful of pale specks that read as dust (atlas pp. 22–29, and any margin at 2×). In Dusk the specks are dark green-black and read as dirt.

The cause is the specification, not the implementation. §6.10 of the previous review asked for 150–250 touches on a 1280×900 canvas; rendered exactly as written (contact sheet A) that covers 0.3% of the page and is invisible. The same section demanded equiluminance in Dusk, which at L = 0.25 can only produce mud. §6.7's progress colour (`color-mix(in oklch, lilac, ochre)`) interpolates hue along the short arc from 296° to 75°, which passes through 0°: at 62% the bar is coral (223, 137, 134), next to a vermilion "Cancel" (atlas p. 30; contact sheet E). You implemented both faithfully. Both are replaced below, this time with a rendered reference and measured numbers rather than prose parameters.

## 2. Keep as-is

Do not touch these in v3: the skeleton and grid of the popup and side panel; the Downloads row anatomy (glyph, filename in `row`, meta, source, trailing status only for exceptions); the Settings page structure (nav column, one row per setting, inline "Saved"); the state legend on preview p. 68; the dialog, menu, toast and confirm-in-place components; the e2e visual matrix; the atlas format.

## 3. Findings

### 3.1 Pond layer (replaces §6.10)

Evidence: pp. 22–29 (Downloads empty state), pp. 9–12 (side panel), any 2× crop of a margin.

What is wrong: isolated 6–18 px touches, uniformly scattered, ~200 per page, at or below the visibility threshold. Monet's water is the opposite: touches gather into drifts (reflected clouds, groups of pads), overlap, and leave open ground between the drifts. Density varies at the scale of the whole canvas, not at the scale of a touch.

What v3 does (see `pond_layer.py`, `render_pond(spec="v3")`; measured values are from `metrics.txt`):

- Structure: 6 elongated horizontal drifts per 1280×900 (scaled by √area), each a Gaussian 12–38% of the width by 4–13% of the height, each with one dominant hue family. Density = `(0.012 + 0.988·drift^2.2) · (0.6 + 0.4·band)`, where `band` is a 2-octave value noise with 1×9 cells (horizontal ripples). Between drifts the ground is almost bare.
- Touches at three scales per 1280×900, placed by rejection sampling against the density field: 420 atmosphere touches (30–84 × 6–11 px, alpha 0.10–0.24), 2 600 body touches (10–30 × 3–6.5 px, alpha 0.22–0.48), 3 800 fine touches (4–11 × 2–3.4 px, alpha 0.26–0.55). Angle ~ N(0°, 7°). Soft ellipse, feather 0.55; the composited result is blurred 0.7 px.
- Hue: the families `celadon → pond-soft → lilac → rose → apricot` are ordered so that neighbours are neighbours on the hue circle; a drift's hue position interpolates along that list, so no drift ever crosses red. Measured family hues (OKLCH): celadon 163°, pond-soft 242°, lilac 296°, rose 12°, apricot 57°. Jitter N(0°, 9°).
- Lightness relative to the canvas (OKLCH L; canvas Morning 0.955, Dusk 0.25). Morning touches sit *below* the ground: −0.03, −0.06, −0.075 (σ 0.012–0.025) for the three scales, chroma 0.022–0.058. Dusk touches sit *above* the water: +0.07, +0.135, +0.165 (σ 0.018–0.032), chroma 0.030–0.080. This is the correction to the old equiluminance rule: on a primed canvas the ground is the lightest thing; on evening water the reflected light is the lightest thing.
- Result (full page, no mask): Morning mean |ΔL| 0.004, p95 0.025, chroma coverage (ΔC > 0.015) 6.4%; Dusk mean |ΔL| 0.008, p95 0.048, coverage 7.8%. The v2 spec as written: coverage 0.3%.
- Masking: alpha = 0 under every content box (header, title, controls, each text block, lists, forms, dialogs), feathered over 64 px outside the box edge (see `column_mask`). The pond is visible in page margins and in the empty area of empty states, side panel and popup. The empty-state sentence sits on masked ground, with the pond around it (see the two mock PNGs).
- Rendering: one offscreen Canvas 2D render per theme per viewport-size bucket (buckets of 128 px), drawn once and cached as an ImageBitmap; regenerate on resize after a 300 ms debounce. Seed: a 32-bit per-install integer in `chrome.storage.local`; PRNG mulberry32 (in the script, `Rng`); same seed must give the same layer on every surface. Static; nothing to disable under reduced motion. Blur via `ctx.filter = 'blur(0.7px)'` when drawing the cached bitmap, or a CSS filter on the layer element.
- Counts scale with area, so the popup (372×600, 0.19 of the reference area) gets about 3 drifts and ~1 300 touches; test it, the popup should show one or two drifts, not confetti.

Acceptance (add to the audit, §6): in the margin regions of each full page, chroma coverage (ΔC > 0.015 vs canvas) between 3% and 12% as seen in the page, the mask's feather included (the floor was 4% until 2026-10-24, when the audit's first measurements put the pinned seed at 3.2% to 3.9% on the component preview in Morning and on the whole Settings page in Dusk, with the layer otherwise as the script defines it); p95 |ΔL| ≤ 0.03 Morning, ≤ 0.05 Dusk; every text node's contrast is measured against the *composited* background (canvas + pond), not the flat token.

### 3.2 Progress colour (replaces §6.7)

Evidence: p. 30 (62% = coral beside "Cancel"), p. 5 (31% = magenta), contact sheet E.

The percentage-driven hue is dropped. Any hue path from blue to gold crosses either red (the v2 path) or green (the obvious alternative, which lands on celadon at 60–80%, the colour of Completed; contact sheet E, second strip). A bar whose colour changes with percentage also fights the state colours that the rest of the system already uses, and p. 68 shows that the state colours work.

v3: bar colour = state colour. Queued harbour, downloading pond, paused lilac (60% alpha), finishing (merging, converting) ochre, complete celadon for 1.2 s then the bar fades out, failed vermilion. The tip highlight and the 3% shimmer remain on the downloading bar. "A day passing" survives as the sequence of states, which are the real hours of a download.

### 3.3 Empty space is still dead space

Evidence: pp. 9–12 (side panel: content in the top 40%, nothing below), pp. 22–29 (Downloads empty state), pp. 56–63 (preview pages).

In Monet the empty area is the painting. With §3.1 implemented these become the most beautiful screens in the product; until then they look unfinished. No layout change is needed here, only the layer.

### 3.4 Full-page grid: the controls hang into the margin

Evidence: pp. 14–21, 30–37.

The URL field, "Download" button and the filter row start at x = 214, the page title and every row's text at x = 278, the glyphs at 254, the BrandMark logo at 254 and its name at 278. The title reads as indented under the controls. Rule: on full pages the lead column (56 px) holds only the BrandMark logo and the row glyphs; the page title, URL field, filter row and search all align to the text column. That leaves two text edges (text column; right-aligned trailing items). Settings already does this correctly (title and nav share x = 214, content at 435).

### 3.5 Row weight on full pages

Evidence: pp. 14–21.

At 1280 the Downloads page reads as a settings list, not a media library: a 16 px outline glyph and three lines of 12–13 px text per row. §6.4 of the previous review allowed a 56 × 32 poster frame of the user's own media; none of the captures shows one. On full pages (Downloads only, not popup or side panel) the lead becomes a 56 × 32, radius-6 frame: the media thumbnail when the engine has one, otherwise `surface-sunken` with the 16 px type glyph centred. It is an indicator, not a container, so it does not count toward the nesting rule. Row vertical padding on full pages goes to 14 px (comfortable) / 10 px (compact).

### 3.6 Sticky header band at scroll 0

Evidence: e2e pp. 85–94 (a tinted band with a visible lower edge across the top of every Settings capture); p. 88 shows content ghosting through it, so it is the frosted header.

At scroll position 0 the header must be indistinguishable from the canvas: background alpha 0, no mist. Tint (to 75% surface) and the mist shadow fade in over the first 24 px of scroll. The audit asserts header background alpha 0 and no box-shadow at scrollY = 0.

### 3.7 Two capture pipelines disagree

Evidence: p. 41 vs p. 86 (the same Settings/Dusk screen): the e2e capture has dimmer nav items and a visible header band; the audit capture does not. Either the e2e harness runs a stale build or a different stylesheet path.

One capture pipeline for both: the audit and the e2e matrix load the same built extension from the same output directory, and the atlas states the commit for both.

### 3.8 Copy

- "YouTube · Needs yt-dlp" (pp. 51–54): a tool name. Say "Needs the local engine" or "Needs an extra component", whichever is true.
- The rename table (`docs/design-review/rename-table.md`) and the step-4 stop (`docs/design-review/step-4-downloads.md`) were delivered as required. The terms now shipped in Settings are: Status, Local engine, Merging & converting, Instagram and X videos (Saved by Chrome), Local network, What FluxCatch can save, Streaming video, Bilibili videos, Live streams, Encrypted streams, Copy-protected video, Videos with separate sound, Video thumbnails, Saving, Speed preset (Steady / Balanced / Fast), Finding media, Privacy & network, Lab. Before v3 work starts, list which of these were "Proposed" in the table and are now live, so Andy can confirm them in one pass; any he rejects get a one-line alternative from you before implementation.
- Keyboard shortcut strings use macOS glyphs ("⌥⇧F"); render platform-appropriate names on Windows and Linux.

### 3.9 Validation ring

Evidence: p. 89, preview pp. 64–67. The error state draws a solid ~1.5 px vermilion outline, which reads as a border. Use the focus-ring construction with the error colour: 2 px vermilion at 60% plus a 6 px soft halo, radius matching the field.

### 3.10 App icon at 16 px

Evidence: preview pp. 56–59. At 16 px the ring and the wave collapse into a green blob. Ship a dedicated 16 px variant: the pad and the blossom only, no ring, no wave.

## 4. Errata to `fluxcatch-design-review.md` (v1→v2)

1. §6.10 pond layer: replaced by §3.1 above and `pond_layer.py`. The equiluminance rule is withdrawn; the greyscale acceptance becomes the p95 |ΔL| limits in §3.1.
2. §6.7 progress colour: replaced by §3.2. The `color-mix` formula is deleted.
3. §5 "content column max-width 880, centred": stands, and is not in conflict with P5. P5 (left-anchored, decentred composition) governs placement *inside* the column: text left-aligned, empty states in the upper third on the text column, negative space to the right. The column itself is centred in the window.
4. §6.4 lead: on full pages the 56 × 32 frame is mandatory (§3.5), not optional.

## 5. Order of work

1. Port `pond_layer.py` to Canvas 2D as `PondLayer`. Show it on the Downloads empty state in Morning and Dusk at 1280×900, with a greyscale pair and the §3.1 metrics. **Stop.** Send Andy the four images and the numbers and wait.
2. After approval: apply the layer to every surface with the masking rules; §3.2 progress colours; §3.4 grid; §3.5 lead frames.
3. §3.6 header, §3.7 single pipeline, §3.8 copy, §3.9 ring, §3.10 icon.
4. Extend the audit with the §3.1 acceptance checks, the composited-background contrast check and the header-at-scroll-0 assertion. Re-run; regenerate the atlas; deliver before/after pairs for every surface and theme, with the commit stated once for all captures.

## 6. Do not

- Regress anything in §2.
- Reintroduce a percentage-driven hue, a gradient track, a reflection, or a segment-dash field.
- Tune the pond layer by prose. If a parameter changes, change it in the script, re-run it, and ship the new metrics with the screenshots.
- Place the pond under text without the mask, or measure contrast against the flat canvas token.

When in doubt: more open ground between drifts, touches that gather rather than scatter, and the lightest value on the ground in Morning and on the water in Dusk.
