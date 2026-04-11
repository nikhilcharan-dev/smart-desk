# Phase 1 — Foundation & Adoption (Months 1–2)

> **Goal:** Remove every friction point that prevents power users from switching to Servera as their daily driver. Ship what makes the first 60 seconds magical and the next 60 days habitual.

---

## 1. SSH Config Import

### Why first
Every experienced developer has `~/.ssh/config` with dozens of entries. Asking them to manually re-enter each server is an immediate uninstall trigger. Solving this turns Servera's onboarding from 30 minutes into 5 seconds.

### What to build

**1.1 Config parser (Rust backend)**

Create a new Tauri command `import_ssh_config` that reads and parses `~/.ssh/config`:

```
src-tauri/
├── src/
│   ├── ssh_config/
│   │   ├── mod.rs          // Module entry
│   │   ├── parser.rs       // SSH config parser
│   │   ├── resolver.rs     // Include directive resolver
│   │   └── mapper.rs       // Maps parsed entries → Servera profiles
```

**Fields to parse:**

| SSH Config Directive | Servera Profile Field | Notes |
|---|---|---|
| `Host` | `name` | Use as display name; skip wildcard-only (`*`) entries |
| `HostName` | `ip_hostname` | Falls back to Host value if missing |
| `Port` | `port` | Default 22 |
| `User` | `username` | Default current OS user |
| `IdentityFile` | `private_key_path` | Expand `~` to home dir; validate file exists |
| `ProxyJump` / `ProxyCommand` | `jump_host` | Store reference; used by jump host feature |
| `LocalForward` | `port_forwards` | Parse as array of `{local_port, remote_host, remote_port}` |
| `RemoteForward` | `port_forwards` | Same structure, flagged as remote |

**Edge cases to handle:**
- `Include` directives — recursively resolve paths, support globs like `~/.ssh/config.d/*`
- `Match` blocks — parse but flag as "conditional — review recommended"
- Wildcard hosts (`Host *`) — apply as defaults to all imported profiles
- Multiple `IdentityFile` entries per host — store as array, try in order during auth
- Comments (`#`) and blank lines — skip gracefully
- Relative vs absolute paths for IdentityFile — resolve relative to `~/.ssh/`
- `%h`, `%p`, `%r` tokens in HostName/ProxyCommand — resolve where possible, flag otherwise
- Duplicate Host entries — later entries override earlier ones (matching OpenSSH behavior)
- Hosts with multiple patterns (`Host web-* db-*`) — create one profile per pattern

**Parser implementation:**

```rust
// parser.rs
#[derive(Debug, Clone, Serialize)]
pub struct SshConfigEntry {
    pub host_patterns: Vec<String>,
    pub hostname: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_files: Vec<PathBuf>,
    pub proxy_jump: Option<String>,
    pub proxy_command: Option<String>,
    pub local_forwards: Vec<ForwardRule>,
    pub remote_forwards: Vec<ForwardRule>,
    pub is_wildcard: bool,
    pub is_match_block: bool,
    pub raw_directives: HashMap<String, String>,
}

pub fn parse_ssh_config(path: &Path) -> Result<Vec<SshConfigEntry>> {
    let content = fs::read_to_string(path)?;
    let mut entries: Vec<SshConfigEntry> = Vec::new();
    let mut current: Option<SshConfigEntry> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }

        let (key, value) = split_directive(line)?;
        match key.to_lowercase().as_str() {
            "host" => {
                if let Some(entry) = current.take() { entries.push(entry); }
                let patterns: Vec<String> = value.split_whitespace()
                    .map(|s| s.to_string()).collect();
                current = Some(SshConfigEntry {
                    host_patterns: patterns.clone(),
                    is_wildcard: patterns.iter().all(|p| p == "*"),
                    ..Default::default()
                });
            },
            "include" => {
                let resolved = resolve_include_glob(value, path.parent())?;
                for p in resolved { entries.extend(parse_ssh_config(&p)?); }
            },
            "hostname" => { if let Some(e) = &mut current { e.hostname = Some(value.into()); } },
            "port" => { if let Some(e) = &mut current { e.port = Some(value.parse()?); } },
            "user" => { if let Some(e) = &mut current { e.user = Some(value.into()); } },
            "identityfile" => { if let Some(e) = &mut current { e.identity_files.push(expand_tilde(value).into()); } },
            "proxyjump" => { if let Some(e) = &mut current { e.proxy_jump = Some(value.into()); } },
            "proxycommand" => { if let Some(e) = &mut current { e.proxy_command = Some(value.into()); } },
            "localforward" => { if let Some(e) = &mut current { e.local_forwards.push(parse_forward(value, Local)?); } },
            "remoteforward" => { if let Some(e) = &mut current { e.remote_forwards.push(parse_forward(value, Remote)?); } },
            "match" => {
                if let Some(entry) = current.take() { entries.push(entry); }
                current = Some(SshConfigEntry { is_match_block: true, ..Default::default() });
            },
            _ => { if let Some(e) = &mut current { e.raw_directives.insert(key.into(), value.into()); } }
        }
    }
    if let Some(entry) = current { entries.push(entry); }

    // Post-process: apply Host * defaults to all other entries
    let wildcards: Vec<_> = entries.iter().filter(|e| e.is_wildcard).cloned().collect();
    for entry in entries.iter_mut().filter(|e| !e.is_wildcard) {
        for wc in &wildcards { entry.apply_defaults(wc); }
    }
    Ok(entries)
}
```

