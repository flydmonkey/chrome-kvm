## Why

截图是 KVM 最常用的操作之一（报错界面、BIOS 设置、给别人看现场），但控制页只能录一段视频再去截帧。组合键方面，工具栏只有 Ctrl+Alt+Del，不进全屏时 Win+L、Alt+Tab 等会被本机截走，Linux 切 TTY、开机进 BIOS 这类场景也没有趁手的办法——BIOS 热键只在自检的一两秒内有效，手动很难掐准。

## What Changes

- 工具栏新增截图按钮：按采集卡原始分辨率保存 PNG，浏览器支持时同时复制到剪贴板
- 工具栏新增快捷键面板：预置 Windows / macOS / Linux / 开机 BIOS / 其他五组快捷键，点击即发送并自动松开
- 开机那一组支持「开机连按」：按固定间隔反复按，有时长上限，可随时停止
- 支持添加、删除自定义快捷键（含多步序列），保存在本机浏览器
- 协议层按键表补上 ScrollLock 与小键盘回车

## Capabilities

### New Capabilities
- `screenshot`: 截取当前采集画面并保存、复制的行为
- `keyboard-shortcuts`: 快捷键面板：预置与自定义快捷键的发送、开机连按、组合键文本的解析规则

### Modified Capabilities

## Impact

- 代码：新增 `shortcuts.js`；`ch9329.js` 新增组合键发送并补键码；`kvm-page.js` 新增截图与面板逻辑；`status-text.js` 新增截图文件名
- 页面：`index.html` 新增两个工具栏按钮与快捷键面板
- 存储：新增本地存储项保存自定义快捷键，与原有设置分开，无需迁移
- 测试：新增 `test/shortcuts.test.js`，扩充协议与状态文案测试
