# Design Brief — A Download Manager in the Spirit of Monet

## 0. The task

Design, then implement, the visual identity, design tokens and core screens of a desktop download manager.

- Stack: [FILL IN — e.g. Tauri + React + Tailwind / Electron + Svelte / SwiftUI]
- Platform: [FILL IN — macOS / Windows / both]
- App name: [FILL IN]

The whole aesthetic must be derived from Claude Monet's painting — his colour logic, brushwork, light and composition — translated into interface language.

**Non-negotiable rule:** do not use images of Monet's paintings anywhere. No full-bleed artwork, no cropped hero image, no blurred painting as a background, no "inspired-by" image asset, no AI-generated pastiche of a painting. Everything that evokes Monet must be produced with colour tokens, gradients, procedural texture, typography, shape and motion. If you ever want to drop in a picture, stop and solve it with tokens and code instead. The only raster/vector imagery allowed is the app icon and functional icons.

## 1. Source analysis — what makes a Monet look like a Monet

Ground every decision in these observations, not in a vague "pastel" vibe.

1. **Colour is light, not object.** Monet paints the colour of the light at a given hour, never the "local colour" of a thing. Grass can be violet, snow can be pink-blue, stone can be gold at noon and lilac at dawn. → In the UI, colour belongs to the state and the moment (idle, downloading, finished, error, time of day), not to a fixed brand swatch stamped on everything.
2. **No black.** Shadows are cool: blue, violet, blue-green. Darkness is coloured darkness. → No #000000, no pure grey text, no neutral black shadows. The darkest tone is a deep indigo-violet.
3. **Broken colour.** Pure hues placed side by side in small touches and left for the eye to mix at a distance. Up close: patches. From a few steps back: form. → Surfaces are built from several soft, low-contrast colour fields layered together, never one flat fill.
4. **Light-primed canvas.** He painted on a pale grey or cream ground, so the whole picture glows from inside. → The app background is a warm pale cream, not white, not grey.
5. **Brushwork.** Short, broken, dense touches — commas, dashes, dots — thick (impasto) in places, thin enough elsewhere to show canvas weave. Wet-into-wet, so edges are always soft. Stroke direction follows the subject: horizontal for water, vertical for grass, dots for foliage, wide sweeps for sky. → Texture exists at the micro scale (grain, a faint weave, a soft shimmer), never as a literal "brush stroke" graphic. Edges are soft; separation is tonal.
6. **Composition.** Horizon pushed very high or removed entirely (the Water Lilies are pure water surface — no sky, no bank, seen from above). No single hard focal point; outlines dissolve; no drawn line anywhere. → Generous, continuous surfaces; no hard 1px dividers; hierarchy by tone and weight, not by boxes and borders.
7. **Subjects.** Water, reflection, mist, snow, gardens, sky — media that make light itself visible. → The recurring visual motif is water surface and reflection: mirrored, blurred, low-opacity echoes of elements; slow ripple-like motion.
8. **The series method.** The same haystack, poplar, cathedral or lily pond painted at many hours and seasons; the real subject is change over time. → Progress is rendered as light changing over the course of a download: cool at the start, warming as it completes. Light/dark mode are two hours of the same scene, not two different brands.
9. **Overall feel.** Humid air, softness, brightness without glare, stillness with movement, no hard edge anywhere.

## 2. Translation principles (painting → interface)

- Flat fill → layered soft colour fields (2–4 radial/mesh gradients at low contrast + fine grain).
- Outline / border → tonal step (surface 2% lighter or darker than its parent) or a 1px line in a translucent cool tint, never an opaque grey line.
- Drop shadow → violet-tinted, large-blur, low-opacity ambient shadow (`rgba(78,70,130,0.10–0.16)`), never neutral black.
- Brand colour → a small palette of hues taken from specific canvases, used by state and context.
- Brush stroke → micro-texture only: SVG `feTurbulence` grain at 3–6% opacity, optional procedural canvas-weave at ≤4% opacity. No stroke-shaped graphics, no "painterly" filters on content.
- Reflection → mirrored, blurred, 15–25% opacity echo under charts and key cards (water reflection), used sparingly.
- Time of day → progress gradient and theme switching.

## 3. Colour tokens

All hex values below are starting points taken from the colour families of specific paintings; tune them, but keep the relationships.

### 3.1 Light theme — "Morning" (Rouen Cathedral / primed canvas family)

```
--bg-canvas:        #F4F0E9   /* primed cream ground */
--surface:          #FAF7F2   /* raised cards, slightly brighter */
--surface-cool:     #EAEFF2   /* pale morning sky, for list zebra / inset */
--surface-sunken:   #ECE6DE   /* inputs, wells */

--text-primary:     #2B2E4A   /* deep indigo-violet: the "black" of this app */
--text-secondary:   #5A5F7E
--text-muted:       #8B8FA8
--text-on-accent:   #FAF7F2

--pond:             #4E7FA2   /* Water Lilies pond blue — primary action */
--pond-soft:        #7FA6C4
--lilac:            #9A8CC4   /* Rouen lavender — secondary, paused, hover tint */
--celadon:          #8FB8A3   /* lily pad green — success / complete */
--ochre:            #D9A24F   /* Haystacks noon gold — warning, "almost done" */
--apricot:          #E7B089   /* Haystacks evening — warm highlight */
--rose:             #E3AFB4   /* lily blossom pink — gentle emphasis, badges */
--vermilion:        #D8603B   /* Impression, Sunrise sun — error / destructive only */
--harbour:          #8A9BAE   /* Impression, Sunrise grey-blue — disabled, dividers */

--shadow-ambient:   rgba(78, 70, 130, 0.12)
--shadow-focus:     rgba(78, 127, 162, 0.35)
--line-soft:        rgba(43, 46, 74, 0.10)
```

