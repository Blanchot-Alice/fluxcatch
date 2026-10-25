# Step v3-4 (v3.3), part 2: the rename, FluxCatch to Havre
# 第 v3-4 步（v3.3）第二部分：改名，FluxCatch 改为 Havre

Design review v3.3 §4 steps 2 and 3, after Andy approved the 2.2 list in `step-v3-4-rename-table.md` and the proposals of its section E: classes 2.1 and 2.2 renamed together on the branch `rename/havre`, every 2.2 item with its migration written and tested, the version at 0.3.0, the CHANGELOG entry written, the icons and the README logo regenerated from the v3.2 mark, the four headers captured in both themes and both languages. Nothing is committed; the GitHub repository rename is Andy's (v3.3 §3).
设计评审 v3.3 第 4 节第 2、3 步，Andy 批准了 `step-v3-4-rename-table.md` 的 2.2 清单和 E 节的建议之后：2.1 与 2.2 两类在 `rename/havre` 分支上一起改，每个 2.2 项的迁移都写了、测了，版本升到 0.3.0，CHANGELOG 条目写好，图标和 README 图标按 v3.2 标志重新生成，四个页眉按两套主题、两种语言截图。没有提交；GitHub 仓库改名由 Andy 做（v3.3 第 3 节）。

## What to review · 请审阅

- **The headers:** `docs/design-review/havre/headers-sheet.png` (popup, side panel, Downloads, Settings; Morning and Dusk; English and Chinese; device pixel ratio 2), and the sixteen single crops `header-<surface>-<theme>-<lang>.png` beside it. The wordmark is "Havre" in Fraunces at S and M; the mark is unchanged.
  **页眉**：`docs/design-review/havre/headers-sheet.png`（弹窗、侧边栏、下载记录页、设置页；清晨与黄昏；英文与中文；设备像素比 2），旁边是十六张单独的裁片 `header-<界面>-<主题>-<语言>.png`。字标是 Fraunces 的“Havre”，S 与 M 两档；标志不变。
- **The audit:** `docs/design-audit/v3-havre.md`, the full 108-screen run with the new wordmark; the left-edge check (b) is the §5 grid check the review asks for after the wordmark got shorter.
  **审计**：`docs/design-audit/v3-havre.md`，带新字标的 108 屏完整运行；左对齐线检查（b）就是评审在字标变短后要求重查的第 5 节网格检查。
- **The migrations and their tests:** section A of the table, each in code now; "What changed" below names the files.
  **迁移及其测试**：分类表 A 节的每一项都已落到代码里；下文“改了什么”列出文件。
