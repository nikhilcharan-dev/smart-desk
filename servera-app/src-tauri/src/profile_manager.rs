use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
    pub ip: String,
    pub user: String,
    pub port: u16,
    pub private_key_path: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub color: Option<String>,
    #[serde(default)]
    pub last_connected: Option<u64>,
    #[serde(default)]
    pub proxy_jump: Option<String>,
    #[serde(default)]
    pub remote_os: Option<String>,
    #[serde(default)]
    pub tunnels: Option<Vec<crate::ssh_config::parser::ForwardRule>>,
    #[serde(default)]
    pub wg_config: Option<crate::ssh_config::wireguard::WireGuardConfig>,
    /// WireGuard routing override: None/"auto" = route when IP matches the
    /// active gateway's AllowedIPs, "always" = require the gateway, "never" = direct.
    #[serde(default)]
    pub wg_mode: Option<String>,
    /// Default SFTP-view starting paths for this profile, remembered per-side
    /// so the file explorer can reopen where the user left off.
    #[serde(default)]
    pub default_local_path: Option<String>,
    #[serde(default)]
    pub default_remote_path: Option<String>,
}

#[derive(Serialize, Deserialize, Default)]
pub struct ProfileStore {
    pub profiles: Vec<Profile>,
}

pub struct ProfileManager {
    path: PathBuf,
}

impl ProfileManager {
    pub fn new(app: &AppHandle) -> Self {
        let path = app
            .path()
            .app_data_dir()
            .unwrap()
            .join("profiles.json");
        
        // Ensure directory exists
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }

        Self { path }
    }

    pub fn load(&self) -> Result<Vec<Profile>, String> {
        if !self.path.exists() {
            return Ok(vec![]);
        }
        let data = fs::read_to_string(&self.path).map_err(|e| e.to_string())?;
        let store: ProfileStore = serde_json::from_str(&data).map_err(|e| e.to_string())?;
        Ok(store.profiles)
    }

    pub fn save(&self, mut profiles: Vec<Profile>) -> Result<(), String> {
        // WireGuard secrets never touch profiles.json: any key still on the
        // struct is moved to the OS keyring before serializing. This is the
        // single persistence choke point, so every save path is covered.
        for p in profiles.iter_mut() {
            if let Some(wg) = p.wg_config.as_mut() {
                if let Some(key) = wg.private_key.take() {
                    save_password("servera-wireguard", &p.id, &key)?;
                }
                if let Some(psk) = wg.preshared_key.take() {
                    save_password("servera-wireguard-psk", &p.id, &psk)?;
                }
            }
        }
        let store = ProfileStore { profiles };
        let data = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
        fs::write(&self.path, data).map_err(|e| e.to_string())?;
        Ok(())
    }
}

// Keyring usage wrapper
pub fn save_password(service: &str, user: &str, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(service, user).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| e.to_string())
}

pub fn get_password(service: &str, user: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(service, user).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

pub fn delete_password(service: &str, user: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(service, user).map_err(|e| e.to_string())?;
    entry.delete_password().map_err(|e| e.to_string())
}
