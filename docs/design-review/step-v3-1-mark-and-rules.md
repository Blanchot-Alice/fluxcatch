# Step v3-1 (v3.1 and v3.2): the mark, and the Settings section rule
# 第 v3-1 步（v3.1 与 v3.2）：标志，以及设置页的分节线

Design review v3.2 §3 (the mark G · Brush arrow, replacing v3.1 §1) and v3.1 §2 (the Settings section rule), with the audit exemption of v3.1 §3.2, in the order v3.1 §4 gives. Both are done; this page is the stop for approval. Nothing is committed.
设计评审 v3.2 第 3 节（标志 G · 笔触箭头，替代 v3.1 第 1 节）和 v3.1 第 2 节（设置页分节线），加上 v3.1 第 3.2 节的审计豁免，按 v3.1 第 4 节的顺序完成。两项都已做完；本页是等待审批的停点。没有提交任何改动。

## What to review · 请审阅

- **The mark in its contexts:** `docs/design-review/mark-g/icon-contexts.png`, the rasters at 128/48/32/16 on Chrome's light and dark toolbars and on both canvases, then the BrandMark sizes (the 128 mark and the 16 mark at 24 and at 20 px) on both canvases. `popup-header-morning.png` and `popup-header-dusk.png` are the popup's top bar as captured by the audit (device pixel ratio 2).
  **标志在各种环境里**：`docs/design-review/mark-g/icon-contexts.png`，128/48/32/16 四档在 Chrome 浅色与深色工具栏、两套画布上的栅格图，再往下是 BrandMark 的两档尺寸（128 标志与 16 标志各在 24 px 和 20 px）在两套画布上。`popup-header-morning.png`、`popup-header-dusk.png` 是审计截下的弹窗顶栏（设备像素比 2）。
- **The rule:** `settings-full-1280-{morning,dusk}-{before,after}.png` (the whole Settings page, device pixel ratio 1), `settings-960-{morning,dusk}-after.png` (the first screen at 960) and `section-rule-{morning,dusk}-2x.png` (the first rule up close, device pixel ratio 2), all in `docs/design-review/mark-g/`. The atlas `tools/live/out/design-atlas/v3-mark/atlas.pdf` lays the audit's Settings and popup captures beside the step-4 ones.
  **分节线**：`settings-full-1280-{morning,dusk}-{before,after}.png`（设置页整页，设备像素比 1）、`settings-960-{morning,dusk}-after.png`（960 首屏）和 `section-rule-{morning,dusk}-2x.png`（第一条线的近景，设备像素比 2），都在 `docs/design-review/mark-g/`。图集 `tools/live/out/design-atlas/v3-mark/atlas.pdf` 把审计的设置页和弹窗截图与第 4 步的并排。
- **The audit:** `docs/design-audit/v3-mark.md` (Settings at 1280 and 960, the popup; both themes, both languages).
  **审计**：`docs/design-audit/v3-mark.md`（设置页 1280 与 960、弹窗；两套主题、两种语言）。
- **One decision taken here, per v3.2 §3.4:** BrandMark size s (20 px) shows the 16 px mark; size m (24 px) keeps the 128 mark. The sheet's BrandMark rows are the evidence; see "Interpretations and deviations".
  **按 v3.2 第 3.4 节在此做的一个决定**：BrandMark 的 s 号（20 px）显示 16 px 标志，m 号（24 px）仍用 128 标志。证据是试纸上的 BrandMark 两行；见“解读与偏离”。

## What changed · 改了什么

### v3.2 §3 The mark · 标志

- `extension/icons/fluxcatch-mark.svg` and `fluxcatch-mark-16.svg` are `icon-candidates-2/fluxcatch-g-brush-arrow.svg` and `-16.svg`, byte for byte (their content-credential metadata included); the file names the code expects are kept.
  `extension/icons/fluxcatch-mark.svg` 与 `fluxcatch-mark-16.svg` 就是 `icon-candidates-2/fluxcatch-g-brush-arrow.svg` 与 `-16.svg`，逐字节相同（含其中的内容凭证元数据）；代码所用的文件名保留。
