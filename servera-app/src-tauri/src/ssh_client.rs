use base64::Engine as _;
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::Duration;
use ssh2::{Channel, Session, Sftp};
use tauri::{AppHandle, Emitter, Manager};
use socket2::{SockRef, TcpKeepalive};

/// TCP connect timeout in seconds
const CONNECT_TIMEOUT_SECS: u64 = 10;

/// Read buffer size for SSH output polling
const READ_BUF_SIZE: usize = 8192;

/// PTY read pacing. The interactive channel is non-blocking, so its reader has
/// to sleep between attempts. It polls tight while output is arriving and backs
/// off geometrically once the channel goes quiet, reaching the ceiling after
/// roughly a quarter second of silence.
const READ_POLL_MIN: Duration = Duration::from_millis(1);
const READ_POLL_MAX: Duration = Duration::from_millis(120);

/// Reads per pass before the reader yields the session lock, so a flood of
/// output cannot starve `send_ssh_input`.
const MAX_READS_PER_PASS: usize = 8;

/// How often an idle connection is pinged so it survives until logout.
/// The interactive PTY has its own 10s ping inside `spawn_read_thread`; this
/// covers the exec connection and every proxy-jump hop, which are otherwise
/// only pinged as a side-effect of a command being run.
const KEEPALIVE_INTERVAL_SECS: u64 = 20;

/// Chunk size for file transfers (64KB)
const TRANSFER_CHUNK_SIZE: usize = 4194304; // 4MB chunks for faster SFTP transfer

#[derive(Serialize, Deserialize, Clone, Debug, Copy, PartialEq)]
pub enum RemoteOs {
    Linux,
    Darwin, // macOS
    Windows,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FileNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub size: u64,
}

/// Full result of a one-shot remote command.
#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CmdOutput {
    pub stdout: String,
    pub stderr: String,
    pub code: i32,
}

impl RemoteOs {
    pub fn from_str(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "darwin" => RemoteOs::Darwin,
            "windows" => RemoteOs::Windows,
            _ => RemoteOs::Linux,
        }
    }

    pub fn as_str(&self) -> &'static str {
        match self {
            RemoteOs::Linux => "linux",
            RemoteOs::Darwin => "darwin",
            RemoteOs::Windows => "windows",
        }
    }
}

/// Lets whoever writes to a PTY wake that session's reader thread.
///
/// The reader polls a non-blocking channel, and a fixed 10ms poll meant 100
/// wakeups a second per terminal — each taking the session lock — with nothing
/// happening. Backing off while the channel is quiet fixes that, but a
/// backed-off reader would add its remaining sleep to the echo latency of a
/// keystroke. So sending input signals this, and the reader polls at once
/// instead of waiting out the backoff.
pub struct ReadPacer {
    nudged: Mutex<bool>,
    ready: Condvar,
}

impl ReadPacer {
    fn new() -> Self {
        Self { nudged: Mutex::new(false), ready: Condvar::new() }
    }

    /// Ask the reader to poll now.
    pub fn nudge(&self) {
        let mut pending = self.nudged.lock().unwrap_or_else(|p| p.into_inner());
        *pending = true;
        self.ready.notify_all();
    }

    /// Sleep until `dur` elapses or a nudge arrives, whichever is first.
    /// Returns true when it was a nudge, so the caller can drop back to a tight
    /// poll. A nudge that landed while the caller was busy is not lost — it is
    /// still pending here and consumed on entry.
    pub fn wait(&self, dur: Duration) -> bool {
        let mut pending = self.nudged.lock().unwrap_or_else(|p| p.into_inner());
        if *pending {
            *pending = false;
            return true;
        }
        let (mut pending, _) = self.ready
            .wait_timeout(pending, dur)
            .unwrap_or_else(|p| p.into_inner());
        let was_nudged = *pending;
        *pending = false;
        was_nudged
    }
}

pub struct SshConnection {
    #[allow(dead_code)]
    pub session: Session, // kept alive for Channel RAII lifetime
    pub channel: Channel,
    pub host_key_fingerprint: Option<String>,
    /// Shared with this session's reader thread. See ReadPacer.
    pub pacer: Arc<ReadPacer>,
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

/// Escape a string for a PowerShell single-quoted literal: `'` is doubled.
/// The returned value INCLUDES the surrounding single quotes, so callers drop
/// the literal quotes they previously wrapped the `{}` in. Without this, a
/// filename containing `'` closes the quote and the rest executes.
pub fn ps_escape(s: &str) -> String {
    format!("'{}'", s.replace('\'', "''"))
}




impl SshConnection {
    pub fn new(
        ip: &str, 
        user: &str, 
        port: u16,
        password: Option<&str>, 
        private_key: Option<&str>,
        proxy_jump: Option<&str>,
        app: &AppHandle,
        session_id: &str
    ) -> Result<Self, String> {
        let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        establish_session(&mut sess, ip, port, user, password, private_key, proxy_jump, app, session_id)?;

        let host_key_fingerprint = sess.host_key()
            .map(|(key, _key_type)| {
                key.iter().map(|b| format!("{:02x}", b)).collect::<Vec<_>>().join(":")
            });

        let mut channel = sess.channel_session().map_err(|e| e.to_string())?;
        channel
            .request_pty("xterm-256color", None, Some((80, 24, 0, 0)))
            .map_err(|e| e.to_string())?;
        channel.shell().map_err(|e| e.to_string())?;

        sess.set_blocking(false);
        sess.set_keepalive(true, 10);

        Ok(Self {
            session: sess,
            channel,
            host_key_fingerprint,
            pacer: Arc::new(ReadPacer::new()),
        })
    }

    pub fn send_input(&mut self, data: &str) -> Result<(), String> {
        let written = self.channel
            .write_all(data.as_bytes())
            .map_err(|e| e.to_string());
        // The echo for this input is already on its way back, so have the
        // reader look for it now rather than at the end of its current backoff.
        if written.is_ok() {
            self.pacer.nudge();
        }
        written
    }

