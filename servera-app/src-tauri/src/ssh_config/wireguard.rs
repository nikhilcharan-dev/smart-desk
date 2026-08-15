use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WireGuardConfig {
    pub interface_address: String,
    pub dns: Option<String>,
    pub endpoint: String,
    pub public_key: String,
    pub allowed_ips: String,
    // Secrets: held in memory during import, moved to the OS keyring on save —
    // never persisted to profiles.json (stripped in ProfileManager::save).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub private_key: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preshared_key: Option<String>,
    #[serde(default)]
    pub persistent_keepalive: Option<u16>,
    #[serde(default)]
    pub listen_port: Option<u16>,
    #[serde(default)]
    pub mtu: Option<u16>,
}

pub fn parse_wireguard_config(path: &Path) -> Result<Option<WireGuardConfig>, String> {
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    
    if !content.contains("[Interface]") || !content.contains("[Peer]") {
        return Ok(None);
    }

    let mut interface_address = String::new();
    let mut dns = None;
    let mut endpoint = String::new();
    let mut public_key = String::new();
    let mut allowed_ips = String::new();
    let mut private_key = None;
    let mut preshared_key = None;
    let mut persistent_keepalive = None;
    let mut listen_port = None;
    let mut mtu = None;

    let mut current_section = "";

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') { continue; }

        if line.starts_with('[') && line.ends_with(']') {
            current_section = &line[1..line.len()-1];
            continue;
        }

        let parts: Vec<&str> = line.splitn(2, '=').collect();
        if parts.len() < 2 { continue; }
        
        let key = parts[0].trim().to_lowercase();
        let value = parts[1].trim().to_string();

        match (current_section.to_lowercase().as_str(), key.as_str()) {
            ("interface", "address") => interface_address = value,
            ("interface", "dns") => dns = Some(value),
            ("interface", "privatekey") => private_key = Some(value),
            ("interface", "listenport") => listen_port = value.parse().ok(),
            ("interface", "mtu") => mtu = value.parse().ok(),
            ("peer", "endpoint") => endpoint = value,
            ("peer", "publickey") => public_key = value,
            ("peer", "allowedips") => allowed_ips = value,
            ("peer", "presharedkey") => preshared_key = Some(value),
            ("peer", "persistentkeepalive") => persistent_keepalive = value.parse().ok(),
            _ => {}
        }
    }

    if interface_address.is_empty() || endpoint.is_empty() {
        return Ok(None);
    }

    Ok(Some(WireGuardConfig {
        interface_address,
        dns,
        endpoint,
        public_key,
        allowed_ips,
        private_key,
        preshared_key,
        persistent_keepalive,
        listen_port,
        mtu,
    }))
}