- `scripts/build-icons.mjs` rasterises each size with Chrome for Testing at exact size from a data-URL image, so the `feGaussianBlur` filters and the ripple mask render as the browser renders them; nothing is scaled afterwards. `icon16.png` comes from the 16 mark, `icon32/48/128.png` from the 128 mark. `--logo` writes `docs/assets/icon.png` from the 128 mark at 256 px; `--sheet <png>` writes the contact sheet described above at device pixel ratio 2.
  `scripts/build-icons.mjs` 用 Chrome for Testing 以 data-URL 图片按精确尺寸逐档栅格化，`feGaussianBlur` 滤镜和涟漪遮罩按浏览器的方式渲染；之后不做缩放。`icon16.png` 来自 16 标志，`icon32/48/128.png` 来自 128 标志。`--logo` 用 128 标志按 256 px 写出 `docs/assets/icon.png`；`--sheet <png>` 按设备像素比 2 写出上面说的试纸。
- The in-app BrandMark (`ui/v2/components.js`) used to draw the old mark inline from four token classes (cream disc, ring, waves, pad). The new mark is a painting with gradients, filters, a mask and fixed colours that no token class can express, and copying its markup into the component would put colour literals into JS, which check h forbids. The BrandMark therefore shows the icon file itself: `img.brandmark-logo` with `src` `../icons/fluxcatch-mark.svg` at size m and `../icons/fluxcatch-mark-16.svg` at size s (every surface page sits one folder below `extension/`, so the relative path is the same everywhere). The `.logo-*` classes are gone from `system.css`. The e2e's BrandMark geometry check reads `.brandmark-logo` as before.
  应用内的 BrandMark（`ui/v2/components.js`）以前用四个令牌类内联画出旧标志（奶白圆盘、环、波纹、荷叶）。新标志是一幅带渐变、滤镜、遮罩和固定颜色的画，令牌类表达不了，把它的标记复制进组件又会把颜色字面量带进 JS，这是检查 h 禁止的。所以 BrandMark 直接显示图标文件：`img.brandmark-logo`，m 号的 `src` 是 `../icons/fluxcatch-mark.svg`，s 号是 `../icons/fluxcatch-mark-16.svg`（每个界面页都在 `extension/` 下一层，相对路径处处相同）。`system.css` 里的 `.logo-*` 类删除。e2e 的 BrandMark 几何检查照旧读 `.brandmark-logo`。
- Tests: `tests/ui-monet.test.js` checks the mark's palette against the tokens (pond, celadon, rose, lilac, apricot), that the 128 mark keeps its filters, mask and gradients, and that the component references the two files and carries no colour literal; `tests/ui-static.test.js` checks each PNG's transparent corners, the indigo arrow and the pond water instead of the lily pad.
  测试：`tests/ui-monet.test.js` 对照令牌检查标志的用色（pond、celadon、rose、lilac、apricot）、128 标志保留滤镜、遮罩和渐变、组件引用这两个文件且没有颜色字面量；`tests/ui-static.test.js` 对每个 PNG 检查四角透明、靛蓝箭头和池水，代替原来的荷叶。

### v3.1 §2.2 The Settings section rule · 设置页分节线

- `options.js`: the sections builder emits `<hr class="section-rule">` between consecutive top-level sections only: nine rules for ten sections, none before the first, after the last, inside a section or in the nav. The element keeps its `<hr>` semantics in the accessibility tree.
  `options.js`：分节构建器只在相邻的顶层分节之间放一个 `<hr class="section-rule">`：十个分节九条线，第一节前、最后一节后、分节内部和导航栏里都没有。元素在无障碍树里保留 `<hr>` 语义。
