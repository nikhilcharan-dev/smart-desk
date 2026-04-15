use super::traits::{PackageManager, PackageInfo};

pub struct BrewManager;

impl PackageManager for BrewManager {
    fn name(&self) -> &str {
        "Homebrew (macOS)"
    }

    fn check_exists_cmd(&self) -> &str {
        "command -v brew"
    }

    fn update_cmd(&self) -> &str {
        "brew update"
    }

    fn list_upgradable_cmd(&self) -> &str {
        "brew outdated --versions"
    }

    fn upgrade_cmd(&self) -> &str {
        "brew upgrade"
    }

    fn parse_upgradable(&self, output: &str) -> Vec<PackageInfo> {
        // Brew output (with --versions):
        // package_name 1.2.3 < 1.2.4
        output.lines()
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 { return None; }
                
                Some(PackageInfo {
                    name: parts[0].to_string(),
                    old_version: parts[1].to_string(),
                    new_version: parts[3].to_string(),
                    source: "brew".to_string(),
                    arch: "unknown".to_string(),
                })
            })
            .collect()
    }
}
