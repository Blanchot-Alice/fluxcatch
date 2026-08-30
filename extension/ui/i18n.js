// FluxCatch UI i18n (gettext-style): Chinese source strings are the message ids.
// EN_CATALOG maps each user-facing Chinese string to English. Strings that embed
// runtime values are covered by RULES (regex + optional rebuild function).
// The DOM layer translates rendered text nodes and UI attributes in place, so
// existing Chinese sources stay the single source of truth.

export const UI_LANGUAGE_STORAGE_KEY = "fluxcatch.uiLanguage.v1";

const EN_CATALOG = {
  "当前版本暂不支持 AES-128 加密的 HLS 下载。": "AES-128 encrypted HLS downloads are not supported in this version yet.",
  "FluxCatch 0.2.5 暂不支持 AES-128 加密的 HLS 下载": "FluxCatch 0.2.5 cannot download AES-128 encrypted HLS yet",
  // Popup chrome
  "重新扫描": "Rescan",
  "设置": "Settings",
  "FluxCatch 视图": "FluxCatch views",
  "媒体类型": "Media type",
  "检测到的媒体": "Detected media",
  "重新检查": "Recheck",
  "重新检查本地下载引擎": "Recheck local download engine",
  "下载任务": "Download jobs",
  "打开 Chrome 下载目录；本地引擎默认保存到 Downloads/FluxCatch": "Open Chrome's download folder; the local engine saves to Downloads/FluxCatch by default",
  "清空当前页媒体检测结果与已结束任务，保留进行中任务": "Clear scan results and finished jobs for this page; active downloads are kept",
  "清空当前页媒体检测结果与已结束任务？进行中的下载任务会保留。": "Clear scan results and finished jobs for this page? Active downloads are kept.",
  "关闭": "Close",
  "媒体": "Media",
  "任务": "Jobs",
  "全部": "All",
  "视频": "Video",
  "音频": "Audio",
  "流媒体": "Streams",
  "正在安全扫描当前页面…": "Safely scanning this page…",
  "媒体结果读取失败": "Could not read media results",
  "请重试。": "Please try again.",
  "重新读取": "Read again",
  "尚未检测到媒体": "No media detected yet",
  "播放视频后重新扫描；扫描只读取当前页面的媒体信息，不会刷新页面。": "Play the video, then rescan. Scanning only reads media info from this page and never reloads it.",
  "播放视频后重新扫描；扫描不会刷新页面。": "Play the video, then rescan; scanning never reloads the page.",
  "重新扫描当前页面": "Rescan this page",
  "本地下载引擎": "Local download engine",
  "正在读取清晰度与流媒体信息…": "Reading qualities and stream info…",
  "正在检查是否可用…": "Checking availability…",
  "安装方法": "Setup guide",
  "重试": "Retry",
  "正在恢复下载任务…": "Restoring download jobs…",
  "任务记录读取失败": "Could not read job history",
  "暂无任务": "No jobs yet",
  "开始下载后可在这里查看实时速度与进度。": "Live speed and progress show up here once a download starts.",
  "打开媒体工作台": "Open media workspace",
  "浏览器下载目录": "Browser downloads",
  "清空媒体与历史": "Clear results & history",
  "下载": "Download",
  "下载设置": "Download settings",
  "文件名": "File name",
  "保存格式": "Save format",
  "原格式（不转换）": "Original (no conversion)",
  "MP3（仅音频）": "MP3 (audio only)",
  "清晰度": "Quality",
  "可信直链也使用本地下载引擎": "Use the local engine for trusted direct links too",
  "权限说明": "Permission note",
  "多数媒体需要本地下载引擎；只有严格匹配的 Instagram/X 固定来源不会请求该权限。": "Most media needs the local download engine; only strictly matched Instagram/X direct links skip that permission.",
  "打开本地能力设置": "Open local engine settings",
  "取消": "Cancel",
  "开始下载": "Download",
  "无法打开设置页": "Could not open the settings page",
  "打开设置": "Open settings",
  "重新读取工作台数据": "Reload workspace data",

  // Sidepanel
  "FluxCatch 工作台": "FluxCatch Workspace",
  "媒体工作台": "Media workspace",
  "正在读取当前页面…": "Reading this page…",
  "请稍候": "One moment",
  "标为“检查并下载”的媒体需要本地下载引擎；Chrome 权限只会在你点击该按钮后请求。": "Items marked “Check & download” need the local download engine; Chrome only asks for that permission after you click.",
  "工作台暂时没有读到数据": "The workspace has no data right now",
  "当前页面媒体": "Media on this page",
  "检测到的可下载视频、音频与流媒体": "Downloadable video, audio and streams found here",
  "正在整理媒体…": "Organizing media…",
  "播放视频后点击“重新扫描”；扫描不会刷新当前页面。": "Play the video, then click “Rescan”; scanning never reloads this page.",
  "个任务正在进行": "jobs in progress",
  "清理已结束任务": "Clear finished",
  "清理已结束的下载任务": "Clear finished jobs",
  "正在恢复任务…": "Restoring jobs…",
  "暂无下载任务": "No downloads yet",
  "从弹窗或本工作台开始下载后，进度会持续保留在这里。": "Start a download from the popup or this workspace and its progress stays here.",
  "检查并下载": "Check & download",
  "按默认设置下载": "Download with defaults",
  "检查失败，请确认配套程序已安装后重试": "Check failed; make sure the helper is installed and try again",
  "本地下载任务已开始": "Local download started",
  "浏览器下载已开始": "Browser download started",
  "已发送取消请求": "Cancel request sent",
  "已复制 ✓": "Copied ✓",
  "复制失败": "Copy failed",
  "正在复制…": "Copying…",
  "已发送": "Sent",

  // Download dialog (popup)
  "自动选择最高画质": "Automatically pick the best quality",
  "未读取到清晰度选项，将自动选择并生成一个可直接播放的文件。": "No quality options were read; one directly playable file will be picked automatically.",
  "选择清晰度：": "Choose quality: ",
  "原格式只表示不转换；多数来源仍由本地下载引擎保存，只有严格匹配的 Instagram/X 固定来源可交给 Chrome 下载。": "Original means no conversion. Most sources are still saved by the local download engine; only strictly matched Instagram/X direct links are handed to Chrome.",
  "此操作会保留媒体原格式并交给 Chrome 下载，不会请求本地下载引擎权限。": "This keeps the original format and hands the file to Chrome without requesting local-engine permission.",
  "所选格式需要在本机转换。权限仅在你点击“继续并下载”后请求，媒体不会上传到云服务。": "This format needs on-device conversion. Permission is requested only after you click “Continue & download”; media never leaves your machine for the cloud.",
  "此媒体需要在本机下载并合并片段。权限仅在你点击“继续并下载”后请求，媒体不会上传到云服务。": "This media is downloaded and merged on your machine. Permission is requested only after you click “Continue & download”; media never leaves your machine for the cloud.",
  "此来源需要由本地下载引擎代理保存。权限仅在你点击“继续并下载”后请求。": "This source must be saved through the local download engine. Permission is requested only after you click “Continue & download”.",
  "继续并下载": "Continue & download",
  "开始本地下载": "Start local download",

  // Statuses and shared UI verbs
  "等待中": "Queued",
  "准备中": "Starting",
  "准备中…": "Preparing…",
  "下载中": "Downloading",
  "正在合并": "Merging",
  "正在合并视频片段或转换格式": "Merging video segments or converting the format",
  "已完成": "Completed",
  "下载失败": "Download failed",
  "已取消": "Cancelled",
  "处理中": "Processing",
  "失败": "Failed",
  "未完成": "Unfinished",
  "已更新": "Updated",
  "已扫描": "Scanned",
  "扫描中…": "Scanning…",
  "读取中…": "Reading…",
  "正在读取…": "Reading…",
  "保存中…": "Saving…",
  "保存失败": "Save failed",
  "保存设置": "Save settings",
  "已保存 ✓": "Saved ✓",
  "已保存提交内容；保存期间有新的更改": "Saved your submission; newer changes arrived while saving",
  "已打开": "Opened",
  "已打开 ✓": "Opened ✓",
  "已开始": "Started",
  "已开始 ✓": "Started ✓",
  "打开中…": "Opening…",
  "清理中…": "Clearing…",
  "已清空 ✓": "Cleared ✓",
  "已清理": "Cleared",
  "刚刚": "just now",
  "完成": "Done",
  "操作完成": "Done",
  "操作失败": "Action failed",
  "读取失败": "Read failed",
  "读取任务失败": "Could not read jobs",
  "读取媒体失败": "Could not read media",
  "读取页面失败": "Could not read the page",
  "读取诊断信息失败": "Could not copy diagnostics",
  "复制诊断信息失败": "Could not copy diagnostics",
  "诊断信息已复制": "Diagnostics copied",
  "扩展请求失败": "Extension request failed",
  "扩展后台已断开": "The extension background is disconnected",
  "扩展后台已断开，请重新打开工作台": "The extension background is disconnected; reopen the workspace",
  "当前没有可扫描的页面": "No page available to scan",
  "当前窗口不可用": "The current window is unavailable",
  "当前窗口没有可读取的活动页面": "The current window has no readable active page",
  "此页面暂不提供地址": "This page provides no address",
  "页面扫描结果已更新": "Page scan results updated",
  "安全扫描已完成，页面未刷新": "Safety scan finished; the page was not reloaded",
  "尝试切换媒体类型，或重新扫描当前页面。": "Try a different media type, or rescan this page.",
  "当前筛选下没有媒体": "No media under the current filter",
  "没有可清理的已结束任务": "No finished jobs to clear",
  "复制链接": "Copy link",
  "规划中": "Planned",
  "推荐": "Pick",
  "支持多连接": "Multi-connection",
  "仅音频": "Audio only",

  // Host / engine statuses
  "已就绪 · 可加速大文件、合并视频片段并转换格式": "Ready · speeds up large files, merges segments and converts formats",
  "可加速大文件、合并视频片段并转换格式": "Speeds up large files, merges segments and converts formats",
  "可加速大文件；合并视频片段和转换格式尚未就绪": "Speeds up large files; segment merging and conversion are not ready yet",
  "本地下载引擎已就绪": "Local download engine is ready",
  "本地下载引擎暂未就绪": "Local download engine is not ready",
  "本地下载引擎暂未就绪；媒体检测与预览仍可用，多数保存需先开启引擎": "Local download engine is not ready; detection and previews still work, but most saves need the engine first",
  "本地下载引擎尚未授权；检测与预览仍可用，多数保存需先授权": "Local download engine is not authorized yet; detection and previews still work, but most saves need permission first",
  "本地下载引擎权限已开启，Chrome 正在初始化连接接口。FluxCatch 将自动重试。": "Permission granted; Chrome is initializing the connection bridge. FluxCatch will retry automatically.",
  "本地下载引擎权限已开启，但 Chrome 的连接接口长期未恢复。请完全退出并重新启动 Chrome，返回后点击“重新检查”。": "Permission is granted, but Chrome's connection bridge has not recovered. Fully quit and restart Chrome, then come back and click “Recheck”.",
  "本地下载引擎尚未安装或未注册。从源码使用时请运行 ./scripts/native-install-wrapper.sh；从 Native ZIP 使用时请运行 ./install-macos.sh。": "The local download engine is not installed or registered. From source, run ./scripts/native-install-wrapper.sh; from the Native ZIP, run ./install-macos.sh.",
  "暂时未能连接本地引擎。请稍后点击“重新检查”；若持续失败，请在 chrome://extensions 中查看 FluxCatch 的错误。": "Could not reach the local engine right now. Click “Recheck” shortly; if it keeps failing, check FluxCatch's errors on chrome://extensions.",
  "本地下载引擎未连接": "Local download engine not connected",
  "本地下载引擎权限已关闭": "Local download engine permission is off",
  "本地下载引擎授权失败": "Local download engine authorization failed",
  "本地下载引擎授权已撤销": "Local download engine authorization was revoked",
  "本地下载引擎授权已撤销；检测与预览仍可用，多数保存需重新授权": "Local download engine authorization was revoked; detection and previews still work, but most saves need permission again",
  "本地下载引擎版本不匹配": "Local download engine version mismatch",
  "本地下载引擎状态已更新": "Local download engine status updated",
  "本地下载引擎程序尚未安装或未注册；请打开安装方法查看步骤": "The local engine helper is not installed or registered; open the setup guide for steps",
  "本地下载引擎程序尚未安装或未注册；请打开设置页查看安装步骤": "The local engine helper is not installed or registered; open settings for setup steps",
  "本地下载引擎程序连接失败；请重试，仍失败时打开设置页检查": "Could not connect to the local engine helper; retry, then check settings if it keeps failing",
  "尚未授权连接本地引擎": "The local engine has not been authorized yet",
  "需要授权连接本地引擎，才能使用此下载模式": "This download mode needs local engine permission first",
  "请先允许使用本地下载引擎，再继续下载": "Allow the local download engine first, then continue the download",
  "请先允许使用本地下载引擎，再继续操作": "Allow the local download engine first, then continue",
  "暂未开启本地下载引擎": "The local download engine is not enabled yet",
  "暂未开启；检测与预览仍可用，多数保存需本地下载引擎": "Not enabled yet; detection and previews still work, but most saves need the local engine",
  "尚未开启；媒体检测与预览仍可用，多数保存会在提交时请你授权": "Not enabled yet; detection and previews still work, and most saves will ask for permission when submitted",
  "尚未开启；需要加速、合并或转换格式时会请你授权": "Not enabled yet; you will be asked for permission when speeding up, merging or converting",
  "暂时未能检查本地下载引擎": "Could not check the local download engine right now",
  "暂时未能确认本地下载引擎授权状态": "Could not confirm local engine authorization right now",
  "暂时未能连接本地下载引擎": "Could not reach the local download engine right now",
  "暂时未能恢复本地下载引擎": "Could not recover the local download engine right now",
  "正在初始化连接接口": "Initializing the connection bridge",
  "等待 Chrome 初始化连接接口": "Waiting for Chrome to initialize the connection bridge",
  "Chrome 尚未恢复本地下载引擎连接接口；请完全退出并重新启动 Chrome 后重试": "Chrome has not restored the local engine bridge yet; fully quit and restart Chrome, then retry",
  "Chrome 的连接接口长期未恢复。请完全退出并重新启动 Chrome，再返回此页点击“重新检查”。": "Chrome's connection bridge has not recovered. Fully quit and restart Chrome, come back to this page and click “Recheck”.",
  "Chrome 的连接接口长期未恢复，请完全退出并重新启动 Chrome": "Chrome's connection bridge has not recovered; fully quit and restart Chrome",
  "已授权；等待连接配套程序": "Authorized; waiting for the helper to connect",
  "已获授权；正在检查本地处理程序…": "Authorized; checking the local helper…",
  "已授权，但本地下载引擎未安装或未注册；请在源码根目录运行 ./scripts/native-install-wrapper.sh 后重试": "Authorized, but the local engine is not installed or registered; run ./scripts/native-install-wrapper.sh in the repo root and retry",
  "授权已生效，但 Chrome 的本地下载引擎连接接口尚未就绪；请打开设置页完成自动恢复后重试": "Authorized, but Chrome's local engine bridge is not ready yet; open settings to finish automatic recovery and retry",
  "已授权，但本地引擎连接失败；请稍后重新检查，若持续失败请在 chrome://extensions 中查看错误": "Authorized, but the local engine connection failed; recheck shortly, and if it keeps failing see the errors on chrome://extensions",
  "授权已生效 · 浏览器接口待恢复": "Authorized · waiting for Chrome's bridge to recover",
  "授权已生效 · 需要重启浏览器": "Authorized · browser restart required",
  "授权已生效，正在等待 Chrome 初始化；FluxCatch 将自动重试": "Authorized and waiting for Chrome to initialize; FluxCatch will retry automatically",
  "已授权，Chrome 正在完成初始化；": "Authorized; Chrome is finishing initialization; ",
  "接口长期未恢复 · 请重启 Chrome": "Bridge not recovering · restart Chrome",
  "需要重启浏览器": "Browser restart required",
  "连接失败 · 请重试": "Connection failed · retry",
  "正在连接并检查本地工具…": "Connecting to and checking local tools…",
  "正在自动重试本地下载引擎…": "Auto-retrying the local download engine…",
  "已安装 · 协议不匹配": "Installed · protocol mismatch",
  "已安装 · 可用": "Installed · available",
  "已安装 · 本地处理可用": "Installed · local processing available",
  "已安装 · 联网功能未开放": "Installed · network features not enabled",
  "已安装但不可用": "Installed but unavailable",
  "未安装或未注册": "Not installed or registered",
  "未安装": "Not installed",
  "不匹配": "Mismatch",
  "版本不匹配": "Version mismatch",
  "可用": "Available",
  "未连接": "Not connected",
  "未启用": "Not enabled",
  "未开放": "Not available",
  "当前构建未启用": "Not enabled in this build",
  "当前未开放能力": "Not enabled in this build",
  "未知": "Unknown",
  "等待连接": "Waiting for connection",
  "等待本地引擎": "Waiting for local engine",
  "等待本地程序": "Waiting for helper",
  "等待授权": "Waiting for permission",
  "等待连接后检查": "Waiting for connection before checking",
  "本地引擎未接收任务": "The local engine did not accept the job",
  "本地引擎响应超时": "The local engine timed out",
  "本地引擎读取播放列表超时": "Reading the playlist from the local engine timed out",
  "本地引擎读取播放列表失败": "Reading the playlist from the local engine failed",
  "任务已取消": "Job cancelled",
  "FluxCatch 下载完成": "FluxCatch download complete",
  "FluxCatch 下载失败": "FluxCatch download failed",
  "FluxCatch — 暂未检测到媒体": "FluxCatch — no media detected yet",
  "正在初始化…": "Initializing…",
  "尚未检查": "Not checked yet",
  "协议或能力配置不匹配": "Protocol or capability profile mismatch",
  "任务编号无效": "Invalid job id",
  "标签页编号无效": "Invalid tab id",
  "浏览器正在下载": "Downloading via browser",
  "浏览器下载已暂停": "Browser download paused",
  "浏览器下载中断": "Browser download interrupted",
  "浏览器下载记录已不存在": "The browser download record no longer exists",
  "浏览器后台已重启，原本地任务状态已失效": "The browser background restarted; previous local job states are stale",
  "请重新开始该下载任务": "Please start this download again",
  "已保存到下载目录": "Saved to the downloads folder",
  "工具已安装 · 联网仍受限": "Tool installed · network still restricted",
  "本地处理可用": "Local processing available",
  "需要安装工具": "Tool installation required",
  "加速大文件、合并视频片段或转换格式时需要开启": "Needed for speeding up large files, merging segments or converting formats",

  // Media / probe errors
  "媒体地址无效": "Invalid media address",
  "清单地址无效": "Invalid manifest address",
  "媒体清单超出大小限制": "The media manifest exceeds the size limit",
  "所选清晰度已失效，请重新读取清晰度": "The selected quality is stale; read the qualities again",
  "所选清晰度无效，请重新读取清晰度": "Invalid quality selection; read the qualities again",
  "所选清晰度无效，请重新选择": "Invalid quality selection; choose again",
  "所选清晰度已更新，请重新开始下载": "The selected quality changed; start the download again",
  "视频清晰度地址已过期，请重新扫描页面": "The video quality address expired; rescan the page",
  "视频清晰度地址已更新，请重新开始下载": "The video quality address changed; start the download again",
  "该媒体候选项已失效，请重新扫描页面": "This media candidate is stale; rescan the page",
  "该媒体候选项已更新，请重新选择后下载": "This media candidate changed; select it again and download",
  "未找到可配对的音轨，请重新扫描页面": "No matching audio track found; rescan the page",
  "商店版本不支持从此平台下载": "The store build cannot download from this platform",
  "该域名已在 FluxCatch 设置中被忽略": "This domain is on the ignore list in FluxCatch settings",
  "检测到 DRM 内容保护，仅显示媒体信息": "DRM content protection detected; showing media info only",
  "检测到 DRM/SAMPLE-AES 内容保护，仅显示媒体信息": "DRM/SAMPLE-AES content protection detected; showing media info only",
  "检测到 DRM/SAMPLE-AES 内容保护，仅显示媒体信息。": "DRM/SAMPLE-AES content protection detected; showing media info only.",
  "检测到 DRM/内容保护，受保护内容暂不支持下载。": "DRM/content protection detected; protected content cannot be downloaded yet.",
  "FluxCatch 0.2.5 暂不支持 HLS 直播录制": "FluxCatch 0.2.5 cannot record live HLS yet",
  "FluxCatch 0.2.5 暂不支持包含时间线切换的 HLS 下载": "FluxCatch 0.2.5 cannot download HLS with timeline discontinuities yet",
  "当前版本暂不支持 HLS 直播录制。": "Live HLS recording is not supported in this version yet.",
  "当前版本暂不支持包含时间线切换的 HLS 下载。": "HLS with timeline discontinuities is not supported in this version yet.",
  "0.2.5 暂停外部引擎联网，等待受控网络代理": "External tool networking is paused in 0.2.5 pending a controlled proxy",
  "视频处理失败，请确认本地下载引擎已就绪后重试": "Video processing failed; make sure the local download engine is ready and retry",
  "此下载需要合并视频片段或转换格式，请确认本地下载引擎已就绪后重试。": "This download needs segment merging or conversion; make sure the local download engine is ready and retry.",
  "这个 HLS 视频使用独立音轨。FluxCatch 会在本地分别下载画面和声音并自动合并，最后保存为一个可直接播放的文件。": "This HLS video keeps its audio in a separate track. FluxCatch downloads video and audio separately, merges them locally and saves one directly playable file.",
  "这个网站把画面和声音分开传送。FluxCatch 会分别下载并无损合并，最后保存为一个可以直接播放的文件。": "This site serves video and audio separately. FluxCatch downloads both and merges them losslessly into one directly playable file.",
  "这类在线视频由许多小片段组成。FluxCatch 会逐段下载并自动组合，最后保存为一个可直接播放的文件。": "Online videos like this are made of many small segments. FluxCatch downloads them one by one, assembles them automatically and saves one directly playable file.",
  "MP3（当前 FFmpeg 不支持）": "MP3 (unsupported by the current FFmpeg)",
  "MP3（需更新本地下载引擎）": "MP3 (update the local download engine)",
  "MP3（需本地下载引擎）": "MP3 (needs the local download engine)",
  "MP4 · 自动画质": "MP4 · auto quality",
  "清晰度 N": "Quality N",
  "浏览器下载": "Browser download",
  "本地下载": "Local download",

  // Options page
  "FluxCatch 设置": "FluxCatch Settings",
  "跳到设置内容": "Skip to settings content",
  "调整下载体验，并确认当前构建真正可用的能力。": "Tune the download experience and confirm what this build can really do.",
  "界面编辑器": "UI editor",
  "设置章节": "Settings sections",
  "运行状态": "Runtime",
  "基础下载": "Basic downloads",
  "性能": "Performance",
  "检测与命名": "Detection & naming",
  "隐私与网络": "Privacy & network",
  "本地能力": "Local engine",
  "通知": "Notifications",
  "实验室": "Lab",
  "正在加载设置…": "Loading settings…",
  "部分设置需要修正": "Some settings need fixing",
  "请检查下面标出的字段，然后再次保存。": "Review the highlighted fields below, then save again.",
  "首次使用：下载方式、站点补全与权限": "First time here? Download paths, site completion and permissions",
  "保存路径：": "Save path: ",
  "多数媒体保存通过本地下载引擎安全处理；只有严格匹配的 Instagram/X 固定来源可直接交给 Chrome 下载。": "Most media is saved safely through the local download engine; only strictly matched Instagram/X direct links go straight to Chrome.",
  "B 站画质：": "Bilibili quality: ",
  "默认开启同站媒体信息补全，使用当前页面的同站 Cookie，不上传到云服务，可在“隐私与网络”中关闭。": "Same-site media info completion is on by default. It uses this page's own cookies, uploads nothing to the cloud, and can be turned off under “Privacy & network”.",
  "权限：": "Permissions: ",
  "本地下载引擎、通知和局域网访问都只会在你点击相应操作后请求或确认。": "The local engine, notifications and LAN access are only requested after you click the matching action.",
  "运行身份与能力概览": "Runtime identity & capabilities",
  "先确认浏览器扩展、本地处理程序与当前能力配置是否一致。": "First confirm that the extension, the local helper and the capability profile all agree.",
  "Chrome 例外通道": "Chrome direct lane",
  "仅可信 Instagram/X": "Trusted Instagram/X only",
  "正在检查": "Checking",
  "正在检查…": "Checking…",
  "FFmpeg 本地处理": "FFmpeg local processing",
  "等待本地能力": "Waiting for local engine",
  "网络范围": "Network scope",
  "仅公共网络": "Public networks only",
  "公共网络与已确认的局域网": "Public networks plus confirmed LAN",
  "查看构建身份与能力明细": "View build & capability details",
  "扩展版本": "Extension version",
  "扩展 ID": "Extension ID",
  "构建": "Build",
  "配套程序版本": "Helper version",
  "协议与能力配置": "Protocol & capability profile",
  "当前构建支持范围": "Supported in this build",
  "以实际配置为准": "Actual configuration governs",
  "复制内容只包含版本、构建、协议和能力状态，不包含网页、媒体、请求凭据或本机路径。": "Copied text contains only version, build, protocol and capability status; no pages, media, request credentials or local paths.",
  "复制诊断信息": "Copy diagnostics",
  "普通用户最常用的保存方式。": "The save path most people use.",
  "默认保存格式": "Default save format",
  "推荐 MP4，兼容性最好；合并流媒体或转换格式时生效。": "MP4 is recommended for compatibility; applies when merging streams or converting.",
  "可信浏览器直链下载前选择位置": "Ask where to save trusted direct links",
  "只作用于由 Chrome 保存的固定 Instagram/X 直链；本地下载引擎始终保存到其下载目录。": "Only affects fixed Instagram/X links saved by Chrome; the local engine always saves to its own download folder.",
  "开启后，原本可由 Chrome 保存的固定 Instagram/X 直链也走本地安全下载与多连接路径。": "When on, fixed Instagram/X links that Chrome could save also take the local engine's safe, multi-connection path.",
  "先选择稳妥预设，需要时再调整具体并发。": "Pick a safe preset first; tune individual concurrency only if needed.",
  "稳定": "Stable",
  "平衡": "Balanced",
  "高速": "Fast",
  "更高的并发不一定更快；下载不稳定时优先选择“稳定”。": "More connections are not always faster; when downloads struggle, prefer “Stable”.",
  "HLS 视频片段并发数": "HLS segment concurrency",
  "同时获取的视频片段数量，允许 1–24。": "How many segments to fetch at once; 1–24.",
  "直接文件 Range 并发数": "Direct-file Range concurrency",
  "大文件分段同时获取的数量，允许 1–24。": "How many parts of a large file to fetch at once; 1–24.",
  "并发设置如何影响下载？": "How does concurrency affect downloads?",
  "HLS 并发用于清晰、静态 VOD 的片段下载；Range 并发只在源站返回有效 206 与 Content-Range 时使用。数值越高会增加连接数，但不会绕过源站限速，也不保证提高吞吐。": "HLS concurrency handles segments of clean, static VOD; Range concurrency is used only when the server returns a valid 206 with Content-Range. Higher values add connections but never bypass server rate limits or guarantee more throughput.",
  "控制媒体筛选以及下载文件的可读名称。": "Control media filtering and readable download names.",
  "最小媒体大小（KiB）": "Minimum media size (KiB)",
  "忽略小于此值的普通媒体响应；允许 0–102400 KiB。": "Ignore ordinary media responses smaller than this; 0–102400 KiB.",
  "文件名模板": "File name template",
  "点击字段可在当前光标位置插入；未知字段不会保存。": "Click a field to insert it at the cursor; unknown fields are not saved.",
  "预览": "Preview",
  "可能生成空文件名": "May produce an empty file name",
  "忽略域名（每行一个）": "Ignored domains (one per line)",
  "保存时会转为小写、移除协议和路径、去掉结尾句点并删除重复项。不接受通配符、IP 地址或凭据。": "Saved as lowercase without protocol, path, trailing dots or duplicates. Wildcards, IP addresses and credentials are not accepted.",
  "固定站点接口，自动行为可随时关闭。": "Fixed-site endpoints; automatic behavior can be turned off anytime.",
  "自动补全支持站点的画质": "Auto-complete quality on supported sites",
  "默认开启。检测到 B 站可信媒体请求（播放或预加载）时，会使用同站 Cookie 自动补全画质候选；同页首次可信请求触发，重复 Range 请求会合并，成功结果缓存 45 秒，失败后至少冷却 5 秒才重试。关闭后不发起自动补全，可在弹窗或侧栏点“重新扫描”手动补全，角标可能延迟出现。接口由扩展固定，页面不能指定。": "On by default. When a trusted Bilibili media request plays or preloads, quality candidates are completed automatically using same-site cookies. The first trusted request on a page triggers it, repeated Range requests are merged, successes cache for 45 seconds, and failures cool down for at least 5 seconds before retrying. When off, nothing is requested automatically; use “Rescan” in the popup or sidebar to complete manually. The badge may lag behind. Endpoints are fixed by the extension; pages cannot direct them.",
  "允许访问局域网媒体": "Allow LAN media access",
  "仅在你明确要保存自己局域网设备上的媒体时开启；开启前会再次确认。": "Only enable this to save media from devices on your own LAN; you will be asked to confirm first.",
  "始终禁止：": "Always blocked: ",
  "云元数据服务、链路本地、多播、未指定与保留地址不会因该开关放行。": "Cloud metadata services, link-local, multicast, unspecified and reserved ranges stay blocked regardless of this switch.",
  "请求凭据": "Request credentials",
  "仅保存在内存中，并按来源限制": "Kept in memory only, scoped per origin",
  "遥测与云服务": "Telemetry & cloud services",
  "无": "None",
  "安装状态与当前构建是否开放是两件不同的事。": "Being installed is not the same as being enabled in this build.",
  "本地下载程序连接": "Local downloader connection",
  "Native 协议兼容": "Native protocol compatibility",
  "FFmpeg 安装与本地处理": "FFmpeg install & local processing",
  "yt-dlp 安装状态": "yt-dlp install status",
  "未检查": "Not checked",
  "外部工具联网": "External tool network access",
  "开启本地下载引擎": "Enable local download engine",
  "本地下载引擎安装方法": "Local engine setup",
  "本地下载引擎随扩展仓库一起提供，安装一次即可。": "The local engine ships with this repository; install it once.",
  "从源码使用时：在「终端」进入 FluxCatch 仓库根目录，然后执行": "From source: open Terminal in the FluxCatch repo root, then run",
  "从 zip 包使用时：解压 native-host 包后，进入目录执行": "From a ZIP: unpack the native-host package, enter the folder and run",
  "安装器会同时登记 Google Chrome 与 Chrome for Testing，无需手动选择。": "The installer registers both Google Chrome and Chrome for Testing; no need to pick one.",
  "完成后回到本页：尚未授权时点击「开启本地下载引擎」，已授权时点击「重新检查」。": "Come back here when done: click “Enable local download engine” if not yet granted, or “Recheck” if it is.",
  "开启时立即申请权限；通知偏好仍由保存栏确认。": "Permission is requested immediately when enabled; the notification preference is still confirmed by the save bar.",
  "下载完成或失败时提醒我": "Notify me when a download finishes or fails",
  "Chrome 会在开启时请求权限；关闭并保存后停止提醒，已有浏览器授权会保留。": "Chrome asks for permission when you turn this on. Turning it off and saving stops notifications; an existing browser permission is kept.",
  "实验室与当前限制": "Lab & current limits",
  "以下项目仅说明路线状态，在当前构建中没有可操作开关。": "These items describe roadmap status; this build has no working switches for them.",
  "YouTube 适配器": "YouTube adapter",
  "实验源保留，但稳定构建不发布候选或调用外部工具。": "The experimental source is kept, but stable builds publish no candidates and call no external tools.",
  "HLS 直播录制": "HLS live recording",
  "当前仅支持清晰、静态 VOD。": "Only clean, static VOD is supported for now.",
  "加密 HLS": "Encrypted HLS",
  "AES-128 与 SAMPLE-AES 保持 fail-closed。": "AES-128 and SAMPLE-AES stay fail-closed.",
  "所有更改均已保存": "All changes saved",
  "设置尚未就绪": "Settings are not ready yet",
  "有未保存的更改": "Unsaved changes",
  "设置已加载": "Settings loaded",
  "放弃更改": "Discard changes",
  "允许 FluxCatch 访问你局域网中的媒体设备？保留网络仍会被禁止。": "Allow FluxCatch to reach media devices on your LAN? Unrequested networks stay blocked.",
  "允许访问局域网媒体？": "Allow LAN media access?",
  "这会允许 FluxCatch 主动连接你局域网中的媒体设备。云元数据服务、链路本地、多播、未指定与保留地址仍然保持禁止。": "This lets FluxCatch actively connect to media devices on your LAN. Cloud metadata services, link-local, multicast, unspecified and reserved ranges stay blocked.",
  "保持关闭": "Keep off",
  "确认开启": "Turn on",
  "正在请求通知权限…": "Requesting notification permission…",
  "通知将在保存后关闭": "Notifications will turn off after saving",
  "通知权限已开启；保存后生效": "Notification permission granted; applies after saving",
  "通知权限请求失败": "Notification permission request failed",
  "通知设置同步失败": "Could not sync notification settings",
  "未授予通知权限，通知保持关闭": "Notification permission was not granted; notifications stay off",
  "读取设置失败": "Could not read settings",
  "暂时未能检查本地下载引擎": "Could not check the local download engine right now",
  "JSON 需要包含界面配置对象": "The JSON must contain a UI customization object",
  "本地数据处理说明": "Local data processing notes",
  "本地工具状态": "Local tool status",
  "性能预设": "Performance preset",
  "可插入的文件名字段": "Insertable file name fields",
  "当前运行状态": "Current runtime status",
  "构建身份": "Build identity",
  "当前页面": "Current page",
  "检测到的媒体": "Detected media",
  "普通视频与音频文件": "Ordinary video and audio files",
  "静态 HLS 视频": "Static HLS videos",
  "静态 DASH 视频": "Static DASH videos",
  "哔哩哔哩分离音视频合并": "Bilibili split-stream merging",
  "HLS 直播": "HLS live streams",
  "HLS 独立音轨": "HLS separate audio tracks",
  "外部下载工具联网": "External downloader networking",
  "远程视频封面": "Remote video thumbnails",
  "示例视频": "Sample video",
  "更新方法": "Update guide",

  // Capability labels in the popup workspace banner
  "已连接": "Connected",
  "匹配": "Match",
  "检查完成 ✓": "Check finished ✓",

  // Redaction placeholders (diagnostics text)
  "<链接已隐藏>": "<link hidden>",
  "$1=<已隐藏>": "$1=<hidden>",
  "Bearer <已隐藏>": "Bearer <hidden>",
  "<本地路径已隐藏>": "<local path hidden>",

  // Internal validation (surfaced only in logs, translated for completeness)
  "消息格式无效": "Invalid message format",
  "消息来源未通过校验": "Message origin failed validation",

  // Designer page
  "FluxCatch 界面编辑器": "FluxCatch UI editor",
  "关闭提示": "Dismiss notification",

  // Shared status strings surfaced from lib modules
  "无需额外权限": "No extra permission needed",
  "提交后可能请求本地下载引擎权限": "May request local engine permission after submitting",
  "尚未授权": "Not authorized yet",
  "尚未授权检查": "Not authorized; check pending",
  "检测与预览仍可用；多数媒体保存需要开启，仅可信 Instagram/X 固定来源例外": "Detection and previews still work; most saves need the engine, except strictly trusted Instagram/X direct links",
  "扩展与本地引擎版本不匹配，请重新加载扩展并重装本地引擎。": "The extension and local engine versions mismatch; reload the extension and reinstall the local engine.",
  "正在处理视频": "Processing video",
  "正在无损合并音视频": "Losslessly merging video and audio",
  "视频片段": "video segments",
  "视频链接已过期，请刷新页面并重新播放后再下载": "The video link expired; refresh the page, play it again, then download",
  "视频链接即将过期，请刷新页面并重新播放后再下载": "The video link is about to expire; refresh the page, play it again, then download",
  "检测到的视频信息不完整，请重新扫描后再下载": "Detected video info is incomplete; rescan before downloading",
  "画面与声音合并失败，请确认本地下载引擎已就绪后重试": "Merging video and audio failed; make sure the local download engine is ready and retry",
  "音频提取失败，请确认本地下载引擎已就绪后重试": "Audio extraction failed; make sure the local download engine is ready and retry",
  "视频画面下载失败，请刷新页面并重新播放后重试": "The video track failed to download; refresh the page, play it again and retry",
  "视频声音下载失败，请刷新页面并重新播放后重试": "The audio track failed to download; refresh the page, play it again and retry",
  "视频片段下载失败，请刷新页面并重新播放后重试": "Some segments failed to download; refresh the page, play it again and retry",
  "视频清单无效或已经过期，请刷新页面后重试": "The video manifest is invalid or expired; refresh the page and retry",
  "检测到 DRM/内容保护，受保护内容暂不支持下载": "DRM/content protection detected; protected content cannot be downloaded yet",
  "这个视频使用了当前版本尚未支持的流媒体结构": "This video uses a stream structure this version cannot handle yet",
  "视频下载失败，请重新扫描后重试": "The video download failed; rescan and retry",
  "文件名模板不能为空。": "The file name template cannot be empty.",
  "文件名模板不能包含控制字符。": "The file name template cannot contain control characters.",
  "不支持的文件名字段：": "Unsupported file name fields: ",
  "文件名字段的大括号不完整。": "A file name field has unbalanced braces.",
  "这个模板在部分媒体上可能生成空文件名，请加入标题、站点、类型、日期或固定文字。": "This template may produce an empty name for some media; add a title, site, kind, date or fixed text.",
  "视频片段并发数": "HLS segment concurrency",
  "大文件并发数": "Large-file concurrency",
  "最小媒体大小": "Minimum media size",
  "请选择支持的保存格式。": "Choose a supported save format.",
  "通知已开启": "Notifications on",
  "需要先允许 Chrome 通知权限": "Chrome notification permission is required first",
  "保存后将停止提醒；已有浏览器授权会保留": "Notifications stop after saving; an existing browser permission is kept",
  "通知保持关闭": "Notifications stay off",
  "通知保持关闭；已有浏览器授权会保留": "Notifications stay off; an existing browser permission is kept",
  "这不是有效的 DASH MPD": "This is not a valid DASH MPD",
  "这不是有效的 HLS 播放列表": "This is not a valid HLS playlist",
  "变体数量": "variant count",
  "分片数量": "segment count",
  "文本大小": "text size",
  "行数": "line count",
  "引用 URL 总长度": "total referenced URL length",
  "媒体轨道数量": "media track count",
  "密钥引用数量": "key reference count",
  "<无效地址>": "<invalid address>",

  // Options customization default copy (data-ui-copy targets)
  "先选择稳妥预设，需要时再调整具体并发。": "Pick a safe preset first; tune individual concurrency only if needed.",
  "控制媒体筛选以及下载文件的可读名称。": "Control media filtering and readable download names.",
  "固定站点接口，自动行为可随时关闭。": "Fixed-site endpoints; automatic behavior can be turned off anytime.",
  "安装状态与当前构建是否开放是两件不同的事。": "Being installed is not the same as being enabled in this build.",
  "开启时立即申请权限；通知偏好仍由保存栏确认。": "Permission is requested immediately when enabled; the notification preference is still confirmed by the save bar.",
  "以下项目仅说明路线状态，在当前构建中没有可操作开关。": "These items describe roadmap status; this build has no working switches for them."
};

