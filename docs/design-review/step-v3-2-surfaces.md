# Step v3-2: the pond on every surface, state-coloured progress, the full-page grid and lead frames
# 第 v3-2 步：池塘铺满所有界面、进度条改为状态色、整页网格与行首框

Design review v3 §5 step 2: apply the layer to every surface with the masking rules of §3.1, then §3.2 (progress colours), §3.4 (the full-page grid) and §3.5 (lead frames). All four are done; this page is the stop before step 3 (§3.6 header, §3.7 one capture pipeline, §3.8 copy, §3.9 ring, §3.10 icon), which has not started.
设计评审 v3 第 5 节第 2 步：按第 3.1 节的遮罩规则把图层铺到所有界面，然后做第 3.2 节（进度色）、第 3.4 节（整页网格）和第 3.5 节（行首框）。四项都已完成；本页是进入第 3 步（第 3.6 节页眉、第 3.7 节统一截图流程、第 3.8 节文案、第 3.9 节校验环、第 3.10 节图标）之前的停顿点，第 3 步没有开始。

## What to review · 请审阅

- **Captures:** `tools/live/out/design-audit/v3-step2/shots/`, every surface, Morning and Dusk, English and Chinese (108 screens, DPR 2), with the audit report in `report.md` beside them. The same run's `.no-pond` captures show each screen with the layer hidden.
  **截图**：`tools/live/out/design-audit/v3-step2/shots/`，所有界面、晨暮两套主题、中英两种语言（108 屏，DPR 2），审计报告 `report.md` 在旁边。同一次运行的 `.no-pond` 截图是隐藏图层后的对照。
- **The §3.1 numbers per surface:** `docs/design-review/pond-reference/build-metrics-v3-step2.txt` (table below).
  **各界面的第 3.1 节指标**：`docs/design-review/pond-reference/build-metrics-v3-step2.txt`（下表）。
- **Before and after:** step 1's `build-contact-sheet.png` still shows the Downloads empty state against the v2 build; the other surfaces' "before" is the audit run of 2026-10-22 in `tools/live/out/design-audit/run/shots/` (the atlas). Step 4 regenerates the atlas with before/after pairs for every surface.
  **前后对照**：第 1 步的 `build-contact-sheet.png` 仍是下载记录页空状态与 v2 版本的对照；其它界面的“改前”是 2026-10-22 那次审计（`tools/live/out/design-audit/run/shots/`，即图集）。第 4 步重出图集时会给每个界面配上前后对照。

## What changed · 改了什么

### §3.1 The layer on every surface · 图层铺到所有界面

- `pond.js` now holds the v3 layer only. The v2 planner, `mountPond`, the `--touch-*` and `--mask-on` tokens, the CSS column mask and the empty-state opening (`data-open`, `--open-x`), and `pondZones` / `setPondOpening` in media.js are gone.
  `pond.js` 现在只有 v3 图层。v2 规划器、`mountPond`、`--touch-*` 与 `--mask-on` 令牌、CSS 内容列遮罩和空状态开口（`data-open`、`--open-x`），以及 media.js 里的 `pondZones` / `setPondOpening` 都已删除。
- Every page mounts `mountPondLayer` with its own content boxes, read from the live layout through `contentBoxes(selectors)`: the popup masks the header, the view bar, each status line with text, the list headers, the lists, each text block of an empty state and the footer links; the side panel the same plus the focus panel; Settings the header, the title block, the nav and the whole content column; the component preview the header, the title, the view switch and every block of the shown view; Downloads the header, the title block, the link row, each status line, the filter row, the live and history lists and each text block of the empty state. Open dialogs, menus and toasts are masked on every page.
  每个页面用自己的内容框挂载 `mountPondLayer`，内容框由 `contentBoxes(selectors)` 从当前布局读取：弹窗遮住页眉、视图栏、每条有文字的状态行、列表头、列表、空状态的每个文字块和页脚链接；侧边栏同样，再加焦点面板；设置页遮住页眉、标题块、导航和整个内容列；组件预览遮住页眉、标题、视图切换和当前视图的每一块；下载记录页遮住页眉、标题块、链接行、每条状态行、筛选行、下载中与历史两个列表和空状态的每个文字块。打开的对话框、菜单和提示在所有页面上都被遮住。
