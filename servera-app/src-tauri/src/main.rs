#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_config;
mod ai_provider;
mod profile_manager;
mod ssh_client;
mod local_ops;
mod ssh_config;
mod os_support;
mod wireguard;
mod known_hosts;
mod vscode_remote;
mod vault;

use ai_config::{AiConfig, AiConfigManager};
use profile_manager::{Profile, ProfileManager};
use ssh_client::{spawn_read_thread, spawn_log_reader, SshConnection, SshExecConn, SshTunnel};
use std::sync::{Arc, Mutex};
use std::collections::{HashMap, HashSet};
use tauri::{AppHandle, State, Manager};
use serde::{Deserialize, Serialize};
use sysinfo::{System, Disks};

/* =========================
   STATE
   ========================= */

type SharedSession = Arc<Mutex<Option<SshConnection>>>;
type SharedExecConn = Arc<Mutex<Option<SshExecConn>>>;
type SharedChannel = Arc<Mutex<Option<ssh2::Channel>>>;
type MfaSender = tokio::sync::oneshot::Sender<Vec<String>>;
type HostKeySender = tokio::sync::oneshot::Sender<bool>;

struct LogStreamHandle {
    #[allow(dead_code)]
    session: ssh2::Session,
    channel: SharedChannel,
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
}

struct AppState {
    sessions: Mutex<HashMap<String, SharedSession>>,
    exec_conns: Mutex<HashMap<String, SharedExecConn>>,
    mfa_channels: Mutex<HashMap<String, MfaSender>>,
    host_key_channels: Mutex<HashMap<String, HostKeySender>>,
    // Session ids that trust an unknown host key on first sight instead of
    // prompting — set for saved-profile connections, where the user already
    // vouched for the host by saving it. Changed keys still hard-refuse.
    auto_trust_sessions: Mutex<HashSet<String>>,
    log_streams: Mutex<HashMap<String, LogStreamHandle>>,
    tunnels: Mutex<HashMap<String, SshTunnel>>,
    wireguard: wireguard::GatewaySlot,
    system: Mutex<System>,
}

impl AppState {
    fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            exec_conns: Mutex::new(HashMap::new()),
            mfa_channels: Mutex::new(HashMap::new()),
            host_key_channels: Mutex::new(HashMap::new()),
            auto_trust_sessions: Mutex::new(HashSet::new()),
            log_streams: Mutex::new(HashMap::new()),
            tunnels: Mutex::new(HashMap::new()),
            wireguard: Mutex::new(None),
            system: Mutex::new(System::new_all()),
        }
    }

    fn get_session(&self, id: &str) -> Option<SharedSession> {
        let guard = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        guard.get(id).cloned()
    }

    fn ensure_session(&self, id: &str) -> SharedSession {
        let mut guard = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        guard.entry(id.to_string()).or_insert_with(|| Arc::new(Mutex::new(None))).clone()
    }

    fn close_session(&self, id: &str) {
        let mut guard = self.sessions.lock().unwrap_or_else(|p| p.into_inner());
        let removed = guard.remove(id);
        drop(guard);
        // Removing the map entry is not enough: the reader thread spawned by
        // `spawn_read_thread` holds its own Arc clone, so the connection would
        // stay alive and keep emitting `ssh-output:<id>` from the OLD host —
        // bleeding into the terminal after a reconnect to a different server.
        // Clearing the inner Option makes the thread see `None` and break, and
        // runs SshConnection::drop so the channel is actually torn down.
        if let Some(session) = removed {
            *lock_session(&session) = None;
        }
    }

    fn get_exec_conn(&self, id: &str) -> Option<SharedExecConn> {
        let guard = self.exec_conns.lock().unwrap_or_else(|p| p.into_inner());
        guard.get(id).cloned()
    }

    fn ensure_exec_conn(&self, id: &str) -> SharedExecConn {
        let mut guard = self.exec_conns.lock().unwrap_or_else(|p| p.into_inner());
        guard.entry(id.to_string()).or_insert_with(|| Arc::new(Mutex::new(None))).clone()
    }

    fn close_exec_conn(&self, id: &str) {
        let mut guard = self.exec_conns.lock().unwrap_or_else(|p| p.into_inner());
        let removed = guard.remove(id);
        drop(guard);
        // An in-flight `exec_ssh_command` may still hold an Arc clone; clear the
        // inner Option so it fails fast instead of running against the old host.
        if let Some(exec) = removed {
            *lock_exec(&exec) = None;
        }
    }

    fn register_mfa(&self, id: &str, tx: MfaSender) {
        let mut guard = self.mfa_channels.lock().unwrap_or_else(|p| p.into_inner());
        guard.insert(id.to_string(), tx);
    }

    fn resolve_mfa(&self, id: &str, responses: Vec<String>) -> bool {
        let mut guard = self.mfa_channels.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(tx) = guard.remove(id) {
            let _ = tx.send(responses);
            true
        } else {
            false
        }
    }

    fn register_host_key(&self, id: &str, tx: HostKeySender) {
        let mut guard = self.host_key_channels.lock().unwrap_or_else(|p| p.into_inner());
        guard.insert(id.to_string(), tx);
    }

    /// Remove a pending host-key registration without answering it (timeout cleanup).
    fn take_host_key(&self, id: &str) {
        let mut guard = self.host_key_channels.lock().unwrap_or_else(|p| p.into_inner());
        guard.remove(id);
    }

    /// Mark (or clear) a session as auto-trusting unknown host keys.
    fn set_auto_trust(&self, id: &str, on: bool) {
        let mut guard = self.auto_trust_sessions.lock().unwrap_or_else(|p| p.into_inner());
        if on { guard.insert(id.to_string()); } else { guard.remove(id); }
    }

    fn is_auto_trust(&self, id: &str) -> bool {
        let guard = self.auto_trust_sessions.lock().unwrap_or_else(|p| p.into_inner());
        guard.contains(id)
    }

    fn resolve_host_key(&self, id: &str, accepted: bool) -> bool {
        let mut guard = self.host_key_channels.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(tx) = guard.remove(id) {
            let _ = tx.send(accepted);
            true
        } else {
            false
        }
    }
}

/// RAII guard that clears a session's auto-trust flag on every exit path, so an
/// early `?` return mid-dial can't leave the flag set — which would otherwise
/// silently trust a later ad-hoc connection that reuses the same session id.
struct AutoTrustGuard<'a> {
    state: &'a AppState,
    id: String,
}

impl Drop for AutoTrustGuard<'_> {
    fn drop(&mut self) {
        self.state.set_auto_trust(&self.id, false);
    }
}

/// Helper to lock a session mutex, recovering from poisoned state.
fn lock_session(session: &SharedSession) -> std::sync::MutexGuard<'_, Option<SshConnection>> {
    session.lock().unwrap_or_else(|p| p.into_inner())
}

/// Helper to lock an exec-conn mutex, recovering from poisoned state.
fn lock_exec(conn: &SharedExecConn) -> std::sync::MutexGuard<'_, Option<SshExecConn>> {
    conn.lock().unwrap_or_else(|p| p.into_inner())
}

