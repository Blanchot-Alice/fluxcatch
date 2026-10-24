# FluxCatch — Design Review and Corrective Spec (v1 → v2)

Audience: Claude Code. Owner: Andy.

Read this whole document before changing any code. It reviews the current build against the Monet brief (`monet-download-manager-design-brief.md`), states what failed and why, and sets the rules, audits and order of work for the next pass. Where it conflicts with the original brief, this document wins (see §9).

## 0. Scope and surfaces

FluxCatch is a Manifest V3 Chrome extension that saves media through a local engine. Five surfaces are in scope and must read as one product:

| Surface | Design and test viewport |
|---|---|
| Toolbar popup | 372 × ≤600 CSS px (Chrome caps popups at 800 × 600) |
| Side-panel workspace | 420 × 900 |
| Downloads page (full tab) | 1280 × 900 and 960 × 900 |
| Settings page (full tab) | 1280 × 900 and 960 × 900 |
| Component preview | 1440 × auto |

Every surface ships in Morning (light) and Dusk (dark). Test every screen at device-pixel-ratio 2.

## 1. Verdict

The palette survived; the design did not. You kept the colour tokens and never used an image of a painting. Keep both. Everything beyond tokens (structure, typography, alignment, hierarchy, copy) was improvised page by page, and the result is a generic admin-dashboard skeleton (cards, bands, pills, count chips) painted in Monet's colours.

The deepest failure is structural. Monet's most distinctive move in the late Water Lilies is one continuous surface: no horizon, no frame inside the frame. v1 inverts that into containers inside containers. Colour cannot rescue a structure that contradicts its source.

Part of this traces back to the original brief, which specified tokens and a component inventory but no grid, no type roles, no CJK fonts and no per-surface layouts, and which contained several bad rules (§9). You followed those faithfully. This document closes the gaps.

## 2. Findings

Evidence refers to the 18 review screenshots (each surface in Morning and Dusk).

### 2.1 Structure

- One file on the Downloads page sits four layers deep: canvas → tinted "Today" band → white card → 100 × 55 "VIDEO" block and "Completed" pill. Settings nests tinted status cells inside cards.
- Hard 1px rules run under every header (popup, side panel, Downloads, Settings), above the popup footer, and after every group label. The brief ruled out hard dividers.
- Each surface invents its own layout; popup, side panel, Downloads and Settings share no skeleton. Monet's series method is one motif under changing light; v1 is four different motifs.

### 2.2 Typography

- Five typefaces app-wide, four on the Downloads page alone: the serif (Fraunces), Instrument Sans, a monospace (URL field, save path), PingFang SC (system fallback for Chinese timestamps and the engine error), and Songti SC (fallback for Chinese headings in the component preview).
- The serif carries eight roles: wordmark, tagline, page title, section title, group label, filename, dialog title, empty state. A face that marks everything marks nothing.
- The brand lockup has three forms across four surfaces: serif name + serif tagline (popup); serif name + sans surface name (side panel, Downloads); serif eyebrow + oversized "FluxCatch Settings" + sans subtitle (Settings).
- Tracked uppercase labels ("VIDEO", "AUDIO", "HLS"), which the brief banned.
- Locale leak: English UI with Chinese relative times ("1 小时前", "昨天 21:42", "10月18日") and a raw Chinese engine error. Likely cause, unverified: date/time formatting reads the system locale while UI strings follow the extension's UI language. Confirm in code before fixing.

### 2.3 Grid and alignment

- Settings: logo, page title, side nav and content column each start at a different x, so the top half of the page has four left edges.
- Side panel: in "Current page", the "Rescan / Download settings" links sit about 9 CSS px right of the title above them; the engine card below starts its dot and its text at yet other x positions; the "0" count chip drops to its own line under "Download a link".
- One 420px panel mixes three alignment axes: left-aligned headings, centred empty states, right-aligned link clusters.
- Clipping: the "Download link" dialog's action row is cut by the popup's lower edge (content exceeds the 600px cap and the body does not scroll). The Settings sticky save bar covers half of "Change / Open folder / Downloads" (no scroll padding for the bar).
- Truncation: at 960px, "Lecture 12 · Pharmacokinetics.mp4" becomes "Pharmacokinetics....", losing the extension. In a download list the extension is essential; truncate in the middle.

