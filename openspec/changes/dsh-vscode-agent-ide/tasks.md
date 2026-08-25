## 0. 产品定位确认（需求梳理已完成）

- [x] 0.1 目标：独立桌面 IDE 产品，可分发他人，不依赖大厂 AI agent 产品
- [x] 0.2 地基：fork Code - OSS（MIT），非扩展、非 Theia 自建
- [x] 0.3 分发：Mac / Win / Linux 独立安装包，用户无需先装 VSCode

## 1. DSH 接口调研 (spike) — ✅ 完成

- [x] 1.1 阅读 deepseek-harness 文档（CLI / Web UI 架构 / API Proxy / RPC / ACP），确认对外协议
- [x] 1.2 确认程序化接口：`dsh web` 暴露 `apiproxy` 网关（:3080）。**实测端到端跑通**：unary = `POST /api/<ns>.<method>`（信封 `{type:'client-request',rpcId,method,payload}`，响应 `{type:'server-response',result:{ok,value|error}}`）；事件下行 = WebSocket `ws://host/api/events.mux`（帧 `payload.type` ∈ `session/subscribed`/`session/event`/`session/projection`/`session/queue`/`agent/*`）；审批回传 = `POST /api/respond`；`GET /api/events.mux` 另有 SSE 兜底。DSH 的 `packages/acp` 是自动化/子代理专用 stdio 协议（非编辑器 ACP），VSCode 无原生 ACP client，故网关 RPC 为正确路径；`headless` 仅一次性
- [x] 1.3 结论：原生面板可行，直连 API 网关；降级方案保留 `headless` CLI 做"派发即跑"
- [x] 1.5 **端到端集成联调（probe 跑通）**：在 `dsh-vscode-ide/spike/probe.mjs` 用 Node 全局 `fetch` + `WebSocket` 直连运行中的 `dsh web`，验证 `session.create`→`ws /api/events.mux` 订阅→`session.models`（目录含 `deepseek-official`/`opencode`(claude/gpt/gemini/qwen…)/`xiaomi` 等）→`session.prompt`（agent 真实运行并流式 `assistant/chunk`）。**坑**：本机曾装 `dsh-password-gate` 插件，所有 `/api` 调用返回 `unauthenticated`；分发版必须移除该插件（删 `~/.dsh/profiles/web/cordis.patch.yml` 的 `dsh-password-gate` 条目 + `~/.dsh/login-plugin` 凭据目录）。
- [x] 1.4 确认 DSH 模型配置机制（见 design 决策 6）：配置存 `<harness home>/settings.yaml` 的命名空间段（如 `llm-deepseek`），API Key 走独立 `credentials` 提供方（不落明文）；运行时经 `apiproxy`：`llm.providers`/`llm.models`/`llm.discoverModels` 取目录，`settings.describe/update/replace/mutate` 写配置，`credentials.set/unset` 存密钥，`session.models`/`session.selectModel` 做对话内即时切换。与 Settings → Models + 对话内选择器方案一一对应。

## 2. Fork VSCodium 底座

