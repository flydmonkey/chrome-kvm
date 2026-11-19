use std::sync::Arc;

use axum::http::HeaderMap;
use axum::Json;

use crate::media::{list_serial_devices, list_video_devices};
use crate::state::AppState;

use super::auth_util::require_auth;

pub async fn devices(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (axum::http::StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    let cfg = state.config.read();
    Ok(Json(serde_json::json!({
        "video": list_video_devices(),
        "serial": list_serial_devices(),
        "current": {
            "video_source": cfg.video_source,
            "serial_port": cfg.serial_port,
        }
    })))
}