/* =========================
   PROFILE COMMANDS
   ========================= */

#[tauri::command]
fn save_profile(app: AppHandle, profile: Profile, password: Option<String>, sudo_password: Option<String>) -> Result<(), String> {
    let mgr = ProfileManager::new(&app);
    let mut profiles = mgr.load()?;

    if let Some(idx) = profiles.iter().position(|p| p.id == profile.id) {
        profiles[idx] = profile.clone();
    } else {
        profiles.push(profile.clone());
    }

    mgr.save(profiles)?;

    let key_user = format!("profile:{}", profile.id);
    if let Some(pwd) = password {
        profile_manager::save_password("servera", &key_user, &pwd)?;
    }

    // Sudo password lives only in the keyring under a separate service, never in
    // profiles.json. An empty string is a clear-request (delete the entry); a
    // None means "unchanged" so editing other fields does not wipe it.
    match sudo_password {
        Some(pwd) if pwd.is_empty() => {
            let _ = profile_manager::delete_password("servera-sudo", &key_user);
        }
        Some(pwd) => {
            profile_manager::save_password("servera-sudo", &key_user, &pwd)?;
        }
        None => {}
    }

    Ok(())
}

/// Report whether a sudo password is stored for this profile, so the edit form
/// can show "set" vs "not set" without ever exposing the value itself.
#[tauri::command]
fn has_sudo_password(id: String) -> bool {
    let key_user = format!("profile:{}", id);
    profile_manager::get_password("servera-sudo", &key_user).is_ok()
}

#[tauri::command]
fn load_profiles(app: AppHandle) -> Result<Vec<Profile>, String> {
    ProfileManager::new(&app).load()
}

#[tauri::command]
fn delete_profile(app: AppHandle, id: String) -> Result<(), String> {
    let mgr = ProfileManager::new(&app);
    let mut profiles = mgr.load()?;
    profiles.retain(|p| p.id != id);
    mgr.save(profiles)?;

    let key_user = format!("profile:{}", id);
    let _ = profile_manager::delete_password("servera", &key_user);
    let _ = profile_manager::delete_password("servera-sudo", &key_user);
    let _ = profile_manager::delete_password("servera-wireguard", &id);
    let _ = profile_manager::delete_password("servera-wireguard-psk", &id);
    Ok(())
}

#[tauri::command]
fn set_profile_default_path(app: AppHandle, id: String, mode: String, path: String) -> Result<(), String> {
    let mgr = ProfileManager::new(&app);
    let mut profiles = mgr.load()?;
    let profile = profiles.iter_mut().find(|p| p.id == id).ok_or("Profile not found")?;
    if mode == "local" {
        profile.default_local_path = Some(path);
    } else {
        profile.default_remote_path = Some(path);
    }
    mgr.save(profiles)
}

#[tauri::command]
async fn connect_to_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    session_id: String,
) -> Result<String, String> {
    tokio::task::block_in_place(|| {
        // The user vouched for this host by saving it as a profile, so trust an
        // unknown host key on first sight instead of prompting. The guard clears
        // the flag when the dial finishes or bails out. A *changed* key is still
        // hard-refused, and ad-hoc/Quick-Connect dials still get the prompt.
        state.set_auto_trust(&session_id, true);
        let _trust_guard = AutoTrustGuard { state: state.inner(), id: session_id.clone() };

        let mgr = ProfileManager::new(&app);
        let mut profiles = mgr.load()?;
        let profile_idx = profiles.iter().position(|p| p.id == profile_id).ok_or("Profile not found")?;
        let profile = &profiles[profile_idx];

        let key_user = format!("profile:{}", profile_id);
        let password = profile_manager::get_password("servera", &key_user).ok();

        if password.is_none() && profile.private_key_path.is_none() {
            return Err("Password not found and no private key provided".to_string());
        }

        let (dial_ip, dial_port, dial_jump) = wireguard::resolve_first_hop(
            &app,
            &state.wireguard,
            &profile.ip,
            profile.port,
            profile.proxy_jump.as_deref(),
            profile.wg_mode.as_deref(),
        )?;

        let conn = SshConnection::new(
            &dial_ip,
            &profile.user,
            dial_port,
            password.as_deref(),
            profile.private_key_path.as_deref(),
            dial_jump.as_deref(),
            &app,
            &session_id
        )?;
        let fingerprint = conn.host_key_fingerprint.clone().unwrap_or_default();

        let session = state.ensure_session(&session_id);
        let mut guard = lock_session(&session);
        *guard = Some(conn);
        drop(guard);

        let stored_os = profiles[profile_idx].remote_os.as_ref().map(|s| ssh_client::RemoteOs::from_str(s));

        let exec_conn = SshExecConn::connect(
            &dial_ip,
            &profiles[profile_idx].user,
            dial_port,
            password.as_deref(),
            profiles[profile_idx].private_key_path.as_deref(),
            dial_jump.as_deref(),
            &app,
            &session_id,
            stored_os
        )?;

        // If OS was just detected, persist it
        if stored_os.is_none() {
            profiles[profile_idx].remote_os = Some(exec_conn.remote_os.as_str().to_string());
            let _ = mgr.save(profiles);
        }

        // Attach the profile's sudo password (from the keyring) so elevated
        // commands can escalate without re-prompting.
        let mut exec_conn = exec_conn;
        exec_conn.set_sudo_password(profile_manager::get_password("servera-sudo", &key_user).ok());

        let exec = state.ensure_exec_conn(&session_id);
        *lock_exec(&exec) = Some(exec_conn);

        spawn_read_thread(session_id, session, app);
        Ok(fingerprint)
    })
}

/* =========================
   SSH SESSION COMMANDS
   ========================= */

#[tauri::command]
async fn start_ssh_session(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    ip: String,
    user: String,
    port: u16,
    password: Option<String>,
    private_key: Option<String>,
    proxy_jump: Option<String>,
) -> Result<String, String> {
    tokio::task::block_in_place(|| {
        let (dial_ip, dial_port, dial_jump) = wireguard::resolve_first_hop(
            &app, &state.wireguard, &ip, port, proxy_jump.as_deref(), None,
        )?;

        let conn = SshConnection::new(&dial_ip, &user, dial_port, password.as_deref(), private_key.as_deref(), dial_jump.as_deref(), &app, &session_id)?;
        let fingerprint = conn.host_key_fingerprint.clone().unwrap_or_default();

        let session = state.ensure_session(&session_id);
        let mut guard = lock_session(&session);
        *guard = Some(conn);
        drop(guard);

        let exec_conn = SshExecConn::connect(&dial_ip, &user, dial_port, password.as_deref(), private_key.as_deref(), dial_jump.as_deref(), &app, &session_id, None)?;
        let exec = state.ensure_exec_conn(&session_id);
        *lock_exec(&exec) = Some(exec_conn);

        spawn_read_thread(session_id, session, app);
        Ok(fingerprint)
    })
}

