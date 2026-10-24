# FluxCatch UI v2: API reference

The shared design system for every surface: popup, side panel, Downloads,
Settings, component preview, and worker-built text. It implements the design
review (`fluxcatch-design-review.md`, sections 3 to 7; kept outside this
repository by the project owner, so the rules it sets are restated below) and
the approved rename table (`docs/design-review/rename-table.md`). The Downloads page
(`extension/downloads/`) is the reference implementation.

Vanilla ES modules and CSS, no build step. Builders return DOM nodes and emit only
classes defined in `system.css`. Nothing here keeps page state.

## Files and load order

```html
<html lang="zh-CN" data-surface="popup" data-density="compact">  <!-- see Surfaces -->
<link rel="stylesheet" href="../ui/v2/tokens.css">   <!-- 1. tokens: the only colour literals -->
<link rel="stylesheet" href="../ui/v2/system.css">   <!-- 2. base, type roles, all shared components -->
<link rel="stylesheet" href="../ui/v2/media.css">    <!-- popup, side panel and preview only: media rows and lists -->
<link rel="stylesheet" href="popup.css">             <!-- 3. the page's own layout only -->
```

| Module | What it holds |
|---|---|
| `tokens.css` | Value ladders (Morning, Dusk), hues and their text variants, type roles, grid, surface grids, density, shape, motion |
| `tokens.js` | A DOM-free mirror of three Morning tokens for the worker's toolbar badge (see tokens.js below) |
| `system.css` | Base, `.t-*` roles, grid helpers, every component's styles |
| `media.css` | What the popup and side panel add on top: the list-header overflow, a busy media row, the list widths |
| `messages.js` + `messages/*.js` | All copy, both languages; `msg()` |
| `locale.js` | The one locale source; Intl formatters |
| `components.js` | Icons, BrandMark, buttons, status, progress, filename, group label, menus, toasts, status line, list header, empty state, `runAction` |
| `controls.js` | Select, switch, text and number fields, field stack, setting row and Saved, nav, dialog shell, segmented control |
| `rows.js` | DownloadRow: generic, history and live rows, the focus panel, segment map, speed chart |
| `errors.js` | `errorText()`: the one UI error helper |
| `runtime.js` | `callWorker()` and `connectWorkerPort()`: messaging with the background worker |
| `jobs.js` | Job ordering, terminal states, the speed-sample ring and the finished-file actions (no DOM) |
| `media.js` | Popup and side panel: detected media rows, the Download dialog, the engine status line, the downloads list, the pure media helpers |
| `pond.js` | The procedural pond layer (design review v3 §3.1) |

Outside this folder, `extension/lib/format.js` holds the decimal byte and rate
formatting that `locale.js` and the worker share, and `extension/lib/job-failure.js`
the failure codes and their sentences.

## Rules the design audit enforces

- Type: only the 8 roles below, through the `.t-*` classes. At most 6 text styles per screen, Display (`t-display`, `t-empty`) at most twice per screen. Filenames always use `t-row`.
- At most 3 left text edges per surface: the outer edge, the text column, one indent.
- No element with its own background, border or shadow inside another such element. Controls and indicators are exempt (button, input, select, textarea, summary, `a[href]`, `[role=switch|tab|...]`, `.segmented`, `.switch`, `.progress`, `[data-indicator]`, `dialog > form`). A `.field` box counts as part of its control: see Fields in containers.
- Text contrast at least 4.5:1 in Morning and Dusk; non-text control boundaries at least 3:1.
- No 1px borders or rules (an inset 1px line on inputs under `prefers-contrast: more` only).
- No colour literals outside the token files `tokens.css` and `tokens.js`. Use tokens and `color-mix()` of tokens.
- No tracked caps, no italics, no monospace.
- One primary button per view.
- No helper paragraphs: at most one line under a control. The local engine is explained once, in Settings; elsewhere use the status line "Local engine isn’t set up · Set up".
- No CJK in HTML or JS outside the `zh` tables of `messages/*.js`; HTML carries `data-msg` attributes, never copy.
- No `innerHTML` in surface code (only `components.js` writes fixed icon paths).
- The pond layer sits under no text: every text run lies inside one of the page's content boxes (its `getContentBoxes` list), so the mask clears the layer there. The audit reads the layer's pixels under each text run, measures contrast against that composited background, and fails any run with pond alpha over 0.02 under it. On full pages with gutters of 48 px or more the margins must carry chroma coverage 3% to 12% (ΔC > 0.015 in OKLCH) at p95 |ΔL| ≤ 0.03 Morning / 0.05 Dusk (v3 §3.1).
- At scroll position 0 the `.topbar` is the canvas: its own background alpha 0, no box-shadow, `::before` band at opacity 0 (v3 §3.6).

## Type roles

| Class | Family | Size / line | Weight | Colour | Use |
|---|---|---|---|---|---|
| `t-wordmark` | Display | 17/20 | 600 | text-primary | BrandMark only |
| `t-display` | Display | 28/34 | 500 | text-primary | Page title of Downloads and Settings |
| `t-empty` | Display | 19/26 | 400 | text-primary | The one sentence of an empty state |
| `t-title` | Text | 15/22 | 600 | text-primary | Section, list and dialog titles |
| `t-row` | Text | 13/20 | 500 | text-primary | Filenames, setting names, nav items |
| `t-body` | Text | 13/20 | 400 | text-secondary | Descriptions, input text |
| `t-meta` | Text | 12/18 | 400 | text-muted, tabular | Sizes, times, sources, counts |
| `t-label` | Text | 12/16 | 600 | text-secondary | Group labels, form labels |

