# FluxCatch visual identity — the Monet translation

This document restates the design brief in FluxCatch's own terms, records the
token values the extension actually ships, and lists where and why they depart
from the brief's starting points. The implementation lives in
`extension/ui/tokens.css` (tokens), `extension/ui/atmosphere.css` (procedural
background) and `extension/ui/components.css` (shared primitives). Every
component the brief asks for can be inspected in both themes at
`extension/preview/preview.html`.

Stack: Chrome Manifest V3 extension, vanilla HTML/CSS/ES modules, macOS +
Chrome. App name: FluxCatch.

## 1. What the painting teaches the interface

1. **Colour is the colour of light, not of things.** A download row is not
   "blue because the brand is blue". It is cool while it starts, warms as it
   finishes, settles to celadon when it is done, and only turns vermilion when
   something failed. Time of day picks the theme; state picks the hue.
2. **There is no black.** The darkest tone anywhere is a deep indigo-violet
   (`#2B2E4A` in the morning theme). Shadows are violet, scrims are indigo,
   the dark theme's ground is a dusk pond (`#1C2140`), never `#000`.
3. **Broken colour.** Surfaces are not one flat fill. The ground is a primed
   cream over which two or three enormous, barely visible light fields
   (lilac, pond, apricot) are laid; a procedural canvas weave sits on top at a
   few percent. Up close it is patches; at reading distance it is one calm
   surface.
4. **The ground glows.** Backgrounds are warm cream (`#F4F0E9`), raised
   surfaces a brighter cream (`#FAF7F2`). Nothing is white, nothing is grey.
5. **Brushwork at the micro scale only.** Texture is grain and a faint weave,
   never a brush-stroke graphic. Edges are soft: tonal steps and translucent
   indigo lines instead of opaque dividers.
6. **Composition without outlines.** No hard 1px rules between rows. Lists
   are continuous surfaces; rows separate by a two-percent tonal zebra and a
   hover tint. Hierarchy comes from weight, size and tone, not from boxes.
7. **Water and reflection.** The one literal "water" motif is a mirrored,
   blurred, low-opacity echo under the speed graph and the active-download
   card. Motion is slow and ripple-like.
8. **The series method.** Progress is one subject painted at many hours: the
   bar's fill is a gradient from lilac through pond to ochre, so a transfer
   literally warms as it completes. Light and dark are two hours of the same
   scene, so switching themes is a cross-fade, not a flip.
9. **Humid air.** Brightness without glare, stillness with movement, no hard
   edge anywhere. When in doubt: softer edge, cooler shadow, warmer light.

## 2. Translation rules used in the code

| Painting idea | Interface rule in FluxCatch |
| --- | --- |
| Flat fill | `body` ground + 3 radial light fields (6–12%) + feTurbulence grain (5–7%), see `atmosphere.css` |
| Outline / border | tonal step (`--surface-cool`, `--surface-sunken`) or a translucent indigo line (`--line-soft` 10%, `--line-strong` 18%); never an opaque grey line |
| Drop shadow | `--shadow-ambient` `rgba(78,70,130,.12)` at 28px blur, `--shadow-float` ×1.6 for floating chrome |
| Brand colour | a small palette of hues by state: `--pond` (action), `--lilac` (hover halo, paused), `--celadon` (complete), `--ochre` (warning, almost done), `--vermilion` (error only), `--harbour` (queued, disabled) |
| Brush stroke | grain only; the segment map of multi-connection downloads is the one place short dashes appear, in low-contrast pond and celadon |
| Reflection | `.fc-reflection` mirrored + blurred copy at 20% under charts and the active card |
| Time of day | `--progress-gradient` and the Morning / Dusk theme pair |

## 3. Tokens

The full token sheet with both themes, the historical aliases and the semantic
layer is `extension/ui/tokens.css`. The hues below are the brief's starting
points; the right-hand column records what shipped and why.

### 3.1 Morning (light)