- `options.css`: `height: 1px; margin: 28px 0 24px; border: 0; background: linear-gradient(90deg, transparent 0, var(--rule-section) 10%, var(--rule-section) 90%, transparent 100%)`; the rule is a child of the content column, so its width is the column's. `.section-rule + .settings-section { padding-top: 0 }` gives the rhythm last row, 28 px, rule, 24 px, title. The second-section gap selector is now `:nth-of-type(2)`, so it still counts sections rather than the rule now sitting second.
  `options.css`：`height: 1px; margin: 28px 0 24px; border: 0; background: linear-gradient(90deg, transparent 0, var(--rule-section) 10%, var(--rule-section) 90%, transparent 100%)`；线是内容列的子元素，宽度即内容列。`.section-rule + .settings-section { padding-top: 0 }` 形成“最后一行、28 px、线、24 px、标题”的节奏。第二节间距的选择器改为 `:nth-of-type(2)`，仍按分节计数，而现在排在第二位的是那条线。
- `tokens.css`: `--rule-section` Morning `rgba(43, 46, 74, 0.22)`, Dusk `rgba(239, 233, 224, 0.18)` (in both dark blocks), and under `prefers-contrast: more` 0.36 and 0.30. Settings only; the popup, side panel, Downloads and preview carry no rule, and the designer page is untouched.
  `tokens.css`：`--rule-section` 晨色 `rgba(43, 46, 74, 0.22)`，暮色 `rgba(239, 233, 224, 0.18)`（两个深色块里都有），`prefers-contrast: more` 下为 0.36 与 0.30。只用于设置页；弹窗、侧边栏、下载记录页和预览页没有线，设计器页面未动。

### v3.1 §3.2 The audit · 审计

- Check g lives in `scripts/lib/page-audit.mjs` (the half of the audit that runs inside each page); its thin-filled-element test now skips `hr.section-rule` and nothing else. Borders and shadows are checked as before, and the rule has none. The driver's header and legend name the exemption; the budget stays 0 for everything else.
  检查 g 在 `scripts/lib/page-audit.mjs`（审计在页面内运行的那一半）里；它的“细长填充元素”判定现在跳过 `hr.section-rule`，别的一概不跳。边框和阴影照常检查，而这条线两者都没有。驱动端的文件头和图例写明了豁免；其余一切预算仍为 0。
- `tests/ui-v2-settings.test.js` checks the rule's placement, construction, tokens and scope; `tests/design-audit.test.js` checks that the exemption names one selector in one place.
  `tests/ui-v2-settings.test.js` 检查线的位置、构造、令牌和范围；`tests/design-audit.test.js` 检查豁免只在一处、只点名一个选择器。
- `DESIGN.md` principle 6 and the v2 README's rule list state the one exception.
  `DESIGN.md` 第 6 条原则和 v2 README 的规则列表写明了这唯一的例外。

## Tests and checks · 测试与检查

- `node --test tests/*.test.js`: 385 pass (the worker smoke test included). Changed or added: the mark's palette and construction (`ui-monet`), the PNG icons (`ui-static`), the section rule (`ui-v2-settings`), the audit exemption (`design-audit`).
  `node --test tests/*.test.js`：385 项通过（含 worker 冒烟测试）。改动或新增的：标志的用色与构造（`ui-monet`）、PNG 图标（`ui-static`）、分节线（`ui-v2-settings`）、审计豁免（`design-audit`）。