#[tauri::command]
fn resolve_mfa_response(state: State<'_, AppState>, session_id: String, responses: Vec<String>) -> bool {
    state.resolve_mfa(&session_id, responses)
}

#[tauri::command]
fn resolve_host_key_response(state: State<'_, AppState>, session_id: String, accepted: bool) -> bool {
    state.resolve_host_key(&session_id, accepted)
}

/// Remove a stored host key so the next connection re-prompts. Used after a
/// server's key was legitimately rotated and the change was refused.
#[tauri::command]
fn forget_known_host(app: AppHandle, host: String, port: u16) -> Result<(), String> {
    known_hosts::forget(&app, &host, port)
}

#[tauri::command]
fn send_ssh_input(state: State<'_, AppState>, session_id: String, input: String) -> Result<(), String> {
    let session = state.get_session(&session_id).ok_or("No session found")?;
    let mut guard = lock_session(&session);
    if let Some(conn) = guard.as_mut() {
        conn.send_input(&input)
    } else {
        Err("No active SSH session".into())
    }
}

#[tauri::command]
fn close_ssh_session(state: State<'_, AppState>, session_id: String) {
    state.close_session(&session_id);
    state.close_exec_conn(&session_id);
}

/// Full teardown for logout: drop every SSH session (main terminal *and* every
/// TermHub pane), every exec connection, every log stream and every tunnel, plus
/// any pending prompt channels. Closing only the main session left background
/// readers and forwards attached to the previous host, so output from the old
/// server kept arriving after connecting to a new one.
#[tauri::command]
fn disconnect_all(state: State<'_, AppState>) {
    let sessions: Vec<SharedSession> = {
        let mut guard = state.sessions.lock().unwrap_or_else(|p| p.into_inner());
        guard.drain().map(|(_, s)| s).collect()
    };
    for session in sessions {
        *lock_session(&session) = None;
    }

    let execs: Vec<SharedExecConn> = {
        let mut guard = state.exec_conns.lock().unwrap_or_else(|p| p.into_inner());
        guard.drain().map(|(_, c)| c).collect()
    };
    for exec in execs {
        *lock_exec(&exec) = None;
    }

    {
        let mut streams = state.log_streams.lock().unwrap_or_else(|p| p.into_inner());
        for (_, handle) in streams.drain() {
            handle.stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
            let mut ch = handle.channel.lock().unwrap_or_else(|p| p.into_inner());
            *ch = None;
        }
    }

    {
        let mut tunnels = state.tunnels.lock().unwrap_or_else(|p| p.into_inner());
        for (_, tunnel) in tunnels.drain() {
            tunnel.stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    // Dropping the senders wakes anything blocked on a prompt so a half-finished
    // handshake can't resolve against the next connection's session id.
    state.mfa_channels.lock().unwrap_or_else(|p| p.into_inner()).clear();
    state.host_key_channels.lock().unwrap_or_else(|p| p.into_inner()).clear();
    state.auto_trust_sessions.lock().unwrap_or_else(|p| p.into_inner()).clear();
}

#[tauri::command]
fn resize_terminal(state: State<'_, AppState>, session_id: String, cols: u32, rows: u32) -> Result<(), String> {
    if let Some(session) = state.get_session(&session_id) {
        let mut guard = lock_session(&session);
        if let Some(conn) = guard.as_mut() {
            conn.resize(cols, rows)?;
        }
    }
    Ok(())
}

#[tauri::command]
async fn exec_ssh_command(state: State<'_, AppState>, session_id: String, command: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            // Auto-fallback: run as the login user, transparently escalating to
            // sudo only when the command fails for lack of privileges.
            .and_then(|conn| conn.exec_command_auto(&command))
    })
}

/// Always-elevate variant of `exec_ssh_command`. Runs the command through the
/// sudo path (`sudo -n`, then `sudo -S` with the profile's stored password)
/// regardless of whether the plain command would have succeeded — used by the
/// "Run with sudo" toggle for commands that succeed with degraded output as a
/// normal user (e.g. `ss -tlnp` without process names).
#[tauri::command]
async fn exec_ssh_command_sudo(state: State<'_, AppState>, session_id: String, command: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.exec_command_sudo(&command))
    })
}


/* =========================
   FLEET COMMANDS
   ========================= */

/* =========================
   SFTP COMMANDS
   ========================= */

#[tauri::command]
async fn sftp_list(state: State<'_, AppState>, session_id: String, path: String) -> Result<Vec<ssh_client::FileNode>, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_list(&path))
    })
}

#[tauri::command]
async fn sftp_search(state: State<'_, AppState>, session_id: String, path: String, query: String) -> Result<Vec<ssh_client::FileNode>, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_search(&path, &query))
    })
}

#[tauri::command]
async fn sftp_read(state: State<'_, AppState>, session_id: String, path: String) -> Result<Vec<u8>, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_read(&path))
    })
}

#[tauri::command]
async fn sftp_write(state: State<'_, AppState>, session_id: String, path: String, content: Vec<u8>) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_write(&path, &content))
    })
}

#[tauri::command]
async fn sftp_write_sudo(state: State<'_, AppState>, session_id: String, path: String, content: Vec<u8>) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_write_sudo(&path, &content))
    })
}

#[tauri::command]
async fn sftp_upload(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String, local_path: String, remote_path: String) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_upload(&app, &local_path, &remote_path))
    })
}

#[tauri::command]
async fn sftp_upload_sudo(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String, local_path: String, remote_path: String) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_upload_sudo(&app, &local_path, &remote_path))
    })
}

#[tauri::command]
async fn sftp_download(app: tauri::AppHandle, state: State<'_, AppState>, session_id: String, remote_path: String, local_path: String) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_download(&app, &remote_path, &local_path))
    })
}

#[tauri::command]
async fn sftp_create_dir(state: State<'_, AppState>, session_id: String, path: String) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_create_dir(&path))
    })
}

#[tauri::command]
async fn sftp_create_file(state: State<'_, AppState>, session_id: String, path: String) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_create_file(&path))
    })
}

#[tauri::command]
async fn sftp_delete(state: State<'_, AppState>, session_id: String, path: String, is_dir: bool) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_delete(&path, is_dir))
    })
}

#[tauri::command]
async fn sftp_delete_sudo(state: State<'_, AppState>, session_id: String, path: String, is_dir: bool) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_delete_sudo(&path, is_dir))
    })
}

#[tauri::command]
async fn get_remote_user_info(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.get_user_info())
    })
}

#[tauri::command]
async fn sftp_get_permissions(state: State<'_, AppState>, session_id: String, path: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_get_permissions(&path))
    })
}

#[tauri::command]
async fn upgrade_remote_access(state: State<'_, AppState>, session_id: String, path: String, action: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.upgrade_access(&path, &action))
    })
}

#[tauri::command]
async fn sftp_rename(state: State<'_, AppState>, session_id: String, old_path: String, new_path: String) -> Result<(), String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.sftp_rename(&old_path, &new_path))
    })
}

#[tauri::command]
async fn sftp_zip(state: State<'_, AppState>, session_id: String, src: String, dest: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.exec_zip(&src, &dest))
    })
}

