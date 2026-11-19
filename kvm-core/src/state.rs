use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use parking_lot::{Mutex, RwLock};

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
    pub config: RwLock<Config>,
    pub config_path: PathBuf,
    pub auth: Auth,
    pub media: Arc<MediaPipeline>,
    pub hid: Arc<HidService>,
    pub mock_hid: Option<Arc<MockHid>>,
    pub atx: Option<AtxRuntime>,
    pub viewers: Mutex<u32>,
    /// When true, human WS/REST input is ignored (reserved for AI takeover).
    pub input_locked: AtomicBool,
}

impl AppState {
    pub fn input_locked(&self) -> bool {
        self.input_locked.load(Ordering::Relaxed)
    }

    pub fn set_input_locked(&self, locked: bool) {
        self.input_locked.store(locked, Ordering::Relaxed);
    }
}
