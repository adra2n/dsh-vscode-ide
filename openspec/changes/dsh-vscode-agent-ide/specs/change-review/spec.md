## ADDED Requirements

### Requirement: Reflect DSH edits live
当 DSH 直接落盘修改工作区文件时，VSCode SHALL 通过 file watcher 实时反映改动到打开的编辑器。

#### Scenario: File changed on disk
- **WHEN** DSH 修改某已打开文件
- **THEN** 编辑器显示更新内容（可选 gutter ✎ 标记刚改区域）

### Requirement: Review changes via diff
面板 SHALL 列出 agent 本次运行改动的文件，点击可在 VSCode 原生 diff 编辑器中审阅。

#### Scenario: Open changed file diff
- **WHEN** 用户点击改动清单中的文件
- **THEN** 打开该文件的 diff 视图供审阅

### Requirement: Context injection
扩展 SHALL 将当前文件、选区、诊断、git diff、终端输出作为上下文提供给 agent。

#### Scenario: Send with selection
- **WHEN** 用户带选区发送消息
- **THEN** 选区内容作为上下文随消息提交给 DSH
