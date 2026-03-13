use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use ssh2::{Channel, Session, Sftp};
use tauri::{AppHandle, Emitter};

/// TCP connect timeout in seconds
const CONNECT_TIMEOUT_SECS: u64 = 10;

/// Read buffer size for SSH output polling
const READ_BUF_SIZE: usize = 8192;

/// Chunk size for file transfers (64KB)
const TRANSFER_CHUNK_SIZE: usize = 65536;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

pub struct SshConnection {
    #[allow(dead_code)]
    pub session: Session, // kept alive for Channel RAII lifetime
    pub channel: Channel,
    pub host_key_fingerprint: Option<String>,
}

impl Drop for SshConnection {
    fn drop(&mut self) {
        let _ = self.channel.send_eof();
        let _ = self.channel.wait_eof();
        let _ = self.channel.close();
        let _ = self.channel.wait_close();
    }
}

/// Shell-escape a string for safe interpolation into remote commands.
/// Wraps the value in single quotes and escapes any embedded single quotes.
fn shell_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "'\\''"))
}

impl SshConnection {
    pub fn new(ip: &str, user: &str, password: Option<&str>, private_key: Option<&str>) -> Result<Self, String> {
        // Use connect_timeout to avoid hanging on unreachable hosts
        let addr = format!("{}:22", ip);
        let sock_addr = addr.parse::<std::net::SocketAddr>()
            .or_else(|_| {
                use std::net::ToSocketAddrs;
                addr.to_socket_addrs()
                    .map_err(|e| format!("DNS resolution failed for {}: {}", ip, e))?
                    .next()
                    .ok_or_else(|| format!("Could not resolve host: {}", ip))
            })?;

        let tcp = TcpStream::connect_timeout(&sock_addr, Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .map_err(|e| format!("Connection to {} timed out or failed: {}", ip, e))?;

        let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
        let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

        let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        // Capture host key fingerprint for verification
        let host_key_fingerprint = sess.host_key()
            .map(|(key, _key_type)| {
                key.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(":")
            });

        // Auth Logic
        let mut authenticated = false;

        if let Some(key_path) = private_key {
            if sess.userauth_pubkey_file(user, None, Path::new(key_path), None).is_ok() {
                authenticated = true;
            }
        }

        if !authenticated {
            if let Some(pwd) = password {
                sess.userauth_password(user, pwd).map_err(|e| format!("Authentication failed: {}", e))?;
                authenticated = true;
            }
        }

        if !authenticated {
            return Err("Authentication failed: No valid method succeeded.".into());
        }

        let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
        channel
            .request_pty("xterm-256color", None, Some((80, 24, 0, 0)))
            .map_err(|e| e.to_string())?;
        channel.shell().map_err(|e| e.to_string())?;

        sess.set_blocking(false);

        Ok(Self {
            session: sess,
            channel,
            host_key_fingerprint,
        })
    }

    pub fn send_input(&mut self, data: &str) -> Result<(), String> {
        self.channel
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string())
    }

