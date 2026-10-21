# Step 4: the Downloads page on the new system, waiting for approval
# 第 4 步：下载记录页已按新体系重做，等待批准

Design review §10 says: rebuild the Downloads page only, run the audit, capture Morning and Dusk at 1280 and 960, then stop. This page is that stop.
设计评审第 10 节的要求是：只重做下载记录页，跑审计，截取晨与暮两套主题在 1280 与 960 宽度下的画面，然后停下。本页就是这个停顿点。

Nothing outside the Downloads page has moved to the new system. The popup, side panel, dialog, Settings and preview wait for approval (step 5).
下载记录页以外的界面都没有迁到新体系。弹窗、侧边栏、对话框、设置与预览页等批准后再动（第 5 步）。

## What to review · 请审阅

- **Screenshots:** `tools/live/out/design-audit/v2-downloads/shots/`, three states (history, empty, active download) × Morning and Dusk × 1280 and 960 × English and Chinese, 48 screens in all. Each state also has a `.no-pond` capture for the greyscale check.
  **截图**：`tools/live/out/design-audit/v2-downloads/shots/`，三种状态（有记录、空、下载中）× 晨暮两套主题 × 1280 与 960 两种宽度 × 中英两种语言，共 48 张。每张另有一张去掉池塘层的对照图，用于灰度检查。
- **Audit report:** `docs/design-audit/v2-downloads.md`, against `docs/design-audit/v1-baseline.md`.
  **审计报告**：`docs/design-audit/v2-downloads.md`，对照 `docs/design-audit/v1-baseline.md`。
- **Rename table:** `docs/design-review/rename-table.md`.
  **改名对照表**：`docs/design-review/rename-table.md`。

## Audit: committed v1 against v2 · 审计：已提交的 v1 对比 v2

Worst value over the 8 captures of each state (2 widths × 2 themes × 2 languages). Both runs use the same script, the same fixture and the real engine error text. v1 is commit 8758f45; v2 is the uncommitted working tree on top of it, although its report header also prints 8758f45. Every v1 capture fails; every v2 capture passes.
每种状态取 8 张截图（2 种宽度 × 2 套主题 × 2 种语言）中的最差值。两次运行用的是同一脚本、同一组样例数据，以及真实的引擎报错原文。v1 是 8758f45 提交；v2 是在它之上尚未提交的工作区，只是报告页眉同样印着 8758f45。v1 的截图全部不达标，v2 的截图全部达标。

| Check · 检查项 | Budget · 预算 | v1 history · 有记录 | v2 | v1 empty · 空 | v2 | v1 active · 下载中 | v2 |
|---|---|---|---|---|---|---|---|
| a. Text styles per screen · 单屏字样数 | ≤ 6 | 11 | 6 | 9 | 5 | 15 | 6 |
| Display uses (serif roles) · 衬线展示字用处 | ≤ 2 | 10 | 1 | 2 | 2 | 13 | 1 |
| b. Left text edges · 文字左边缘数 | ≤ 3 | 6 | 2 | 5 | 2 | 7 | 2 |
| c. Nested containers · 容器嵌套 | 0 | 11 | 0 | 0 | 0 | 11 | 0 |
| d. Contrast failures · 对比度不达标 | 0 | 9 | 0 | 2 | 0 | 9 | 0 |
| e. Clipped or covered · 被裁切或遮挡 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| f. Locale leaks · 语言串混 | 0 | 5 | 0 | 0 | 0 | 6 | 0 |
| g. 1px borders or rules · 1px 描边或分隔线 | 0 | 9 | 0 | 5 | 0 | 9 | 0 |
| Pond layer · 池塘层 | present, colour only · 存在且只带色相 | none · 无 | pass · 通过 | none · 无 | pass · 通过 | none · 无 | pass · 通过 |

App-wide text styles: v1 has 52, v2 Downloads uses 7 per language (budget 8). The 12 colour literals outside the token files are all in v1 files (background worker, preview, old component and customisation code) and go in step 5.
全应用字样数：v1 共 52 种，v2 下载记录页每种语言 7 种（预算 8）。令牌文件之外的 12 处颜色字面量全部在 v1 文件里（后台、预览页、旧组件与自定义代码），留到第 5 步处理。

## Decisions for you · 需要你拍板

1. **Progress colour.** The spec mixes lilac into ochre along the shorter hue path, which passes through coral. At 62 to 75 % it comes within ΔE2000 11.3 (Dusk) and 12.3 (Morning) of the vermilion used for Cancel and failures, and within 9.7 of Dusk's Cancel text. The longer path avoids vermilion but meets celadon, the "complete" colour, at about 60 % (ΔE2000 6.6 to 8.7). Lilac into apricot keeps at least 16.5 from vermilion, 15.1 from Dusk's Cancel text and 30 from celadon. The build follows the spec; switching is a one-token change.
   **进度色。** 规范让淡紫沿较短色相路径过渡到赭黄，中途经过珊瑚色。进度在 62% 到 75% 之间时，它与“取消”和失败所用的朱红只差 ΔE2000 11.3（暮）和 12.3（晨），与暮色主题“取消”文字只差 9.7。走较长路径能避开朱红，却会在 60% 左右撞上代表“完成”的青瓷绿（ΔE2000 6.6 到 8.7）。淡紫过渡到杏色，与朱红至少差 16.5，与暮色“取消”文字至少差 15.1，与青瓷绿至少差 30。当前实现按规范走；改用杏色只需换一个令牌。
