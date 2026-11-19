//! Pluggable capture backends.
//!
//! - `test-pattern` — synthetic frames (always available)
//! - `ffmpeg:<device>` — shell out to ffmpeg rawvideo rgba (cross-platform when ffmpeg exists)
//! - `/dev/videoN` or bare device id — treated as ffmpeg v4l2/dshow input

use std::io::Read;
use std::process::{Child, Command, Stdio};
use std::sync::Arc;

use anyhow::{anyhow, bail, Context, Result};
use parking_lot::Mutex;
use tracing::{info, warn};

use super::frame::RawFrame;
use super::source::{FrameSource, TestPatternSource};

pub fn open_source(video_source: &str, width: u32, height: u32, fps: u32) -> Result<Arc<dyn FrameSource>> {
    if video_source.is_empty() || video_source == "test-pattern" {
        info!("video source: test-pattern");
        return Ok(Arc::new(TestPatternSource::new(width, height)));
    }

    #[cfg(windows)]
    {
        if let Ok(src) = super::windows_capture::WindowsCaptureSource::try_open(video_source, width, height)
        {
            info!(device = %video_source, "video source: windows capture");
            return Ok(Arc::new(src));
        }
    }

    match FfmpegCaptureSource::open(video_source, width, height, fps) {
        Ok(src) => {
            info!(device = %video_source, "video source: ffmpeg");
            Ok(Arc::new(src))
        }
        Err(e) => {
            warn!(
                device = %video_source,
                error = %e,
                "capture open failed; falling back to test-pattern"
            );
            Ok(Arc::new(TestPatternSource::new(width, height)))
        }
    }
}

/// Capture via ffmpeg → raw RGBA on stdout.
pub struct FfmpegCaptureSource {
    label: String,
    width: u32,
    height: u32,
    child: Mutex<Child>,
}

impl FfmpegCaptureSource {
    pub fn open(device: &str, width: u32, height: u32, fps: u32) -> Result<Self> {
        let ffmpeg = which_ffmpeg().ok_or_else(|| anyhow!("ffmpeg not found in PATH"))?;
        let (input_args, label) = ffmpeg_input_args(device)?;
        let mut cmd = Command::new(&ffmpeg);
        cmd.args(&input_args)
            .args([
                "-an",
                "-f",
                "rawvideo",
                "-pix_fmt",
                "rgba",
                "-s",
                &format!("{width}x{height}"),
                "-r",
                &fps.max(1).to_string(),
                "-v",
                "error",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        let child = cmd.spawn().with_context(|| format!("spawn ffmpeg for {label}"))?;
        Ok(Self {
            label,
            width,
            height,
            child: Mutex::new(child),
        })
    }
}

impl FrameSource for FfmpegCaptureSource {
    fn label(&self) -> &str {
        &self.label
    }

    fn next_frame(&self) -> Result<RawFrame> {
        let frame_bytes = (self.width as usize) * (self.height as usize) * 4;
        let mut buf = vec![0u8; frame_bytes];
        let mut child = self.child.lock();
        let stdout = child
            .stdout
            .as_mut()
            .ok_or_else(|| anyhow!("ffmpeg stdout missing"))?;
        stdout
            .read_exact(&mut buf)
            .context("read rgba frame from ffmpeg")?;
        Ok(RawFrame {
            width: self.width,
            height: self.height,
            rgba: buf,
        })
    }
}

impl Drop for FfmpegCaptureSource {
    fn drop(&mut self) {
        let mut child = self.child.lock();
        let _ = child.kill();
        let _ = child.wait();
    }
}

pub fn ffmpeg_bin() -> Option<String> {
    which_ffmpeg()
}

fn which_ffmpeg() -> Option<String> {
    if let Ok(p) = std::env::var("FFMPEG_PATH") {
        if std::path::Path::new(&p).exists() {
            return Some(p);
        }
    }
    let names = if cfg!(windows) {
        ["ffmpeg.exe", "ffmpeg"]
    } else {
        ["ffmpeg", "ffmpeg"]
    };
    for name in names {
        if let Some(path) = find_in_path(name) {
            return Some(path);
        }
    }
    None
}

fn find_in_path(bin: &str) -> Option<String> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(bin);
        if candidate.is_file() {
            return Some(candidate.to_string_lossy().into_owned());
        }
    }
    None
}

