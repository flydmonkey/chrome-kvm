#!/usr/bin/env bash
# 打出可拷到 Windows 的安装源码包（在 Windows 上运行 windows-install.ps1 编译）
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
STAMP="$(date +%Y%m%d)"
OUT_DIR="$REPO/dist"
NAME="kvm-core-windows-installer-$STAMP"
STAGE="$OUT_DIR/$NAME"

rm -rf "$STAGE"
mkdir -p "$STAGE/kvm-core"

# 只拷需要的目录/文件，避免 target
cp "$ROOT/Cargo.toml" "$ROOT/Cargo.lock" "$ROOT/README.md" "$ROOT/config.example.json" "$STAGE/kvm-core/"
cp -a "$ROOT/src" "$ROOT/web" "$ROOT/tests" "$ROOT/scripts" "$STAGE/kvm-core/"

cat > "$STAGE/请先读我-Windows安装.txt" << 'EOF'
kvm-core Windows 安装包（源码 + 一键编译）
========================================

【环境】
1. Windows 10/11 x64
2. 需要联网（首次自动装 Rust）
3. 建议安装 ffmpeg（采集卡 / GPU 硬编）
   https://www.gyan.dev/ffmpeg/builds/  或  scoop install ffmpeg

【安装步骤】
1. 解压本 zip 到任意目录
2. PowerShell：

   cd kvm-core
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\windows-install.ps1

3. 完成后进入：
   kvm-core\dist\kvm-core-windows\
   运行 .\启动.ps1

4. 浏览器：http://127.0.0.1:8080/
   默认账号 admin / admin

【真机】
编辑 kvm-core.config.json：
- video_source = 采集卡 dshow 名称
- serial_port = COMx
EOF

mkdir -p "$OUT_DIR"
ZIP="$OUT_DIR/$NAME.zip"
rm -f "$ZIP"
(cd "$OUT_DIR" && zip -qr "$NAME.zip" "$NAME")
echo "PACKED=$ZIP"
ls -lh "$ZIP"
