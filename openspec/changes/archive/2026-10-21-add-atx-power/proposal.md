## Why

被控机死机或关着时，只靠键鼠无能为力，必须有人去按机箱电源键。同类 KVM 都支持 ATX 电源控制，Chrome KVM 运行在浏览器里没有 GPIO，但能通过 Web Serial 驱动廉价的 USB 串口继电器。

## What Changes

- 新增 `AtxRelay` 模块：LCUS 继电器指令、配置规整、继电器串口挑选（排除键鼠正在用的同型号串口，多个可打开时拒绝）、一次按压（吸合—等待—断开，断开放在 finally，可提前松开）。
- 设置页新增「ATX 电源（可选）」：继电器串口、通道 1–4、授权按钮；配置存为 `settings.atx`。
- 控制页工具栏新增电源按钮（设置了继电器才出现）和面板：按一下电源键（0.5 秒）、长按强制关机（6 秒，需连点两下确认，期间可从提示条「松开」）。
- 被控机配置记录 `atx`；切到没有 `atx` 的旧配置时清空继电器而不是沿用。

## Capabilities

### New Capabilities

- `atx-power`: 通过 USB 串口继电器按被控机电源键。

### Modified Capabilities

## Impact

- 新文件 `atx-relay.js`、`test/atx-relay.test.js`。
- `profiles.js`：`FIELDS` 加 `atx`，`apply` 对缺失的 `atx` 置空。
- `settings.html`、`settings-page.js`、`index.html`、`kvm-page.js`。
- README：功能表、硬件、工具栏、「ATX 电源」一节。
