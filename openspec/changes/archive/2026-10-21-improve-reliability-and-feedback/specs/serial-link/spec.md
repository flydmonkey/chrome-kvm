## Purpose

定义控制页与 CH9329 之间串口链路的行为：如何选端口与波特率、芯片不应答时如何降级与恢复、设备拔插与设置变更时如何断开和重连，让键鼠在异常后能自行回到可用状态。

## ADDED Requirements

### Requirement: Degraded sending recovers when the chip answers again
当 CH9329 连续多次不应答时，系统 SHALL 把普通键鼠命令降级为「只发不等应答」，以免每个包都卡在超时上；但查询类命令（读取芯片信息、读取/写入/恢复参数配置）MUST 始终等待应答，并且一旦收到任何应答，系统 MUST 立即恢复为等待应答的模式。

#### Scenario: Chip goes silent then comes back
- **WHEN** 芯片连续 3 次未应答导致降级，之后芯片恢复正常
- **THEN** 下一次状态查询 MUST 收到应答并使系统恢复为等待应答模式
- **AND** 状态栏 MUST 不再显示降级相关的警告

#### Scenario: Chip still silent
- **WHEN** 已经降级且芯片仍不应答时发起状态查询
- **THEN** 查询 MUST 在超时后返回「无结果」，而不是立即当作成功
- **AND** 降级警告 MUST 只在首次降级时输出一次，不重复刷屏

### Requirement: First working port and baud rate are selected automatically
当有多个已授权串口与所选设备匹配时，系统 SHALL 依次尝试，使用第一个能建立 CH9329 连接的端口；波特率 MUST 以已保存的值为首选，失败时按芯片支持的其它波特率探测。放弃的备选端口 MUST 被关闭归还，以免独占后挡住后续连接。

#### Scenario: Two matching ports, first is not a CH9329
- **WHEN** 两个已授权端口都匹配所选设备，第一个无法建立连接
- **THEN** 系统 MUST 关闭第一个端口并改用第二个
- **AND** 连接成功后 MUST 把实际使用的波特率保存为首选

#### Scenario: No matching port
- **WHEN** 没有任何已授权端口匹配所选设备
- **THEN** 系统 MUST 提示到设置页重新授权并选择端口，并提供跳转入口

### Requirement: Unplugged device reconnects automatically
CH9329 被拔出时，系统 SHALL 把连接标记为已断开并在状态中体现；同一设备重新插入时 MUST 自动重连，期间设备暂未出现不得弹出错误打断用户。

#### Scenario: Replug the CH9329
- **WHEN** 用户拔出 CH9329 后重新插入
- **THEN** 控制页 MUST 自动重新连接并恢复键鼠，无需刷新页面

### Requirement: Serial settings change reconnects cleanly
当已保存设置中的串口设备或鼠标模式发生变化时，已打开的控制页 SHALL 先释放所有按下的键和鼠标按键（芯片不应答时最多等待约 300ms），再关闭旧连接并按新设置重连；正在进行的粘贴 MUST 被取消，指针锁定 MUST 退出。只有波特率或芯片工作模式变化时 MUST NOT 触发重连。

#### Scenario: Switch from absolute to relative mode
- **WHEN** 用户在设置页把鼠标模式从绝对改为相对并保存
- **THEN** 控制页 MUST 关闭旧连接并以相对模式重新连接
- **AND** 旧连接关闭时的写入失败 MUST NOT 把新连接标记为已断开

#### Scenario: Settings change while a connection is still opening
- **WHEN** 上一次连接尚未完成时设置再次变化
- **THEN** 过时的那次连接完成后 MUST 立即被关闭，最终只保留按最新设置建立的连接

### Requirement: Missing Web Serial support is reported
当浏览器不支持 Web Serial 时，控制页与设置页 SHALL 明确提示需要使用桌面版 Chrome 或 Edge，而不是抛出脚本错误或静默失败。

#### Scenario: Open in a browser without Web Serial
- **WHEN** 用户在不支持 Web Serial 的浏览器中打开控制页或设置页
- **THEN** 页面 MUST 显示不支持的提示，视频等其它功能 MUST 照常工作
