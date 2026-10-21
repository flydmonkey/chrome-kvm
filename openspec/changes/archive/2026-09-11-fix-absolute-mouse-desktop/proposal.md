## Why

桌面使用场景下，绝对鼠标路径存在松键粘滞、模式语义颠倒、坐标换算偏差，导致点击不准、拖拽放不开、双击异常。当前痛点集中在日常桌面操作，应优先修复绝对模式主路径。

## What Changes

- 修正绝对鼠标松左键报文：释放按键位必须为 `0x00`，消除粘滞
- 对齐设置页「绝对/相对」文案与 `mouseAbsolute` 构造语义，默认桌面走绝对模式
- 修正视口到 CH9329 绝对坐标（0..4095）的换算：考虑 video 元素位置与可能的黑边
- 绝对模式下 move / click / up / scroll 统一走 `CMD_SEND_MS_ABS_DATA`（0x04）闭环
- **不包含**：相对鼠标（0x05）完整重做、BIOS 专项适配、粘贴/分辨率/串口等其它痛点

## Capabilities

### New Capabilities

- `absolute-mouse`: 桌面绝对鼠标定位、按键按下/释放、滚轮与设置语义的行为要求

### Modified Capabilities

- （无；仓库尚无既有 specs）

## Impact

- `ch9329.js`：绝对鼠标包构造、松键逻辑、坐标换算
- `index.html`：`Ch9329` 构造参数、鼠标事件坐标来源
- `settings.html`：鼠标模式选项文案与默认值
- 依赖既有 Web Serial + CH9329 协议传输模式；不新增硬件/依赖
