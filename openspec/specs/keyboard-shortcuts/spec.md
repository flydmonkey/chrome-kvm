# keyboard-shortcuts Specification

## Purpose
定义快捷键面板的行为：预置与自定义快捷键如何发送到被控端、组合键文本的书写规则、开机连按 BIOS 热键，以及与用户键盘输入、粘贴之间的互斥，让本机发不出去的组合键也能一键送达。

## Requirements

### Requirement: Shortcuts are sent as a press-then-release combo
点击快捷键时，系统 SHALL 先发送只含修饰键的按下报告（组合中有修饰键和普通键时），再发送修饰键加普通键的报告，最后发送全部松开的报告；发送前 MUST 清除本地记录的按键状态，发送后被控端 MUST 不残留任何按下的键。组合中含有协议层不认识的键时 MUST NOT 发送任何报告。

#### Scenario: Send Win+L
- **WHEN** 用户点击「Win+L」
- **THEN** 被控端 MUST 依次收到「Win 按下」「Win+L 按下」「全部松开」三份键盘报告

#### Scenario: Modifier-only shortcut
- **WHEN** 用户点击只含 Win 的快捷键
- **THEN** 系统 MUST 发送 Win 按下与全部松开两份报告

### Requirement: Combo text follows a fixed grammar
快捷键文本 SHALL 用 `+` 连接同时按下的键，用空格或逗号分隔多步；修饰键接受 Ctrl/Control、Shift、Alt/Option、Win/Meta/Super/Cmd 等写法，大小写不敏感；普通键支持字母、数字、F1~F12、常用功能键与符号键。修饰键 MUST 排在普通键之前发送，重复的键 MUST 只算一次；单步普通键超过 6 个、出现不认识的键或多余的 `+` 时 MUST 拒绝并指出原因。

#### Scenario: Normalize user input
- **WHEN** 用户输入「 ctrl + alt + f2 」
- **THEN** 系统 MUST 识别为 Ctrl+Alt+F2，并以规范写法「Ctrl+Alt+F2」显示

#### Scenario: Unknown key
- **WHEN** 用户输入「Ctrl+F13」
- **THEN** 系统 MUST 拒绝保存并提示不认识「F13」

#### Scenario: Multi-step sequence
- **WHEN** 用户点击「Win+R Enter」
- **THEN** 系统 MUST 先发送 Win+R，稍作停顿后再发送 Enter

### Requirement: Preset groups cover common systems
面板 SHALL 预置 Windows、macOS、Linux、开机 / BIOS、其他五组快捷键，每个预置项 MUST 能被正确解析，且其中每个键 MUST 能由协议层发送。

#### Scenario: Switch Linux TTY
- **WHEN** 用户点击 Linux 组中的「TTY2」
- **THEN** 被控端 MUST 收到 Ctrl+Alt+F2

### Requirement: Boot keys can be repeated
开机 / BIOS 组 SHALL 提供「开机连按」开关；打开后点击该组的键，系统 MUST 每 0.2 秒按一次，最长 60 秒后自动停止，并显示已按次数和停止按钮。连按期间再次点击任意快捷键或点击停止 MUST 结束连按；连按期间用户的键盘输入 MUST NOT 转发到被控端；串口断开或重连时连按 MUST 停止。

#### Scenario: Catch the BIOS hotkey
- **WHEN** 用户打开开机连按、点击「Del」，然后给被控端开机
- **THEN** 系统 MUST 持续按 Del 直到用户停止或达到 60 秒上限
- **AND** 结束时 MUST 提示共按了多少次以及停止原因

### Requirement: Custom shortcuts are saved locally
用户 SHALL 能在面板中添加自定义快捷键（名称可选，未填时以组合键作为名称）并删除；自定义快捷键 MUST 保存在本机浏览器，最多 30 个，名称最长 20 个字符。存储中的坏数据 MUST 被忽略而不影响面板使用；在另一标签页修改后，已打开的面板 MUST 同步刷新。在面板输入框中打字 MUST NOT 被转发到被控端。

#### Scenario: Add a custom shortcut
- **WHEN** 用户填写名称「切到 TTY2」和组合键「ctrl+alt+f2」并添加
- **THEN** 面板顶部 MUST 出现「自定义」组，包含该快捷键，刷新页面后仍然存在

#### Scenario: Typing in the panel
- **WHEN** 用户在自定义快捷键的输入框里打字
- **THEN** 这些按键 MUST 只进入输入框，被控端 MUST NOT 收到

### Requirement: Shortcuts wait for paste to finish
粘贴进行中点击快捷键时，系统 SHALL 提示等粘贴结束或取消后再试，且 MUST NOT 发送快捷键；键鼠未连接时 MUST 提示未连接。

#### Scenario: Click a shortcut while pasting
- **WHEN** 粘贴尚未完成时用户点击「Alt+Tab」
- **THEN** 系统 MUST 提示正在粘贴，被控端 MUST NOT 收到 Alt+Tab
