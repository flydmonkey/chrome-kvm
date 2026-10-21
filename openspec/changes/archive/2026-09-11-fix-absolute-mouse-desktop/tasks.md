## 1. 语义与粘滞修复（P0）

- [x] 1.1 修正 `settings.html` 中绝对/相对选项的 value 与中文文案一一对应，并确认保存后 localStorage 中 `mouseClickMode` 为 `absolute` 或 `relative`
- [x] 1.2 修正 `index.html` 构造逻辑为 `mouseAbsolute = (settings.mouseClickMode === "absolute")`，默认未设置时按绝对；用设置页选绝对后刷新主页，确认进入绝对分支
- [x] 1.3 将 `ch9329.js` 中 `mouseupAbsolute` 按键位改为 `0x00`；对照相对松键包确认左键释放后 `clicked.command` 清零

## 2. 坐标映射（P1）

- [x] 2.1 实现基于 `getBoundingClientRect` + 画面内容区（去黑边）的坐标换算，输出 clamp 到 `0..4095`；用四角点击或日志抽样验证边界值
- [x] 2.2 统一 `mousemove` / `mousedown` 使用 `clientX`/`clientY` 进入同一换算函数；确认两路径不再混用 `event.x` 与未扣偏移的坐标

## 3. 绝对模式闭环与验收

- [x] 3.1 确保绝对模式下 move/click/up 均走命令码 `0x04`；滚轮优先 `0x04` 滚轮字段，若暂留 `0x05` 则验证不破坏按键位与绝对坐标状态
- [x] 3.2 实机验收：桌面单击不粘滞、拖拽可松开、四角点选大致准确；在设置中选「绝对模式」保存后行为符合预期
- [x] 3.3 在设置页为「相对模式」增加简短提示（桌面请用绝对 / 相对未完整支持），避免用户误以为相对已闭环