// Ordered rules for strings that embed runtime values. Each rule is
// [RegExp, replacement] where replacement is a String (with $n) or a
// function((match, ...groups)) returning the final English string.
const RULES = [
  [/^(\d+) 个媒体$/, "$1 media items"],
  [/^已清理 (\d+) 个已结束任务$/, "Cleared $1 finished job(s)"],
  [/^已清空检测结果；(\d+) 个进行中任务保留$/, "Results cleared; $1 active job(s) kept"],
  [/^已清空检测结果和 (\d+) 个已结束任务$/, "Results and $1 finished job(s) cleared"],
  [/^已清空检测结果和 (\d+) 个已结束任务；(\d+) 个进行中任务保留$/, "Results and $1 finished job(s) cleared; $2 active job(s) kept"],
  [/^读取媒体清单超时（(\d+) 秒无响应）$/, "Reading the media manifest timed out (no response within $1 s)"],
  [/^(.+)下载进度$/, (m, name) => `${name} download progress`],
  [/^(.+) 已保存$/, "$1 saved"],
  [/^(.+) 下载失败$/, "$1 download failed"],
  [/^FluxCatch — 检测到 (\d+) 个媒体$/, "FluxCatch — $1 media found"],  [/^(\d+) 分钟前$/, "$1m ago"],
  [/^(\d+) 小时前$/, "$1h ago"],
  [/^已连接/, "Connected"],
  [/^匹配 · 协议 (.+) · 能力配置 (.+)$/, "Match · protocol $1 · profile $2"],
  [/^匹配 · 协议 (.+)$/, "Match · protocol $1"],
  [/^授权已生效，Chrome 正在完成初始化；约 (\d+) 秒后自动重试…$/, "Authorized; Chrome is finishing initialization, retrying automatically in $1 s…"],
  [/^画质 (\d+) · (.+)$/, (m, index, rest) => `Quality ${index} · ${translateMessage(rest)}`],
  [/^清晰度 (\d+)$/, "Quality $1"],
  [/^清晰度读取失败：(.+)。仍可直接下载；稍后重试可再次读取清晰度。$/, (m, reason) => `Could not read qualities: ${translateMessage(reason)}. You can still download directly; try again later to read qualities.`],
  [/^(.+?)：(.+)$/, (m, head, tail) => {
    const translatedTail = translateMessage(tail);
    const translatedHead = translateMessage(head);
    if (translatedTail === tail && translatedHead === head) return null;
    return `${translatedHead}: ${translatedTail}`;
  }],
  [/^下载 (.+)$/, "Download $1"],
  [/^取消 (.+)$/, "Cancel $1"],
  [/^复制 (.+) 的链接$/, "Copy link for $1"],
  [/^选择清晰度：(.+)$/, "Choose quality: $1"],
  [/^浏览器下载 · (.+)$/, (m, tail) => `Browser download · ${translateMessage(tail)}`],
  [/^本地下载 · (.+)$/, (m, tail) => `Local download · ${translateMessage(tail)}`],
  [/^(.+)。请重新读取。$/, (m, head) => `${translateMessage(head)}. Please read again.`],
  [/^HLS 播放列表超过(.+)上限$/, "The HLS playlist exceeds the $1 limit"],
  [/^网络策略已阻止 (.+)（(.+)）$/, "Blocked by network policy: $1 ($2)"],
  [/^不支持的文件名字段：(.+)$/, "Unsupported file name fields: $1"],
  [/^不支持的文件名字段：(.+)。$/, "Unsupported file name fields: $1."],
  [/^文件名模板不能超过 (.+) 个字符。$/, "The file name template cannot exceed $1 characters."],
  [/^忽略域名第 (.+) 行无效。$/, "Ignored domains line $1 is invalid."],
  [/^(.+)不能为空。$/, (m, label) => `${translateMessage(label)} is required.`],
  [/^(.+)必须是整数。$/, (m, label) => `${translateMessage(label)} must be an integer.`],
  [/^(.+)必须在 (.+) 到 (.+) 之间。$/, (m, label, min, max) => `${translateMessage(label)} must be between ${min} and ${max}.`]
];

