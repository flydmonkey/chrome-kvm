# ocr Specification

## Purpose
定义从控制页识别被控端画面文字的行为：如何框选、识别哪些语言、结果如何整理与复制，以及识别全程在本机完成、不影响被控端，让用户能把屏幕上的文字拿回本机。

## Requirements

### Requirement: Box selection does not reach the target
用户点击识别文字后，系统 SHALL 进入框选模式：在画面上拖出矩形即选定区域。框选期间鼠标、滚轮与键盘操作 MUST NOT 发送给被控端；按 Esc 或鼠标右键 MUST 取消框选；拖出的矩形过小或完全落在画面之外时 MUST 提示并保持框选模式。没有正在采集的画面时 MUST 提示无法识别，且不进入框选模式。

#### Scenario: Press keys while selecting
- **WHEN** 用户在框选模式下按键盘上的字母键或滚动滚轮
- **THEN** 被控端 MUST NOT 收到任何按键或滚轮

#### Scenario: Cancel with Esc
- **WHEN** 用户在框选模式下按 Esc
- **THEN** 系统 MUST 退出框选模式，且不进行识别

### Requirement: Region is cropped from the native picture
系统 SHALL 按采集画面的原始像素截取所选区域，在适应窗口、拉伸、1:1、放大平移等任何显示方式下，截取的内容 MUST 与屏幕上框住的内容一致；框到黑边或窗口外的部分 MUST 裁掉。截取 MUST 在框选完成时进行，不受随后加载引擎所需时间的影响。截取后 SHALL 放大小区域、转为灰度，整体偏暗时 MUST 反色为浅底深字。

#### Scenario: Select text while zoomed
- **WHEN** 画面放大 200% 并平移后，用户框住屏幕上的一行字
- **THEN** 识别所用的图像 MUST 正是采集画面中这一行字所在的区域

#### Scenario: BIOS screen with white text on blue
- **WHEN** 用户框选蓝底白字的 BIOS 界面
- **THEN** 系统 MUST 先反色再识别

### Requirement: Recognition languages
系统 SHALL 支持英文、简体中文、繁体中文，由用户勾选，至少保留一种，默认英文加简体中文，选择 MUST 保存在本机。同时选了英文和中文时，系统 MUST 先以英文优先识别；结果中含有汉字时 MUST 再以中文优先重新识别并采用第二次的结果。勾选变化后 MUST 按新语言重新识别上一块区域。

#### Scenario: Chinese text with English selected
- **WHEN** 选了英文和简体中文，用户框选一段含少量英文与数字的中文
- **THEN** 系统 MUST 以中文优先的结果为准

#### Scenario: Pure English text
- **WHEN** 选了英文和简体中文，用户框选一段纯英文错误信息
- **THEN** 系统 MUST 只识别一次，并采用英文优先的结果

### Requirement: Result is cleaned, editable and copied
识别结果 SHALL 去掉汉字之间多余的空格、行尾空白与多余空行；夹在两个汉字之间的半角逗号、冒号、分号、问号、感叹号 MUST 转为全角。结果 MUST 显示在可编辑的面板中，系统 MUST 尝试自动复制到剪贴板，并提示识别出的字数；没有识别到文字时 MUST 提示用户缩小框选范围再试。浏览器拒绝写入剪贴板时，手动复制 MUST 选中文字并提示用户自行复制。

#### Scenario: Spaces inserted between Chinese characters
- **WHEN** 引擎输出「系统 无 法 启动 , 请 检查」
- **THEN** 面板中 MUST 显示「系统无法启动，请检查」

### Requirement: Recognition runs locally and offline
识别 MUST 完全在本机浏览器中进行，画面 MUST NOT 发送到任何服务器。识别引擎与三种语言包 MUST 随站点一起提供，不依赖外网。引擎 SHALL 在第一次识别时才加载，闲置一段时间后释放；识别失败时 MUST 提示原因并在下次识别时重新创建引擎。同一时间只进行一次识别。

#### Scenario: Control PC without internet access
- **WHEN** 控制端电脑不能访问外网，用户第一次使用识别文字
- **THEN** 系统 MUST 从本站加载引擎与语言包并完成识别
