# i18n Specification

## Purpose
TBD - created by archiving change add-i18n. Update Purpose after archive.

## Requirements

### Requirement: Supported interface languages
控制页和设置页 SHALL 支持简体中文、繁体中文（台湾用词）、英文、日文、韩文五种界面语言，覆盖按钮、提示条、状态说明、出错信息、快捷键名、视图名等所有用户可见的界面文字。被控端画面、设备名等来自外部的内容 MUST NOT 被翻译。

#### Scenario: Interface in Japanese
- **WHEN** 当前语言为日文时打开控制页
- **THEN** 工具栏提示、面板按钮和提示条 MUST 显示日文

#### Scenario: Device names stay as-is
- **WHEN** 当前语言为英文，设置页列出采集卡和串口
- **THEN** 设备名 MUST 按浏览器报告的原样显示

### Requirement: Language is detected and can be chosen
首次使用时 SHALL 按浏览器的首选语言列表依次匹配：`zh-TW`、`zh-HK`、`zh-MO` 及 `zh-Hant*` 匹配繁体中文，其余 `zh*` 匹配简体中文，`en*`、`ja*`、`ko*` 匹配对应语言；都匹配不上时 MUST 使用英文。设置页 SHALL 提供语言选择，选择后立即生效并保存在本机，此后两个页面 MUST 使用该语言，不再跟随浏览器。语言选择 MUST NOT 随多台被控机配置切换。

#### Scenario: Browser prefers French then Japanese
- **WHEN** 浏览器首选语言列表为 `fr-FR, ja-JP` 且用户未选择过语言
- **THEN** 页面 MUST 显示日文

#### Scenario: Unknown browser language
- **WHEN** 浏览器首选语言列表只有 `de-DE` 且用户未选择过语言
- **THEN** 页面 MUST 显示英文

#### Scenario: Manual choice wins
- **WHEN** 浏览器语言为英文，用户在设置页选择了简体中文
- **THEN** 设置页 MUST 立即切换为简体中文，之后打开的控制页 MUST 也显示简体中文

### Requirement: Dictionaries stay complete
每种语言的词典 MUST 包含与简体中文词典完全相同的键，同一个键在各语言中的 `{name}` 占位符 MUST 一致；缺失的键在运行时 SHALL 依次回退到英文、简体中文，最后显示键名本身，而不是显示空白。

#### Scenario: Key missing at runtime
- **WHEN** 某个键在当前语言的词典里缺失
- **THEN** 页面 MUST 显示英文文案，并且不抛出异常