**1.2 Import UI — Wizard flow (3 steps):**

Accessible from: onboarding wizard, Settings → Server Profiles → "Import", Command palette (`Ctrl+K` → "Import SSH Config").

**Step 1 — File selection:** Auto-detect `~/.ssh/config` path. Show entry count and last modified. "Browse" button as fallback.

**Step 2 — Preview & select:** Table with checkboxes showing: Host, Hostname/IP, Port, User, Auth Method (key/password icon), Jump Host. Warning icons for missing identity files or unresolvable hostnames. Duplicate detection against existing profiles with Skip/Overwrite/Rename options. Entry count summary.

**Step 3 — Import & connect:** Progress bar. Create profiles, store key paths (never copy keys). After import: offer "Test connection to all" or "Go to Dashboard".

**1.3 Tauri IPC commands:**

```typescript
invoke('detect_ssh_config_path')       // → { path, exists, entry_count, last_modified }
invoke('parse_ssh_config', { path })   // → { entries, warnings, wildcard_defaults }
invoke('import_ssh_profiles', { entries, duplicate_strategy })  // → { imported, skipped, errors }
invoke('test_connections', { server_ids })  // → [{ server_id, status, message }]
```

**1.4 Re-import:** "Re-import from SSH Config" button shows diff (new/removed/changed entries), lets user selectively apply. No auto-sync on startup.

### Acceptance criteria
- [ ] Parses Host, HostName, Port, User, IdentityFile from `~/.ssh/config`
- [ ] Handles `Include` directives recursively with glob support
- [ ] Handles wildcard `Host *` entries as defaults
- [ ] Preview screen with selection, warnings, and duplicate detection
- [ ] Imported profiles connect successfully
- [ ] Re-import shows diff with selective update
- [ ] Works on Windows (`%USERPROFILE%\.ssh\config`), macOS, and Linux

---

## 2. Jump Host / Bastion Support

### Why critical
A large percentage of production environments use bastion/jump hosts. Without this, Servera cannot connect to those servers at all — an immediate disqualifier for professional use.

### What to build

**2.1 Multi-hop SSH connection (Rust backend)**

```
Connection flow:
User's machine ──SSH──▶ Bastion ──direct-tcpip──▶ Target server
                                  (tunnel)

Implementation:
1. Connect to bastion via normal SSH
2. Open direct-tcpip channel from bastion to target host:port
3. Layer a new SSH session on top of that channel
4. Use the layered session for terminal, SFTP, and exec
```

