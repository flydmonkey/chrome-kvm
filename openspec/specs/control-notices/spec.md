# control-notices Specification

## Purpose
定义控制页向用户反馈错误、警告与操作结果的方式，保证反馈不抢夺焦点、不打断对被控端的操作，并且同一类消息不会堆积。

## Requirements

### Requirement: Feedback never uses blocking dialogs
控制页 SHALL 通过画面顶部的非阻塞提示条反馈错误与结果，MUST NOT 使用浏览器的阻塞式弹窗；显示提示 MUST NOT 让被控端上按住的键或鼠标按键被意外释放，也 MUST NOT 退出指针锁定或全屏。

#### Scenario: Error while keys are held
- **WHEN** 用户按住某个组合键时控制页需要报告一个错误
- **THEN** 错误 MUST 以提示条显示，用户的按键状态 MUST 保持不变

### Requirement: Notices are keyed, leveled and timed
每条提示 SHALL 带有类别（如视频、串口、粘贴、录制、设置），同一类别的新提示 MUST 取代旧提示而不是叠加。错误级别的提示 MUST 保持到用户关闭或问题解除；其它级别默认约 6 秒后自动消失，调用方可指定更短、更长或不自动消失。提示条 SHALL 支持附带跳转链接或操作按钮，并支持为进行中的操作隐藏关闭按钮。

#### Scenario: Repeated video errors
- **WHEN** 视频连续两次打开失败
- **THEN** 页面 MUST 只显示一条视频类提示，内容为最新一次的失败原因

#### Scenario: Problem resolved
- **WHEN** 串口错误提示显示中，随后串口成功连接
- **THEN** 串口类提示 MUST 被移除

#### Scenario: Scrolling over notices
- **WHEN** 用户在提示条上滚动鼠标滚轮
- **THEN** 该滚动 MUST NOT 作为滚轮事件发往被控端

### Requirement: Notices are announced to assistive technology
提示区域 SHALL 作为礼貌型的实时区域，使屏幕阅读器在不打断当前朗读的前提下播报新提示。

#### Scenario: New notice appears
- **WHEN** 页面显示一条新提示
- **THEN** 辅助技术 MUST 能读到该提示内容
