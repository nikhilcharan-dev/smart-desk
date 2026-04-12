#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod ai_config;
mod ai_provider;
mod profile_manager;
mod ssh_client;
mod local_ops;
mod ssh_config;
mod os_support;

use ai_config::{AiConfig, AiConfigManager};
use profile_manager::{Profile, ProfileManager};
use ssh_client::{spawn_read_thread, spawn_log_reader, SshConnection, SshExecConn, SshTunnel};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
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
    log_streams: Mutex<HashMap<String, LogStreamHandle>>,
    tunnels: Mutex<HashMap<String, SshTunnel>>,
    system: Mutex<System>,
}

impl AppState {
    fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            exec_conns: Mutex::new(HashMap::new()),
            mfa_channels: Mutex::new(HashMap::new()),
            log_streams: Mutex::new(HashMap::new()),
            tunnels: Mutex::new(HashMap::new()),
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
        guard.remove(id);
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
        guard.remove(id);
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
fn save_profile(app: AppHandle, profile: Profile, password: Option<String>) -> Result<(), String> {
    let mgr = ProfileManager::new(&app);
    let mut profiles = mgr.load()?;

    if let Some(idx) = profiles.iter().position(|p| p.id == profile.id) {
        profiles[idx] = profile.clone();
    } else {
        profiles.push(profile.clone());
    }

    mgr.save(profiles)?;

    if let Some(pwd) = password {
        let key_user = format!("profile:{}", profile.id);
        profile_manager::save_password("servera", &key_user, &pwd)?;
    }

    Ok(())
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
    Ok(())
}

#[tauri::command]
async fn connect_to_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    profile_id: String,
    session_id: String,
) -> Result<String, String> {
    tokio::task::block_in_place(|| {
        let mgr = ProfileManager::new(&app);
        let profiles = mgr.load()?;
        let profile = profiles.iter().find(|p| p.id == profile_id).ok_or("Profile not found")?;

        let key_user = format!("profile:{}", profile_id);
        let password = profile_manager::get_password("servera", &key_user).ok();

        if password.is_none() && profile.private_key_path.is_none() {
            return Err("Password not found and no private key provided".to_string());
        }

        let conn = SshConnection::new(
            &profile.ip, 
            &profile.user, 
            profile.port,
            password.as_deref(), 
            profile.private_key_path.as_deref(),
            profile.proxy_jump.as_deref(),
            &app,
            &session_id
        )?;
        let fingerprint = conn.host_key_fingerprint.clone().unwrap_or_default();

        let session = state.ensure_session(&session_id);
        let mut guard = lock_session(&session);
        *guard = Some(conn);
        drop(guard);

        let exec_conn = SshExecConn::connect(
            &profile.ip, 
            &profile.user, 
            profile.port,
            password.as_deref(), 
            profile.private_key_path.as_deref(),
            profile.proxy_jump.as_deref(),
            &app,
            &session_id
        )?;
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
        let conn = SshConnection::new(&ip, &user, port, password.as_deref(), private_key.as_deref(), proxy_jump.as_deref(), &app, &session_id)?;
        let fingerprint = conn.host_key_fingerprint.clone().unwrap_or_default();

        let session = state.ensure_session(&session_id);
        let mut guard = lock_session(&session);
        *guard = Some(conn);
        drop(guard);

        let exec_conn = SshExecConn::connect(&ip, &user, port, password.as_deref(), private_key.as_deref(), proxy_jump.as_deref(), &app, &session_id)?;
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
            .and_then(|conn| conn.exec_command(&command))
    })
}

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
   SSH CONFIG IMPORT COMMANDS
   ========================= */

#[tauri::command]
fn detect_ssh_config_path() -> ssh_config::DetectResult {
    ssh_config::resolver::detect_ssh_config()
}

#[tauri::command]
fn parse_ssh_config(path: String) -> Result<Vec<ssh_config::parser::SshConfigEntry>, String> {
    let mut seen = Vec::new();
    ssh_config::parser::parse_ssh_config(std::path::Path::new(&path), &mut seen)
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
        
        let monitor = os_support::get_default_monitor();
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
) -> Result<(), String> {
    tokio::task::block_in_place(|| {
        let command = if log_path == "__journalctl__" {
            "journalctl -f --no-pager 2>/dev/null || echo 'journalctl not available'".to_string()
        } else {
            format!("tail -f {} 2>/dev/null || echo 'Cannot stream'", log_path)
        };

        let (session, channel) = ssh_client::open_stream_channel(
            &ip, &user, port,
            password.as_deref(),
            private_key.as_deref(),
            proxy_jump.as_deref(),
            &command,
            &app,
            &session_id,
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
) -> Result<TunnelInfo, String> {
    tokio::task::block_in_place(|| {
        let tunnel = match tunnel_type.as_str() {
            "local" => {
                let rh = remote_host.as_deref().unwrap_or("127.0.0.1");
                let rp = remote_port.unwrap_or(80);
                ssh_client::start_local_forward(
                    &ip, &user, port,
                    password.as_deref(), private_key.as_deref(), proxy_jump.as_deref(),
                    local_port, rh, rp, &app, &session_id,
                )?
            }
            "dynamic" => {
                ssh_client::start_dynamic_forward(
                    &ip, &user, port,
                    password.as_deref(), private_key.as_deref(), proxy_jump.as_deref(),
                    local_port, &app, &session_id,
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
fn list_tunnels(state: State<'_, AppState>) -> Vec<TunnelInfo> {
    let tunnels = state.tunnels.lock().unwrap_or_else(|p| p.into_inner());
    tunnels.iter().map(|(id, t)| TunnelInfo {
        id: id.clone(),
        tunnel_type: t.tunnel_type.clone(),
        local_port: t.local_port,
        remote_host: t.remote_host.clone(),
        remote_port: t.remote_port,
    }).collect()
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

            let session_id = format!("fleet-{}", uuid::Uuid::new_v4());
            match SshExecConn::connect(
                &profile.ip, &profile.user, profile.port,
                password.as_deref(),
                profile.private_key_path.as_deref(),
                profile.proxy_jump.as_deref(),
                &app_clone,
                &session_id,
            ) {
                Ok(conn) => {
                    let output = conn.exec_command(&cmd).unwrap_or_else(|e| e);
                    FleetResult {
                        profile_id: profile.id.clone(),
                        profile_name: if profile.name.is_empty() { format!("{}@{}", profile.user, profile.ip) } else { profile.name.clone() },
                        host: format!("{}@{}:{}", profile.user, profile.ip, profile.port),
                        output,
                        success: true,
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
            resize_terminal,
            exec_ssh_command,
            // Profiles
            save_profile,
            load_profiles,
            delete_profile,
            connect_to_profile,
            // SFTP
            sftp_list,
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
            list_tunnels,
            // Fleet Orchestration
            fleet_run_command,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