    pub fn resize(&mut self, cols: u32, rows: u32) -> Result<(), String> {
        let resized = self.channel
            .request_pty_size(cols, rows, None, None)
            .map_err(|e| e.to_string());
        // A resize usually makes the far side redraw.
        if resized.is_ok() {
            self.pacer.nudge();
        }
        resized
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authentication & Jump Host Helpers
// ─────────────────────────────────────────────────────────────────────────────

struct MfaPrompter<'a> {
    app: &'a AppHandle,
    session_id: &'a str,
}

impl<'a> ssh2::KeyboardInteractivePrompt for MfaPrompter<'a> {
    fn prompt(
        &mut self,
        name: &str,
        instruction: &str,
        prompts: &[ssh2::Prompt],
    ) -> Vec<String> {
        let mut ui_prompts = Vec::new();
        for p in prompts {
            ui_prompts.push(serde_json::json!({
                "text": p.text,
                "echo": p.echo,
            }));
        }

        let (tx, rx) = tokio::sync::oneshot::channel();
        let state: tauri::State<crate::AppState> = self.app.state();
        state.register_mfa(self.session_id, tx);

        let _ = self.app.emit("mfa-requested", serde_json::json!({
            "session_id": self.session_id,
            "name": name,
            "instruction": instruction,
            "prompts": ui_prompts,
        }));

        // Block current thread waiting for response with a 5-minute timeout.
        let timeout_duration = std::time::Duration::from_secs(300);
        match tokio::runtime::Handle::current().block_on(tokio::time::timeout(timeout_duration, rx)) {
            Ok(Ok(response)) => response,
            _ => Vec::new(),
        }
    }
}

fn authenticate_session(
    sess: &mut Session,
    user: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    app: &AppHandle,
    session_id: &str
) -> Result<(), String> {
    let mut authenticated = false;

    // 1. Try ssh-agent / Pageant first (covers hardware keys like YubiKey and SSH certificates)
    if !authenticated {
        if let Ok(mut agent) = sess.agent() {
            if agent.connect().is_ok() {
                if agent.list_identities().is_ok() {
                    for identity in agent.identities().unwrap_or_default() {
                        if agent.userauth(user, &identity).is_ok() {
                            authenticated = true;
                            break;
                        }
                    }
                }
                let _ = agent.disconnect();
            }
        }
    }

    // 2. Explicit private key file
    if !authenticated {
        if let Some(key_path) = private_key {
            if sess.userauth_pubkey_file(user, None, Path::new(key_path), None).is_ok() {
                authenticated = true;
            }
        }
    }

    // 3. Password auth
    if !authenticated {
        if let Some(pwd) = password {
            if sess.userauth_password(user, pwd).is_ok() {
                authenticated = true;
            }
        }
    }

    // 4. Keyboard-interactive (MFA / 2FA)
    if !authenticated {
        let auth_methods = sess.auth_methods(user).unwrap_or_default();
        if auth_methods.contains("keyboard-interactive") {
            let mut prompter = MfaPrompter { app, session_id };
            if sess.userauth_keyboard_interactive(user, &mut prompter).is_ok() {
                authenticated = true;
            }
        }
    }

    if !authenticated {
        return Err("Authentication failed: No valid method succeeded.".into());
    }
    Ok(())
}

fn establish_session(
    sess: &mut Session,
    ip: &str,
    port: u16,
    user: &str,
    password: Option<&str>,
    private_key: Option<&str>,
    proxy_jump: Option<&str>,
    app: &AppHandle,
    session_id: &str
) -> Result<(), String> {
    if let Some(jump) = proxy_jump {
        let hops: Vec<&str> = jump.split(',').collect();
        let next_jump = if hops.len() > 1 { Some(hops[1..].join(",")) } else { None };
        let first_hop = hops[0];

        let (jump_user, jump_host) = if let Some(at_idx) = first_hop.find('@') {
            (&first_hop[..at_idx], &first_hop[at_idx+1..])
        } else {
            ("root", first_hop)
        };

        let (jump_ip, jump_port) = if let Some(colon_idx) = jump_host.find(':') {
            (&jump_host[..colon_idx], jump_host[colon_idx+1..].parse().unwrap_or(22))
        } else {
            (jump_host, 22)
        };

        let mut jump_sess = Session::new().map_err(|e| e.to_string())?;
        establish_session(&mut jump_sess, jump_ip, jump_port, jump_user, None, None, next_jump.as_deref(), app, session_id)?;

        let channel = jump_sess.channel_direct_tcpip(ip, port, None).map_err(|e| e.to_string())?;
        
        // ── Loopback Bridge Strategy (to satisfy AsRawSocket) ──
        // We cannot use 'channel' as transport directly because it's not a raw socket.
        // We create a local listener, connect to it, and pipe data bidirectionally.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
        let addr = listener.local_addr().unwrap();

        let client_sock = std::net::TcpStream::connect(addr).map_err(|e| e.to_string())?;
        let expected_peer = client_sock.local_addr().map_err(|e| e.to_string())?;

        // Only accept OUR own connection. Any other local process that races to
        // connect to this ephemeral port would otherwise be handed a plaintext
        // pipe into the jump-host channel, so we keep accepting until the peer
        // address matches the socket we just dialed out on.
        let server_sock = loop {
            let (sock, peer) = listener.accept().map_err(|e| e.to_string())?;
            if peer == expected_peer {
                break sock;
            }
            drop(sock);
        };
        drop(listener); // stop accepting once the bridge is established

        // Setup piping
        let mut chan_reader = channel;
        let mut chan_writer = chan_reader.clone();
        let mut server_reader = server_sock;
        let mut server_writer = server_reader.try_clone().map_err(|e| e.to_string())?;

        // Liveness token for the bridge: both piping threads hold a clone, so
        // the Arc is only fully dropped once BOTH directions have closed — i.e.
        // once this hop is genuinely dead. The keepalive thread below watches it
        // through a Weak and retires with the bridge instead of leaking.
        let bridge_alive = Arc::new(());
        let alive_up = bridge_alive.clone();
        let alive_down = bridge_alive.clone();

        std::thread::spawn(move || {
            let _alive = alive_up;
            let _ = std::io::copy(&mut chan_reader, &mut server_writer);
        });
        std::thread::spawn(move || {
            let _alive = alive_down;
            let _ = std::io::copy(&mut server_reader, &mut chan_writer);
        });

        // Keep the jump hop itself awake. The TCP keepalive configured below is
        // applied to the 127.0.0.1 bridge socket, which says nothing about the
        // real link to the jump host, and nothing else ever pings this session —
        // so an idle proxy-jump/WireGuard connection used to be dropped upstream.
        // Owning `jump_sess` here also keeps the hop alive for the bridge's
        // lifetime rather than until the end of this scope.
        let bridge_watch = Arc::downgrade(&bridge_alive);
        drop(bridge_alive);
        std::thread::spawn(move || {
            loop {
                thread::sleep(Duration::from_secs(KEEPALIVE_INTERVAL_SECS));
                if bridge_watch.upgrade().is_none() {
                    break;
                }
                if jump_sess.keepalive_send().is_err() {
                    break;
                }
            }
        });

        let _ = client_sock.set_nodelay(true);
        let _ = client_sock.set_read_timeout(None);
        let _ = client_sock.set_write_timeout(None);
        let sock_ref = SockRef::from(&client_sock);
        let mut ka = TcpKeepalive::new();
        ka = ka.with_time(Duration::from_secs(10));
        ka = ka.with_interval(Duration::from_secs(5));
        let _ = sock_ref.set_tcp_keepalive(&ka);

        sess.set_tcp_stream(client_sock);
    } else {
        let addr = format!("{}:{}", ip, port);
        let tcp = TcpStream::connect_timeout(
            &addr.to_socket_addrs().map_err(|e| e.to_string())?.next().ok_or("DNS failed")?, 
            Duration::from_secs(CONNECT_TIMEOUT_SECS)
        ).map_err(|e| format!("Connection to {} failed: {}", ip, e))?;

        let _ = tcp.set_nodelay(true);
        let _ = tcp.set_read_timeout(None);
        let _ = tcp.set_write_timeout(None);
        let sock_ref = SockRef::from(&tcp);
        let mut ka = TcpKeepalive::new();
        ka = ka.with_time(Duration::from_secs(10));
        ka = ka.with_interval(Duration::from_secs(5));
        let _ = sock_ref.set_tcp_keepalive(&ka);
        sess.set_tcp_stream(tcp);
    }

    sess.set_timeout(30_000);
    sess.handshake().map_err(|e| format!("SSH handshake failed: {}", e))?;

    // Verify the host key (TOFU) BEFORE sending any credentials. Skipped for
    // loopback dials — those are the WireGuard gateway's dynamic 127.0.0.1
    // forwards, whose far side is already authenticated by the WireGuard tunnel.
    if !crate::known_hosts::is_loopback_host(ip) {
        if let Some((key, key_type)) = sess.host_key() {
            let fp = crate::known_hosts::fingerprint_hex(key);
            let kt = crate::known_hosts::key_type_name(key_type);
            crate::known_hosts::verify(app, session_id, ip, port, &fp, kt)?;
        } else {
            return Err("Server presented no host key — refusing to connect.".into());
        }
    }

    authenticate_session(sess, user, password, private_key, app, session_id)?;
    sess.set_keepalive(true, 10);
    Ok(())
}

pub struct SshExecConn {
    pub session: Session,
    pub remote_os: RemoteOs,
    /// True when the login user is already root (uid 0). Elevation is then a
    /// no-op and every `exec_elevated`/sudo path runs the command directly.
    pub is_root: bool,
    /// Sudo password for this profile, resolved from the OS keyring at connect
    /// time. `None` for ad-hoc sessions or profiles without one stored — the
    /// elevation path then falls back to passwordless (`sudo -n`) only.
    pub sudo_password: Option<String>,
}

impl SshExecConn {
    pub fn connect(
        ip: &str,
        user: &str,
        port: u16,
        password: Option<&str>,
        private_key: Option<&str>,
        proxy_jump: Option<&str>,
        app: &AppHandle,
        session_id: &str,
        fixed_os: Option<RemoteOs>
    ) -> Result<Self, String> {
        let mut sess = Session::new().map_err(|e| format!("Failed to create SSH session: {}", e))?;
        establish_session(&mut sess, ip, port, user, password, private_key, proxy_jump, app, session_id)?;
        sess.set_blocking(true);
        sess.set_keepalive(true, 15);

        let remote_os = if let Some(os) = fixed_os {
            os
        } else {
            Self::detect_os(&sess)
        };

        let is_root = Self::detect_root(&sess, remote_os);

        Ok(Self { session: sess, remote_os, is_root, sudo_password: None })
    }

    /// Store the sudo password after construction. Kept out of `connect`'s
    /// signature so both the profile and ad-hoc connect paths stay unchanged.
    pub fn set_sudo_password(&mut self, pw: Option<String>) {
        self.sudo_password = pw;
    }

    /// Detect whether the login user is root. On Unix, `id -u` == 0. Windows has
    /// no sudo model, so it is always treated as non-root (elevation is skipped
    /// for Windows in the exec paths regardless).
    fn detect_root(sess: &Session, remote_os: RemoteOs) -> bool {
        if remote_os == RemoteOs::Windows {
            return false;
        }
        if let Ok(mut ch) = sess.channel_session() {
            if ch.exec("id -u").is_ok() {
                let mut s = String::new();
                let _ = ch.read_to_string(&mut s);
                return s.trim() == "0";
            }
        }
        false
    }