Under `:lang(zh)` row, body and meta get 2px more line height. Display strings
must be fixed strings listed in a module's `display` (see Messages).

## Surfaces, grid and density

Set `data-surface` on `<html>` (or `<body>`). Text starts at gutter + lead + lead-gap.

| Surface | Attribute | `--gutter` | `--lead` | `--lead-gap` | Text at | Other |
|---|---|---|---|---|---|---|
| Downloads (full page) | none | 32 | 56 | 16 | column + 72 | `--column-max` 880, centred |
| Popup (372 × ≤600) | `data-surface="popup"` | 16 | 32 | 12 | x = 60 | |
| Side panel (420) | `data-surface="sidepanel"` | 20 | 32 | 12 | x = 64 | |
| Settings (full page) | `data-surface="settings"` | 32 | 56 | 16 | | `--column-max` 880 as on Downloads (the BrandMark stays put across full pages); `--nav-width` 200, `--nav-gap` 48, content at most `--content-max` 680 (632 in the 880 column) |

Grid helpers (system.css): `.column` (the centred content column, width
`min(--column-max, 100% − 2 × --gutter)`), `.lead-grid` (lead · text · trailing),
`.text-column` (padding to the text column), `.nav-layout` (Settings: nav · content).
In Settings, put the page title (`h1.t-display`) on the nav's left edge (the
`.column` edge, no `.text-column`), the nav in the first `.nav-layout` cell and the
setting rows in the second. Edge budget: column edge (title, nav items), the
wordmark (column + 72 in the top bar), the content column. That is all three,
so nothing inside the content column may indent: no `.text-column` or
`.lead-grid` helpers there (`groupLabel`, `listHeader`, `emptyState`,
`statusLine`, rows); headings are plain `h2.t-title` on the content edge and the
engine status is a `settingRow` ("Local engine" · "Not set up" · Set up).
Settings already uses six styles (wordmark, display, title, row, body, meta), so
it has no `t-label`. The BrandMark lays its logo into the lead column and its
wordmark onto the text column, so the top bar must be a `.lead-grid`; put its
trailing icon buttons (at most two, e.g. the popup's "Download a link" and
Settings) in one `span.bar-actions`, since the grid has one trailing cell.
`.bar-actions` (and a lone `.topbar-inner > .icon-button`) pulls 8px into the
gutter, so the last glyph ends on the column's right edge like the row overflow.

Density: `data-density="compact"` (on the root or one list) sets `--row-pad` 8
(instead of 12) and `--control-height` 32 (instead of 36). Use compact in the
popup; comfortable elsewhere unless a list needs it. Groups: 24 above a label, 8 below (`--group-above`, `--group-below`).

Poster frames (56 × 32 thumbnails) appear on full pages only. In the popup and
side panel pass `poster: false` to row builders; the lead is then a 20px glyph
in a 32px lead column.

Other tokens: `--space-1..12` (4, 8, 12, 16, 24, 32, 48), `--r-control` 6,
`--r-panel` 10, `--r-float` 12, `--control-height` 36, `--control-height-compact`
32, `--icon-button` 32, `--field-short` 112, `--field-medium` 240,
`--dialog-width` 400, `--shadow-float`, `--mist`, `--press-inset`, `--scrim`, tints
`--tint-pond`, `--tint-hover`, `--tint-selected`, `--tint-vermilion`, motion
`--ease`, `--t-press` 90ms, `--t-release` 160ms, `--t-micro` 220ms, `--t-state` 600ms.
Themes: Morning by default and `[data-theme="morning"]`; Dusk with
`[data-theme="dusk"]` or the dark colour scheme. Reduced motion: system.css
applies the same rules for `prefers-reduced-motion: reduce` and for
`:root[data-motion="reduced"]` (a page's own switch, e.g. the preview's
`?motion=reduced`).

## Messages

Ownership convention: one module per surface under `messages/`, each
`export default { en: {...}, zh: {...}, display: [keys] }` with identical key
sets in `en` and `zh`. A surface edits only its own module and only keys with
its prefix:

| Module | Prefixes | Owner |
|---|---|---|
| `common.js` | `brand.` `action.` `status.` `job.` `toast.` `group.` `time.` | shared; add keys only when two surfaces need them |
| `downloads.js` | `downloads.` | Downloads page |
| `media.js` | `media.` | popup and side panel (detected media, media dialog) |
| `popup.js` | `popup.` | popup |
| `sidepanel.js` | `sidepanel.` | side panel |
| `settings.js` | `settings.` | Settings |
| `preview.js` | `preview.` | component preview |
| `worker.js` | `worker.` | background worker (notifications) |

`messages.js` merges them and **throws at load** if two modules define the same
key. Tests also enforce the prefixes, parity, and no locale leaks (no CJK in `en`,
no stray Latin in `zh` except FluxCatch, Finder, Mac, Chrome, http(s), GB, MB).
Pluralise with `plural()` and format numbers with `formatCount()`; never "(s)".

- `msg(key, params = {})` → string in the UI language; falls back to English, then to the key itself. Entries are strings or `(params) => string`.
- `MESSAGES` → `{ en, zh }`, frozen merged tables.
- `DISPLAY_KEYS` → every module's `display`, merged. `scripts/build-display-font.mjs` imports it; after adding a Display string, rebuild the Noto Serif SC subset and commit `extension/ui/fonts/NotoSerifSC-display.{woff2,txt}`. Display entries must be fixed strings.
- `MODULES` → the modules by name; `mergeModules(modules)` → `{ en, zh, display }` (throws on duplicates).

