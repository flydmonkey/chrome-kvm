use axum::http::HeaderMap;
use axum::Json;

use crate::state::AppState;

pub fn extract_token(headers: &HeaderMap) -> Option<String> {
    if let Some(auth) = headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(s) = auth.to_str() {
            if let Some(token) = s.strip_prefix("Bearer ") {
                return Some(token.to_string());
            }
        }
    }
    if let Some(cookie) = headers.get(axum::http::header::COOKIE) {
        if let Ok(s) = cookie.to_str() {
            for part in s.split(';') {
                let part = part.trim();
                if let Some(v) = part.strip_prefix("kvm_token=") {
                    return Some(v.to_string());
                }
            }
        }
    }
    None
}

pub fn require_auth(state: &AppState, headers: &HeaderMap) -> Result<(), (axum::http::StatusCode, Json<serde_json::Value>)> {
    let Some(token) = extract_token(headers) else {
        return Err((
            axum::http::StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        ));
    };
    if !state.auth.check(&token) {
        return Err((
            axum::http::StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({"error": "unauthorized"})),
        ));
    }
    Ok(())
}