// Elements whose text is user content (filenames, URLs) and must never be
// translated even when it happens to contain Chinese. Select option *values*
// are never touched (only text nodes and listed attributes are translated).
const DO_NOT_TRANSLATE = ".media-title, .media-url, .job-title, .media-thumbnail, .template-preview, code, pre, textarea, input, [data-no-i18n]";

const TRANSLATED_ATTRS = ["title", "placeholder", "aria-label", "aria-description", "aria-valuetext"];
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "CODE", "PRE", "TEXTAREA", "INPUT"]);

let activeLanguage = "zh";
let observer = null;

function hasCjk(text) {
  return /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(text);
}

/** Translate one user-facing string. Identity for zh or unknown strings. */
export function translateMessage(text, language = activeLanguage) {
  const raw = String(text ?? "");
  if (!raw || language === "zh" || !hasCjk(raw)) return raw;
  const leading = /^\s*/.exec(raw)[0];
  const trailing = /\s*$/.exec(raw)[0];
  const core = raw.trim();
  if (!core) return raw;
  if (Object.prototype.hasOwnProperty.call(EN_CATALOG, core)) return leading + EN_CATALOG[core] + trailing;
  for (const [pattern, replacement] of RULES) {
    const match = typeof replacement === "function" ? pattern.exec(core) : null;
    if (typeof replacement === "function") {
      if (!match) continue;
      const result = replacement(...match);
      if (typeof result === "string" && result !== core) return leading + result + trailing;
      continue;
    }
    if (pattern.test(core)) return leading + core.replace(pattern, replacement) + trailing;
  }
  return raw;
}

