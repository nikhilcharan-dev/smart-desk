use super::traits::{PackageManager, PackageInfo};

pub struct WingetManager;

impl PackageManager for WingetManager {
    fn name(&self) -> &str {
        "Winget (Windows)"
    }

    fn check_exists_cmd(&self) -> &str {
        "where winget"
    }

    fn update_cmd(&self) -> &str {
        "winget source update"
    }

    fn list_upgradable_cmd(&self) -> &str {
        "winget list --upgradeable"
    }

    fn upgrade_cmd(&self) -> &str {
        "winget upgrade --all --silent --accept-package-agreements --accept-source-agreements"
    }

    fn parse_upgradable(&self, output: &str) -> Vec<PackageInfo> {
        // Winget output usually looks like:
        // Name            Id              Version Available Source
        // --------------------------------------------------------
        // App Name        App.Id          1.2.3   1.2.4     winget
        
        output.lines()
            .skip_while(|l| !l.contains("---"))
            .skip(1)
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                // This is a simplified parser; winget output columns are fixed-width.
                // For now, we take the last few parts as versions.
                if parts.len() < 4 { return None; }
                
                let n = parts.len();
                let source = parts[n-1].to_string();
                let new_version = parts[n-2].to_string();
                let old_version = parts[n-3].to_string();
                // Reconstruct name from the remaining parts
                let name = parts[0..n-4].join(" ");
                
                Some(PackageInfo {
                    name: if name.is_empty() { parts[0].to_string() } else { name },
                    old_version,
                    new_version,
                    source,
                    arch: "unknown".to_string(),
                })
            })
            .collect()
    }
}
