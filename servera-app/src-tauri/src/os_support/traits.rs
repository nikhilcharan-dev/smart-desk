use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PackageInfo {
    pub name: String,
    pub old_version: String,
    pub new_version: String,
    pub source: String,
    pub arch: String,
}

pub trait PackageManager: Send + Sync {
    fn name(&self) -> &str;
    
    /// Command to check if this package manager is available
    fn check_exists_cmd(&self) -> &str;
    
    /// Command to refresh package lists
    fn update_cmd(&self) -> &str;
    
    /// Command to list upgradable packages
    fn list_upgradable_cmd(&self) -> &str;
    
    /// Command to perform the upgrade
    fn upgrade_cmd(&self) -> &str;
    
    /// Parse the output of list_upgradable_cmd into structured data
    fn parse_upgradable(&self, output: &str) -> Vec<PackageInfo>;
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct SystemMetrics {
    pub os_name: String,
    pub uptime: String,
    pub cpu_usage: f32,
    pub mem_total_mb: u64,
    pub mem_used_mb: u64,
    pub mem_pct: f32,
    pub temp: String,
    pub net_rx_bytes: u64,
    pub net_tx_bytes: u64,
    pub disk_usage: Vec<DiskInfo>,
    pub top_processes: Vec<ProcessInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DiskInfo {
    pub mount: String,
    pub total_gb: f32,
    pub used_gb: f32,
    pub pct: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ProcessInfo {
    pub pid: String,
    pub cpu_pct: f32,
    pub mem_pct: f32,
    pub name: String,
}

pub trait SystemMonitor: Send + Sync {
    /// Combined command or sequence of commands to gather all stats
    fn gather_stats_cmd(&self) -> String;
    
    /// Parse findings into SystemMetrics
    fn parse_stats(&self, output: &str) -> Result<SystemMetrics, String>;
}