    fn detect_os(sess: &Session) -> RemoteOs {
        // 1. Try 'uname -s'
        if let Ok(mut ch) = sess.channel_session() {
            if ch.exec("uname -s").is_ok() {
                let mut s = String::new();
                let _ = ch.read_to_string(&mut s);
                let name = s.trim().to_lowercase();
                if name.contains("linux") { return RemoteOs::Linux; }
                if name.contains("darwin") { return RemoteOs::Darwin; }
            }
        }

        // 2. Try 'ver' for Windows
        if let Ok(mut ch) = sess.channel_session() {
            if ch.exec("ver").is_ok() {
                let mut s = String::new();
                let _ = ch.read_to_string(&mut s);
                if s.to_lowercase().contains("windows") { return RemoteOs::Windows; }
            }
        }

        // 3. Fallback to Linux
        RemoteOs::Linux
    }

    /// Run a command on its own channel, capturing stdout, stderr AND the exit
    /// status. Returns Err only on a transport/channel failure — a non-zero
    /// exit is reported in `code`, so the caller decides what it means.
    pub fn exec_command_full(&self, command: &str) -> Result<CmdOutput, String> {
        let _ = self.session.keepalive_send();
        let mut channel = self.session.channel_session().map_err(|e| e.to_string())?;
        channel.exec(command).map_err(|e| e.to_string())?;
        let mut stdout = String::new();
        channel.read_to_string(&mut stdout).map_err(|e| e.to_string())?;
        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr).ok();
        channel.wait_close().ok();
        let code = channel.exit_status().unwrap_or(-1);
        Ok(CmdOutput { stdout, stderr, code })
    }

    /// Convenience wrapper preserving the historical lenient contract while no
    /// longer swallowing failures. stdout is returned whenever present — many
    /// tools (e.g. `systemctl is-active` on an inactive unit) exit non-zero yet
    /// print useful output — but a failure that produced ONLY stderr now
    /// surfaces as an error instead of the old silent empty success.
    pub fn exec_command(&self, command: &str) -> Result<String, String> {
        let r = self.exec_command_full(command)?;
        if r.code == 0 || !r.stdout.trim().is_empty() {
            Ok(r.stdout)
        } else if !r.stderr.trim().is_empty() {
            Err(r.stderr.trim().to_string())
        } else {
            Err(format!("Command failed (exit {})", r.code))
        }
    }

    // ── Privilege escalation (sudo) ───────────────────────────────────────────
    //
    // Sentinel errors the frontend can branch on rather than showing raw text.
    // `PASSWORD_REQUIRED` → prompt the user to add a sudo password to the
    // profile; `PASSWORD_INCORRECT` → the stored password was rejected.
    pub const SUDO_PASSWORD_REQUIRED: &'static str = "SUDO_PASSWORD_REQUIRED";
    pub const SUDO_PASSWORD_INCORRECT: &'static str = "SUDO_PASSWORD_INCORRECT";

    /// Heuristic: does this failed result look like it failed for lack of
    /// privileges (rather than a genuine error)? Used to decide whether an
    /// auto-fallback escalation is worth attempting.
    ///
    /// Two distinct shapes count. The first is the command itself being refused
    /// ("permission denied"). The second is a command that already contains its
    /// own `sudo` — most of the manager panels build commands like
    /// `sudo systemctl restart …` — failing because that inner sudo had no way
    /// to ask for a password over a non-interactive channel. Both are fixed by
    /// re-running through the elevation ladder, which supplies the password (or
    /// NOPASSWD) that the bare attempt lacked.
    fn looks_like_permission_failure(out: &CmdOutput) -> bool {
        if out.code == 0 {
            return false;
        }
        let hay = format!("{}\n{}", out.stdout, out.stderr).to_lowercase();
        [
            // Refused outright
            "permission denied",
            "operation not permitted",
            "must be root",
            "are you root",
            "you do not have permission",
            "access denied",
            "not permitted",
            "eacces",
            "eperm",
            // systemd/polkit's way of saying "you are not root"
            "interactive authentication required",
            // An embedded sudo that could not prompt
            "a password is required",
            "a terminal is required",
            "no tty present",
            "askpass",
            "sudo: a password",
        ]
        .iter()
        .any(|needle| hay.contains(needle))
    }

    /// Run `command` under sudo, feeding the stored password on stdin via
    /// `sudo -S`. The channel is opened WITHOUT a PTY so the password we write
    /// is not echoed back into the captured output. `-p ''` suppresses sudo's
    /// own prompt text. The inner command is passed to `sh -c` so pipes and
    /// redirection inside `command` still work under elevation.
    fn exec_sudo_with_password(&self, command: &str, pw: &str) -> Result<CmdOutput, String> {
        let wrapped = format!("sudo -S -p '' -- sh -c {}", shell_escape(command));
        let mut channel = self.session.channel_session().map_err(|e| e.to_string())?;
        channel.exec(&wrapped).map_err(|e| e.to_string())?;
        // Send the password, then EOF so a command that also reads stdin does
        // not block waiting for more input.
        channel
            .write_all(format!("{}\n", pw).as_bytes())
            .map_err(|e| e.to_string())?;
        channel.send_eof().ok();

        let mut stdout = String::new();
        channel.read_to_string(&mut stdout).map_err(|e| e.to_string())?;
        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr).ok();
        channel.wait_close().ok();
        let code = channel.exit_status().unwrap_or(-1);

        let low = stderr.to_lowercase();
        if code != 0 && (low.contains("try again") || low.contains("incorrect password") || low.contains("sorry")) {
            return Err(Self::SUDO_PASSWORD_INCORRECT.to_string());
        }
        Ok(CmdOutput { stdout, stderr, code })
    }

    /// Run `command` with elevation, no plain attempt first. Order:
    /// `sudo -n` (passwordless / NOPASSWD) → `sudo -S` with the stored password.
    /// Returns `SUDO_PASSWORD_REQUIRED` when neither is available.
    fn run_sudo(&self, command: &str) -> Result<CmdOutput, String> {
        let noninteractive = format!("sudo -n -- sh -c {}", shell_escape(command));
        let np = self.exec_command_full(&noninteractive)?;
        // sudo -n prints "a password is required" to stderr and exits non-zero
        // when NOPASSWD is not configured; only treat exit 0 as success.
        if np.code == 0 {
            return Ok(np);
        }
        if let Some(pw) = &self.sudo_password {
            return self.exec_sudo_with_password(command, pw);
        }
        Err(Self::SUDO_PASSWORD_REQUIRED.to_string())
    }

    /// Auto-fallback execution: run `command` plain first, and only escalate
    /// (via [`run_sudo`]) when it fails on what looks like a permission error.
    /// A plain success — or a failure that is clearly not permission-related —
    /// is returned as-is, so ordinary commands never trigger a sudo prompt.
    pub fn exec_elevated(&self, command: &str) -> Result<CmdOutput, String> {
        // Windows has no sudo; root needs none.
        if self.remote_os == RemoteOs::Windows || self.is_root {
            return self.exec_command_full(command);
        }
        let plain = self.exec_command_full(command)?;
        if !Self::looks_like_permission_failure(&plain) {
            return Ok(plain);
        }
        // Permission-shaped failure: try to escalate. If escalation is not
        // possible (no password and no NOPASSWD), surface that sentinel so the
        // UI can prompt — more useful than the raw "permission denied".
        self.run_sudo(command)
    }

    /// Auto-fallback execution with a lenient string return matching
    /// [`exec_command`]: runs plain, and only escalates on a permission-shaped
    /// failure. This is the generic "just run it and elevate if needed" entry.
    pub fn exec_command_auto(&self, command: &str) -> Result<String, String> {
        let r = self.exec_elevated(command)?;
        if r.code == 0 || !r.stdout.trim().is_empty() {
            Ok(r.stdout)
        } else if !r.stderr.trim().is_empty() {
            Err(r.stderr.trim().to_string())
        } else {
            Err(format!("Command failed (exit {})", r.code))
        }
    }

    /// Always-elevate variant for operations that are known to need root (the
    /// explicit `*_sudo` file operations). Skips the plain attempt: `sudo -n`
    /// then `sudo -S`. Lenient string return matching [`exec_command`].
    pub fn exec_command_sudo(&self, command: &str) -> Result<String, String> {
        if self.remote_os == RemoteOs::Windows || self.is_root {
            return self.exec_command(command);
        }
        let r = self.run_sudo(command)?;
        if r.code == 0 || !r.stdout.trim().is_empty() {
            Ok(r.stdout)
        } else if !r.stderr.trim().is_empty() {
            Err(r.stderr.trim().to_string())
        } else {
            Err(format!("Command failed (exit {})", r.code))
        }
    }

    // ── SFTP privilege fallback ───────────────────────────────────────────────
    //
    // The SFTP subsystem has no equivalent of sudo: it always acts as the login
    // user, and a refused operation comes back as `[SFTP(3)] permission denied`
    // with nothing further the protocol can try. Every SFTP entry point below
    // therefore attempts the native operation first and, only when it is
    // refused for lack of privileges, redoes the same work as an elevated shell
    // command through the same `sudo -n` → `sudo -S` ladder the exec path uses.
    // This keeps elevation automatic everywhere instead of depending on each
    // caller to catch the denial and re-invoke a separate `*_sudo` command.