- `node scripts/design-audit.mjs --label v3-mark --surfaces settings,popup`: 40 screens (Settings at 1280, 960, the whole page and the whole page with the engine connected; the popup's six states; both themes, both languages), ALL BUDGETS MET. Check g is 0 on every Settings screen with the nine rules in place, so the exemption catches the rule and nothing else surfaced. The pond column and the header column are unchanged by this step (Settings 1280 Morning 4.8 % · 0.02, Dusk 5.0 % · 0.044; whole page 4.2 % / 5.1 %; header 40 of 40). The report is published as `docs/design-audit/v3-mark.md`.
  `node scripts/design-audit.mjs --label v3-mark --surfaces settings,popup`：40 屏（设置页 1280、960、整页、引擎已连接的整页；弹窗六个状态；两套主题、两种语言），ALL BUDGETS MET。九条线在位时每个设置页屏的检查 g 都是 0，说明豁免只接住了这条线，没有别的东西冒出来。池塘列与页眉列不受本步影响（设置页 1280 晨色 4.8% · 0.02、暮色 5.0% · 0.044；整页 4.2% / 5.1%；页眉 40 屏全过）。报告发布为 `docs/design-audit/v3-mark.md`。
- The first full run of that audit stopped on a one-off `Runtime.evaluate` timeout at the first Settings screen; the same screen alone passed at once and the rerun passed in full. Recorded, not explained.
  这次审计第一次完整运行时在第一个设置页屏上遇到一次性的 `Runtime.evaluate` 超时；单独跑同一屏立刻通过，重跑也全部通过。记录在此，原因未查明。
- `node scripts/design-atlas.mjs --before v3-step4 --after v3-mark --surfaces settings,popup --no-e2e`: 43 pages (40 with captures), 67.7 MB, `tools/live/out/design-atlas/v3-mark/atlas.pdf`; the two options are new in the script.
  `node scripts/design-atlas.mjs --before v3-step4 --after v3-mark --surfaces settings,popup --no-e2e`：43 页（40 页有截图），67.7 MB，`tools/live/out/design-atlas/v3-mark/atlas.pdf`；这两个选项是脚本新加的。
- `node scripts/build-icons.mjs --logo --sheet docs/design-review/mark-g/icon-contexts.png`: the four icons, the README logo and the sheet, all from Chrome for Testing.
  `node scripts/build-icons.mjs --logo --sheet docs/design-review/mark-g/icon-contexts.png`：四个图标、README 图标和试纸，都出自 Chrome for Testing。
- `npm run test:e2e`: passed on the first run (8 detection cases, 3 UI pages, 3 interaction flows, 15 visual states); the BrandMark geometry check and the Settings states ran against the image mark and the rules.
  `npm run test:e2e`：第一次运行即通过（8 个检测用例、3 个 UI 页面、3 个交互流程、15 个视觉状态）；BrandMark 几何检查和设置页各状态跑在图片标志与分节线之上。

## Interpretations and deviations · 解读与偏离

1. **Size s shows the 16 px mark.** On the sheet (`icon-contexts.png`, the two BrandMark rows), the 128 mark at 20 px keeps its arrow but its reflection and the touches collapse into a speckled band under the waterline on both canvases; at 24 px the band is faint but still a texture rather than a reflection. The 16 mark is a clean two-tone disc with a heavier arrow at both sizes. v3.2 §3.4 allows the 16 mark for sizes under 24 px, so size s (the popup and side panel, 20 px) uses it and size m (Downloads, Settings, the preview, 24 px) keeps the 128 mark. The 24 px case is reported here with the capture and not changed; nothing in either mark was redrawn.
   **s 号用 16 px 标志。** 在试纸（`icon-contexts.png`，BrandMark 两行）上，128 标志在 20 px 时箭头还在，倒影和水面的色点在两套画布上都糊成了水线下的一条噪点带；24 px 时这条带淡一些，但仍是一片纹理而非倒影。16 标志在两个尺寸下都是干净的双色圆盘加更粗的箭头。v3.2 第 3.4 节允许 24 px 以下用 16 标志，所以 s 号（弹窗和侧边栏，20 px）用它，m 号（下载记录页、设置页、预览页，24 px）仍用 128 标志。24 px 的情况连同截图在此报告，没有改动；两个标志都没有重画。
2. **The arrow's indigo is one step off the token.** The mark paints the arrow in `#2B2E4A`, the review's "text indigo"; the `--text-primary` token is `#2B2D49`. The mark is used as delivered (v3.2 §5), and the palette test checks the five tokens that do match (pond, celadon, rose, lilac, apricot). Whether the token or the mark moves is Andy's call.
   **箭头的靛蓝与令牌差一级。** 标志的箭头用 `#2B2E4A`，即评审所说的“文字靛蓝”；`--text-primary` 令牌是 `#2B2D49`。标志按交付原样使用（v3.2 第 5 节），调色板测试检查五个确实一致的令牌（pond、celadon、rose、lilac、apricot）。改令牌还是改标志，由 Andy 决定。
3. **The BrandMark is now an image of the icon file, not a drawing in code.** The old mark lived twice: as the icon SVG and as token-class markup inside `components.js`. The new mark cannot be drawn from tokens, so the component shows the file. Consequences: the in-app mark no longer follows the theme (by design: the disc is meant to hold on light and dark alike), `components.js` carries no colour literal, the `.logo-*` classes are gone, and the preview's "Type and brand" view shows the regenerated PNGs. Each surface loads one small SVG from the extension's own files; nothing is fetched.
   **BrandMark 现在是图标文件的图片，而非代码里画的图。** 旧标志存在两处：图标 SVG，以及 `components.js` 里用令牌类写的标记。新标志无法用令牌画，所以组件直接显示文件。影响：应用内的标志不再跟随主题（这是设计意图：圆盘在浅色和深色上都要站得住），`components.js` 没有颜色字面量，`.logo-*` 类删除，预览页的“字体与品牌”视图显示重生成的 PNG。每个界面从扩展自己的文件里加载一个小 SVG，不从网络取任何东西。
4. **The SVGs keep their content-credential metadata.** The chosen files carry a C2PA manifest (about 6 KB each, inside `<metadata>`); the instruction was to install the files as they are, so they ship as they are. Stripping the manifest would not change a pixel; it is a question for Andy, not a change made here.
   **SVG 保留了内容凭证元数据。** 所选文件带有 C2PA 清单（各约 6 KB，在 `<metadata>` 里）；指示是原样安装，所以原样打包。去掉清单不会改动任何像素；这是留给 Andy 的问题，这里没有改。
5. **The UI editor's section gap no longer moves the spacing between Settings sections.** The editor sets `--settings-section-gap` on the root, which Settings reads as each section's `padding-top`; with a rule before every section but the first, that padding is 0 by §2.2 and the rhythm is the rule's fixed 28 / 24 px. The first-section gap (`--settings-first-gap`) still applies, and the designer page, which previews the editor's values with its own stylesheet, is untouched. If the gap should keep working, the rule's margins could read the variable; not done, since §2.2 fixes them.
   **UI 编辑器的分节间距不再改变设置页分节之间的距离。** 编辑器在根元素上设 `--settings-section-gap`，设置页把它读作每节的 `padding-top`；现在除第一节外每节前都有一条线，按第 2.2 节该内边距为 0，节奏由线固定的 28 / 24 px 决定。第一节间距（`--settings-first-gap`）仍然有效，用自己样式表预览编辑器数值的设计器页面未动。若要让这个间距继续起作用，可以让线的外边距读这个变量；没有这么做，因为第 2.2 节把它定死了。
6. **Where the exemption lives.** v3.1 §4 names `scripts/design-audit.mjs`; check g is computed in `scripts/lib/page-audit.mjs`, the in-page half of the same audit, so the one-selector exemption is there, with the driver's header and legend naming it. The `hr` sets `border: 0` only to cancel the browser's default inset border, so no border check needs an exemption.
   **豁免放在哪里。** v3.1 第 4 节点名 `scripts/design-audit.mjs`；检查 g 的计算在 `scripts/lib/page-audit.mjs`，即同一审计在页面内运行的那一半，所以只豁免一个选择器的那一句在那里，驱动端的文件头和图例写明了它。`hr` 设 `border: 0` 只是取消浏览器默认的内凹边框，所以边框检查无需豁免。
7. **Widths.** At 1280 and 960 the rule spans the content column (captured). At 390 the Settings layout stacks the nav above the content; the rule keeps its margins and the column's width there too, by construction, but the audit's screen set has no 390 Settings screen, so that width is not captured in this step (the e2e's narrow state is 390 × 844 and ran green).
   **宽度。** 1280 和 960 时线横跨内容列（已截图）。390 时设置页的导航叠在内容上方；按构造，线在那里同样保留外边距并占内容列的宽度，但审计的屏目录没有 390 的设置页屏，所以这一步没有截到这个宽度（e2e 的窄屏状态是 390 × 844，运行通过）。
