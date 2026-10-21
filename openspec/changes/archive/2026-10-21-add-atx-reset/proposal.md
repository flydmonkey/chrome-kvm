## Why

死机时「强制关机再开机」要两步、十来秒。两路以上的继电器可以再接主板的 RESET 针，一步重启。

## What Changes

- `settings.atx` 增加 `resetChannel`（1–4 或 `null`），不得与电源键同一路。
- 设置页增加「复位键通道」，选项含「不接复位键」，电源键那一路禁用，冲突时退回「不接」。
- 控制页电源面板增加「按一下复位键」（500ms），仅在设置了复位通道时出现，需连点两次确认；确认状态在两个危险操作之间互斥。
- README 补充复位键接线与使用。

## Capabilities

### New Capabilities

### Modified Capabilities

- `atx-power`: 增加复位键通道与复位按压。

## Impact

- `atx-relay.js`（`normalize` 增加 `resetChannel`、新增 `channelFor`、`PRESSES.reset`）及测试。
- `settings.html`、`settings-page.js`、`index.html`、`kvm-page.js`、README。
