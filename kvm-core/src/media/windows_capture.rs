//! Windows capture via ffmpeg dshow (preferred) or explicit stub.
//! Full Media Foundation binding can replace this without changing FrameSource.

use anyhow::{bail, Result};

use super::frame::RawFrame;
use super::source::FrameSource;

pub struct WindowsCaptureSource {
    device_id: String,
    width: u32,
    height: u32,
}

impl WindowsCaptureSource {
    /// Try to open; currently returns Err so caller can use ffmpeg path.
    /// Kept as extension point for native MF/DirectShow.
    pub fn try_open(device_id: &str, width: u32, height: u32) -> Result<Self> {
        // Prefer ffmpeg dshow in capture.rs; native MF not wired yet.
        bail!("native windows capture not wired; use ffmpeg dshow for {device_id}");
        #[allow(unreachable_code)]
        Ok(Self {
            device_id: device_id.into(),
            width,
            height,
        })
    }
}

impl FrameSource for WindowsCaptureSource {
    fn label(&self) -> &str {
        &self.device_id
    }

    fn next_frame(&self) -> Result<RawFrame> {
        let _ = (self.width, self.height);
        bail!(
            "Windows native capture not implemented (device={}); install ffmpeg and set video_source",
            self.device_id
        )
    }
}
