use super::traits::{PackageManager, PackageInfo};

pub struct AptManager;

impl PackageManager for AptManager {
    fn name(&self) -> &str {
        "APT (Debian/Ubuntu)"
    }

    fn check_exists_cmd(&self) -> &str {
        "command -v apt-get"
    }

    fn update_cmd(&self) -> &str {
        "sudo apt-get update -qq"
    }

    fn list_upgradable_cmd(&self) -> &str {
        "apt list --upgradable 2>/dev/null"
    }

    fn upgrade_cmd(&self) -> &str {
        "sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y"
    }

    fn parse_upgradable(&self, output: &str) -> Vec<PackageInfo> {
        // Output format:
        // curl/jammy-updates,jammy-security 7.81.0-1ubuntu1.20 amd64 [upgradable from: 7.81.0-1ubuntu1.19]
        output.lines()
            .filter(|l| l.contains("[upgradable from:"))
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 3 { return None; }
                
                let name_source = parts[0];
                let new_version = parts[1].to_string();
                let arch = parts[2].to_string();
                
                let (name, source) = if let Some(idx) = name_source.find('/') {
                    (&name_source[..idx], &name_source[idx+1..])
                } else {
                    (name_source, "unknown")
                };

                // Extract old version via regex-like manual match or simple search
                let old_version = if let Some(idx) = line.find("upgradable from: ") {
                    let start = idx + 17;
                    if let Some(end) = line[start..].find(']') {
                        line[start..start+end].to_string()
                    } else {
                        "unknown".to_string()
                    }
                } else {
                    "unknown".to_string()
                };

                Some(PackageInfo {
                    name: name.to_string(),
                    old_version,
                    new_version,
                    source: source.to_string(),
                    arch,
                })
            })
            .collect()
    }
}
