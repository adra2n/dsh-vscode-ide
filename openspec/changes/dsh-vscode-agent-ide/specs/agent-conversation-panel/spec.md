## ADDED Requirements

### Requirement: AI-first launch layout
产品 SHALL 以 AI 对话为主界面启动，并常驻展示项目文件树；默认不展示代码编辑区。代码编辑 / diff 视图按需打开（点击文件树或 Changed files）。

#### Scenario: Launch IDE
- **WHEN** 用户启动 IDE
- **THEN** 进入 AI 对话主页，侧栏显示项目文件树，主区为对话而非代码编辑器

### Requirement: Project file tree
产品 SHALL 常驻展示项目文件树，支持浏览、选择、打开文件（打开后在按需视图中呈现，而非默认编辑主区）。

#### Scenario: Browse project
- **WHEN** 用户在文件树中浏览并点击某文件
- **THEN** 该文件在按需视图（只读 / diff / 编辑）中打开，不强制常驻编辑主区

### Requirement: On-demand view as right split
产品 SHALL 将按需打开的文件 / diff 视图以右侧分屏呈现，AI 对话保持左侧主区，不切换标签页。

#### Scenario: Open a changed file
- **WHEN** 用户点击文件树或 Changed files 中的某文件
- **THEN** 该文件以 diff / 编辑视图在右侧分屏打开，对话主页保留在左侧

### Requirement: Resizable split
产品 SHALL 允许用户拖拽对话主区与右侧文件视图之间的分隔条来调整两侧宽度。

#### Scenario: Resize split
- **WHEN** 用户拖拽分隔条
- **THEN** 左右两侧宽度随之调整，对话与文件视图均保持可见

### Requirement: Read-only diff by default with edit toggle
产品 SHALL 默认以只读 diff 打开改动文件，并提供手动切换到编辑模式的入口。

#### Scenario: Open changed file read-only
- **WHEN** 用户打开一个被 agent 改动的文件
- **THEN** 右侧分屏以只读 diff 呈现改动

#### Scenario: Switch to edit
- **WHEN** 用户点击"切换到编辑"入口
- **THEN** 同一文件转为可手编模式，diff 对照仍可访问

### Requirement: Live conversation transcript
面板 SHALL 实时展示用户与 agent 的对话转录（含 agent 思考 / 状态 / 提问与用户回复）。

#### Scenario: Receive agent message
- **WHEN** agent 产出消息或状态
- **THEN** 转录区实时追加该内容

### Requirement: Gated permission control
当 agent 执行风险动作（运行命令、修改范围外文件）时，面板 SHALL 内联弹出许可请求（批准 / 拒绝 / 始终允许），并暂停等待。

#### Scenario: Permission requested
- **WHEN** agent 请求运行终端命令
- **THEN** 面板显示批准 / 拒绝 / 始终允许，agent 暂停直到用户响应

#### Scenario: Panel not focused
- **WHEN** 权限请求产生但面板不在焦点
- **THEN** 同时弹出提示（toast / 通知）引导用户回应

### Requirement: Interrupt and stop
用户 SHALL 能在任意时刻暂停、停止或中途插话当前 agent 运行。

#### Scenario: Stop running agent
- **WHEN** 用户点击停止
- **THEN** agent 立即中断，面板标记已停止

#### Scenario: Mid-run message
- **WHEN** 用户运行中发送消息
- **THEN** 消息注入当前 session，agent 据此调整

### Requirement: Collapsible detail views
面板 SHALL 提供可折叠的 Steps / Terminal / Changed files 视图作为转录的附属信息。

#### Scenario: Collapse terminal
- **WHEN** 用户折叠 Terminal 视图
- **THEN** 转录区获得更多空间，终端内容隐藏
