#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
CONFIG="${1:-kvm-core.config.json}"
if [[ ! -f "$CONFIG" ]]; then
  cp config.example.json "$CONFIG"
  echo "Created $CONFIG"
fi
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "warning: ffmpeg not found; use test-pattern or install ffmpeg for /dev/video*"
fi
cargo build --release
exec ./target/release/kvm-core "$CONFIG"
