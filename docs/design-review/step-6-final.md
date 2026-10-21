# Steps 5 and 6: every surface on the v2 system, final audit
# 第 5、6 步：所有界面迁入 v2 体系，最终审计

The popup, side panel, download dialogs, Settings and the component preview now run on the same v2 system as the Downloads page. The design audit meets every budget on every screen, in Morning and Dusk, English and Chinese.
弹窗、侧边栏、下载对话框、设置页和组件预览页现在都和下载记录页一样，运行在同一套 v2 体系上。设计审计在每个画面上都满足全部预算，晨暮两套主题、中英两种语言都不例外。

Nothing is committed.
所有改动都没有提交。

## Verification · 验证

| Check · 检查 | Result · 结果 |
|---|---|
| Design audit, 27 screens × 2 themes × 2 languages · 设计审计，27 个画面 × 2 套主题 × 2 种语言 | 108 of 108 pass · 108 张全部达标 |
| Text styles app-wide · 全应用字样数 | 8 per language (budget 8; v1 had 58) · 每种语言 8 种（预算 8；v1 为 58） |
| Colour literals outside token files · 令牌文件之外的颜色字面量 | 0 (v1: 12) · 0（v1 为 12） |
| Unit tests · 单元测试 | 363 of 363 pass · 363 项全部通过 |
| Chrome end-to-end suite · Chrome 端到端测试 | passes: 3 detection cases, 3 UI pages, 3 interaction flows, 15 visual states · 通过：3 个检测用例、3 个界面、3 个交互流程、15 个视觉状态 |

## Audit: v1 against v2, worst value per surface · 审计：v1 对比 v2，各界面最差值

v1 is commit 8758f45, run with the same audit script and fixtures. v2 is the uncommitted working tree.
v1 是 8758f45 提交，用同一个审计脚本和同一组样例数据运行。v2 是尚未提交的工作区。

| Surface · 界面 | Captures v1 / v2 · 截图数 | Passing v1 / v2 · 达标数 | Text styles · 字样 | Left edges · 左边缘 | Nested containers · 嵌套容器 | Contrast failures · 对比度不达标 | Locale leaks · 语言串混 | 1px rules · 1px 线 |
|---|---|---|---|---|---|---|---|---|
| Popup · 弹窗 | 24 / 24 | 0 / 24 | 13 → 6 | 9 → 2 | 14 → 0 | 10 → 0 | 11 → 0 | 12 → 0 |
| Side panel · 侧边栏 | 16 / 16 | 0 / 16 | 15 → 6 | 15 → 2 | 16 → 0 | 9 → 0 | 17 → 0 | 7 → 0 |
| Downloads · 下载记录 | 24 / 24 | 0 / 24 | 15 → 6 | 7 → 2 | 11 → 0 | 9 → 0 | 21 → 0 | 9 → 0 |
| Settings · 设置 | 12 / 16 | 0 / 16 | 21 → 6 | 25 → 3 | 39 → 0 | 16 → 0 | 26 → 0 | 35 → 0 |
| Preview · 组件预览 | 4 / 28 | 0 / 28 | 17 → 6 | 23 → 3 | 64 → 0 | 26 → 0 | 124 → 0 | 57 → 0 |

The v2 audit covers more states than v1 could show: detected media, live downloads, the per-item download dialog, full-page Settings with the engine set up and not set up, and each preview view.
v2 的审计覆盖了 v1 呈现不了的状态：检测到的媒体、进行中的下载、单条下载对话框、引擎已设置与未设置时的整页设置，以及预览页的每个视图。

## Decisions to know about · 需要你知道的决定

- **"Keep What You See." is dropped.** The rename table left it open; it appears nowhere now.
  **“Keep What You See.”已删除。** 改名表把它留给你定，现在任何界面都不再出现。
- **The Dusk pond uses only the cool hues** (pond-soft, lilac, celadon). Rose and apricot turn brown at Dusk's lightness, the muddiness §2.6 rejects. This departs from the five hues of §6.10.
  **暮色主题的池塘层只用冷色调**（淡蓝、淡紫、青瓷绿）。玫瑰色和杏色在暮色的明度下会发褐，正是 §2.6 批评的发脏。这偏离了 §6.10 列出的五种色相。
- **The segment map draws only from real per-part progress.** The engine reports only "74 of 120 parts", so Details shows that count with the speed line; the map stays hidden until the engine sends per-part levels. This avoids the dash row you objected to, and departs from §6.8.
  **分段图只按各分段的真实进度来画。** 引擎目前只报告“已完成 74/120 段”，所以“详情”里显示这个数字和网速曲线；在引擎提供各分段进度之前，分段图不会出现。这避免了你反感的虚线排，同时偏离了 §6.8。
