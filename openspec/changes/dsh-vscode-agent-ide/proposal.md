## Why

想要一个**自己拥有、可独立分发**的智能开发 IDE，不再依赖 Cursor / Qoder / Copilot 等大厂的 AI agent 产品。编辑器底座采用 MIT 开源的 Code - OSS（fork 后即拥有全部源码、可再分发，不视为绑定大厂）；agent 大脑用开源的 DeepSeek Harness（DSH）；模型可指向自托管端点——从而在 agent 与模型两层都摆脱大厂绑定。目标用户从"自用"升级为"可发给他人使用"。

## What Changes

- 以 `microsoft/vscode`（Code - OSS, MIT）为底座 fork，构建**独立桌面 IDE**（不再是 VSCode 扩展）。
- 将 DSH 作为 agent 大脑**原生嵌入编辑器**：聊天改码 + 自主 agent 循环；因 fork 拥有内核，可做内核级 inline diff、命令面板深度集成（比扩展更强）。
- 打包为 **Mac / Win / Linux 独立安装包**，用户直接安装，无需先装 VSCode。
- 模型默认走开源 / 自托管（DeepSeek 或 Ollama / vLLM 等 OpenAI 兼容端点），不绑定商业 AI SaaS。
- 遵守 MIT 合规与品牌隔离：不冒用 "Visual Studio Code" 商标，自行命名 / 改图标 / 剥离 MS 服务。
- DSH 直接落盘改码，编辑器反射并提供 diff 审阅；Gated 掌控（权限闸 / 停止 / 插话）。

## Capabilities

### New Capabilities

- `dsh-integration`: 与 DSH 运行时连接、会话、模型/配置，以及本地运行时分发。
- `agent-conversation-panel`: 编辑器内原生 agent 面板（对话转录 + Gated 掌控 + 可折叠 Steps/Terminal/Changed files）+ 内核级 inline diff。
- `change-review`: DSH 改码反射与 diff 审阅。
- `distribution-packaging`: 跨平台构建与打包（Mac/Win/Linux 安装包、签名/公证、MIT 合规与品牌隔离）。

### Modified Capabilities

（无——全新项目）

## Impact

- 新仓库：Code - OSS fork + 我们的 agent 集成层 + 本地 DSH 运行时。
- 依赖：Node（VSCode 构建要求）、Electron、DSH（本地运行时）、构建/打包工具链（gulp / electron 打包）。
- 需维护与上游 Code - OSS 的同步（fork 维护成本，高于扩展）。
- 不再依赖大厂 AI agent SaaS；模型可自托管；无 MS 账号/遥测（Code - OSS 已剥离）。
