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
    Ok(Json(serde_json::json!({
        "video": {
            "source": state.media.source_label(),
            "ok": state.media.latest_frame().is_some(),
        },
        "serial": {
            "port": state.config.serial_port,
            "mock": state.mock_hid.is_some(),
            "absolute_mouse": state.hid.absolute(),
        },
        "encoder": {
            "kind": enc.kind,
            "gpu_available": enc.gpu_available,
            "message": enc.message,
        },
        "atx": state.atx.as_ref().map(|a| serde_json::json!({
            "port": a.port,
            "channel": a.channel,
            "reset_channel": a.reset_channel,
        })),
        "viewers": *state.viewers.lock(),
        "ai_panel": "hidden",
    })))
}
