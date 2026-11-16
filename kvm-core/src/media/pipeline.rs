use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use parking_lot::RwLock;
use tracing::warn;

use super::encode::{resolve_encoder, EncoderStatus};
use super::frame::RawFrame;
use super::source::FrameSource;

pub struct MediaPipeline {
    source: Arc<dyn FrameSource>,
    latest: RwLock<Option<RawFrame>>,
    encoder: EncoderStatus,
    fps: u32,
}

impl MediaPipeline {
    pub fn new(source: Arc<dyn FrameSource>, prefer_gpu: bool, fps: u32) -> Self {
        Self {
            source,
            latest: RwLock::new(None),
            encoder: resolve_encoder(prefer_gpu),
            fps: fps.max(1),
        }
    }

    pub fn encoder_status(&self) -> &EncoderStatus {
        &self.encoder
    }

    pub fn source_label(&self) -> &str {
        self.source.label()
    }

    pub fn latest_frame(&self) -> Option<RawFrame> {
        self.latest.read().clone()
    }

    pub fn grab_jpeg(&self) -> Result<Vec<u8>> {
        let frame = self
            .latest
            .read()
            .clone()
            .or_else(|| self.source.next_frame().ok())
            .ok_or_else(|| anyhow::anyhow!("no frame"))?;
        frame.to_jpeg(80)
    }

    pub fn spawn_capture_loop(self: &Arc<Self>) {
        let pipe = Arc::clone(self);
        let interval = Duration::from_millis(1000 / u64::from(pipe.fps));
        tokio::spawn(async move {
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                match pipe.source.next_frame() {
                    Ok(frame) => {
                        *pipe.latest.write() = Some(frame);
                    }
                    Err(e) => warn!(error = %e, "frame capture failed"),
                }
            }
        });
    }
}
