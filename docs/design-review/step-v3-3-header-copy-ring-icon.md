# Step v3-3: the header at scroll 0, one capture pipeline, copy, the error ring and the 16 px icon
# 第 v3-3 步：滚动位置 0 的页眉、统一截图流程、文案、校验环与 16 px 图标

Design review v3 §5 step 3: §3.6 (the sticky header band), §3.7 (two capture pipelines), §3.8 (copy), §3.9 (the validation ring) and §3.10 (the app icon at 16 px). All five are done; this page is the stop before step 4 (the audit's §3.1 acceptance checks, the composited-background contrast, the header-at-scroll-0 assertion, the atlas), which has not started.
设计评审 v3 第 5 节第 3 步：第 3.6 节（粘性页眉的色带）、第 3.7 节（两条截图流程）、第 3.8 节（文案）、第 3.9 节（校验环）和第 3.10 节（16 px 应用图标）。五项都已完成；本页是进入第 4 步（审计加入第 3.1 节验收、合成背景对比度、滚动位置 0 的页眉断言、重出图集）之前的停顿点，第 4 步没有开始。

## What to review · 请审阅

- **Captures:** `tools/live/out/design-audit/v3-step3/shots/` (108 screens, DPR 2) and the e2e matrix `e2e/artifacts/phase-b-matrix/` (15 states, now DPR 2 too). The Settings and Downloads captures show the header as the canvas itself at the top: the pond runs under it.
  **截图**：`tools/live/out/design-audit/v3-step3/shots/`（108 屏，DPR 2）和 e2e 矩阵 `e2e/artifacts/phase-b-matrix/`（15 个状态，现在也是 DPR 2）。设置页和下载记录页顶部的页眉就是画布本身，池塘从它下面穿过。
- **The icon:** `extension/icons/icon16.png`, from `extension/icons/fluxcatch-mark-16.svg`; the component preview's "Type and brand" view shows it beside the other sizes.
  **图标**：`extension/icons/icon16.png`，来自 `extension/icons/fluxcatch-mark-16.svg`；组件预览的“字体与品牌”视图里能和其它尺寸并排看到。
- **The error ring:** the e2e state `options-validation` and the preview's "Controls" view.
  **校验环**：e2e 的 `options-validation` 状态和预览的“控件”视图。

## What changed · 改了什么

### §3.6 The header at scroll 0 · 滚动位置 0 的页眉

- The band is `.topbar::before`: at scroll position 0 it has opacity 0, so the header is the canvas (and the pond under it); over the first 24 px of scroll the tint (75 % surface) and the mist fade in. The fade is a scroll-driven animation (`animation-timeline: scroll(root)`, `animation-range: 0 24px`), so the band's state is the scroll position itself and no capture can catch a stale band; the popup names its own scroller (`.popup-main`) as the timeline. Where scroll-driven animations are unsupported, the pages' existing `data-scrolled` listeners carry the state. The old `background: var(--canvas)` band is gone.
  色带是 `.topbar::before`：滚动位置 0 时不透明度为 0，页眉就是画布（以及它下面的池塘）；滚动的前 24 px 里，着色（75% surface）和薄雾淡入。淡入是滚动驱动的动画（`animation-timeline: scroll(root)`，`animation-range: 0 24px`），色带的状态就是滚动位置本身，任何截图都不可能抓到过期的色带；弹窗把自己的滚动容器（`.popup-main`）命名为时间线。不支持滚动驱动动画的环境里，各页面原有的 `data-scrolled` 监听继续承担状态。原来的 `background: var(--canvas)` 色带已删除。
- Under reduced motion no animation runs at all (the e2e's reduced-motion state counts running animations, scroll-driven ones included): the band then follows the pages' `data-scrolled` state and appears whole once the page has scrolled, without the 24 px fade.
  减少动态效果时完全不运行动画（e2e 的减少动态效果状态会数运行中的动画，滚动驱动的也算）：色带此时跟随各页面的 `data-scrolled` 状态，页面一滚动就整体出现，没有 24 px 的淡入。
- The audit's assertion (header background alpha 0 and no box-shadow at scrollY = 0) is step 4's, as §5 lists it.
  审计里的断言（scrollY = 0 时页眉背景 alpha 为 0、无阴影）按第 5 节的安排留在第 4 步。

### §3.7 One capture pipeline · 统一截图流程

- Why the two disagreed: the e2e capture of Settings (p. 86) was taken after the suite had scrolled the page, and the band was a JS state (`data-scrolled`) that the capture's own scroll-to-top had not yet cleared, so the band showed at scroll 0. The audit's capture never scrolled. The "dimmer nav items" are the Chinese UI at DPR 1 against the English UI at DPR 2 (p. 41 is `settings-1280 dusk en`, p. 86 is the zh matrix): the same colours, thinner strokes. Neither was a stale build or a different stylesheet.
  两者为何不一致：e2e 的设置页截图（第 86 页）是在套件滚动过页面之后拍的，色带是 JS 状态（`data-scrolled`），截图自己的回到顶部还没来得及清掉它，所以滚动位置 0 也显示色带；审计的截图从未滚动。“导航项偏暗”是 DPR 1 的中文界面对 DPR 2 的英文界面（第 41 页是 `settings-1280 dusk en`，第 86 页是中文矩阵）：颜色相同，笔画更细。两者都不是旧构建或不同样式表。
- Now both runners load the same extension directory (`FLUXCATCH_EXTENSION_DIR`, else `extension/`) and stamp the same identity through `scripts/lib/build-identity.mjs` (the short hash, or "uncommitted" while the worktree carries changes); the audit report's header and `report.json`, and the e2e's `latest.json`, state the commit and the directory. The e2e matrix captures at DPR 2 and waits for the pond layer to settle before each capture, as the audit does. The §3.6 change removes the state that made them differ.
  现在两条流程读同一个扩展目录（`FLUXCATCH_EXTENSION_DIR`，否则 `extension/`），通过 `scripts/lib/build-identity.mjs` 盖同一个标识（短哈希，工作树有改动时为“uncommitted”）；审计报告的页眉和 `report.json`、e2e 的 `latest.json` 都写明提交和目录。e2e 矩阵改为 DPR 2 截图，并像审计一样在每张截图前等池塘层就绪。第 3.6 节的改动去掉了让两者不同的那个状态。

### §3.8 Copy · 文案

- The YouTube row's status word is "Needs an extra component / 需要额外组件" (was "Needs yt-dlp / 缺少 yt-dlp"): the engine is Ready and what is missing is a separate component, so "Needs the local engine" would be false. The install steps under Local engine still name the tool, as the install guide does.
  YouTube 行的状态词改为“Needs an extra component / 需要额外组件”（原为“Needs yt-dlp / 缺少 yt-dlp”）：引擎已就绪，缺的是一个独立组件，所以“需要本地引擎”并不属实。“本地引擎”下的安装步骤和安装指南仍会提到这个工具的名字。
- Keyboard shortcuts: Chrome names them for the platform in `commands.getAll()` (glyphs on a Mac, "Alt+Shift+F" elsewhere); Settings now asks Chrome for the platform (`runtime.getPlatformInfo`) and spells any glyph string out on Windows and Linux (`shortcutLabel`, with Command read as Ctrl, Chrome's own counterpart), so the glyphs can never leak there.
  键盘快捷键：Chrome 在 `commands.getAll()` 里已按平台命名（Mac 上是符号，其它平台是“Alt+Shift+F”）；设置页现在向 Chrome 询问平台（`runtime.getPlatformInfo`），在 Windows 和 Linux 上把任何符号串拼成名字（`shortcutLabel`，Command 读作 Ctrl，即 Chrome 自己的对应键），符号不可能漏到那里。
- The rename table carries a status line: the Proposed Settings terms listed in step 1 were approved with that step, so they stand as applied.
  改名表加了一行状态：第 1 步列出的“待批准”设置页词条随该步一起获批，视为已应用。

### §3.9 The validation ring · 校验环

- An invalid field at rest draws the focus ring's construction in the error colour: 2 px `--ring-invalid` (vermilion at 60 %) inside a 6 px `--halo-invalid` (18 %), both tokens in every theme block (Dusk uses `--vermilion-text`). The 3 px halo is gone. The spec test and the audit's rule g treat this ring as they treat the focus ring (not a border), since the review asks for it.
  无效字段静止时画出聚焦环的构造、换成错误色：2 px `--ring-invalid`（朱红 60%）套在 6 px `--halo-invalid`（18%）里，两个令牌在每个主题块里都有（暮色用 `--vermilion-text`）。3 px 的光晕已删除。规范测试和审计的 g 规则对这个环与聚焦环同等对待（不算边框），因为评审要求它存在。

### §3.10 The 16 px icon · 16 px 图标

- `icons/fluxcatch-mark-16.svg`: the cream disc, the pad and the blossom; no ring, no ripples. `scripts/build-icons.mjs` renders the PNGs with Chrome for Testing (transparent outside the disc), 16 from that file and the other sizes from `fluxcatch-mark.svg`; only `icon16.png` was regenerated. The manifest's `icons.16` and the action icon pick it up.
  `icons/fluxcatch-mark-16.svg`：奶白圆盘、荷叶和花，没有环和涟漪。`scripts/build-icons.mjs` 用 Chrome for Testing 渲染 PNG（圆盘之外透明），16 来自这个文件，其它尺寸来自 `fluxcatch-mark.svg`；本步只重新生成了 `icon16.png`。清单里的 `icons.16` 和工具栏图标都会用到它。

## Tests and checks · 测试与检查

- `node --test tests/*.test.js`: 375 pass (the worker smoke test included, with Chrome idle).
- `npm run test:e2e`: passed (8 detection cases, 3 UI pages, 3 interaction flows, 15 visual states, the matrix now at DPR 2) on the fifth run of this step, with the machine's load back under 4. Of the four earlier runs, the first failed on the reduced-motion state (it counts running animations and saw the scroll-driven band, hence the reduced-motion rule above) and three failed on `pornhub-ladder`, a site-adapter case this step does not touch, with two timing-dependent symptoms under a load average above 5 (the card titled from the worker's flashvars extraction instead of the social-card title, and once a toolbar-badge timeout); see below.
- `node scripts/design-audit.mjs --label v3-step3`: 108 screens, header `commit uncommitted · extension extension`; every budget other than the pond column passes on all of them (rule g included, with the error ring exempted as the focus ring is); the pond column still fails by design on 94 screens (the withdrawn v2 rule, step 4).

## Interpretations and deviations · 解读与偏离

- The band's tint is 75 % surface with no backdrop blur: §3.6 names the tint and the mist, nothing else. Content scrolling under the header shows faintly through the 25 %.
  色带的着色是 75% surface，没有背景模糊：第 3.6 节只写了着色和薄雾。在页眉下滚动的内容会透过那 25% 淡淡显出来。
- "One capture pipeline" is read as one identity, one pixel density and one settling rule for both runners, with the state that differed removed, rather than one runner driving both: the e2e matrix is a side effect of its interaction flows (confirm, validation, engine fixtures) and the audit's screens are its own, so merging the two runners would move the interaction assertions into the audit. If you want the runners merged outright, that is a step of its own.
  “统一截图流程”理解为两条流程用同一个标识、同一个像素密度、同一条等待就绪的规则，并去掉导致差异的那个状态，而不是让一个程序驱动两者：e2e 矩阵是交互流程（确认框、校验、引擎样例）的副产品，审计的画面是它自己的，合并两者意味着把交互断言搬进审计。如果您要的就是把两个程序合而为一，那是单独的一步。
- Shortcut names: Chrome already localises them per platform, so `shortcutLabel` only matters for a glyph string that reaches a non-Mac platform (it should not, but the review's rule is now enforced in code and tested).
  快捷键名：Chrome 本来就按平台本地化，所以 `shortcutLabel` 只在符号串到达非 Mac 平台时起作用（本不该发生，但评审的规则现在落在代码和测试里）。
- The 16 px variant keeps the mark's geometry (pad at the same place and size); only the ring and ripples are dropped. Enlarging the pad for legibility was not asked.
  16 px 变体保留了标志的几何（荷叶位置和大小不变），只去掉环和涟漪。评审没有要求放大荷叶。

## Found along the way, not fixed · 过程中发现、尚未修复

- **The `pornhub-ladder` card title is a race.** The content script titles the site-payload candidate from the social card (`sitePageTitle`: twitter:title, og:title, h1, document title), the worker's own extraction titles its member from `flashvars.video_title` (the fixture's "Fixture Clip  A Walk Through The Studio", no colon), and `candidateNaming()` takes the first member's readable title, so whichever arrives first names the card. It passed at step 2 and on this step's fifth run, and failed in three runs under load. Diagnosis left for the adapter work in the shared notes (`pornhub-title-race.md`); not changed here.
  **`pornhub-ladder` 的卡片标题是竞态。** 内容脚本用社交卡片给站点载荷候选项起名（`sitePageTitle`：twitter:title、og:title、h1、document.title），worker 自己抽取的成员用 `flashvars.video_title`（样例里是无冒号的“Fixture Clip  A Walk Through The Studio”），`candidateNaming()` 取先到成员的可读标题，谁先到谁命名。第 2 步时通过，本步第五次运行也通过，高负载下的三次运行失败。诊断留在共享笔记（`pornhub-title-race.md`）给适配器那条线；这里没有改。

- `tests/background-smoke.test.js` (the worker, untouched) still fails in the full suite whenever Chrome is running beside it and passes on its own; a timing budget, not this step.
  `tests/background-smoke.test.js`（后台 worker，未动）在旁边有 Chrome 运行时全量跑仍会失败、单独跑通过；是它自己的时间预算问题，不属于本步。
- The audit's pond column still runs the withdrawn v2 greyscale rule (step 4).
  审计的池塘一列仍是已撤回的 v2 灰度规则（第 4 步）。
