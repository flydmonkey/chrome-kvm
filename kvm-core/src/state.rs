use std::sync::Arc;

use parking_lot::Mutex;

use crate::auth::Auth;
use crate::config::Config;
use crate::hid::{HidService, MockHid};
use crate::media::MediaPipeline;

pub struct AtxRuntime {
    pub port: String,
    pub channel: u8,
    pub reset_channel: Option<u8>,
    pub busy: Mutex<bool>,
}

pub struct AppState {
    pub config: Config,
    pub auth: Auth,
    pub media: Arc<MediaPipeline>,
    pub hid: Arc<HidService>,
    pub mock_hid: Option<Arc<MockHid>>,
    pub atx: Option<AtxRuntime>,
    /// Shared latest JPEG for WS/WebRTC fan-out.
    pub viewers: Mutex<u32>,
}