/** Best-effort alias for background/service-worker call sites. */
export const t = translateMessage;

export function resolveUiLanguage(pref, uiLanguage = "zh-CN") {
  if (pref === "en" || pref === "zh") return pref;
  return /^zh/i.test(String(uiLanguage || "")) ? "zh" : "en";
}

export function setUiLanguage(language) {
  activeLanguage = language === "en" ? "en" : "zh";
  return activeLanguage;
}

export function getUiLanguage() {
  return activeLanguage;
}

function normalizePref(value) {
  return value === "en" || value === "zh" || value === "auto" ? value : "auto";
}

export async function loadUiLanguage(storage) {
  const store = storage || globalThis.chrome?.storage?.local;
  if (!store?.get) return "auto";
  const stored = await store.get(UI_LANGUAGE_STORAGE_KEY);
  return normalizePref(stored?.[UI_LANGUAGE_STORAGE_KEY]);
}

export async function saveUiLanguage(pref, storage) {
  const store = storage || globalThis.chrome?.storage?.local;
  const value = normalizePref(pref);
  if (store?.set) await store.set({ [UI_LANGUAGE_STORAGE_KEY]: value });
  return value;
}

function translateAttribute(attr) {
  if (!attr?.value || !hasCjk(attr.value)) return;
  const translated = translateMessage(attr.value);
  if (translated !== attr.value) attr.value = translated;
}

