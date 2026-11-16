use std::collections::HashMap;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Result};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use parking_lot::Mutex;
use rand::rngs::OsRng;
use uuid::Uuid;

use crate::config::Config;

pub struct Auth {
    username: String,
    password_hash: String,
    sessions: Mutex<HashMap<String, Instant>>,
    ttl: Duration,
}

impl Auth {
    pub fn from_config(cfg: &Config) -> Result<Self> {
        let password_hash = if let Some(hash) = &cfg.password_hash {
            hash.clone()
        } else if let Some(plain) = &cfg.password {
            hash_password(plain)?
        } else {
            hash_password("admin")?
        };
        Ok(Self {
            username: cfg.username.clone(),
            password_hash,
            sessions: Mutex::new(HashMap::new()),
            ttl: Duration::from_secs(12 * 3600),
        })
    }

    pub fn login(&self, username: &str, password: &str) -> Result<String> {
        if username != self.username {
            return Err(anyhow!("invalid credentials"));
        }
        verify_password(password, &self.password_hash)?;
        let token = Uuid::new_v4().to_string();
        let mut sessions = self.sessions.lock();
        // single session: clear others
        sessions.clear();
        sessions.insert(token.clone(), Instant::now());
        Ok(token)
    }

    pub fn logout(&self, token: &str) {
        self.sessions.lock().remove(token);
    }

    pub fn check(&self, token: &str) -> bool {
        let mut sessions = self.sessions.lock();
        let Some(created) = sessions.get(token).copied() else {
            return false;
        };
        if created.elapsed() > self.ttl {
            sessions.remove(token);
            return false;
        }
        true
    }
}

pub fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow!("hash password: {e}"))?
        .to_string();
    Ok(hash)
}

pub fn verify_password(password: &str, password_hash: &str) -> Result<()> {
    let parsed = PasswordHash::new(password_hash).map_err(|e| anyhow!("bad hash: {e}"))?;
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .map_err(|_| anyhow!("invalid credentials"))?;
    Ok(())
}
