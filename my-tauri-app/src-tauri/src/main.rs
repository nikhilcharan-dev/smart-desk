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
   AUTH PROBE (PHASE 1)
   ========================= */
fn probe_ssh_auth(
    plink: &str,
    ip: &str,
    user: &str,
    password: &str,
) -> Result<(), String> {
    println!("[PROBE] Starting SSH auth probe");

    let output = Command::new(plink)
        .arg("-ssh")
        .arg("-t")          // PTY required
        .arg("-batch")      // no prompts
        .arg("-pw")
        .arg(password)
        .arg(format!("{}@{}", user, ip))
        .arg("exit")
        .output()
        .map_err(|e| format!("SSH spawn failed: {}", e))?;

    println!("[PROBE] exit status: {:?}", output.status);
    println!("[PROBE] stdout:\n{}", String::from_utf8_lossy(&output.stdout));
    println!("[PROBE] stderr:\n{}", String::from_utf8_lossy(&output.stderr));

    if output.status.success() {
        println!("[PROBE] SSH authentication OK");
        return Ok(());
    }

    let stderr = String::from_utf8_lossy(&output.stderr);

    if stderr.contains("Access denied")
        || stderr.contains("password")
    {
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
   START SSH SESSION (PHASE 2)
   ========================= */

#[tauri::command]
fn start_ssh_session(
    app: AppHandle,
    state: State<AppState>,
    ip: String,
    user: String,
    password: String,
) -> Result<(), String> {
    let plink = resolve_plink_path(&app)?;

    // 🔐 Phase 1 — Validate credentials
    probe_ssh_auth(&plink, &ip, &user, &password)?;

    // 🖥️ Phase 2 — Interactive SSH
    let mut child = Command::new(&plink)
        .arg("-ssh")
        .arg("-t")
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

    // 🔥 Stream SSH output to frontend
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
   PLINK PATH RESOLUTION
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
            start_ssh_session,
            send_ssh_input,
            close_ssh_session
        ])
        .run(tauri::generate_context!())
        .expect("error while running app");
}
