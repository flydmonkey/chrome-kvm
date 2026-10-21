## ADDED Requirements

### Requirement: Busy link sends only the latest absolute position
在绝对模式下，当上一包尚未发出、新的指针位置到来时，系统 SHALL 只保留最新的位置等待发送，被替换的旧位置 MUST 计入统计中的「被合并丢弃」；按键包 MUST NOT 被移动包替换或越过。

#### Scenario: Fast pointer movement on a slow link
- **WHEN** 串口繁忙期间指针连续移动经过多个位置
- **THEN** 链路空闲后 MUST 只发送最后一个位置
- **AND** 被替换的位置数量 MUST 计入「被合并丢弃」统计

#### Scenario: Click during fast movement
- **WHEN** 移动尚在排队时用户按下鼠标按键
- **THEN** 按键包 MUST 被发送，且 MUST NOT 因后续移动而丢失