- **Live downloads read percent, time left, speed, then size**, with the status dot and word kept (§6.4). Part counts appear only in Details, per the rename table.
  **进行中的下载依次显示百分比、剩余时间、网速、大小**，保留圆点和状态词（§6.4）。按改名表，分段数只出现在“详情”里。
- **Stopping a download has one name, Cancel**, in the button, the confirmation and the toast.
  **停止下载只有一个叫法：“取消”**，按钮、确认和提示都一样。
- **In the side panel, Download opens the per-item dialog**, as in the popup; v1 started a one-click download with defaults there.
  **侧边栏里的“下载”会打开单条下载对话框**，和弹窗一致；v1 在这里是按默认设置一键下载。
- **Settings:** the engine appears once, in Status. Rows that need the engine show its state until it is ready. "Copy-protected video · Not yet" sits next to "Encrypted streams". The Balanced preset now equals the worker's defaults (8 / 12), so a new install shows it selected. "Ignore files smaller than" tops out at 100,000 KB.
  **设置页：** 本地引擎只在“状态”里出现一次。需要引擎的条目在引擎就绪前显示引擎状态。“带数字版权加密的视频：暂不支持”紧挨着“加密的流媒体”。“平衡”预设改为与后台默认值一致（8 / 12），新安装时会显示为选中。“忽略小于此大小的文件”上限为 100,000 KB。
- **The UI editor only adjusts layout now**, behind Lab → Developer, off by default; it no longer replaces copy, which had no translation.
  **界面编辑器现在只调整版式**，放在“实验室 → 开发者”里，默认关闭；它不再替换文案，因为那些文案没有译文。
- **Chrome's own strings** (the shortcut names and the extension description) use the approved names; the description no longer says HLS or DASH.
  **Chrome 自己显示的文案**（快捷键名称和扩展说明）改用批准的叫法；说明里不再出现 HLS 和 DASH。
- **The mislabeled IBM Plex files from 8758f45 are deleted** with the rest of v1's styling.
  **8758f45 里对错字符范围的 IBM Plex 字体文件已删除**，连同 v1 的其余样式一起。

## Defects found and fixed on the way · 过程中发现并修复的缺陷

- The worker treated "Auto" as Chinese whatever Chrome's language was.
  后台在“自动”模式下一律按中文处理，不看 Chrome 的语言。
- System notifications showed raw engine text and could show folder names on external drives.
  系统通知显示引擎原始报错，还可能带出外接硬盘上的文件夹名。
- The popup's download dialog never opened when the quality probe failed.
  画质探测失败时，弹窗下载对话框打不开。
- One unavailable format dimmed the whole format menu.
  只要有一个格式不可用，整个格式下拉框就会变暗。
- After the extension's background went idle, the Downloads page, popup and side panel showed "stopped responding" for good; all three now reconnect.
  扩展后台空闲后，下载记录页、弹窗和侧边栏会一直显示“已停止响应”；现在三者都会自动重连。
- Settings could stay in the old language if the language changed while it was starting.
  如果语言在设置页启动过程中切换，页面可能停留在旧语言。
- Pressing Escape on a dialog opened from script reported no result instead of "cancel".
  从脚本打开的对话框按 Escape 关闭时，没有返回“取消”。

## Known gaps · 已知不足

- The background script still holds legacy Chinese error text internally. Pages never show it: every error reaches the UI as a code and is localised.
  后台脚本内部仍保留旧的中文报错文本。页面从不显示它们：所有错误都以错误码传到界面，再本地化。
- The Morning pond is faint by physics: at the canvas lightness, sRGB holds only about 0.024 chroma.
  晨色主题的池塘层天生偏淡：在画布这个明度上，sRGB 只容得下约 0.024 的彩度。
- The UI editor page is a developer tool and is not part of the design audit.
  界面编辑器是开发者工具，不在设计审计范围内。
- The Chrome suite opens the UI pages without live downloads; live rows are covered by the design audit's active screens and by unit tests.
  Chrome 端到端测试打开界面时没有进行中的下载；进行中的条目由设计审计的“下载中”画面和单元测试覆盖。

## Where to look · 文件位置

- Before/after sheets: `tools/live/out/design-audit/sheets-final/` (one per surface, theme and language, plus the preview views).
  前后对照图：`tools/live/out/design-audit/sheets-final/`（每个界面、每套主题、每种语言各一张，另有预览页视图）。
- Audit reports: `docs/design-audit/v2-final.md` against `docs/design-audit/v1-baseline.md`.
  审计报告：`docs/design-audit/v2-final.md`，对照 `docs/design-audit/v1-baseline.md`。
- Full-size screenshots: `tools/live/out/design-audit/v2-final/shots/`.
  原尺寸截图：`tools/live/out/design-audit/v2-final/shots/`。
- The system's API: `extension/ui/v2/README.md`.
  体系接口说明：`extension/ui/v2/README.md`。