- [x] 2.1 克隆 VSCodium 仓库（`github.com/VSCodium/vscodium`，已 clone 到 `vscodium-fork/`）；其构建会按 `upstream/stable.json` 固定 commit clone `microsoft/vscode` 源码并套用 53 个去 MS 补丁
- [x] 2.2 品牌隔离：产品名定为 **Codon**，已在 `vscodium-fork/prepare_vscode.sh` 的 `setpath` 把 `nameShort/nameLong/applicationName/dataFolderName/linuxIconName/urlProtocol/darwinBundleIdentifier/win32*` 与 Windows 安装 GUID 全部改为 Codon（新生成 12 个 GUID 避免与 VSCodium 冲突）；`Microsoft Corporation`→`Codon` 的替换已改；更新/issue URL 指向 `github.com/codon-ide/codon` 占位；`extensionsGallery` 仍走 Open VSX（VSCodium 默认）。**待办**：品牌图标（`.icns/.ico/.png`）仍未替换，暂沿用 VSCodium 图标。
- [x] 2.3 上游同步策略：跟随 VSCodium 的固定 vscode commit（非实时 rebase）；agent 集成层全部走 `extensions/dsh-agent` 内置扩展，与核心解耦
- [ ] 2.4 构建工具链：用 nvm 装 node 24.15.0（VSCodium `.nvmrc`）；先跑通基线构建再注入扩展（首次 clone vscode ~1GB + npm ci + gulp 原生编译，耗时较长）
- [x] 2.5 注入 `dsh-agent` 内置扩展：**关键发现**——vscode 构建按 `extensions/*/package.json` glob 自动编译并内置 `extensions/` 下的本地扩展，**无需**注册进 built-in `extensions/extensions.json`（那是给 Marketplace 下载型扩展用的）。已新增 `vscodium-fork/dsh-inject.sh`：在 `prepare_vscode.sh` 套完补丁后，把 `dsh-agent-extension/` 拷贝到 `vscode/extensions/dsh-agent/`，并替换为 vscode 构建兼容的 `tsconfig.json`（extends `../tsconfig.base.json` + 引用 `../../src/vscode-dts/vscode.d.ts`，不依赖 `@types/vscode`/`ws`）。**AI 优先默认布局**用扩展 `activate` 时 `executeCommand('dshAgent.view.focus')` 实现（启动即聚焦 AI 视图，不自动开编辑器），无需改 workbench。

## 3. DSH 集成 (dsh-integration)

- [x] 3.1 本地 DSH 运行时分发方式：**内置**——`scripts/vendor-dsh.sh` 把 `@deepseek-ai/dsh` 装入 `app/dsh-runtime/`，扩展用 Codon 二进制 Node 模式（ELECTRON_RUN_AS_NODE）自动拉起网关（探测链：gatewayCommand 设置 > 内置 > PATH > npx > npm exec）
- [x] 3.2 直连 `apiproxy` 网关（HTTP POST + WebSocket），client 已实现（含 RPC 超时、WS 断线指数退避重连、按 session 过滤帧、dispose）；SSE 兜底暂缺，重连已覆盖大部分场景
- [x] 3.3 单一 session 管理（连续上下文）：webview 重建时恢复复用会话、侧栏切换、显式新建；待补：会话删除/重命名（DSH 无 session.delete RPC，需文件系统 + 网关重启）
- [~] 3.4 设置：设置面板已实现（网关地址 / 启动命令 / 权限预设持久化，Global 配置）；模型自托管 Key（DSH credentials API）待接
- [x] 3.5 分发版**禁用 `dsh-password-gate`** 鉴权插件（见 1.5 坑），保证本机单人免登录 ✅（vendor 脚本防护 + 扩展侧 unauthenticated 指引，见 P3.3）

## 4. 编辑器内 agent 面板 (agent-conversation-panel)

- [x] 4.1 面板骨架（活动栏入口 + webview；已迁至右侧二级侧栏，AI 优先布局）
- [x] 4.2 实时对话转录（流式，含 reasoning 折叠 / markdown 渲染 + XSS 转义 + CSP）
- [~] 4.3 Gated 内联权限：面板内联卡片 ✓ / ✗ / ⊘始终（始终允许为适配层实现，DSH 侧权限预设待接）+ 面板失焦时通知兜底
- [~] 4.4 暂停 / 停止 / 中途插话：停止按钮已接 `session.stop`（DSH 侧方法名待联调确认）；插话经 `mode: queue` 支持；暂停未做
- [ ] 4.5 可折叠 Steps / Terminal / Changed files 视图（Steps 已内联在转录中，Terminal / Changed files 未做）
- [ ] 4.6 内核级 inline diff 审阅（fork 优势）

## 5. 改动审阅 (change-review)