fn ffmpeg_input_args(device: &str) -> Result<(Vec<String>, String)> {
    let device = device.strip_prefix("ffmpeg:").unwrap_or(device);
    #[cfg(windows)]
    {
        // dshow device name, e.g. video=USB Video
        let name = if device.starts_with("video=") {
            device.to_string()
        } else {
            format!("video={device}")
        };
        return Ok((
            vec![
                "-f".into(),
                "dshow".into(),
                "-i".into(),
                name.clone(),
            ],
            name,
        ));
    }
    #[cfg(not(windows))]
    {
        let path = if device.starts_with("/dev/") {
            device.to_string()
        } else if device.chars().all(|c| c.is_ascii_digit()) {
            format!("/dev/video{device}")
        } else if device.starts_with("video") {
            format!("/dev/{device}")
        } else {
            device.to_string()
        };
        if path.starts_with("/dev/video") && !std::path::Path::new(&path).exists() {
            bail!("device {path} does not exist");
        }
        Ok((
            vec![
                "-f".into(),
                "v4l2".into(),
                "-i".into(),
                path.clone(),
            ],
            path,
        ))
    }
}

pub fn list_video_devices() -> Vec<serde_json::Value> {
    let mut out = vec![serde_json::json!({
        "id": "test-pattern",
        "label": "Test pattern",
        "kind": "synthetic"
    })];

    #[cfg(not(windows))]
    {
        if let Ok(rd) = std::fs::read_dir("/dev") {
            let mut nodes: Vec<_> = rd
                .filter_map(|e| e.ok())
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .and_then(|n| n.to_str())
                        .map(|n| n.starts_with("video"))
                        .unwrap_or(false)
                })
                .collect();
            nodes.sort();
            for p in nodes {
                out.push(serde_json::json!({
                    "id": p.to_string_lossy(),
                    "label": p.to_string_lossy(),
                    "kind": "v4l2"
                }));
            }
        }
    }

    #[cfg(windows)]
    {
        out.push(serde_json::json!({
            "id": "USB Video",
            "label": "USB Video (dshow name hint)",
            "kind": "dshow-hint"
        }));
    }

    if which_ffmpeg().is_some() {
        out.push(serde_json::json!({
            "id": "ffmpeg-available",
            "label": "ffmpeg detected — set video_source to device path/name",
            "kind": "tool"
        }));
    }

    out
}

pub fn list_serial_devices() -> Vec<serde_json::Value> {
    let mut out = vec![serde_json::json!({
        "id": "mock",
        "label": "Mock HID (no hardware)",
        "kind": "mock"
    })];

    #[cfg(not(windows))]
    {
        for prefix in ["ttyUSB", "ttyACM", "ttyS"] {
            if let Ok(rd) = std::fs::read_dir("/dev") {
                let mut nodes: Vec<_> = rd
                    .filter_map(|e| e.ok())
                    .map(|e| e.file_name().to_string_lossy().into_owned())
                    .filter(|n| n.starts_with(prefix))
                    .collect();
                nodes.sort();
                for n in nodes {
                    out.push(serde_json::json!({
                        "id": format!("/dev/{n}"),
                        "label": format!("/dev/{n}"),
                        "kind": "serial"
                    }));
                }
            }
        }
    }

    #[cfg(windows)]
    {
        for i in 1..=20 {
            out.push(serde_json::json!({
                "id": format!("COM{i}"),
                "label": format!("COM{i}"),
                "kind": "serial-hint"
            }));
        }
    }

    out
}
