use super::traits::{SystemMonitor, SystemMetrics, DiskInfo, ProcessInfo};

pub struct LinuxMonitor;

impl SystemMonitor for LinuxMonitor {
    fn gather_stats_cmd(&self) -> String {
        // We use a combined script to minimize SSH overhead, similar to the original dashboard
        r#"
            uptime -p; 
            echo "---"; 
            free -m; 
            echo "---"; 
            df -h / | tail -1; 
            echo "---"; 
            grep PRETTY_NAME /etc/os-release; 
            echo "---"; 
            cat /proc/stat | grep '^cpu '; 
            echo "---"; 
            cat /proc/net/dev | grep -E 'eth|en|wl|veth' | sort -k2 -nr | head -n 1; 
            echo "---"; 
            ps -e -o pid,pcpu,pmem,comm --sort=-pcpu | head -n 10;
            echo "---"; 
            cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 'N/A'
        "#.to_string()
    }

    fn parse_stats(&self, output: &str) -> Result<SystemMetrics, String> {
        let blocks: Vec<&str> = output.split("---").map(|s| s.trim()).collect();
        if blocks.len() < 8 {
            return Err(format!("Incomplete monitor data: received {}/8 blocks", blocks.len()));
        }

        let uptime = blocks[0].replace("up ", "");
        let free_raw = blocks[1];
        let df_raw = blocks[2];
        let os_raw = blocks[3];
        let _stat_raw = blocks[4];
        let net_raw = blocks[5];
        let ps_raw = blocks[6];
        let temp_raw = blocks[7];

        // OS Name
        let os_name = os_raw.split('=')
            .nth(1)
            .map(|s| s.trim_matches('"'))
            .unwrap_or("Linux")
            .to_string();

        // Memory
        let mut mem_total_mb = 0;
        let mut mem_used_mb = 0;
        let mut mem_pct = 0.0;
        for line in free_raw.lines() {
            if line.contains("Mem:") {
                let parts: Vec<&str> = line.split_whitespace().collect();
                if parts.len() >= 3 {
                    mem_total_mb = parts[1].parse().unwrap_or(1);
                    mem_used_mb = parts[2].parse().unwrap_or(0);
                    mem_pct = (mem_used_mb as f32 / mem_total_mb as f32) * 100.0;
                }
            }
        }

        // CPU Usage (instant, no delta support here but we take pcpu from ps as fallback or first hop)
        // High-fidelity CPU pct requires 2 samples, which we'll handle in the backend caller if needed.
        // For now, we return 0.0 and the caller handles deltas.
        let cpu_usage = 0.0; 

        // Network
        let mut net_rx_bytes = 0;
        let mut net_tx_bytes = 0;
        if let Some(colon_idx) = net_raw.find(':') {
            let data = &net_raw[colon_idx+1..];
            let parts: Vec<&str> = data.split_whitespace().collect();
            if parts.len() >= 9 {
                net_rx_bytes = parts[0].parse().unwrap_or(0);
                net_tx_bytes = parts[8].parse().unwrap_or(0);
            }
        }

        // Disk
        let mut disk_usage = Vec::new();
        let df_parts: Vec<&str> = df_raw.split_whitespace().collect();
        if df_parts.len() >= 5 {
            let total_str = df_parts[1].trim_end_matches('G').trim_end_matches('M');
            let used_str = df_parts[2].trim_end_matches('G').trim_end_matches('M');
            let total_gb: f32 = total_str.parse().unwrap_or(0.0);
            let used_gb: f32 = used_str.parse().unwrap_or(0.0);
            let pct: f32 = df_parts[4].trim_end_matches('%').parse().unwrap_or(0.0);
            disk_usage.push(DiskInfo {
                mount: "/".to_string(),
                total_gb,
                used_gb,
                pct,
            });
        }

        // Temp
        let temp = if temp_raw != "N/A" {
            let t: f32 = temp_raw.parse().unwrap_or(0.0);
            if t > 0.0 { format!("{:.1}°C", t / 1000.0) } else { "N/A".to_string() }
        } else {
            "N/A".to_string()
        };

        // Processes
        let mut top_processes = Vec::new();
        for line in ps_raw.lines().skip(1) {
            let p: Vec<&str> = line.split_whitespace().collect();
            if p.len() >= 4 {
                top_processes.push(ProcessInfo {
                    pid: p[0].to_string(),
                    cpu_pct: p[1].parse().unwrap_or(0.0),
                    mem_pct: p[2].parse().unwrap_or(0.0),
                    name: p[3].to_string(),
                });
            }
        }

        Ok(SystemMetrics {
            os_name,
            uptime,
            cpu_usage,
            mem_total_mb,
            mem_used_mb,
            mem_pct,
            temp,
            net_rx_bytes,
            net_tx_bytes,
            disk_usage,
            top_processes,
        })
    }
}
