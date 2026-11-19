# kvm-core（一期，不含 AI）

旁路机 LAN IP-KVM：登录控制页、WebRTC（优先 ffmpeg GPU/软编 H264 RTP，否则 OpenH264，再回退 JPEG DataChannel/WS）、CH9329、可选 ATX、设置页。

## 快速开始

```bash
cd kvm-core
cp config.example.json kvm-core.config.json
# Linux
./scripts/run-linux.sh
# Windows PowerShell
./scripts/run-windows.ps1
```

浏览器：`http://<旁路机>:8080/`（默认 `admin` / `admin`）→ 控制页 / 设置页。

## 配置与设置页

| 字段 | 说明 |
|------|------|
| `video_source` | `test-pattern`；Linux `/dev/video0`；Windows dshow 名称（需 ffmpeg） |
| `serial_port` | CH9329；`mock` 开发用 |
| `mouse_absolute` | 绝对/相对鼠标（设置页可热改） |
| `prefer_gpu_encode` | 优先 NVENC/QSV/AMF（经 ffmpeg）；否则 OpenH264 |
| `width`/`height`/`fps`/`bitrate_kbps` | 采集/编码参数 |

改视频源、串口、分辨率后需**重启进程**。口令可在设置页更新（argon2 哈希写入配置）。

## API

- `POST /api/login` / `logout`
- `GET|POST /api/settings`（含 `input_locked` 预留给二期 Agent）
- `GET /api/status` / `GET /api/devices`
- `GET /api/frame.jpg`
- `POST /api/input/*`、`WS /api/ws/input`
- `WS /api/ws/video`、`POST /api/webrtc/offer`
- `POST /api/atx/press`

## 测试

```bash
cargo test
```

## Windows 旁路机清单

1. 安装 Rust、[ffmpeg](https://ffmpeg.org/)（加入 PATH）  
2. `ffmpeg -list_devices true -f dshow -i dummy` 查看采集卡名称  
3. 设置页填入视频名与 `COMx`  
4. 防火墙放行监听端口（脚本会尝试加 Private 入站规则）  
5. 另一台内网电脑打开控制页验证画面与键鼠  

## 非目标

AI Agent、公网暴露、OTG/虚拟光驱、五语 i18n、OCR、串口终端页（仍用原 Chrome-KVM 静态站）。
