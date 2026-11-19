use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use parking_lot::RwLock;
use tracing::warn;

use super::encode::{resolve_encoder, EncoderStatus, H264Encoder};
use super::frame::RawFrame;
use super::source::FrameSource;

pub struct MediaPipeline {
    source: Arc<dyn FrameSource>,
    latest: RwLock<Option<RawFrame>>,
    encoder: EncoderStatus,
    h264: RwLock<Option<H264Encoder>>,
    fps: u32,
    width: u32,
    height: u32,
    last_error: RwLock<Option<String>>,
    frames_ok: std::sync::atomic::AtomicU64,
    frames_err: std::sync::atomic::AtomicU64,
}

impl MediaPipeline {
    pub fn new(source: Arc<dyn FrameSource>, prefer_gpu: bool, fps: u32, width: u32, height: u32) -> Self {
        let encoder = resolve_encoder(prefer_gpu);
        let h264 = match H264Encoder::new(width, height) {
            Ok(e) => Some(e),
            Err(e) => {
                warn!(error = %e, "H264 encoder init failed; JPEG-only until fixed");
                None
            }
        };
        Self {
            source,
            latest: RwLock::new(None),
            encoder,
            h264: RwLock::new(h264),
            fps: fps.max(1),
            width,
            height,
            last_error: RwLock::new(None),
            frames_ok: std::sync::atomic::AtomicU64::new(0),
            frames_err: std::sync::atomic::AtomicU64::new(0),
        }
    }

    pub fn capture_health(&self) -> (bool, Option<String>, u64, u64) {
        let err = self.last_error.read().clone();
        let ok = self.frames_ok.load(std::sync::atomic::Ordering::Relaxed);
        let bad = self.frames_err.load(std::sync::atomic::Ordering::Relaxed);
        (self.latest_frame().is_some() && err.is_none(), err, ok, bad)
    }

    pub fn encoder_status(&self) -> &EncoderStatus {
        &self.encoder
    }

    pub fn source_label(&self) -> &str {
        self.source.label()
    }

    pub fn fps(&self) -> u32 {
        self.fps
    }

    pub fn dimensions(&self) -> (u32, u32) {
        (self.width, self.height)
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

    pub fn grab_h264(&self) -> Result<Vec<u8>> {
        let frame = self
            .latest
            .read()
            .clone()
            .or_else(|| self.source.next_frame().ok())
            .ok_or_else(|| anyhow::anyhow!("no frame"))?;
        let guard = self.h264.read();
        let enc = guard
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("h264 encoder unavailable"))?;
        enc.encode_frame(&frame)
    }

    pub fn has_h264(&self) -> bool {
        self.h264.read().is_some()
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
                        *pipe.last_error.write() = None;
                        pipe.frames_ok
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                    Err(e) => {
                        warn!(error = %e, "frame capture failed");
                        *pipe.last_error.write() = Some(e.to_string());
                        pipe.frames_err
                            .fetch_add(1, std::sync::atomic::Ordering::Relaxed);
                    }
                }
            }
        });
    }
}
