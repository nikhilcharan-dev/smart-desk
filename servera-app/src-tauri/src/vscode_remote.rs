// Launches local VS Code Desktop against a remote VM over its Remote-SSH
// extension, reusing the profile's existing SSH connection details instead
// of asking the user to configure a Host entry by hand.

use std::fs;
use std::process::Command;

use crate::profile_manager::Profile;

const REMOTE_SSH_EXT_ID: &str = "ms-vscode-remote.remote-ssh";

/// Whether the `code` CLI is reachable on PATH at all.
pub fn check_vscode_cli() -> bool {
    Command::new("code").arg("--version").output().is_ok()
}

/// Installs the Remote-SSH extension if it isn't already present.
/// Returns true if it had to be installed, false if it was already there.
pub fn ensure_remote_ssh_extension() -> Result<bool, String> {
    let list = Command::new("code")
        .arg("--list-extensions")
        .output()
        .map_err(|e| format!("Failed to run 'code --list-extensions': {e}"))?;
    let installed = String::from_utf8_lossy(&list.stdout);
    if installed
        .lines()
        .any(|l| l.trim().eq_ignore_ascii_case(REMOTE_SSH_EXT_ID))
    {
        return Ok(false);
    }

    let status = Command::new("code")
        .arg("--install-extension")
        .arg(REMOTE_SSH_EXT_ID)
        .status()
        .map_err(|e| format!("Failed to install the Remote-SSH extension: {e}"))?;
    if !status.success() {
        return Err("Failed to install the Remote-SSH extension".to_string());
    }
    Ok(true)
}

fn ssh_config_path() -> Result<std::path::PathBuf, String> {
    let home = home::home_dir().ok_or("Could not determine home directory")?;
    Ok(home.join(".ssh").join("config"))
}

/// Writes (or updates in place) a marker-delimited `Host` block for this
/// profile in `~/.ssh/config` so Remote-SSH can connect to it, without
/// touching any other entries the user has in that file. Returns the Host
/// alias to pass to `code --remote ssh-remote+<alias>`.
pub fn ensure_ssh_config_host(profile: &Profile) -> Result<String, String> {
    let alias = format!("servera-{}", profile.id);
    let start_marker = format!("# >>> servera:{} >>>", profile.id);
    let end_marker = format!("# <<< servera:{} <<<", profile.id);

    let mut block = format!(
        "{start_marker}\nHost {alias}\n    HostName {}\n    User {}\n    Port {}\n",
        profile.ip, profile.user, profile.port
    );
    if let Some(key) = &profile.private_key_path {
        block.push_str(&format!("    IdentityFile {key}\n"));
    }
    if let Some(jump) = &profile.proxy_jump {
        block.push_str(&format!("    ProxyJump {jump}\n"));
    }
    block.push_str(&end_marker);
    block.push('\n');

    let path = ssh_config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut new_content = String::new();
    let mut skipping = false;
    let mut replaced = false;
    for line in existing.lines() {
        if line.trim() == start_marker {
            new_content.push_str(&block);
            skipping = true;
            replaced = true;
            continue;
        }
        if line.trim() == end_marker {
            skipping = false;
            continue;
        }
        if skipping {
            continue;
        }
        new_content.push_str(line);
        new_content.push('\n');
    }
    if !replaced {
        new_content.push_str(&block);
    }

    fs::write(&path, new_content).map_err(|e| e.to_string())?;
    Ok(alias)
}

/// Spawns local VS Code Desktop connected via Remote-SSH to `alias`, rooted
/// at `path` on the remote host.
pub fn open_vscode_remote(alias: &str, path: &str) -> Result<(), String> {
    Command::new("code")
        .arg("--remote")
        .arg(format!("ssh-remote+{alias}"))
        .arg(path)
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to launch VS Code: {e}"))
}
