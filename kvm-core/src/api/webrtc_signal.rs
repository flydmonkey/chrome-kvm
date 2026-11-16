//! WebRTC signaling with JPEG frames on DataChannel `video`.
//! Prefer GPU/RTP H264 later via the same endpoint; status reports encoder preference.

use std::sync::Arc;
use std::time::Duration;

use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use tracing::{info, warn};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::MediaEngine;
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_state::RTCDataChannelState;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;

use crate::state::AppState;

use super::auth_util::require_auth;

#[derive(Deserialize)]
pub struct OfferReq {
    pub sdp: String,
}

#[derive(serde::Serialize)]
pub struct AnswerResp {
    pub sdp: String,
    pub r#type: String,
}

pub async fn offer(
    axum::extract::State(state): axum::extract::State<Arc<AppState>>,
    headers: HeaderMap,
    Json(body): Json<OfferReq>,
) -> Result<Json<AnswerResp>, (StatusCode, Json<serde_json::Value>)> {
    require_auth(&state, &headers)?;

    let mut m = MediaEngine::default();
    m.register_default_codecs().map_err(internal)?;
    let mut registry = Registry::new();
    registry = register_default_interceptors(registry, &mut m).map_err(internal)?;
    let api = APIBuilder::new()
        .with_media_engine(m)
        .with_interceptor_registry(registry)
        .build();

    let config = RTCConfiguration {
        ice_servers: vec![RTCIceServer {
            urls: vec!["stun:stun.l.google.com:19302".into()],
            ..Default::default()
        }],
        ..Default::default()
    };

    let pc = Arc::new(api.new_peer_connection(config).await.map_err(internal)?);

    let dc = pc
        .create_data_channel(
            "video",
            Some(RTCDataChannelInit {
                ordered: Some(true),
                ..Default::default()
            }),
        )
        .await
        .map_err(internal)?;

    let media = Arc::clone(&state.media);
    let fps = state.config.fps.max(1);
    info!(
        encoder = %state.media.encoder_status().kind,
        "WebRTC DataChannel video (JPEG); GPU RTP path reserved"
    );

    {
        let dc = Arc::clone(&dc);
        let pc_watch = Arc::clone(&pc);
        tokio::spawn(async move {
            for _ in 0..100 {
                if dc.ready_state() == RTCDataChannelState::Open {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let interval = Duration::from_millis(1000 / u64::from(fps));
            let mut ticker = tokio::time::interval(interval);
            loop {
                ticker.tick().await;
                if dc.ready_state() != RTCDataChannelState::Open {
                    break;
                }
                match media.grab_jpeg() {
                    Ok(jpeg) => {
                        if dc.send(&bytes::Bytes::from(jpeg)).await.is_err() {
                            break;
                        }
                    }
                    Err(e) => warn!(error = %e, "webrtc frame grab failed"),
                }
            }
            let _ = pc_watch.close().await;
        });
    }

    let offer = RTCSessionDescription::offer(body.sdp).map_err(internal)?;
    pc.set_remote_description(offer).await.map_err(internal)?;
    let answer = pc.create_answer(None).await.map_err(internal)?;
    let mut gather_complete = pc.gathering_complete_promise().await;
    pc.set_local_description(answer).await.map_err(internal)?;
    let _ = gather_complete.recv().await;

    let local = pc.local_description().await.ok_or_else(|| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(serde_json::json!({"error": "no local description"})),
        )
    })?;

    // Keep PC alive until datachannel task closes it
    std::mem::forget(Arc::clone(&pc));

    Ok(Json(AnswerResp {
        sdp: local.sdp,
        r#type: local.sdp_type.to_string(),
    }))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
}
