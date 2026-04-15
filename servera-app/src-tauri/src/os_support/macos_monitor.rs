use super::traits::{SystemMonitor, SystemMetrics, DiskInfo, ProcessInfo};

pub struct MacOSMonitor;

impl SystemMonitor for MacOSMonitor {
    fn gather_stats_cmd(&self) -> String {
        r#"sw_vers -productName; sw_vers -productVersion; echo "---"; uptime; echo "---"; uname -v; echo "---"; uname -m; echo "---"; sysctl -n hw.ncpu; echo "---"; sysctl -n hw.memsize; echo "---"; vm_stat; echo "---"; df -h / | tail -1; echo "---"; top -l 1 -n 10 -o cpu -stats pid,cpu,mem,command | tail -n 10;"#.to_string()
    }

    fn parse_stats(&self, output: &str) -> Result<SystemMetrics, String> {
        let blocks: Vec<&str> = output.split("---").map(|s| s.trim()).collect();
        if blocks.len() < 8 {
            return Err(format!("Incomplete macOS monitor data: received {}/8 blocks", blocks.len()));
        }

        let os_name = blocks[0].replace('\n', " ").trim().to_string();
        let uptime = blocks[1].to_string();
        let kernel = blocks[2].to_string();
        let arch = blocks[3].to_string();
        let cpu_cores: u32 = blocks[4].parse().unwrap_or(0);
        
        // Memory
        let page_size = 4096; // Standard macOS page size is 4KB
        let mem_total_bytes: u64 = blocks[5].parse().unwrap_or(0);
        let mem_total_mb = mem_total_bytes / 1024 / 1024;
        
        let mem_used_mb;
        let mut active_pages: u64 = 0;
        let mut wired_pages: u64 = 0;
        let mut compressed_pages: u64 = 0;
        
        for line in blocks[6].lines() {
            if line.contains("Pages active:") {
                active_pages = line.split_whitespace().last().unwrap_or("0").trim_end_matches('.').parse().unwrap_or(0);
            } else if line.contains("Pages wired down:") {
                wired_pages = line.split_whitespace().last().unwrap_or("0").trim_end_matches('.').parse().unwrap_or(0);
            } else if line.contains("Pages occupied by compressor:") {
                compressed_pages = line.split_whitespace().last().unwrap_or("0").trim_end_matches('.').parse().unwrap_or(0);
            }
        }
        mem_used_mb = ((active_pages + wired_pages + compressed_pages) * page_size) / 1024 / 1024;
        let mem_pct = if mem_total_mb > 0 { (mem_used_mb as f32 / mem_total_mb as f32) * 100.0 } else { 0.0 };

        // Disk
        let mut disk_usage = Vec::new();
        let df_parts: Vec<&str> = blocks[7].split_whitespace().collect();
        if df_parts.len() >= 5 {
            let total_gb: f32 = df_parts[1].trim_end_matches('G').trim_end_matches('M').trim_end_matches('i').parse().unwrap_or(0.0);
            let used_gb: f32 = df_parts[2].trim_end_matches('G').trim_end_matches('M').trim_end_matches('i').parse().unwrap_or(0.0);
            let pct: f32 = df_parts[4].trim_end_matches('%').parse().unwrap_or(0.0);
            disk_usage.push(DiskInfo {
                mount: "/".to_string(),
                total_gb,
                used_gb,
                pct,
            });
        }

        // Processes
        let mut top_processes = Vec::new();
        if let Some(ps_block) = blocks.get(8) {
            for line in ps_block.lines() {
                let p: Vec<&str> = line.split_whitespace().collect();
                if p.len() >= 4 {
                    top_processes.push(ProcessInfo {
                        pid: p[0].to_string(),
                        cpu_pct: p[1].parse().unwrap_or(0.0),
                        mem_pct: p[2].trim_end_matches('M').trim_end_matches('K').parse().unwrap_or(0.0),
                        name: p[3..].join(" "),
                    });
                }
            }
        }

        Ok(SystemMetrics {
            os_name,
            uptime,
            kernel,
            arch,
            cpu_cores,
            cpu_usage: 0.0,
            mem_total_mb,
            mem_used_mb,
            mem_pct,
            temp: "N/A".into(),
            net_rx_bytes: 0,
            net_tx_bytes: 0,
            disk_usage,
            top_processes,
        })
    }
}
