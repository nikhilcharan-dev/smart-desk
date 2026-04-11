pub mod traits;
pub mod apt;
pub mod yum;
pub mod pacman;
pub mod linux_monitor;

#[cfg(test)]
mod os_test;

use traits::{PackageManager, SystemMonitor};
pub use traits::{PackageInfo, SystemMetrics};

pub fn detect_package_manager(exec_fn: impl Fn(&str) -> Result<String, String>) -> Option<Box<dyn PackageManager>> {
    let managers: Vec<Box<dyn PackageManager>> = vec![
        Box::new(apt::AptManager),
        Box::new(yum::YumManager),
        Box::new(pacman::PacmanManager),
    ];

    for manager in managers {
        if let Ok(path) = exec_fn(manager.check_exists_cmd()) {
            if !path.trim().is_empty() && !path.contains("not found") && !path.contains("missing") {
                return Some(manager);
            }
        }
    }
    None
}

pub fn get_default_monitor() -> Box<dyn SystemMonitor> {
    Box::new(linux_monitor::LinuxMonitor)
}
