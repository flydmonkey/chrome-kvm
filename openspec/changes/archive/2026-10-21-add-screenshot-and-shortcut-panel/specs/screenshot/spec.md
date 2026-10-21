## Purpose

定义从控制页截取当前采集画面的行为：截图的分辨率、保存方式、复制到剪贴板，以及没有画面时的处理，方便用户快速留存和分享被控端的屏幕。

## ADDED Requirements

### Requirement: Screenshot captures the native video resolution
用户点击截图时，系统 SHALL 按采集画面的原始分辨率生成 PNG 图片并下载，而不是按页面上缩放后的显示尺寸；文件名 MUST 使用本地时间，格式为 `yyyymmdd-hhmmss.png`。

#### Scenario: Screenshot of a 1920×1080 picture shown in a small window
- **WHEN** 采集画面为 1920×1080，控制页窗口较小，用户点击截图
- **THEN** 下载的 PNG MUST 为 1920×1080
- **AND** 提示 MUST 说明截图已保存并给出分辨率

### Requirement: Screenshot is copied to the clipboard when possible
截图保存后，系统 SHALL 尝试把同一张图片复制到剪贴板；浏览器不支持或拒绝时 MUST 静默放弃复制，文件下载不受影响，提示中 MUST 只在复制成功时说明已复制。

#### Scenario: Clipboard write rejected
- **WHEN** 浏览器拒绝写入剪贴板
- **THEN** 截图文件 MUST 照常下载，且 MUST NOT 显示错误提示

### Requirement: Screenshot requires a live picture
没有正在采集的画面（未选择采集卡、采集中断或打开失败）时，系统 SHALL 提示没有画面可截，且 MUST NOT 下载文件。

#### Scenario: Click screenshot with the capture card unplugged
- **WHEN** 采集卡已断开时用户点击截图
- **THEN** 系统 MUST 提示没有画面可截，不生成任何文件
