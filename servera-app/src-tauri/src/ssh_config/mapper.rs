use crate::profile_manager::Profile;
use crate::ssh_config::parser::SshConfigEntry;
use uuid::Uuid;

pub fn map_entry_to_profile(entry: &SshConfigEntry) -> Vec<Profile> {
    let mut profiles = Vec::new();

    // Each host pattern gets its own profile
    for pattern in &entry.host_patterns {
        if pattern == "*" { continue; } // Skip pure wildcard entries in final import

        let id = Uuid::new_v4().to_string();
        let name = pattern.clone();
        let ip = entry.hostname.clone().unwrap_or_else(|| pattern.clone());
        let user = entry.user.clone().unwrap_or_else(|| "root".to_string());
        let port = entry.port.unwrap_or(22);
        let private_key_path = entry.identity_files.first().cloned();
        let proxy_jump = entry.proxy_jump.clone();

        let mut tags = vec!["imported".to_string()];
        let mut profile_tunnels = Vec::new();
        profile_tunnels.extend(entry.local_forwards.clone());
        profile_tunnels.extend(entry.remote_forwards.clone());

        if entry.is_wireguard || !profile_tunnels.is_empty() {
            tags.push("gateway".to_string());
        }

        profiles.push(Profile {
            id,
            name,
            ip,
            user,
            port,
            private_key_path,
            tags,
            color: None,
            last_connected: None,
            proxy_jump,
            remote_os: None,
            tunnels: if profile_tunnels.is_empty() { None } else { Some(profile_tunnels) },
            wg_config: entry.wg_config.clone(),
            wg_mode: None,
            default_local_path: None,
            default_remote_path: None,
        });
    }

    profiles
}
