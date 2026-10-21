# FluxCatch design

FluxCatch's interface is the v2 design system: Monet's structure translated
into one continuous surface per view, in two hours of light (Morning and Dusk).
This file is a short orientation. The rules come from the design review
(`fluxcatch-design-review.md`, "Design Review and Corrective Spec (v1 → v2)",
which wins over the original brief). The review is not in this repository: the
project owner keeps it, so ask them for a copy. What it decided is recorded
here, in [`extension/ui/v2/README.md`](extension/ui/v2/README.md) (the API and
the rules the design audit enforces) and in
[`docs/design-review/`](docs/design-review/) (the approved rename table and the
Downloads step).

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
- `docs/design-review/`: the approved rename table and the per-step notes.
- `docs/design-audit/`: audit reports. `scripts/design-audit.mjs` runs the
  audit in Chrome; `scripts/contrast_report.mjs` prints the token contrast
  table; `scripts/build-display-font.mjs` rebuilds the Chinese Display subset.

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
6. Soft separation: spacing and value steps, never 1px rules. The top bar
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

## Fonts

Fraunces (Display, Latin), Noto Serif SC (Display, a build-time subset of the
fixed Chinese Display strings) and Instrument Sans (Text) ship in
`extension/ui/fonts/` with their OFL licences. Nothing is fetched from the
network. After adding or changing a Display string, rebuild the subset with
`scripts/build-display-font.mjs`; `tests/ui-v2.test.js` fails until it is
complete.
