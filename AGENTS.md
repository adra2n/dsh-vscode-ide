# AGENTS.md — Zao AI IDE

基于 VSCodium fork 的独立 AI IDE。扩展源码在本仓库 `dsh-agent-extension/`；编辑器底座构建在**独立仓库** `~/Desktop/project/vscodium-fork`（不在本仓库内）。

## 命令速查

```bash
cd dsh-agent-extension
npm run compile && npm test && npm run lint   # 改完必跑三件套
code --extensionDevelopmentPath=dsh-agent-extension .   # F5 开发调试
```

- 底座出包：`~/Desktop/project/vscodium-fork/build_zao.sh`（需 nvm node 24.15.0，全量约 45min）
- 扩展注入已构建 app：`scripts/inject.sh <app>`；DSH 运行时入包：`scripts/vendor-dsh.sh <app>/Contents/Resources/app`
- 品牌图标再生成：`python3 scripts/gen-brand-icons.py`

## DSH apiproxy 协议事实（真机验证过，勿凭直觉改）

网关 = `dsh web` 的 :3080。unary = `POST /api/<ns>.<method>`（信封 `{type:'client-request',rpcId,method,payload}`，响应 `result.ok/value|error`）；事件 = WS `/api/events.mux`（帧 `payload.type`，`session/event` 内嵌 `event.type`）；审批/提问回传 = `POST /api/respond`。

| 事项 | 事实 |
|---|---|
| 停止 turn | **`session.cancel`**（`session.stop` 不存在，返回纯文本 not found） |
| 会话改名 | `session.rename {sessionId,title}`，广播 `session/title` |
| 未知名 RPC | 返回**非 JSON 纯文本 "not found"**，client 解析会抛 SyntaxError |
| 写配置 | `settings.mutate {ns, ops:[{op:'set'|'unset', path:[段...], value}]}`；读 = `settings.describe {}`（返回全部 ns，客户端过滤） |
| 存密钥 | `credentials.set {ref,value}`，ref 必须匹配 `^[A-Za-z_][A-Za-z0-9_]*$`；配置文件只存 ref 名不存明文 |
| 自定义 provider | ns=`llm-pi-ai`，path `providers.<id>`；**provider 级必填 `api`**（wire protocol：openai-completions / openai-responses / anthropic-messages），`baseURL`+`apiKeyEnv`+`models`+正整数 contextWindow/maxTokens |
| 权限预设 | **无专用 RPC**；官方 UI 也是 `settings.mutate` 写 ns=`permission` 的 `defaultPreset`（仅对新会话生效）；枚举 read-only / workspace-write / danger-full-access，选项可从会话投影 `permissions.options` 读 |
| 斜杠命令 | `/permission` 等文本经 `session.prompt` 会**直接发给 LLM**，不是命令通道 |

## 红线 / 踩坑警示

- **Electron 内嵌 node 拉起网关必须加 `--expose-internals`**（cordis-plugin-hmr 硬依赖；系统 node 默认开启所以本地复现不出来）。见 `gateway.ts resolveCommand`。
- **分发版绝不能启用 `dsh-password-gate`** 插件：所有 /api 返回 unauthenticated，面板全挂。vendor-dsh.sh 有防护；扩展侧会把 unauthenticated 翻译成修复指引。
- vscode 打包会**丢弃未注册进编译清单的扩展的 `out/`**——build_zao.sh 末尾有补偿拷贝步骤，勿删。
- DSH 是 dev preview，协议可能漂移：改协议前先用 `spike/probe.mjs` 风格脚本对活网关验证，勿信训练数据记忆。协议测试用录制语义的 FakeWebSocket（见 `src/__tests__/dshClient.test.ts`）。
- webview 与扩展的消息 kind 已类型化于 `src/messages.ts`——加消息先改类型，两侧 switch 编译期兜底。
- webview HTML/CSS 在 `src/webviewPage.ts`（TS 模板字符串），不是独立 html 文件。

## 架构指针

- 产品规格与任务跟踪：`openspec/changes/dsh-vscode-agent-ide/`（tasks.md 是唯一进度真源）
- DSH 接口调研脚本：`spike/`（probe.mjs 可独立验证网关）
- 设计决策（fork vs 扩展、布局、分发形态）：`openspec/.../design.md`