### 3.2 Dark theme — "Dusk" (Water Lilies at evening family)

```
--bg-canvas:        #1C2140   /* dusk pond: deep blue-violet, never black */
--surface:          #252B4D
--surface-cool:     #2A3356
--surface-raised:   #2E355A
--surface-sunken:   #181C36

--text-primary:     #EFE9E0   /* warm pearl, not white */
--text-secondary:   #B9B6CC
--text-muted:       #8186A4
--text-on-accent:   #1C2140

--pond:             #7FB0D0
--pond-soft:        #5E8DAE
--lilac:            #B5A7DE
--celadon:          #9FCDB5
--ochre:            #E6B86A
--apricot:          #EDBFA0
--rose:             #E9BFC3
--vermilion:        #E8785A
--harbour:          #6F7E95

--shadow-ambient:   rgba(10, 12, 32, 0.45)
--shadow-focus:     rgba(127, 176, 208, 0.35)
--line-soft:        rgba(239, 233, 224, 0.08)
```

### 3.3 Semantic mapping

- Primary action: `--pond`
- Hover / focus halo: `--lilac` at 20–30% opacity, soft, large radius
- Downloading: progress gradient (see 3.4)
- Paused: `--lilac` desaturated, bar at 60% opacity
- Queued: `--harbour`
- Complete: `--celadon`
- Warning (low disk, slow): `--ochre`
- Error / cancel / delete: `--vermilion` — the only hot colour; use it rarely so it reads like the sun in *Impression, Sunrise*
- Selection: `--pond-soft` at 14% opacity, no border

### 3.4 Progress gradient — "a day passing over a haystack"

Progress fill is a horizontal gradient that reads cool at the left and warm at the right, so a bar literally warms as it fills:

```
linear-gradient(90deg, var(--lilac) 0%, var(--pond-soft) 45%, var(--ochre) 100%)
```

Clip the gradient to the filled width (the gradient spans the full track, the fill reveals it). On completion, the fill cross-fades over 600ms to `--celadon` at 70% opacity and the track settles into the surface.

## 4. Surfaces and texture (procedural only)

1. **App background:** `--bg-canvas` plus 2–3 very large, very soft radial gradients (diameter ≥ 60% of the window, opacity 6–12%) in `--lilac`, `--pond-soft` and `--apricot`, positioned to suggest light falling from one side. They may drift extremely slowly (one full cycle ≥ 90 s) or stay static; test both.
2. **Grain:** a single SVG filter (`feTurbulence baseFrequency≈0.8, numOctaves 2`) composited over the background at 4–6% opacity in light theme, 6–8% in dark. This is the canvas weave. Apply once at the root, never per component.
3. **Cards:** `--surface` with a 1px `--line-soft` edge *or* a tonal step, not both; `--shadow-ambient` with 24–40px blur, 2–6px y-offset. No inner glow, no glassmorphism blur on content.
4. **Frosted layers** (sidebar, toolbar overlays): backdrop blur allowed only on chrome, 12–20px, with a `--surface` tint at 70–80%.
5. **Reflection motif:** under the speed chart and optionally under the active-download card, render a vertically mirrored, 8–14px-blurred, 15–25% opacity copy. This is the only place "water" is literal.
6. Absolutely no image textures, no photographic noise PNGs, no painted-stroke SVGs as decoration.

## 5. Typography

- Display / titles: a soft humanist serif with optical sizes — first choice **Fraunces** (use its soft/wonk axes modestly), alternatives Source Serif 4, Cormorant Garamond. Titles in `--text-primary`, weight 500–600, slightly tight tracking.
- UI and data: a quiet humanist sans — first choice **Instrument Sans**, alternatives IBM Plex Sans, Inter (only if nothing else is available). Tabular figures for sizes, speeds and ETAs.
- Scale (px): 11 / 12 / 13 / 15 / 18 / 24 / 32. Base UI text 13px, line-height 1.5.
- No pure black text anywhere; the heaviest text colour is `--text-primary`.
- No all-caps labels with wide tracking (too hard-edged); use sentence case and tone to differentiate.

## 6. Shape, spacing, elevation

