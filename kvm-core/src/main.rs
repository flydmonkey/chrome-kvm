use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use anyhow::Context;
use kvm_core::auth::Auth;
use kvm_core::config::Config;
use kvm_core::hid::open_hid;
use kvm_core::media::{open_source, MediaPipeline};
use kvm_core::state::{AppState, AtxRuntime};
use parking_lot::Mutex;
use tracing::info;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "kvm_core=info,tower_http=info".into()),
        )
        .init();

    let config_path = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .or_else(|| {
            let p = PathBuf::from("kvm-core.config.json");
            if p.exists() {
                Some(p)
            } else {
                None
            }
        });

    let (config, used_path) = if let Some(p) = config_path {
        (Config::load(&p)?, p)
    } else {
        Config::load_or_default(None)?
    };
    info!(path = %used_path.display(), "loaded config");

    let auth = Auth::from_config(&config)?;
    let source = open_source(
        &config.video_source,
        config.width,
        config.height,
        config.fps,
    )?;

    let media = Arc::new(MediaPipeline::new(
        source,
        config.prefer_gpu_encode,
        config.fps,
        config.width,
        config.height,
    ));
    media.spawn_capture_loop();

    let (hid, mock_hid) = open_hid(
        config.serial_port.as_deref(),
        config.baud,
        config.mouse_absolute,
    )?;

    let atx = config.atx.as_ref().map(|a| AtxRuntime {
        port: a.port.clone(),
        channel: a.channel,
        reset_channel: a.reset_channel,
        busy: Mutex::new(false),
    });

    let state = Arc::new(AppState {
        config: config.clone(),
        auth,
        media,
        hid,
        mock_hid,
        atx,
        viewers: Mutex::new(0),
    });

    let web_dir = web_dir()?;
    let app = kvm_core::api::router(state, web_dir);

    let addr: SocketAddr = config
        .listen
        .parse()
        .with_context(|| format!("parse listen {}", config.listen))?;
    info!(%addr, "kvm-core listening");
    let listener = tokio::net::TcpListener::bind(addr).await?;
    axum::serve(listener, app).await?;
    Ok(())
}

fn web_dir() -> anyhow::Result<PathBuf> {
    let candidates = [
        PathBuf::from("web"),
        PathBuf::from("kvm-core/web"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("web"),
    ];
    for c in candidates {
        if c.join("login.html").exists() {
            return Ok(c);
        }
    }
    anyhow::bail!("web UI not found (expected web/login.html)")
}