    pub fn resize(&mut self, cols: u32, rows: u32) -> Result<(), String> {
        self.channel
            .request_pty_size(cols, rows, None, None)
            .map_err(|e| e.to_string())
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SshExecConn — dedicated exec/SFTP connection, separate TCP session so it
// never competes with the terminal PTY read-thread mutex.
// Always kept in blocking mode; no `with_blocking` toggling needed.
// ─────────────────────────────────────────────────────────────────────────────

pub struct SshExecConn {
    pub session: Session,
}

impl SshExecConn {
    pub fn connect(ip: &str, user: &str, password: Option<&str>, private_key: Option<&str>) -> Result<Self, String> {
        let addr = format!("{}:22", ip);
        let sock_addr = addr.parse::<std::net::SocketAddr>()
            .or_else(|_| {
                use std::net::ToSocketAddrs;
                addr.to_socket_addrs()
                    .map_err(|e| format!("DNS resolution failed for {}: {}", ip, e))?
                    .next()
                    .ok_or_else(|| format!("Could not resolve host: {}", ip))
            })?;

        let tcp = TcpStream::connect_timeout(&sock_addr, Duration::from_secs(CONNECT_TIMEOUT_SECS))
            .map_err(|e| format!("Exec connection timed out or failed: {}", e))?;
        let _ = tcp.set_read_timeout(Some(Duration::from_secs(30)));
        let _ = tcp.set_write_timeout(Some(Duration::from_secs(30)));

        let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        sess.set_tcp_stream(tcp);
        sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

        let mut authenticated = false;
        if let Some(key_path) = private_key {
            if sess.userauth_pubkey_file(user, None, Path::new(key_path), None).is_ok() {
                authenticated = true;
            }
        }
        if !authenticated {
            if let Some(pwd) = password {
                sess.userauth_password(user, pwd).map_err(|e| format!("Authentication failed: {}", e))?;
                authenticated = true;
            }
        }
        if !authenticated {
            return Err("Authentication failed: No valid method succeeded.".into());
        }

        sess.set_blocking(true); // always blocking — no terminal read-thread on this session
        Ok(Self { session: sess })
    }

    pub fn exec_command(&self, command: &str) -> Result<String, String> {
        let mut channel = self.session.channel_session().map_err(|e| e.to_string())?;
        channel.exec(command).map_err(|e| e.to_string())?;
        let mut s = String::new();
        channel.read_to_string(&mut s).map_err(|e| e.to_string())?;
        channel.wait_close().ok();
        Ok(s)
    }

    pub fn exec_zip(&self, src: &str, dest: &str) -> Result<String, String> {
        let cmd = format!("zip -r {} {}", shell_escape(dest), shell_escape(src));
        self.exec_command(&cmd)
    }

    pub fn exec_unzip(&self, src: &str, dest: &str) -> Result<String, String> {
        let cmd = format!("unzip {} -d {}", shell_escape(src), shell_escape(dest));
        self.exec_command(&cmd)
    }

    // ── SFTP helpers (all use a caller-provided Sftp handle) ──────────────────

    /// List a directory using an already-open Sftp handle.
    fn list_dir(sftp: &Sftp, path: &str) -> Result<Vec<FileNode>, String> {
        let entries = sftp.readdir(Path::new(path)).map_err(|e| e.to_string())?;
        let mut nodes = Vec::new();
        for (p, stat) in entries {
            let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
            if name == "." || name == ".." { continue; }
            let file_path = if p.is_absolute() {
                p.to_string_lossy().to_string()
            } else {
                format!("{}/{}", path.trim_end_matches('/'), name)
            };
            nodes.push(FileNode { name, path: file_path, is_dir: stat.is_dir(), size: stat.size.unwrap_or(0) });
        }
        nodes.sort_by(|a, b| {
            if a.is_dir == b.is_dir { a.name.to_lowercase().cmp(&b.name.to_lowercase()) }
            else { b.is_dir.cmp(&a.is_dir) }
        });
        Ok(nodes)
    }

    pub fn sftp_list(&self, path: &str) -> Result<Vec<FileNode>, String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        Self::list_dir(&sftp, path)
    }

    pub fn sftp_read(&self, path: &str) -> Result<Vec<u8>, String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        let mut file = sftp.open(Path::new(path)).map_err(|e| e.to_string())?;
        let mut content = Vec::new();
        file.read_to_end(&mut content).map_err(|e| e.to_string())?;
        Ok(content)
    }

    pub fn sftp_exists(&self, path: &str) -> bool {
        self.session.sftp()
            .and_then(|sftp| sftp.stat(Path::new(path)))
            .is_ok()
    }