#[tauri::command]
async fn sftp_unzip(state: State<'_, AppState>, session_id: String, src: String, dest: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        guard.as_ref().ok_or_else(|| "No active exec session".to_string())
            .and_then(|conn| conn.exec_unzip(&src, &dest))
    })
}

#[tauri::command]
async fn check_path_exists(state: State<'_, AppState>, session_id: Option<String>, mode: String, path: String) -> Result<bool, String> {
    if mode == "local" {
        return Ok(std::path::Path::new(&path).exists());
    }
    Ok(tokio::task::block_in_place(|| {
        if let Some(sid) = session_id {
            if let Some(exec) = state.get_exec_conn(&sid) {
                let guard = lock_exec(&exec);
                if let Some(conn) = guard.as_ref() {
                    return conn.sftp_exists(&path);
                }
            }
        }
        false
    }))
}

/* =========================
   LOCAL FILE COMMANDS
   ========================= */

#[tauri::command]
fn local_read_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_write_file(path: String, content: Vec<u8>) -> Result<(), String> {
    std::fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_list_files(path: String) -> Result<Vec<ssh_client::FileNode>, String> {
    use std::fs;

    if path.is_empty() {
        if cfg!(target_os = "windows") {
            let disks = Disks::new_with_refreshed_list();
            let mut entries = Vec::new();
            for disk in &disks {
                let mount = disk.mount_point().to_string_lossy().to_string();
                entries.push(ssh_client::FileNode {
                    name: mount.clone(),
                    path: mount,
                    is_dir: true,
                    size: disk.available_space(),
                });
            }
            return Ok(entries);
        }
    }

    let dir_path = if path.is_empty() {
        if cfg!(target_os = "windows") {
            std::path::PathBuf::from("C:\\")
        } else {
            std::path::PathBuf::from("/")
        }
    } else {
        std::path::PathBuf::from(path)
    };

    let mut entries = Vec::new();
    let read_dir = fs::read_dir(&dir_path).map_err(|e| e.to_string())?;

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let file_name = entry.file_name().to_string_lossy().to_string();

        entries.push(ssh_client::FileNode {
            name: file_name,
            path: entry.path().to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
            size: metadata.len(),
        });
    }

    entries.sort_by(|a, b| {
        if a.is_dir == b.is_dir {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        } else if a.is_dir {
            std::cmp::Ordering::Less
        } else {
            std::cmp::Ordering::Greater
        }
    });

    Ok(entries)
}

#[tauri::command]
fn local_create_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
fn local_create_file(path: String) -> Result<(), String> {
    std::fs::File::create(path).map_err(|e| e.to_string()).map(|_| ())
}

