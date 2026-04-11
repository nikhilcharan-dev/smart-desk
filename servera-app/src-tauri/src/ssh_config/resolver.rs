
use std::fs;
use crate::ssh_config::DetectResult;

pub fn detect_ssh_config() -> DetectResult {
    let home = home::home_dir();
    if home.is_none() {
        return DetectResult {
            path: "".to_string(),
            exists: false,
            entry_count: 0,
            last_modified: None,
        };
    }

    let config_path = home.unwrap().join(".ssh").join("config");
    let exists = config_path.exists();
    let mut entry_count = 0;
    let mut last_modified = None;

    if exists {
        if let Ok(metadata) = fs::metadata(&config_path) {
            if let Ok(modified) = metadata.modified() {
                last_modified = modified.duration_since(std::time::UNIX_EPOCH).ok().map(|d| d.as_secs());
            }
        }
        
        // Simple line count or "Host" count for estimation
        if let Ok(content) = fs::read_to_string(&config_path) {
            entry_count = content.lines().filter(|l| l.trim().to_lowercase().starts_with("host ")).count();
        }
    }

    DetectResult {
        path: config_path.to_string_lossy().to_string(),
        exists,
        entry_count,
        last_modified,
    }
}