    /// Does this error look like the remote refused the operation for lack of
    /// privileges? libssh2 renders SSH_FX_PERMISSION_DENIED as `[SFTP(3)]`, and
    /// the accompanying text varies by server, so match both shapes.
    fn is_permission_error(err: &str) -> bool {
        let hay = err.to_lowercase();
        hay.contains("sftp(3)")
            || hay.contains("permission denied")
            || hay.contains("operation not permitted")
            || hay.contains("access denied")
            || hay.contains("eacces")
            || hay.contains("eperm")
    }

    /// Whether escalation could plausibly help. Windows has no sudo, and a root
    /// login has nothing to escalate to — in both cases the denial is final, and
    /// retrying would only replace the real error with a confusing second one.
    fn can_escalate(&self) -> bool {
        self.remote_os != RemoteOs::Windows && !self.is_root
    }

    /// Run `primary`; if it is refused for lack of privileges and escalation is
    /// possible, run `fallback` (the sudo-backed equivalent) instead. Any other
    /// failure is returned untouched so genuine errors are not masked.
    fn with_sudo_fallback<T>(
        &self,
        primary: impl FnOnce() -> Result<T, String>,
        fallback: impl FnOnce() -> Result<T, String>,
    ) -> Result<T, String> {
        match primary() {
            Ok(v) => Ok(v),
            Err(e) if self.can_escalate() && Self::is_permission_error(&e) => fallback(),
            Err(e) => Err(e),
        }
    }

    /// Run an inner command elevated on Unix, plain on Windows (which has no
    /// sudo but usually logs in with the privileges it needs).
    fn run_elevated_or_plain(&self, cmd: &str) -> Result<String, String> {
        match self.remote_os {
            RemoteOs::Windows => self.exec_command(cmd),
            _ => self.exec_command_sudo(cmd),
        }
    }

    /// The login user's `user:group`, resolved WITHOUT elevation — under sudo
    /// these would report root, which is never what the caller wants.
    fn login_identity(&self) -> Result<String, String> {
        let out = self.exec_command("printf '%s:%s' \"$(id -un)\" \"$(id -gn)\"")?;
        let ident = out.trim().to_string();
        if ident.is_empty() || ident == ":" {
            return Err("Could not resolve the login user on the remote host".into());
        }
        Ok(ident)
    }

    pub fn exec_zip(&self, src: &str, dest: &str) -> Result<String, String> {
        let cmd = match self.remote_os {
            RemoteOs::Windows => format!("powershell -NoProfile -Command \"Compress-Archive -Path {} -DestinationPath {} -Force\"", ps_escape(src), ps_escape(dest)),
            _ => format!("zip -r {} {}", shell_escape(dest), shell_escape(src)),
        };
        self.exec_command_auto(&cmd)
    }

    pub fn exec_unzip(&self, src: &str, dest: &str) -> Result<String, String> {
        let cmd = match self.remote_os {
            RemoteOs::Windows => format!("powershell -NoProfile -Command \"Expand-Archive -Path {} -DestinationPath {} -Force\"", ps_escape(src), ps_escape(dest)),
            _ => format!("unzip {} -d {}", shell_escape(src), shell_escape(dest)),
        };
        self.exec_command_auto(&cmd)
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
        Self::sort_nodes(&mut nodes);
        Ok(nodes)
    }

    /// Directories first, then case-insensitive by name.
    fn sort_nodes(nodes: &mut [FileNode]) {
        nodes.sort_by(|a, b| {
            if a.is_dir == b.is_dir { a.name.to_lowercase().cmp(&b.name.to_lowercase()) }
            else { b.is_dir.cmp(&a.is_dir) }
        });
    }

