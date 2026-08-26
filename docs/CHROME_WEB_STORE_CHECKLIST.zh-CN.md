# FluxCatch Chrome Web Store 发布检查单

> 当前 `0.2.5` 是可测试的开发候选包，不是可直接提交的商店终稿。`npm run package` 当前只生成 GitHub/开发身份产物；正式 Item ID、公钥、独立 store build 和签名安装器尚待完成。Native Messaging 名称已固定为 `io.github.blanchot_alice.fluxcatch`。

## 1. 商店身份（发布阻塞）

- [ ] 在 Chrome Web Store 后台创建 FluxCatch 草稿并记录正式 Item ID。
- [ ] 获取与该条目对应的公开 key；签名私钥始终留在仓库之外。
- [ ] 建立独立 store identity，由正式公开 key 生成 store manifest，并确认其推导 ID 等于 Item ID；不得覆盖开发 identity。
- [ ] 用 Store identity 生成最终 ZIP，并让 CI 对解包后的该 ZIP 跑完整 Chrome E2E；不得把 GitHub/开发 identity 的包直接提交。
- [x] Native Messaging host 使用开发者自有的反向域名 `io.github.blanchot_alice.fluxcatch`。
- [ ] 同步修改以下影响面：
  - 生成后的 extension manifest 与 native manifest 的 `allowed_origins`；
  - native manifest 的文件名与 `name`；
  - macOS 安装/卸载脚本和已安装注册文件；
  - validator、native 测试、安装文档与打包清单；
  - 商店安装后的 `ping`/下载回归。
- [ ] 再次安装最终 native host；确认扩展能连接 `io.github.blanchot_alice.fluxcatch`。

Native Messaging 的 `allowed_origins` 不支持通配符。正式发布身份必须作为一个整体完成校验，避免扩展 ID、host 名和白名单只更新其中一部分。

## 2. 权限与隐私申报

- [ ] `downloads`：仅在用户选择或点击快速下载时启动/监控本地下载。
- [ ] `sidePanel`：提供用户打开的媒体与任务工作台。
- [ ] `storage`：保存设置、显式字段白名单的当前会话候选和已脱敏任务快照。
- [ ] `webRequest` 与 HTTP(S) host access：解释跨 CDN 媒体识别及短期请求头关联。
- [ ] `nativeMessaging`、`notifications` 保持 optional，并只从明确用户操作请求；说明检测无需本地引擎、多数保存需 Native pinned broker、仅严格 Instagram/X 固定来源默认例外走 Chrome；开启“可信直链也使用本地下载引擎”后该例外也走 Native，“保存前询问位置”仅影响 Chrome 路径。
- [ ] Web Store 数据使用表与 `PRIVACY.md` 完全一致：本地处理 URL、网页/媒体元数据及所选传输所需认证信息；无遥测、广告、出售或云同步。
- [ ] 说明检测本身被动；“自动补全站点画质”默认开启但可关闭，仅由可信播放/预加载请求触发，并使用同站凭据与单次 in-flight、成功 TTL、失败冷却限流；关闭后所有自动站点元数据请求停止，重新扫描仍可用；页面完成及打开/关闭扩展界面均不会触发请求。
- [ ] 数据共享声明同时覆盖两类必要请求：开启自动补全时发送到当前支持站点的固定 page-list/playback metadata endpoints，以及用户明确检查/下载时发送到对应资源服务器；不得写成“仅下载时传输”。
- [ ] 说明公共网络默认策略与“允许本地网络媒体”的显式开关；元数据和保留网络始终禁止。
- [ ] 审核说明包含 DRM fail-closed、平台政策拦截和本地 fixture 测试步骤。

## 3. 功能与证据

- [ ] 记录 0.2.5 最终 Node 测试数量、命令、日期与 commit；覆盖率门槛至少为 line/branch 65%、function 70%。
- [ ] 记录 0.2.5 最终 Native-host 测试数量、命令、日期与 commit。
- [ ] 对最终 clean commit 记录 Validator `valid` 输出、commit 与 Actions run。
- [ ] Chrome for Testing 对 **CI 生成并留存的 extension ZIP** 完成 Options、Popup、Side Panel、direct/HLS/DASH、3 个交互流与 13 个视觉状态断言。
- [ ] 通用 observed direct 在未授权 Native 的新 profile 中停在权限预检，不创建任务且不写入浏览器文件；结果记录在同一个 packaged-E2E report。
- [ ] Python 3.9 与 3.12 native-host 矩阵通过；native ZIP 根安装包装器完成最低版本拒绝测试。
- [ ] 同一 commit/`SOURCE_DATE_EPOCH` 连续两次生成完全相同的 extension/native ZIP SHA-256。
- [ ] `npm run verify:package` 通过 checksum、仅两个已列名 ZIP、当前 extension/native 源树匹配、完整 dirty-tree identity、共同 timestamp、规范路径、普通文件类型/mode 与 native entry/link 检查。
- [ ] Native 1/4 worker Range 请求日志证明真实重叠，产物哈希一致。
- [ ] HLS/DASH/音频转换最终产物用 `ffprobe` 验证，并归档命令、日志与哈希。
- [ ] 至少完成一轮真实但可公开复现的网站/播放器兼容性矩阵；不把 localhost 结果宣传为公网速度。
- [ ] Bilibili、Instagram、X 在补齐浏览器级 SPA/页面切换、worker 重启恢复、来源校验与下载链路前仅称“适配器 Beta”，不得称 Stable；Instagram/X 必须分别校验默认 Chrome 例外及 `useNativeForDirect=true` Native 覆盖路径的落盘字节数与 SHA-256，并确认 `saveAs` 仅影响 Chrome 路径。

验证命令：

```bash
npm test
npm run test:coverage
python3 -m unittest discover -s native-host/tests -v
python3 scripts/validate.py
npm run test:e2e
npm run package
npm run verify:package
cd dist && shasum -a 256 -c SHA256SUMS
```

## 4. 商店物料与主体

- [ ] 最终产品名及近似商标复核完成。
- [ ] Publisher 身份、支持 URL、公开隐私 URL 和联系渠道可用。
- [ ] `default_locale`、`zh_CN` 与 `en` 的产品名/描述在实际安装包中渲染正确，并与商店本地化文案一致。
- [ ] 当前 UI 的 1280×800 或 640×400 截图已制作；不使用废弃设计稿。
- [ ] 440×280 宣传图已制作。
- [ ] 商店文案只陈述已验证能力，不声称全站兼容、保证加速或处理受保护内容。
- [ ] macOS native 安装器完成签名、公证、安装、升级与卸载验证。

## 5. GitHub 发布

- [x] 公开仓库已从清理后的本目录建立；私有研究资料不进入历史。
- [ ] 检查 `e2e/artifacts/`、profile、媒体 fixture、日志、签名材料和本机绝对路径未被提交。
- [ ] 发布 extension/native 两个独立 ZIP 与 `SHA256SUMS`。
- [ ] 发布 CI build-once 留存的原始 ZIP/SHA artifact；发布步骤不得重新打包。
- [ ] 启用分支保护与依赖更新。
- [ ] 验证私密漏洞报告入口可实际提交（启用后记录日期与仓库设置链接）。