| Token | Brief | Shipped | Why |
| --- | --- | --- | --- |
| `--bg-canvas` | `#F4F0E9` | same | |
| `--surface` | `#FAF7F2` | same | |
| `--surface-cool` | `#EAEFF2` | same | list zebra / inset |
| `--surface-sunken` | `#ECE6DE` | same | inputs and wells |
| `--surface-raised` | — | `#FDFBF8` | the 3% hover lift the brief describes needs a named stop |
| `--text-primary` | `#2B2E4A` | same | 12.3:1 on surface |
| `--text-secondary` | `#5A5F7E` | `#4F5476` | brief value passes (5.8:1) but sat too close to the corrected muted; moved one step so the two remain distinct |
| `--text-muted` | `#8B8FA8` | `#5F6382` | brief value is 2.98:1 on surface and fails body-text contrast; same hue, darker, 5.5:1 on surface and ≥ 4.7:1 on every surface |
| `--pond` | `#4E7FA2` | same | large fills, icons, progress, focus |
| `--pond-deep` | — | `#3E6E92` | filled primary buttons: pond itself is 4.3:1 under cream text, this is 5.1:1 |
| `--pond-ink` | — | `#3B6A8D` | pond carried dark enough for 12–13px links and quiet buttons (5.4:1) |
| `--lilac` / `--lilac-ink` | `#9A8CC4` | same / `#5F5490` | paused text needs the ink step (6.2:1) |
| `--celadon` / `--celadon-deep` / `--celadon-ink` | `#8FB8A3` | same / `#37735A` / `#2F6A52` | celadon is 2.1:1 as text; the deep value is for filled success buttons (5.2:1), the ink for "complete" labels (6.0:1) |
| `--ochre` / `--ochre-ink` | `#D9A24F` | same / `#8A5E12` | warning text at 5.3:1 |
| `--apricot` | `#E7B089` | same | light field, warm highlight only |
| `--rose` / `--rose-ink` | `#E3AFB4` | same / `#9E4652` | badges; rose-ink is the chip text (5.7:1) |
| `--vermilion` / `--vermilion-ink` | `#D8603B` | same / `#AF421D` | vermilion as 12px text is 3.5:1; the ink step is 5.4:1 on surface and 4.7:1 on sunken wells, and cream text on it is 5.4:1 for the destructive button |
| `--harbour` / `--harbour-ink` | `#8A9BAE` | same / `#57667B` | queued state text (5.5:1 on surface, 4.7:1 on sunken wells) |
| `--shadow-ambient` | `rgba(78,70,130,.12)` | same | |
| `--shadow-focus` | `rgba(78,127,162,.35)` | same | |
| `--line-soft` | `rgba(43,46,74,.10)` | same, plus `--line-strong` at .18 | |
| `--control-border` | — | `#768498` | form controls under `prefers-contrast: more` and the 3:1 non-text floor on every surface including the sunken well; normally mixed to 62% so the edge stays soft |

### 3.2 Dusk (dark)

| Token | Brief | Shipped | Why |
| --- | --- | --- | --- |
| `--bg-canvas` | `#1C2140` | same | |
| `--surface` / `--surface-cool` / `--surface-raised` / `--surface-sunken` | `#252B4D` / `#2A3356` / `#2E355A` / `#181C36` | same | |
| `--text-primary` | `#EFE9E0` | same | warm pearl |
| `--text-secondary` | `#B9B6CC` | same | 6.9:1 |
| `--text-muted` | `#8186A4` | `#9A9FBA` | brief value is 3.8:1 on surface and 3.3:1 on raised; lifted to 5.3:1 / 4.5:1 |
| `--pond` | `#7FB0D0` | same | also the filled primary in dusk, with dusk-ink text (6.7:1) |
| `--pond-ink` | — | `#8DBAD6` | small-text pond |
| `--vermilion-ink` | — | `#EC8468` | `#E8785A` is 4.1:1 on raised surfaces; this is 4.6:1 |
| `--harbour-ink` | — | `#97A4B8` | harbour as text is 3.3:1; this is 4.7:1 |
| other hues | as brief | same | all ≥ 4.7:1 as text on every dusk surface |
| `--shadow-ambient` | `rgba(10,12,32,.45)` | same | |
| `--line-soft` | `rgba(239,233,224,.08)` | same, `--line-strong` .16 | |

### 3.3 Semantic mapping

