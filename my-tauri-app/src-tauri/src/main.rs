#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    io::{Read, Write},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
};

use tauri::{AppHandle, Emitter, Manager, State};

/* =========================
   STATE
   ========================= */

struct SshSession {
    child: Child,
    stdin: ChildStdin,
}

struct AppState {
    session: Arc<Mutex<Option<SshSession>>>,
}

/* =========================
   HOST FINGERPRINT PROBE
   ========================= */

#[tauri::command]
fn probe_ssh_host(app: AppHandle, ip: String) -> Result<String, String> {
    let plink = resolve_plink_path(&app)?;

    println!("[HOST PROBE] Fetching fingerprint for {}", ip);

    let output = Command::new(&plink)
        .arg("-ssh")
        .arg("-batch")
        .arg("-no-antispoof")
        .arg(format!("dummy@{}", ip))
        .output()
        .map_err(|e| format!("Host probe failed: {}", e))?;

    let stderr = String::from_utf8_lossy(&output.stderr);

    println!("[HOST PROBE] stderr:\n{}", stderr);

    for line in stderr.lines() {
        if line.contains("SHA256:") {
            let fp = line.trim().to_string();
            println!("[HOST PROBE] Fingerprint found: {}", fp);
            return Ok(fp);
        }
    }

    Err("Unable to extract server fingerprint".into())
}

/* =========================
   AUTH PROBE (WITH TRUST)
   ========================= */

fn probe_ssh_auth(
    plink: &str,
    ip: &str,
    user: &str,
    password: &str,
    fingerprint: &str,
) -> Result<(), String> {
    println!("[AUTH PROBE] Verifying credentials for {}@{}", user, ip);

    let output = Command::new(plink)
        .arg("-ssh")
        .arg("-t")
        .arg("-batch")
        .arg("-hostkey")
        .arg(fingerprint)
        .arg("-pw")
        .arg(password)
        .arg(format!("{}@{}", user, ip))
        .arg("exit")
        .output()
        .map_err(|e| format!("Auth probe failed: {}", e))?;

    println!("[AUTH PROBE] status: {:?}", output.status);
    println!(
        "[AUTH PROBE] stderr:\n{}",
        String::from_utf8_lossy(&output.stderr)
    );

    if output.status.success() {
        println!("[AUTH PROBE] Authentication OK");
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);

    if stderr.contains("Access denied") || stderr.contains("password") {
        return Err("Invalid username or password".into());
    }

    if stderr.contains("Network error")
        || stderr.contains("Connection refused")
        || stderr.contains("timed out")
    {
        return Err("Unable to reach server".into());
    }

    Err("SSH authentication failed".into())
}

/* =========================
   START SSH SESSION
   ========================= */

#[tauri::command]
fn start_ssh_session(
    app: AppHandle,
    state: State<AppState>,
    ip: String,
    user: String,
    password: String,
    fingerprint: String, // 👈 from frontend trust dialog
) -> Result<(), String> {
    let plink = resolve_plink_path(&app)?;

    // 🔐 Phase 1 — verify credentials with trusted fingerprint
    probe_ssh_auth(&plink, &ip, &user, &password, &fingerprint)?;

    println!("[SSH] Starting interactive session");

    let mut child = Command::new(&plink)
        .arg("-ssh")
        .arg("-t")
        .arg("-hostkey")
        .arg(&fingerprint)
        .arg("-pw")
        .arg(password)
        .arg(format!("{}@{}", user, ip))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start SSH: {}", e))?;

    let stdin = child.stdin.take().ok_or("stdin failed")?;
    let mut stdout = child.stdout.take().ok_or("stdout failed")?;

    let app_handle = app.clone();

    // 🔥 Stream SSH output
    thread::spawn(move || {
        let mut buf = [0u8; 1024];
        loop {
            match stdout.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let text = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_handle.emit("ssh-output", text);
                }
                Err(_) => break,
            }
        }
    });

    *state.session.lock().unwrap() = Some(SshSession { child, stdin });

    Ok(())
}

/* =========================
   SEND INPUT
   ========================= */

#[tauri::command]
fn send_ssh_input(state: State<AppState>, input: String) -> Result<(), String> {
    let mut guard = state.session.lock().unwrap();
    let session = guard.as_mut().ok_or("No active SSH session")?;

    if let Ok(Some(_)) = session.child.try_wait() {
        return Err("SSH session exited".into());
    }

    session
        .stdin
        .write_all(input.as_bytes())
        .map_err(|e| e.to_string())?;

    Ok(())
}

/* =========================
   CLOSE SESSION
   ========================= */

#[tauri::command]
fn close_ssh_session(state: State<AppState>) {
    if let Some(mut sess) = state.session.lock().unwrap().take() {
        let _ = sess.child.kill();
    }
}

/* =========================
   PLINK PATH
   ========================= */

fn resolve_plink_path(app: &AppHandle) -> Result<String, String> {
    if let Ok(dir) = app.path().resource_dir() {
        let p = dir.join("plink.exe");
        if p.exists() {
            return Ok(p.to_string_lossy().to_string());
        }
    }

    let dev = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("resources")
        .join("plink.exe");

    if dev.exists() {
        return Ok(dev.to_string_lossy().to_string());
    }

    Err("plink.exe not found".into())
}

/* =========================
   MAIN
   ========================= */

fn main() {
    tauri::Builder::default()
        .manage(AppState {
            session: Arc::new(Mutex::new(None)),
        })
        .invoke_handler(tauri::generate_handler![
            probe_ssh_host,
            start_ssh_session,
            send_ssh_input,
            close_ssh_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}
