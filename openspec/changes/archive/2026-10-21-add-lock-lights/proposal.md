## Why

本机键盘的锁定灯不反映被控端状态，用户只能盲猜 Caps Lock、Num Lock 是否亮着，经常打出全大写或小键盘无效。CH9329 能回报被控端的指示灯，但此前只在悬停键鼠状态时才看得到。

## What Changes

- 工具栏在键鼠状态下方常驻三个小灯：Num Lock、Caps Lock、Scroll Lock，亮为绿色。
- 控制页每 2 秒向芯片查询一次（页面隐藏、串口断开、芯片降级为只发不等时跳过），按下锁定键松开后立即补查。
- 点击小灯即在被控端按一次对应锁定键并刷新状态。
- USB 未被被控端枚举时隐藏小灯。

## Capabilities

### New Capabilities

- `lock-lights`: 被控端键盘指示灯的显示、刷新与点击切换。

### Modified Capabilities

## Impact

- `status-text.js`：新增 `LOCK_LIGHTS`、`lockLights(info)`。
- `kvm-page.js`：`renderLockLights`、`pollLockLights`、`toggleLock` 与轮询、可见性、keyup 监听。
- `index.html`：`#lockLights` 容器与样式。
- README 工具栏表与说明。
