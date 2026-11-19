use std::sync::Arc;

use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::state::AppState;

use super::auth_util::require_auth;

#[derive(Deserialize)]
pub struct KeyReq {
    pub action: String,
    pub code: String,
}

#[derive(Deserialize)]
pub struct MouseReq {
    pub action: String,
    #[serde(default)]
    pub x: f64,
    #[serde(default)]
    pub y: f64,
    #[serde(default)]
    pub content_w: f64,
    #[serde(default)]
    pub content_h: f64,
    #[serde(default)]
    pub dx: i32,
    #[serde(default)]
    pub dy: i32,
    #[serde(default)]
    pub button: u8,
    #[serde(default)]
    pub wheel: i8,
}

fn reject_if_locked(
    state: &AppState,
) -> Result<(), (StatusCode, Json<serde_json::Value>)> {
    if state.input_locked() {
        Err((
            StatusCode::LOCKED,
            Json(serde_json::json!({"error": "input locked"})),
        ))
    } else {
        Ok(())
    }
}

pub async fn key(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<KeyReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    reject_if_locked(&state)?;
    let result = match body.action.as_str() {
        "down" => state.hid.keydown(&body.code),
        "up" => state.hid.keyup(&body.code),
        _ => Err(anyhow::anyhow!("action must be down|up")),
    };
    map_hid(result)
}

pub async fn mouse(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<MouseReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    reject_if_locked(&state)?;
    let result = match body.action.as_str() {
        "move_abs" => state
            .hid
            .mouse_move_abs(body.content_w, body.content_h, body.x, body.y),
        "move_rel" => state.hid.mouse_move_rel(body.dx, body.dy),
        "down" => state.hid.mouse_button(body.button.max(1), true),
        "up" => state.hid.mouse_button(body.button.max(1), false),
        "wheel" => state.hid.mouse_wheel(body.wheel),
        _ => Err(anyhow::anyhow!(
            "action must be move_abs|move_rel|down|up|wheel"
        )),
    };
    map_hid(result)
}

pub async fn release_all(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    // release always allowed (safety)
    map_hid(state.hid.force_release_all())
}

fn map_hid(
    result: anyhow::Result<()>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    match result {
        Ok(()) => Ok(Json(serde_json::json!({"ok": true}))),
        Err(e) => Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": e.to_string()})),
        )),
    }
}
