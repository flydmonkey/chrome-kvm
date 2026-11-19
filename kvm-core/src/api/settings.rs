use std::sync::Arc;

use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;

use crate::state::AppState;

use super::auth_util::require_auth;

#[derive(Deserialize, Default)]
pub struct SettingsPatch {
    pub video_source: Option<String>,
    pub serial_port: Option<String>,
    pub baud: Option<u32>,
    pub mouse_absolute: Option<bool>,
    pub prefer_gpu_encode: Option<bool>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub fps: Option<u32>,
    pub bitrate_kbps: Option<u32>,
    pub password: Option<String>,
    pub input_locked: Option<bool>,
}

pub async fn get_settings(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    let cfg = state.config.read();
    let mut v = cfg.public_view();
    if let Some(obj) = v.as_object_mut() {
        obj.insert(
            "input_locked".into(),
            serde_json::json!(state.input_locked()),
        );
        obj.insert(
            "restart_note".into(),
            serde_json::json!("Changing video/serial/resolution requires process restart"),
        );
    }
    Ok(Json(v))
}

pub async fn patch_settings(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<SettingsPatch>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;

    let mut restart_required = false;
    {
        let mut cfg = state.config.write();
        if let Some(v) = body.video_source {
            cfg.video_source = v;
            restart_required = true;
        }
        if let Some(v) = body.serial_port {
            cfg.serial_port = Some(v);
            restart_required = true;
        }
        if let Some(v) = body.baud {
            cfg.baud = v;
            restart_required = true;
        }
        if let Some(v) = body.mouse_absolute {
            cfg.mouse_absolute = v;
            state.hid.set_absolute(v);
        }
        if let Some(v) = body.prefer_gpu_encode {
            cfg.prefer_gpu_encode = v;
            restart_required = true;
        }
        if let Some(v) = body.width {
            cfg.width = v;
            restart_required = true;
        }
        if let Some(v) = body.height {
            cfg.height = v;
            restart_required = true;
        }
        if let Some(v) = body.fps {
            cfg.fps = v;
            restart_required = true;
        }
        if let Some(v) = body.bitrate_kbps {
            cfg.bitrate_kbps = v;
        }
        if let Some(p) = body.password {
            if !p.is_empty() {
                match crate::auth::hash_password(&p) {
                    Ok(h) => {
                        cfg.password = None;
                        cfg.password_hash = Some(h);
                    }
                    Err(e) => {
                        return Err((
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({"error": e.to_string()})),
                        ));
                    }
                }
            }
        }
        if let Err(e) = cfg.save(&state.config_path) {
            return Err((
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(serde_json::json!({"error": e.to_string()})),
            ));
        }
    }

    if let Some(locked) = body.input_locked {
        state.set_input_locked(locked);
    }

    Ok(Json(serde_json::json!({
        "ok": true,
        "restart_required": restart_required,
        "settings": state.config.read().public_view(),
        "input_locked": state.input_locked(),
    })))
}
