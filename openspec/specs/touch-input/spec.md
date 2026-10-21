# touch-input Specification

## Purpose
定义在触屏设备上用手指操作被控端的行为：触摸手势如何转换成鼠标动作，以及如何通过系统软键盘向被控端打字，让平板、触屏笔记本也能当 KVM 控制端。

## Requirements

### Requirement: Absolute-mode touch gestures
鼠标为绝对模式时，系统 SHALL 把触摸转换为以下鼠标动作：单指点按为在按下位置左键单击；单指长按（约 0.5 秒且未移动）为在按下位置右键单击；单指移动超过防抖距离后为从按下位置开始的左键拖拽。

#### Scenario: Tap on a desktop icon
- **WHEN** 用户在画面上单指快速点一下
- **THEN** 被控端 MUST 在对应位置收到一次左键单击

#### Scenario: Drag a window
- **WHEN** 用户单指按住窗口标题栏并滑动
- **THEN** 被控端 MUST 收到从按下位置开始的左键拖拽，手指抬起时松开左键

### Requirement: Relative-mode touch gestures
鼠标为相对模式时，系统 SHALL 采用触控板手感：单指滑动超过防抖距离后移动指针；单指快速点按为左键单击；单指长按为按住左键，此后滑动即拖拽，抬起时松开。

#### Scenario: Move the pointer in BIOS
- **WHEN** 相对模式下用户单指滑动
- **THEN** 被控端指针 MUST 按手指位移移动，且 MUST NOT 产生点击

### Requirement: Two-finger gestures
两种模式下，系统 SHALL 把双指快速点按转换为右键单击，把双指上下滑动转换为滚轮，方向为自然滚动（手指向下拖时内容向下走）。第三根手指 MUST 被忽略。单指拖拽中放下第二根手指时，系统 MUST 先松开左键。

#### Scenario: Scroll a web page
- **WHEN** 用户双指在画面上向上滑动
- **THEN** 被控端 MUST 收到向下的滚轮

### Requirement: Touch does not trigger duplicate mouse events
触摸操作 MUST NOT 再经由浏览器补发的兼容鼠标事件发送第二遍，也 MUST NOT 让浏览器滚动或缩放控制页。

#### Scenario: Single tap
- **WHEN** 用户单指点一下
- **THEN** 被控端 MUST 只收到一次单击

### Requirement: On-screen keyboard
在有触摸屏的设备上，工具栏 SHALL 显示屏幕键盘按钮，点击后弹出系统软键盘。输入的文字 MUST 逐字符敲给被控端，规则与粘贴相同（只支持 US 键盘能直接打出的字符）；联想输入 MUST 在组字结束后才发送；退格、回车、Tab、Esc、Delete、方向键、Home、End、PageUp、PageDown MUST 作为对应按键发送。粘贴或开机连按进行中时 MUST NOT 发送。

#### Scenario: Type with an IME that composes words
- **WHEN** 用户用带联想的软键盘输入一个单词，组字过程中候选词多次变化
- **THEN** 被控端 MUST 只收到最终确定的单词

#### Scenario: Desktop without touch screen
- **WHEN** 本机没有触摸屏
- **THEN** 工具栏 MUST NOT 显示屏幕键盘按钮