- Radii: 6px controls, 10px cards, 14px panels, 999px pills for status chips. Nothing sharp, nothing fully round except chips and avatars.
- Spacing scale: 4 / 8 / 12 / 16 / 24 / 32 / 48. Be generous — Monet's water surfaces fill the frame; give the list room to breathe and keep density adjustable (comfortable / compact).
- No hard dividers between list rows. Rows separate by a 2% tonal zebra (`--surface-cool`) and hover tint.
- Elevation has three levels only: flat (background), card (ambient shadow), floating (ambient shadow ×1.6 + frosted tint).
- Focus ring: 2px `--pond` at 60% plus a 6px `--shadow-focus` halo, radius matching the element. Visible on keyboard focus always.

## 7. Motion

- Easing: slow and water-like. Default `cubic-bezier(0.22, 0.61, 0.36, 1)`, durations 220ms (micro), 360ms (panel), 600ms (state change). No spring/bounce, no overshoot.
- Progress bar: fill advances with a subtle 2–3% opacity shimmer sweeping left→right every 2.4s, like light on water. Disable under `prefers-reduced-motion`.
- Completion: fill cross-fades to `--celadon`, a 1px highlight ripples outward once from the bar (opacity 0.3 → 0, 700ms). No confetti, no checkmark pop.
- Hover: tonal lift (surface 3% lighter) + shadow blur increases; no scale transforms above 1.01.
- Transitions between themes: 800ms cross-fade of all tokens, so switching feels like the light changing, not the UI flipping.
- Background gradient drift (optional): ≤ 1px/s, cycle ≥ 90s; off under reduced motion.

## 8. Components specific to a download manager

Design and build at least these:

1. **Window chrome / sidebar:** frosted `--surface` tint, nav items with tonal hover, categories (All, Active, Completed, Failed, Scheduled) with small count chips in `--harbour`/`--rose`.
2. **Download list row:** filename (serif if ≥ 15px, otherwise sans), source domain in `--text-muted`, size and speed in tabular figures, the time-of-day progress bar, ETA, a pause/resume control that uses `--lilac` for paused state. Multi-select via `--pond-soft` 14% tint.
3. **Active-download detail card:** large progress bar, segment map (for multi-connection downloads) drawn as short horizontal dashes in `--pond-soft`/`--celadon` — this is the one place a "broken colour" dash field is appropriate, kept at low contrast.
4. **Speed graph:** area chart, stroke `--pond`, fill `--pond` → transparent, with the mirrored reflection beneath (section 4.5). Gridlines in `--line-soft` only.
5. **Add-download dialog:** URL field in `--surface-sunken`, destination picker, schedule option; primary button `--pond`.
6. **Toasts / status:** small pills, tinted by semantic colour at 18% with text in the full hue; never a solid red block.
7. **Empty state:** no illustration image. Use typography plus the background light fields; a single line in serif ("Nothing downloading. The pond is still.") — tone calm, not cute.
8. **Settings:** grouped panels with tonal separation, toggles whose "on" state is `--pond`, "off" is `--harbour`.
9. **App icon:** original, vector, procedural: an abstract lily-pad/ripple form in `--pond`, `--celadon` and `--rose` on a cream disc — no painting, no Monet signature, no resemblance to any specific canvas.

## 9. Accessibility

Monet's palette is naturally low-contrast, so enforce this explicitly:

- All body text ≥ 4.5:1 against its surface; large text ≥ 3:1. Check `--text-secondary` and `--text-muted` on every surface and adjust the hue, not the saturation, to pass.
- Never encode status by colour alone: pair with an icon or label (paused ‖, complete ✓, error ×).
- `prefers-reduced-motion`: disable shimmer, drift and ripple; keep cross-fades ≤ 200ms.
- `prefers-contrast: more`: raise `--line-soft` to 25% and text colours one step darker/lighter.
- Keyboard focus always visible (section 6).

## 10. Anti-patterns — reject on sight

- Any image of a Monet painting, cropped, blurred, pixelated or otherwise; any AI-generated "painting" background.
- Generic "aurora"/mesh-gradient hero blobs in saturated neon or purple-pink SaaS colours.
- Pure black or pure white anywhere; neutral grey shadows; 1px opaque grey borders.
- Hard-edged cards with sharp corners; Material-style elevation; iOS-style blur on everything.
- Bouncy springs, confetti, pop animations.
- Painterly brush-stroke SVGs, watercolour PNG textures, "canvas.jpg" backgrounds.
- Decorative gold, serif-everywhere "luxury" styling; this is calm and humid, not opulent.

## 11. Deliverables and process

1. First, write `DESIGN.md` restating sections 1–3 in your own words with any token changes you propose and why.
2. Produce the tokens as [CSS custom properties / a Tailwind theme / a SwiftUI theme struct — match the stack] with both themes and the semantic layer.
3. Build a single `preview` route/window that shows every component in section 8 in both themes, with a density toggle and a reduced-motion toggle.
4. Implement the procedural background and grain as one reusable component; prove it uses no raster assets.
5. Take screenshots of the preview in both themes and check them against section 1: if a screen would not be recognisably "Monet" with the painting references removed, revise the colour fields and texture, not the layout.
6. Run contrast checks on every text/surface pair and list the results.
7. Only then wire the components into the real download screens.

When in doubt, choose the softer edge, the cooler shadow, the warmer light.
