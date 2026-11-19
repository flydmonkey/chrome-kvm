pub mod capture;
pub mod encode;
pub mod frame;
pub mod pipeline;
pub mod source;
#[cfg(windows)]
pub mod windows_capture;

pub use capture::{list_serial_devices, list_video_devices, open_source};
pub use encode::{resolve_encoder, EncoderStatus, H264Encoder};
pub use frame::RawFrame;
pub use pipeline::MediaPipeline;
pub use source::{FrameSource, TestPatternSource};
