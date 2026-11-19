mod atx;
mod auth_routes;
mod auth_util;
mod devices;
mod frame;
mod input;
mod status;
mod video_ws;
mod webrtc_signal;
mod ws_input;

use std::sync::Arc;

use axum::response::Redirect;
use axum::routing::{get, post};
use axum::Router;
use tower_http::services::ServeDir;

use crate::state::AppState;

pub fn router(state: Arc<AppState>, web_dir: std::path::PathBuf) -> Router {
    Router::new()
        .route("/", get(|| async { Redirect::temporary("/login.html") }))
        .route("/api/login", post(auth_routes::login))
        .route("/api/logout", post(auth_routes::logout))
        .route("/api/status", get(status::status))
        .route("/api/devices", get(devices::devices))
        .route("/api/frame.jpg", get(frame::grab_frame))
        .route("/api/input/key", post(input::key))
        .route("/api/input/mouse", post(input::mouse))
        .route("/api/input/release", post(input::release_all))
        .route("/api/atx/press", post(atx::press))
        .route("/api/ws/input", get(ws_input::ws_input))
        .route("/api/ws/video", get(video_ws::ws_video))
        .route("/api/webrtc/offer", post(webrtc_signal::offer))
        .fallback_service(ServeDir::new(web_dir))
        .with_state(state)
}