```rust
// connection.rs
pub struct JumpHop {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth: AuthMethod,
}

pub async fn connect_with_jumps(
    target: &ServerProfile,
    jump_chain: &[JumpHop],
    timeout: Duration,
) -> Result<ServerConnection> {
    let mut sessions: Vec<ssh2::Session> = Vec::new();

    for (i, hop) in jump_chain.iter().enumerate() {
        let session = ssh2::Session::new()?;
        session.set_timeout(timeout.as_millis() as u32);

        if i == 0 {
            // First hop: direct TCP connection
            let tcp = TcpStream::connect_timeout(
                &format!("{}:{}", hop.host, hop.port).parse()?, timeout)?;
            session.set_tcp_stream(tcp);
        } else {
            // Subsequent hops: tunnel through previous session
            let channel = sessions.last().unwrap()
                .channel_direct_tcpip(&hop.host, hop.port, None)?;
            session.set_tcp_stream(ChannelStream::new(channel));
        }

        session.handshake()?;
        authenticate(&session, &hop.username, &hop.auth)?;
        sessions.push(session);
    }

    // Final: tunnel to target through last hop
    let last = sessions.last().unwrap();
    let main_channel = last.channel_direct_tcpip(&target.ip_hostname, target.port, None)?;
    let exec_channel = last.channel_direct_tcpip(&target.ip_hostname, target.port, None)?;

    let main_session = create_session_over_channel(main_channel, target)?;
    let exec_session = create_session_over_channel(exec_channel, target)?;

    Ok(ServerConnection { sessions, main_session, exec_session, .. })
}
```

**2.2 ChannelStream adapter** — wraps `ssh2::Channel` implementing `Read + Write` so it can serve as transport for a nested SSH session.

**2.3 ProxyJump parsing:** Support chained jumps from SSH config: `ProxyJump bastion1,bastion2` → User → bastion1 → bastion2 → target.

**2.4 UI changes:**

- Server profile editor: collapsible "Jump Host / Bastion" section with dropdown to select existing profile or configure manually
- Chain visualization: `you → bastion → target`
- "Add hop" button for multi-hop chains
- Connection progress showing each hop: `✓ Connected to bastion → ⟳ Tunneling to target...`
- Server card badge: `⤴ bastion → prod-db-01`

**2.5 Port forwarding through jumps:**

Support local/remote/dynamic (SOCKS5) port forwards through the tunnel chain. UI panel per server showing active forwards with start/stop controls.

### Acceptance criteria
- [ ] Single-hop and multi-hop jump host connections work
- [ ] Terminal, SFTP, and exec all function through the tunnel
- [ ] Port forwarding works through jump hosts
- [ ] Connection progress shows each hop's status
- [ ] SSH config import populates jump host references from ProxyJump
- [ ] Clear error messages identifying which hop failed

---

## 3. RHEL / CentOS Support

### Why now
Roughly half of production servers run RHEL-family distros (RHEL, CentOS, Rocky, Alma, Fedora). Servera's APT-only package manager and UFW-only firewall manager don't work on these systems.

### What to build

**3.1 OS detection (runs once on connect, cached):**

```rust
pub struct OsInfo {
    pub distro: Distro,
    pub distro_family: DistroFamily,  // Debian, RedHat, Suse, Alpine, Arch, Unknown
    pub version: String,
    pub package_manager: PackageManager,  // Apt, Dnf, Yum, Zypper, Apk, Unknown
    pub firewall_manager: FirewallManager,  // Ufw, Firewalld, Iptables, Unknown
    pub service_manager: ServiceManager,  // Systemd, Sysvinit, Openrc
    pub selinux_status: Option<SelinuxStatus>,  // Enforcing, Permissive, Disabled
}

// Detection: parse /etc/os-release, fallback to `which apt/dnf/yum`
```

**3.2 Package manager abstraction:**

```rust
#[async_trait]
pub trait PackageOps: Send + Sync {
    async fn search(&self, conn: &Connection, query: &str) -> Result<Vec<PackageInfo>>;
    async fn install(&self, conn: &Connection, package: &str) -> Result<CommandOutput>;
    async fn remove(&self, conn: &Connection, package: &str) -> Result<CommandOutput>;
    async fn update_index(&self, conn: &Connection) -> Result<CommandOutput>;
    async fn upgrade_all(&self, conn: &Connection) -> Result<CommandOutput>;
    async fn list_installed(&self, conn: &Connection) -> Result<Vec<PackageInfo>>;
    async fn info(&self, conn: &Connection, package: &str) -> Result<PackageInfo>;
    fn display_name(&self) -> &str;
}
```

Implementations: `AptOps` (existing, refactored), `DnfOps` (new), `YumOps` (CentOS 7 legacy).

**Command mapping:**

