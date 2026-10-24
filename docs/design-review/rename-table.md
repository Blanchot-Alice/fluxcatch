# Rename table for approval (design review §7)
# 改名对照表，待批准（设计评审第 7 节）

**Applied** means already done on the rebuilt Downloads page, because §7 states the rule outright: one verb per action, plain status copy, real plurals, decimal sizes.
**已应用**：已在重做的下载记录页落地，因为第 7 节已明文规定：每个动作只用一个动词，状态文案用平实语言，复数照实变化，容量用十进制单位。

**Proposed** means waiting for approval before any surface changes. Nothing marked Proposed has been changed.
**待批准**：批准之前不改动任何界面。标为“待批准”的条目一律未动。

Status update, 2026-10-24: the Settings terms this table marked Proposed and that the v2 rebuild shipped are listed in `step-v3-1-pond.md` (§3.8); Andy approved that step without rejecting any, so those rows now stand as applied in Settings.
状态更新，2026-10-24：本表标为“待批准”、而 v2 重做已经上线的设置页词条，列在 `step-v3-1-pond.md`（第 3.8 节）里；Andy 批准该步时没有否掉任何一条，这些行在设置页上即视为已应用。

Source: a full inventory of every surface (popup, side panel, Settings, Downloads, UI editor, worker and engine messages) with file and line references. This table is the curated version.
来源：对所有界面（弹窗、侧边栏、设置、下载记录、界面编辑器、后台与引擎消息）逐文件逐行的完整清点。本表是整理后的版本。

## 1. One name per concept · 一个概念一个名字

| Concept · 概念 | Today (as rendered) · 现状 | Proposed EN / 中文 | What it means to the user · 对用户的含义 | Status · 状态 |
|---|---|---|---|---|
| The native host · 本地宿主程序 | 13 names: Local download engine / 本地下载引擎, local engine / 本地引擎, Local engine / 本地能力, local helper / 本地处理程序, helper / 配套程序, local tools / 本地工具, Local downloader / 本地下载程序, native-host package, Native ZIP … | **Local engine / 本地引擎** | The small program on your Mac that saves most downloads, joins picture and sound, and converts formats.<br>装在你 Mac 上的小程序，负责保存多数下载、合并画面与声音、转换格式。 | Applied on Downloads; Proposed elsewhere<br>下载记录页已应用，其余待批准 |
| What Chrome saves without the engine · 无需引擎、由 Chrome 直接保存的内容 | Chrome direct lane / Chrome 例外通道, Trusted Instagram/X only, strictly matched Instagram/X direct links, trusted direct links / 可信直链 … | **Instagram and X videos / Instagram 与 X 视频**; status where needed: **Saved by Chrome / 由 Chrome 保存** | A few Instagram and X videos download before the engine is set up.<br>少数 Instagram 与 X 视频在设置引擎之前也能下载。 | Proposed<br>待批准 |
| One download · 一次下载 | Jobs / 任务, Download jobs / 下载任务, job(s) | **download(s) / 下载** | One file being saved.<br>正在保存的一个文件。 | Applied on Downloads; Proposed elsewhere<br>下载记录页已应用，其余待批准 |
| The engine permission · 引擎权限 | authorize / 授权, allow / 允许, enable / 开启, grant, permission / 权限 | **Set up / 设置**; status **Not set up / 未设置** | The one-time Chrome prompt that lets FluxCatch use the engine.<br>Chrome 弹出一次的授权提示，允许 FluxCatch 调用引擎。 | Applied on Downloads (status line); Proposed elsewhere<br>下载记录页状态行已应用，其余待批准 |
| Chrome's bridge to the engine · Chrome 与引擎之间的接口 | connection bridge / 连接接口, 浏览器接口 | Drop the term; show **Finishing setup… / 正在完成设置…** | Chrome is still finishing the setup.<br>Chrome 还在完成设置。 | Proposed<br>待批准 |
| Stream pieces · 流媒体分片 | segments / 分片, 视频片段, 片段 | **parts / 段**, only inside Details | Streaming video arrives in small parts.<br>流媒体视频分成许多小段传来。 | Applied on Downloads<br>下载记录页已应用 |
| Quality · 画质 | 清晰度 and 画质 mixed | **Quality / 清晰度** everywhere | The resolution you save.<br>你保存的分辨率。 | Proposed<br>待批准 |
| The side panel · 侧边栏 | 工作台, 媒体工作台, FluxCatch 工作台 | **Workspace / 工作台** | The FluxCatch panel at the side of Chrome.<br>Chrome 侧边的 FluxCatch 面板。 | Proposed<br>待批准 |