Shared keys worth knowing: `action.download | open | retry | cancel | close |
setUp | showInFinder | openSource | copyLink | more | moreFor({name}) | details |
settings`, `status.engineNotSetUp` ("Local engine isn’t set up"), `status.saved`,
`status.*` for job states, `job.*` for live lines, `toast.genericError`,
`toast.engineNeeded`, `group.today | yesterday | week | earlier | active`,
`time.justNow` ("just now" / 刚刚, used by `formatRelativeTime` under a minute).
Stopping a running download has one verb: Cancel on the row, "Cancel this
download? · Keep / Cancel download" in place, "Download cancelled" after.

The worker reads `messages/worker.js` directly through its own `workerText()`;
it loads neither `messages.js`, `locale.js` nor any other page-side module. It
resolves the language exactly as `locale.js` does (the stored preference under
`UI_LANGUAGE_STORAGE_KEY`; Auto follows `chrome.i18n.getUILanguage()`) and
follows a switch at once. See "Worker notes" below.

## locale.js

The one locale source (review §7) and the owner of the language preference.

- `bootLocale({ storage, onChanged })` → resolves the stored preference (Auto follows `chrome.i18n.getUILanguage()`), sets `<html lang>`, keeps it live. Await it before first render.
- `onLocaleChange(listener)` → re-render on a language switch; returns an unsubscribe function.
- `uiLanguage()` → `"en" | "zh"`; `uiLocale()` → BCP 47 tag for Intl.
- The preference (Settings → Language): `UI_LANGUAGE_STORAGE_KEY` (`"fluxcatch.uiLanguage.v1"` in `chrome.storage.local`, unchanged from v1), `loadUiLanguage(storage)` → `"auto" | "en" | "zh"`, `saveUiLanguage(pref, storage)` → the normalised value it stored (every open page follows through `bootLocale`'s listener), `resolveUiLanguage(pref, chromeLanguage)` → `"en" | "zh"` (Auto: Chinese for a `zh*` Chrome, English otherwise), `getUiLanguage()` / `setUiLanguage(language)` for the language in force (tests set it directly).
- `formatBytes(n)`, `formatRate(n)` (decimal units, like Finder; `lib/format.js` with `uiLocale()`), `formatDuration(s)` ("2:28"), `formatCount(n)`, `formatRelativeTime(ts, now)` ("just now" under a minute, then Intl; Chinese minute, hour and day forms get a space around the numeral, "5 分钟前", like the rest of the Chinese copy), `dayGroupOf(ts, now)` → `today | yesterday | week | earlier`, `plural(count, { one, other })`.

## lib/format.js

`formatBytes(bytes, locale)` and `formatRate(bytesPerSecond, locale)`: decimal
units (1 GB = 10⁹ bytes) with Intl unit formatting in the given BCP 47 locale,
one decimal below 100 ("2.4 GB", "48.3 MB", "812 MB"), "" for zero, negative or
invalid input. DOM-free: `locale.js` wraps it with `uiLocale()`, and the worker
calls it with its own locale for notifications and quality labels.
`tests/worker-i18n.test.js` keeps the two in parity in en-US, en-GB and zh-CN.

## errors.js and runtime.js

- `callWorker(message)` → resolves `{ ok: true, ... }`; on `{ ok: false }` throws `workerError(response)`: an `Error(response.error)` that keeps `code`, `params` and `jobId` when the worker sends them.
- `connectWorkerPort({ name, onMessage, onReconnect, onLost, delays = [300, 1000, 3000] })` → the page's broadcast port (`"fluxcatch-popup"`, `"fluxcatch-sidepanel"`, `"fluxcatch-downloads"`). Call it before anything awaits. An MV3 worker that goes idle drops its ports although nothing is wrong: the page reconnects after each delay in turn (which wakes the worker), then calls `onReconnect()` to resync what it missed (resolve `false` when the worker did not answer; that counts as a failed attempt). A successful resync resets the backoff. One live port at a time, so no broadcast arrives twice. `onLost()` runs once, only when connecting throws or every attempt fails (the extension was reloaded or updated): show "stopped responding · Reload" then.
- `errorText(error)` → the sentence to show, in the UI language: `error.userMessage`; else a known `error.code` from `lib/job-failure.js` `FAILURE_CODES` through `describeJobFailure({ code, params })`; else `classifyJobFailure({ text })` unless unknown; else `toast.genericError`. Raw text never reaches either UI (it may be engine, Chrome or exception text). The worker sends a code with every error, and every Chinese error the worker and the engine can emit classifies to a code (`tests/job-failure.test.js` scans `background.js`, `native-host/host.py` and `lib/` for strings that do not).
- `userError(text)` → an Error carrying `userMessage` (for copy you already have from `msg()`).
- `isKnownFailureCode(code)` → true for any FAILURE_CODES entry except `"unknown"`.

## Worker notes

- Copy: `workerText(key, params)` in `background.js` reads `messages/worker.js` in the worker's language (English fallback, then the key). Failure reasons in notifications come from `describeJobFailure(classifyJobFailure(...))`; a notification shows the file's base name and one meta line or reason, never raw engine text, Chrome codes, links or folder names.
- Errors: every `{ ok: false }` answer is `{ ok: false, error, code, params, jobId? }`. `code` is always a `FAILURE_CODES` entry (`"unknown"` when nothing matches) and `params` its parameters; `error` keeps the legacy Chinese text. The worker throws `codedError(code, text, params)`; network-policy reasons map to codes; anything else is classified.
- `jobFailure(code, params)` (`lib/job-failure.js`) → `{ code, params }` with the params cleaned as `classifyJobFailure` cleans them (validated primitives only; an unknown code becomes `"unknown"`); `describeJobFailure(failure, lang)` → the sentence; `classifyJobFailure({ text })` → a failure for legacy text; `describeJobActivity(message, lang)` and `segmentsFromActivity(message)` read the engine's progress text ("分片 12/48" → `{ done: 12, total: 48 }`).
- File actions (`FILE_ACTION` open, reveal, trash): an engine problem answers with its own `engine_*` code (`engine_missing`, `engine_unreachable`, `engine_not_responding`, `engine_not_set_up`, `engine_finishing_setup`, `engine_restart_needed` …), otherwise `file_missing`, `file_outside_folder`, `trash_failed` or `file_action_failed`.
- Candidates: a title the worker made up for nameless media ("Media" / "媒体") arrives in the current UI language with `titleIsFallback: true` (its `suggestedFilename` is relabelled the same way). A page may show its own untitled label (`media.untitled`) instead.
- Badge: the toolbar badge takes its colours from `ui/v2/tokens.js` (`BADGE_COLORS`), never from literals in `background.js`.

## components.js

| Builder | Returns / classes | Notes |
|---|---|---|
| `icon(name)` | `svg.icon` | `settings link more search video audio stream folder source copy trash remove clear close chevron rescan workspace` |
| `brandMark({ size: "s" \| "m" })` | `span.brandmark[data-brandmark]` > `svg.brandmark-logo` + `span.t-wordmark` | `display: contents`; place it inside a `.lead-grid`. S in popup and side panel, M on full pages. No subtitle. |
| `button({ kind, label, iconName, title, type, action, jobId })` | `button.btn.btn-{primary\|secondary\|tertiary\|destructive}` | `data-action`, `data-job-id`. Heights 36 (32 compact). Tertiary and destructive bleed 8px so text stays on the grid. One primary per view; destructive is always confirmed. |
| `iconButton({ iconName, label, action, jobId, haspopup })` | `button.icon-button` 32 × 32 | `title` and `aria-label` from `label`. |
| `status(tone, label)` | `span.status.t-meta[data-tone]` | 8px dot + word. Tones `progress paused queued complete warning failed cancelled`. Exceptions only. |
| `progress({ value, size: "row" \| "panel", state, label })`, `setProgress(el, value, state)` | `div.progress[role=progressbar]` > `span.progress-fill` | 3px in rows, 6px in the focus panel. States `active paused queued finishing complete settled failed`; the fill is the state's colour (v3 §3.2): pond while downloading (with the tip highlight and the shimmer), harbour queued, lilac at 60% paused, ochre finishing, celadon complete (then the bar fades out), vermilion failed. No percentage-driven hue. |
| `filename(name)`, `splitFilename(name)` | `span.filename[data-filename][data-user-content]` > `.filename-head` + `.filename-tail` | Middle truncation keeps the extension. |
| `groupLabel(text, id)` | `h2.group-label.t-label.text-column` | No band, no rule. |
| `statusLine({ tone, text, actions, id })` | `p.status-line.lead-grid[role=status]` > `span.line-dot` + `span.line-text.t-body` (> `span.line-actions` of tertiary buttons) | The dot hangs in the lead column. Tones `"" (harbour) progress warning complete failed`. `actions: [{ label, run(button), kind }]`. |
| `setStatusLine(container, { tone, text, actions })` | fills an existing element | The dot carries `data-indicator` (an indicator, not a container, for the audit). Empty `text` clears it (`.status-line:empty` hides). Idempotent: the same tone, text and action labels keep the nodes (no re-announcement, focus stays) and only take the new `run` handlers; a changed line keeps focus on the action in the same place. Downloads uses this on its HTML `p.status-line.lead-grid`. |
| `listHeader({ title, count, meta, metaUserContent, actions, level = 2, id })` | `{ element: div.list-header, heading: h2.list-title.t-title, count: span.list-count.t-meta, meta: span.list-meta.t-meta, actions: div.list-actions, setCount(n), setMeta(text) }` | Title on the text column; count hidden at 0; `meta` is a meta line after the title (the side panel's page host), hidden while empty, truncated before the title; pass `metaUserContent: true` for user content (`data-user-content`). Tertiary actions end on the right edge. E.g. "Media on this page" + Rescan + Clear results. |
| `emptyState({ sentence, body, action, id })` | `{ element: section.empty-state.text-column, sentence: p.t-empty, body: p.t-body, action: button.btn, update(next) }` | Left-aligned, upper third (48 top). `action: { label, run, kind = "tertiary" }`; use `kind: "primary"` only when it is the view's one primary (popup Rescan). Pair it with the pond opening (see pond.js). |
| `runAction(element, key, task, { onError, keepDisabled })` | promise | Single-flight per key: sets `aria-busy` and disables the element while `task` runs; labels never change. Afterwards the element gets its earlier disabled state back unless `keepDisabled()` (evaluated after the task, also on failure) returns true, e.g. a control that stays disabled until a later state change (the side panel now hides "Clear finished" instead of disabling it). |
| `createToaster(region)` → `toast(text, tone = "success" \| "warning" \| "error")` | `div.toast` in `.toast-region` | Bottom-left, 4 s, at most 3. |
| `createMenus(layer)` → `{ openItems(anchor, items), confirm(anchor, { question, confirmLabel, cancelLabel, confirmKind = "destructive" }), close(), isOpen() }` | `.menu-layer` > `.menu` (put `<div class="menu-layer" hidden><div class="menu"></div></div>` in the page) | Items `{ label, iconName, tone: "destructive", keepOpen, run(anchor) }`. `confirm` asks in place (the question in the row role, the strongest text in its box) and resolves true or false; the confirming button is destructive unless `confirmKind` says otherwise (an opt-in that removes nothing, Settings' "Allow", passes `"tertiary"`). Arrow keys move through the items and wrap; Enter and Space activate the focused item on keydown (the layer consumes the key, so one press is one activation); Escape closes and returns focus to the anchor when it is still on the page. Marks the anchor's `.row` / `.focus-panel` `data-selected`. One instance per page (it adds document listeners). |

## controls.js

`switch` is a reserved word, so the switch builder is `switchControl`. The field
builders (`select`, `switchControl`, `textField`, `numberField`) accept `id`
(generated when absent), `label` (an `aria-label`, only when no visible label
names the control) and `describedBy`.

| Builder | Returns / classes | Notes |
|---|---|---|
| `select({ id, name, options: [{ value, label, disabled }], value, size: "regular" \| "compact", width: "short" \| "medium" \| "fill", onChange(value, select) })` | `span.field.select-field[data-field][data-size]` > `select` + `span.field-glyph.field-chevron` | Native select in the input look: tonal fill, no border at rest, focus ring, chevron in text-secondary. `setOptions(el, options, value)` replaces options; a `value` the new options lack is ignored (the first option stays selected, never a blank select). |
| `switchControl({ id, name, checked, disabled, onChange(checked, el) })` | `button.switch[role=switch][aria-checked]` > `span.switch-thumb` | The ONE boolean control (Settings toggles and dialog options; no checkboxes). Space and Enter toggle; fires a bubbling `change`. `setSwitch(el, on)` (no event), `isSwitchOn(el)`. Off: an empty sunken track with a text-muted knob (text-secondary on hover); on: the primary fill with a light knob, so the two states differ in value. |
| `textField({ id, name, value, placeholder, unit, size, width, multiline, rows, maxLength, type, inputMode, autocomplete, spellcheck, required, invalid, onInput, onChange })` | `span.field[data-field][data-size]` > `input` (or `textarea`, `[data-multiline]`) + optional `span.field-unit.t-meta` | The unit is added to `aria-describedby`. |
| `numberField({ min, max, step, width = "short", ...textField })` | as textField, `input[type=number][inputmode=numeric]` | |
| `fieldStack({ label, control })` | `div.field-stack` > `label.t-label[for]` + control | A visible label above a field, for dialogs. |
| `controlOf(element)` | the native control inside a wrapper | |
| `settingRow({ id, name, description, control, layout: "inline" \| "stack" })` | `div.setting-row` > `div.setting-text` (`label.setting-name.t-row` or `span.setting-name.t-row`, `p.setting-description.t-body`, `p.setting-error.t-meta[role=alert]`) + `div.setting-trail` (`span.status.saved-note[role=status]`, control) | One row per setting (§6.13). The name is a `<label for>` only for an `input`, `select`, `textarea` or `role=switch` (directly or inside a `[data-field]` wrapper); the description and error line describe that control. When the trailing items are buttons or links (one, or several with a status word beside them), the name is a `span` and every action gets `aria-describedby` = name, description, error, so it keeps its own words as its accessible name and a click on the name never runs it. A group with a role (a segmented radiogroup) is named by `aria-labelledby`. Pass several trailing items as an array (`control: [statusWord, setUp]`): they are laid out in one `span.trail-group`. Description: one line at most. The control ends on the column's trailing edge; `stack` puts it under the text (text areas), and a field there bleeds its fill 12px to the left so its text starts on the content edge. Row padding follows density. |
| `markSaved(row, { text, duration = 2000 })` | | Inline "Saved" (dot + word in celadon text) next to the control; fades after about 2 s by opacity only, so it is reduced-motion safe; re-arms on repeated saves. `SAVED_VISIBLE_MS` = 2000. Autosave each control and call this; no sticky save bar. |
| `setSettingError(row, text)` | | Shows or clears the row's one-line error (vermilion text) and sets `aria-invalid` on the row's form control: the first `[data-field]` (its native control) or control in the trail, never a chip, a preview line or an action button. The field then wears a soft vermilion halo (3px `--halo-invalid`, like the focus halo), never a hard ring at rest. While the error line shows, the description steps out (one helper line, §7). |
| `nav({ items: [{ id, label, href }], current, label })` | `{ element: nav.nav > ul.nav-list > li > a.nav-item.t-row[data-nav-id], setCurrent(id) }` | Current item: tonal pill + text-primary + `aria-current="true"`. The pill is drawn on `.nav-item::before`, bleeding 12px past the text on each side; the link box has no fill, so the item text sits on the nav's left edge (the column edge, with the page title). `href` defaults to `#id`. Wire `setCurrent` to scrolling yourself. |
| `dialogShell({ title, body, actions, id, onSubmit, onClose })` | `{ dialog: dialog.dialog-shell, form: form.dialog-form[method=dialog], heading: h2.t-title, body: div.dialog-body, actions: div.dialog-actions, open(), close(value) }` | Raised surface, float radius and shadow, width `min(--dialog-width, 100vw − 32)`, height at most `100vh − 32`. Header: title + close icon button (`.dialog-close`, closes with `"cancel"`). Body scrolls; the action row stays in view (sticky, 16px padding), so it is never clipped at 600px. In the popup the document grows to 600 while a dialog is open (`[data-surface="popup"]:has(.dialog-shell[open])`), so a short view behind it never squeezes the dialog. Escape closes and reports `"cancel"` like the close button; `open()` clears the previous `returnValue`. Put Cancel (tertiary) then the one primary (`type: "submit"`) in `actions`. The form is `method=dialog`, so a submit closes the dialog unless `onSubmit` calls `event.preventDefault()` (do that while validating or saving). |
| `segmented({ items: [{ value, label, count, controls }], current, label, role = "tablist" \| "radiogroup", onSelect(value), id })` | `{ element: div.segmented[role=tablist] > button[role=tab][data-value][aria-selected] > span + span.count, select(value, { focus }), setCount(value, n), setDisabled(value, bool) }` | Raised selection on a sunken track in both themes; roving tabindex (one tab stop always: the first enabled option when the current value is unknown or disabled); arrows, Home, End. Counts hidden at 0. Keep the same tabs and neighbours across views. A tablist switches views with panels (`controls` → `aria-controls`). `role: "radiogroup"` is for a choice of one value with no panels (Settings' speed presets, a theme): `div.segmented[role=radiogroup] > button[role=radio][aria-checked]`, the same keyboard model, no `aria-selected` or `aria-controls`. |

### Fields in containers

A `.field` box is part of its control (the audit counts it with the control,
not as a container). Inside `.dialog-shell` the fill sits on the native control
(`.dialog-shell .field > input, > select { background: var(--surface) }`, one
value step below the raised dialog) and the wrapper turns transparent. The
control's fill box then starts on the label's edge, so the value text adds no
second left edge. A trailing unit would sit beside the fill, so avoid units in
dialogs. Do not put fields inside any other box (the focus panel included).

### The dialog's status line

A dialog has at most one status line: a `statusLine` (or a
`p.status-line.lead-grid` filled with `setStatusLine`) with the extra class
`dialog-line`, last in the dialog body. Inside `.dialog-shell` it drops the lead
grid and hangs its dot in the body padding, so its text starts on the same edge
as the field labels (one left edge in the dialog); the dot centres on the line
box (a line with Set up is 32px tall) and keeps 4px from the text and from the
dialog's edge. Empty, it takes no space. On the lead-grid status line the dot
centres on the 20px glyph axis that row glyphs share.
While a dialog is open, an empty state behind the scrim is hidden
(`:root:has(.dialog-shell[open]) .empty-state`), so its Display sentence and its
primary never count with the dialog's.

Builder fields (`[data-field]`) get a focus ring that reaches 3:1 (2px
`--pond-text` inside a soft halo). The two Downloads fields predate the builders
and keep the soft halo alone (1.4:1 Morning, 1.7:1 Dusk); adding `data-field`
to them adopts the ring. An invalid field at rest draws the same construction
in the error colour (v3 §3.9): 2px `--ring-invalid` (vermilion at 60%) inside a
6px `--halo-invalid` (18%), never a solid outline.

## rows.js: DownloadRow

One grid per row: lead (`--lead`) · text column · trailing cell, `--lead-gap`
apart, padded by `--row-pad`, sitting directly on the canvas. The hover tint
bleeds 12px into the gutter. Trailing status (exceptions only) and actions share
one cell; actions show on hover, focus-within and selection (`data-selected`, set
by menus), and always on live rows and on `data-actions="visible"` rows. Put rows in
`ul.rows`. A type glyph centres on the filename's line (where the trailing items
sit); a poster frame stays centred on the row. Filename halves keep their
spaces (`white-space: pre`). On a live row `.row-main` is `display: contents`:
title and controls share the first line, the meta line runs the full width
under the controls, then the bar. A leading status in a meta line hangs its dot
(8px + 4px) inside the line's own padding box, so the dot is never clipped and
the word stays on the text column. The focus panel bleeds 12px, like the row
hover tint.

Classes emitted: `li.row` > `span.row-lead` (on full pages `span.lead-frame[data-indicator]`, 56 × 32, holding the media's `img` or a 16px type `svg`; in the popup and side panel a 20px `svg`) +
`div.row-main` (`p.t-row.row-title` > filename, `p.t-meta.row-meta`,
`p.t-meta.row-source`) + `div.row-trail` (`span.status`, `div.row-actions`). Live
rows add `[data-live]`, `[data-job-id]` and a `.progress` child of the row; the
focus panel is `article.focus-panel` > row + `div.focus-progress` +
`details.focus-details` (`summary` > span + chevron `svg` that turns when open,
`div.details-body` with a `.segment-map` only for real per-part levels, then
`div.speed-block` > `svg.speed-chart` (24px) + `p.t-meta`).

| Function | Notes |
|---|---|
| `rowLead(item, { poster = true })` | Poster frame when `poster` and `item.thumbnail` is a `data:image/(png\|jpeg\|webp)` URL; else the glyph for `mediaKindOf(item)`. |
| `mediaKindOf(item)` | `"audio"`, `"stream"` (hls, dash, dash_pair) or `"video"`. |
| `downloadRow({ lead, title, meta, source, status, actions, actionsVisible, tag = "li", id })` | Any non-history row, e.g. detected media in the popup and side panel: `meta` "MP4 · 1080p · 12 MB · 2:28" (plain meta text, never chips), `source` a string or node (wrap user content in `data-user-content`), `actions` your buttons, `actionsVisible: true` for the core verb (Download). `id` lands in `data-item-id`. |
| `historyRow(record, { now, poster = true, onAction(action, record, button) })` | Completed rows show format · resolution · size · duration and no status; failed rows a localised reason and a Failed status; cancelled and missing files a status. Actions Open (or Retry when `retryable`) + overflow; `action` is `"open"`, `"retry"` or `"more"`. |
| `completedMeta(record)`, `recordFailureText(record)`, `formatName(record)`, `sourceHost(record)`, `recordBytes(record)` | The pieces of a history row, for summaries and custom rows. |
| `liveRow(job, { focus = false, poster = true, compact = false })` | Returns a view `{ root, row, title, meta, actions, bar, details }`; insert `view.root`. `focus: true` builds the one focus panel per view. `compact: true` (popup and side panel) leaves the size out of the meta line so it fits. |
| `updateLiveRow(view, job, { finishing, samples, onControl(action, job, button) })` | Updates in place. Controls rebuild only when status, pausable or resumable change; their handlers always get the latest `job` and call the latest `onControl`. A rebuild that replaces the focused control moves focus to the control now in the same place (Pause becomes Resume). `finishing`: `{ phase: "complete" }` (celadon) then `{ phase: "settled" }` (fades), then drop the row (§6.7: about 1.2 s and 1.8 s). `samples`: recent speeds for the chart. |
| `transferControls(job, onControl)` | Pause or Resume (tertiary) + Cancel (destructive); `action` is `"pause"`, `"resume"` or `"cancel"`. Confirm Cancel with `menus.confirm`. |
| `liveStatus(job, finishing)`, `barState(job, finishing)`, `liveMetaParts(job, { compact })`, `remainingTime(job)` | The status word and the meta parts, most useful first so a narrow row ellipses the size: "62%", "0:31 left", "56.3 MB/s", "1.2 GB of 3 GB" (or the bytes so far when the total is unknown). Never the parts count: that is Details only. Finishing (remuxing) shows the status word alone unless the engine names a distinct step. `remainingTime` estimates from the progress fraction when a stream has no total. |
| `renderLiveDetails(details, job, samples)`, `segmentMap(levels)`, `speedChart(samples)` | Details only inside the focus panel (§6.8). A map only when the job carries `segments` (one level 0–1 per part): finished neighbours merge into one run, 2px gaps where parts differ; an aggregate done/total never draws one. The speed line spans 80% of its slowest sample to the peak, with one meta line under it: "74 of 120 parts · Now 56.3 MB/s · Peak 58.0 MB/s". No reflection. |

The Downloads page keeps the job state (`finishing`, speed rings) and passes it in.
See `extension/downloads/downloads.js` for the complete wiring.

## jobs.js

- `isTerminalStatus(status)` → true for `completed`, `failed`, `cancelled`.
- `compareJobs(a, b)` → live jobs first (newest start on top), then ended jobs by end time.
- `recordSpeedSample(ring, job)` → pushes `job.speed` while `job.status` is `downloading` and keeps the newest `SPEED_SAMPLES` (48); returns the ring. The Downloads page and the downloads list both feed their speed graphs through it.
- `runFileAction(job, action, call = callWorker)` → open or reveal: Chrome's own downloads through `chrome.downloads` (it needs the click's gesture), engine files through the worker's `FILE_ACTION`; every other action (`trash`, or a Chrome download whose id no longer resolves) through the worker.

## media.js and media.css

The popup and the side panel are one product (review P2): `media.js` holds what
both draw, `media.css` the few rules they add to system.css. Surface state
(tab, items, settings) stays in each page; copy comes from `messages/media.js`.

Pure helpers (no DOM): `isStreamKind(item)`, `isTrustedInstagramBrowserItem(item)`,
`isTrustedXBrowserItem(item)`, `downloadNeedsNative(item, options)` (everything goes
through the engine except the strictly matched Instagram and X files kept in
their original format), `isOfferedCandidate(item)` (no stream parts; no
external-tool items in a stable build), `mediaKey(item)`, `candidateReference(item)`
(`{ id, kind, generation }`: pages never send URLs back), `readableMediaTitle(item)`
(the item's own name, else `media.untitled`), `displayFilename(record)` (a
record's filename, else `media.untitled`; for display only, a written file
still falls back to `media`), `urlHost(url)` (host without `www.`, "" when
unreadable), `originalExtension(item)`, `formatLabel(extension)`,
`defaultFilename(item, format)`, `replaceFilenameExtension(name, format, item)`,
`mediaMeta(item)` (the one meta line: "Stream · 1080p · 58:00", "MP4 · 812 MB";
never manifest bytes for a stream), `filterItems(items, filter)`, `urlItem(url)`,
`manifestBlock(probe)` → `"drm" | "live" | "discontinuous" | ""`,
`mp3Available(host)`, `formatOptions(item, host)`, `defaultFormat(item, settings)`,
`variantLabel(variant, index)`, `downloadOptions(item, { filename, format, variantUrl, settings })`
(the message shape is unchanged from v1).

The local engine (one status line, never an explanation, §7):
`hostReasonFromText(text)`, `hostStatusFromError(error)`, `normalizeHostStatus(status)`
(a legacy raw `lastError` becomes a failure reason and is dropped),
`engineIssue(status, { permission })` → `"permission" | "finishing" | "restart" |
"recover" | "missing" | "noResponse" | "update" | "noConvert" | null`,
`engineIssueText(issue)`, `engineLine(issue, { setUp, retry })` (the spec for
`setStatusLine`; Retry on the states a fresh check can clear),
`engineError(status)`, `requireEngineReady(status)`, `pingEngine(call)` (never
throws), `recheckEngine({ call, onHost, permission })` (Retry: ping, keep the
fresh status, then resolve, or throw the issue that remains as a user error;
"ready" only when no issue is left), `ENGINE_SETUP_PATH`
(`options/options.html#local-engine`, where every Set up goes) and `openEngineSetup()`.

Page plumbing: `applyStaticCopy(root)` (`[data-msg]`, `[data-msg-label]`,
`[data-msg-placeholder]`), `bindMist(topbar, scroller)` (keeps `data-scrolled`
on the top bar; the band itself is CSS, see below). The pond's content boxes
come from `contentBoxes(selectors)` in pond.js; each page lists its own.

The top bar's band (v3 §3.6) is `.topbar::before`: nothing at scroll position
0, then the tint (75% surface) and the mist fade in over the first 24 px of
scroll, driven by a scroll timeline (`scroll(root)`; the popup names its
`.popup-main` scroller `--page`), so a capture at scroll 0 can never show a
stale band. `data-scrolled` only matters where scroll-driven animations are
unsupported.

Rows and dialog: `mediaRow(item, { busy, onDownload, onMore })` (glyph, the
title, one meta line, the source line, a tertiary Download with
`data-media-action="download"`, Copy link in an overflow for copyable items),
`mediaSource(item)` (the source line: host as user content · age from
`item.lastSeen`, or null), `openMediaMenu(menus, item, anchor, { toast, onError })`,
`findDownloadButton(key, root)`, `createMediaDialog({ getContext, ping, onHost,
onStarted, onRepresented, onBusy, setUp, fallbackFocus, call })` → `{ dialog,
prepare(item, anchor), openUrl(anchor), isOpen(), isBusy(key), invalidate(key),
syncHost(), applyCopy() }` (file name, format, quality when the stream offers
it, one `dialog-line`; the start keeps `chrome.permissions.request` the first
call of the click, and a failed start that a job row already shows goes to
`onRepresented`).

The downloads list: `createJobList({ list, focusSlot, menus, toast, onError,
announcer, onChange, call })` → `{ setJobs(jobs), upsert(update), render(),
has(jobId), announce(jobId), size, endedCount, relabel() }`. Live rows update
in place (the first one becomes the focus panel when `focusSlot` is given),
ended rows are history rows; Pause, Resume, Cancel (confirmed), Open, Retry,
Show in Finder, Open source page and Remove from history (confirmed).
`announce(jobId)` says a job's status in the polite region, e.g. for a failed
start that a row now shows. A status change is announced once.

media.css: the list-header overflow keeps its glyph on the right edge, a busy
row's meta is in the pond text colour, disabled header actions stay quiet, and
`.media-rows` / `.job-rows` stay one column wide.

## tokens.js

`MORNING` holds the Morning `--primary-fill`, `--text-secondary` and
`--text-on-accent`; `BADGE_COLORS` maps them to the toolbar badge (`active`
while downloading, `idle` otherwise, `text` for the count). A service worker can
neither read CSS custom properties nor fetch `tokens.css`, so this DOM-free
mirror is the second token file; `tests/ui-v2.test.js` fails when a value
drifts from the Morning block of `tokens.css`. Add a token here only when code
outside a page needs it.

## pond.js

The port of `docs/design-review/pond-reference/pond_layer.py`,
`render_pond(spec="v3")` (design review v3 §3.1): drifts of touches at three
scales, Morning touches below the ground's lightness and Dusk touches above
the water's, alpha 0 under every content box with a 64 px feather. The script
is the specification; no parameter is reinterpreted here.

- `mountPondLayer({ element, getContentBoxes, isShown })` returns `{ refresh() }` or null. `element` is `div.pond[data-pond][aria-hidden=true]`, first in `<body>`; it gets a `<canvas>` child (system.css: no CSS mask, a 0.7 px blur). `getContentBoxes()` returns `[{ x, y, width, height }]` for every content box (header, title, controls, each text block, lists, forms, dialogs) in CSS px of the viewport; `contentBoxes(selectors)` builds it from the page (hidden elements and empty status lines have no box; open dialogs, menus and toasts are always included). Each page keeps its selector list next to its mount. Call `refresh()` after a render that moved the boxes (debounced 300 ms); resize and theme changes repaint on their own, and scrolling re-masks once per frame.
- `PondLayer({ seed, families })`: `plan(theme, width, height, canvasL)` and `bitmap(theme, width, height, canvasL, dpr)`, each cached per theme and 128 px viewport bucket, so one install draws one layer. `planPond(options)` (pure: the drifts and every touch, in the reference's PRNG order), `renderPondBitmap(plan, dpr)`, `maskFactor(boxes, x, y)` (the mask's value at a point; overlapping feathers multiply; `MASK_FEATHER` is the 64 px), `maskContent(ctx, boxes, { dpr })` (the same mask, painted with destination-out), `contentBoxes`, `rgbToOklch`, `parseCssColor` and `oklchToRgb(L, C, H)` are exported for tests. The hue families come from `--pond-families` (tokens.css), the canvas lightness from `--canvas`, the theme from the root's `color-scheme`; the seed is a per-install integer in `chrome.storage.local`.

## Tests

`tests/ui-v2.test.js` (tokens and tokens.js, contrast, message parity and
leaks, formatters, pond, the Downloads page) and `tests/ui-v2-system.test.js`
(message modules, errors, runtime and the port, rows and every control in a
small DOM, toasts and menus, static source checks, surface tokens, control
contrast, the shared rules in system.css, this README's coverage of every
export). Each surface has its own `tests/ui-v2-<surface>.test.js`.
Run `node --test tests/*.test.js`.