### 2.4 Hierarchy and components

- The heaviest element in every row is a placeholder block carrying one word ("VIDEO"); it outweighs the filename.
- Every completed row says "Completed". In a history list completion is the default; only exceptions need a label.
- The core verb is the weakest control: on Downloads, "Download" beside the URL field is a grey secondary button and "New download" in the header is a text link.
- One action, four names: "Download", "Start download" (quoted in the hint beside a button labelled "Download"), "Continue & download", "Check & download".
- Row actions mix four treatments: tinted pill ("Open"), icon + text link ("Show in Finder"), icon-only (external link), overflow ("···").
- Status chips (Completed, Paused, Failed) and attribute tags (1080p, HLS, MP4) share one pill style, so state and metadata are indistinguishable.
- Segmented control: the selected segment is raised and lighter in Morning but sunken and darker in Dusk; in the Morning Jobs view the active segment is hard to identify. The "All" filter disappears on the Jobs tab, so the header recomposes when switching tabs.
- The popup footer gives equal weight to navigation (Workspace, Downloads, Folder) and a destructive action (Clear results).
- Minor: the "Current page" glyph (ring in a rounded square) reads as a radio button. Judgement call: at 32px the logo reads as a bird; revisit after v2.

### 2.5 Content

- The local-engine permission story is told at least five times: the side-panel engine card, the floating paragraph under it, the dialog helper line, the dialog info box, and the Downloads URL-bar hint (plus Settings).
- Developer vocabulary shown to users: "Chrome direct lane", "Runtime identity & capabilities", "capability profile", "local helper", "FFmpeg local processing", "View build & capability details", "This page provides no address".
- "3 file(s) saved" instead of real pluralisation. "GiB/MiB" while Finder reports decimal GB/MB, so sizes disagree with the user's system.
- Settings sections numbered "01", "02" imply a sequence that does not exist.
- "UI editor", a developer tool, sits in the Settings header.
- The component preview prints its own spec annotation ("frosted chrome · tonal nav hover · count chips in harbour and rose") as UI text.
- Volume is itself a typography problem: every helper paragraph adds another grey size and weight to the screen.

### 2.6 Dusk theme

- Cards nearly merge with the canvas (side panel especially). "UI editor" and the save path are close to invisible; "Clear history" is dim; the "AUDIO" block turns muddy brown-grey. The dim path suggests a light-theme colour hard-coded into Dusk; check.
- Monet does use equiluminance. Margaret Livingstone (*Vision and Art*, 2002) showed that the sun in *Impression, Sunrise* has almost the same luminance as the sky around it, which is why it seems to shimmer; in greyscale it nearly vanishes. That device belongs to atmosphere, never to text or controls. v1 applied it exactly where it must not go.

### 2.7 Monet devices misapplied (several originate in the brief)

- The segment map is a row of identical, evenly spaced dashes and reads as a skeleton loader or Morse code. Monet's touches vary in length, angle, hue and value; regularity is the opposite of broken colour.
- The progress gradient spans the full track: at 62% the visible fill runs lilac → grey-blue → grey-green, because sRGB interpolation between pond and ochre passes through grey, and the warm end appears only near 100%.
- The reflection under the speed chart duplicates the line as a faint smudge and carries no information.

## 3. Principles for v2: translate Monet's structure, not only his colour

- **P1 One pond per view.** Content sits directly on the canvas. Containers exist only for dialogs, menus, popovers, toasts, and at most one focus panel per view (the active download). A container never sits inside another container.
- **P2 Series.** Every surface shares one skeleton: top bar (BrandMark left, at most two icon buttons right), optional page title, one content column. Morning and Dusk are two hours of the same scene; only the light changes, never the layout.
- **P3 Colour is light, not object.** State shows as an 8px dot plus a word, or a low tint on hover and selection. No large coloured blocks.
- **P4 Broken colour lives in the background.** A procedural layer of irregular, equiluminant touches (§6.10) appears in empty space. Text and controls always keep value contrast.
- **P5 Decentred, left-anchored composition**, the way Monet's views absorbed the Japanese woodblock prints he collected. No centred stacks; keep generous negative space on the right.
- **P6 Soft separation.** Separate with spacing and value steps, never 1px rules. The top bar separates from content with a scroll-triggered mist (`box-shadow: 0 10px 18px -14px rgba(78, 70, 130, .22)`), absent at scroll position 0.

