#Requires -Version 5.1
<#
.SYNOPSIS
  在 Windows 上编译并生成可运行的 kvm-core 便携目录。
.NOTES
  需要：网络（首次装 Rust）、可选 ffmpeg（采集卡/硬编）
#>
param(
    [string]$OutDir = "",
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $Root "Cargo.toml"))) {
    Write-Error "请把本脚本放在 kvm-core/scripts/ 下运行（需有 Cargo.toml）"
}
Set-Location $Root

if ([string]::IsNullOrWhiteSpace($OutDir)) {
    $OutDir = Join-Path $Root "dist\kvm-core-windows"
}

function Ensure-Rust {
    if (Get-Command cargo -ErrorAction SilentlyContinue) { return }
    Write-Host "未检测到 Rust，正在安装 rustup（默认路径）…"
    $tmp = Join-Path $env:TEMP "rustup-init.exe"
    Invoke-WebRequest -Uri "https://win.rustup.rs/x86_64" -OutFile $tmp
    & $tmp -y --default-toolchain stable
    $cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
    $env:Path = "$cargoBin;$env:Path"
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Error "Rust 安装后仍找不到 cargo，请重新打开 PowerShell 再运行本脚本"
    }
}

function Ensure-FfmpegHint {
    if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
        Write-Host "已找到 ffmpeg"
        return
    }
    Write-Warning @"
未找到 ffmpeg。
- 仅测界面：可用默认 video_source=test-pattern
- 接采集卡：请安装 ffmpeg 并加入 PATH
  https://www.gyan.dev/ffmpeg/builds/ 或 scoop install ffmpeg
查看采集卡名称：
  ffmpeg -list_devices true -f dshow -i dummy
"@
}

Ensure-Rust
Ensure-FfmpegHint

if (-not $SkipBuild) {
    Write-Host "cargo build --release …"
    cargo build --release
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

$exe = Join-Path $Root "target\release\kvm-core.exe"
if (-not (Test-Path $exe)) {
    Write-Error "未找到 $exe"
}

New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "web") | Out-Null

Copy-Item $exe (Join-Path $OutDir "kvm-core.exe") -Force
Copy-Item -Recurse -Force (Join-Path $Root "web\*") (Join-Path $OutDir "web")
Copy-Item (Join-Path $Root "config.example.json") (Join-Path $OutDir "config.example.json") -Force
Copy-Item (Join-Path $Root "README.md") (Join-Path $OutDir "README.md") -Force

$config = Join-Path $OutDir "kvm-core.config.json"
if (-not (Test-Path $config)) {
    Copy-Item (Join-Path $OutDir "config.example.json") $config
}

$startPs1 = @'
param([string]$Config = "kvm-core.config.json")
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
# 可选：放行 8080（需管理员）
try {
  $port = 8080
  if (Test-Path $Config) {
    $j = Get-Content $Config -Raw | ConvertFrom-Json
    if ($j.listen -match ":(\d+)$") { $port = [int]$Matches[1] }
  }
  $name = "kvm-core-$port"
  if (-not (Get-NetFirewallRule -DisplayName $name -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $name -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port -Profile Private | Out-Null
    Write-Host "已添加防火墙规则 TCP $port (Private)"
  }
} catch {
  Write-Warning "防火墙规则未添加（可用管理员 PowerShell 重试）: $_"
}
Write-Host "启动 kvm-core … 浏览器打开 http://本机IP:$port/"
& "$PSScriptRoot\kvm-core.exe" $Config
'@
Set-Content -Path (Join-Path $OutDir "启动.ps1") -Value $startPs1 -Encoding UTF8

$readmeCn = @"
# kvm-core Windows 便携包

## 使用

1. 双击或在本目录 PowerShell 运行：``.\启动.ps1``
2. 浏览器打开 ``http://127.0.0.1:8080/``（默认账号 admin / admin）
3. 改设备：打开设置页，或编辑 ``kvm-core.config.json`` 后重启

## 真机

- 安装 ffmpeg 并加入 PATH
- ``video_source`` 填采集卡 dshow 名称（可用 ffmpeg -list_devices 查看）
- ``serial_port`` 填 CH9329 的 COM 口，如 COM3
- 另一台内网电脑访问 ``http://旁路机IP:8080/``

## 说明

- 本包不含 AI（二期）
- 首次若没有 exe，请回到源码目录运行 ``scripts\windows-install.ps1`` 生成
"@
Set-Content -Path (Join-Path $OutDir "使用说明.txt") -Value $readmeCn -Encoding UTF8

Write-Host ""
Write-Host "完成：$OutDir"
Write-Host "进入该目录运行: .\启动.ps1"