function translateTextNode(node) {
  const parent = node.parentElement;
  if (!parent || SKIP_TAGS.has(parent.tagName)) return;
  if (parent.closest?.(DO_NOT_TRANSLATE)) return;
  if (!hasCjk(node.data)) return;
  const translated = translateMessage(node.data);
  if (translated !== node.data) node.data = translated;
}

function translateElementAttributes(element) {
  for (const name of TRANSLATED_ATTRS) {
    if (element.hasAttribute?.(name)) translateAttribute(element.getAttributeNode(name));
  }
}

/** Translate current DOM content once (text nodes + UI attributes). */
export function applyDomI18n(root = globalThis.document) {
  if (!root) return 0;
  let count = 0;
  const walker = root.createTreeWalker
    ? root.createTreeWalker(root.nodeType === 9 ? root.documentElement || root : root, 4)
    : null;
  if (walker) {
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || SKIP_TAGS.has(parent.tagName) || parent.closest?.(DO_NOT_TRANSLATE)) continue;
      if (!hasCjk(node.data)) continue;
      const translated = translateMessage(node.data);
      if (translated !== node.data) { node.data = translated; count += 1; }
    }
  } else if (root.querySelectorAll) {
    for (const element of root.querySelectorAll("*")) {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === 3) { translateTextNode(child); }
      }
    }
  }
  for (const element of (root.querySelectorAll ? root.querySelectorAll("[title],[placeholder],[aria-label],[aria-description],[aria-valuetext]") : [])) {
    translateElementAttributes(element);
  }
  return count;
}