#[tauri::command]
fn local_delete(path: String, is_dir: bool) -> Result<(), String> {
    if is_dir {
        std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
    } else {
        std::fs::remove_file(&path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
fn local_rename(old_path: String, new_path: String) -> Result<(), String> {
    std::fs::rename(old_path, new_path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn local_zip(src: String, dest: String) -> Result<(), String> {
    local_ops::create_zip(&src, &dest)
}

#[tauri::command]
async fn local_unzip(src: String, dest: String) -> Result<(), String> {
    local_ops::extract_zip(&src, &dest)
}

/* =========================
   AI CHAT COMMANDS
   ========================= */

#[derive(Serialize, Deserialize, Debug, Clone)]
struct ChatMessage {
    role: String,
    content: String,
}

#[tauri::command]
async fn query_ai_chat(app: AppHandle, messages: Vec<ChatMessage>) -> Result<String, String> {
    let config = AiConfigManager::new(&app).load();
    if !config.enabled {
        return Err("AI features are disabled. Configure an AI endpoint in Settings.".into());
    }

    let msgs: Vec<ai_provider::ProviderMessage> = messages.into_iter()
        .map(|m| ai_provider::ProviderMessage { role: m.role, content: m.content })
        .collect();

    ai_provider::query_chat(&config, msgs).await
}

#[tauri::command]
async fn stream_ai_chat(app: AppHandle, messages: Vec<ChatMessage>) -> Result<(), String> {
    let config = AiConfigManager::new(&app).load();
    if !config.enabled {
        return Err("AI features are disabled. Configure an AI endpoint in Settings.".into());
    }

    let msgs: Vec<ai_provider::ProviderMessage> = messages.into_iter()
        .map(|m| ai_provider::ProviderMessage { role: m.role, content: m.content })
        .collect();

    ai_provider::stream_chat(&app, &config, msgs).await
}

/* =========================
   AI CONFIG COMMANDS
   ========================= */

#[tauri::command]
fn load_ai_config(app: AppHandle) -> AiConfig {
    AiConfigManager::new(&app).load()
}

#[tauri::command]
fn save_ai_config(app: AppHandle, config: AiConfig) -> Result<(), String> {
    AiConfigManager::new(&app).save(&config)
}

#[tauri::command]
async fn test_ai_connection(app: AppHandle) -> Result<String, String> {
    let config = AiConfigManager::new(&app).load();
    let result = ai_provider::test_connection(&config).await?;
    serde_json::to_string(&result).map_err(|e| e.to_string())
}

/* =========================
   LOCAL STATS (cached System)
   ========================= */

#[derive(Serialize)]
struct CpuInfo {
    name: String,
    usage: f32,
}

#[derive(Serialize)]
struct DiskInfo {
    name: String,
    mount: String,
    total: u64,
    available: u64,
    usage_pct: f32,
}

#[derive(Serialize)]
struct LocalStats {
    os: String,
    uptime: u64,
    cpus: Vec<CpuInfo>,
    memory_total: u64,
    memory_used: u64,
    memory_pct: f32,
    disks: Vec<DiskInfo>,
}

#[tauri::command]
async fn get_local_stats(state: State<'_, AppState>) -> Result<LocalStats, String> {
    tokio::task::block_in_place(|| -> Result<LocalStats, String> {
    let mut sys = state.system.lock().unwrap_or_else(|p: std::sync::PoisonError<_>| p.into_inner());
    // Only refresh what the dashboard needs — refresh_all() scans every process
    // which is extremely slow on Windows (WMI/perf counters)
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let cpus: Vec<CpuInfo> = sys.cpus().iter().map(|cpu| {
        CpuInfo {
            name: cpu.name().to_string(),
            usage: cpu.cpu_usage(),
        }
    }).collect();

    let memory_total = sys.total_memory();
    let memory_used = sys.used_memory();
    let memory_pct = if memory_total > 0 {
        (memory_used as f32 / memory_total as f32) * 100.0
    } else {
        0.0
    };

    let disks_info = Disks::new_with_refreshed_list();
    let disks: Vec<DiskInfo> = disks_info.iter().map(|disk| {
        let total = disk.total_space();
        let available = disk.available_space();
        let used = total - available;
        DiskInfo {
            name: disk.name().to_string_lossy().to_string(),
            mount: disk.mount_point().to_string_lossy().to_string(),
            total,
            available,
            usage_pct: if total > 0 { (used as f32 / total as f32) * 100.0 } else { 0.0 },
        }
    }).collect();

    Ok(LocalStats {
        os: System::name().unwrap_or_else(|| "Unknown".into()),
        uptime: System::uptime(),
        cpus,
        memory_total,
        memory_used,
        memory_pct,
        disks,
    })
    }) // block_in_place
}

/* =========================
   SNIPPETS PERSISTENCE
   ========================= */

#[tauri::command]
fn load_snippets(app: AppHandle) -> Result<String, String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    let snippets_path = config_dir.join("snippets.json");
    if snippets_path.exists() {
        std::fs::read_to_string(snippets_path).map_err(|e| e.to_string())
    } else {
        Ok("[]".to_string())
    }
}

#[tauri::command]
fn save_snippets(app: AppHandle, content: String) -> Result<(), String> {
    let config_dir = app.path().app_config_dir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&config_dir).map_err(|e| e.to_string())?;
    let snippets_path = config_dir.join("snippets.json");
    std::fs::write(snippets_path, content).map_err(|e| e.to_string())
}

/* =========================
   SECRETS VAULT COMMANDS
   ========================= */

#[tauri::command]
fn vault_load_items(app: AppHandle) -> Result<Vec<vault::VaultItem>, String> {
    let mgr = vault::VaultManager::new(&app);
    mgr.load_items()
}

#[tauri::command]
fn vault_save_item(app: AppHandle, item: vault::VaultItem) -> Result<vault::VaultItem, String> {
    let mgr = vault::VaultManager::new(&app);
    mgr.save_item(item)
}

#[tauri::command]
fn vault_delete_item(app: AppHandle, id: String) -> Result<(), String> {
    let mgr = vault::VaultManager::new(&app);
    mgr.delete_item(&id)
}

#[tauri::command]
fn vault_touch_item(app: AppHandle, id: String) -> Result<(), String> {
    let mgr = vault::VaultManager::new(&app);
    mgr.touch_item(&id)
}

#[tauri::command]
fn vault_export_backup(app: AppHandle) -> Result<String, String> {
    let mgr = vault::VaultManager::new(&app);
    mgr.export_backup()
}

#[tauri::command]
fn vault_import_backup(app: AppHandle, json_data: String) -> Result<usize, String> {
    let mgr = vault::VaultManager::new(&app);
    mgr.import_backup(&json_data)
}

/* =========================
   SSH CONFIG IMPORT COMMANDS
   ========================= */

#[tauri::command]
fn detect_ssh_config_path() -> ssh_config::DetectResult {
    ssh_config::resolver::detect_ssh_config()
}

#[tauri::command]
fn parse_ssh_config(path: String) -> Result<Vec<ssh_config::parser::SshConfigEntry>, String> {
    let mut seen = Vec::new();
    let entries = ssh_config::parser::parse_ssh_config(std::path::Path::new(&path), &mut seen)?;
    
    // Filter out pure wildcard entries if that's all we have, or if we want to check for WG
    if entries.iter().all(|e| e.is_wildcard && e.hostname.is_none()) {
        if let Ok(Some(wg)) = ssh_config::wireguard::parse_wireguard_config(std::path::Path::new(&path)) {
            let mut wg_entry = ssh_config::parser::SshConfigEntry::default();
            wg_entry.host_patterns = vec![format!("WireGuard: {}", wg.endpoint)];
            // Extract IP/Host from endpoint (host:port)
            wg_entry.hostname = Some(wg.endpoint.split(':').next().unwrap_or(&wg.endpoint).to_string());
            wg_entry.is_wireguard = true;
            wg_entry.wg_config = Some(wg);
            return Ok(vec![wg_entry]);
        }
    }
    
    Ok(entries)
}

#[tauri::command]
fn import_ssh_profiles(app: AppHandle, entries: Vec<ssh_config::parser::SshConfigEntry>) -> Result<ssh_config::ImportResult, String> {
    let mgr = ProfileManager::new(&app);
    let mut existing_profiles = mgr.load()?;
    let mut imported = 0;
    let mut skipped = 0;
    let errors = Vec::new();

    for entry in entries {
        let new_profiles = ssh_config::mapper::map_entry_to_profile(&entry);
        for p in new_profiles {
            // Check for duplicates by IP and User
            if existing_profiles.iter().any(|ep| ep.ip == p.ip && ep.user == p.user) {
                skipped += 1;
                continue;
            }
            existing_profiles.push(p);
            imported += 1;
        }
    }

    mgr.save(existing_profiles)?;
    Ok(ssh_config::ImportResult {
        imported,
        skipped,
        errors,
    })
}

/* =========================
   OS-SPECIFIC COMMANDS (Milestone 3)
   ========================= */

#[tauri::command]
async fn get_system_metadata(state: State<'_, AppState>, session_id: String) -> Result<serde_json::Value, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        let conn = guard.as_ref().ok_or_else(|| "No active exec session".to_string())?;
        
        // Detect package manager
        let manager = os_support::detect_package_manager(|cmd| conn.exec_command(cmd));
        let manager_name = manager.as_ref().map(|m| m.name().to_string()).unwrap_or_else(|| "Unknown".to_string());
        let has_manager = manager.is_some();

        Ok(serde_json::json!({
            "manager": manager_name,
            "has_manager": has_manager,
        }))
    })
}

#[tauri::command]
async fn get_package_updates(state: State<'_, AppState>, session_id: String) -> Result<Vec<os_support::PackageInfo>, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        let conn = guard.as_ref().ok_or_else(|| "No active exec session".to_string())?;
        
        let manager = os_support::detect_package_manager(|cmd| conn.exec_command(cmd))
            .ok_or_else(|| "No supported package manager detected on this host".to_string())?;

        // 1. Refresh
        let _ = conn.exec_command(manager.update_cmd());
        
        // 2. List
        let output = conn.exec_command(manager.list_upgradable_cmd())?;
        
        // 3. Parse
        Ok(manager.parse_upgradable(&output))
    })
}

#[tauri::command]
async fn perform_package_upgrade(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        let conn = guard.as_ref().ok_or_else(|| "No active exec session".to_string())?;
        
        let manager = os_support::detect_package_manager(|cmd| conn.exec_command(cmd))
            .ok_or_else(|| "No supported package manager detected on this host".to_string())?;

        conn.exec_command(manager.upgrade_cmd())
    })
}

#[tauri::command]
async fn get_standard_metrics(state: State<'_, AppState>, session_id: String) -> Result<os_support::SystemMetrics, String> {
    let exec = state.get_exec_conn(&session_id).ok_or("No exec session found")?;
    tokio::task::block_in_place(|| {
        let guard = lock_exec(&exec);
        let conn = guard.as_ref().ok_or_else(|| "No active exec session".to_string())?;
        
        let monitor = os_support::get_monitor(conn.remote_os);
        let output = conn.exec_command(&monitor.gather_stats_cmd())?;
        monitor.parse_stats(&output)
    })
}

/* =========================
   LOG STREAMING COMMANDS
   ========================= */

