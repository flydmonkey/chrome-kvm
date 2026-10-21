# atx-power Specification

## Purpose
TBD - created by archiving change add-atx-power. Update Purpose after archive.

## Requirements

### Requirement: 继电器配置

设置页 SHALL 提供继电器串口（含「不使用」）与通道（1–4）选择，保存为 `settings.atx = {deviceId, label, channel}`；选「不使用」时 MUST 存为 `null`。通道不在 1–4 内 SHALL 按 1 处理。

#### Scenario: 选中继电器并保存

- **WHEN** 用户在「ATX 电源」中选中一个已授权串口和第 2 路并保存
- **THEN** 设置中 `atx.channel` 为 2，`atx.deviceId` 为该串口的 VID/PID

#### Scenario: 不使用继电器

- **WHEN** 继电器串口选「不使用」并保存
- **THEN** `settings.atx` 为 `null`，控制页不显示电源按钮

### Requirement: 挑选继电器串口

控制页 SHALL 在已授权串口中按 `atx.deviceId` 的 VID/PID 匹配，并排除键鼠正在使用的串口，逐个尝试以 9600 波特打开。恰好一个能打开时 SHALL 使用它；一个都没有匹配或都打不开时 MUST 报错；多于一个能打开时 MUST 全部关闭并报错，不得发送任何指令。

#### Scenario: 与 CH9329 同型号

- **WHEN** CH9329 与继电器都是 CH340（VID/PID 相同），且键鼠已连接
- **THEN** 继电器串口为未被键鼠占用的那个

#### Scenario: 无法区分

- **WHEN** 键鼠未连接且有两个同型号串口都能打开
- **THEN** 两个串口都被关闭，提示分不清哪个是继电器

### Requirement: 按电源键

按压 SHALL 发送 LCUS 吸合指令 `A0 通道 01 校验`，等待指定时长后发送断开指令 `A0 通道 00 校验`（校验为前三字节和的低 8 位），然后关闭串口。断开指令 MUST 在吸合失败或等待被取消时同样发送。短按 SHALL 为 500ms，长按 SHALL 为 6000ms；长按 MUST 连点两次（4 秒内）才执行，执行中提示条 SHALL 提供「松开」以提前断开。按压进行中 MUST 禁用两个按钮。

#### Scenario: 短按

- **WHEN** 用户点「按一下电源键」，继电器为第 1 路
- **THEN** 依次写入 `A0 01 01 A2`、约 500ms 后写入 `A0 01 00 A1`，提示「已按一下电源键」

#### Scenario: 长按需确认并可提前松开

- **WHEN** 用户点一次「长按强制关机」
- **THEN** 不发送任何指令，提示文字变为「再点一次确认强制关机」
- **WHEN** 4 秒内再点一次，并在提示条点「松开」
- **THEN** 立即写入断开指令，提示「已提前松开电源键」

### Requirement: 继电器跟随被控机配置

被控机配置 SHALL 保存 `atx` 字段。切换到不含 `atx` 字段的配置时，当前设置的 `atx` MUST 置为 `null`，不得沿用上一台的继电器。

#### Scenario: 切到旧配置

- **WHEN** 当前设置有继电器，切换到功能上线前保存、没有 `atx` 的配置
- **THEN** 切换后 `settings.atx` 为 `null`，电源按钮隐藏