/**
 * Keep translating as the pages render: toasts, job cards, status strings and
 * background-origin error messages are all inserted after initial load.
 */
export function startI18nObserver(root = globalThis.document) {
  if (observer || typeof MutationObserver === "undefined" || !root) return observer;
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") {
        translateTextNode(mutation.target);
        continue;
      }
      if (mutation.type === "attributes") {
        const attr = mutation.target.getAttributeNode?.(mutation.attributeName);
        if (attr) translateAttribute(attr);
        continue;
      }
      for (const node of mutation.addedNodes) {
        if (node.nodeType === 3) translateTextNode(node);
        else if (node.nodeType === 1) {
          applyDomI18n(node);
          translateElementAttributes(node);
        }
      }
    }
  });
  observer.observe(root.documentElement || root, {
    childList: true,
    characterData: true,
    subtree: true,
    attributeFilter: TRANSLATED_ATTRS
  });
  return observer;
}

/**
 * Resolve the stored preference, activate the language, translate the current
 * document and keep translating mutations. Returns the resolved language.
 */
export async function bindUiI18n({ storage, onChanged } = {}) {
  let pref = "auto";
  try {
    pref = await loadUiLanguage(storage);
  } catch { /* default below */ }
  const uiLanguage = globalThis.chrome?.i18n?.getUILanguage?.() ?? "zh-CN";
  const language = setUiLanguage(resolveUiLanguage(pref, uiLanguage));
  const doc = globalThis.document;
  if (doc?.documentElement) doc.documentElement.lang = language === "en" ? "en" : "zh-CN";
  applyDomI18n(doc);
  startI18nObserver(doc);
  const changeSource = onChanged ?? globalThis.chrome?.storage?.onChanged;
  changeSource?.addListener?.((changes, areaName) => {
    if (areaName && areaName !== "local") return;
    const change = changes?.[UI_LANGUAGE_STORAGE_KEY];
    if (!change) return;
    const next = setUiLanguage(resolveUiLanguage(normalizePref(change.newValue), uiLanguage));
    if (doc?.documentElement) doc.documentElement.lang = next === "en" ? "en" : "zh-CN";
    applyDomI18n(doc);
  });
  return language;
}

/** One-shot language switch used by the options page picker. */
export async function changeUiLanguage(pref, { storage } = {}) {
  const value = await saveUiLanguage(pref, storage);
  return normalizePref(value);
}
