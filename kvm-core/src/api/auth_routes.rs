use std::sync::Arc;

use axum::http::{header, HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::Json;
use serde::Deserialize;

use crate::state::AppState;

use super::auth_util::extract_token;

#[derive(Deserialize)]
pub struct LoginReq {
    pub username: String,
    pub password: String,
}

pub async fn login(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    Json(body): Json<LoginReq>,
) -> impl IntoResponse {
    match state.auth.login(&body.username, &body.password) {
        Ok(token) => {
            let cookie = format!(
                "kvm_token={token}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
                12 * 3600
            );
            (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie)],
                Json(serde_json::json!({ "token": token })),
            )
                .into_response()
        }
        Err(_) => (
            StatusCode::UNAUTHORIZED,
            Json(serde_json::json!({ "error": "invalid credentials" })),
        )
            .into_response(),
    }
}

pub async fn logout(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(token) = extract_token(&headers) {
        state.auth.logout(&token);
    }
    (
        StatusCode::OK,
        [(
            header::SET_COOKIE,
            "kvm_token=; Path=/; Max-Age=0".to_string(),
        )],
        Json(serde_json::json!({ "ok": true })),
    )
}
