## 1. 逻辑

- [x] 1.1 `status-text.js` 新增 `LOCK_LIGHTS` 与 `lockLights(info)`
- [x] 1.2 单元测试：顺序与提示文字、无信息或未枚举返回 null、键名存在于 `Ch9329.KEYBOARD_MAP`

## 2. 页面

- [x] 2.1 `index.html` 增加 `#lockLights` 容器与样式
- [x] 2.2 `kvm-page.js`：`renderLockLights`、`pollLockLights`、`toggleLock`、2 秒轮询、可见性与 keyup 补查

## 3. 验证与文档

- [x] 3.1 浏览器中用假芯片验证轮询、点击切换、keyup 补查、未枚举隐藏
- [x] 3.2 README 工具栏表与说明