## 4. Typography system (replaces brief §5)

Families:

- Display: `"Fraunces", "Noto Serif SC", "Songti SC", serif`. Bundle Noto Serif SC as a build-time subset containing only the glyphs of fixed display strings (page titles, empty-state sentences) in zh-CN. Dynamic content never uses Display, so the subset is safe.
- Text: `"Instrument Sans", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", sans-serif`.
- No monospace in default views.
- Bundle every font with the extension; never request Google Fonts or any remote font (the product is privacy-first).

Roles, in CSS px. These are the only text styles allowed:

| Role | Family | Size / line | Weight | Colour | Allowed on |
|---|---|---|---|---|---|
| wordmark | Display | 17 / 20 | 600 | text-primary | BrandMark component only |
| display | Display | 28 / 34 | 500 | text-primary | Page title of full pages (Downloads, Settings) |
| empty | Display | 19 / 26 | 400 | text-primary | The one sentence of an empty state |
| title | Text | 15 / 22 | 600 | text-primary | Section and dialog titles |
| row | Text | 13 / 20 | 500 | text-primary | Filenames, setting names, button labels |
| body | Text | 13 / 20 | 400 | text-secondary | Descriptions, input text |
| meta | Text | 12 / 18 | 400 | text-muted, tabular-nums | Sizes, durations, times, sources |
| label | Text | 12 / 16 | 600 | text-secondary | Group labels, form labels |

Rules:

- Display appears at most twice per screen. Filenames always use `row`.
- No tracked uppercase, no italics, no letter-spacing changes for Latin, none at all for CJK.
- Under `:lang(zh)`, add 2px line-height to `row`, `body` and `meta`.
- One `BrandMark` component (logo + "FluxCatch", sizes S and M) on every surface, with no subtitle inside it. If the tagline stays, it appears in exactly one place (popup empty state or About).
- Sizes in decimal units through `Intl.NumberFormat` (unit `megabyte` / `gigabyte`); durations and counts tabular.

## 5. Grid and spacing

- Base 4px; layout steps 8 / 12 / 16 / 24 / 32 / 48.
- Popup (372): outer gutter 16, lead column 32, gap 12, so text starts at x = 60.
- Side panel (420): outer gutter 20, lead column 32, gap 12, so text starts at x = 64.
- Full pages: content column max-width 880, centred; outer gutter 32; lead column 56; gap 16.
- Settings: nav column 200, gap 48, content column at most 680. The page title shares the nav's left edge.
- Edge budget: at most three left edges for text per surface (outer edge, text column, one indent for nested detail). Trailing items share one right edge.
- Every text block is left-aligned, empty states included; they sit in the upper third, on the text column.
- Rows: 12px vertical padding (comfortable), 8px (compact). Groups: 24px above the label, 8px below.

## 6. Components (consolidated)

**6.1 Buttons.** Four kinds only: primary (filled `--pond`, one per view), secondary (`--pond` at 12% tint), tertiary (text in `--pond`), destructive (text in `--vermilion`, always confirmed). Heights 32 (compact) and 36. Icon buttons 32 × 32 with a tooltip. Every button gets tactile feedback: on press, background one value step down plus a soft inset shadow over 90ms; release over 160ms; no scale bounce.

**6.2 Inputs.** One style: tonal fill one value step below its surface, no border at rest, soft focus halo. In Dusk the fill is one step below the surface, never near-black. A 1px inset line appears only under `prefers-contrast: more`.

**6.3 Segmented control.** Selected segment = raised surface + text-primary in both themes; track = sunken. Width and neighbours never change between tabs; the filter menu stays and is disabled when there is nothing to filter. Count chips are hidden at 0.

**6.4 Download row.**

