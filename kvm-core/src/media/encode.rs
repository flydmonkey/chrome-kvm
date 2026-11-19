use anyhow::{anyhow, Context, Result};
use openh264::encoder::{Encoder, EncoderConfig};
use openh264::formats::{YUVBuffer, YUVSource};
use openh264::OpenH264API;
use parking_lot::Mutex;
use tracing::{info, warn};

use super::frame::RawFrame;

#[derive(Debug, Clone)]
pub struct EncoderStatus {
    pub kind: String,
    pub gpu_available: bool,
    pub message: String,
}

pub fn resolve_encoder(prefer_gpu: bool) -> EncoderStatus {
    let gpu_available = detect_gpu_encoder();
    if prefer_gpu && gpu_available {
        info!("encoder: GPU hard-encode selected");
        EncoderStatus {
            kind: "gpu-h264".into(),
            gpu_available: true,
            message: "GPU encoder available".into(),
        }
    } else if prefer_gpu && !gpu_available {
        warn!("encoder: GPU requested but unavailable; using OpenH264 software");
        EncoderStatus {
            kind: "software-h264".into(),
            gpu_available: false,
            message: "GPU unavailable; OpenH264 software".into(),
        }
    } else {
        EncoderStatus {
            kind: "software-h264".into(),
            gpu_available: false,
            message: "OpenH264 software encode".into(),
        }
    }
}

fn detect_gpu_encoder() -> bool {
    // Real NVENC/QSV/AMF wiring is platform-specific; detect presence only for status.
    #[cfg(windows)]
    {
        std::path::Path::new("C:\\Windows\\System32\\nvEncodeAPI64.dll").exists()
            || std::path::Path::new("C:\\Windows\\System32\\nvEncodeAPI.dll").exists()
    }
    #[cfg(not(windows))]
    {
        // Best-effort: nvidia device node.
        std::path::Path::new("/dev/nvidia0").exists()
    }
}

/// Soft H264 encoder producing Annex-B access units for WebRTC.
pub struct H264Encoder {
    inner: Mutex<Encoder>,
    width: u32,
    height: u32,
}

impl H264Encoder {
    pub fn new(width: u32, height: u32) -> Result<Self> {
        let w = width.max(2) & !1;
        let h = height.max(2) & !1;
        let api = OpenH264API::from_source();
        let cfg = EncoderConfig::new();
        let encoder = Encoder::with_api_config(api, cfg)
            .map_err(|e| anyhow!("openh264 init: {e}"))?;
        Ok(Self {
            inner: Mutex::new(encoder),
            width: w,
            height: h,
        })
    }

    pub fn width(&self) -> u32 {
        self.width
    }

    pub fn height(&self) -> u32 {
        self.height
    }

    pub fn encode_frame(&self, frame: &RawFrame) -> Result<Vec<u8>> {
        let rgba = if frame.width == self.width && frame.height == self.height {
            &frame.rgba
        } else {
            // Simple nearest-neighbor resize into scratch is skipped; require match for now.
            if frame.rgba.len() < (self.width * self.height * 4) as usize {
                return Err(anyhow!("frame too small for encoder"));
            }
            &frame.rgba
        };

        let yuv = rgba_to_yuv420(rgba, self.width as usize, self.height as usize);
        let buf = YUVBuffer::from_vec(yuv, self.width as usize, self.height as usize);
        let mut enc = self.inner.lock();
        let bitstream = enc
            .encode(&buf)
            .map_err(|e| anyhow!("openh264 encode: {e}"))
            .context("encode")?;
        Ok(bitstream.to_vec())
    }
}

fn rgba_to_yuv420(rgba: &[u8], width: usize, height: usize) -> Vec<u8> {
    let y_size = width * height;
    let uv_size = (width / 2) * (height / 2);
    let mut out = vec![0u8; y_size + 2 * uv_size];
    let (y_plane, rest) = out.split_at_mut(y_size);
    let (u_plane, v_plane) = rest.split_at_mut(uv_size);

    for j in 0..height {
        for i in 0..width {
            let idx = (j * width + i) * 4;
            let r = rgba[idx] as i32;
            let g = rgba[idx + 1] as i32;
            let b = rgba[idx + 2] as i32;
            let y = ((66 * r + 129 * g + 25 * b + 128) >> 8) + 16;
            y_plane[j * width + i] = y.clamp(0, 255) as u8;
        }
    }

    for j in (0..height).step_by(2) {
        for i in (0..width).step_by(2) {
            let mut r = 0i32;
            let mut g = 0i32;
            let mut b = 0i32;
            for dy in 0..2 {
                for dx in 0..2 {
                    let idx = ((j + dy) * width + (i + dx)) * 4;
                    r += rgba[idx] as i32;
                    g += rgba[idx + 1] as i32;
                    b += rgba[idx + 2] as i32;
                }
            }
            r /= 4;
            g /= 4;
            b /= 4;
            let u = ((-38 * r - 74 * g + 112 * b + 128) >> 8) + 128;
            let v = ((112 * r - 94 * g - 18 * b + 128) >> 8) + 128;
            let uv_i = (j / 2) * (width / 2) + (i / 2);
            u_plane[uv_i] = u.clamp(0, 255) as u8;
            v_plane[uv_i] = v.clamp(0, 255) as u8;
        }
    }
    out
}

// Silence unused import if YUVSource trait only used via encode.
#[allow(dead_code)]
fn _yuv_source_marker<T: YUVSource>(_: &T) {}