2. **The rename table** (Proposed rows), including whether "Keep What You See." stays anywhere.
   **改名对照表**中标为“待批准”的条目，包括“Keep What You See.”是否保留。
3. **Wording for downloads Chrome saves itself.** When Chrome reports "access denied", the message says to choose another folder in Settings, but FluxCatch Settings cannot change Chrome's folder. When Chrome fails to write, the message says FluxCatch couldn't finish, though Chrome did the writing. Fixing either needs a separate code.
   **由 Chrome 自己保存的下载，报错措辞。** Chrome 报“无权访问”时，提示让用户去设置里换文件夹，可 FluxCatch 的设置改不了 Chrome 的下载目录；Chrome 写入失败时，提示说 FluxCatch 没能写完，其实写文件的是 Chrome。要修正都得另设错误码。
4. **"Encrypted HLS"** shows *Available* in Settings while its text says it is unsupported.
   **“加密 HLS”**在设置里标为“可用”，说明文字却写不支持。

## Interpretations and deviations · 解读与偏离

- The audit drives Chrome for Testing over the DevTools protocol directly. Playwright and Puppeteer are not installed and the project has no npm dependencies.
  审计直接通过 DevTools 协议驱动 Chrome for Testing。本机没装 Playwright 或 Puppeteer，项目也没有 npm 依赖。
- The Display budget does not count the FluxCatch wordmark, which has its own role.
  展示字预算不计 FluxCatch 字标，它有单独的角色。
- The app-wide budget of 8 is counted per language, because Chinese adds 2 px to three line heights.
  全应用 8 种字样的预算按语言分别计算，因为中文给三种行高各加了 2px。
- Chrome 149 reports `normal` for a placeholder's line height whatever the stylesheet says, even with `!important`. The audit measures a single-line field's placeholder by the field's own line box.
  Chrome 149 对占位文字的行高一律报告 `normal`，样式表怎么写都一样，加 `!important` 也不例外。审计因此按单行输入框自身的行盒来量占位文字。
- Captures hide the overlay scrollbar, which fades in and out between the two pond captures. macOS hides it at rest anyway.
  截图时隐藏浮动滚动条：它会在两次池塘对照截图之间淡入淡出。macOS 静止时本来也不显示它。
- Pond touches sit within ± 0.01 of the canvas lightness, inside the spec's ± 0.02.
  池塘笔触的明度控制在画布明度 ± 0.01 以内，严于规范的 ± 0.02。
- The filter row is hidden while the history is empty. The download folder stays reachable in Settings.
  没有下载记录时隐藏整行筛选。下载文件夹仍可从设置页打开。
- Row actions: "Copy link" replaces "Copy file name"; "Move to Trash" stays, behind a confirmation.
  条目操作：“复制链接”取代“复制文件名”；“移到废纸篓”保留，执行前需确认。
- Instrument Sans is back, as the review specifies, although the earlier round had rejected it as too heavy in Latin.
  按评审要求恢复了 Instrument Sans，尽管上一轮曾因拉丁字母显得臃肿而否掉它。

## Found along the way, not fixed · 过程中发现、尚未修复

- **The fonts in commit 8758f45 are mislabeled.** A parsing error matched the IBM Plex files to the wrong unicode ranges, so v1 Latin text has been rendering in the system font. v2 does not use those files; step 5 removes them.
  **8758f45 提交里的字体文件对错了字符范围。** 解析错误让 IBM Plex 各子集文件对应到错误的 unicode 范围，所以 v1 的拉丁文字其实一直用系统字体显示。v2 不用这些文件，第 5 步会删掉。
- **The review guessed two locale sources; there is one.** The leak comes from the v1 translation pass, which matches whole text nodes against patterns anchored at both ends. The source line puts " · 1 小时前" in one node, so the rule for "1 小时前" never fires. v2 formats every string from one table and Intl.
  **评审猜测有两个语言来源，实际只有一个。** 串混出在 v1 的翻译流程：它拿首尾锚定的正则去匹配整个文本节点，而来源行把“ · 1 小时前”放在同一个节点里，“1 小时前”的规则因此永远匹配不上。v2 的所有文案都出自同一张表和 Intl。
- **The background worker ignores Chrome's language on Auto.** It resolves the language without passing Chrome's UI language, so Auto means Chinese in the worker even on English Chrome. This affects notifications.
  **后台在“自动”模式下不看 Chrome 的界面语言。** 它判断语言时没有传入 Chrome 的界面语言，所以即使 Chrome 是英文，后台在“自动”下也按中文处理，系统通知因此受影响。
- **System notifications still show raw engine text**, which §7 forbids, and can include folder names from external drives.
  **系统通知仍显示引擎原始报错**，这违反第 7 节，而且可能带出外接硬盘上的文件夹名。
- **The side panel and popup still show untranslated engine progress text.**
  **侧边栏和弹窗仍会显示未翻译的引擎进度文字。**
- **The popup download dialog throws when the quality probe fails** (popup.js:568), so it never opens in that case.
  **画质探测失败时，弹窗下载对话框会抛错**（popup.js:568），对话框因此打不开。
- **The Morning pond is faint by physics.** At the canvas lightness the sRGB gamut allows chroma of only about 0.024, so the touches read as a light haze. The audit measures them as present and colour-only.
  **晨色主题的池塘层天生偏淡。** 在画布这个明度上，sRGB 色域只容得下约 0.024 的彩度，笔触看上去只是一层淡淡的雾。审计测得它存在，而且只带色相。
