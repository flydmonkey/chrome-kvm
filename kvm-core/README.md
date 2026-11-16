# kvm-core（一期）

Windows / 跨平台旁路机上的 LAN IP-KVM 核心：登录控制页、画面推送（WebRTC DataChannel JPEG + WS 回退）、CH9329 键鼠、可选 ATX。AI Agent 为二期。

## 快速开始

```bash
cd kvm-core
cp config.example.json kvm-core.config.json
cargo run --release
```

浏览器打开 `http://<旁路机>:8080/login.html`（默认 `admin` / `admin`）。

## 配置

见 `config.example.json`：

| 字段 | 说明 |
|------|------|
| `serial_port` | CH9329 串口；`mock` 仅本地开发 |
| `video_source` | 一期用 `test-pattern`；真实采集卡（Windows MF）待接 |
| `prefer_gpu_encode` | 优先 GPU；当前无可用硬编时自动软件路径并在状态栏标明 |
| `atx` | 可选 LCUS 继电器 |

## API（需登录）

- `POST /api/login` `{username,password}` → `{token}`
- `GET /api/status`
- `GET /api/frame.jpg`（二期 Agent 截帧）
- `POST /api/input/key` / `mouse` / `release`
- `WS /api/ws/input?token=`
- `WS /api/ws/video?token=`
- `POST /api/webrtc/offer` `{sdp}`
- `POST /api/atx/press` `{kind: short\|long\|reset}`

## 测试

```bash
cargo test
```

协议单测与现有 `test/ch9329.test.js` 样例对齐。

## 硬件（生产）

1. 旁路机（建议 Windows x86 + GPU）接 USB 采集卡与 CH9329  
2. 配置真实 `serial_port`（如 `COM3`）  
3. 内网防火墙放行 `listen` 端口  
4. 采集卡接入后替换 `video_source`（Windows 采集模块为 stub，需后续接线）