- **The README additions:** the two sentences under the tagline (Monet's port; *havre* = haven) and the pronunciation note, once, in the English README.
  **README 新增**：标语下的两句（莫奈的港口；*havre* 即港湾）和只出现一次的读音说明，在英文 README 里。

## What changed · 改了什么

### The name everywhere it faces the user (class 2.1) · 面向用户的名字（2.1 类）

- One pass over 103 files replaced the product name in its four spellings (`FluxCatch`, `fluxcatch`, `FLUXCATCH`, `fluxCatch`), reading every line, and left class 2.3 untouched: `CHANGELOG.md`, `docs/design-audit/`, `docs/design-review/` (including this note's siblings and the review file names), `e2e/artifacts/`. The GitHub links `github.com/Blanchot-Alice/fluxcatch` are kept until the repository is renamed (v3.3 §3); GitHub redirects the old address afterwards.
  一遍扫过 103 个文件，逐行阅读后替换了产品名的四种写法（`FluxCatch`、`fluxcatch`、`FLUXCATCH`、`fluxCatch`），2.3 类一字未动：`CHANGELOG.md`、`docs/design-audit/`、`docs/design-review/`（含本页的同目录文件和评审文件名）、`e2e/artifacts/`。GitHub 链接 `github.com/Blanchot-Alice/fluxcatch` 等仓库改名后再改（v3.3 第 3 节）；改名后 GitHub 会把旧地址重定向。
- Extension name and command title in both locales; `brand.name` and every sentence that names the product in `ui/v2/messages/*.js`; the page titles; the Settings copy; the worker notifications; the engine's own sentences (`已保存到 Havre 文件夹`, `选择 Havre 的保存位置`, "not supported in Havre 0.3.0") together with the `job-failure.js` rules that match them; the installer and wrapper echo lines; the policies (`PRIVACY`, `SECURITY`, `ACCEPTABLE_USE`), `DESIGN.md`, the docs, the READMEs, and `LICENSE` ("Havre contributors", per section E).
  两种语言的扩展名与命令标题；`ui/v2/messages/*.js` 里的 `brand.name` 和每一句提到产品的话；页面标题；设置页文案；worker 的通知；引擎自己的句子（`已保存到 Havre 文件夹`、`选择 Havre 的保存位置`、“not supported in Havre 0.3.0”）以及 `job-failure.js` 里匹配它们的规则；安装脚本和包装脚本的提示行；各项政策（`PRIVACY`、`SECURITY`、`ACCEPTABLE_USE`）、`DESIGN.md`、各文档、两份 README，以及 `LICENSE`（按 E 节改为 "Havre contributors"）。
- Icons: `extension/icons/havre-mark.svg` and `havre-mark-16.svg` (renamed with `git mv`, content unchanged); the four PNGs and `docs/assets/icon.png` regenerated from them with `scripts/build-icons.mjs --logo`; the BrandMark's two paths follow.
  图标：`extension/icons/havre-mark.svg` 与 `havre-mark-16.svg`（用 `git mv` 改名，内容不变）；四个 PNG 和 `docs/assets/icon.png` 用 `scripts/build-icons.mjs --logo` 从它们重新生成；BrandMark 的两条路径随之改。
- Default save folder `~/Downloads/Havre` for new installs (`options.js` `DEFAULT_LOCATION`, `host.py`); see A15 below for existing installs.
  新安装的默认保存目录为 `~/Downloads/Havre`（`options.js` 的 `DEFAULT_LOCATION`、`host.py`）；旧安装见下文 A15。

### The identifiers and their migrations (class 2.2) · 标识符及其迁移（2.2 类）

- **A1 host id** `io.github.blanchot_alice.havre`: `background.js`, the manifest template (renamed `native-host/io.github.blanchot_alice.havre.json.in`), the packaging and validation scripts, the e2e's fake registration. `install-macos.sh` removes `io.github.blanchot_alice.fluxcatch.json` from every `NativeMessagingHosts/` folder it registers in; `uninstall-macos.sh` removes both names. Tested by `test_installer_migrates_a_0_2_5_install`.
  **A1 主机 id** `io.github.blanchot_alice.havre`：`background.js`、清单模板（改名为 `native-host/io.github.blanchot_alice.havre.json.in`）、打包与校验脚本、e2e 的假注册。`install-macos.sh` 在它注册的每个 `NativeMessagingHosts/` 目录里删除 `io.github.blanchot_alice.fluxcatch.json`；`uninstall-macos.sh` 两个名字都删。由 `test_installer_migrates_a_0_2_5_install` 测试。
- **A2 runtime folder and config** `~/Library/Application Support/Havre/`: the installer copies `FluxCatch/config.json` to `Havre/config.json` when the new file is missing (never over an existing one), leaves the old file for the old uninstaller, and removes the old `FluxCatch/native-host/` copy; `host.py` `load_host_config` does the same copy once if it finds the old file and not the new (`LEGACY_CONFIG_PATH`). Tested in the native suite (installer test above; `test_rename_migrations_keep_old_environment_config_folder_and_work_dirs`).
  **A2 运行目录与配置** `~/Library/Application Support/Havre/`：安装脚本在新文件不存在时把 `FluxCatch/config.json` 复制为 `Havre/config.json`（绝不覆盖已有的），旧文件留给旧卸载脚本，并删除旧的 `FluxCatch/native-host/` 副本；`host.py` 的 `load_host_config` 在只找到旧文件时同样复制一次（`LEGACY_CONFIG_PATH`）。引擎测试套件覆盖（上述安装测试；`test_rename_migrations_keep_old_environment_config_folder_and_work_dirs`）。
- **A3** `havre_network_policy.py`, renamed with `git mv`; `host.py` imports it, the installer copies it, the uninstaller removes both names from the runtime folder.
  **A3** `havre_network_policy.py`，用 `git mv` 改名；`host.py` 导入它，安装脚本复制它，卸载脚本把新旧两个文件名都从运行目录删除。
- **A4** `package.json` name `havre`; archives `havre-extension-<version>.zip` and `havre-native-host-macos-<version>.zip`; tree-hash salt `havre-extension-tree-v1`; CI artifact names (A14) with them.
  **A4** `package.json` 名为 `havre`；归档 `havre-extension-<版本>.zip` 与 `havre-native-host-macos-<版本>.zip`；树哈希盐值 `havre-extension-tree-v1`；CI 产物名（A14）随之改。
- **A5** ports `havre-popup`, `havre-sidepanel`, `havre-downloads`, renamed outright.
  **A5** 端口 `havre-popup`、`havre-sidepanel`、`havre-downloads`，直接改名。
- **A6 storage keys**: `extension/lib/legacy-storage.js` (new) holds the four pairs; `migrateLegacyStorage()` runs once at every worker start (`background.js`, before the worker reads its language) and moves each old value whose new key is unset, then deletes the old keys; `readWithLegacy()` reads the new key and falls back to the old one, used by `locale.js`, `pond.js` and `customization.js`, so a page that opens before the worker has migrated still finds the language, the pond seed, the UI customisation and the developer-tools switch. Keys are read one at a time, because every storage-like client the pages accept takes a single key. Tested by `tests/legacy-storage.test.js`.
  **A6 存储键**：新文件 `extension/lib/legacy-storage.js` 记着四对键；`migrateLegacyStorage()` 在每次 worker 启动时运行一次（在 `background.js` 读语言之前），把新键尚未设置的旧值搬过去，再删除旧键；`readWithLegacy()` 先读新键、再回退读旧键，`locale.js`、`pond.js`、`customization.js` 都用它，所以在 worker 完成迁移之前打开的页面仍能找到语言、池塘 seed、界面定制和开发者工具开关。键逐个读取，因为页面接受的每种类存储客户端都只收单个键。由 `tests/legacy-storage.test.js` 测试。
- **A7** `https://havre.invalid`: `restoreSession` skips a restored candidate whose URL starts with `https://fluxcatch.invalid/`; the next manifest inspection regenerates it.
  **A7** `https://havre.invalid`：`restoreSession` 跳过地址以 `https://fluxcatch.invalid/` 开头的恢复候选；下一次清单检查会重新生成。
- **A8, A9, A12, A13, A14**: renamed outright, as the table says (notification id prefix; content-script channel and guards; the engine's User-Agent `Mozilla/5.0 Havre/0.3.0`, proxy realm and block message; internal identifiers; CI names and temp prefixes).
  **A8、A9、A12、A13、A14**：按表直接改名（通知 id 前缀；内容脚本信道与守卫；引擎的 User-Agent `Mozilla/5.0 Havre/0.3.0`、代理 realm 与拦截提示；内部标识符；CI 名称与临时目录前缀）。
- **A10 work prefixes**: new directories take `havre-hls-`, `havre-dash-`, `.havre-dash-pair-`, `.havre-convert-`, `.havre-ytdlp-`; `LEGACY_TEMP_WORK_PREFIXES` keeps the five old ones inside `TEMP_WORK_PREFIXES`, which the stale sweep, the folder confinement and the pause-marker check all read, so a job paused under 0.2.5 resumes and old leftovers are still collected. Tested in the native suite.
  **A10 工作前缀**：新目录用 `havre-hls-`、`havre-dash-`、`.havre-dash-pair-`、`.havre-convert-`、`.havre-ytdlp-`；`LEGACY_TEMP_WORK_PREFIXES` 把旧的五个留在 `TEMP_WORK_PREFIXES` 里，过期清扫、目录围栏和暂停标记检查读的都是它，所以 0.2.5 下暂停的任务能续传，旧残留照样清理。引擎测试套件覆盖。
- **A11 environment**: `host.py` reads every `HAVRE_*` variable through `env_setting(name)`, which falls back to `FLUXCATCH_<name>` (`CONFIG`, `DISABLE_SYSTEM_PROXY`, `DOWNLOAD_DIR`, `FFMPEG`, `YTDLP`, `PP`), so a launcher written by the 0.2.5 installer still finds its FFmpeg until the user reinstalls; the harness and CI names are renamed outright. Tested in the native suite.
  **A11 环境变量**：`host.py` 读每个 `HAVRE_*` 变量都经 `env_setting(name)`，它会回退到 `FLUXCATCH_<name>`（`CONFIG`、`DISABLE_SYSTEM_PROXY`、`DOWNLOAD_DIR`、`FFMPEG`、`YTDLP`、`PP`），0.2.5 安装脚本写出的启动器在用户重装前仍能找到它的 FFmpeg；测试与 CI 用的名字直接改。引擎测试套件覆盖。
- **A15 default folder**: `default_download_dir()` returns `~/Downloads/FluxCatch` when that folder exists and `~/Downloads/Havre` does not, otherwise `~/Downloads/Havre`; a chosen folder in `config.json` is never touched. Tested in the native suite.
  **A15 默认目录**：`default_download_dir()` 在 `~/Downloads/FluxCatch` 存在而 `~/Downloads/Havre` 不存在时返回前者，否则返回后者；`config.json` 里选过的目录绝不动。引擎测试套件覆盖。
- **A16 version 0.3.0** in `manifest.json`, `package.json`, `build-profile.js` and `host.py`; the compatibility rule is unchanged (equal version strings, protocol 1, capability profile 1), and `scripts/validate.py` passes. Test fixtures that spelled the version were updated; the version in the engine's user-visible sentences too.
  **A16 版本 0.3.0**：`manifest.json`、`package.json`、`build-profile.js`、`host.py`；兼容规则不变（版本字符串相等、协议 1、能力档案 1），`scripts/validate.py` 通过。写死版本的测试夹具已更新，引擎面向用户的句子里的版本也是。

### History (class 2.3) · 历史（2.3 类）

- `CHANGELOG.md` keeps every entry as written and gains `## 0.3.0 — Unreleased`, whose first line is the rename, followed by the mark, the section rule, the v3 design review work and the site adapters, all unreleased.
  `CHANGELOG.md` 保留每一条原文，新增 `## 0.3.0 — Unreleased`，第一行是改名，随后是标志、分节线、v3 设计评审的工作和站点适配，都尚未发布。

## Tests and checks · 测试与检查

- `node --test tests/*.test.js`: 390 pass (385 before this step, plus the five of `tests/legacy-storage.test.js`); every test that asserted the product name, the version or a renamed identifier was updated, and fixture handles such as `https://x.com/havre` followed the global pass as arbitrary data.
  `node --test tests/*.test.js`：390 项通过（本步之前 385 项，加 `tests/legacy-storage.test.js` 的 5 项）；凡断言产品名、版本或已改名标识符的测试都已更新，`https://x.com/havre` 一类的夹具句柄作为任意数据随全局替换一起改了。
- `python3 -m unittest discover -s native-host/tests`: 85 pass (83 before, plus `test_rename_migrations_keep_old_environment_config_folder_and_work_dirs` and `test_installer_migrates_a_0_2_5_install`, the second of which runs `install-macos.sh` and `uninstall-macos.sh` against a fake home that holds a 0.2.5 install).
  `python3 -m unittest discover -s native-host/tests`：85 项通过（之前 83 项，加 `test_rename_migrations_keep_old_environment_config_folder_and_work_dirs` 和 `test_installer_migrates_a_0_2_5_install`，后者在放着 0.2.5 安装的假 home 里真实运行 `install-macos.sh` 和 `uninstall-macos.sh`）。
- `npm run test:e2e`: passed (8 detection cases, 3 UI pages, 3 interaction flows, 15 visual states), run twice, the second time after the last fixture edit; the matrix now shows the Havre wordmark.
  `npm run test:e2e`：通过（8 个检测用例、3 个 UI 页面、3 个交互流程、15 个视觉状态），跑了两次，第二次在最后一处夹具改动之后；矩阵现在显示 Havre 字标。
- `node scripts/design-audit.mjs --label v3-havre`: 108 screens, ALL BUDGETS MET; published as `docs/design-audit/v3-havre.md`. The left edges (b) of the four header screens are the same as before the rename (popup 16 and 60; side panel 64; Downloads 272; Settings 200, 272 and 448), so the shorter wordmark sits on the same §5 grid; the pond and header columns are unchanged.
  `node scripts/design-audit.mjs --label v3-havre`：108 屏，ALL BUDGETS MET；发布为 `docs/design-audit/v3-havre.md`。四个页眉所在屏的左对齐线（b）与改名前相同（弹窗 16 与 60；侧边栏 64；下载记录页 272；设置页 200、272 与 448），所以变短的字标仍落在第 5 节的网格上；池塘列与页眉列不变。
- `python3 scripts/validate.py`: valid (host id, versions and the capability profile agree across the manifest, the package, the build profile and the engine).
  `python3 scripts/validate.py`：有效（主机 id、版本和能力档案在清单、包、构建档案和引擎四处一致）。
- `npm run package -- --allow-dirty`: `dist/havre-extension-0.3.0.zip` and `dist/havre-native-host-macos-0.3.0.zip`, checksums verified; `scripts/verify_packages.py` reports the identity of a dirty tree (`uncommitted:extension@sha256:…`) rather than a commit, as it must until the branch is committed, which CI then checks on a clean checkout.
  `npm run package -- --allow-dirty`：`dist/havre-extension-0.3.0.zip` 与 `dist/havre-native-host-macos-0.3.0.zip`，校验和通过；`scripts/verify_packages.py` 报告的是脏工作树的身份（`uncommitted:extension@sha256:…`）而非提交号，在分支提交之前理应如此，CI 随后在干净检出上核对。
- Captures: `docs/design-review/havre/` (the sixteen header crops and `headers-sheet.png`); the README screenshots in `docs/assets/` and `docs/assets/en/` were regenerated from the same run so the README shows the new wordmark.
  截图：`docs/design-review/havre/`（十六张页眉裁片和 `headers-sheet.png`）；`docs/assets/` 与 `docs/assets/en/` 里的 README 截图也从同一次运行重新生成，README 显示的是新字标。

## Interpretations and deviations · 解读与偏离

1. **The GitHub links stay until the repository is renamed** (v3.3 §3, section E of the table): `README.md` and `README.zh-CN.md` still point at `github.com/Blanchot-Alice/fluxcatch` for the clone command, the Releases page and the two badges. Once Andy renames the repository, the remote, the badges and those links change in one small follow-up.
   **GitHub 链接等仓库改名后再动**（v3.3 第 3 节，分类表 E 节）：`README.md` 与 `README.zh-CN.md` 里克隆命令、Releases 页面和两枚徽章仍指向 `github.com/Blanchot-Alice/fluxcatch`。Andy 把仓库改名后，远程地址、徽章和这些链接用一次小改动一起换掉。
2. **Which 0.2.5 mentions remain.** Comments that explain a migration say "0.2.5" on purpose. `PRIVACY.md` line 28 still says the stable 0.2.5 profile exposes no YouTube controls: that sentence was already out of date before the rename (the YouTube adapter is on in the GitHub profile since the site-adapter work), and rewriting a privacy claim is outside a rename; it is flagged here for Andy. Every other live mention of the version reads 0.3.0; the historical lines of `docs/RELEASE.md` (the 0.2.4 baseline) stay as they were.
   **哪些 0.2.5 还在。** 解释迁移的注释里有意写着“0.2.5”。`PRIVACY.md` 第 28 行仍说稳定的 0.2.5 档案不暴露 YouTube 控件：这句在改名之前就已过时（站点适配工作之后，GitHub 档案里的 YouTube 适配器是开着的），改写隐私声明超出改名的范围，在此标记给 Andy。其余活着的版本提法都已是 0.3.0；`docs/RELEASE.md` 的历史行（0.2.4 基线）保持原样。
3. **The storage migration reads keys one at a time.** The pages accept storage-like clients in tests and in the designer that take a single key, so `readWithLegacy` and `migrateLegacyStorage` issue single-key `get` and `remove` calls rather than array calls. It runs once per worker start and touches four keys; the cost is nil.
   **存储迁移逐个读键。** 页面在测试和设计器里接受的类存储客户端只收单个键，所以 `readWithLegacy` 与 `migrateLegacyStorage` 用单键的 `get` 和 `remove`，而非数组调用。它每次 worker 启动运行一次，只涉及四个键，代价可以忽略。
4. **The default-folder rule (A15) is decided at call time.** `default_download_dir()` looks at the disk each time it is asked: an old install keeps `~/Downloads/FluxCatch` for as long as that folder exists and `~/Downloads/Havre` does not; the day the user creates or chooses the new folder, the default follows. A folder chosen through Settings is stored in `config.json` and wins regardless.
   **默认目录规则（A15）在调用时判断。** `default_download_dir()` 每次被问到时看磁盘：只要 `~/Downloads/FluxCatch` 存在而 `~/Downloads/Havre` 不存在，旧安装就一直用旧目录；哪天用户建了或选了新目录，默认值就跟过去。通过设置页选过的目录存在 `config.json` 里，总是优先。
5. **The engine's version in its own sentences.** Three worker sentences and the engine's "not supported in Havre 0.3.0" messages spell the version; they moved to 0.3.0 with the bump, and the `job-failure.js` rules that classify them match by phrase, not by number.
   **引擎句子里的版本号。** worker 的三句话和引擎的“not supported in Havre 0.3.0”消息写明版本；它们随版本升级改为 0.3.0，`job-failure.js` 里归类这些句子的规则按短语匹配，不按数字。
6. **The tree-hash salt changed with the archive names (A4)**, so 0.3.0 package digests cannot be compared with 0.2.5 ones; the CHANGELOG entry says so.
   **树哈希盐值随归档名一起改了（A4）**，所以 0.3.0 的包摘要与 0.2.5 的不可比；CHANGELOG 条目写明了。
7. **`docs/design-review/` keeps the old name in its file names and text, this note included**, as class 2.3 requires; the table and this note are the two documents written for v3.3 and carry the old name where they describe the old state.
   **`docs/design-review/` 的文件名和正文保留旧名，包括本页**，这是 2.3 类的要求；分类表和本页是为 v3.3 写的两份文档，在描述旧状态的地方用旧名。
