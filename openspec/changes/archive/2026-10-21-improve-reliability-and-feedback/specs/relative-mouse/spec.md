## Purpose

定义相对鼠标模式下指针位移如何转换成 CH9329 相对鼠标数据包，保证串口繁忙时位移不丢、超出单包范围时正确拆分，且移动与按键的先后顺序在被控端保持一致。

## ADDED Requirements

### Requirement: Queued relative movement accumulates instead of being replaced
在相对模式下，当上一包尚未发出、新的位移到来时，系统 SHALL 把新位移累加到排队中的那一包上，而不是丢弃旧位移只保留新位移；无论串口多忙，被控端收到的总位移 MUST 等于用户产生的总位移（乘以灵敏度后）。

#### Scenario: Burst of small moves while link is busy
- **WHEN** 串口正在等待上一包应答，用户在此期间连续产生 100 次 `dx=1` 的位移
- **THEN** 最终发往 CH9329 的相对数据包的 X 位移之和 MUST 为 100
- **AND** 统计中 MUST 记录发生了多少次合并

#### Scenario: Accumulated movement exceeds one packet
- **WHEN** 累加后的单轴位移超出单包可表示的 `-127..127`
- **THEN** 系统 MUST 先发送截断到 `±127` 的一包，并把余量作为紧接着的下一包优先发送
- **AND** 余量 MUST NOT 被其它后来入队的移动插队

### Requirement: Button packets are not overtaken by later movement
相对模式下，移动包入队后若又有按键（按下或释放）包入队，此后到来的位移 SHALL 排在该按键包之后发送，不得合并进按键包之前的那一包。

#### Scenario: Move, click, move
- **WHEN** 用户先移动、再点击、再移动，且三者都在串口繁忙时入队
- **THEN** 被控端 MUST 按「第一段位移 → 按键 → 第二段位移」的顺序收到数据
- **AND** 第二段位移 MUST NOT 被加到第一段位移上

### Requirement: Relative sensitivity applies without reload
相对模式的灵敏度倍数 SHALL 作用于每次位移；用户在设置页修改并保存灵敏度后，已经打开的控制页 MUST 立即按新倍数发送，无需刷新或重连串口。

#### Scenario: Change sensitivity while controlling
- **WHEN** 控制页处于相对模式，用户在另一标签页把灵敏度从 1 改为 2 并保存
- **THEN** 控制页之后的同样手势 MUST 产生两倍的位移
- **AND** 控制页 MUST NOT 因此断开或重连串口

### Requirement: Pointer movement is sampled at hardware rate
在浏览器支持且页面处于安全上下文时，系统 SHALL 以鼠标硬件回报率接收指针移动，而不是只在每个渲染帧接收一次；不支持时 MUST 回退为普通的鼠标移动事件，功能不受影响。

#### Scenario: Supported browser
- **WHEN** 页面运行在支持按硬件回报率上报指针移动的浏览器中
- **THEN** 系统 MUST 使用该种事件处理移动，不再额外监听普通移动事件，避免同一位移被处理两次

#### Scenario: Unsupported browser or insecure context
- **WHEN** 浏览器不支持按硬件回报率上报，或页面不是安全上下文
- **THEN** 系统 MUST 使用普通的鼠标移动事件，相对与绝对模式均正常工作
