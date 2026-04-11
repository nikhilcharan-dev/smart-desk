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

        profiles.push(Profile {
            id,
            name,
            ip,
            user,
            port,
            private_key_path,
            tags: vec!["imported".to_string()],
            color: None,
            last_connected: None,
            proxy_jump,
        });
    }

    profiles
}
