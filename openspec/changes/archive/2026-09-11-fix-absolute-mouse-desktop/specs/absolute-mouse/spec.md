## Purpose

定义桌面场景下绝对鼠标的定位、按键与滚轮行为，确保点选、拖拽与释放在被控机上可预期。

## ADDED Requirements

### Requirement: Absolute mouse button release clears pressed state
在绝对鼠标模式下，系统 SHALL 在鼠标按键释放时向 CH9329 发送绝对鼠标数据包，且按键位为 `0x00`（无按键按下）。

#### Scenario: Left button release after click
- **WHEN** 用户在绝对模式下按下并释放鼠标左键
- **THEN** 释放报文的按键位 MUST 为 `0x00`
- **AND** 被控机 MUST 不再保持左键按下状态

#### Scenario: Drag then release
- **WHEN** 用户在绝对模式下拖拽后松开鼠标按键
- **THEN** 系统 MUST 发送按键位为 `0x00` 的绝对鼠标释放包
- **AND** 拖拽操作 MUST 在被控机上正常结束

### Requirement: Settings mode labels match runtime behavior
设置页中「绝对模式 / 相对模式」的文案与保存值 SHALL 与运行时鼠标协议选择一致；桌面默认 SHALL 使用绝对模式。

#### Scenario: User selects absolute mode
- **WHEN** 用户在设置中选择「绝对模式」并保存
- **THEN** 运行时 MUST 以绝对鼠标协议处理移动、点击与释放

#### Scenario: Default for new or unset preference
- **WHEN** 用户首次保存设置或未明确选择鼠标模式
- **THEN** 系统 MUST 默认使用绝对模式

### Requirement: Viewport coordinates map to CH9329 absolute range
系统 SHALL 将指向视频画面的指针位置映射为 CH9329 绝对坐标范围 `0..4095`（含边界），并考虑视频元素在页面中的位置与等比缩放产生的黑边。

#### Scenario: Click near screen corner
- **WHEN** 用户在视频画面接近四角处点击
- **THEN** 映射后的绝对坐标 MUST 落在 `0..4095` 内
- **AND** 被控机光标 MUST 接近对应角落（允许硬件/缩放导致的微小偏差）

#### Scenario: Video letterboxing present
- **WHEN** 视频元素存在上下或左右黑边
- **THEN** 系统 MUST 仅将落在实际画面区域内的坐标映射到绝对坐标
- **AND** MUST NOT 将黑边区域的偏移直接当作画面坐标发送

### Requirement: Absolute mode uses absolute protocol end-to-end
在绝对鼠标模式下，移动、按键按下、按键释放与滚轮 SHALL 使用 `CMD_SEND_MS_ABS_DATA`（命令码 `0x04`）数据包，不得混用相对鼠标命令码 `0x05` 作为移动或按键主路径。

#### Scenario: Move while absolute mode enabled
- **WHEN** 绝对模式已启用且用户移动指针
- **THEN** 系统 MUST 发送命令码为 `0x04` 的绝对鼠标数据包，并携带映射后的 X/Y

#### Scenario: Scroll while absolute mode enabled
- **WHEN** 绝对模式已启用且用户滚动滚轮
- **THEN** 系统 MUST 通过绝对鼠标数据包携带滚轮字段，或在不破坏绝对按键/坐标状态的前提下完成滚轮动作
