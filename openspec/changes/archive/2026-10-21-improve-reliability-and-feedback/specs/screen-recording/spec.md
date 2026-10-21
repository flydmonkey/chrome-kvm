## Purpose

定义录制当前采集画面并保存为本地文件的行为，包括开始前的检查、编码格式的选择、采集中断时的处理，以及防止误关页面丢失录像。

## ADDED Requirements

### Requirement: Recording starts only with a live picture
系统 SHALL 仅在存在正在采集的画面时开始录制；没有画面、浏览器不支持录制或录制器创建失败时 MUST 提示原因，并且录制按钮 MUST 保持在「开始录制」状态。

#### Scenario: Start recording without video
- **WHEN** 画面未打开或采集卡已断开时用户点击开始录制
- **THEN** 系统 MUST 提示没有画面可录，按钮 MUST NOT 切换为「停止录制」

### Requirement: Supported codec is chosen automatically
系统 SHALL 从 VP9、VP8、通用 WebM 中按顺序选择浏览器支持的第一种格式录制；都不支持时 MUST 交由浏览器使用默认格式。

#### Scenario: Browser lacks VP9
- **WHEN** 浏览器不支持 VP9 但支持 VP8
- **THEN** 录制 MUST 使用 VP8 格式

### Requirement: Interrupted recording is saved
录制过程中采集中断时，系统 SHALL 自动结束录制、下载已录下的部分，并提示录制是因采集中断而停止的；录制数据 MUST 分段收集，以保证中断前的内容不丢失。没有收到任何画面数据时 MUST 提示未生成文件而不是下载空文件。

#### Scenario: Capture card unplugged while recording
- **WHEN** 录制进行中采集卡被拔出
- **THEN** 系统 MUST 下载已录制的内容，按钮 MUST 恢复为「开始录制」
- **AND** MUST 提示采集中断导致录制自动停止

#### Scenario: Manual stop
- **WHEN** 用户点击停止录制
- **THEN** 系统 MUST 下载录像，且 MUST NOT 显示采集中断的提示

### Requirement: Leaving the page while recording asks for confirmation
录制进行中用户刷新或关闭控制页时，系统 SHALL 请求浏览器弹出离开确认，因为未结束的录像只保存在内存中。

#### Scenario: Close the tab while recording
- **WHEN** 录制进行中用户尝试关闭标签页
- **THEN** 浏览器 MUST 弹出离开确认
