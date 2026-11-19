//! WebRTC: H264 RTP video track when encoder is available; JPEG DataChannel fallback.

use std::sync::Arc;
use std::time::Duration;

use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use serde::Deserialize;
use tracing::{info, warn};
use webrtc::api::interceptor_registry::register_default_interceptors;
use webrtc::api::media_engine::{MediaEngine, MIME_TYPE_H264};
use webrtc::api::APIBuilder;
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::data_channel_state::RTCDataChannelState;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::interceptor::registry::Registry;
use webrtc::media::Sample;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::rtp_transceiver::rtp_codec::RTCRtpCodecCapability;
use webrtc::track::track_local::track_local_static_sample::TrackLocalStaticSample;
use webrtc::track::track_local::TrackLocal;

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
    pub mode: String,
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
    let media = Arc::clone(&state.media);
    let fps = state.media.fps();
    let use_h264 = state.media.has_h264();

    let mode = if use_h264 {
        let video_track = Arc::new(TrackLocalStaticSample::new(
            RTCRtpCodecCapability {
                mime_type: MIME_TYPE_H264.to_owned(),
                ..Default::default()
            },
            "video".to_owned(),
            "kvm".to_owned(),
        ));
        pc.add_track(Arc::clone(&video_track) as Arc<dyn TrackLocal + Send + Sync>)
            .await
            .map_err(internal)?;

        info!(
            encoder = %state.media.encoder_status().kind,
            "WebRTC H264 RTP track"
        );

        let pc_watch = Arc::clone(&pc);
        tokio::spawn(async move {
            let interval = Duration::from_millis(1000 / u64::from(fps.max(1)));
            let mut ticker = tokio::time::interval(interval);
            // Give peer a moment to finish answer/ICE
            tokio::time::sleep(Duration::from_millis(200)).await;
            loop {
                ticker.tick().await;
                match media.grab_h264() {
                    Ok(au) => {
                        if video_track
                            .write_sample(&Sample {
                                data: bytes::Bytes::from(au),
                                duration: interval,
                                ..Default::default()
                            })
                            .await
                            .is_err()
                        {
                            break;
                        }
                    }
                    Err(e) => warn!(error = %e, "h264 encode failed"),
                }
            }
            let _ = pc_watch.close().await;
        });
        "h264-rtp"
    } else {
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

        info!("WebRTC DataChannel JPEG fallback");
        let pc_watch = Arc::clone(&pc);
        tokio::spawn(async move {
            for _ in 0..100 {
                if dc.ready_state() == RTCDataChannelState::Open {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            let interval = Duration::from_millis(1000 / u64::from(fps.max(1)));
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
                    Err(e) => warn!(error = %e, "jpeg grab failed"),
                }
            }
            let _ = pc_watch.close().await;
        });
        "jpeg-dc"
    };

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

    std::mem::forget(Arc::clone(&pc));

    Ok(Json(AnswerResp {
        sdp: local.sdp,
        r#type: local.sdp_type.to_string(),
        mode: mode.into(),
    }))
}

fn internal(e: impl std::fmt::Display) -> (StatusCode, Json<serde_json::Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(serde_json::json!({"error": e.to_string()})),
    )
}
