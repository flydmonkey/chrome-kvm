# Start kvm-core on Windows (run from kvm-core directory or pass config path).
param(
    [string]$Config = "kvm-core.config.json",
    [string]$ListenHint = "8080"
)

$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
    Write-Error "cargo not found. Install Rust from https://rustup.rs/"
}

if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
    Write-Warning "ffmpeg not in PATH. Capture cards need ffmpeg (dshow). Encoding falls back to OpenH264."
}

# Allow inbound LAN traffic for the listen port (best-effort; may need admin)
try {
    $rule = "kvm-core-$ListenHint"
    if (-not (Get-NetFirewallRule -DisplayName $rule -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $rule -Direction Inbound -Action Allow -Protocol TCP -LocalPort $ListenHint -Profile Private | Out-Null
        Write-Host "Firewall rule added for TCP $ListenHint (Private)"
    }
} catch {
    Write-Warning "Could not add firewall rule (run PowerShell as Administrator if needed): $_"
}

if (-not (Test-Path $Config)) {
    Copy-Item "config.example.json" $Config
    Write-Host "Created $Config from example"
}

Write-Host "Building release…"
cargo build --release
Write-Host "Starting kvm-core with $Config"
& ".\target\release\kvm-core.exe" $Config
