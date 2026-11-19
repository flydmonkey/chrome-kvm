use std::sync::Arc;

use axum::http::HeaderMap;
use axum::Json;

use crate::state::AppState;

use super::auth_util::require_auth;

pub async fn status(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    let enc = state.media.encoder_status();
    let (video_ok, video_err, frames_ok, frames_err) = state.media.capture_health();
    let cfg = state.config.read();
    Ok(Json(serde_json::json!({
        "video": {
            "source": state.media.source_label(),
            "ok": video_ok,
            "error": video_err,
            "frames_ok": frames_ok,
            "frames_err": frames_err,
        },
        "serial": {
            "port": cfg.serial_port,
            "mock": state.mock_hid.is_some(),
            "absolute_mouse": state.hid.absolute(),
            "ok": state.mock_hid.is_some() || cfg.serial_port.is_some(),
        },
        "encoder": {
            "kind": enc.kind,
            "gpu_available": enc.gpu_available,
            "message": enc.message,
            "h264": state.media.has_h264(),
        },
        "atx": state.atx.as_ref().map(|a| serde_json::json!({
            "port": a.port,
            "channel": a.channel,
            "reset_channel": a.reset_channel,
        })),
        "viewers": *state.viewers.lock(),
        "input_locked": state.input_locked(),
        "ai_panel": "hidden",
    })))
}
