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

- [ ] 3.1 本地 DSH 运行时分发方式（内置 / 首下载 / 用户自带）
- [x] 3.2 直连 `apiproxy` 网关（HTTP POST + WebSocket），client 已实现（含 RPC 超时、WS 断线指数退避重连、按 session 过滤帧、dispose）；SSE 兜底暂缺，重连已覆盖大部分场景
- [x] 3.3 单一 session 管理（连续上下文）：webview 重建时恢复复用会话、侧栏切换、显式新建；待补：会话删除/重命名
- [ ] 3.4 设置：模型默认自托管（base URL / Key）、权限预设
- [ ] 3.5 分发版**禁用 `dsh-password-gate`** 鉴权插件（见 1.5 坑），保证本机单人免登录

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
- [ ] 5.3 上下文注入（文件 / 选区 / 诊断 / git diff / 终端）

## 6. 分发与打包 (distribution-packaging)

- [ ] 6.1 跨平台构建流水线（Mac / Win / Linux）
- [ ] 6.2 签名与公证（Mac 开发者证书 + notarize；Win 代码签名）
- [ ] 6.3 Linux 打包（deb / rpm / AppImage）
- [ ] 6.4 安装包内嵌或引导 DSH 运行时