#[tauri::command]
async fn start_log_stream(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    stream_id: String,
    log_path: String,
    ip: String,
    user: String,
    port: u16,
    password: Option<String>,
    private_key: Option<String>,
    proxy_jump: Option<String>,
    profile_id: Option<String>,
) -> Result<(), String> {
    // Determine OS and root-ness from the existing session if possible. On a
    // non-root Unix login most system logs (journalctl, /var/log/*) are only
    // readable by root, so we transparently elevate the stream command.
    let (remote_os, is_root) = state.get_exec_conn(&session_id)
        .and_then(|exec| {
            let guard = lock_exec(&exec);
            guard.as_ref().map(|c| (c.remote_os, c.is_root))
        })
        .unwrap_or((ssh_client::RemoteOs::Linux, false));

    tokio::task::block_in_place(|| {
        // When streaming from a saved profile, resolve credentials server-side
        // — profile connections never expose the keyring password to the UI,
        // so a password/private_key passed in from the frontend for a profile
        // session is always empty and would fail auth.
        let (ip, user, port, password, private_key, proxy_jump, wg_mode, sudo_pw) = if let Some(pid) = &profile_id {
            let mgr = ProfileManager::new(&app);
            let profiles = mgr.load()?;
            let profile = profiles.iter().find(|p| &p.id == pid).cloned()
                .ok_or_else(|| "Profile not found".to_string())?;
            let key_user = format!("profile:{}", profile.id);
            let pw = profile_manager::get_password("servera", &key_user).ok();
            let sudo_pw = profile_manager::get_password("servera-sudo", &key_user).ok();
            (profile.ip, profile.user, profile.port, pw, profile.private_key_path, profile.proxy_jump, profile.wg_mode, sudo_pw)
        } else {
            (ip, user, port, password, private_key, proxy_jump, None, None)
        };

        let (dial_ip, dial_port, dial_jump) = wireguard::resolve_first_hop(
            &app, &state.wireguard, &ip, port, proxy_jump.as_deref(), wg_mode.as_deref(),
        )?;

        let command = if log_path == "__journalctl__" {
            match remote_os {
                ssh_client::RemoteOs::Darwin => "log stream --style syslog".to_string(),
                ssh_client::RemoteOs::Windows => "powershell -NoProfile -Command \"Get-WinEvent -LogName System -MaxEvents 50\"".to_string(),
                _ => "journalctl -f --no-pager 2>/dev/null || echo 'journalctl not available'".to_string(),
            }
        } else {
            match remote_os {
                ssh_client::RemoteOs::Windows => format!("powershell -NoProfile -Command \"Get-Content -Path {} -Wait -Tail 20\"", ssh_client::ps_escape(&log_path)),
                _ => format!("tail -f {} 2>/dev/null || echo 'Cannot stream'", log_path),
            }
        };

        // Elevate log streaming on a non-root Unix login. Windows has no sudo
        // model, so never elevate there.
        let elevate = !is_root && remote_os != ssh_client::RemoteOs::Windows;

        let (session, channel) = ssh_client::open_stream_channel(
            &dial_ip, &user, dial_port,
            password.as_deref(),
            private_key.as_deref(),
            dial_jump.as_deref(),
            &command,
            &app,
            &session_id,
            elevate,
            sudo_pw.as_deref(),
        )?;

        let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let shared_channel: SharedChannel = Arc::new(Mutex::new(Some(channel)));

        spawn_log_reader(stream_id.clone(), shared_channel.clone(), stop_flag.clone(), app);

        let handle = LogStreamHandle {
            session,
            channel: shared_channel,
            stop_flag,
        };

        let mut streams = state.log_streams.lock().unwrap_or_else(|p| p.into_inner());
        streams.insert(stream_id, handle);
        Ok(())
    })
}

#[tauri::command]
fn stop_log_stream(state: State<'_, AppState>, stream_id: String) {
    let mut streams = state.log_streams.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(handle) = streams.remove(&stream_id) {
        handle.stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        let mut ch = handle.channel.lock().unwrap_or_else(|p| p.into_inner());
        *ch = None;
    }
}

/* =========================
   TUNNEL COMMANDS
   ========================= */

#[derive(Serialize, Clone)]
struct TunnelInfo {
    id: String,
    tunnel_type: String,
    local_port: u16,
    remote_host: String,
    remote_port: u16,
}

#[tauri::command]
async fn create_tunnel(
    app: AppHandle,
    state: State<'_, AppState>,
    session_id: String,
    tunnel_id: String,
    tunnel_type: String,
    local_port: u16,
    remote_host: Option<String>,
    remote_port: Option<u16>,
    ip: String,
    user: String,
    port: u16,
    password: Option<String>,
    private_key: Option<String>,
    proxy_jump: Option<String>,
    profile_id: Option<String>,
) -> Result<TunnelInfo, String> {
    tokio::task::block_in_place(|| {
        // When opening a tunnel for a saved profile, resolve credentials
        // server-side rather than trusting whatever the frontend has in
        // memory — profile connections never expose the keyring password
        // to the UI, so a password passed in for a profile session is
        // always empty and would fail auth.
        let (ip, user, port, password, private_key, proxy_jump, wg_mode) = if let Some(pid) = &profile_id {
            let mgr = ProfileManager::new(&app);
            let profiles = mgr.load()?;
            let profile = profiles.iter().find(|p| &p.id == pid).cloned()
                .ok_or_else(|| "Profile not found".to_string())?;
            let key_user = format!("profile:{}", profile.id);
            let pw = profile_manager::get_password("servera", &key_user).ok();
            (profile.ip, profile.user, profile.port, pw, profile.private_key_path, profile.proxy_jump, profile.wg_mode)
        } else {
            (ip, user, port, password, private_key, proxy_jump, None)
        };

        let (dial_ip, dial_port, dial_jump) = wireguard::resolve_first_hop(
            &app, &state.wireguard, &ip, port, proxy_jump.as_deref(), wg_mode.as_deref(),
        )?;

        let tunnel = match tunnel_type.as_str() {
            "local" => {
                let rh = remote_host.as_deref().unwrap_or("127.0.0.1");
                let rp = remote_port.unwrap_or(80);
                ssh_client::start_local_forward(
                    &dial_ip, &user, dial_port,
                    password.as_deref(), private_key.as_deref(), dial_jump.as_deref(),
                    local_port, rh, rp, &app, &session_id,
                )?
            }
            "dynamic" => {
                ssh_client::start_dynamic_forward(
                    &dial_ip, &user, dial_port,
                    password.as_deref(), private_key.as_deref(), dial_jump.as_deref(),
                    local_port, &app, &session_id,
                )?
            }
            "remote" => {
                let lh = remote_host.as_deref().unwrap_or("127.0.0.1");
                let lp = remote_port.unwrap_or(80);
                ssh_client::start_remote_forward(
                    &dial_ip, &user, dial_port,
                    password.as_deref(), private_key.as_deref(), dial_jump.as_deref(),
                    local_port, lh, lp, &app, &session_id,
                )?
            }
            _ => return Err(format!("Unknown tunnel type: {}", tunnel_type)),
        };

        let info = TunnelInfo {
            id: tunnel_id.clone(),
            tunnel_type: tunnel.tunnel_type.clone(),
            local_port: tunnel.local_port,
            remote_host: tunnel.remote_host.clone(),
            remote_port: tunnel.remote_port,
        };

        let mut tunnels = state.tunnels.lock().unwrap_or_else(|p| p.into_inner());
        tunnels.insert(tunnel_id, tunnel);
        Ok(info)
    })
}

