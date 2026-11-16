use tracing::{info, warn};

/// Encode preference from config; GPU path is stubbed until platform encoder is wired.
#[derive(Debug, Clone, Copy)]
pub enum EncoderKind {
    SoftwareJpeg,
    GpuPreferred,
}

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
            kind: "gpu".into(),
            gpu_available: true,
            message: "GPU encoder available".into(),
        }
    } else if prefer_gpu && !gpu_available {
        warn!("encoder: GPU requested but unavailable; falling back to software");
        EncoderStatus {
            kind: "software".into(),
            gpu_available: false,
            message: "GPU unavailable; software fallback".into(),
        }
    } else {
        EncoderStatus {
            kind: "software".into(),
            gpu_available: false,
            message: "software encode".into(),
        }
    }
}

fn detect_gpu_encoder() -> bool {
    // Phase-1: detection hooks only. Real NVENC/QSV/AMF wiring is platform-specific.
    #[cfg(windows)]
    {
        // Placeholder: treat presence of common NVIDIA device string as hint (best-effort).
        false
    }
    #[cfg(not(windows))]
    {
        false
    }
}