| Operation | APT | DNF/YUM |
|---|---|---|
| Search | `apt-cache search` | `dnf search` |
| Install | `sudo apt install -y` | `sudo dnf install -y` |
| Remove | `sudo apt remove -y` | `sudo dnf remove -y` |
| Update index | `sudo apt update` | `sudo dnf check-update; true` |
| Upgrade | `sudo apt upgrade -y` | `sudo dnf upgrade -y` |
| List installed | `dpkg-query -W` | `dnf list installed` |
| Info | `apt-cache show` | `dnf info` |

**3.3 Firewall manager abstraction:**

```rust
#[async_trait]
pub trait FirewallOps: Send + Sync {
    async fn status(&self, conn: &Connection) -> Result<FirewallStatus>;
    async fn list_rules(&self, conn: &Connection) -> Result<Vec<FirewallRule>>;
    async fn add_rule(&self, conn: &Connection, rule: &FirewallRule) -> Result<CommandOutput>;
    async fn delete_rule(&self, conn: &Connection, rule_id: &str) -> Result<CommandOutput>;
    async fn enable(&self, conn: &Connection) -> Result<CommandOutput>;
    async fn disable(&self, conn: &Connection) -> Result<CommandOutput>;
}
```

Implementations: `UfwOps` (existing, refactored), `FirewalldOps` (new).

**Firewalld-specific features to surface:**
- Zone selector dropdown (public, home, internal, trusted)
- Service-based rules ("http", "ssh") shown as named entries
- Rich rules in a separate "Advanced" section
- Always apply `--permanent` + `firewall-cmd --reload`

**3.4 Frontend changes:**

- Tabs say "Packages" and "Firewall" (not "APT" or "UFW")
- Subtitle shows backend: "Managing packages via dnf on Rocky Linux 9"
- Identical UI layout — only backend commands change
- Unsupported distro: "Package management not available for [distro]"
- Dashboard shows: OS name + version, kernel, architecture, SELinux status

### Acceptance criteria
- [ ] Auto-detects distro, package manager, firewall manager, SELinux on connect
- [ ] Package tab works with dnf/yum (search, install, remove, update)
- [ ] Firewall tab works with firewalld (zones, services, ports, rich rules)
- [ ] Graceful "not supported" message for unsupported distros
- [ ] Existing APT/UFW functionality unchanged
- [ ] Dashboard shows OS info and SELinux status

---

## 4. Closed-Source Growth Strategy

### Why this matters
Since Servera remains proprietary, you need aggressive alternative strategies for trust, discovery, and community. Many successful developer tools (Termius, Warp, TablePlus, Royal TSX) are closed-source and thrive — but they invest heavily in these areas.

### What to build

**4.1 Generous free tier (your growth engine):**

| Feature | Free | Pro (later) |
|---|---|---|
| SSH terminal, SFTP, dashboard, Docker, firewall, packages, processes, logs, port scanner, snippets, palette | Unlimited | Unlimited |
| Server profiles | Up to 5 | Unlimited |
| Hosting tab, server groups, AI, alerts | — | ✓ |

5 servers is enough for personal/homelab use but forces professionals to upgrade.

**4.2 Website (servera.dev):**

- Hero section with 15-second looping demo video
- Feature grid with screenshots
- Comparison table vs Termius, MobaXterm, PuTTY
- Download buttons for all 3 platforms
- Pricing page (Free / Pro / Team)
- Public changelog showing active development
- Blog for SEO content

**4.3 In-app referral program:**

"Give 1 month Pro, get 1 month Pro" — unique referral link per user, cap at 12 months free. Track in Settings → "Share Servera" panel.

**4.4 Community channels:**

- **Discord** — #general, #support, #feature-requests, #showcase, #tips-and-tricks
- **Public roadmap** — Canny or Notion board where users vote on features
- **Beta program** — "Servera Insiders" get early access 2 weeks before public release
- **YouTube** — Short tutorials (2-3 min): "Deploy a Next.js app to a $5 VPS", "Monitor Docker without Portainer"

**4.5 SEO content:**

Target high-intent keywords:
- "Best SSH client for Mac 2026"
- "Self-hosted alternative to Vercel"
- "Docker container management GUI"
- "Monitor server without installing agent"

**4.6 Launch sequence:**