## 2. Developer vocabulary, by surface · 各界面的开发者用语

### Settings · 设置

| Today · 现状 | Proposed EN / 中文 | Meaning · 含义 | Status · 状态 |
|---|---|---|---|
| "Local-first media instrument" (English in both languages) | Remove · 删除 | A tagline with nothing to act on.<br>一句口号，用户无事可做。 | Proposed · 待批准 |
| "Tune the download experience and confirm what this build can really do." | Choose where and how FluxCatch saves your downloads. / 设置 FluxCatch 保存下载的位置与方式。 | Page subtitle.<br>页面副标题。 | Proposed · 待批准 |
| "UI editor" in the header | Lab → Developer, off by default (§7) | A developer tool.<br>开发者工具。 | Proposed · 待批准 |
| Runtime / Runtime identity & capabilities / 运行身份与能力概览 | **Status / 状态** | Whether downloading works right now.<br>现在能不能下载。 | Proposed · 待批准 |
| "First confirm that the extension, the local helper and the capability profile all agree." | Remove · 删除 | Asks the user to audit internal versions.<br>要用户核对内部版本号。 | Proposed · 待批准 |
| FFmpeg local processing / FFmpeg 本地处理 | **Merging & converting / 合并与转换** | Whether FluxCatch can join picture and sound and make MP4 or MP3.<br>FluxCatch 能否合并画面与声音、生成 MP4 或 MP3。 | Proposed · 待批准 |
| Network scope · Public networks only | **Local network · Off / On (局域网 · 关闭 / 开启)** | Whether FluxCatch may download from devices on your home network.<br>FluxCatch 能否从家里局域网的设备下载。 | Proposed · 待批准 |
| View build & capability details; Extension ID; Build; Protocol & capability profile; "Match · protocol 1 · profile 1" | Lab → Developer: **Version info / 版本信息**; compatibility shown as **OK / Update needed / Not connected** | Version numbers for a bug report.<br>报告问题时用的版本号。 | Proposed · 待批准 |
| Capability list (Static HLS videos, Static DASH videos, Bilibili split-stream merging, External downloader networking …) | Video and audio files · Streaming video · Bilibili videos · Live streams · Encrypted streams · Videos with separate sound · YouTube · Video thumbnails; values **Yes / Not yet** | What can be saved today.<br>目前能保存哪些内容。 | Proposed · 待批准 |
| Section numbers 01 to 08 | Remove (§6.13) · 删除 | They imply steps that don't exist.<br>编号暗示有先后步骤，实际并没有。 | Proposed · 待批准 |
| HLS segment concurrency / 直接文件 Range 并发数 | **Connections per streaming video / Connections per large file** | How many connections one download uses.<br>一次下载同时开几条连接。 | Proposed · 待批准 |
| Minimum media size (KiB) | **Ignore files smaller than (KB)** | Changing the unit also changes the maths (today ÷1024).<br>换单位也要改算法（现在除以 1024）。 | Proposed · 待批准 |
| Filename tokens `{title} {host} {kind} {height} {date}` | Chip labels Title · Site · Type · Resolution · Date (the same tokens are inserted) | How saved files are named.<br>保存文件的命名方式。 | Proposed · 待批准 |
| Auto-complete quality on supported sites, plus a paragraph on Range requests, a 45 s cache and a 5 s cool-down | **Find more qualities on Bilibili**; one line: Uses your Bilibili sign-in on that page. Nothing is uploaded. | Fetches the other qualities Bilibili offers.<br>读取 Bilibili 提供的其他画质。 | Proposed · 待批准 |
| Allow LAN media access, plus "cloud metadata, link-local, multicast …" | **Allow downloads from my home network**; one line: Router and system addresses stay blocked. | Opt-in for downloads from home devices.<br>是否允许从家中设备下载。 | Proposed · 待批准 |
| Request credentials · Kept in memory only, scoped per origin | **Sign-in info · Used only for the site it came from, never stored** | How sign-in data is handled.<br>登录信息如何处理。 | Proposed · 待批准 |
| Lab & current limits; YouTube adapter; HLS live recording; Encrypted HLS "fail-closed" | **Not yet supported**: YouTube · Live streams · Copy-protected video | "Encrypted HLS" currently shows *Available* while its text says unsupported. That contradiction needs a product decision.<br>“加密 HLS”目前标着“可用”，说明文字却写不支持，这处矛盾需要产品层面拍板。 | Proposed · 待批准 |
| Language · Auto (English in both languages) | **Language / 语言 · Auto / 自动** | Interface language.<br>界面语言。 | Proposed · 待批准 |

