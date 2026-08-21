## Context

DSH（deepseek-ai/deepseek-harness）是 MIT 开源、基于 Cordis 的 "everything is a plugin" agent 框架，提供 `dsh web`（本地 :3080 浏览器 UI，含 `apiproxy` 网关：unary = `POST /api/<ns>.<method>`，事件下行 = WebSocket `/api/events.mux`，`GET /api/events.mux` 有 SSE 兜底）、MCP client、hooks 桥接、读 `AGENTS.md`。Code - OSS（`microsoft/vscode`，MIT）是成熟的 TS 编辑器，fork 后即拥有全部源码、可再分发、可做内核级定制。目标升级为：一个可独立分发给他人的智能开发 IDE 产品，agent 与模型两层均不依赖大厂。

## Goals / Non-Goals

**Goals:**

- 独立桌面 IDE 产品（Mac/Win/Linux），可分发他人，不依赖大厂 AI agent 产品。
- 编辑器内原生 agent 面板（对话 + 自主循环），内核级 inline diff 审阅。
- AI 优先启动体验：打开即 AI 对话主页 + 项目文件树，默认无代码编辑区。
- Gated 掌控保证直接落盘下的安全性。
- 模型默认开源 / 自托管，摆脱商业 AI SaaS 绑定。
- MIT 合规、品牌隔离、剥离 MS 服务与遥测。

**Non-Goals:**

- 不 fork DSH 核心（官方 dev preview 不收外部 PR；作为外部消费者 / 插件集成）。
- v1 不做账号 / 多租户 / 云端同步（本地优先；协作后续再加）。
- 不做与上游 Code - OSS 功能竞争的大型重构，只叠加 agent 集成层。

## Decisions

1. **地基 = 基于 VSCodium（= 已去 MS 品牌/遥测/专有的 Code - OSS 构建，MIT）**：等价 fork Code - OSS，但省去品牌隔离与去遥测工作；拥有源码、可再分发、可做内核级 agent 集成（inline diff、命令面板深度集成），独立打包成 App 不要求用户装 VSCode，编辑器能力白拿；默认 Open VSX 市场（无 MS 账号），契合"不依赖大厂"。实操：fork VSCodium 构建体系，在它 check-out 的 vscode 源码中注入 DSH agent 层后再编译。备选：直接 fork `microsoft/vscode`（需自建去品牌/去遥测，弃）；Theia/Monaco 自建（彻底无 MS 血统，工程量过大，弃）；VSCode 扩展（无法独立分发、受 webview 约束，弃）。
2. **agent 大脑 = DSH**，本地运行时随包分发或首次运行下载；集成通道沿用 spike 结论：直连 `apiproxy` 网关（:3080）。实测线协议（已 spike 跑通端到端）：unary/回传 = `POST /api/<ns>.<method>`（body `{type:'client-request',rpcId,method,payload}`，响应 `{type:'server-response',result:{ok,value|error}}`）；事件下行 = WebSocket `ws://host/api/events.mux`（每帧 `{rpcId,payload:{type,sessionId?,...}}`，含 `session/subscribed`/`session/event`/`session/projection`/`session/queue`/`agent/*` 等）；审批回传 = `POST /api/respond`；`GET /api/events.mux` 另提供 SSE 兜底。`packages/acp` 是自动化/子代理专用协议，非编辑器 ACP，VSCode 无原生 ACP client，故网关 RPC 为正路。
3. **改码呈现** = DSH 直接落盘 + 编辑器反射 + 原生 diff；fork 允许做内核级 inline diff 审阅（优于扩展）。
4. **默认布局 = AI 优先主页**：启动即进入 AI 对话主页（对话为主界面，提示"要做什么"），侧栏常驻项目文件树；默认不展示代码编辑区，代码编辑 / diff 视图按需打开（点击文件树或 Changed files）。底层 Code - OSS 编辑器仍用于 diff 审阅与按需手编（fork 优势），但非默认主区。弃"底部面板 + 编辑器主区"布局。按需文件 / diff 视图以**右侧分屏**呈现，AI 对话保持左侧主区，不切换标签页。分屏分隔条**可拖拽**调整宽度；diff 默认以**只读**形式呈现，提供"切换到编辑"入口供手动手编。
5. **会话连续性** = 单一面板即 DSH session。
6. **模型 / 多模型配置** = DSH 原生多模型，默认开源 / 自托管（DeepSeek / Ollama / vLLM 等 OpenAI 兼容端点），不绑定商业 SaaS。IDE 侧用两个入口承接：① **Settings → Models** 维护模型清单（名称 / 类型 / base URL / 模型 ID / Key，Key 存系统钥匙串，可设默认）；② **对话头部模型选择器** 即时切换当前 session / 任务模型，不离开对话。需先确认 DSH 的模型配置存储机制（配置文件 / apiproxy 方法、字段 schema），再让 UI 写入正确格式。
7. **分发** = 独立桌面 App（Mac/Win/Linux 安装包），自行命名 / 图标，剥离 MS 服务与商标，MIT 合规。
8. **先验证后自建（历史决策，已转向）**：曾评估社区 VSCode 扩展（WentaoJIANG/HarcoChen）验证"编辑器一体"可行；现目标升级为独立产品，改为 fork 路线，社区扩展仅作参考。
9. **DSH 面板集成机制 = 内置扩展（built-in extension），而非 workbench 补丁**：在 fork 的 vscode 源码 `extensions/dsh-agent/` 下放置一个自包含扩展，通过 `patches/` 注入源码 + 注册进 `extensions/extensions.json` 的 built-in 列表；该扩展贡献 AI 优先的 Webview 视图/面板，并用已验证的 `apiproxy` 网关协议（HTTP+WebSocket）与随包 DSH 运行时通信。这样 agent 集成层与编辑器核心解耦、可独立开发测试（先作为普通 VSCode 扩展对运行中的 DSH 联调，再烤进 fork），大幅降低对 vscode workbench 内部结构的侵入与上游 rebase 冲突。Webview 内 UI（对话 + 文件树 + 右分屏 diff）用自有 HTML/JS 渲染，diff 审阅复用编辑器 Diff 命令/API；DSH 网关 client 直接移植 spike 的协议实现（`spike/probe.mjs`）。AI 优先默认布局通过一处启动布局补丁（默认聚焦 DSH 视图、不自动开编辑器）实现。VSCodium 已自带去 MS 的补丁（telemetry-disable / cloud-remove / copilot-disable / 扩展签名校验关闭），我们只需叠加品牌与 DSH 扩展。