#[tauri::command]
fn close_tunnel(state: State<'_, AppState>, tunnel_id: String) -> Result<(), String> {
    let mut tunnels = state.tunnels.lock().unwrap_or_else(|p| p.into_inner());
    if let Some(tunnel) = tunnels.remove(&tunnel_id) {
        tunnel.stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        Ok(())
    } else {
        Err("Tunnel not found".into())
    }
}

#[tauri::command]
fn get_active_tunnels(state: State<'_, AppState>) -> Vec<TunnelInfo> {
    let tunnels = state.tunnels.lock().unwrap_or_else(|p| p.into_inner());
    let mut infos: Vec<TunnelInfo> = tunnels.iter().map(|(id, t)| TunnelInfo {
        id: id.clone(),
        tunnel_type: t.tunnel_type.clone(),
        local_port: t.local_port,
        remote_host: t.remote_host.clone(),
        remote_port: t.remote_port,
    }).collect();
    drop(tunnels);

    // The WireGuard gateway shows up as a synthetic tunnel; the id embeds the
    // endpoint host so profile-matching in the frontend works unchanged.
    if let Some(status) = wireguard::get_status(&state.wireguard) {
        let endpoint_host = status.endpoint.split(':').next().unwrap_or(&status.endpoint);
        let endpoint_port = status.endpoint.split(':').nth(1).and_then(|p| p.parse().ok()).unwrap_or(51820);
        infos.push(TunnelInfo {
            id: format!("wg-{}", endpoint_host),
            tunnel_type: "wireguard".to_string(),
            local_port: 0,
            remote_host: endpoint_host.to_string(),
            remote_port: endpoint_port,
        });
    }
    infos
}

#[tauri::command]
async fn stop_all_tunnels(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    {
        let mut tunnels = state.tunnels.lock().unwrap_or_else(|p| p.into_inner());
        for (_, tunnel) in tunnels.drain() {
            tunnel.stop_flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }
    wireguard::stop_gateway(&app, &state.wireguard);
    Ok(())
}

#[tauri::command]
fn stop_wireguard_gateway(app: AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    wireguard::stop_gateway(&app, &state.wireguard);
    Ok(())
}

#[tauri::command]
fn get_wireguard_status(state: State<'_, AppState>) -> Option<wireguard::WgStatusPayload> {
    wireguard::get_status(&state.wireguard)
}

#[tauri::command]
async fn start_gateway_from_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String
) -> Result<usize, String> {
    // 1. Stop all existing tunnels first (Solo Mode)
    let _ = stop_all_tunnels(app.clone(), state.clone()).await;

    let mgr = ProfileManager::new(&app);
    let profiles = mgr.load()?;
    let profile = profiles.iter().find(|p| p.id == profile_id).cloned()
        .ok_or_else(|| "Profile not found".to_string())?;

    let mut started = 0;

    // Handle WireGuard
    if let Some(wg) = profile.wg_config.clone() {
        let private_key = profile_manager::get_password("servera-wireguard", &profile.id)
            .ok()
            .or_else(|| wg.private_key.clone())
            .ok_or_else(|| "No WireGuard private key stored for this gateway — re-import the .conf file".to_string())?;
        let psk = profile_manager::get_password("servera-wireguard-psk", &profile.id).ok();

        let mut wg = wg;
        if psk.is_some() {
            wg.preshared_key = psk;
        }

        let payload = tokio::task::block_in_place(|| {
            wireguard::start_gateway(
                &app,
                &state.wireguard,
                Some(profile.id.clone()),
                &wg,
                &private_key,
                &profiles,
            )
        })?;
        return Ok(payload.forwards.len().max(1));
    }

    // Handle SSH Tunnels
    if let Some(tunnels) = profile.tunnels {
        // Try to get password from keyring if needed
        let key_user = format!("profile:{}", profile.id);
        let password = crate::profile_manager::get_password("servera", &key_user).ok();

        for fw in tunnels {
            let tunnel_id = format!("saved-{}-{}", fw.local_port, profile.ip);
            let tunnel_type = if fw.is_remote { "remote" } else { "local" };
            
            create_tunnel(
                app.clone(),
                state.clone(),
                "gateway-saved".to_string(),
                tunnel_id,
                tunnel_type.to_string(),
                fw.local_port,
                Some(fw.remote_host),
                Some(fw.remote_port),
                profile.ip.clone(),
                profile.user.clone(),
                profile.port,
                password.clone(),
                profile.private_key_path.clone(),
                profile.proxy_jump.clone(),
                Some(profile.id.clone())
            ).await?;
            started += 1;
        }
    }

    Ok(started)
}

#[tauri::command]
async fn start_tunnels_from_entry(
    app: AppHandle,
    state: State<'_, AppState>,
    entry: ssh_config::parser::SshConfigEntry
) -> Result<usize, String> {
    let mut started = 0;

    if entry.is_wireguard {
        if let Some(wg) = entry.wg_config {
            let private_key = wg.private_key.clone()
                .ok_or_else(|| "The WireGuard config has no PrivateKey".to_string())?;
            let seeds = ProfileManager::new(&app).load().unwrap_or_default();
            let payload = tokio::task::block_in_place(|| {
                wireguard::start_gateway(&app, &state.wireguard, None, &wg, &private_key, &seeds)
            })?;
            return Ok(payload.forwards.len().max(1));
        }
        return Ok(started);
    }

    let ip = entry.hostname.clone().ok_or("No hostname in entry")?;
    let user = entry.user.clone().unwrap_or_else(|| "root".to_string());
    let port = entry.port.unwrap_or(22);

    for fw in entry.local_forwards {
        create_tunnel(
            app.clone(), state.clone(), "gateway-import".to_string(),
            format!("auto-L-{}-{}", fw.local_port, ip), "local".to_string(),
            fw.local_port, Some(fw.remote_host), Some(fw.remote_port),
            ip.clone(), user.clone(), port, None, None, entry.proxy_jump.clone(), None
        ).await?;
        started += 1;
    }

    for fw in entry.remote_forwards {
        create_tunnel(
            app.clone(), state.clone(), "gateway-import".to_string(),
            format!("auto-R-{}-{}", fw.remote_port, ip), "remote".to_string(),
            fw.local_port, Some(fw.remote_host), Some(fw.remote_port),
            ip.clone(), user.clone(), port, None, None, entry.proxy_jump.clone(), None
        ).await?;
        started += 1;
    }

    Ok(started)
}

/* =========================
   VS CODE REMOTE COMMANDS
   ========================= */

