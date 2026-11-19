use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtxConfig {
    pub port: String,
    #[serde(default = "default_atx_channel")]
    pub channel: u8,
    #[serde(default)]
    pub reset_channel: Option<u8>,
}

fn default_atx_channel() -> u8 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    #[serde(default = "default_listen")]
    pub listen: String,
    #[serde(default = "default_username")]
    pub username: String,
    /// Plain password for bootstrap; preferred: password_hash (argon2 PHC string).
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub password_hash: Option<String>,
    /// `test-pattern` or capture device id (Windows later).
    #[serde(default = "default_video_source")]
    pub video_source: String,
    #[serde(default)]
    pub serial_port: Option<String>,
    #[serde(default = "default_baud")]
    pub baud: u32,
    #[serde(default = "default_true")]
    pub mouse_absolute: bool,
    #[serde(default)]
    pub atx: Option<AtxConfig>,
    /// Prefer GPU hard encode when available.
    #[serde(default = "default_true")]
    pub prefer_gpu_encode: bool,
    #[serde(default = "default_width")]
    pub width: u32,
    #[serde(default = "default_height")]
    pub height: u32,
    #[serde(default = "default_fps")]
    pub fps: u32,
    /// Target video bitrate hint (kbps) for ffmpeg encoders.
    #[serde(default = "default_bitrate")]
    pub bitrate_kbps: u32,
}

fn default_bitrate() -> u32 {
    4000
}

fn default_listen() -> String {
    "0.0.0.0:8080".into()
}
fn default_username() -> String {
    "admin".into()
}
fn default_video_source() -> String {
    "test-pattern".into()
}
fn default_baud() -> u32 {
    115200
}
fn default_true() -> bool {
    true
}
fn default_width() -> u32 {
    1280
}
fn default_height() -> u32 {
    720
}
fn default_fps() -> u32 {
    30
}

impl Default for Config {
    fn default() -> Self {
        Self {
            listen: default_listen(),
            username: default_username(),
            password: Some("admin".into()),
            password_hash: None,
            video_source: default_video_source(),
            serial_port: Some("mock".into()),
            baud: default_baud(),
            mouse_absolute: true,
            atx: None,
            prefer_gpu_encode: true,
            width: default_width(),
            height: default_height(),
            fps: default_fps(),
            bitrate_kbps: default_bitrate(),
        }
    }
}

impl Config {
    pub fn load(path: impl AsRef<Path>) -> Result<Self> {
        let path = path.as_ref();
        let text = std::fs::read_to_string(path)
            .with_context(|| format!("read config {}", path.display()))?;
        let cfg: Config = serde_json::from_str(&text).context("parse config JSON")?;
        Ok(cfg)
    }

    pub fn load_or_default(path: Option<&Path>) -> Result<(Self, PathBuf)> {
        let path = path
            .map(Path::to_path_buf)
            .unwrap_or_else(|| PathBuf::from("kvm-core.config.json"));
        if path.exists() {
            Ok((Self::load(&path)?, path))
        } else {
            let cfg = Config::default();
            cfg.save(&path)?;
            Ok((cfg, path))
        }
    }

    pub fn save(&self, path: impl AsRef<Path>) -> Result<()> {
        let path = path.as_ref();
        let text = serde_json::to_string_pretty(self)?;
        std::fs::write(path, text).with_context(|| format!("write config {}", path.display()))?;
        Ok(())
    }

    /// Public settings view (no password secrets).
    pub fn public_view(&self) -> serde_json::Value {
        serde_json::json!({
            "listen": self.listen,
            "username": self.username,
            "video_source": self.video_source,
            "serial_port": self.serial_port,
            "baud": self.baud,
            "mouse_absolute": self.mouse_absolute,
            "prefer_gpu_encode": self.prefer_gpu_encode,
            "width": self.width,
            "height": self.height,
            "fps": self.fps,
            "bitrate_kbps": self.bitrate_kbps,
            "atx": self.atx,
            "has_password": self.password.is_some() || self.password_hash.is_some(),
        })
    }
}
