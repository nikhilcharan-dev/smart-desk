use super::traits::{PackageManager, PackageInfo};

pub struct YumManager;

impl PackageManager for YumManager {
    fn name(&self) -> &str {
        "YUM/DNF (RHEL/CentOS)"
    }

    fn check_exists_cmd(&self) -> &str {
        "command -v dnf || command -v yum"
    }

    fn update_cmd(&self) -> &str {
        // dnf check-update returns 100 if updates are available, 0 if not, 1 on error
        // we use a wrapper to avoid failing the SSH command
        "sudo dnf check-update > /dev/null 2>&1 || sudo yum check-update > /dev/null 2>&1 || true"
    }

    fn list_upgradable_cmd(&self) -> &str {
        "dnf check-update --quiet || yum check-update --quiet || true"
    }

    fn upgrade_cmd(&self) -> &str {
        "sudo dnf upgrade -y || sudo yum upgrade -y"
    }

    fn parse_upgradable(&self, output: &str) -> Vec<PackageInfo> {
        // Output format:
        // package_name.arch    version    repo
        // kernel.x86_64        5.14.0-362.8.1.el9_3    baseos
        output.lines()
            .filter(|l| !l.is_empty() && !l.starts_with("Security:") && !l.starts_with("Obsoleting"))
            .filter_map(|line| {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() < 3 { return None; }
                
                let name_arch = parts[0];
                let new_version = parts[1].to_string();
                let source = parts[2].to_string();

                let (name, arch) = if let Some(idx) = name_arch.rfind('.') {
                    (&name_arch[..idx], &name_arch[idx+1..])
                } else {
                    (name_arch, "unknown")
                };

                Some(PackageInfo {
                    name: name.to_string(),
                    old_version: "N/A".to_string(), // Yum doesn't easily show old version in check-update
                    new_version,
                    source,
                    arch: arch.to_string(),
                })
            })
            .collect()
    }
}
