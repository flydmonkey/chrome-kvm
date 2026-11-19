# kvm-core（一期）

旁路机上的 LAN IP-KVM 核心：登录控制页、WebRTC 画面（优先 H264 RTP，失败回退 JPEG DataChannel/WS）、CH9329 键鼠、可选 ATX。AI Agent 为二期。

## 快速开始

```bash
cd kvm-core
cp config.example.json kvm-core.config.json
cargo run --release
```

浏览器打开 `http://<旁路机>:8080/`（默认 `admin` / `admin`）。

## 配置

| 字段 | 说明 |
|------|------|
| `video_source` | `test-pattern`；或 `/dev/video0`（Linux+ffmpeg）；或 Windows 采集卡名称（dshow+ffmpeg） |
| `serial_port` | CH9329 串口；`mock` 仅开发 |
| `prefer_gpu_encode` | 优先 GPU；检测到 NVENC 库/`/dev/nvidia0` 时状态标 gpu，编码一期仍走 OpenH264 软件轨（硬编接线点已留） |
| `atx` | 可选 LCUS 继电器 |

真实采集依赖本机 **ffmpeg**（`v4l2` / `dshow`）。未安装或设备打不开时自动回退 `test-pattern`。

## API（需登录）

- `POST /api/login` → `{token}`
- `GET /api/status` / `GET /api/devices`
- `GET /api/frame.jpg`
- `POST /api/input/key|mouse|release`
- `WS /api/ws/input?token=` / `WS /api/ws/video?token=`
- `POST /api/webrtc/offer` `{sdp}` → `{sdp,type,mode}`（`h264-rtp` 或 `jpeg-dc`）
- `POST /api/atx/press` `{kind}`

## 测试

```bash
cargo test
```

## Windows 旁路机

1. 安装 [ffmpeg](https://ffmpeg.org/) 并加入 PATH  
2. `video_source` 设为采集卡在 dshow 中的名称（可用 `ffmpeg -list_devices true -f dshow -i dummy` 查看）  
3. `serial_port` 设为 `COMx`  
4. 放行 `listen` 端口的防火墙入站规则  

## 硬件

USB 采集卡 + CH9329（+ 可选继电器）接到旁路机；被控机 HDMI → 采集卡，CH9329 → 被控机 USB。
