# text-paste Specification

## Purpose
定义把本机剪贴板文本逐字符敲到被控端的行为，包括同一时间只能有一次粘贴、进度与取消、与用户键盘输入的隔离，以及完成后的结果说明。

## Requirements

### Requirement: Only one paste runs at a time and it can be cancelled
系统 SHALL 同一时间只进行一次粘贴；粘贴进行中再次触发粘贴 MUST 视为取消当前粘贴，而不是开始第二段。粘贴期间 MUST 显示「已敲字符数 / 总字符数」的进度和取消按钮，取消后 MUST 在当前字符之后停止。

#### Scenario: Click paste twice
- **WHEN** 一段长文本正在粘贴，用户再次点击粘贴
- **THEN** 当前粘贴 MUST 停止，被控端 MUST NOT 收到两段交错的文字

#### Scenario: Cancel from the progress notice
- **WHEN** 用户点击进度提示上的「取消」
- **THEN** 粘贴 MUST 停止，结果提示 MUST 说明已粘贴的字符数并注明已取消

### Requirement: User keystrokes are isolated during paste
粘贴开始前系统 SHALL 先释放所有已按下的键；粘贴进行中 MUST NOT 把用户在本机的按键转发给被控端，以免与敲出的字符混在一起。

#### Scenario: User types while pasting
- **WHEN** 粘贴进行中用户在控制页按下键盘
- **THEN** 这些按键 MUST NOT 发往被控端，粘贴出的文字 MUST 保持完整

### Requirement: Paste result is summarized
粘贴结束后系统 SHALL 说明结果：已粘贴的字符数，以及因不支持（如中文）被跳过的字符数；全部成功时提示 MUST 在约 3 秒后自动消失，有跳过或取消时 MUST 保留更久以便阅读。剪贴板为空、读取失败或键鼠未连接时 MUST 给出对应提示且不开始粘贴。

#### Scenario: Text with unsupported characters
- **WHEN** 剪贴板内容为「a中文」
- **THEN** 结果 MUST 说明已粘贴 1 个字符、跳过 2 个不支持的字符

#### Scenario: Clipboard permission denied
- **WHEN** 浏览器拒绝读取剪贴板
- **THEN** 系统 MUST 提示允许剪贴板权限或确认页面处于安全上下文，且 MUST NOT 向被控端发送任何按键

### Requirement: Held keys are not repeated
用户在本机按住某个键不放时，系统 SHALL 只发送一次按下，由被控端自行处理重复，而不是把本机的自动重复事件逐个转发。

#### Scenario: Hold a letter key
- **WHEN** 用户按住字母键 1 秒后松开
- **THEN** 系统 MUST 只发送一次该键的按下和一次释放