    pub fn sftp_list(&self, path: &str) -> Result<Vec<FileNode>, String> {
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                Self::list_dir(&sftp, path)
            },
            || self.list_dir_sudo(path),
        )
    }

    /// Elevated listing for directories the login user cannot read (e.g. /root,
    /// /etc/ssl/private). One shell command emits a `KIND|||size|||name` record
    /// per entry — name last so that names containing `|||` survive the split —
    /// and the full path is rebuilt here rather than on the remote.
    fn list_dir_sudo(&self, path: &str) -> Result<Vec<FileNode>, String> {
        if self.remote_os == RemoteOs::Windows {
            return Err(format!("Cannot list {}: permission denied", path));
        }
        // Trailing slashes are stripped so "/" becomes "" and children join as
        // "/name" rather than "//name", which POSIX leaves implementation-defined.
        let base = path.trim_end_matches('/');
        let cmd = format!(
            "d={}; ls -A -- \"$d/\" | while IFS= read -r n; do f=\"$d/$n\"; \
             if [ -d \"$f\" ]; then printf 'D|||0|||%s\\n' \"$n\"; \
             else sz=$(stat -c%s \"$f\" 2>/dev/null || stat -f%z \"$f\" 2>/dev/null || echo 0); \
             printf 'F|||%s|||%s\\n' \"$sz\" \"$n\"; fi; done",
            shell_escape(base)
        );
        let output = self.exec_command_sudo(&cmd)?;
        let mut nodes = Vec::new();
        for line in output.lines() {
            let mut parts = line.splitn(3, "|||");
            let kind = parts.next().unwrap_or("");
            let size = parts.next().unwrap_or("0").trim().parse::<u64>().unwrap_or(0);
            let name = parts.next().unwrap_or("").to_string();
            if name.is_empty() || name == "." || name == ".." { continue; }
            nodes.push(FileNode {
                path: format!("{}/{}", base, name),
                name,
                is_dir: kind == "D",
                size,
            });
        }
        Self::sort_nodes(&mut nodes);
        Ok(nodes)
    }

    /// Recursively search for files/folders under `path` whose name contains `query`
    /// (case-insensitive). Runs a single remote `find`/`Get-ChildItem` command rather than
    /// walking the tree via repeated SFTP `readdir` round-trips, and caps results at 500.
    pub fn sftp_search(&self, path: &str, query: &str) -> Result<Vec<FileNode>, String> {
        let pattern = format!("*{}*", query);
        let cmd = match self.remote_os {
            RemoteOs::Windows => format!(
                "powershell -NoProfile -Command \"Get-ChildItem -LiteralPath '{}' -Recurse -Filter '{}' -ErrorAction SilentlyContinue -Force | Select-Object -First 500 | ForEach-Object {{ $t = if ($_.PSIsContainer) {{ 'D' }} else {{ 'F' }} ; $sz = if ($_.PSIsContainer) {{ 0 }} else {{ $_.Length }} ; Write-Output ($t + '|||' + $_.FullName + '|||' + $sz) }}\"",
                path.replace('\'', "''"),
                pattern.replace('\'', "''")
            ),
            _ => format!(
                "find {} -iname {} 2>/dev/null | head -n 500 | while IFS= read -r f; do if [ -d \"$f\" ]; then printf 'D|||%s|||0\\n' \"$f\"; else sz=$(stat -c%s \"$f\" 2>/dev/null || stat -f%z \"$f\" 2>/dev/null || echo 0); printf 'F|||%s|||%s\\n' \"$f\" \"$sz\"; fi; done",
                shell_escape(path),
                shell_escape(&pattern)
            ),
        };

        let output = self.exec_command(&cmd)?;
        let mut nodes = Vec::new();
        for line in output.lines() {
            let mut parts = line.splitn(3, "|||");
            let kind = parts.next().unwrap_or("");
            let full_path = parts.next().unwrap_or("").trim();
            let size_str = parts.next().unwrap_or("0");
            if full_path.is_empty() { continue; }

            let is_dir = kind == "D";
            let size = size_str.trim().parse::<u64>().unwrap_or(0);
            let name = full_path
                .trim_end_matches(|c| c == '/' || c == '\\')
                .rsplit(|c: char| c == '/' || c == '\\')
                .next()
                .unwrap_or(full_path)
                .to_string();

            nodes.push(FileNode { name, path: full_path.to_string(), is_dir, size });
        }
        Ok(nodes)
    }

    pub fn sftp_read(&self, path: &str) -> Result<Vec<u8>, String> {
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                let mut file = sftp.open(Path::new(path)).map_err(|e| e.to_string())?;
                let mut content = Vec::new();
                file.read_to_end(&mut content).map_err(|e| e.to_string())?;
                Ok(content)
            },
            || self.sftp_read_sudo(path),
        )
    }

    /// Elevated read. The command channel is a text stream, so the bytes come
    /// back base64-encoded to survive binary content and any locale mangling.
    fn sftp_read_sudo(&self, path: &str) -> Result<Vec<u8>, String> {
        if self.remote_os == RemoteOs::Windows {
            return Err(format!("Cannot read {}: permission denied", path));
        }
        let encoded = self.exec_command_sudo(&format!("base64 {}", shell_escape(path)))?;
        let stripped: String = encoded.chars().filter(|c| !c.is_whitespace()).collect();
        base64::engine::general_purpose::STANDARD
            .decode(stripped)
            .map_err(|e| format!("Could not decode elevated read of {}: {}", path, e))
    }

    pub fn sftp_exists(&self, path: &str) -> bool {
        match self.session.sftp().and_then(|sftp| sftp.stat(Path::new(path))) {
            Ok(_) => true,
            // A denied stat says nothing about existence. Callers use this for
            // overwrite checks, so fall back to an elevated test rather than
            // reporting a protected path as free and silently clobbering it.
            Err(e) if self.can_escalate() && Self::is_permission_error(&e.to_string()) => self
                .exec_command_sudo(&format!("test -e {} && echo yes", shell_escape(path)))
                .map(|out| out.trim() == "yes")
                .unwrap_or(false),
            Err(_) => false,
        }
    }

    pub fn sftp_write(&self, path: &str, content: &[u8]) -> Result<(), String> {
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                let mut file = sftp.create(Path::new(path)).map_err(|e| e.to_string())?;
                file.write_all(content).map_err(|e| e.to_string())
            },
            || self.sftp_write_sudo(path, content),
        )
    }

    pub fn sftp_write_sudo(&self, path: &str, content: &[u8]) -> Result<(), String> {
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        
        match self.remote_os {
            RemoteOs::Windows => {
                // Windows usually doesn't need sudo-like copy if SSH is admin, but we follow the temp pattern
                let temp_path = format!("C:\\Windows\\Temp\\servera_upload_{}", timestamp);
                let mut file = sftp.create(Path::new(&temp_path)).map_err(|e| e.to_string())?;
                file.write_all(content).map_err(|e| e.to_string())?;
                drop(file); drop(sftp);
                let cmd = format!("powershell -NoProfile -Command \"Copy-Item -Path {} -Destination {} -Force; Remove-Item {}\"", ps_escape(&temp_path), ps_escape(path), ps_escape(&temp_path));
                self.exec_command(&cmd)?;
            }
            _ => {
                let temp_path = format!("/tmp/servera_upload_{}", timestamp);
                let mut file = sftp.create(Path::new(&temp_path)).map_err(|e| e.to_string())?;
                file.write_all(content).map_err(|e| e.to_string())?;
                drop(file); drop(sftp);
                let cmd = format!("cp {} {}", shell_escape(&temp_path), shell_escape(path));
                self.exec_command_sudo(&cmd)?;
                let _ = self.exec_command(&format!("rm {}", shell_escape(&temp_path)));
            }
        }
        Ok(())
    }

    pub fn sftp_rename(&self, old_path: &str, new_path: &str) -> Result<(), String> {
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                sftp.rename(Path::new(old_path), Path::new(new_path), None).map_err(|e| e.to_string())
            },
            || {
                let cmd = match self.remote_os {
                    RemoteOs::Windows => format!(
                        "powershell -NoProfile -Command \"Move-Item -LiteralPath {} -Destination {} -Force\"",
                        ps_escape(old_path), ps_escape(new_path)
                    ),
                    _ => format!("mv -f {} {}", shell_escape(old_path), shell_escape(new_path)),
                };
                self.run_elevated_or_plain(&cmd).map(|_| ())
            },
        )
    }

    pub fn sftp_delete(&self, path: &str, is_dir: bool) -> Result<(), String> {
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| format!("SFTP error: {}", e))?;
                if is_dir {
                    self.do_sftp_delete_recursive(&sftp, path)
                } else {
                    sftp.unlink(Path::new(path)).map_err(|e| format!("Unlink failed: {}", e))
                }
            },
            // A recursive delete can be denied partway through; the elevated
            // `rm -rf` below removes whatever the first pass left behind.
            || self.sftp_delete_sudo(path, is_dir),
        )
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
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                sftp.mkdir(Path::new(path), 0o755).map_err(|e| e.to_string())
            },
            || {
                let cmd = match self.remote_os {
                    RemoteOs::Windows => format!(
                        "powershell -NoProfile -Command \"New-Item -ItemType Directory -Path {} -Force\"",
                        ps_escape(path)
                    ),
                    _ => format!("mkdir -p {}", shell_escape(path)),
                };
                self.run_elevated_or_plain(&cmd).map(|_| ())
            },
        )
    }

    pub fn sftp_create_file(&self, path: &str) -> Result<(), String> {
        self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                sftp.create(Path::new(path)).map_err(|e| e.to_string()).map(|_| ())
            },
            || {
                let cmd = match self.remote_os {
                    RemoteOs::Windows => format!(
                        "powershell -NoProfile -Command \"New-Item -ItemType File -Path {} -Force\"",
                        ps_escape(path)
                    ),
                    _ => format!("touch {}", shell_escape(path)),
                };
                self.run_elevated_or_plain(&cmd).map(|_| ())
            },
        )
    }

    pub fn sftp_delete_sudo(&self, path: &str, is_dir: bool) -> Result<(), String> {
        let cmd = match self.remote_os {
            RemoteOs::Windows => {
                if is_dir {
                    format!("powershell -NoProfile -Command \"Remove-Item -Path {} -Recurse -Force\"", ps_escape(path))
                } else {
                    format!("powershell -NoProfile -Command \"Remove-Item -Path {} -Force\"", ps_escape(path))
                }
            }
            _ => {
                if is_dir {
                    format!("rm -rf {}", shell_escape(path))
                } else {
                    format!("rm -f {}", shell_escape(path))
                }
            }
        };
        // Windows uses PowerShell (no sudo); Unix escalates through sudo.
        self.run_elevated_or_plain(&cmd).map(|_| ())
    }

    pub fn get_user_info(&self) -> Result<String, String> {
        match self.remote_os {
            RemoteOs::Windows => self.exec_command("whoami; powershell -NoProfile -Command \"[Security.Principal.WindowsIdentity]::GetCurrent().Groups\""),
            _ => self.exec_command("whoami; id; groups"),
        }
    }

    pub fn sftp_get_permissions(&self, path: &str) -> Result<String, String> {
        match self.remote_os {
            RemoteOs::Windows => self.exec_command(&format!("powershell -NoProfile -Command \"Get-Item {} | Select-Object Mode, LastWriteTime, Length, Name | Out-String\"", ps_escape(path))),
            // Auto-elevating: stat'ing an item inside a directory the login user
            // cannot traverse is itself denied, and that is exactly the case the
            // permissions dialog exists to inspect.
            _ => self.exec_command_auto(&format!("ls -ld {}", shell_escape(path))),
        }
    }

    pub fn upgrade_access(&self, path: &str, action: &str) -> Result<String, String> {
        match self.remote_os {
            RemoteOs::Windows => {
                let cmd = match action {
                    "exec" => format!("attrib -r '{}'", path),
                    "full" => format!("powershell -NoProfile -Command \"$acl = Get-Acl {0}; $rule = New-Object System.Security.AccessControl.FileSystemAccessRule('Everyone','FullControl','Allow'); $acl.SetAccessRule($rule); Set-Acl {0} $acl\"", ps_escape(path)),
                    "own" => format!("powershell -NoProfile -Command \"takeown /f {} /r /d y\"", ps_escape(path)),
                    _ => return Err("Invalid upgrade action for Windows".into()),
                };
                self.exec_command(&cmd)
            }
            _ => {
                // (inner command, always elevate). `own`/`sudoer` change
                // ownership / group membership, which require root outright.
                // The `chmod`s are attempted plain first and escalate only if
                // denied — changing the mode of a file you do not own needs root
                // too, which is the usual reason this dialog is open.
                // `$USER` cannot be left for the remote shell to expand: sudo
                // sets it to the target user, so `chown $USER` under sudo would
                // hand the file to root — the opposite of what "take ownership"
                // means. Resolve the login identity unelevated and inline it.
                let (cmd, always_sudo) = match action {
                    "exec" => (format!("chmod +x {}", shell_escape(path)), false),
                    "full" => (format!("chmod 777 {}", shell_escape(path)), false),
                    "own" => {
                        let who = self.login_identity()?;
                        (format!("chown {} {}", shell_escape(&who), shell_escape(path)), true)
                    }
                    "sudoer" => {
                        let user = self.exec_command("id -un")?.trim().to_string();
                        let u = shell_escape(&user);
                        (format!("usermod -aG sudo {0} || usermod -aG wheel {0}", u), true)
                    }
                    _ => return Err("Invalid upgrade action".into()),
                };
                if always_sudo {
                    self.exec_command_sudo(&cmd)
                } else {
                    self.exec_command_auto(&cmd)
                }
            }
        }
    }

    // ── Upload ────────────────────────────────────────────────────────────────

    /// Upload a local file or folder to the remote. Opens ONE Sftp subsystem
    /// for the entire operation to avoid repeated open/close cycles that can
    /// corrupt session state on error.
    pub fn sftp_upload(&self, app: &AppHandle, local_path: &str, remote_path: &str) -> Result<(), String> {
        let path = Path::new(local_path);
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let result = self.with_sudo_fallback(
            || {
                let sftp = self.session.sftp().map_err(|e| e.to_string())?;
                let r = if path.is_dir() {
                    self.do_sftp_upload_recursive(app, &sftp, local_path, remote_path, &name)
                } else {
                    self.do_sftp_upload_file(app, &sftp, local_path, remote_path, &name, &name)
                };
                // sftp is dropped here — single clean shutdown
                r
            },
            // Denied destination: stage in /tmp and move into place elevated.
            || self.sftp_upload_sudo(app, local_path, remote_path),
        );
        if let Err(ref e) = result {
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Upload failed: {}", e), "error": e.to_string()
            }));
        }
        result
    }

    /// Upload via /tmp or C:\Windows\Temp then elevated move — for paths that require elevated permissions.
    pub fn sftp_upload_sudo(&self, app: &AppHandle, local_path: &str, remote_path: &str) -> Result<(), String> {
        let path = Path::new(local_path);
        let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        
        let temp_remote = match self.remote_os {
            RemoteOs::Windows => format!("C:\\Windows\\Temp\\servera_sudo_{}", timestamp),
            _ => format!("/tmp/servera_sudo_{}", timestamp),
        };

        // Upload to temp staging area first (user usually has write access there)
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
                "details": format!("Upload to staging failed: {}", e), "error": e.to_string()
            }));
            return result;
        }

        // Move from temp to final destination with elevation.
        //
        // Directories are merged into the destination rather than moved onto it:
        // `mv dirA dirB` puts dirA *inside* dirB when dirB already exists, and it
        // often does — either from an earlier upload or from the plain attempt
        // that created the directory before being denied further down the tree.
        let is_dir = path.is_dir();
        let (mv_cmd, rm_cmd) = match self.remote_os {
            RemoteOs::Windows => (
                if is_dir {
                    format!(
                        "powershell -NoProfile -Command \"New-Item -ItemType Directory -Path {0} -Force | Out-Null; Copy-Item -Path {1} -Destination {0} -Recurse -Force\"",
                        ps_escape(remote_path), ps_escape(&format!("{}\\*", temp_remote))
                    )
                } else {
                    format!("powershell -NoProfile -Command \"Move-Item -Path {} -Destination {} -Force\"", ps_escape(&temp_remote), ps_escape(remote_path))
                },
                format!("powershell -NoProfile -Command \"Remove-Item -Path {} -Recurse -Force\"", ps_escape(&temp_remote))
            ),
            _ => (
                // Inner command only — exec_command_sudo adds the elevation.
                if is_dir {
                    format!(
                        "mkdir -p {dest} && cp -a {tmp}/. {dest}/",
                        dest = shell_escape(remote_path), tmp = shell_escape(&temp_remote)
                    )
                } else {
                    format!("mv -f {} {}", shell_escape(&temp_remote), shell_escape(remote_path))
                },
                format!("rm -rf {}", shell_escape(&temp_remote))
            )
        };

        let mv_result = match self.remote_os {
            RemoteOs::Windows => self.exec_command(&mv_cmd),
            _ => self.exec_command_sudo(&mv_cmd),
        };
        if let Err(e) = mv_result {
            let _ = self.exec_command(&rm_cmd);
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Elevated move failed: {}", e), "error": e.to_string()
            }));
            return Err(format!("Elevated move failed: {}", e));
        }

        // A directory was copied, not moved, so the staging tree is still there.
        // It may now be root-owned, hence the elevated removal.
        if is_dir {
            let _ = self.run_elevated_or_plain(&rm_cmd);
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
        // Create the root remote directory. A directory that already exists is
        // fine (the common redeploy case) — only a real failure (permission,
        // path-is-a-file) should abort.
        if !sftp.stat(Path::new(remote_path)).map(|s| s.is_dir()).unwrap_or(false) {
            sftp.mkdir(Path::new(remote_path), 0o755)
                .map_err(|e| format!("Cannot create remote directory {}: {}", remote_path, e))?;
        }

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
        let result = self.with_sudo_fallback(
            || self.do_sftp_download(app, remote_path, local_path, &name),
            || self.sftp_download_sudo(app, remote_path, local_path, &name),
        );
        if let Err(ref e) = result {
            let _ = app.emit("transfer-progress", serde_json::json!({
                "root_name": name, "filename": name, "status": "error",
                "details": format!("Download failed: {}", e), "error": e.to_string()
            }));
        }
        result
    }

    fn do_sftp_download(&self, app: &AppHandle, remote_path: &str, local_path: &str, name: &str) -> Result<(), String> {
        let sftp = self.session.sftp().map_err(|e| e.to_string())?;
        let stat = sftp.stat(Path::new(remote_path)).map_err(|e| e.to_string())?;
        if stat.is_dir() {
            self.do_sftp_download_recursive(app, &sftp, remote_path, local_path, name)
        } else {
            self.do_sftp_download_file(app, &sftp, remote_path, local_path, name, name, stat.size.unwrap_or(0))
        }
        // sftp dropped here — single clean shutdown
    }

    /// Download a source the login user cannot read: copy it to a staging area
    /// under /tmp as root, hand ownership to the login user, then pull it over
    /// SFTP normally. The staging copy is always removed, success or not.
    fn sftp_download_sudo(&self, app: &AppHandle, remote_path: &str, local_path: &str, name: &str) -> Result<(), String> {
        if self.remote_os == RemoteOs::Windows {
            return Err(format!("Cannot read {}: permission denied", remote_path));
        }
        let timestamp = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis();
        let staging = format!("/tmp/servera_dl_{}", timestamp);
        let owner = self.login_identity()?;

        // -a preserves the tree; the chown/chmod is what makes the copy
        // readable over SFTP, which still runs as the unprivileged login user.
        let prepare = format!(
            "mkdir -p {s} && cp -a {src} {s}/ && chown -R {o} {s} && chmod -R u+rwX {s}",
            s = shell_escape(&staging),
            src = shell_escape(remote_path),
            o = shell_escape(&owner),
        );
        self.exec_command_sudo(&prepare)
            .map_err(|e| format!("Could not stage {} for download: {}", remote_path, e))?;

        let staged = format!("{}/{}", staging, name);
        let result = self.do_sftp_download(app, &staged, local_path, name);
        let _ = self.exec_command_sudo(&format!("rm -rf {}", shell_escape(&staging)));
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

// ─────────────────────────────────────────────────────────────────────────────
// Log Streaming (tail -f / journalctl -f over persistent SSH channels)
// ─────────────────────────────────────────────────────────────────────────────

/// Spawn a thread that reads from a log stream channel and emits events
///
/// `on_end` runs once the reader has stopped for good — on EOF, on a transport
/// error, or after an explicit stop. The caller uses it to drop the stream's
/// handle, which owns a whole SSH session of its own.
pub fn spawn_log_reader(
    stream_id: String,
    channel: Arc<Mutex<Option<Channel>>>,
    stop_flag: Arc<std::sync::atomic::AtomicBool>,
    app_handle: AppHandle,
    on_end: impl FnOnce() + Send + 'static,
) {
    thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];
        let event_name = format!("log-stream:{}", stream_id);

        loop {
            if stop_flag.load(std::sync::atomic::Ordering::Relaxed) {
                break;
            }

            let mut guard = match channel.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };

            if let Some(ch) = guard.as_mut() {
                match ch.read(&mut buf) {
                    Ok(n) if n > 0 => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(&event_name, data);
                    }
                    Ok(_) => {}
                    Err(e) => {
                        if e.kind() != std::io::ErrorKind::WouldBlock && e.kind() != std::io::ErrorKind::TimedOut {
                            let _ = app_handle.emit(&event_name, "__EOF__");
                            break;
                        }
                    }
                }
            } else {
                break;
            }

            drop(guard);
            thread::sleep(Duration::from_millis(50));
        }

        // Reached on every exit path. The channel lock is already released here,
        // so `on_end` is free to take the stream registry's lock without
        // inverting the order `stop_log_stream` acquires them in.
        on_end();
    });
}

