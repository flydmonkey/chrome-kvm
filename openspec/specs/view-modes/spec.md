# view-modes Specification

## Purpose
定义控制页画面的显示方式：缩放规则、画面大于窗口时的平移规则，以及在任何显示方式下本机指针与被控端指针保持一致，让用户既能看全局，也能看清小字。

## Requirements

### Requirement: View mode options
系统 SHALL 提供以下显示方式，默认为适应窗口：适应窗口（等比缩放、完整显示）、拉伸填满（铺满窗口，允许变形）、原始像素 1:1（一个画面像素对应一个屏幕物理像素）、放大 150% / 200% / 300%（在适应窗口的基础上放大）。所选方式 MUST 保存在本机浏览器中，刷新后保持，并 MUST 同步到同一浏览器中打开的其他控制页。

#### Scenario: 1:1 on a high-DPI screen
- **WHEN** 采集画面为 1920×1080，本机设备像素比为 2，用户选择原始像素 1:1
- **THEN** 画面 MUST 以 960×540 个 CSS 像素显示

#### Scenario: Unknown video size
- **WHEN** 还没有收到画面元数据（尺寸未知）
- **THEN** 1:1 和放大方式 MUST 按适应窗口显示，收到尺寸后再按所选方式重新布局

### Requirement: Oversized picture follows the pointer
画面在某个方向上大于窗口时，系统 SHALL 按指针在窗口中的相对位置平移画面：指针位于窗口某一位置时，显示画面上同一相对位置的部分。画面小于窗口的方向 MUST 居中。指针锁定期间 MUST NOT 平移。

#### Scenario: Pointer at the bottom-right corner while zoomed
- **WHEN** 放大 200% 后画面比窗口大，指针移到窗口右下角
- **THEN** 系统 MUST 显示画面的右下角部分

### Requirement: Pointer stays aligned with the target
在任何显示方式下，绝对模式发给被控端的坐标 MUST 对应本机指针下方的画面位置，用户点哪里被控端就点哪里。

#### Scenario: Click while zoomed and panned
- **WHEN** 放大 200% 并已平移，用户点击画面上某个按钮
- **THEN** 被控端收到的点击坐标 MUST 落在同一个按钮上
