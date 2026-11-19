use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use parking_lot::RwLock;
use tracing::warn;

use super::encode::{resolve_encoder, EncoderStatus, H264Encoder};
use super::ffmpeg_encode::{pick_ffmpeg_h264_encoder, FfmpegH264Encoder};
use super::frame::RawFrame;
use super::source::FrameSource;

enum Backend {
    OpenH264(H264Encoder),
    Ffmpeg(FfmpegH264Encoder),
}

pub struct MediaPipeline {
    source: Arc<dyn FrameSource>,
    latest: RwLock<Option<RawFrame>>,
    encoder: EncoderStatus,
    backend: RwLock<Option<Backend>>,
    fps: u32,
    width: u32,
    height: u32,
    last_error: RwLock<Option<String>>,
    frames_ok: AtomicU64,
    frames_err: AtomicU64,
}

impl MediaPipeline {
    pub fn new(
        source: Arc<dyn FrameSource>,
        prefer_gpu: bool,
        fps: u32,
        width: u32,
        height: u32,
    ) -> Self {
        let mut encoder = resolve_encoder(prefer_gpu);
        let backend = if prefer_gpu && pick_ffmpeg_h264_encoder(true).is_some() {
            match FfmpegH264Encoder::open(width, height, fps, true) {
                Ok(ff) => {
                    encoder.kind = format!("ffmpeg-{}", ff.codec());
                    encoder.message = format!("ffmpeg {}", ff.codec());
                    encoder.gpu_available = !ff.codec().starts_with("lib");
                    Some(Backend::Ffmpeg(ff))
                }
                Err(e) => {
                    warn!(error = %e, "ffmpeg encoder failed; trying OpenH264");
                    H264Encoder::new(width, height)
                        .ok()
                        .map(Backend::OpenH264)
                }
            }
        } else {
            match H264Encoder::new(width, height) {
                Ok(e) => Some(Backend::OpenH264(e)),
                Err(e) => {
                    warn!(error = %e, "H264 encoder init failed; JPEG-only until fixed");
                    None
                }
            }
        };

        Self {
            source,
            latest: RwLock::new(None),
            encoder,
            backend: RwLock::new(backend),
            fps: fps.max(1),
            width,
            height,
            last_error: RwLock::new(None),
            frames_ok: AtomicU64::new(0),
            frames_err: AtomicU64::new(0),
        }
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

    pub fn capture_health(&self) -> (bool, Option<String>, u64, u64) {
        let err = self.last_error.read().clone();
        let ok = self.frames_ok.load(Ordering::Relaxed);
        let bad = self.frames_err.load(Ordering::Relaxed);
        (self.latest_frame().is_some() && err.is_none(), err, ok, bad)
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
        let guard = self.backend.read();
        match guard.as_ref() {
            Some(Backend::OpenH264(e)) => e.encode_frame(&frame),
            Some(Backend::Ffmpeg(e)) => e.encode_frame(&frame),
            None => Err(anyhow::anyhow!("h264 encoder unavailable")),
        }
    }

    pub fn has_h264(&self) -> bool {
        self.backend.read().is_some()
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
                        pipe.frames_ok.fetch_add(1, Ordering::Relaxed);
                    }
                    Err(e) => {
                        warn!(error = %e, "frame capture failed");
                        *pipe.last_error.write() = Some(e.to_string());
                        pipe.frames_err.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        });
    }
}
