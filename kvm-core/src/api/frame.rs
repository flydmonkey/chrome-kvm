use std::sync::Arc;

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;

use crate::state::AppState;

use super::auth_util::require_auth;

pub async fn grab_frame(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    match state.media.grab_jpeg() {
        Ok(bytes) => Ok((
            StatusCode::OK,
            [(header::CONTENT_TYPE, "image/jpeg")],
            bytes,
        )),
        Err(e) => Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(serde_json::json!({"error": e.to_string()})),
        )),
    }
}