- Primary action: `--pond-deep` fill, `--text-on-accent` text; `--pond` for the focus ring, icons and large fills.
- Hover / focus halo: `--hover-halo` (lilac at 24%), soft, large radius.
- Downloading: `--progress-gradient` (lilac 0% → pond-soft 45% → ochre 100%), spanning the whole track and revealed by the fill.
- Paused: track in desaturated lilac at 60%.
- Queued: `--harbour` / `--harbour-ink`.
- Complete: `--celadon` at 70% on the track, `--celadon-ink` for the label.
- Warning: `--ochre` / `--ochre-ink`.
- Error, cancel, delete: `--vermilion` / `--vermilion-ink`, used only there.
- Selection: `--selection` (pond-soft at 14%), no border.

### 3.4 Progress

The fill is a horizontal gradient that reads cool on the left and warm on the
right. The gradient is painted on the track; the filled width uncovers it, so a
bar warms as it fills. On completion the track cross-fades over 600 ms to
celadon at 70% and a single 1px ring ripples outward once (700 ms). A 12%
light sweep crosses the fill every 2.4 s; the brief's 2–3% was invisible on a
4px bar, so the sweep is brighter but thinner. Shimmer, ripple and drift are
all off under `prefers-reduced-motion` and under the preview's motion toggle.

## 4. Other decisions worth recording

- **Fonts are bundled, not fetched.** FluxCatch is local-first and promises
  that no byte leaves the machine except toward the site being visited, so
  Fraunces (latin, 121 KB) and IBM Plex Sans (variable weight and width,
  latin + latin-ext, 56 KB) are shipped under `extension/ui/fonts/` with their
  OFL licences. CJK text falls back to Songti SC for display and PingFang SC
  for UI.
- **Type is kept lean.** The brief's first sans, Instrument Sans, read plump
  in Latin at 13px (wide set, tall x-height), so the UI face is the brief's
  second choice, IBM Plex Sans, rendered at 94% width through its `wdth`
  axis. The sans uses two weights only: 400 for text and 500 for emphasis,
  labels and buttons; nothing is set at 600 or 700. Fraunces is set at book
  weight (400, 450 for file names) with the SOFT axis at 0 and the optical
  size left to the browser, so titles are crisp rather than round. Italics
  are not bundled and never synthesized.
- **Shape.** 6px controls, 10px rows, 14px panels, pills for chips. The
  designer's radius slider now defaults to 14 and derives the smaller radii
  from it.
- **Density.** `[data-density="compact"]` on the root tightens row padding,
  list gaps and section gaps; nothing else changes.
- **Elevation.** Three levels only: ground, card (`--shadow-card`), floating
  (`--shadow-float` + frosted `--material`).
- **Historical variable names stay.** `--canvas`, `--ink`, `--muted`,
  `--primary`, `--primary-action`, `--success`, `--danger` and the rest now
  alias the Monet tokens, so the designer page's accent override keeps working
  and every page style resolves.
- **The accent override** in the designer still lets the user pick any accent;
  text on it is chosen between the cream and the indigo instead of between
  pure white and pure black.
- **App icon.** An abstract lily pad with a notch, two ripple arcs and one
  rose blossom on a cream disc, drawn as a single SVG and exported to the four
  PNG sizes. No painting, no signature, no resemblance to a specific canvas.

## 5. Contrast report

Generated by `node scripts/contrast_report.mjs`, which parses
`extension/ui/tokens.css` and checks every text token against every surface in
both themes (WCAG 2.x relative luminance). Floors: 4.5:1 for body text, 3:1
for large text and control boundaries.

<!-- CONTRAST_REPORT:START -->
### Morning

