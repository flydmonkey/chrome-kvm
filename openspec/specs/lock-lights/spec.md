# lock-lights Specification

## Purpose
TBD - created by archiving change add-lock-lights. Update Purpose after archive.

## Requirements

### Requirement: 显示被控端键盘指示灯

控制页 SHALL 在工具栏键鼠状态旁按 Num Lock、Caps Lock、Scroll Lock 顺序显示三个指示灯，亮着的灯 MUST 以 `aria-pressed="true"` 和高亮样式呈现，提示文字 MUST 写明灯名、开关状态和「点击切换」。芯片未回报信息或 USB 未被被控端枚举时 SHALL 隐藏指示灯。

#### Scenario: 芯片回报 Num Lock 亮

- **WHEN** `getInfo()` 返回 `usbConnected: true, numLock: true, capsLock: false, scrollLock: false`
- **THEN** 三个指示灯显示，只有 Num Lock 处于按下（亮）状态，提示为「Num Lock 开，点击切换」

#### Scenario: USB 未枚举

- **WHEN** 芯片回报 `usbConnected: false`
- **THEN** 指示灯容器隐藏

### Requirement: 定时与即时刷新

控制页 SHALL 每 2 秒查询一次芯片信息并更新指示灯；页面隐藏、无串口、串口已断开、芯片已降级为只发不等或上一次查询未结束时 MUST 跳过本次查询。页面重新可见时 SHALL 立即查询；在非输入框中松开 NumLock、CapsLock 或 ScrollLock 后 SHALL 在约 150ms 后补查一次。

#### Scenario: 本机按下 Caps Lock

- **WHEN** 用户在控制页按下并松开 CapsLock
- **THEN** 约 150ms 后查询芯片，指示灯反映被控端的新状态

#### Scenario: 芯片降级

- **WHEN** `ch.isAckEnabled()` 为假
- **THEN** 不发送查询，指示灯保持最后一次状态

### Requirement: 点击切换锁定键

点击指示灯 SHALL 通过 `tapCombo` 向被控端发送一次对应锁定键并随后补查状态；粘贴进行中或开机连按进行中 MUST 忽略点击。

#### Scenario: 点击 Caps Lock 灯

- **WHEN** 用户点击 Caps Lock 指示灯
- **THEN** 被控端收到一次 CapsLock 按下松开，指示灯随后更新为新状态
