use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};
use glob::glob;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ForwardRule {
    pub local_port: u16,
    pub remote_host: String,
    pub remote_port: u16,
    pub is_remote: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SshConfigEntry {
    pub host_patterns: Vec<String>,
    pub hostname: Option<String>,
    pub port: Option<u16>,
    pub user: Option<String>,
    pub identity_files: Vec<String>,
    pub proxy_jump: Option<String>,
    pub proxy_command: Option<String>,
    pub local_forwards: Vec<ForwardRule>,
    pub remote_forwards: Vec<ForwardRule>,
    pub is_wildcard: bool,
    pub is_match_block: bool,
    pub raw_directives: HashMap<String, String>,
}

impl SshConfigEntry {
    pub fn apply_defaults(&mut self, other: &SshConfigEntry) {
        if self.hostname.is_none() { self.hostname = other.hostname.clone(); }
        if self.port.is_none() { self.port = other.port; }
        if self.user.is_none() { self.user = other.user.clone(); }
        if self.identity_files.is_empty() { self.identity_files = other.identity_files.clone(); }
        if self.proxy_jump.is_none() { self.proxy_jump = other.proxy_jump.clone(); }
        if self.proxy_command.is_none() { self.proxy_command = other.proxy_command.clone(); }
        
        // Merge forwards
        for f in &other.local_forwards {
            if !self.local_forwards.iter().any(|sf| sf.local_port == f.local_port) {
                self.local_forwards.push(f.clone());
            }
        }
        for f in &other.remote_forwards {
            if !self.remote_forwards.iter().any(|sf| sf.remote_port == f.remote_port) {
                self.remote_forwards.push(f.clone());
            }
        }
    }
}

pub fn expand_tilde(path_str: &str) -> String {
    if path_str.starts_with('~') {
        if let Some(home) = home::home_dir() {
            let mut path = home;
            if path_str.len() > 2 {
                path.push(&path_str[2..]);
            }
            return path.to_string_lossy().into_owned();
        }
    }
    path_str.to_string()
}

fn split_directive(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') { return None; }
    
    // Directive could be "Key Value" or "Key=Value" or "Key   Value"
    let parts: Vec<&str> = if line.contains('=') {
        line.splitn(2, '=').collect()
    } else {
        line.splitn(2, |c: char| c.is_whitespace()).collect()
    };

    if parts.len() == 2 {
        Some((parts[0].trim().to_string(), parts[1].trim().to_string()))
    } else {
        None
    }
}

fn parse_forward(value: &str, is_remote: bool) -> Option<ForwardRule> {
    // Format: [bind_address:]port host:hostport
    let parts: Vec<&str> = value.split_whitespace().collect();
    if parts.len() < 2 { return None; }
    
    let local_port: u16 = parts[0].split(':').last()?.parse().ok()?;
    let remote_parts: Vec<&str> = parts[1].split(':').collect();
    if remote_parts.len() < 2 { return None; }
    
    let remote_host = remote_parts[0].to_string();
    let remote_port: u16 = remote_parts[1].parse().ok()?;
    
    Some(ForwardRule {
        local_port,
        remote_host,
        remote_port,
        is_remote,
    })
}

pub fn parse_ssh_config(path: &Path, seen_paths: &mut Vec<PathBuf>) -> Result<Vec<SshConfigEntry>, String> {
    if seen_paths.contains(&path.to_path_buf()) {
        return Ok(vec![]); // Prevent infinite recursion
    }
    seen_paths.push(path.to_path_buf());

    let content = fs::read_to_string(path).map_err(|e| format!("Failed to read config {:?}: {}", path, e))?;
    let mut entries: Vec<SshConfigEntry> = Vec::new();
    let mut current: Option<SshConfigEntry> = None;

    for line in content.lines() {
        let directive = split_directive(line);
        if directive.is_none() { continue; }
        let (key, value) = directive.unwrap();
        
        match key.to_lowercase().as_str() {
            "host" => {
                if let Some(entry) = current.take() { entries.push(entry); }
                let patterns: Vec<String> = value.split_whitespace().map(|s| s.to_string()).collect();
                current = Some(SshConfigEntry {
                    host_patterns: patterns.clone(),
                    is_wildcard: patterns.iter().all(|p| p == "*"),
                    ..SshConfigEntry::default()
                });
            },
            "include" => {
                let parent = path.parent().unwrap_or(Path::new("."));
                let pattern = expand_tilde(&value);
                let glob_path = if Path::new(&pattern).is_absolute() {
                    pattern
                } else {
                    parent.join(pattern).to_string_lossy().into_owned()
                };

                if let Ok(paths) = glob(&glob_path) {
                    for entry in paths.flatten() {
                        if let Ok(sub_entries) = parse_ssh_config(&entry, seen_paths) {
                            entries.extend(sub_entries);
                        }
                    }
                }
            },
            "hostname" => { if let Some(e) = &mut current { e.hostname = Some(value); } },
            "port" => { if let Some(e) = &mut current { e.port = value.parse().ok(); } },
            "user" => { if let Some(e) = &mut current { e.user = Some(value); } },
            "identityfile" => { if let Some(e) = &mut current { e.identity_files.push(expand_tilde(&value)); } },
            "proxyjump" => { if let Some(e) = &mut current { e.proxy_jump = Some(value); } },
            "proxycommand" => { if let Some(e) = &mut current { e.proxy_command = Some(value); } },
            "localforward" => { if let Some(e) = &mut current { if let Some(f) = parse_forward(&value, false) { e.local_forwards.push(f); } } },
            "remoteforward" => { if let Some(e) = &mut current { if let Some(f) = parse_forward(&value, true) { e.remote_forwards.push(f); } } },
            "match" => {
                if let Some(entry) = current.take() { entries.push(entry); }
                current = Some(SshConfigEntry { is_match_block: true, ..SshConfigEntry::default() });
            },
            _ => { if let Some(e) = &mut current { e.raw_directives.insert(key, value); } }
        }
    }
    
    if let Some(entry) = current { entries.push(entry); }

    // Apply wildcard defaults
    let wildcards: Vec<SshConfigEntry> = entries.iter().filter(|e| e.is_wildcard).cloned().collect();
    for entry in entries.iter_mut().filter(|e| !e.is_wildcard) {
        for wc in &wildcards {
            entry.apply_defaults(wc);
        }
    }

    Ok(entries)
}