### Popup and side panel · 弹窗与侧边栏

| Today · 现状 | Proposed EN / 中文 | Status · 状态 |
|---|---|---|
| "Keep What You See." (English in both languages) | Keep it in one place only (§4), or drop it<br>只留一处（第 4 节），或者删掉 | Proposed, your call · 待批准，由你定 |
| Safely scanning this page… | **Looking for media… / 正在查找媒体…** | Proposed · 待批准 |
| Type tiles VIDEO / AUDIO / HLS / DASH | A glyph (§6.4) · 改用图形 | Applied on Downloads · 下载记录页已应用 |
| Chip "Pick" / 推荐 | **Best / 最佳** | Proposed · 待批准 |
| Chip "Multi-connection" / 支持多连接 | Remove · 删除 | Proposed · 待批准 |
| Dialog title "Download settings" (also the side panel's name for opening Settings) | Dialog: **Download / 下载**; side panel: **Settings / 设置** | Proposed · 待批准 |
| "This page provides no address" / 此页面暂不提供地址 | **FluxCatch can't read this page / FluxCatch 无法读取此页面**. It appears on chrome:// pages and the New Tab page; §7's example wording describes a different state.<br>它出现在 chrome:// 页面和新标签页上；第 7 节的示例文案描述的是另一种状态。 | Proposed · 待批准 |
| "Downloadable video, audio and streams found here" | Remove · 删除 | Proposed · 待批准 |
| "Browser download · …" / "Local download · …" | The status alone (Downloading / 下载中) · 只留状态 | Proposed · 待批准 |
| "The extension background is disconnected" | **FluxCatch stopped responding. Reopen this panel.** | Applied on Downloads, with Reload · 下载记录页已应用，附“重新载入” |
| "Extension request failed" | **Something went wrong. Try again.** | Applied on Downloads · 下载记录页已应用 |

### Downloads · 下载记录（all applied · 均已应用）

| Today · 原来 | Now · 现在 |
|---|---|
| "3 file(s) saved · 3.0 GiB in total" | **3 files · 3.2 GB**, with Intl plurals and decimal units that match Finder<br>**3 个文件 · 3.2 GB**，复数由 Intl 处理，十进制单位与 Finder 一致 |
| "Every file the local engine saves is recorded here" | Removed · 已删除 |
| "File moved" / 文件已移走 | **File not found / 找不到文件** |
| "New download" header button and a "Start download" hint | Removed; the link field has a primary **Download**<br>已删除；链接输入框旁是主按钮“下载” |
| "Completed" on every finished row | Removed: only exceptions carry a status (§6.4)<br>已删除：只有异常条目才显示状态（第 6.4 节） |
| Raw engine errors · 引擎原始报错 | Localised from codes, e.g. "The site refused to send part 12 of the video (HTTP 403) after 5 retries. Refresh the page, play the video once, then retry."<br>按错误码本地化，例如“网站拒绝提供视频第 12 段（HTTP 403），已重试 5 次。请刷新页面并播放一下视频，再重试。” |
| Chinese relative times in the English UI ("1 小时前") | Intl in the UI language ("1 hr ago", "yesterday", "12 Oct")<br>按界面语言由 Intl 生成（“1小时前”“昨天”“10月12日”） |
| Dimmed filters and search on an empty history | The whole filter row stays hidden until there is history; the download folder remains reachable in Settings<br>没有记录时整行筛选隐藏；下载文件夹仍可从设置页打开 |

## 3. One verb per action · 每个动作一个动词

| Today (EN / 中文) · 现状 | Unified · 统一为 | Status · 状态 |
|---|---|---|
| Download · Start download / 开始下载 · Continue & download / 继续并下载 · Start local download / 开始本地下载 · Check & download / 检查并下载 · Download with defaults / 按默认设置下载 | **Download / 下载** | Applied on Downloads; Proposed elsewhere · 下载记录页已应用，其余待批准 |
| Download from a link · Download link · Download a link · New download | **Download a link / 粘贴链接下载** for the opener; its submit button is Download<br>入口按钮用此名，提交按钮仍是“下载” | Proposed; Downloads has the field inline · 待批准；下载记录页直接内嵌输入框 |
| Retry · Retry download · Read again / 重新读取 · Recheck / 重新检查 | **Retry / 重试** | Applied on Downloads · 下载记录页已应用 |
| Source page (icon) · Open source page (menu) | **Open source page / 打开来源页面** | Applied on Downloads · 下载记录页已应用 |
| Open folder · Folder / 下载文件夹 | **Show in Finder / 在 Finder 中显示**; for the folder: "Show download folder in Finder" | Applied on Downloads · 下载记录页已应用 |
| Enable local download engine · Open local engine settings · Setup guide · Update guide | **Set up / 设置** | Applied on Downloads · 下载记录页已应用 |
| Keep off / 保持关闭 · No thanks / 不用了 | **Cancel / 取消**; the notification opt-out becomes **Don't notify me / 不用通知我** | Applied on Downloads · 下载记录页已应用 |
| Downloads · View downloads · All downloads | **All downloads / 全部下载记录** (popup footer, §6.14) | Proposed · 待批准 |
| Workspace | **Open workspace / 打开工作台** (§6.14) | Proposed · 待批准 |

## 4. The engine story, told once · 引擎只解释一次

§7 allows one explanation, in Settings → Local engine, and a one-line status with **Set up** everywhere else. These places explain it today and would be removed or collapsed:
第 7 节只允许在“设置 → 本地引擎”解释一次，其他地方只留一行状态加“设置”按钮。下面这些地方目前都在解释，届时删除或合并：

- Popup download dialog: the "Permission note" box, "No extra permission needed", "May request local engine permission after submitting" in three variants, the "Original means no conversion…" note, the "link downloads are always saved by the local engine" clause, and the "Use the local engine for trusted direct links too" checkbox.
  弹窗下载对话框：“权限说明”框、“无需额外权限”、三种写法的“提交后可能请求本地引擎权限”、“原始格式即不转换……”说明、“链接下载一律由本地引擎保存”一句，以及“可信直链也用本地引擎”复选框。
- Popup Jobs view: three engine-card sentences.
  弹窗任务视图：引擎卡片上的三句话。
- Side panel: the engine card sentences, the paragraph under it ("Items marked Check & download need…"), and the Check & download / Download with defaults label split.
  侧边栏：引擎卡片的说明、卡片下方那段（“标有检查并下载的条目需要……”），以及“检查并下载 / 按默认设置下载”两种按钮名。
- Downloads: the URL-field hint, the summary line and the footer. **Done.**
  下载记录页：链接框提示、摘要行和页脚。**已完成。**
- Settings: onboarding "Save path" and "Permissions", the runtime strip's duplicate engine rows, three engine clauses in save-location help, and five wordings of "detection and previews still work…".
  设置：引导里的“保存路径”和“权限”、运行状态条里重复的引擎行、保存位置帮助里三处引擎说明，以及五种写法的“检测与预览仍然可用……”。
- Worker errors: four phrasings of "needs the local engine permission first" become one: **Set up the local engine first. / 请先设置本地引擎。**
  后台报错：“需要先授予本地引擎权限”的四种说法合并为一句：**Set up the local engine first. / 请先设置本地引擎。**

The one explanation to keep, in Settings → Local engine:
唯一保留的解释，放在“设置 → 本地引擎”：

> The local engine is a small program on your Mac. It saves most downloads, joins video and sound, and converts formats. Nothing is uploaded.
>
> 本地引擎是装在你 Mac 上的小程序，负责保存多数下载、合并画面与声音、转换格式，不上传任何内容。

## 5. Things the rename exposed (no action taken) · 改名过程中暴露的问题（未处理）

- Chinese strings are message ids, several regexes classify errors by matching Chinese text, and tests pin some strings. A rename must change ids, regexes and tests together. The v2 pages avoid this: their copy lives in `extension/ui/v2/messages.js` and is never matched.
  中文字符串本身就是消息 id，好几处正则靠匹配中文来给错误分类，测试也钉死了部分字符串。改名时 id、正则和测试必须一起改。v2 页面没有这个问题：文案集中在 `extension/ui/v2/messages.js`，从不拿来匹配。
- Copy saved in the UI editor (`fluxcatch.uiCustomization.v1`) overrides Settings headings and has no translation. Moving the editor behind Lab → Developer should also stop it from overriding v2 copy.
  界面编辑器存下的文案（`fluxcatch.uiCustomization.v1`）会覆盖设置页标题，而且没有译文。把编辑器移到“实验室 → 开发者”时，也应让它不再覆盖 v2 文案。
- The popup download dialog throws when the quality probe fails (a bare `probeError` reference, popup.js:568), so the dialog never opens in that case. This bug sits outside the rename; it stays unfixed because the popup is frozen until step 5.
  画质探测失败时，弹窗下载对话框会抛错（popup.js:568 引用了未定义的 `probeError`），对话框因此打不开。这个缺陷不属于改名范围；弹窗在第 5 步之前冻结，所以暂未修复。
