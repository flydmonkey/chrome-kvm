//! Windows USB capture (Media Foundation / DirectShow) — stub for phase 1.
//! Wire real device enumeration and sample grab here; until then use `test-pattern`.

use anyhow::{bail, Result};

use super::frame::RawFrame;
use super::source::FrameSource;

pub struct WindowsCaptureSource {
    device_id: String,
}

impl WindowsCaptureSource {
    pub fn open(device_id: impl Into<String>) -> Result<Self> {
        let device_id = device_id.into();
        // Intentionally not opening devices yet.
        tracing::warn!(%device_id, "WindowsCaptureSource stub: use test-pattern until MF capture is implemented");
        Ok(Self { device_id })
    }
}

impl FrameSource for WindowsCaptureSource {
    fn label(&self) -> &str {
        "windows-capture-stub"
    }

    fn next_frame(&self) -> Result<RawFrame> {
        bail!(
            "Windows capture not implemented yet (device={}); set video_source to \"test-pattern\"",
            self.device_id
        )
    }
}