| Text | floor | --bg-canvas #F4F0E9 | --surface #FAF7F2 | --surface-raised #FDFBF8 | --surface-cool #EAEFF2 | --surface-sunken #ECE6DE |
| --- | --- | --- | --- | --- | --- | --- |
| `--text-primary` #2B2E4A | 4.5:1 | 11.61 | 12.34 | 12.77 | 11.38 | 10.64 |
| `--text-secondary` #4F5476 | 4.5:1 | 6.46 | 6.87 | 7.10 | 6.33 | 5.92 |
| `--text-muted` #5F6382 | 4.5:1 | 5.14 | 5.47 | 5.66 | 5.04 | 4.71 |
| `--pond-ink` #3B6A8D | 4.5:1 | 5.09 | 5.41 | 5.60 | 4.99 | 4.66 |
| `--lilac-ink` #5F5490 | 4.5:1 | 5.86 | 6.22 | 6.44 | 5.74 | 5.37 |
| `--celadon-ink` #2F6A52 | 4.5:1 | 5.59 | 5.95 | 6.15 | 5.49 | 5.13 |
| `--ochre-ink` #8A5E12 | 4.5:1 | 5.01 | 5.32 | 5.51 | 4.91 | 4.59 |
| `--rose-ink` #9E4652 | 4.5:1 | 5.36 | 5.69 | 5.89 | 5.25 | 4.91 |
| `--vermilion-ink` #AF421D | 4.5:1 | 5.11 | 5.43 | 5.62 | 5.01 | 4.68 |
| `--harbour-ink` #57667B | 4.5:1 | 5.15 | 5.47 | 5.66 | 5.05 | 4.72 |
| `--pond` #4E7FA2 | 3:1 | 3.79 | 4.03 | 4.16 | 3.71 | 3.47 |
| `--control-border` #768498 | 3:1 | 3.35 | 3.56 | 3.68 | 3.28 | 3.07 |

| Filled control | ratio |
| --- | --- |
| `--text-on-accent` #FAF7F2 on `--pond-deep` #3E6E92 | 5.10 |
| `--text-on-accent` #FAF7F2 on `--celadon-deep` #37735A | 5.22 |
| `--text-on-accent` #FAF7F2 on `--vermilion-ink` #AF421D | 5.43 |
| `--text-on-accent` #FAF7F2 on `--ochre-ink` #8A5E12 | 5.32 |

### Dusk

| Text | floor | --bg-canvas #1C2140 | --surface #252B4D | --surface-raised #2E355A | --surface-cool #2A3356 | --surface-sunken #181C36 |
| --- | --- | --- | --- | --- | --- | --- |
| `--text-primary` #EFE9E0 | 4.5:1 | 12.98 | 11.36 | 9.81 | 10.20 | 13.83 |
| `--text-secondary` #B9B6CC | 4.5:1 | 7.92 | 6.94 | 5.99 | 6.23 | 8.45 |
| `--text-muted` #9A9FBA | 4.5:1 | 6.00 | 5.25 | 4.54 | 4.71 | 6.39 |
| `--pond-ink` #8DBAD6 | 4.5:1 | 7.55 | 6.61 | 5.71 | 5.93 | 8.05 |
| `--lilac-ink` #B5A7DE | 4.5:1 | 7.12 | 6.23 | 5.38 | 5.59 | 7.59 |
| `--celadon-ink` #9FCDB5 | 4.5:1 | 8.85 | 7.75 | 6.70 | 6.96 | 9.44 |
| `--ochre-ink` #E6B86A | 4.5:1 | 8.52 | 7.46 | 6.45 | 6.70 | 9.08 |
| `--rose-ink` #E9BFC3 | 4.5:1 | 9.47 | 8.30 | 7.17 | 7.45 | 10.10 |
| `--vermilion-ink` #EC8468 | 4.5:1 | 6.02 | 5.27 | 4.55 | 4.73 | 6.41 |
| `--harbour-ink` #97A4B8 | 4.5:1 | 6.20 | 5.43 | 4.69 | 4.87 | 6.61 |
| `--pond` #7FB0D0 | 3:1 | 6.73 | 5.89 | 5.09 | 5.29 | 7.17 |
| `--control-border` #7C8AA2 | 3:1 | 4.48 | 3.93 | 3.39 | 3.52 | 4.78 |

| Filled control | ratio |
| --- | --- |
| `--text-on-accent` #1C2140 on `--pond-deep` #7FB0D0 | 6.73 |
| `--text-on-accent` #1C2140 on `--celadon-deep` #9FCDB5 | 8.85 |
| `--text-on-accent` #1C2140 on `--vermilion-ink` #EC8468 | 6.02 |
| `--text-on-accent` #1C2140 on `--ochre-ink` #E6B86A | 8.52 |

Pairs below their floor: 0.
<!-- CONTRAST_REPORT:END -->
