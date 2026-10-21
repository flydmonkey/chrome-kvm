## Purpose

定义控制页如何打开与维持采集卡画面：分辨率与帧率的请求方式、打开失败时的提示、采集卡拔插后的自动恢复，以及尚未选择采集卡时的表现。

## ADDED Requirements

### Requirement: Resolution and frame rate are requested as preferences
系统 SHALL 按设置中的分辨率与帧率向浏览器请求画面，并把它们作为偏好而非硬性条件；设备不支持时 MUST 逐步放宽条件直到只指定设备本身，而不是直接失败。帧率设置为「默认」时 MUST NOT 指定帧率；未设置分辨率时 MUST 以 1920×1080 为默认偏好。

#### Scenario: Capture card lacks 60fps at the chosen resolution
- **WHEN** 用户选择 1920×1080 和 60fps，而采集卡在该分辨率下最高只有 30fps
- **THEN** 系统 MUST 仍然打开画面，并优先保住分辨率

#### Scenario: Requested resolution not supported
- **WHEN** 采集卡不支持设置中的分辨率
- **THEN** 系统 MUST 放宽条件重新请求，最终至少以设备默认参数打开画面

### Requirement: Video recovers automatically after the capture card is replugged
采集卡被拔出或画面轨道结束时，系统 SHALL 显示一条不会自动消失的警告，说明插回后会自动恢复；当同一采集卡重新出现时 MUST 自动重新打开画面并提示已恢复。其它设备的插拔 MUST NOT 触发重新打开。

#### Scenario: Unplug and replug the capture card
- **WHEN** 用户拔出采集卡后重新插入
- **THEN** 控制页 MUST 在设备列表稳定后自动重新打开画面，无需刷新页面
- **AND** MUST 显示「采集卡已恢复」的提示并取代之前的断开警告

#### Scenario: Unrelated device plugged in
- **WHEN** 采集卡仍未插回，用户插入了一个无关的 USB 设备
- **THEN** 系统 MUST NOT 尝试打开画面，也 MUST NOT 产生新的错误提示

#### Scenario: Manual retry
- **WHEN** 画面处于断开或打开失败状态，用户点击视频状态
- **THEN** 系统 MUST 立即尝试重新打开画面

### Requirement: Missing video selection does not block keyboard and mouse
当设置中没有选择视频采集卡时，系统 SHALL 不尝试打开画面，显示一条带「去设置」入口的提示，并且 MUST 照常连接键鼠。

#### Scenario: Only the serial port is configured
- **WHEN** 用户只选择了串口而没有选择采集卡，然后打开控制页
- **THEN** 控制页 MUST 提示尚未选择视频采集卡并提供跳转到设置页的入口
- **AND** 键鼠 MUST 正常连接可用

### Requirement: Video open errors are explained
打开画面失败时，系统 SHALL 给出可操作的说明；当失败原因是设置中选择的采集卡不存在时，MUST 说明可能没插好或换了 USB 口，并告知插好后会自动打开，否则需要到设置页重新选择。

#### Scenario: Selected capture card not present
- **WHEN** 设置中的采集卡当前没有插入
- **THEN** 提示 MUST 说明找不到所选采集卡及恢复方式，而不是显示浏览器原始的约束错误

### Requirement: Video settings apply without reload
用户在设置页修改并保存视频设备、分辨率、帧率或音频选项后，已打开的控制页 SHALL 自动按新参数重新打开画面；若此时上一次打开尚未完成，MUST 在其完成后丢弃旧结果并按最新参数重开。

#### Scenario: Change resolution while video is opening
- **WHEN** 控制页正在打开画面时用户保存了新的分辨率
- **THEN** 最终显示的画面 MUST 按新分辨率打开，且同一时间 MUST 只有一路在占用采集卡
