use super::*;
use super::traits::{PackageManager, SystemMonitor};

#[test]
fn test_detect_apt() {
    let mock_cmd = |cmd: &str| {
        if cmd == "command -v apt-get" {
            Ok("/usr/bin/apt-get".to_string())
        } else {
            Err("not found".to_string())
        }
    };
    let mgr = detect_package_manager(mock_cmd).unwrap();
    assert!(mgr.name().contains("APT"));
}

#[test]
fn test_detect_yum() {
    let mock_cmd = |cmd: &str| {
        if cmd == "command -v dnf || command -v yum" {
            Ok("/usr/bin/dnf".to_string())
        } else {
            Err("not found".to_string())
        }
    };
    let mgr = detect_package_manager(mock_cmd).unwrap();
    assert!(mgr.name().contains("YUM"));
}

#[test]
fn test_detect_pacman() {
    let mock_cmd = |cmd: &str| {
        if cmd == "command -v pacman" {
            Ok("/usr/bin/pacman".to_string())
        } else {
            Err("not found".to_string())
        }
    };
    let mgr = detect_package_manager(mock_cmd).unwrap();
    assert!(mgr.name().contains("Pacman"));
}

#[test]
fn test_detect_none() {
    let mock_cmd = |_: &str| Err("not found".to_string());
    let mgr = detect_package_manager(mock_cmd);
    assert!(mgr.is_none());
}

#[test]
fn test_linux_monitor_parsing() {
    let monitor = linux_monitor::LinuxMonitor;
    let mock_output = r#"
up 2 hours, 30 minutes
---
              total        used        free      shared  buff/cache   available
Mem:           8192        4096        2048         100        2048        3072
---
/dev/sda1        50G        10G        40G    20% /
---
PRETTY_NAME="Ubuntu 22.04 LTS"
---
cpu  12345 678 9012 345678 90 12 34 0 0 0
---
 eth0: 1000 2000    0    0    0     0          0          0     3000 4000    0    0    0     0          0          0
---
  PID  %CPU  %MEM COMMAND
 1234  12.5   2.0  rust_process
---
45000"#.trim();
    
    let metrics = monitor.parse_stats(mock_output).unwrap();
    assert_eq!(metrics.os_name, "Ubuntu 22.04 LTS");
    assert_eq!(metrics.mem_total_mb, 8192);
    assert_eq!(metrics.mem_used_mb, 4096);
    assert_eq!(metrics.mem_pct, 50.0);
    assert!(metrics.uptime.contains("2 hours"));
    assert_eq!(metrics.disk_usage[0].pct, 20.0);
}

#[test]
fn test_apt_update_parsing() {
    let mgr = apt::AptManager;
    let mock_output = "curl/jammy-updates 7.81.0-1ubuntu1.20 amd64 [upgradable from: 7.81.0-1ubuntu1.19]";
    let updates = mgr.parse_upgradable(mock_output);
    assert_eq!(updates.len(), 1);
    assert_eq!(updates[0].name, "curl");
    assert_eq!(updates[0].old_version, "7.81.0-1ubuntu1.19");
}
