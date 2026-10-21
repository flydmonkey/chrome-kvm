# profiles Specification

## Purpose
定义被控机配置：把每台被控机对应的设置存成命名配置并快速切换，适用于一套 KVM 轮流接多台机器或同时接了多套设备的场景。

## Requirements

### Requirement: Profile contents
一份配置 SHALL 只保存跟着被控机走的设置：视频设备、音频设备、串口设备、屏幕分辨率、采集帧率、鼠标模式、相对模式灵敏度。串口波特率与芯片工作模式记录的是 CH9329 芯片自身的状态，MUST NOT 存入配置，切换配置时 MUST 保持当前值。配置名 MUST 去掉首尾空白，最长 20 个字符，不可为空；最多保存 20 份。

#### Scenario: Switching keeps the chip state
- **WHEN** 当前波特率为 115200，用户切换到一份在 9600 时保存的配置
- **THEN** 切换后的波特率 MUST 仍为 115200

### Requirement: Save, switch and delete in the settings page
设置页 SHALL 支持把当前表单另存为命名配置（同名覆盖），另存后它成为当前配置，表单内容同时保存为当前设置。从下拉框选中一份配置 MUST 把它写成当前设置并刷新表单。选中某份配置时点保存 MUST 同时更新这份配置。删除配置 MUST NOT 改动当前设置。

#### Scenario: Edit the active profile
- **WHEN** 当前配置为「服务器」，用户把分辨率改成 1280×1024 后点保存
- **THEN** 之后再切换到「服务器」时，分辨率 MUST 为 1280×1024

### Requirement: Quick switch in the control page
存有两份以上配置时，控制页工具栏 SHALL 显示切换按钮，面板中列出各配置及摘要（分辨率、鼠标模式、视频设备）并标出当前配置。选中另一份配置后，系统 MUST 立即按新设置重开采集卡与键鼠，无需刷新页面，并提示已切换。只有一份或没有配置时 MUST NOT 显示切换按钮。

#### Scenario: Switch to another machine from the toolbar
- **WHEN** 用户在控制页的切换面板中选中另一份采集卡和串口都不同的配置
- **THEN** 系统 MUST 用新的采集卡重开视频、用新的串口重连键鼠，并提示已切换到该配置

#### Scenario: Profiles changed in another tab
- **WHEN** 用户在设置页新增或删除了配置
- **THEN** 已打开的控制页 MUST 自动更新切换按钮与面板
