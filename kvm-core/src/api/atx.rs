use std::sync::Arc;
use std::time::Duration;

use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use tracing::warn;

use crate::atx::{command, normalize_channel, PressKind};
use crate::state::AppState;

use super::auth_util::require_auth;

#[derive(Deserialize)]
pub struct AtxReq {
    pub kind: String,
}

pub async fn press(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<AtxReq>,
) -> Result<Json<serde_json::Value>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;
    let Some(atx) = &state.atx else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "ATX not configured"})),
        ));
    };
    let Some(kind) = PressKind::from_str(&body.kind) else {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "kind must be short|long|reset"})),
        ));
    };
    if kind == PressKind::Reset && atx.reset_channel.is_none() {
        return Err((
            StatusCode::BAD_REQUEST,
            Json(serde_json::json!({"error": "reset_channel not configured"})),
        ));
    }
    let channel = match kind {
        PressKind::Reset => atx.reset_channel.unwrap_or(atx.channel),
        _ => normalize_channel(atx.channel),
    };

    {
        let mut busy = atx.busy.lock();
        if *busy {
            return Err((
                StatusCode::CONFLICT,
                Json(serde_json::json!({"error": "ATX busy"})),
            ));
        }
        *busy = true;
    }

    let port = atx.port.clone();
    let ms = kind.duration_ms();
    let result = tokio::task::spawn_blocking(move || press_blocking(&port, channel, ms)).await;

    if let Some(atx) = &state.atx {
        *atx.busy.lock() = false;
    }

    match result {
        Ok(Ok(())) => Ok(Json(serde_json::json!({"ok": true}))),
        Ok(Err(e)) => {
            warn!(error = %e, "ATX press failed");
            Err((
                StatusCode::BAD_GATEWAY,
                Json(serde_json::json!({"error": e.to_string()})),
            ))
        }
        Err(e) => Err((
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": e.to_string()})),
        )),
    }
}

fn press_blocking(port: &str, channel: u8, ms: u64) -> anyhow::Result<()> {
    if port == "mock" {
        std::thread::sleep(Duration::from_millis(ms.min(50)));
        return Ok(());
    }
    use std::io::Write;
    let mut serial = serialport::new(port, crate::atx::BAUD_RATE)
        .timeout(Duration::from_millis(200))
        .open()?;
    serial.write_all(&command(channel, true))?;
    serial.flush()?;
    std::thread::sleep(Duration::from_millis(ms));
    serial.write_all(&command(channel, false))?;
    serial.flush()?;
    Ok(())
}
