## 1. 引入 xterm.js

- [x] 1.1 从 npm 取 `@xterm/xterm` 5.5.x 和 `@xterm/addon-fit` 的 UMD 构建，把 `xterm.js`、`xterm.css`、`addon-fit.js` 和各自的 MIT 许可证放进 `vendor/xterm/` 并纳入 git；验证：`npm run build` 后 `_site/vendor/xterm/` 下有这些文件

## 2. 纯逻辑模块 `terminal.js`

- [x] 2.1 新建 UMD 风格的 `terminal.js`：参数常量（波特率列表、数据位、校验、停止位、流控、换行）、`normalize()`（非法值退回默认，没有 `deviceId` 时串口为空）、`load()` / `save()` 读写 `chrome-kvm-terminal`；验证：`test/terminal.test.js` 覆盖 12345 波特率、"foo" 校验位、缺字段、存储内容损坏
- [x] 2.2 实现回车转换和粘贴文本转换（`\r\n`、`\r`、`\n` 统一后替换为 CR / LF / CR+LF），以及「是否超过一行」「共几行」的判断；验证：单测覆盖三种换行设置和混合换行输入
- [x] 2.3 实现候选串口过滤（按 VID/PID 匹配，本页选过的串口排最前）和串口显示名（常见芯片小表，未知芯片显示 VID:PID）；验证：单测覆盖匹配、不匹配、选过的串口优先、未知芯片
- [x] 2.4 实现日志环形缓冲（上限 5MB，超出丢最早的块，最后一块按需截断）和日志文件名生成；验证：单测覆盖未超限、刚好超限、单块超过上限，以及文件名格式

## 3. 终端词典

- [x] 3.1 新建 `terminal-locales/` 下简中、繁中、英、日、韩五个词典文件，各自 `I18n.register()`；验证：`test/terminal.test.js` 检查五种语言的键集合完全一致，且没有空字符串

## 4. 终端页

