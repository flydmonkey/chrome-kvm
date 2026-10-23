## Why

交换机、路由器、开发板、工控机很多只有串口 console，没有显示输出，采集卡帮不上忙；Linux 服务器开了 `console=ttyS0` 时，内核崩溃的完整日志也只在串口上。现在用 Chrome-KVM 碰到这类设备还得另开串口调试助手，README 对比表里「串口终端」一项也是 x。

这类场景大多既不需要画面也不需要 CH9329，所以终端做成一个独立的工具页：打开网页、插上 USB 转串口就能用，不依赖、也不影响控制页和设置页的任何逻辑。

## What Changes

- 新增独立页面 `terminal.html`：整页是一个串口终端，顶部一条工具栏。
- 终端用 xterm.js 渲染，放进 `vendor/xterm/`，随站点发布，不连外网也能用。
- 工具栏里选择串口（已授权的，或当场授权新串口），设置波特率、数据位、校验位、停止位、流控和回车发送的换行符，点「连接」后收发数据。
- 支持发送 Break、清屏、复制选中文字、粘贴本机剪贴板（多行需确认）、保存接收日志为文件。
- USB 转串口被拔出后标记为断开，插回后自动重连；连接中关闭或刷新页面前请求确认。
- 终端的串口和参数用自己的存储键记住上次的选择，不进入现有设置，也不跟被控机配置走。
- 和现有代码唯一的联系是跳转：设置页新增「工具」Tab（`settings.html#tools`），里面放「串口终端」的简介和打开按钮，在新标签页打开 `terminal.html`。以后其它独立小工具也放进这个 Tab。入口只放设置页，因为控制页要先配好采集卡和键鼠才能打开，只接串口设备的用户进不去；控制页不做任何改动。终端页复用 `theme.js`、`theme.css`、`i18n.js` 来跟随用户选的主题和语言，但不修改它们，文案放在自己的词典文件里。

## Capabilities

### New Capabilities

- `serial-terminal`: 独立的网页串口终端，包括页面入口、串口选择与参数、收发与显示、断线重连、Break、复制粘贴、日志保存、配置记忆和不支持 Web Serial 时的提示。

### Modified Capabilities

（无。设置页只增加一个放跳转按钮的 Tab，现有需求不变。）

## Impact

- 新增：`terminal.html`、`terminal.js`（可单测的纯逻辑）、`terminal-page.js`（页面脚本）、`terminal-locales/` 下五种语言的词典、`vendor/xterm/`（xterm.js、样式、fit 和 search 插件及许可证）、`vendor/zmodem/`（zmodem.js 及其 Apache-2.0 许可证）、`test/terminal.test.js`。
- 修改（仅入口）：`settings.html` 加「工具」Tab 按钮和面板；`settings-page.js` 的 `SETTINGS_TABS` 加上 `tools`；主词典五种语言各加 Tab 名、终端简介和按钮文案。`index.html` 和控制页脚本不改。
- 测试：`test/page-scripts.test.js` 的页面列表加上 `terminal.html`。
- 文档：README 中英文增加「串口终端」一节，对比表「串口终端」改为 √。
- 发布：`build-site.js` 无需修改，新文件纳入 git 即会发布并加上版本号。
- 无破坏性变更。
