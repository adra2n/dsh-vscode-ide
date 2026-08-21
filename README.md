# Codon AI IDE

基于 VSCodium (Code - OSS) fork 的 AI-first 桌面 IDE，内置 DeepSeek Harness (DSH) agent 面板。不依赖第三方 AI 产品，可独立分发。

## 项目结构

```
dsh-vscode-ide/
├── dsh-agent-extension/    # VS Code 内置扩展（AI 对话面板）
│   ├── src/
│   │   ├── extension.ts    # 扩展入口，注册 WebviewView + 命令
│   │   └── dshClient.ts    # DSH 网关客户端（HTTP RPC + WebSocket 事件流）
│   ├── webview/
│   │   └── main.js         # 面板前端 UI（vanilla JS）
│   └── media/
│       └── ai.svg          # 活动栏图标
├── design/                 # UI 设计稿
├── spike/                  # DSH 接口调研脚本
├── openspec/               # 产品规格与任务跟踪
└── vscodium-fork/          # VSCodium 底座 fork（独立仓库，不在本目录）
```

## 核心功能

- **AI 对话面板** — 右侧二级侧栏，流式输出 + Markdown 渲染
- **会话管理** — 新建 / 切换 / 恢复历史会话，侧栏搜索
- **模型选择** — 多 provider 支持，reasoning effort 调节
- **工具审批** — agent 执行敏感操作时内联卡片授权（允许一次 / 始终允许 / 拒绝）
- **思考过程** — 可折叠的 reasoning 展示
- **上下文压力** — 实时 token 用量指示（绿/黄/红三级）
- **文件操作** — 右分屏只读打开，可切换编辑模式

## 前置条件

- [Node.js](https://nodejs.org/) >= 20（仅开发编译需要；分发版内置 DSH 运行时，用户零依赖）
- 网关由扩展**自动拉起**：面板初始化时探测 `127.0.0.1:3080`，未运行则自动启动 `dsh web`

### 内置 DSH 运行时（零依赖分发）

打包后运行 vendor 脚本，把 `@deepseek-ai/dsh` 装进应用：

```bash
scripts/vendor-dsh.sh /path/to/Codon.app/Contents/Resources/app
# 可选：DSH_VERSION=x.y.z 覆盖版本（默认固定为已验证版本）
```

产物位于 `app/dsh-runtime/`。扩展探测到后用 Codon 自身二进制的 Node 模式
（`ELECTRON_RUN_AS_NODE=1`）拉起网关，无需用户安装 node/npm/dsh。

启动命令优先级：设置 `gatewayCommand` > 内置运行时 > PATH 上的 `dsh` > npx 缓存 > `npm exec`。

## 开发

```bash
# 安装依赖
cd dsh-agent-extension && npm install

# 编译
npm run compile

# 监听模式
npm run watch
```

### 启动扩展开发宿主

在 VS Code 中按 `F5`，或命令行：

```bash
code --extensionDevelopmentPath=dsh-agent-extension .
```

### 配置

扩展设置（VS Code Settings）：

| 键 | 默认值 | 说明 |
|---|---|---|
| `dshAgent.gatewayBase` | `http://127.0.0.1:3080` | DSH apiproxy 网关地址 |
| `dshAgent.gatewayCommand` | `""` | 网关启动命令（留空自动探测/内置） |
| `dshAgent.autoAllowTools` | `[]` | 自动放行的工具名列表 |

## 架构

```
┌─────────────────────────────────────────┐
│  VS Code / Codon IDE                    │
│  ┌───────────────────────────────────┐  │
│  │ dsh-agent-extension               │  │
│  │  extension.ts  ←→ webview/main.js │  │
│  │       ↕                           │  │
│  │  dshClient.ts                     │  │
│  └──────────┬────────────────────────┘  │
└─────────────┼───────────────────────────┘
              │ HTTP POST + WebSocket
              ▼
     ┌─────────────────┐
     │  DSH apiproxy   │
     │  (:3080)        │
     └─────────────────┘
```

- **extension.ts** — 注册 WebviewView provider，处理 webview 消息（会话管理、模型切换、工具审批、文件操作）
- **dshClient.ts** — 封装 DSH 网关 RPC 调用 + WebSocket 事件流，支持自动重连（指数退避）、按 session 过滤帧
- **webview/main.js** — 纯 vanilla JS 渲染层，处理流式 chunk、Markdown 渲染、会话列表、审批卡片

## 路线图

- [ ] 本地 DSH 运行时分发（内置 / 首次下载 / 用户自带）
- [ ] 设置面板（模型默认配置、权限预设）
- [ ] 改动文件清单 + inline diff 审阅
- [ ] 上下文注入（文件 / 选区 / 诊断 / git diff / 终端）
- [ ] 跨平台构建流水线（Mac / Win / Linux）
- [ ] 签名与公证

## License

MIT