| Day | Action |
|---|---|
| D-14 | Tease on Twitter/X with preview screenshots |
| D-7 | Invite 50 beta users from Discord |
| D-3 | Send press kit to tech YouTubers / bloggers |
| D-0 | Show HN + Reddit (r/selfhosted, r/homelab, r/devops) + Product Hunt |
| D+1 | Respond to every comment everywhere |
| D+7 | Blog: "Building Servera: Why Tauri over Electron" |
| D+14 | Share first user stories and metrics |

### Acceptance criteria
- [ ] Landing page live at servera.dev with downloads
- [ ] Free tier working with 5-server limit
- [ ] Referral program implemented
- [ ] Discord server live with welcome flow
- [ ] Public roadmap page with voting
- [ ] 3+ launch blog posts ready
- [ ] Product Hunt listing prepared
- [ ] Press kit ready (screenshots, logo, one-pager)

---

## 5. Auto-Updater

### What to build

**5.1 Tauri v2 updater plugin:**

```json
// tauri.conf.json
{
  "plugins": {
    "updater": {
      "active": true,
      "pubkey": "YOUR_MINISIGN_PUBLIC_KEY",
      "endpoints": [
        "https://releases.servera.dev/{{target}}/{{arch}}/{{current_version}}"
      ]
    }
  }
}
```

**5.2 Update manifest server** — static JSON on CloudFlare R2 or S3:

```json
{
  "version": "0.2.0",
  "notes": "SSH config import, jump host support, RHEL support",
  "pub_date": "2026-04-15T00:00:00Z",
  "platforms": {
    "darwin-aarch64": { "signature": "...", "url": "https://releases.servera.dev/downloads/..." },
    "darwin-x86_64": { "signature": "...", "url": "..." },
    "linux-x86_64": { "signature": "...", "url": "..." },
    "windows-x86_64": { "signature": "...", "url": "..." }
  }
}
```

**5.3 UX:** Check on launch (5s delay) + every 6 hours. Non-blocking toast in bottom-right: "Servera 0.2.0 available — What's new | Update now | Later". Background download with progress. Restart prompt after download (never auto-restart). "Later" hides for session, re-shows on next launch.

**5.4 CI pipeline:** GitHub Actions on tag push → build all platforms → sign with Tauri minisign → upload artifacts → update manifest JSON.

### Acceptance criteria
- [ ] Checks for updates on launch and periodically
- [ ] Non-blocking toast with changelog preview
- [ ] Background download with progress
- [ ] Signed updates (tamper-proof)
- [ ] CI/CD builds and publishes on tag push

---

## 6. Onboarding Wizard

### What to build

**4-step wizard triggered on first launch (no existing profiles):**

**Step 1 — Welcome:** Logo + tagline + two CTAs: "Import SSH Config" (primary) and "Add Server Manually". Skip button.

**Step 2 — Import or Add:** Import path reuses the SSH config import preview table. Manual path shows minimal form (name, IP, port, username, auth).

**Step 3 — Connect & Verify:** Real-time connection test: TCP → handshake → auth → metrics loading. On success: live dashboard preview. On failure: clear error + fix suggestion + retry button.

**Step 4 — Quick Tour:** 4-panel slideshow: Dashboard, Terminal, Files, OpsPilot. "Get started" → lands on Dashboard.

**Post-wizard:** Flag `onboarding_completed` in config. Tour re-accessible from Help menu. Contextual tooltips on first visit to each tab.

### Acceptance criteria
- [ ] Wizard auto-launches on first run
- [ ] Both import and manual paths work end-to-end
- [ ] Connection test with step-by-step feedback
- [ ] Clear error messages with fix suggestions
- [ ] Feature tour with 4 panels
- [ ] Doesn't re-appear after completion
- [ ] Tour re-accessible from Help menu

---

## Phase 1 Delivery Checklist

| Feature | Est. Effort | Impact |
|---|---|---|
| SSH config import | 1 week | High — removes onboarding friction |
| Jump host support | 1.5 weeks | High — unblocks enterprise users |
| RHEL/CentOS support | 1.5 weeks | High — doubles server market |
| Growth strategy & website | 1 week | Critical — drives downloads |
| Auto-updater | 3 days | Medium — keeps users current |
| Onboarding wizard | 1 week | High — determines activation rate |

**Total: 6–7 weeks**

**Key metrics:** Downloads/week (500+), activation rate (60%+), time-to-first-connection (<60s), 30-day retention (40%+), Discord members (200+).