    pub fn sftp_write(&self, path: &str, content: &[u8]) -> Result<(), String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        let mut file = sftp.create(Path::new(path)).map_err(|e| e.to_string())?;
        file.write_all(content).map_err(|e| e.to_string())
    }

    pub fn sftp_write_sudo(&self, path: &str, content: &[u8]) -> Result<(), String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let temp_path = format!("/tmp/servera_upload_{}", timestamp);
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        let mut file = sftp.create(Path::new(&temp_path)).map_err(|e| e.to_string())?;
        file.write_all(content).map_err(|e| e.to_string())?;
        drop(file); drop(sftp);
        let cmd = format!("sudo cp {} {}", shell_escape(&temp_path), shell_escape(path));
        self.exec_command(&cmd)?;
        let _ = self.exec_command(&format!("rm {}", shell_escape(&temp_path)));
        Ok(())
    }

    pub fn sftp_rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        sftp.rename(Path::new(old_path), Path::new(new_path), None).map_err(|e| e.to_string())
    }

    pub fn sftp_delete(&self, path: &str, is_dir: bool) -> Result<(), String> {
        let sftp = self.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
        if is_dir {
            self.do_sftp_delete_recursive(&sftp, path)
        } else {
            sftp.unlink(Path::new(path)).map_err(|e| format!("Unlink failed: {}", e))
        }
    }

    fn do_sftp_delete_recursive(&self, sftp: &Sftp, path: &str) -> Result<(), String> {
        for node in Self::list_dir(sftp, path)? {
            if node.is_dir {
                self.do_sftp_delete_recursive(sftp, &node.path)?;
            } else {
                sftp.unlink(Path::new(&node.path))
                    .map_err(|e| format!("Failed to delete {}: {}", node.path, e))?;
            }
        }
        sftp.rmdir(Path::new(path)).map_err(|e| format!("rmdir failed: {}", e))
    }

    pub fn sftp_create_dir(&self, path: &str) -> Result<(), String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        sftp.mkdir(Path::new(path), 0o755).map_err(|e| e.to_string())
    }

    pub fn sftp_create_file(&self, path: &str) -> Result<(), String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        sftp.create(Path::new(path)).map_err(|e| e.to_string()).map(|_| ())
    }

    pub fn sftp_delete_sudo(&self, path: &str, is_dir: bool) -> Result<(), String> {
        let cmd = if is_dir {
            format!("sudo rm -rf {}", shell_escape(path))
        } else {
            format!("sudo rm -f {}", shell_escape(path))
        };
        self.exec_command(&cmd).map(|_| ())
    }

    pub fn get_user_info(&self) -> Result<String, String> {
        self.exec_command("whoami; id; groups")
    }

    pub fn sftp_get_permissions(&self, path: &str) -> Result<String, String> {
        self.exec_command(&format!("ls -ld {}", shell_escape(path)))
    }

    pub fn upgrade_access(&self, path: &str, action: &str) -> Result<String, String> {
        let cmd = match action {
            "exec" => format!("chmod +x {}", shell_escape(path)),
            "full" => format!("chmod 777 {}", shell_escape(path)),
            "own" => format!("sudo chown $USER:$USER {}", shell_escape(path)),
            "sudoer" => "sudo usermod -aG sudo $USER || sudo usermod -aG wheel $USER".to_string(),
            _ => return Err("Invalid upgrade action".into()),
        };
        self.exec_command(&cmd)
    }

    // ── Upload ────────────────────────────────────────────────────────────────

    /// Upload a local file or folder to the remote. Opens ONE Sftp subsystem
    /// for the entire operation to avoid repeated open/close cycles that can
    /// corrupt session state on error.
    pub fn sftp_upload(&self, app: &AppHandle, local_path: &str, remote_path: &str) -> Result<(), String> {
        let path = Path::new(local_path);
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        let result = if path.is_dir() {
            self.do_sftp_upload_recursive(app, &sftp, local_path, remote_path, &name)
        } else {
            self.do_sftp_upload_file(app, &sftp, local_path, remote_path, &name, &name)
        };
        // sftp is dropped here — single clean shutdown
        if let Err(ref e) = result {
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Upload failed: {}", e), "error": e.to_string()
            }));
        }
        result
    }

    /// Upload via /tmp then sudo mv — for paths that require elevated permissions.
    pub fn sftp_upload_sudo(&self, app: &AppHandle, local_path: &str, remote_path: &str) -> Result<(), String> {
        let path = Path::new(local_path);
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let temp_remote = format!("/tmp/servera_sudo_{}", timestamp);

        // Upload to /tmp/ first (user always has write access there)
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        let result = if path.is_dir() {
            self.do_sftp_upload_recursive(app, &sftp, local_path, &temp_remote, &name)
        } else {
            self.do_sftp_upload_file(app, &sftp, local_path, &temp_remote, &name, &name)
        };
        drop(sftp); // close sftp before exec commands

        if let Err(ref e) = result {
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Upload failed: {}", e), "error": e.to_string()
            }));
            return result;
        }

        // Move from temp to final destination with sudo
        let mv_cmd = format!("sudo mv -f {} {}", shell_escape(&temp_remote), shell_escape(remote_path));
        if let Err(e) = self.exec_command(&mv_cmd) {
            let _ = self.exec_command(&format!("rm -rf {}", shell_escape(&temp_remote)));
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Sudo move failed: {}", e), "error": e.to_string()
            }));
            return Err(format!("Sudo move failed: {}", e));
        }

        let _ = app.emit("transfer-progress", serde_json::json!({
            "root_name": name, "filename": name, "status": "finished", "progress": 1.0,
            "details": format!("Uploaded {} (with sudo)", name)
        }));
        Ok(())
    }

    fn do_sftp_upload_file(
        &self,
        app: &AppHandle,
        sftp: &Sftp,
        local_path: &str,
        remote_path: &str,
        filename: &str,
        root_name: &str,
    ) -> Result<(), String> {
        let local_file = std::fs::File::open(local_path).map_err(|e| e.to_string())?;
        let file_size = local_file.metadata().map(|m| m.len()).unwrap_or(0);
        let mut reader = std::io::BufReader::new(local_file);
        let mut remote_file = sftp.create(Path::new(remote_path)).map_err(|e| e.to_string())?;
        let mut transferred: u64 = 0;
        let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
        loop {
            let n = reader.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            remote_file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            transferred += n as u64;
            let progress = if file_size > 0 { transferred as f64 / file_size as f64 } else { 1.0 };
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": root_name, "filename": filename, "status": "uploading", "progress": progress,
                "details": format!("Uploading {} ({:.1}MB/{:.1}MB)", filename, transferred as f64/1_048_576.0, file_size as f64/1_048_576.0)
            }));
        }
        let _ = app.emit("transfer-progress", serde_json::json!({
            "root_name": root_name, "filename": filename, "status": "finished", "progress": 1.0,
            "details": format!("Uploaded {}", filename)
        }));
        Ok(())
    }

    fn do_sftp_upload_recursive(
        &self,
        app: &AppHandle,
        sftp: &Sftp,
        local_path: &str,
        remote_path: &str,
        root_name: &str,
    ) -> Result<(), String> {
        // Create the root remote directory; surface errors (unlike before where they were silently ignored)
        sftp.mkdir(Path::new(remote_path), 0o755)
            .map_err(|e| format!("Cannot create remote directory {}: {}", remote_path, e))?;

        let local_root = Path::new(local_path);
        let entries: Vec<_> = walkdir::WalkDir::new(local_path).into_iter().filter_map(|e| e.ok()).collect();
        let total = entries.len();
        for (i, entry) in entries.iter().enumerate() {
            let path = entry.path();
            let relative = path.strip_prefix(local_root).map_err(|e| e.to_string())?;
            // Skip the root entry itself (relative == "")
            if relative.as_os_str().is_empty() { continue; }
            let remote_item_str = Path::new(remote_path).join(relative).to_string_lossy().replace('\\', "/");
            let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
            if path.is_dir() {
                sftp.mkdir(Path::new(&remote_item_str), 0o755).ok(); // sub-dirs: best effort
            } else {
                let _ = app.emit("transfer-progress", serde_json::json!({
                    "root_name": root_name, "filename": name, "status": "uploading",
                    "progress": (i as f32 / total as f32),
                    "details": format!("Uploading {} ({}/{})", name, i + 1, total)
                }));
                self.do_sftp_upload_file(app, sftp, &path.to_string_lossy(), &remote_item_str, &name, root_name)?;
            }
        }
        let _ = app.emit("transfer-progress", serde_json::json!({
            "root_name": root_name, "status": "finished", "progress": 1.0, "details": "Upload completed"
        }));
        Ok(())
    }

    // ── Download ──────────────────────────────────────────────────────────────

    /// Download a remote file or folder to local. Opens ONE Sftp subsystem
    /// for the entire operation.
    pub fn sftp_download(&self, app: &AppHandle, remote_path: &str, local_path: &str) -> Result<(), String> {
        let name = Path::new(remote_path).file_name().unwrap_or_default().to_string_lossy().to_string();
        let result = (|| -> Result<(), String> {
            let sftp = self.session.sftp().map_err(|e| e.to_string())?;
            let stat = sftp.stat(Path::new(remote_path)).map_err(|e| e.to_string())?;
            if stat.is_dir() {
                self.do_sftp_download_recursive(app, &sftp, remote_path, local_path, &name)
            } else {
                self.do_sftp_download_file(app, &sftp, remote_path, local_path, &name, &name, stat.size.unwrap_or(0))
            }
            // sftp dropped here — single clean shutdown
        })();
        if let Err(ref e) = result {
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Download failed: {}", e), "error": e.to_string()
            }));
        }
        result
    }

    fn do_sftp_download_file(
        &self,
        app: &AppHandle,
        sftp: &Sftp,
        remote_path: &str,
        local_path: &str,
        filename: &str,
        root_name: &str,
        file_size: u64,
    ) -> Result<(), String> {
        let mut remote_file = sftp.open(Path::new(remote_path)).map_err(|e| e.to_string())?;
        let mut local_file = std::fs::File::create(local_path).map_err(|e| e.to_string())?;
        let mut transferred: u64 = 0;
        let mut buf = vec![0u8; TRANSFER_CHUNK_SIZE];
        loop {
            let n = remote_file.read(&mut buf).map_err(|e| e.to_string())?;
            if n == 0 { break; }
            local_file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
            transferred += n as u64;
            let progress = if file_size > 0 { transferred as f64 / file_size as f64 } else { 1.0 };
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": root_name, "filename": filename, "status": "downloading", "progress": progress,
                "details": format!("Downloading {} ({:.1}MB/{:.1}MB)", filename, transferred as f64/1_048_576.0, file_size as f64/1_048_576.0)
            }));
        }
        let _ = app.emit("transfer-progress", serde_json::json!({
            "root_name": root_name, "filename": filename, "status": "finished", "progress": 1.0,
            "details": format!("Downloaded {}", filename)
        }));
        Ok(())
    }

    fn do_sftp_download_recursive(
        &self,
        app: &AppHandle,
        sftp: &Sftp,
        remote_path: &str,
        local_path: &str,
        root_name: &str,
    ) -> Result<(), String> {
        std::fs::create_dir_all(local_path).map_err(|e| e.to_string())?;
        for node in Self::list_dir(sftp, remote_path)? {
            let local_item_str = Path::new(local_path).join(&node.name).to_string_lossy().to_string();
            if node.is_dir {
                self.do_sftp_download_recursive(app, sftp, &node.path, &local_item_str, root_name)?;
            } else {
                self.do_sftp_download_file(app, sftp, &node.path, &local_item_str, &node.name, root_name, node.size)?;
            }
        }
        let _ = app.emit("transfer-progress", serde_json::json!({
            "root_name": root_name, "status": "finished", "progress": 1.0, "details": "Download completed"
        }));
        Ok(())
    }
}

pub fn spawn_read_thread(
    session_id: String,
    connection: Arc<Mutex<Option<SshConnection>>>,
    app_handle: AppHandle,
) {
    thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];
        let event_name = format!("ssh-output:{}", session_id);

        loop {
            {
                // Recover from poisoned mutex instead of panicking
                let mut guard = match connection.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };

                if let Some(conn) = guard.as_mut() {
                    match conn.channel.read(&mut buf) {
                        Ok(n) if n > 0 => {
                            let data = String::from_utf8_lossy(&buf[..n]).to_string();
                            let _ = app_handle.emit(&event_name, data);
                        }
                        Ok(_) => {}
                        Err(e) => {
                            if e.kind() != std::io::ErrorKind::WouldBlock {
                                let _ = app_handle.emit(&format!("ssh-error:{}", session_id), e.to_string());
                                break;
                            }
                        }
                    }
                } else {
                    break;
                }
            }
            thread::sleep(Duration::from_millis(10));
        }
    });
}