- The mask is painted into the layer with destination-out (the box, its four sides and four corners, each a gradient from 1 at the edge to 0 at 64 px: `column_mask`'s `clip(d / feather)`), so it is cheap enough to redraw once per frame while the page scrolls under the fixed layer. Where feathers overlap the factors multiply.
  遮罩用 destination-out 画进图层（框本身、四条边和四个角，各是一条从边缘 1 到 64 px 处 0 的渐变，即 `column_mask` 的 `clip(d / feather)`），足够便宜，页面在固定图层上滚动时每帧重画一次。羽化重叠处系数相乘。
- The Downloads page shows the layer in every state now, not only the empty state.
  下载记录页现在在所有状态下都显示图层，不再只在空状态。

### §3.2 Progress colour · 进度色

- The `color-mix(in oklch, lilac, ochre p%)` fill is deleted. The bar is the state's colour: queued harbour, downloading pond, paused lilac at 60 %, finishing (remuxing: merging, converting) ochre, complete celadon for 1.2 s and then the fade-out (the existing finish hold), failed vermilion. The tip highlight and the 3 % shimmer stay on the downloading bar only. The parts map in Details takes the downloading colour.
  `color-mix(in oklch, lilac, ochre p%)` 的填充已删除。进度条就是状态色：排队港灰、下载中池蓝、暂停淡紫 60%、收尾（remuxing：合并、转换）赭黄、完成青瓷 1.2 秒后淡出（沿用现有的收尾保持），失败朱红。顶端高光和 3% 的微光只留在下载中的进度条上。详情里的分段图用下载中的颜色。
- `rows.js` gains `barState(job, finishing)`; a remuxing job now reads `finishing` instead of `queued`. The component preview's live rows show the whole sequence.
  `rows.js` 新增 `barState(job, finishing)`；remuxing 状态现在是 `finishing` 而非 `queued`。组件预览的实时行能看到完整序列。

### §3.4 Full-page grid · 整页网格

- On Downloads the link field, the Download button, the filter row and the search now start on the text column (x = 272 at 1280), with the title and every row's text. The lead column holds only the BrandMark logo, the status dot and the row leads. The link glyph sits inside its field like the search glyph. Settings already did this.
  下载记录页的链接输入框、下载按钮、筛选行和搜索框现在都从文字列开始（1280 宽时 x = 272），与标题和每一行的文字对齐。首列只放 BrandMark 的标志、状态点和每行的行首。链接图标像搜索图标一样放在输入框内。设置页本来就是这样。

### §3.5 Lead frames · 行首框

- On full pages the lead is a 56 × 32, radius-6 frame: the media's own thumbnail when the engine has one, otherwise the sunken ground with the 16 px type glyph centred (`span.lead-frame[data-indicator]`, an indicator, not a container). The popup and side panel keep the bare 20 px glyph. Row padding on full pages is 14 px (10 px compact); the popup and side panel keep 12 px (8 px compact).
  整页上的行首是 56 × 32、圆角 6 的框：引擎有缩略图时放缩略图，否则是凹陷的地色加居中的 16 px 类型图标（`span.lead-frame[data-indicator]`，是指示物，不算容器）。弹窗和侧边栏保留裸露的 20 px 图标。整页的行内边距为 14 px（紧凑 10 px）；弹窗和侧边栏保留 12 px（紧凑 8 px）。

## The §3.1 metrics, every surface · 第 3.1 节指标，所有界面

Measured on the audit run's captures (DPR 2) in OKLCH against the canvas token, as in step 1. Full pages are judged in their gutters (the §3.1 acceptance region); the popup and side panel have no gutters, so their rows are whole-frame numbers for information. The seed is the audit profile's own (a fresh install per run), not the script's.
按第 1 步的办法，在审计运行的截图（DPR 2）上以 OKLCH 对画布令牌测得。整页在两侧留白里度量（第 3.1 节的验收区域）；弹窗和侧边栏没有留白，它们的行是整帧数字，仅供参考。seed 是审计配置文件自己的（每次运行都是新安装），不是脚本的那个。

**Reading the table.** On the full pages with real gutters (1280 and 1440 wide, 200 and 280 px each side), p95 |ΔL| meets its target on every screen (Morning 0.018 to 0.021 against 0.03, Dusk 0.036 to 0.045 against 0.05). Chroma coverage in those gutters is 4.3 % to 5.4 % in Morning (13 of 13 screens inside the 4 % to 12 % band) and 2.2 % to 7.7 % in Dusk (1 of 13 inside the band): the same seed dependence step 1 measured, with this run's seed landing low in Dusk. At 960 wide the gutters are 40 px, inside the content column's 64 px feather, so the layer is almost absent there by construction (0.1 % to 2.5 % Morning, 0.3 % to 4.9 % Dusk); the band cannot apply to a gutter narrower than the feather. The popup and side panel show the layer only in the empty area between content, so their coverage over the whole frame is small, and the p95 within the layer's own footprint says what its touches do to value (Morning under 0.04, Dusk under 0.07 where the layer shows at all; dialogs mask nearly everything).
**怎么读这张表。** 在有真正留白的整页上（1280 和 1440 宽，两侧各 200 和 280 px），每张画面的 p95 |ΔL| 都在目标内（晨色 0.018 到 0.021，目标 0.03；暮色 0.036 到 0.045，目标 0.05）。这些留白里的彩度覆盖率晨色为 4.3% 到 5.4%（13 张中 13 张落在 4% 到 12% 区间内），暮色为 2.2% 到 7.7%（13 张中 1 张在区间内）：与第 1 步量到的 seed 依赖一致，这次运行的 seed 在暮色下偏低。960 宽时留白只有 40 px，落在内容列 64 px 的羽化之内，图层在那里按构造几乎不存在（晨色 0.1% 到 2.5%，暮色 0.3% 到 4.9%）；比羽化还窄的留白套不上这条区间。弹窗和侧边栏只在内容之间的空白里显示图层，所以整帧覆盖率很小，而图层自身占位内的 p95 说明笔触对明度的影响（有图层处晨色低于 0.04、暮色低于 0.07；对话框几乎遮住全部）。

| screen | theme | lang | region | coverage ΔC>0.015 | p95 |ΔL| | mean |ΔL| | pond footprint (audit, vs no-pond) |
|---|---|---|---|---|---|---|---|
| popup-media | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 1.1 % | 0.024 | 0.007 | 11.9 % |
| popup-jobs | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 1.2 % | 0.025 | 0.007 | 12.2 % |
| popup-link-dialog | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.0 % | 0.004 | 0.002 | 0.4 % |
| sidepanel | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 3.2 % | 0.033 | 0.010 | 18.4 % |
| popup-results | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.0 % | 0.004 | 0.002 | 0.3 % |
| popup-media-dialog | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.0 % | 0.003 | 0.002 | 0.1 % |
| sidepanel-link-dialog | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 1.0 % | 0.025 | 0.008 | 10.7 % |
| sidepanel-results | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 3.0 % | 0.035 | 0.011 | 13.5 % |
| downloads-1280 | morning | en | margins x<200, x≥1080 (200 px each) | 4.8 % ✓ | 0.019 ✓ | 0.003 | 28 % |
| downloads-960 | morning | en | margins x<40, x≥920 (40 px each) | 0.3 % ✗ | 0.007 ✓ | 0.001 | 6.9 % |
| settings-1280 | morning | en | margins x<200, x≥1080 (200 px each) | 4.8 % ✓ | 0.019 ✓ | 0.003 | 27.9 % |
| settings-960 | morning | en | margins x<40, x≥920 (40 px each) | 0.1 % ✗ | 0.007 ✓ | 0.001 | 4.5 % |
| settings-full-1280 | morning | en | margins x<200, x≥1080 (200 px each) | 5.4 % ✓ | 0.020 ✓ | 0.003 | 24.5 % |
| preview | morning | en | margins x<280, x≥1160 (280 px each) | 4.9 % ✓ | 0.019 ✓ | 0.003 | 28.4 % |
| preview-text | morning | en | margins x<280, x≥1160 (280 px each) | 5.1 % ✓ | 0.020 ✓ | 0.003 | 29.2 % |
| preview-controls | morning | en | margins x<280, x≥1160 (280 px each) | 4.9 % ✓ | 0.020 ✓ | 0.003 | 27.3 % |
| preview-rows | morning | en | margins x<280, x≥1160 (280 px each) | 5.1 % ✓ | 0.020 ✓ | 0.003 | 26 % |
| preview-feedback | morning | en | margins x<280, x≥1160 (280 px each) | 4.9 % ✓ | 0.020 ✓ | 0.003 | 28.2 % |
| preview-overlays | morning | en | margins x<280, x≥1160 (280 px each) | 4.9 % ✓ | 0.020 ✓ | 0.003 | 28.8 % |
| preview-overlays-item | morning | en | margins x<280, x≥1160 (280 px each) | 4.9 % ✓ | 0.020 ✓ | 0.003 | 28.8 % |
| popup-media | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.5 % | 0.055 | 0.017 | 10.6 % |
| popup-jobs | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.6 % | 0.058 | 0.018 | 10.8 % |
| popup-link-dialog | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.0 % | 0.003 | 0.002 | 0.2 % |
| sidepanel | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 2.4 % | 0.067 | 0.019 | 19.9 % |
| popup-results | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.1 % | 0.031 | 0.009 | 4.9 % |
| popup-media-dialog | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.0 % | 0.000 | 0.000 | 0 % |
| sidepanel-link-dialog | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.1 % | 0.034 | 0.012 | 7.2 % |
| sidepanel-results | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 2.4 % | 0.072 | 0.023 | 14.4 % |
| downloads-1280 | dusk | en | margins x<200, x≥1080 (200 px each) | 3.4 % ✗ | 0.043 ✓ | 0.006 | 29.5 % |
| downloads-960 | dusk | en | margins x<40, x≥920 (40 px each) | 0.3 % ✗ | 0.015 ✓ | 0.002 | 8.5 % |
| settings-1280 | dusk | en | margins x<200, x≥1080 (200 px each) | 3.4 % ✗ | 0.044 ✓ | 0.007 | 29.4 % |
| settings-960 | dusk | en | margins x<40, x≥920 (40 px each) | 0.3 % ✗ | 0.015 ✓ | 0.002 | 5.5 % |
| settings-full-1280 | dusk | en | margins x<200, x≥1080 (200 px each) | 3.4 % ✗ | 0.036 ✓ | 0.005 | 27.8 % |
| preview | dusk | en | margins x<280, x≥1160 (280 px each) | 2.9 % ✗ | 0.044 ✓ | 0.007 | 29.9 % |
| preview-text | dusk | en | margins x<280, x≥1160 (280 px each) | 3.0 % ✗ | 0.045 ✓ | 0.007 | 30.6 % |
| preview-controls | dusk | en | margins x<280, x≥1160 (280 px each) | 2.9 % ✗ | 0.043 ✓ | 0.006 | 27.9 % |
| preview-rows | dusk | en | margins x<280, x≥1160 (280 px each) | 2.9 % ✗ | 0.044 ✓ | 0.006 | 26.5 % |
| preview-feedback | dusk | en | margins x<280, x≥1160 (280 px each) | 2.8 % ✗ | 0.043 ✓ | 0.006 | 28.9 % |
| preview-overlays | dusk | en | margins x<280, x≥1160 (280 px each) | 2.9 % ✗ | 0.043 ✓ | 0.006 | 29.8 % |
| preview-overlays-item | dusk | en | margins x<280, x≥1160 (280 px each) | 2.9 % ✗ | 0.043 ✓ | 0.006 | 29.8 % |
| downloads-empty-1280 | morning | en | margins x<200, x≥1080 (200 px each) | 4.3 % ✓ | 0.021 ✓ | 0.003 | 28.9 % |
| downloads-empty-960 | morning | en | margins x<40, x≥920 (40 px each) | 2.5 % ✗ | 0.014 ✓ | 0.002 | 22.6 % |
| downloads-empty-1280 | dusk | en | margins x<200, x≥1080 (200 px each) | 7.7 % ✓ | 0.045 ✓ | 0.007 | 30.5 % |
| downloads-empty-960 | dusk | en | margins x<40, x≥920 (40 px each) | 4.9 % ✓ | 0.030 ✓ | 0.005 | 24.6 % |
| popup-downloads-active | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.7 % | 0.023 | 0.011 | 11.8 % |
| sidepanel-active | morning | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.1 % | 0.022 | 0.009 | 5 % |
| downloads-active-1280 | morning | en | margins x<200, x≥1080 (200 px each) | 4.4 % ✓ | 0.018 ✓ | 0.003 | 29.3 % |
| downloads-active-960 | morning | en | margins x<40, x≥920 (40 px each) | 0.1 % ✗ | 0.014 ✓ | 0.002 | 5.6 % |
| settings-active-1280 | morning | en | margins x<200, x≥1080 (200 px each) | 5.2 % ✓ | 0.020 ✓ | 0.003 | 25.6 % |
| popup-downloads-active | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.0 % | 0.049 | 0.019 | 12.8 % |
| sidepanel-active | dusk | en | whole frame vs the no-pond capture; p95 within the layer's footprint | 0.7 % | 0.046 | 0.012 | 6 % |
| downloads-active-1280 | dusk | en | margins x<200, x≥1080 (200 px each) | 2.2 % ✗ | 0.043 ✓ | 0.007 | 31 % |
| downloads-active-960 | dusk | en | margins x<40, x≥920 (40 px each) | 0.5 % ✗ | 0.028 ✓ | 0.004 | 6.9 % |
| settings-active-1280 | dusk | en | margins x<200, x≥1080 (200 px each) | 2.3 % ✗ | 0.045 ✓ | 0.006 | 25.8 % |


## Tests and checks · 测试与检查

- `node --test tests/*.test.js`: 374 pass (the worker smoke test included, with Chrome idle).
- `npm run test:e2e`: passed (8 detection cases, 3 UI pages, 3 interaction flows, 15 visual states).
- `node scripts/design-audit.mjs --label v3-step2`: every budget other than the pond column passes on all 108 screens; the pond column fails on 93 of them by design, because the audit still carries the v2 rule ("visible as colour, gone in greyscale": p95 ΔL* ≤ 1.5) that v3 §4 erratum 1 withdraws (the other 15 are dialog screens, where the layer is masked almost entirely). §5 step 4 replaces the rule with the §3.1 acceptance and the composited-background contrast.
  `node scripts/design-audit.mjs --label v3-step2`：108 屏上除池塘一列外所有预算通过；池塘一列有 93 屏按设计不通过，因为审计里仍是 v2 的规则（“彩色可见、灰度消失”：p95 ΔL* ≤ 1.5），v3 第 4 节勘误 1 已撤回它（其余 15 屏是对话框画面，图层几乎被整个遮住）。第 5 节第 4 步会用第 3.1 节的验收标准和合成背景对比度替换这条规则。

## Interpretations and deviations · 解读与偏离

- **Scrolling.** The review asks for one render per theme per viewport bucket, which fixes the layer to the viewport; the boxes scroll over it. So the mask is redrawn once per frame on scroll from the current boxes (the bitmap stays cached), and a page calls `refresh()` after a render that moved its boxes. Only the mask is cheap enough for that, which is why it is painted with gradients rather than per pixel; the two are the same function (`maskFactor` is the per-pixel form, tested against the painted one's geometry).
  **滚动。** 评审要求每个主题、每个视口桶只渲染一次，图层因此固定在视口上，内容框在它上面滚动。所以滚动时每帧按当前内容框重画一次遮罩（位图仍缓存），页面在重排移动了内容框之后调用 `refresh()`。只有遮罩便宜到可以这样做，所以它用渐变而不是逐像素画；两者是同一个函数（`maskFactor` 是逐像素形式，测试拿它对照绘制版的几何）。
- **Overlapping feathers multiply.** Step 1 took the smaller factor; destination-out compositing multiplies. The script has one box, so either reading is consistent with it; the multiplied form is what the GPU path gives for free. Between two 20 px-apart text blocks the layer is at (20/64)² instead of 20/64.
  **羽化重叠处相乘。** 第 1 步取较小值；destination-out 合成是相乘。脚本只有一个框，两种读法都与它一致；相乘是 GPU 路径免费给出的形式。两个相距 20 px 的文字块之间，图层是 (20/64)² 而不是 20/64。
- **Settings masks its whole content column** as one box: every row of it is content, and the list of individual rows would change with every setting. The gutters are what the review's acceptance measures.
  **设置页把整个内容列当作一个框**：它的每一行都是内容，逐行列框会随每个设置变化。评审的验收量的是两侧留白。
- **The popup's layer** plans at the popup's own area (about 850 touches at 372 × 600 after rejection sampling, 3 drifts) and shows in the empty area between the content and the footer; with media listed it is masked almost entirely, as the review expects for a surface without margins.
  **弹窗的图层**按弹窗自己的面积规划（372 × 600 下拒绝采样后约 850 个笔触、3 条漂带），显示在内容与页脚之间的空白里；列出媒体后几乎被整个遮住，与评审对无留白界面的预期一致。
- **Failed bars.** A live row rarely shows `failed` (the row turns into a history row with a Failed status), but the state and colour exist for the moment between the two.
  **失败的进度条。** 实时行很少显示 `failed`（它会变成带“失败”状态的历史行），但两者之间的那一刻有这个状态和颜色。
- **The link glyph** moved inside its field (16 px, 10 px from the field's edge, as the search glyph), because the review leaves the lead column to the BrandMark logo and the row glyphs.
  **链接图标**移进了输入框内（16 px，距框边 10 px，与搜索图标一致），因为评审把首列只留给 BrandMark 标志和行首图标。

## Found along the way, not fixed · 过程中发现、尚未修复

- The audit's `pond.present` still reads `background-image`; with a canvas layer it reports "present, no image" and falls back to hiding the element, which works. Step 4 should read the canvas and measure contrast against the composited background.
  审计的 `pond.present` 仍读 `background-image`；图层是 canvas 时它报告“存在、无图”，然后退回到隐藏整个元素，能用。第 4 步应改为读 canvas，并对合成背景量对比度。
- The §3.1 margin band stays seed-dependent (step 1's sweep). Each audit run is a fresh install with its own seed; step 4 has to pin it or measure the unmasked page.
  第 3.1 节的页边区间仍随 seed 变化（见第 1 步的扫描）。每次审计都是带自己 seed 的新安装；第 4 步得固定 seed 或改量不加遮罩的整页。
- `tests/background-smoke.test.js` (the worker, untouched by this step) is timing-sensitive: it passes on its own and under the full suite when the machine is idle, and fails when Chrome is running beside it.
  `tests/background-smoke.test.js`（后台 worker，本步未动）对时间敏感：单独跑和机器空闲时全量跑都通过，旁边有 Chrome 在跑时会失败。
