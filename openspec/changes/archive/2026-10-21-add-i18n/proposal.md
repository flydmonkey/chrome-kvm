## Why

界面文字全部写死为简体中文，繁体、英文、日文、韩文用户只能靠浏览器机翻，而机翻会把按钮、快捷键名和出错说明译得面目全非，也会干扰对页面的操作。

## What Changes

- 新增 `i18n.js`：语言检测、取词 `I18n.t(key, params)`、`{name}` 占位符替换、按 `data-i18n*` 属性翻译 HTML。
- 新增 `locales/` 下五份词典：`zh-CN`、`zh-TW`（台湾用词）、`en`、`ja`、`ko`。
- 两个页面和各模块里用户可见的文字（按钮、提示、状态说明、出错信息、快捷键名、视图名等）改为从词典取。
- 首次打开时跟随浏览器语言，匹配不上时用英文；设置页提供语言选择，存在本机，对两个页面都生效。
- 测试保证五份词典键名一致、占位符一致，代码里用到的键都存在。
- 新增英文 README `README.en.md`，两份 README 互相链接。

## Capabilities

### New Capabilities

- `i18n`: 界面语言的选择、检测、取词与回退。

### Modified Capabilities

## Impact

- 新增 `i18n.js`、`locales/*.js`、`test/i18n.test.js`、`README.en.md`。
- 所有含界面文字的脚本与 `index.html`、`settings.html`。
- 现有单测在 Node 下默认使用简体中文，断言不变。
