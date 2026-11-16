use std::sync::Arc;

use axum::extract::ws::{Message, WebSocket};
use axum::extract::{Query, State, WebSocketUpgrade};
use axum::response::IntoResponse;
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use tracing::debug;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct WsAuth {
    pub token: String,
}

#[derive(Deserialize)]
#[serde(tag = "type")]
pub enum InputMsg {
    #[serde(rename = "keydown")]
    KeyDown { code: String },
    #[serde(rename = "keyup")]
    KeyUp { code: String },
    #[serde(rename = "mousemove")]
    MouseMove {
        x: f64,
        y: f64,
        content_w: f64,
        content_h: f64,
        #[serde(default)]
        dx: i32,
        #[serde(default)]
        dy: i32,
    },
    #[serde(rename = "mousedown")]
    MouseDown { button: u8 },
    #[serde(rename = "mouseup")]
    MouseUp { button: u8 },
    #[serde(rename = "wheel")]
    Wheel { wheel: i8 },
    #[serde(rename = "release")]
    Release,
}

pub async fn ws_input(
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
    let (mut tx, mut rx) = socket.split();
    let _ = tx
        .send(Message::Text(r#"{"ok":true}"#.into()))
        .await;
    while let Some(Ok(msg)) = rx.next().await {
        let Message::Text(text) = msg else {
            continue;
        };
        let Ok(ev) = serde_json::from_str::<InputMsg>(&text) else {
            debug!(%text, "bad input ws message");
            continue;
        };
        let res = match ev {
            InputMsg::KeyDown { code } => state.hid.keydown(&code),
            InputMsg::KeyUp { code } => state.hid.keyup(&code),
            InputMsg::MouseMove {
                x,
                y,
                content_w,
                content_h,
                dx,
                dy,
            } => {
                if state.hid.absolute() {
                    state.hid.mouse_move_abs(content_w, content_h, x, y)
                } else {
                    state.hid.mouse_move_rel(dx, dy)
                }
            }
            InputMsg::MouseDown { button } => state.hid.mouse_button(button.max(1), true),
            InputMsg::MouseUp { button } => state.hid.mouse_button(button.max(1), false),
            InputMsg::Wheel { wheel } => state.hid.mouse_wheel(wheel),
            InputMsg::Release => state.hid.force_release_all(),
        };
        if let Err(e) = res {
            debug!(error = %e, "hid input error");
        }
    }
}