## Risks / Trade-offs

- [DSH 程序化 API 未知] → **已解除（spike 端到端跑通）**：`dsh web` 暴露 `apiproxy` 网关，unary = `POST /api/<ns>.<method>`（信封 `{type:'client-request',rpcId,method,payload}`，响应 `{result:{ok,value|error}}`），事件下行 = WebSocket `ws://host/api/events.mux`（帧 `payload.type` ∈ `session/subscribed`/`session/event`/`session/projection`/`session/queue`/`agent/*`），审批回传 = `POST /api/respond`；`GET /api/events.mux` 有 SSE 兜底。`headless` CLI 仅一次性。参考实现：`dsh-vscode-ide/spike/probe.mjs`。
- [DSH 自带鉴权网关] → **已遇并解除**：本机曾装 `dsh-password-gate`（login-plugin）插件，导致所有 `/api` 调用返回 `unauthenticated`。我们分发的 IDE 中**必须不启用该插件**（移除 `~/.dsh/profiles/web/cordis.patch.yml` 中的 `dsh-password-gate` 条目与 `~/.dsh/login-plugin` 凭据目录）。本地单人使用无需密码门；若需远程/团队协作再加。
- [DSH dev preview 兼容性会变] → 适配层 + 固定 DSH 版本。
- [直接落盘误改] → Gated 权限闸 + diff 审阅 + 可随时停止。
- [Node 版本] → DSH 要求 `^22.19 || >=24`（本机 v26.5.0 满足）；**VSCodium 构建要求 node 24.15.0**（`.nvmrc`），需用 nvm 对齐，否则 gulp/依赖可能报错。
- [fork 维护成本] → VSCodium 随 `microsoft/vscode` 固定在某一 commit（`upstream/stable.json`）构建，agent 集成层全部走 `extensions/dsh-agent` 内置扩展 + 少量布局补丁，与核心解耦以降低 rebase 冲突。
- [VSCodium 首次构建重] → 首次构建会 clone microsoft/vscode（~1GB+）+ `npm ci` + gulp 原生编译，耗时较长；先验证基线构建，再注入 DSH 扩展。
- [跨平台打包 / 签名] → Mac 需开发者证书 + 公证；Win 需代码签名；Linux 打包 deb/rpm/AppImage。
- [品牌 / 许可合规] → 不冒用 VS Code 商标，保留 MIT 与第三方声明，自行命名。

## Migration Plan

自用 → 产品；随上游 Code - OSS 与 DSH 稳定版演进；agent 集成层独立维护、与编辑器核心解耦。

## Open Questions

- DSH 权限模型映射到内联批准（✓ / ✗ / ⊘ 始终）的细节？
- 权限预设粒度：全局策略 vs 按任务临时调？
- 本地 DSH 运行时分发方式：随包内置 vs 首次下载 vs 用户自带？
- 是否提供"导入 VSCode 设置 / 扩展"的迁移路径（提升用户切换意愿）？
- **产品名 / 图标**（品牌隔离必需；当前暂用占位名，需定名）
- 随包 DSH 运行时的分发形态：内置二进制 vs 首次运行下载 vs 用户自带（影响安装包体积与离线可用）