- [ ] 5.1 反射 DSH 落盘改动（+ 可选 gutter ✎）
- [ ] 5.2 改动文件清单 + 点击打开原生 diff
- [-] 5.3 ~~上下文注入（文件 / 选区 / 诊断 / git diff / 终端）~~ 已移除：产品定位纯 AI 智能体模式，上下文由 agent 通过自身工具获取（commit c2e5061）

## 6. 分发与打包 (distribution-packaging)

- [ ] 6.1 跨平台构建流水线（Mac / Win / Linux）
- [ ] 6.2 签名与公证（Mac 开发者证书 + notarize；Win 代码签名）
- [ ] 6.3 Linux 打包（deb / rpm / AppImage）
- [ ] 6.4 安装包内嵌或引导 DSH 运行时

---

## 后续路线图（2026-08 规划）

> 前置：核心链路已可用（网关自动拉起 / 流式对话 / 会话 / 审批）。
> 按五阶段推进；里程碑 M1 = 自用稳定版（Phase 2 完）、M2 = 可分发 Alpha（Phase 4 Mac 包）、M3 = 正式版（三平台 + inline diff）。

### Phase 1 · 质量地基（~1 周，先行）✅ 2026-08-22 完成

- [x] P1.1 协议层测试：vitest + FakeWebSocket，14 用例覆盖 RPC 信封、超时、连接错误、respond 信封、按 session 过滤、指数退避（500ms→10s cap）、stale socket 隔离、dispose 停止重连、session 方法 payload
- [x] P1.2 拆分 extension.ts（539 行 → ~230 行编排层）：`gateway.ts`（生命周期）/ `approvals.ts`（审批）/ `workspaceFiles.ts`(文件树+只读) / `webviewPage.ts`(HTML) / `dshClient.ts`(协议，未动)
- [x] P1.3 webview↔extension 消息协议类型化：`messages.ts` 定义 WebviewToExt / ExtToWebview / DshFrame 联合类型，与 main.js 实际 kind 已核对
- [x] P1.4 eslint(flat config) + prettier + GitHub Actions CI（lint → compile → test）；顺带修复 rpc 错误缺 cause 的 lint 问题

### Phase 2 · 核心体验闭环（~2 周，产品价值最高）

- [x] P2.1 改动文件清单 + 原生 diff 审阅（tasks 5.1/5.2）✅：ChangeTracker（turn 期间 FS watcher + git 基线剔除既有脏文件，不依赖工具名 schema）；`codon-base` scheme 提供 HEAD 版本，点击改动条 chip → `vscode.diff` 右分屏；webview 顶部改动条（＋/±/✕ 状态、按会话记忆、清除按钮）；已删除文件展示 HEAD 内容。纯函数（parseGitStatus/extractPathHint）有单测
- [x] P2.2 Terminal 输出与工具调用结果的折叠视图 ✅：tool/call + tool/result 渲染为可折叠卡片（默认收起，头部显示工具名+参数摘要，展开看 args/result），bash 结果即 Terminal 视图，isError 红色标记；历史回放同构
- [x] P2.3 停止/插话健壮性 ✅：**实测发现 `session.stop` 方法不存在**（网关返回纯文本 not found），真实方法为 **`session.cancel`**（返回 `{accepted:true}` 后优雅 step/end → turn/end）；已修 client 并补实测语义测试。插话经 mode:queue 已支持
- [~] P2.4 会话删除/重命名：**rename 已完成**——`session.rename` 实测可用（返回 {title,seq} 并广播 session/title），侧栏 hover ✎ 内联改名 + 自动刷新列表；删除仍无 RPC，维持现状（收敛列表长度）

### Phase 3 · 模型与权限体系（~2 周）

