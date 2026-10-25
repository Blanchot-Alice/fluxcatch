# Havre design

Havre's interface is the v2 design system: Monet's structure translated
into one continuous surface per view, in two hours of light (Morning and Dusk).
This file is a short orientation. The rules come from the design review
(`havre-design-review.md`, "Design Review and Corrective Spec (v1 → v2)",
which wins over the original brief). Both reviews and the original brief are
in [`docs/design-review/`](docs/design-review/): `havre-design-review.md`
(v1 to v2), `havre-design-review-v3.md` (v2 to v3, which supersedes §6.7,
§6.10 and part of §5 of the first, with its rendered pond reference under
`pond-reference/`) and `monet-download-manager-design-brief.md`. What they
decided is recorded here, in
[`extension/ui/v2/README.md`](extension/ui/v2/README.md) (the API and the rules
the design audit enforces) and in the same folder (the approved rename table
and the per-step notes).

## Where things are

- `extension/ui/v2/`: the shared system. `tokens.css` (value ladders, hues, type
  roles, grid, shape, motion), `system.css` (every shared component),
  `components.js`, `controls.js`, `rows.js` (builders that emit only system
  classes), `media.js` and `media.css` (what the popup and the side panel
  share), `jobs.js`, `runtime.js`, `errors.js`, `locale.js`, `pond.js`, and the
  copy in `messages/*.js`. `tokens.js` mirrors the three Morning tokens the
  worker's toolbar badge needs.
- `extension/lib/format.js` and `extension/lib/job-failure.js`: decimal sizes
  and the failure codes with their sentences, shared by the pages and the worker.
- Surfaces: `popup/`, `sidepanel/`, `downloads/` (the reference
  implementation), `options/` (Settings), `designer/` (the UI editor behind
  Settings → Developer) and `preview/` (the component gallery,
  `preview/preview.html?view=type|text|controls|rows|feedback|overlays`).
- `extension/icons/`: `havre-mark.svg` (the mark) and `havre-mark-16.svg`
  (the pad and the blossom only, for 16 px); `scripts/build-icons.mjs` renders
  the PNGs from them with Chrome for Testing.
- `docs/design-review/`: the approved rename table and the per-step notes.
- `docs/design-audit/`: audit reports. `scripts/design-audit.mjs` runs the
  audit in Chrome; `scripts/design-atlas.mjs` lays two audit runs out as
  before/after pairs and prints the atlas PDF with Chrome;
  `scripts/contrast_report.mjs` prints the token contrast table;
  `scripts/build-display-font.mjs` rebuilds the Chinese Display subset.

## The principles in one page

1. One pond per view. Content sits on the canvas. Only dialogs, menus,
   popovers, toasts and at most one focus panel (the live download) are
   containers, and no container sits inside another.
2. Series. Every surface shares one skeleton: a top bar with the BrandMark and
   at most two icon buttons, an optional page title, one content column.
   Morning and Dusk change only the light.
3. Colour is light. State is an 8px dot plus a word, or a low tint on hover
   and selection; there are no coloured blocks and no status chips.
4. Broken colour lives in the background: the procedural pond layer
   (`pond.js`) appears in empty space only, and text keeps its value contrast.
5. Decentred, left-anchored composition; empty states sit in the upper third
   on the text column.
6. Soft separation: spacing and value steps, never 1px rules, with one
   exception: `hr.section-rule`, the mist line between top-level sections of
   the Settings page (design review v3.1 §2.2). The top bar
   gains a mist only once the page has scrolled.

## What the audit holds every screen to

- Eight type roles only (wordmark, display, empty, title, row, body, meta,
  label), at most six per screen, Display at most twice. Filenames use `row`.
- At most three left text edges per surface; trailing items share one right
  edge.
- Text contrast of 4.5:1 and control boundaries of 3:1 in both themes.
- No colour literals outside the token files, no CJK outside the `zh` tables
  of the message modules, no tracked caps, italics or monospace.
- One primary button per view; destructive actions are confirmed in place.
- No helper paragraphs: the local engine is explained once, in Settings, and
  everywhere else it is one status line ("Local engine isn't set up · Set up").
- One locale source: the extension's UI language (Auto follows Chrome) decides
  every string and every number, size and date format. Errors reach pages as
  codes and are described in that language; raw engine text is never shown.
- The pond layer (design review v3 §3.1): in the margins of full pages with
  gutters of 48 px or more, chroma coverage between 3% and 12% and p95 |ΔL| at
  most 0.03 in Morning and 0.05 in Dusk, in OKLCH against the same capture
  with the layer hidden; no pond pixel under any text run on any screen. The
  audit stores one pond seed before each run (`--pond-seed`, default the
  module's own 0x5EED1E5) and reports a sweep over other seeds.
- Text contrast is measured against the composited background (the pond's
  pixels over the canvas), never the flat canvas token.
- At scroll position 0 the top bar is the canvas (v3 §3.6): background alpha
  0, no shadow, the band at opacity 0, and the capture without the layer is
  canvas pixel for pixel outside the bar's content box.

## Fonts

Fraunces (Display, Latin), Noto Serif SC (Display, a build-time subset of the
fixed Chinese Display strings) and Instrument Sans (Text) ship in
`extension/ui/fonts/` with their OFL licences. Nothing is fetched from the
network. After adding or changing a Display string, rebuild the subset with
`scripts/build-display-font.mjs`; `tests/ui-v2.test.js` fails until it is
complete.