/// Open a persistent SSH channel running a streaming command.
/// Returns the session + channel wrapped for use with spawn_log_reader.
pub fn open_stream_channel(
    ip: &str,
    user: &str,
    port: u16,
    password: Option<&str>,
    private_key: Option<&str>,
    proxy_jump: Option<&str>,
    command: &str,
    app: &AppHandle,
    session_id: &str,
    elevate: bool,
    sudo_password: Option<&str>,
) -> Result<(Session, Channel), String> {
    let mut sess = Session::new().map_err(|e| format!("Failed to create session: {}", e))?;
    establish_session(&mut sess, ip, port, user, password, private_key, proxy_jump, app, session_id)?;
    sess.set_blocking(true);

    let mut channel = sess.channel_session().map_err(|e| e.to_string())?;

    match (elevate, sudo_password) {
        // Elevated with a stored password: no PTY (so the password we write is
        // not echoed into the log output) and feed it to `sudo -S` on stdin.
        (true, Some(pw)) => {
            let wrapped = format!("sudo -S -p '' -- sh -c {}", shell_escape(command));
            channel.exec(&wrapped).map_err(|e| e.to_string())?;
            channel.write_all(format!("{}\n", pw).as_bytes()).map_err(|e| e.to_string())?;
            channel.send_eof().ok();
        }
        // Elevated without a password: rely on passwordless sudo (NOPASSWD).
        // `-n` never prompts, so a PTY is fine and keeps tail/journalctl happy.
        (true, None) => {
            let wrapped = format!("sudo -n -- sh -c {}", shell_escape(command));
            channel.request_pty("xterm-256color", None, Some((200, 50, 0, 0))).map_err(|e| e.to_string())?;
            channel.exec(&wrapped).map_err(|e| e.to_string())?;
        }
        // No elevation: original behavior.
        (false, _) => {
            channel.request_pty("xterm-256color", None, Some((200, 50, 0, 0))).map_err(|e| e.to_string())?;
            channel.exec(command).map_err(|e| e.to_string())?;
        }
    }

    sess.set_blocking(false);
    Ok((sess, channel))
}

