//! kvm-core library: CH9329/ATX protocol, media pipeline, HTTP API.

pub mod api;
pub mod atx;
pub mod auth;
pub mod config;
pub mod hid;
pub mod media;
pub mod state;

pub use config::Config;
pub use state::AppState;
