# FluxCatch — Design Review v3.1: the mark, and section dividers in Settings

Audience: Claude Code. Owner: Andy. Date: 2026-10-24. Reviewed: the v3-step4 atlas (130 pages, after-captures of 2026-10-24 05:27 UTC).

This addendum sits on top of `fluxcatch-design-review-v3.md`. It changes two things: the app icon is replaced, and the Settings page gets a visible divider between sections. §3 lists the errata to the earlier reviews that these two changes require. Nothing else in v3 changes.

Companion files, in `docs/design-review/icon-candidates/`: `build.py` (the generator; needs Python 3 with Playwright and Pillow), `icon-and-divider-sheet.png` (every candidate at 128/48/32/16 on Chrome's light and dark toolbars and on both canvases, plus the divider mock), and for each candidate `fluxcatch-<name>.svg` (the 128 mark), `fluxcatch-<name>-16.svg` (the dedicated 16 px mark), and rasterised `-128.png` / `-16.png`.

## 1. The mark

### 1.1 Why the current mark goes

Evidence: `extension/icons/fluxcatch-mark.svg`, atlas pp. 3–12 (popup and side-panel headers), the sheet's row 0.

- The pad is a disc with a wedge cut out. At every size it reads as a bitten circle or a pie chart, not as a leaf. The notch is the only "drawn" shape in the whole product, and it is a cartoon shape.
- The composition is a clip-art assembly: one object, one ring, two swooshes, one dot. Nothing in it comes from the system the interface now uses (drifts of soft touches on a tonal ground); it comes from the v1 brief's one-line icon description, which was written before the system existed.
- The cream disc with a blue ring vanishes on Chrome's light toolbar and reads as a white button on the dark one. The mark needs its own ground.
- The 16 px variant already had to drop half the elements, which says the construction does not scale.

### 1.2 The three candidates

All three are original vector marks built only from the Morning tokens; none references a painting. Each has a 128 mark and a separate, simplified 16 px mark. All sit on a filled disc so they hold on light and dark toolbars alike.

- **A · Drift.** The pond layer in miniature: three drifts of soft dabs (lilac, celadon, rose and apricot) on morning-lit water, with a few pale glints. The mark and the interface share one vocabulary. Risk: at 48 and below it can read as scattered confetti.
- **B · Haze.** Dawn over water as a single tonal field, cream to lilac to pond, with two bands of mist and one celadon touch. The quietest; it reads as light rather than as an object. Risk: at 16 px it is a gradient disc and could be mistaken for a weather or wallpaper app.
- **C · Waterline.** Morning sky above, pond below, a hazed horizon; one celadon touch sits on the line and its colours loosen downward as reflections. The most Monet of the three (sky, water, the thing on the surface, its reflection), and the most legible at 16 px (a two-tone disc with one touch on the line is unmistakable at that size). This is the recommended mark.

Andy chooses. The instructions below are written for C; substitute the letter if he picks A or B.

### 1.3 Installation

1. Replace `extension/icons/fluxcatch-mark.svg` with `docs/design-review/icon-candidates/fluxcatch-c-waterline.svg` and `extension/icons/fluxcatch-mark-16.svg` with `fluxcatch-c-waterline-16.svg`. Keep the file names the code expects.
2. Regenerate `icon16.png` from the 16 mark and `icon32.png`, `icon48.png`, `icon128.png` from the 128 mark, with headless Chromium (the SVGs use `feGaussianBlur` filters, so rasterise with a browser engine, not with a library that drops filters). Rasterise at exact size, no post-scaling.
3. The in-app BrandMark (popup, side panel, Downloads, Settings) uses the 128 mark at its S and M sizes; check it at 20–24 px against the Morning and Dusk canvases. If it reads too soft there, use the 16 mark for sizes under 24 px.
4. The toolbar badge colours in `tokens.js` are unchanged.
5. Capture: the four toolbar/canvas contexts at 128/48/32/16 in the atlas format, and the popup header in both themes.

## 2. Section dividers in Settings

### 2.1 What changes

Evidence: atlas pp. 70–85 (Settings, both themes). The ten sections are separated by 48 px of space and a 15 px title. On a 3 300 px page with ten similar-looking groups of rows, space alone does not mark where one subject ends and the next begins; the eye has to read the titles to find the boundaries.

Each pair of adjacent sections gets a hairline between them. It is the one place in the product where a rule is allowed, and it is constructed so that it reads as a mist line on water rather than as a border.

### 2.2 Construction

- Element: an `<hr class="section-rule">` emitted by the sections builder between consecutive sections — never before the first section, never after the last, never inside a section, never in the nav column.
- Geometry: height 1 px; width = the content column (from the text column's left edge to the trailing items' right edge); `margin: 28px 0 24px`. The section's own `padding-top` drops to 0 when a rule precedes it, so the rhythm is: last row → 28 px → rule → 24 px → section title. (Total 53 px versus the current 48 px.)
- Colour: a translucent cool tint that fades over the outer 10 % at each end:
  `background: linear-gradient(90deg, transparent 0, var(--rule-section) 10%, var(--rule-section) 90%, transparent 100%)`.
- Tokens, in `tokens.css`: Morning `--rule-section: rgba(43, 46, 74, 0.22)`; Dusk `--rule-section: rgba(239, 233, 224, 0.18)`. Under `prefers-contrast: more`: 0.36 and 0.30.
- No border property anywhere; the rule is a background on a 1 px element. No box-shadow, no inset.
- 960 and 390 widths: the rule keeps its margins and spans the column at that width.
- Keyboard and screen readers: `<hr>` is the correct semantic; leave it in the accessibility tree.

The mock at the foot of `icon-and-divider-sheet.png` shows the rule between three sections in both themes.

### 2.3 Scope

Settings only. The popup, side panel and Downloads page keep spacing-only separation; their groups are short and already read. If Andy later asks for the same rule elsewhere, reuse `.section-rule` unchanged.

## 3. Errata

1. v1→v2 §P6 ("Separate with spacing and value steps, never 1px rules") and §6.5: amended. One rule component, `.section-rule` as specified in §2.2, is allowed between top-level sections of the Settings page.
2. v1→v2 §10 audit check **g** ("1px solid borders or rules: 0"): exempt `hr.section-rule`. Keep the budget at 0 for everything else, so the exemption cannot spread.
3. v1 brief §8.9 and v3 §3.10 (the lily-pad mark and its 16 px variant): replaced by §1 of this document.
4. v1→v2 §4 BrandMark: unchanged in construction; it now carries the new mark.

## 4. Order of work

1. Install the chosen mark (§1.3) and the Settings rule (§2.2); update the audit exemption (§3.2).
2. Run the audit on Settings at 1280 and 960 and on the popup; confirm every budget still holds with g = 0 outside the exemption.
3. Capture: Settings whole page in both themes at 1280 (before/after), the Settings first screen at 960, the popup header in both themes, and the icon contexts from §1.3 step 5. Write `docs/design-review/step-v3-1-mark-and-rules.md` in the bilingual step format.
4. Stop and wait for approval. Do not commit.

## 5. Do not

- Redraw, simplify or "improve" the chosen mark. If a size reads badly, report it with a capture and wait.
- Add rules anywhere other than between Settings sections, or add borders to rows, fields or cards on the strength of this change.
- Rasterise the icons with a tool that ignores SVG filters.
