## Purpose

定义设置页的设备授权与选择、视频参数选项，以及设置保存后如何同步到已经打开的控制页，让用户能看懂自己选的是哪个设备、授权失败时知道怎么办。

## ADDED Requirements

### Requirement: Serial ports show readable labels
设置页的串口列表 SHALL 为每个端口显示可读名称：已知芯片厂商（WCH、FTDI、Silicon Labs、Prolific）显示芯片名，并 MUST 附带四位十六进制的 `VID:PID`；未知厂商显示「未知串口」加 `VID:PID`，没有 USB 信息的端口显示「串口（无 USB 信息）」。

#### Scenario: CH340 port
- **WHEN** 已授权端口的 VID 为 `0x1A86`、PID 为 `0x7523`
- **THEN** 列表 MUST 显示「WCH CH340（1A86:7523）」

#### Scenario: Port without USB information
- **WHEN** 端口没有 USB 厂商和产品信息
- **THEN** 列表 MUST 显示「串口（无 USB 信息）」

### Requirement: Authorization failures are explained
设置页 SHALL 区分授权失败的原因并给出可操作的提示：用户在选择框中主动取消时 MUST 静默；摄像头/麦克风权限被拒绝、找不到采集设备、采集卡被占用时 MUST 分别说明处理办法。麦克风不可用而视频可用时 MUST 退回到仅授权视频。

#### Scenario: User cancels the serial port picker
- **WHEN** 用户打开串口选择框后点击取消
- **THEN** 设置页 MUST NOT 显示任何错误

#### Scenario: Capture card in use
- **WHEN** 授权视频时采集卡正被控制页或其它程序占用
- **THEN** 提示 MUST 说明采集卡被占用，并建议关闭占用它的程序或标签页后重试

### Requirement: Video options include common resolutions and frame rate
设置页 SHALL 提供按大小排序的常见分辨率（默认 1920×1080）和采集帧率选项（默认 / 30 / 60）；保存的帧率不在可选范围内时 MUST 按「默认」处理。

#### Scenario: Choose 60fps
- **WHEN** 用户选择 60fps 并保存
- **THEN** 控制页 MUST 以 60fps 作为偏好请求画面

#### Scenario: Invalid stored frame rate
- **WHEN** 已保存的帧率为 45
- **THEN** 系统 MUST 将其视为「默认」，不指定帧率

### Requirement: Saved settings propagate to open control pages
在设置页保存后，已打开的控制页 SHALL 自动应用变化，无需刷新：灵敏度变化立即生效，视频相关变化重新打开画面，串口设备或鼠标模式变化重新连接键鼠；仅波特率或芯片工作模式变化 MUST NOT 引起重连。应用后 MUST 显示约 3 秒的提示，列出更新了哪些方面。

#### Scenario: Change only the video device
- **WHEN** 用户只更换了视频采集卡并保存
- **THEN** 控制页 MUST 重新打开画面并提示「设置已更新：视频」
- **AND** 键鼠连接 MUST 保持不变
