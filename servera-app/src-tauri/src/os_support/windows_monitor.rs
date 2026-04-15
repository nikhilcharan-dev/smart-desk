use super::traits::{SystemMonitor, SystemMetrics, DiskInfo, ProcessInfo};

pub struct WindowsMonitor;

impl SystemMonitor for WindowsMonitor {
    fn gather_stats_cmd(&self) -> String {
        // We use powershell as it is standard in Windows 10/11 OpenSSH.
        // We join with semicolons to ensure it works as a single command line if needed.
        r#"powershell -NoProfile -Command "$os = Get-CimInstance Win32_OperatingSystem; $cpu = Get-CimInstance Win32_Processor; $mem = $os | Select-Object TotalVisibleMemorySize, FreePhysicalMemory; $disks = Get-Volume | Where-Object { $_.DriveLetter -ne $null }; $procs = Get-Process | Sort-Object CPU -Descending | Select-Object -First 10 Id, CPU, WorkingSet, Name; $net = Get-NetAdapterStatistics | Sort-Object ReceivedBytes -Descending | Select-Object -First 1; Write-Host $os.Caption; Write-Host '---'; Write-Host $os.LastBootUpTime; Write-Host '---'; Write-Host $os.OSArchitecture; Write-Host '---'; Write-Host $os.Version; Write-Host '---'; Write-Host $cpu.NumberOfCores; Write-Host '---'; Write-Host $mem.TotalVisibleMemorySize; Write-Host $mem.FreePhysicalMemory; Write-Host '---'; foreach ($d in $disks) { Write-Host \"$($d.DriveLetter):,$($d.Size),$($d.SizeRemaining)\" }; Write-Host '---'; if ($net) { Write-Host \"$($net.ReceivedBytes),$($net.SentBytes)\" } else { Write-Host '0,0' }; Write-Host '---'; foreach ($p in $procs) { Write-Host \"$($p.Id),$($p.CPU),$($p.WorkingSet),$($p.Name)\" }""#.to_string()
    }

    fn parse_stats(&self, output: &str) -> Result<SystemMetrics, String> {
        let blocks: Vec<&str> = output.split("---").map(|s| s.trim()).collect();
        if blocks.len() < 9 {
            return Err(format!("Incomplete Windows monitor data: received {}/9 blocks", blocks.len()));
        }

        let os_name = blocks[0].to_string();
        let boot_time = blocks[1];
        let arch = blocks[2].to_string();
        let kernel = blocks[3].to_string();
        let cpu_cores: u32 = blocks[4].parse().unwrap_or(0);
        
        // Memory (values are in KB)
        let mem_lines: Vec<&str> = blocks[5].lines().collect();
        let mut mem_total_mb = 0;
        let mut mem_used_mb = 0;
        if mem_lines.len() >= 2 {
            let total_kb: u64 = mem_lines[0].parse().unwrap_or(0);
            let free_kb: u64 = mem_lines[1].parse().unwrap_or(0);
            mem_total_mb = total_kb / 1024;
            mem_used_mb = (total_kb - free_kb) / 1024;
        }
        let mem_pct = if mem_total_mb > 0 { (mem_used_mb as f32 / mem_total_mb as f32) * 100.0 } else { 0.0 };

        // Disk
        let mut disk_usage = Vec::new();
        for line in blocks[6].lines() {
            let parts: Vec<&str> = line.split(',').collect();
            if parts.len() >= 3 {
                let mount = parts[0].to_string();
                let total_bytes: u64 = parts[1].parse().unwrap_or(0);
                let free_bytes: u64 = parts[2].parse().unwrap_or(0);
                let total_gb = total_bytes as f32 / 1_073_741_824.0;
                let used_gb = (total_bytes - free_bytes) as f32 / 1_073_741_824.0;
                disk_usage.push(DiskInfo {
                    mount,
                    total_gb,
                    used_gb,
                    pct: if total_gb > 0.0 { (used_gb / total_gb) * 100.0 } else { 0.0 },
                });
            }
        }

        // Net
        let net_parts: Vec<&str> = blocks[7].split(',').collect();
        let net_rx_bytes = net_parts.get(0).and_then(|s| s.parse().ok()).unwrap_or(0);
        let net_tx_bytes = net_parts.get(1).and_then(|s| s.parse().ok()).unwrap_or(0);

        // Procs
        let mut top_processes = Vec::new();
        for line in blocks[8].lines() {
            let p: Vec<&str> = line.split(',').collect();
            if p.len() >= 4 {
                let working_set_bytes: u64 = p[2].parse().unwrap_or(0);
                let mem_pct = if mem_total_mb > 0 {
                    (working_set_bytes as f32 / (mem_total_mb as f32 * 1024.0 * 1024.0)) * 100.0
                } else {
                    0.0
                };
                top_processes.push(ProcessInfo {
                    pid: p[0].to_string(),
                    cpu_pct: p[1].parse().unwrap_or(0.0), 
                    mem_pct,
                    name: p[3].to_string(),
                });
            }
        }

        Ok(SystemMetrics {
            os_name,
            uptime: format!("Started at {}", boot_time),
            kernel,
            arch,
            cpu_cores,
            cpu_usage: 0.0,
            mem_total_mb,
            mem_used_mb,
            mem_pct,
            temp: "N/A".into(),
            net_rx_bytes,
            net_tx_bytes,
            disk_usage,
            top_processes,
        })
    }
}