#[tauri::command]
fn check_vscode_cli() -> bool {
    vscode_remote::check_vscode_cli()
}

#[tauri::command]
fn ensure_remote_ssh_extension() -> Result<bool, String> {
    vscode_remote::ensure_remote_ssh_extension()
}

#[tauri::command]
fn ensure_ssh_config_host(app: AppHandle, profile_id: String) -> Result<String, String> {
    let mgr = ProfileManager::new(&app);
    let profiles = mgr.load()?;
    let profile = profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?;
    vscode_remote::ensure_ssh_config_host(profile)
}

#[tauri::command]
fn open_vscode_remote(alias: String, path: String) -> Result<(), String> {
    vscode_remote::open_vscode_remote(&alias, &path)
}

/* =========================
   FLEET ORCHESTRATION COMMANDS
   ========================= */

#[derive(Serialize, Clone)]
struct FleetResult {
    profile_id: String,
    profile_name: String,
    host: String,
    output: String,
    success: bool,
    duration_ms: u64,
}

#[tauri::command]
async fn fleet_run_command(
    app: AppHandle,
    profile_ids: Vec<String>,
    command: String,
) -> Result<Vec<FleetResult>, String> {
    let mgr = ProfileManager::new(&app);
    let profiles = mgr.load()?;

    let mut handles = Vec::new();

    for pid in profile_ids {
        let profile = profiles.iter().find(|p| p.id == pid).cloned();
        let cmd = command.clone();
        let app_clone = app.clone();

        handles.push(tokio::task::spawn_blocking(move || {
            let profile = match profile {
                Some(p) => p,
                None => return FleetResult {
                    profile_id: pid,
                    profile_name: "Unknown".into(),
                    host: "".into(),
                    output: "Profile not found".into(),
                    success: false,
                    duration_ms: 0,
                },
            };

            let key_user = format!("profile:{}", profile.id);
            let password = profile_manager::get_password("servera", &key_user).ok();
            let start = std::time::Instant::now();

            let state = app_clone.state::<AppState>();
            let (dial_ip, dial_port, dial_jump) = match wireguard::resolve_first_hop(
                &app_clone,
                &state.wireguard,
                &profile.ip,
                profile.port,
                profile.proxy_jump.as_deref(),
                profile.wg_mode.as_deref(),
            ) {
                Ok(resolved) => resolved,
                Err(e) => return FleetResult {
                    profile_id: profile.id.clone(),
                    profile_name: if profile.name.is_empty() { format!("{}@{}", profile.user, profile.ip) } else { profile.name.clone() },
                    host: format!("{}@{}:{}", profile.user, profile.ip, profile.port),
                    output: format!("Connection failed: {}", e),
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                },
            };

            let session_id = format!("fleet-{}", uuid::Uuid::new_v4());
            match SshExecConn::connect(
                &dial_ip, &profile.user, dial_port,
                password.as_deref(),
                profile.private_key_path.as_deref(),
                dial_jump.as_deref(),
                &app_clone,
                &session_id,
                None,
            ) {
                Ok(conn) => {
                    // Report the real command outcome instead of a blanket
                    // success — a command that failed on a host now shows red.
                    let (output, success) = match conn.exec_command(&cmd) {
                        Ok(out) => (out, true),
                        Err(e) => (e, false),
                    };
                    FleetResult {
                        profile_id: profile.id.clone(),
                        profile_name: if profile.name.is_empty() { format!("{}@{}", profile.user, profile.ip) } else { profile.name.clone() },
                        host: format!("{}@{}:{}", profile.user, profile.ip, profile.port),
                        output,
                        success,
                        duration_ms: start.elapsed().as_millis() as u64,
                    }
                }
                Err(e) => FleetResult {
                    profile_id: profile.id.clone(),
                    profile_name: if profile.name.is_empty() { format!("{}@{}", profile.user, profile.ip) } else { profile.name.clone() },
                    host: format!("{}@{}:{}", profile.user, profile.ip, profile.port),
                    output: format!("Connection failed: {}", e),
                    success: false,
                    duration_ms: start.elapsed().as_millis() as u64,
                },
            }
        }));
    }

    let mut results = Vec::new();
    for handle in handles {
        match handle.await {
            Ok(r) => results.push(r),
            Err(e) => results.push(FleetResult {
                profile_id: "".into(),
                profile_name: "".into(),
                host: "".into(),
                output: format!("Task error: {}", e),
                success: false,
                duration_ms: 0,
            }),
        }
    }
    Ok(results)
}

/* =========================
   MAIN
   ========================= */

fn main() {
    tauri::Builder::default()
        .manage(AppState::new())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            // SSH
            start_ssh_session,
            send_ssh_input,
            close_ssh_session,
            disconnect_all,
            resize_terminal,
            exec_ssh_command,
            exec_ssh_command_sudo,
            // Profiles
            save_profile,
            has_sudo_password,
            load_profiles,
            delete_profile,
            set_profile_default_path,
            connect_to_profile,
            // SFTP
            sftp_list,
            sftp_search,
            sftp_read,
            sftp_write,
            sftp_write_sudo,
            sftp_upload,
            sftp_upload_sudo,
            sftp_download,
            sftp_create_dir,
            sftp_create_file,
            sftp_delete,
            sftp_delete_sudo,
            sftp_rename,
            sftp_zip,
            sftp_unzip,
            get_remote_user_info,
            sftp_get_permissions,
            upgrade_remote_access,
            // Local
            local_list_files,
            local_read_file,
            local_write_file,
            local_create_dir,
            local_create_file,
            local_delete,
            local_rename,
            local_zip,
            local_unzip,
            check_path_exists,
            // AI
            query_ai_chat,
            stream_ai_chat,
            load_ai_config,
            save_ai_config,
            test_ai_connection,
            // Stats
            get_local_stats,
            // Snippets
            load_snippets,
            save_snippets,
            // SSH Config
            detect_ssh_config_path,
            parse_ssh_config,
            import_ssh_profiles,
            resolve_mfa_response,
            resolve_host_key_response,
            forget_known_host,
            // OS-Specific
            get_system_metadata,
            get_package_updates,
            perform_package_upgrade,
            get_standard_metrics,
            // Log Streaming
            start_log_stream,
            stop_log_stream,
            // Tunnels
            create_tunnel,
            close_tunnel,
            get_active_tunnels,
            stop_all_tunnels,
            start_tunnels_from_entry,
            start_gateway_from_profile,
            // WireGuard
            stop_wireguard_gateway,
            get_wireguard_status,
            // VS Code Remote
            check_vscode_cli,
            ensure_remote_ssh_extension,
            ensure_ssh_config_host,
            open_vscode_remote,
            // Fleet Orchestration
            fleet_run_command,
            // Secrets Vault
            vault_load_items,
            vault_save_item,
            vault_delete_item,
            vault_touch_item,
            vault_export_backup,
            vault_import_backup,
        ])
        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                let state = app_handle.state::<AppState>();
                wireguard::stop_gateway(app_handle, &state.wireguard);
            }
        });
}
