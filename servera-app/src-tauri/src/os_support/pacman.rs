use super::traits::{PackageManager, PackageInfo};

pub struct PacmanManager;

impl PackageManager for PacmanManager {
    fn name(&self) -> &str {
        "Pacman (Arch Linux)"
    }

    fn check_exists_cmd(&self) -> &str {
        "command -v pacman"
    }

    fn update_cmd(&self) -> &str {
        // sync databases without upgrading
        "sudo pacman -Sy"
    }

    fn list_upgradable_cmd(&self) -> &str {
        // use checkupdates (safe way to check without sync)
        "checkupdates || pacman -Qu || echo ''"
    }

    fn upgrade_cmd(&self) -> &str {
        "sudo pacman -Syu --noconfirm"
    }

    fn parse_upgradable(&self, output: &str) -> Vec<PackageInfo> {
        // Output format of checkupdates:
        // linux 6.6.1.arch1-1 -> 6.6.2.arch1-1
        // pacman 6.0.2-9 -> 6.0.2-11
        output.lines()
            .filter(|l| l.contains(" -> "))
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 4 { return None; }
                
                let name = parts[0];
                let old_version = parts[1];
                let new_version = parts[3];

                Some(PackageInfo {
                    name: name.to_string(),
                    old_version: old_version.to_string(),
                    new_version: new_version.to_string(),
                    source: "arch-repos".to_string(),
                    arch: "unknown".to_string(),
                })
            })
            .collect()
    }
}
