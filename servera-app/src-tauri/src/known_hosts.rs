// Trust-on-first-use (TOFU) SSH host key verification.
//
// Every outbound SSH handshake is checked against a persisted store BEFORE any
// credentials are sent. A host seen for the first time prompts the user (via a
// `host-key-verify` event, mirroring the MFA prompt flow); a host whose key no
// longer matches is refused outright, since that is the signature of a
// man-in-the-middle. The store lives at `<app_data>/known_hosts.json`.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Clone)]
pub struct KnownHost {
    pub fingerprint: String,
    pub key_type: String,
    pub first_seen: u64,
}

pub enum Verdict {
    Known,
    Unknown,
    Changed { stored: String },
}

/// Human-readable name for an ssh2 host key type.
pub fn key_type_name(t: ssh2::HostKeyType) -> &'static str {
    match t {
        ssh2::HostKeyType::Rsa => "ssh-rsa",
        ssh2::HostKeyType::Dss => "ssh-dss",
        ssh2::HostKeyType::Ecdsa256 => "ecdsa-sha2-nistp256",
        ssh2::HostKeyType::Ecdsa384 => "ecdsa-sha2-nistp384",
        ssh2::HostKeyType::Ecdsa521 => "ecdsa-sha2-nistp521",
        ssh2::HostKeyType::Ed25519 => "ssh-ed25519",
        _ => "unknown",
    }
}

/// Colon-separated hex fingerprint of a raw host key blob.
pub fn fingerprint_hex(key: &[u8]) -> String {
    key.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(":")
}

fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn store_path(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join("known_hosts.json"))
}

fn load(app: &AppHandle) -> HashMap<String, KnownHost> {
    store_path(app)
        .ok()
        .filter(|p| p.exists())
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save(app: &AppHandle, map: &HashMap<String, KnownHost>) -> Result<(), String> {
    let path = store_path(app)?;
    let data = serde_json::to_string_pretty(map).map_err(|e| e.to_string())?;
    fs::write(path, data).map_err(|e| e.to_string())
}

/// Compare a presented fingerprint against the store.
pub fn check(app: &AppHandle, host: &str, port: u16, fingerprint: &str) -> Verdict {
    let key = format!("{}:{}", host, port);
    match load(app).get(&key) {
        Some(kh) if kh.fingerprint == fingerprint => Verdict::Known,
        Some(kh) => Verdict::Changed { stored: kh.fingerprint.clone() },
        None => Verdict::Unknown,
    }
}

/// Persist a host key as trusted.
pub fn store(app: &AppHandle, host: &str, port: u16, fingerprint: &str, key_type: &str) -> Result<(), String> {
    let key = format!("{}:{}", host, port);
    let mut map = load(app);
    map.insert(key, KnownHost {
        fingerprint: fingerprint.to_string(),
        key_type: key_type.to_string(),
        first_seen: now_secs(),
    });
    save(app, &map)
}

/// Remove a stored host key so the next connection re-prompts (used when the
/// user has legitimately rotated a server's key).
pub fn forget(app: &AppHandle, host: &str, port: u16) -> Result<(), String> {
    let key = format!("{}:{}", host, port);
    let mut map = load(app);
    map.remove(&key);
    save(app, &map)
}

/// Loopback targets are the WireGuard gateway's dynamic 127.0.0.1:port forwards
/// (and genuine localhost). Their identity isn't stable and the WireGuard tunnel
/// already authenticates the far side, so TOFU is skipped for them.
pub fn is_loopback_host(host: &str) -> bool {
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        return ip.is_loopback();
    }
    host.eq_ignore_ascii_case("localhost")
}

/// Verify a presented host key before authentication. Blocks the calling thread
/// on a user prompt when the host is new. Returns an error (refusing the
/// connection) on a changed key, a rejected prompt, or a timeout.
pub fn verify(
    app: &AppHandle,
    session_id: &str,
    host: &str,
    port: u16,
    fingerprint: &str,
    key_type: &str,
) -> Result<(), String> {
    match check(app, host, port, fingerprint) {
        Verdict::Known => Ok(()),
        Verdict::Changed { stored } => Err(format!(
            "HOST KEY VERIFICATION FAILED for {host}:{port}.\n\
             Expected fingerprint:\n  {stored}\n\
             Server presented:\n  {fingerprint}\n\n\
             This can mean a man-in-the-middle attack, or that the server's key was \
             legitimately changed. The connection was refused. If you changed the \
             server, remove it from known hosts and reconnect."
        )),
        Verdict::Unknown => {
            let state: tauri::State<crate::AppState> = app.state();

            // Saved-profile dials trust the host on first sight (the user vouched
            // for it by saving the profile), so persist silently instead of
            // prompting. Ad-hoc/Quick-Connect dials fall through to the prompt.
            if state.is_auto_trust(session_id) {
                return store(app, host, port, fingerprint, key_type);
            }

            let (tx, rx) = tokio::sync::oneshot::channel();
            state.register_host_key(session_id, tx);

            let _ = app.emit("host-key-verify", serde_json::json!({
                "session_id": session_id,
                "host": host,
                "port": port,
                "fingerprint": fingerprint,
                "key_type": key_type,
            }));

            // Block this connection thread until the user answers, with a 2-minute cap.
            let timeout = std::time::Duration::from_secs(120);
            let accepted = match tokio::runtime::Handle::current()
                .block_on(tokio::time::timeout(timeout, rx))
            {
                Ok(Ok(v)) => v,
                _ => false,
            };

            if !accepted {
                // Drop any still-pending registration (timeout path).
                state.take_host_key(session_id);
                return Err(format!(
                    "Host key for {host}:{port} was not accepted — connection cancelled."
                ));
            }

            store(app, host, port, fingerprint, key_type)?;
            Ok(())
        }
    }
}
