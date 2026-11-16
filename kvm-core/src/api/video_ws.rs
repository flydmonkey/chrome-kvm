use std::sync::Arc;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct WsAuth {
    pub token: String,
}

/// Low-latency LAN video: JPEG frames over WebSocket (used as WebRTC DataChannel fallback path too).
pub async fn ws_video(
    ws: WebSocketUpgrade,
    State(state): State<Arc<AppState>>,
    Query(q): Query<WsAuth>,
) -> impl IntoResponse {
    if !state.auth.check(&q.token) {
        return axum::http::StatusCode::UNAUTHORIZED.into_response();
    }
    ws.on_upgrade(move |socket| handle(socket, state))
}

async fn handle(socket: WebSocket, state: Arc<AppState>) {
    *state.viewers.lock() += 1;
    let (mut tx, mut rx) = socket.split();
    let fps = state.config.fps.max(1);
    let interval = Duration::from_millis(1000 / u64::from(fps));
    let mut ticker = tokio::time::interval(interval);

    let send_loop = async {
        loop {
            ticker.tick().await;
            match state.media.grab_jpeg() {
                Ok(jpeg) => {
                    if tx.send(Message::Binary(jpeg.into())).await.is_err() {
                        break;
                    }
                }
                Err(_) => {
                    if tx
                        .send(Message::Text(r#"{"error":"no frame"}"#.into()))
                        .await
                        .is_err()
                    {
                        break;
                    }
                }
            }
        }
    };

    let recv_loop = async {
        while let Some(Ok(msg)) = rx.next().await {
            if matches!(msg, Message::Close(_)) {
                break;
            }
        }
    };

    tokio::select! {
        _ = send_loop => {}
        _ = recv_loop => {}
    }

    let mut v = state.viewers.lock();
    *v = v.saturating_sub(1);
}