- [x] P3.1 Settings → Models ✅：**写入协议真机验证通过**——`credentials.set {ref,value}`（ref 为环境变量名风格）+ `settings.mutate {ns:"llm-pi-ai", ops:[{op:"set",path:["providers",<id>],value}]}`；provider 级必填 `api`（wire protocol，源码确认取值 openai-completions / openai-responses / azure-openai-responses / anthropic-messages，位置在 provider 而非 model）。实现：设置面板「模型」section（列表含 Key 配置状态 🔑、删除；表单添加 id/baseURL/Key/模型 ID），ModelsManager 封装（add 失败回滚凭据），v1 固定 openai-completions。25 测试全绿 + 真机增删冒烟通过
- [x] P3.2 权限预设对接 DSH 权限模型 ✅：**实测确认官方写入路径**——apiproxy 无权限专用 RPC，DSH web UI 自己也是 `settings.mutate {ns:"permission", ops:[{op:"set",path:["defaultPreset"]}]}`（源码 dsh-client-ui-permission-presets/client.js）；作用于新会话。真机验证：改 read-only → 新建会话投影 currentValue=read-only → 还原。实现：PermissionManager + 设置面板下拉（read-only / workspace-write / danger-full-access）；"始终允许"工具级白名单保留在扩展侧作为补充层
- [x] P3.3 分发版禁用 `dsh-password-gate` 插件 ✅：补齐缺失的 scripts/vendor-dsh.sh（README 已引用但此前不存在；固定 DSH_VERSION=0.1.1-rc.2，装后校验 bin.js 存在），内建 password-gate 防护（装包后检测删除）；扩展侧 humanizeError 把 unauthenticated 翻译为可操作修复指引（tasks 3.5 一并完成）

### Phase 4 · 分发打包（~3 周，可与 Phase 2/3 并行启动）

- [x] P4.1 VSCodium 基线构建跑通 ✅（此前已完成：vscode 源码 5.6G + node_modules + 首个 VSCode-darwin-x64；本轮 build_codon.sh 全流程重跑 ~45min 成功出包。注意：CLI 子构建需 rustup，未装则该步跳过但不影响 app 本体）
- [x] P4.2 vendor-dsh.sh 进打包流水线 ✅：build_codon.sh 收尾自动执行（扩展编译产物拷入 app + vendor 运行时）；vendor 脚本增加 **npx 缓存快速路径**（同版本直接拷整棵依赖树 273M，秒级完成，绕开 registry 安装）。**真机冒烟通过**：Codon.app 启动 → 扩展自动拉起 vendored 网关 → RPC 正常。关键修复：Electron 内嵌 node 必须显式 `--expose-internals`（cordis-plugin-hmr 启动必需，系统 node 默认开启）
- [ ] P4.3 Mac 签名 + 公证先行 → Win 代码签名 → Linux deb/rpm/AppImage（tasks 6.1–6.3）
- [x] P4.4 品牌图标替换 ✅：程序化生成 DNA 双螺旋 mark（scripts/gen-brand-icons.py，PIL 预混色绕开 alpha 合成坑），产出 icns/ico/png 全规格入 `media/brand/`；fork dsh-inject.sh 每次构建覆盖 darwin/win32/linux 资源；现有 Codon.app 已替换
- [ ] P4.5 自动更新通道决策（自建 update API 或 v1 关闭自动更新）

### Phase 5 · 差异化产品力（持续）

- [ ] P5.1 内核级 inline diff 审阅（fork 终极形态，tasks 4.6）
- [ ] P5.2 AI-first 主页打磨：首启向导（选模型/填 Key/选项目）、空状态引导模板
- [ ] P5.3 VSCode 设置/扩展导入迁移路径
- [ ] P5.4 上下文压力优化：接近阈值建议 compact/新会话

### 关键风险对策

- DSH dev preview API 漂移 → 固定版本 + 协议测试用录制帧，升级时重放对比
- 单点 dshClient.ts 无测试 → P1.1 最优先
- webview main.js 868 行裸 JS → 动它之前先拆模块补最小回归测试
