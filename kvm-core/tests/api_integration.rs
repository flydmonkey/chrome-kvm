use std::sync::Arc;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use http_body_util::BodyExt;
use kvm_core::auth::Auth;
use kvm_core::config::Config;
use kvm_core::hid::{HidService, MockHid};
use kvm_core::media::{MediaPipeline, TestPatternSource};
use kvm_core::state::AppState;
use parking_lot::Mutex;
use tower::ServiceExt;

fn test_app() -> (axum::Router, Arc<MockHid>, Arc<MediaPipeline>) {
    let mut config = Config::default();
    config.password = Some("secret".into());
    config.password_hash = None;
    config.serial_port = Some("mock".into());
    config.atx = Some(kvm_core::config::AtxConfig {
        port: "mock".into(),
        channel: 1,
        reset_channel: Some(2),
    });
    let auth = Auth::from_config(&config).unwrap();
    let source = Arc::new(TestPatternSource::new(64, 48));
    let media = Arc::new(MediaPipeline::new(source, false, 5, 64, 48));
    let mock = Arc::new(MockHid::new());
    let hid = Arc::new(HidService::new(mock.clone(), true));
    let state = Arc::new(AppState {
        config,
        auth,
        media: Arc::clone(&media),
        hid,
        mock_hid: Some(mock.clone()),
        atx: Some(kvm_core::state::AtxRuntime {
            port: "mock".into(),
            channel: 1,
            reset_channel: Some(2),
            busy: Mutex::new(false),
        }),
        viewers: Mutex::new(0),
    });
    let web = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web");
    (kvm_core::api::router(state, web), mock, media)
}

#[tokio::test]
async fn login_status_frame_and_key() {
    let (app, mock, media) = test_app();
    media.spawn_capture_loop();
    tokio::time::sleep(std::time::Duration::from_millis(50)).await;

    let login = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/login")
                .header("content-type", "application/json")
                .body(Body::from(r#"{"username":"admin","password":"secret"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(login.status(), StatusCode::OK);
    let body = login.into_body().collect().await.unwrap().to_bytes();
    let v: serde_json::Value = serde_json::from_slice(&body).unwrap();
    let token = v["token"].as_str().unwrap();

    let status = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/status")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(status.status(), StatusCode::OK);

    let frame = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/api/frame.jpg")
                .header("authorization", format!("Bearer {token}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(frame.status(), StatusCode::OK);

    let key = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/api/input/key")
                .header("authorization", format!("Bearer {token}"))
                .header("content-type", "application/json")
                .body(Body::from(r#"{"action":"down","code":"KeyA"}"#))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(key.status(), StatusCode::OK);
    let packets = mock.take_packets();
    assert!(!packets.is_empty());
    assert_eq!(hex::encode(&packets[0]), "57ab000208000004000000000010");
}
