use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use parking_lot::Mutex;
use tracing::{info, warn};

use super::service::{HidBackend, SerialHid};

/// Serial backend that re-opens the port after write failures.
pub struct ReconnectingSerial {
    path: String,
    baud: u32,
    inner: Mutex<Option<SerialHid>>,
    last_error: Mutex<Option<String>>,
    last_ok: Mutex<Option<Instant>>,
    cooldown: Mutex<Option<Instant>>,
}

impl ReconnectingSerial {
    pub fn open(path: &str, baud: u32) -> Result<Self> {
        let serial = SerialHid::open(path, baud)?;
        Ok(Self {
            path: path.to_string(),
            baud,
            inner: Mutex::new(Some(serial)),
            last_error: Mutex::new(None),
            last_ok: Mutex::new(Some(Instant::now())),
            cooldown: Mutex::new(None),
        })
    }

    pub fn last_error(&self) -> Option<String> {
        self.last_error.lock().clone()
    }

    pub fn healthy(&self) -> bool {
        self.inner.lock().is_some() && self.last_error.lock().is_none()
    }

    fn try_reopen(&self) -> Result<()> {
        if let Some(until) = *self.cooldown.lock() {
            if Instant::now() < until {
                return Err(anyhow!("serial reconnect cooling down"));
            }
        }
        match SerialHid::open(&self.path, self.baud) {
            Ok(s) => {
                *self.inner.lock() = Some(s);
                *self.last_error.lock() = None;
                *self.last_ok.lock() = Some(Instant::now());
                info!(path = %self.path, "serial reconnected");
                Ok(())
            }
            Err(e) => {
                *self.cooldown.lock() = Some(Instant::now() + Duration::from_secs(2));
                *self.last_error.lock() = Some(e.to_string());
                Err(e)
            }
        }
    }
}

impl HidBackend for ReconnectingSerial {
    fn write_packet(&self, packet: &[u8]) -> Result<()> {
        // Ensure we have a port
        if self.inner.lock().is_none() {
            self.try_reopen()?;
        }
        let result = {
            let guard = self.inner.lock();
            match guard.as_ref() {
                Some(s) => s.write_packet(packet),
                None => Err(anyhow!("serial not open")),
            }
        };
        match result {
            Ok(()) => {
                *self.last_error.lock() = None;
                *self.last_ok.lock() = Some(Instant::now());
                Ok(())
            }
            Err(e) => {
                warn!(error = %e, path = %self.path, "serial write failed; reconnecting");
                *self.last_error.lock() = Some(e.to_string());
                *self.inner.lock() = None;
                self.try_reopen()?;
                let guard = self.inner.lock();
                let s = guard.as_ref().ok_or_else(|| anyhow!("serial reconnect failed"))?;
                s.write_packet(packet)
            }
        }
    }
}

pub type SharedReconnect = Arc<ReconnectingSerial>;