// ─────────────────────────────────────────────────────────────────────────────
// SSH Tunnel Management (Port Forwards & SOCKS Proxy)
// ─────────────────────────────────────────────────────────────────────────────

/// Represents an active SSH tunnel
pub struct SshTunnel {
    pub stop_flag: Arc<std::sync::atomic::AtomicBool>,
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub tunnel_type: String,
}

/// Start a local port forward (-L): binds local_port, forwards to remote_host:remote_port through SSH
pub fn start_local_forward(
    ip: &str,
    user: &str,
    port: u16,
    password: Option<&str>,
    private_key: Option<&str>,
    proxy_jump: Option<&str>,
    local_port: u16,
    remote_host: &str,
    remote_port: u16,
    app: &AppHandle,
    session_id: &str,
) -> Result<SshTunnel, String> {
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    establish_session(&mut sess, ip, port, user, password, private_key, proxy_jump, app, session_id)?;
    sess.set_blocking(true);

    let listener = std::net::TcpListener::bind(format!("127.0.0.1:{}", local_port))
        .map_err(|e| format!("Cannot bind local port {}: {}", local_port, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = stop_flag.clone();
    let rh = remote_host.to_string();
    let rp = remote_port;
    let sess = Arc::new(Mutex::new(sess));

    thread::spawn(move || {
        while !flag.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok((client, _)) => {
                    let sess_clone = sess.clone();
                    let rh = rh.clone();
                    let flag = flag.clone();
                    thread::spawn(move || {
                        let guard = match sess_clone.lock() {
                            Ok(g) => g,
                            Err(p) => p.into_inner(),
                        };
                        if let Ok(channel) = guard.channel_direct_tcpip(&rh, rp, None) {
                            drop(guard);
                            let mut client_reader = match client.try_clone() {
                                Ok(c) => c,
                                Err(_) => return,
                            };
                            let mut client_writer = client;
                            let mut chan_reader = channel;
                            let mut chan_writer = chan_reader.clone();

                            let flag2 = flag.clone();
                            let t1 = thread::spawn(move || {
                                let mut buf = [0u8; 8192];
                                loop {
                                    if flag2.load(std::sync::atomic::Ordering::Relaxed) { break; }
                                    match client_reader.read(&mut buf) {
                                        Ok(0) => break,
                                        Ok(n) => { if chan_writer.write_all(&buf[..n]).is_err() { break; } }
                                        Err(_) => break,
                                    }
                                }
                            });

                            let mut buf = [0u8; 8192];
                            loop {
                                if flag.load(std::sync::atomic::Ordering::Relaxed) { break; }
                                match chan_reader.read(&mut buf) {
                                    Ok(0) => break,
                                    Ok(n) => { if client_writer.write_all(&buf[..n]).is_err() { break; } }
                                    Err(_) => break,
                                }
                            }
                            let _ = t1.join();
                        }
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
    });

    Ok(SshTunnel {
        stop_flag,
        local_port,
        remote_host: remote_host.to_string(),
        remote_port,
        tunnel_type: "local".to_string(),
    })
}

/// Start a dynamic SOCKS5 proxy (-D): binds local_port as a SOCKS5 proxy through SSH
pub fn start_dynamic_forward(
    ip: &str,
    user: &str,
    port: u16,
    password: Option<&str>,
    private_key: Option<&str>,
    proxy_jump: Option<&str>,
    local_port: u16,
    app: &AppHandle,
    session_id: &str,
) -> Result<SshTunnel, String> {
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    establish_session(&mut sess, ip, port, user, password, private_key, proxy_jump, app, session_id)?;
    sess.set_blocking(true);

    let listener = std::net::TcpListener::bind(format!("127.0.0.1:{}", local_port))
        .map_err(|e| format!("Cannot bind SOCKS port {}: {}", local_port, e))?;
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;

    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = stop_flag.clone();
    let sess = Arc::new(Mutex::new(sess));

    thread::spawn(move || {
        while !flag.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok((mut client, _)) => {
                    let sess_clone = sess.clone();
                    let flag = flag.clone();
                    thread::spawn(move || {
                        // Minimal SOCKS5 handshake
                        let mut buf = [0u8; 512];
                        // Read greeting
                        if client.read(&mut buf).map_or(true, |n| n < 3 || buf[0] != 0x05) { return; }
                        // Reply: no auth required
                        if client.write_all(&[0x05, 0x00]).is_err() { return; }

                        // Read connect request
                        let n = match client.read(&mut buf) {
                            Ok(n) if n >= 7 && buf[0] == 0x05 && buf[1] == 0x01 => n,
                            _ => return,
                        };

                        let (dest_host, dest_port) = match buf[3] {
                            0x01 => {
                                if n < 10 { return; }
                                let host = format!("{}.{}.{}.{}", buf[4], buf[5], buf[6], buf[7]);
                                let port = ((buf[8] as u16) << 8) | buf[9] as u16;
                                (host, port)
                            }
                            0x03 => {
                                let len = buf[4] as usize;
                                if n < 5 + len + 2 { return; }
                                let host = String::from_utf8_lossy(&buf[5..5+len]).to_string();
                                let port = ((buf[5+len] as u16) << 8) | buf[5+len+1] as u16;
                                (host, port)
                            }
                            _ => return,
                        };

                        let guard = match sess_clone.lock() {
                            Ok(g) => g,
                            Err(p) => p.into_inner(),
                        };
                        match guard.channel_direct_tcpip(&dest_host, dest_port, None) {
                            Ok(channel) => {
                                drop(guard);
                                let reply = [0x05, 0x00, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
                                if client.write_all(&reply).is_err() { return; }

                                let mut client_reader = match client.try_clone() {
                                    Ok(c) => c,
                                    Err(_) => return,
                                };
                                let mut client_writer = client;
                                let mut chan_reader = channel;
                                let mut chan_writer = chan_reader.clone();

                                let flag2 = flag.clone();
                                let t1 = thread::spawn(move || {
                                    let mut buf = [0u8; 8192];
                                    loop {
                                        if flag2.load(std::sync::atomic::Ordering::Relaxed) { break; }
                                        match client_reader.read(&mut buf) {
                                            Ok(0) => break,
                                            Ok(n) => { if chan_writer.write_all(&buf[..n]).is_err() { break; } }
                                            Err(_) => break,
                                        }
                                    }
                                });

                                let mut fbuf = [0u8; 8192];
                                loop {
                                    if flag.load(std::sync::atomic::Ordering::Relaxed) { break; }
                                    match chan_reader.read(&mut fbuf) {
                                        Ok(0) => break,
                                        Ok(n) => { if client_writer.write_all(&fbuf[..n]).is_err() { break; } }
                                        Err(_) => break,
                                    }
                                }
                                let _ = t1.join();
                            }
                            Err(_) => {
                                let reply = [0x05, 0x05, 0x00, 0x01, 0, 0, 0, 0, 0, 0];
                                let _ = client.write_all(&reply);
                            }
                        }
                    });
                }
                Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
    });

    Ok(SshTunnel {
        stop_flag,
        local_port,
        remote_host: "dynamic".to_string(),
        remote_port: 0,
        tunnel_type: "dynamic".to_string(),
    })
}

/// Start a remote port forward (-R): remote server listens on remote_port, forwards to local_host:local_port through SSH
pub fn start_remote_forward(
    ip: &str,
    user: &str,
    port: u16,
    password: Option<&str>,
    private_key: Option<&str>,
    proxy_jump: Option<&str>,
    remote_port: u16,
    local_host: &str,
    local_port: u16,
    app: &AppHandle,
    session_id: &str,
) -> Result<SshTunnel, String> {
    let mut sess = Session::new().map_err(|e| e.to_string())?;
    establish_session(&mut sess, ip, port, user, password, private_key, proxy_jump, app, session_id)?;
    sess.set_blocking(true);

    // Ask remote to listen. Returns a Listener object.
    let (mut listener, _) = sess.channel_forward_listen(remote_port, None, None)
        .map_err(|e| format!("Remote forward listen failed on port {}: {}", remote_port, e))?;

    let stop_flag = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let flag = stop_flag.clone();
    let lh = local_host.to_string();
    let lp = local_port;
    let sess = Arc::new(Mutex::new(sess));

    thread::spawn(move || {
        // Set session to non-blocking so listener.accept() becomes non-blocking
        {
            let guard = match sess.lock() {
                Ok(g) => g,
                Err(p) => p.into_inner(),
            };
            guard.set_blocking(false);
        }

        while !flag.load(std::sync::atomic::Ordering::Relaxed) {
            match listener.accept() {
                Ok(channel) => {
                    let lh = lh.clone();
                    let flag = flag.clone();
                    thread::spawn(move || {
                        if let Ok(local_conn) = std::net::TcpStream::connect(format!("{}:{}", lh, lp)) {
                            let mut local_reader = match local_conn.try_clone() {
                                Ok(c) => c,
                                Err(_) => return,
                            };
                            let mut local_writer = local_conn;
                            let mut chan_reader: Channel = channel;
                            let mut chan_writer = chan_reader.clone();

                            let flag2 = flag.clone();
                            let t1 = thread::spawn(move || {
                                let mut buf = [0u8; 8192];
                                loop {
                                    if flag2.load(std::sync::atomic::Ordering::Relaxed) { break; }
                                    match local_reader.read(&mut buf) {
                                        Ok(0) => break,
                                        Ok(n) => { if chan_writer.write_all(&buf[..n]).is_err() { break; } }
                                        Err(_) => break,
                                    }
                                }
                            });

                            let mut buf = [0u8; 8192];
                            loop {
                                if flag.load(std::sync::atomic::Ordering::Relaxed) { break; }
                                match chan_reader.read(&mut buf) {
                                    Ok(0) => break,
                                    Ok(n) => { if local_writer.write_all(&buf[..n]).is_err() { break; } }
                                    Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                                        thread::sleep(Duration::from_millis(10));
                                        continue;
                                    }
                                    Err(_) => break,
                                }
                            }
                            let _ = t1.join();
                        }
                    });
                }
                Err(ref e) if e.code() == ssh2::ErrorCode::Session(-37) => {
                    // -37 is LIBSSH2_ERROR_EAGAIN
                    thread::sleep(Duration::from_millis(100));
                }
                Err(_) => break,
            }
        }
    });

    Ok(SshTunnel {
        stop_flag,
        local_port, // In -R, this is technically the "target" local port
        remote_host: local_host.to_string(),
        remote_port, // This is the port listening on the remote
        tunnel_type: "remote".to_string(),
    })
}

/// Keep an exec connection awake for as long as it is registered.
///
/// `Session::set_keepalive` only *configures* libssh2 — it never sends anything
/// on its own, and the only `keepalive_send` on this connection sits at the top
/// of `exec_command_full`. That made connection liveness an accident of the
/// Dashboard's 5s poll: gate that poll on tab visibility and an idle exec
/// connection dies. This thread makes liveness explicit and independent of the
/// UI, so the session survives until logout no matter which tab is open.
///
/// It retires on its own: `close_exec_conn`/`disconnect_all` clear the inner
/// `Option`, which the next tick sees as `None` and breaks on. Dropping the
/// `Weak` upgrade covers the case where the whole entry is released.
pub fn spawn_exec_keepalive_thread(connection: Arc<Mutex<Option<SshExecConn>>>) {
    let watch = Arc::downgrade(&connection);
    drop(connection);
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(KEEPALIVE_INTERVAL_SECS));
            let Some(conn) = watch.upgrade() else { break };
            let guard = match conn.lock() {
                Ok(g) => g,
                Err(poisoned) => poisoned.into_inner(),
            };
            match guard.as_ref() {
                // A failed ping means the transport is already gone; the next
                // command will surface the real error, so just stop pinging.
                Some(active) => {
                    if active.session.keepalive_send().is_err() {
                        break;
                    }
                }
                None => break,
            }
        }
    });
}

pub fn spawn_read_thread(
    session_id: String,
    connection: Arc<Mutex<Option<SshConnection>>>,
    app_handle: AppHandle,
) {
    // Taken once, up front, so the sleep between polls never holds the session
    // lock — `send_ssh_input` has to be able to get in at any time.
    let pacer = {
        let guard = match connection.lock() {
            Ok(g) => g,
            Err(poisoned) => poisoned.into_inner(),
        };
        match guard.as_ref() {
            Some(conn) => conn.pacer.clone(),
            None => return,
        }
    };

    thread::spawn(move || {
        let mut buf = [0u8; READ_BUF_SIZE];
        let event_name = format!("ssh-output:{}", session_id);
        let error_event = format!("ssh-error:{}", session_id);
        let mut last_keepalive = std::time::Instant::now();
        let mut backoff = READ_POLL_MIN;

        loop {
            let mut read_something = false;

            {
                // Recover from poisoned mutex instead of panicking
                let mut guard = match connection.lock() {
                    Ok(g) => g,
                    Err(poisoned) => poisoned.into_inner(),
                };

                let Some(conn) = guard.as_mut() else { break };

                if last_keepalive.elapsed() >= Duration::from_secs(10) {
                    let _ = conn.session.keepalive_send();
                    last_keepalive = std::time::Instant::now();
                }

                // Drain what is waiting in one pass rather than one chunk per
                // poll, so a burst of output is not paced by the sleep below.
                // Capped so heavy output still yields the lock promptly.
                for _ in 0..MAX_READS_PER_PASS {
                    match conn.channel.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            read_something = true;
                            let data = String::from_utf8_lossy(&buf[..n]).to_string();
                            let _ = app_handle.emit(&event_name, data);
                            // A short read means the channel is drained; asking
                            // again would just return WouldBlock.
                            if n < buf.len() {
                                break;
                            }
                        }
                        Err(e) => {
                            if e.kind() != std::io::ErrorKind::WouldBlock
                                && e.kind() != std::io::ErrorKind::TimedOut
                            {
                                let _ = app_handle.emit(&error_event, e.to_string());
                                return;
                            }
                            break;
                        }
                    }
                }
            }

            // Tight while output is flowing, geometric back-off once it stops.
            backoff = if read_something {
                READ_POLL_MIN
            } else {
                (backoff * 2).min(READ_POLL_MAX)
            };

            // Returns early when input was sent, so a keystroke's echo never
            // waits out the back-off.
            if pacer.wait(backoff) {
                backoff = READ_POLL_MIN;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A nudge that lands while the reader is mid-pass must not be lost — it is
    /// consumed on the next `wait`, which returns at once.
    #[test]
    fn nudge_before_wait_is_not_lost() {
        let pacer = ReadPacer::new();
        pacer.nudge();
        let started = std::time::Instant::now();
        assert!(pacer.wait(Duration::from_secs(5)));
        assert!(started.elapsed() < Duration::from_millis(100));
    }

    /// With nothing sent, `wait` sleeps out the back-off and reports no nudge.
    #[test]
    fn quiet_wait_times_out() {
        let pacer = ReadPacer::new();
        let started = std::time::Instant::now();
        assert!(!pacer.wait(Duration::from_millis(120)));
        assert!(started.elapsed() >= Duration::from_millis(100));
    }

    /// The point of the whole thing: input sent while the reader is backed off
    /// wakes it immediately instead of waiting out the sleep.
    #[test]
    fn nudge_wakes_a_backed_off_reader() {
        let pacer = Arc::new(ReadPacer::new());
        let writer = pacer.clone();
        thread::spawn(move || {
            thread::sleep(Duration::from_millis(50));
            writer.nudge();
        });
        let started = std::time::Instant::now();
        assert!(pacer.wait(Duration::from_secs(5)));
        let waited = started.elapsed();
        assert!(waited >= Duration::from_millis(40), "woke too early: {:?}", waited);
        assert!(waited < Duration::from_millis(1500), "not woken by nudge: {:?}", waited);
    }

    /// Each nudge is consumed once; a second wait falls through to its timeout.
    #[test]
    fn nudge_is_consumed_once() {
        let pacer = ReadPacer::new();
        pacer.nudge();
        assert!(pacer.wait(Duration::from_secs(5)));
        assert!(!pacer.wait(Duration::from_millis(60)));
    }
}