- [x] 4.1 新建 `terminal.html`：引入 `theme.js`、`theme.css`、`vendor/xterm/` 的脚本和样式、`i18n.js`、`terminal-locales/*.js`、`terminal.js`、`terminal-page.js`；顶部工具栏（串口下拉、授权新串口、参数、连接/断开、选择串口、Break、清屏、复制、粘贴、保存日志）、状态栏、常驻的「建议用不同芯片」提示、铺满剩余空间的终端容器；验证：本地静态服务器打开页面无脚本错误，切换明暗主题和语言后页面跟着变
- [x] 4.2 `test/page-scripts.test.js` 的页面列表加上 `terminal.html`；验证：`npm test` 通过（无重名顶层声明、无加载时引用后加载函数）
- [x] 4.3 `terminal-page.js`：初始化 xterm 和 fit 插件，窗口大小变化时重算行列；参数控件读写存储，改动立即保存；「授权新串口」调 `requestPort()` 后刷新下拉框而不刷新页面；验证：改参数后刷新页面仍显示改后的值，且处于未连接状态
- [ ] 4.4 连接流程：按 design 第 5 节挑串口（只打开不写入），多于一个时显示「选择串口」并用带 VID/PID 过滤的 `requestPort()`，选中的串口本页会话内记住；验证：插两个 CH340 时提示分不清且两个串口都没有收到数据，选择后能连上；控制页占着 CH9329 时终端自动跳过它
- [ ] 4.5 读写循环：收到的数据写入终端和日志缓冲；打字按 UTF-8 编码、回车按设置转换，写入走单一队列；验证：接一台 Linux 串口控制台能登录并正常显示 `top`
- [ ] 4.6 断开、拔插重连、离开确认：主动断开后不再自动重连；拔出时终端写一行断开提示，插回时自动重连并写一行重连提示，期间不报错；连接中改参数则按新参数重开且历史保留；连接中注册 `beforeunload`，`pagehide` 时释放串口；验证：手动拔插、改波特率、按 Ctrl+W 各走一遍
- [x] 4.7 辅助操作：Break（250ms，松开放在 `finally`）、清屏（不写串口）、复制选中、粘贴（拦截 `paste` 事件，多行时在状态栏确认）、保存日志；未连接时 Break 和粘贴不可用；验证：多行粘贴先出确认、确认后按设置的换行发送；保存的日志与收到的字节一致
- [ ] 4.8 不支持 Web Serial 时显示提示并禁用连接相关控件；验证：在不支持的浏览器里打开，无脚本错误
- [x] 4.9 HEX 模式：`terminal.js` 的 `parseHex()` / `formatHex()` 和配置里的 `mode`；「显示」下拉框切换不重开串口；HEX 模式下 RX/TX 按行显示、HEX 发送框；验证：单测覆盖各种写法和错误输入，假串口回环下 TX/RX 显示正确、格式错误时不写入
- [x] 4.10 调试工具补全：波特率可手填；DTR/RTS 开关与 CTS/DSR/DCD/RI 指示灯；常驻发送栏（文本/HEX、SUM8/XOR8/CRC16 校验、循环发送）；常用指令；时间戳；本地回显；GBK 编码；HEX 显示带 ASCII 对照列；收发计数；搜索（`vendor/xterm/addon-search.js`）；验证：单测覆盖校验、GBK 编码、时间戳插行、配置校验，假串口回环下逐项走通
- [x] 4.11 控制台补全：状态栏列×行并一键发 stty；粘贴字符/行间隔；回滚行数、字号可调（Ctrl+加减号/滚轮）；记录到文件（File System Access，每 2 秒追加）；发送栏 ↑/↓ 历史；关键字高亮（xterm decoration）；自动应答；YMODEM/XMODEM/XMODEM-1K/原样发送文件；验证：单测覆盖分段、高亮匹配、应答匹配、XMODEM/YMODEM 收发与重发/超时/取消，假串口和假接收端下逐项走通
- [ ] 4.12 真机验证文件传输：U-Boot `loady` / `loadx` 和 Linux `rb` / `rx` 各传一个文件，校验内容一致
- [x] 4.13 对标专业串口工具：ZMODEM 收发（`vendor/zmodem/zmodem.js`，Apache-2.0）；LRC/CRC8/CRC16-CCITT/CRC32 校验；HEX 分帧超时可调；数据曲线（canvas）；脚本（send/sendraw/hex/wait/timeout/delay/loop）；设置导入导出；设备配置；验证：单测覆盖各校验的标准校验值、脚本解析与执行（等待、超时、循环、取消）、曲线行解析、配置快照/应用/导入导出的坏值处理
- [ ] 4.14 浏览器和真机验证 4.13：切换设备配置、导入导出、运行脚本、曲线、分帧超时；Linux 上 `sz` / `rz` 各传一个文件，校验内容一致

## 5. 入口

- [x] 5.1 `settings.html` 的 Tab 栏在「电源」之后加「工具」Tab（扳手图标，`data-tab="tools"`）和对应面板，`settings-page.js` 的 `SETTINGS_TABS` 加上 `"tools"`；验证：点击和方向键都能切到「工具」，打开 `settings.html#tools` 直接停在这个 Tab，刷新后仍停在这里
- [x] 5.2 「工具」面板里放「串口终端」卡片：标题、简介、「打开串口终端」按钮，`window.open("terminal.html", "_blank")`；主词典五种语言各加 Tab 名、标题、简介、按钮文案；验证：在「视频」Tab 改了表单不保存，切到「工具」点按钮，新标签页打开终端页，设置页的 Tab 和表单内容不变；`test/i18n.test.js` 通过；`git diff --stat` 里没有 `index.html` 和 `kvm-*.js`

## 6. 文档

- [x] 6.1 README 中英文增加「串口终端」一节：入口在设置页的「工具」Tab（也可以直接打开 `terminal.html`，收藏起来下次直接用）、TTL 与 RS232 的接法和买线建议、常见波特率、建议终端用和 CH9329 不同芯片的转接线及原因、硬件流控和 DTR/RTS 自动复位的说明、常见问题；对比表「串口终端」改为 √；验证：通读一遍，提到的按钮和文案与界面一致

## 7. 整体验证

- [x] 7.1 运行 `npm test` 全部通过；`npm run build` 成功，`_site/terminal.html` 引用的本地脚本和样式都带上了 `?v=` 哈希
- [ ] 7.2 真机走一遍：控制页连着 CH9329 和采集卡的同时，在终端页连另一个串口 console；拔插终端转接线、改波特率、在设置页保存和切换配置，确认终端页和控制页互不影响