- Lead: on full pages, a real poster frame of the user's own media (56 × 32, radius 6) when available; otherwise a 20px type glyph (video, audio, stream) in text-muted. No text blocks.
- Title: the filename in `row`, middle-truncated so the extension survives.
- Meta line: "MP4 · 2160p · 2.2 GB · 2:28".
- Source line: "youtube.com · 1 hr ago", in the UI's locale.
- Trailing status only for exceptions: in progress, paused, queued, failed, cancelled. Completed rows show none.
- Actions: "Open" (tertiary) + overflow (Show in Finder, Open source page, Copy link, Remove from history), visible on hover, on focus-within and on the selected row.
- Failed rows: vermilion dot + "Failed"; the reason as a meta line ("Source refused segment 12 (HTTP 403) after 3 retries"); a "Retry" tertiary action.

**6.5 Group label.** `label` style. No band, no rule.

**6.6 Status.** 8px dot + word in the status colour's text variant (each variant at least 4.5:1 on its surface). Attributes (format, resolution) are plain meta text, never chips.

**6.7 Progress.** Single-tone fill: `background: color-mix(in oklch, var(--lilac), var(--ochre) calc(var(--p) * 1%))`, where `--p` runs 0–100 (Chrome 111+). A 24px radial highlight in `--surface` at 40% sits at the fill's tip. On completion the fill crossfades to `--celadon` over 600ms; after 1.2s the bar fades out and the row takes its history form. Height 3px in rows, 6px in the focus panel. Shimmer at most 3% opacity, off under reduced motion. Track = one value step below the surface, no colour.

**6.8 Segment map and speed graph.** Only inside the active-download focus panel, behind a "Details" disclosure. Segment map: one bar divided by 2px gaps, each segment filled to its own level in the progress colour. Speed graph: the line plus "Now 56.3 MB/s · Peak 61.0 MB/s" as meta text. No reflection.

**6.9 Toast.** Dot + text on the raised surface, bottom-left, 4s. No coloured pills.

**6.10 Pond layer (P4).** Rendered once per session to an offscreen canvas and used as a background image. It is procedural; no image asset ships.

- 150–250 touches, each an elongated ellipse 6–18px long and 2–5px wide, angled 0° ± 12° (horizontal, like water), positions jittered over a low-frequency noise field.
- Hues from pond-soft, lilac, celadon, rose and apricot, each moved to the canvas's OKLCH lightness ± 0.02 (equiluminant), chroma 0.03–0.07, opacity 0.35–0.55, blur 0.6px.
- Seeded per install, so it is stable across sessions. Morning and Dusk each generate their own layer from their own tokens.
- Visible behind empty states and in page margins outside the content column; masked to 0 under lists and forms.
- Acceptance: visible as colour in a normal screenshot, and gone in a greyscale screenshot. It carries hue, never value.

**6.11 Empty state.** One `empty` sentence, one `body` line, at most one action; left-anchored on the text column in the upper third, with the pond layer around it.

**6.12 Dialogs in the popup.** Must fit 372 × 600: the body scrolls, the action row is sticky with 16px padding. Removing the duplicated helper copy (§7) should let "Download link" fit without scrolling.

**6.13 Settings.** No section numbers. The nav marks the active item (tonal pill + text-primary). Each setting is one row: name, one-line description, control. Autosave each control with an inline "Saved" confirmation and remove the sticky save bar; if a setting truly needs confirmation, keep a bar and add `scroll-padding-bottom` equal to its height + 24px. The runtime status grid becomes plain rows ("Local engine · Not set up · Set up").

**6.14 Popup layout.** Top bar: BrandMark S left; right, a "Download a link" icon button and Settings. Rescan lives in the body: primary in the empty state, tertiary in the list header once results exist. Footer: "Open workspace" and "All downloads" as tertiary links only. "Clear results" appears beside the list header, and only when there are results. "Folder" moves to the Downloads page.

**6.15 Downloads page layout.** Top bar: BrandMark M and Settings. Title "Downloads" plus a meta summary ("3 files · 3.0 GB"). URL field with a primary "Download" button; remove "New download" from the header. Filter control and search on one row; "Clear history" inside an overflow at the end of that row. Groups and rows per §6.4–6.5.

## 7. Content rules

