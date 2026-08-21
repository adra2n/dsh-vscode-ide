## ADDED Requirements

### Requirement: Connect to DSH runtime
扩展 SHALL 启动或连接本地 DSH 运行时，并建立稳定的通信通道用于收发对话 / 任务 / 事件。

#### Scenario: Local DSH available
- **WHEN** 扩展激活且本地 DSH 可用
- **THEN** 扩展建立连接并在状态栏显示"DSH 已连"

#### Scenario: DSH unavailable
- **WHEN** 扩展激活但 DSH 未运行或不可达
- **THEN** 扩展提示用户启动 DSH，状态栏显示未连接，对话面板禁用发送

### Requirement: Manage agent session
扩展 SHALL 维护与 DSH 的单一对话 session，用户在面板内的所有消息属于同一连续上下文。

#### Scenario: Continuous context
- **WHEN** 用户先聊天改码再派发长跑任务
- **THEN** 两阶段共享同一 session 历史，不丢上下文

### Requirement: Manage multiple model profiles
产品 SHALL 提供模型设置（Settings → Models），让用户维护一组模型配置（名称、类型/provider、base URL、模型 ID、API Key），API Key 存于系统钥匙串，并可指定默认模型。底层对应 DSH 的多模型能力。

#### Scenario: Add a self-hosted model
- **WHEN** 用户添加 OpenAI 兼容端点（base URL + 模型 ID + Key）
- **THEN** 该模型出现在可选模型列表并被持久化（Key 不落明文）

#### Scenario: Set default
- **WHEN** 用户将某模型设为默认
- **THEN** 新会话默认使用该模型

### Requirement: Switch model in conversation
产品 SHALL 在对话头部提供模型选择器，用户可在不离开对话的情况下切换当前 session / 任务使用的模型。

#### Scenario: Switch mid-session
- **WHEN** 用户在下拉中选择另一模型
- **THEN** 后续 agent 交互改用该模型，对话上下文保持

### Requirement: Configurable connection
产品 SHALL 暴露 DSH 路径 / 启动方式与权限预设（与模型配置分离）。

#### Scenario: DSH unreachable
- **WHEN** 用户在设置中改 DSH 路径后重连
- **THEN** 状态栏刷新连接状态，对话面板随之启用/禁用

### Requirement: Discover DSH programmatic interface
扩展 SHALL 在开发前确认 DSH 是否暴露程序化 chat / 权限 / 步骤流 API（client↔server 协议）。

#### Scenario: API exists
- **WHEN** 调研确认 DSH 有程序化接口
- **THEN** 扩展直连该接口实现原生面板

#### Scenario: Only web UI
- **WHEN** 调研确认 DSH 仅有网页 UI
- **THEN** 扩展采用逆向网页协议或 headless CLI 解析作为降级方案