- One verb per action, everywhere: Download (start), Retry, Open, Show in Finder (macOS) / Show in folder (other systems), Set up (local-engine permission), Cancel.
- Explain the local engine once, in Settings → Local engine. Elsewhere show a one-line status with a "Set up" action.
- Rewrite status copy in plain language ("This page provides no address" → "No downloadable media on this page yet").
- Before renaming developer terms, produce a rename table (current term → proposed term → what it means to the user) and wait for Andy's approval.
- Helper text: at most one line under a control; anything longer goes into a disclosure.
- Pluralise with `Intl.PluralRules`; never "(s)".
- One locale source for UI strings and every `Intl` formatter. "Auto" follows Chrome's UI language (`chrome.i18n.getUILanguage()`). Engine errors travel as codes plus parameters and are localised in the UI; raw engine text is never displayed.
- Developer tools (UI editor, build & capability details) move to Lab → Developer, off by default.
- The component preview never prints spec annotations as UI text.

## 8. Value ladders

Guide values in OKLCH lightness. Keep each token's hue and chroma from the brief, adjust lightness only, and verify every text/background pair by computed contrast.

- Morning: sunken 0.935 · canvas 0.955 · surface 0.975 · raised 0.995 · text-primary 0.31 · text-secondary 0.45 · text-muted 0.52.
- Dusk: sunken 0.215 · canvas 0.25 · surface 0.29 · raised 0.33 · text-primary 0.93 · text-secondary 0.80 · text-muted 0.70.

Adjacent surface steps differ by ΔL ≥ 0.02 in Morning and ≥ 0.035 in Dusk, so containers read without shadows. Status text variants are lightened in Dusk until they pass 4.5:1.

## 9. Errata to the original brief

1. §8 "filename (serif if ≥ 15px, otherwise sans)": deleted. Filenames always use `row`.
2. §8 "segment map drawn as short horizontal dashes … broken-colour dash field": deleted. See §6.8.
3. §3.4 progress gradient spanning the full track: replaced by §6.7.
4. §4.5 reflection under the speed chart and active card: deleted. Water appears only as the pond layer (§6.10).
5. §5 "Display / titles: serif": replaced by the roles table in §4.
6. §8 component list written for a desktop window (sidebar, window chrome): replaced by §0 and §6.14–6.15.
7. §3 `--text-muted` fails contrast: #8B8FA8 on #F4F0E9 is about 2.8:1; #8186A4 on #252B4D is about 3.8:1. Re-derive both from §8.
8. "No hard dividers" and "no tracked caps" stand, and are now enforced by the audit.

## 10. Order of work and acceptance

1. Freeze feature work until step 6 is accepted.
2. Write `scripts/design-audit` (Playwright or Puppeteer, loading the unpacked extension). It opens every surface in both themes at the §0 viewports, DPR 2, and reports:
   - a. distinct text styles (family stack, size, weight, line-height): at most 6 per screen and 8 app-wide;
   - b. distinct left x positions of text boxes per surface: at most 3;
   - c. container nesting, meaning an element with its own background, border or shadow inside another such element (controls and indicators excepted): 0;
   - d. contrast of every text node against its effective background: at least 4.5:1, or 3:1 at ≥ 24px or ≥ 18.66px bold;
   - e. elements clipped by a scroll container or covered by fixed or sticky elements: 0;
   - f. locale leaks: CJK characters in UI strings when the UI language is English (user content such as filenames excluded), or Latin UI strings when it is Chinese: 0;
   - g. 1px solid borders or rules (inputs under `prefers-contrast: more` excepted): 0;
   - h. colour literals outside the token file: 0.

   Run it on the current build first and keep the report as the v1 baseline.
3. Implement §4, §5 and §8 as tokens. Build BrandMark, Button, Input, SegmentedControl, DownloadRow, GroupLabel, Status, Progress, EmptyState and PondLayer.
4. Rebuild the Downloads page only. Run the audit and capture Morning and Dusk at 1280 and 960. **Stop.** Send Andy the screenshots, the audit report and the rename table, and wait for approval.
5. After approval, apply the same system to the popup, side panel, dialog, Settings and component preview.
6. Re-run the audit with every budget met, and deliver before/after screenshots side by side for every surface and theme.

## 11. Do not

- Add features during this pass.
- Add helper paragraphs to explain behaviour. Fix the behaviour, or move the explanation to Settings.
- Use tracked caps, italics, or monospace in default views.
- Put a second primary button in a view.
- Introduce colours, shadows or radii outside the tokens.
- Use any image of a painting or any painterly image asset. Thumbnails of the user's own media are content and are allowed.

When in doubt: fewer containers, fewer styles, one edge.
