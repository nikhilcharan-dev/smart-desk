import { useState, useEffect, useRef, useCallback } from "react";
import { RotateCw, Activity, ArrowDown, ArrowUp, Cpu, Server, Thermometer, HardDrive } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts";
import "./Dashboard.css";
import logo from "../../assets/logo-32.png";

export default function Dashboard({ user, ip, profileName }) {
    // Basic static stats
    const [stats, setStats] = useState({
        os: "Loading...",
        uptime: "Loading...",
        disk: "Loading...",
        diskPct: 0,
        disks: []
    });

    // Sweeping time-series data arrays (max 20 points)
    const [history, setHistory] = useState([]);

    // Live instant stats
    const [liveStats, setLiveStats] = useState({
        cpuPct: 0,
        memPct: 0,
        memUsedStr: "0MB",
        memTotalStr: "0MB",
        rxSpeed: 0, // MB/s
        txSpeed: 0, // MB/s
        temp: "N/A"
    });

    // Top processes leaderboards
    const [topProcs, setTopProcs] = useState([]);

    const [refreshing, setRefreshing] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);

    // Refs for calculating deltas (CPU, Network)
    const prevCpuRef = useRef({});
    const prevNetRef = useRef(null); // { time, rx, tx }
    const isFetchingRef = useRef(false); // prevents overlapping polls from piling up

    const fetchStats = useCallback(async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        setRefreshing(true);
        try {
            if (!user || user === "Local") {
                // Fetch local stats from Tauri (mocking for the charts)
                const localStats = await invoke("get_local_stats");

                const uptimeDays = Math.floor(localStats.uptime / 86400);
                const uptimeHours = Math.floor((localStats.uptime % 86400) / 3600);
                const uptimeMins = Math.floor((localStats.uptime % 3600) / 60);
                const uptimeStr = `${uptimeDays > 0 ? uptimeDays + 'd ' : ''}${uptimeHours}h ${uptimeMins}m`;

                setStats(p => ({
                    ...p,
                    os: localStats.os,
                    uptime: uptimeStr,
                    disks: localStats.disks.map(d => ({
                        mount: d.mount,
                        pct: d.usage_pct,
                        label: `${Math.round(d.usage_pct)}% (${((d.total - d.available) / 1024 / 1024 / 1024).toFixed(1)}GB)`
                    })),
                }));

                const cpuAvg = localStats.cpus.length > 0 ?
                    localStats.cpus.reduce((a, b) => a + b.usage, 0) / localStats.cpus.length : 0;

                const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

                setLiveStats({
                    cpuPct: Math.round(cpuAvg),
                    memPct: Math.round(localStats.memory_pct),
                    memUsedStr: `${(localStats.memory_used / 1024 / 1024 / 1024).toFixed(1)}GB`,
                    memTotalStr: `${(localStats.memory_total / 1024 / 1024 / 1024).toFixed(1)}GB`,
                    rxSpeed: 0,
                    txSpeed: 0,
                    temp: "N/A"
                });

                setHistory(prev => {
                    const newHist = [...prev, { time: now, cpu: Math.round(cpuAvg), ram: Math.round(localStats.memory_pct) }];
                    if (newHist.length > 20) newHist.shift();
                    return newHist;
                });

            } else {
                // Fetch remote stats via SSH
                // We run a combined script to minimize SSH overhead
                const combinedScript = `
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
                    cat /proc/net/dev | grep -E 'eth|en|wl' | head -n 1; 
                    echo "---"; 
                    ps -e -o pid,pcpu,pmem,comm --sort=-pcpu | grep -v 'ps -e' | grep -v 'grep' | head -n 6;
                    echo "---"; 
                    cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null || echo 'N/A'
                `;

                const rawOut = await invoke("exec_ssh_command", { sessionId: MAIN_SESSION_ID, command: combinedScript });
                const blocks = rawOut.split('---').map(s => s.trim());

                if (blocks.length < 8) throw new Error("Incomplete data from VM");

                const [uptimeRaw, freeRaw, dfRaw, osRaw, statRaw, netRaw, psRaw, tempRaw] = blocks;

                // 1. Static OS & Uptime & Disk
                let os = "Linux VM";
                if (osRaw.includes("PRETTY_NAME")) os = osRaw.match(/PRETTY_NAME="?([^"\n]+)"?/)?.[1] || os;

                let diskPct = 0;
                let diskLbl = "0%";
                if (dfRaw) {
                    const dfParts = dfRaw.split(/\s+/);
                    if (dfParts.length >= 5) {
                        diskPct = parseInt(dfParts[4].replace('%', '')) || 0;
                        diskLbl = `${diskPct}% (${dfParts[2]} / ${dfParts[1]})`;
                    }
                }

                setStats({
                    os,
                    uptime: uptimeRaw.replace("up ", ""),
                    diskPct,
                    disks: [{ mount: "/", pct: diskPct, label: diskLbl }]
                });

                // 2. Memory
                let memPct = 0;
                let memUsed = "0MB", memTotal = "0MB";
                const memLines = freeRaw.split('\n').filter(l => l.includes("Mem:"));
                if (memLines.length > 0) {
                    const parts = memLines[0].split(/\s+/);
                    const total = parseInt(parts[1]) || 1;
                    const used = parseInt(parts[2]) || 0;
                    memPct = (used / total) * 100;
                    memUsed = (used > 1024) ? `${(used / 1024).toFixed(1)}GB` : `${used}MB`;
                    memTotal = (total > 1024) ? `${(total / 1024).toFixed(1)}GB` : `${total}MB`;
                }

                // 3. CPU Global (from /proc/stat)
                let cpuPct = 0;
                if (statRaw) {
                    const parts = statRaw.split(/\s+/);
                    const user = parseInt(parts[1]) || 0;
                    const nice = parseInt(parts[2]) || 0;
                    const system = parseInt(parts[3]) || 0;
                    const idle = parseInt(parts[4]) || 0;
                    const iowait = parseInt(parts[5]) || 0;
                    const irq = parseInt(parts[6]) || 0;
                    const softirq = parseInt(parts[7]) || 0;
                    const steal = parseInt(parts[8]) || 0;

                    const total = user + nice + system + idle + iowait + irq + softirq + steal;
                    const idleTotal = idle + iowait;

                    const prev = prevCpuRef.current['global'];
                    if (prev) {
                        const totalDiff = total - prev.total;
                        const idleDiff = idleTotal - prev.idle;
                        if (totalDiff > 0) cpuPct = ((totalDiff - idleDiff) / totalDiff) * 100;
                    }
                    prevCpuRef.current['global'] = { total, idle: idleTotal };
                }

                // 4. Network Bandwidth (RX/TX)
                let rxSpeed = 0, txSpeed = 0;
                if (netRaw) {
                    const parts = netRaw.split(':')[1]?.trim().split(/\s+/) || [];
                    if (parts.length >= 9) {
                        const rxBytes = parseInt(parts[0]) || 0;
                        const txBytes = parseInt(parts[8]) || 0;
                        const nowMs = Date.now();

                        if (prevNetRef.current) {
                            const timeDiff = (nowMs - prevNetRef.current.time) / 1000; // in seconds
                            if (timeDiff > 0) {
                                rxSpeed = ((rxBytes - prevNetRef.current.rx) / 1024 / 1024) / timeDiff; // MB/s
                                txSpeed = ((txBytes - prevNetRef.current.tx) / 1024 / 1024) / timeDiff; // MB/s
                            }
                        }
                        prevNetRef.current = { time: nowMs, rx: rxBytes, tx: txBytes };
                    }
                }

                // 5. Temperature (now from combined script)
                let temp = "N/A";
                if (tempRaw && tempRaw !== 'N/A') {
                    const tVal = parseInt(tempRaw);
                    if (!isNaN(tVal) && tVal > 0) {
                        temp = (tVal / 1000).toFixed(1) + "°C";
                    }
                }

                // 6. Top Processes (already excludes ps/grep from combined script)
                const procs = psRaw.split('\n').map(l => l.trim()).filter(l => l).slice(1).map((line, i) => {
                    const p = line.split(/\s+/);
                    return { id: i, pid: p[0], cpu: parseFloat(p[1]), mem: parseFloat(p[2]), name: p[3] };
                });
                setTopProcs(procs);

                // Update Live & History
                setLiveStats({
                    cpuPct: Math.round(cpuPct),
                    memPct: Math.round(memPct),
                    memUsedStr: memUsed,
                    memTotalStr: memTotal,
                    rxSpeed: Math.max(0, rxSpeed),
                    txSpeed: Math.max(0, txSpeed),
                    temp
                });

                const nowTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                setHistory(prev => {
                    const newHist = [...prev, { time: nowTime, cpu: Math.round(cpuPct), ram: Math.round(memPct) }];
                    if (newHist.length > 20) newHist.shift();
                    return newHist;
                });
            }
        } catch (err) {
            console.error("Failed to fetch stats:", err);
        } finally {
            isFetchingRef.current = false;
            setRefreshing(false);
            setInitialLoad(false);
        }
    }, [user]);

    useEffect(() => {
        fetchStats();
        // Poll every 5 seconds for smooth sweeping charts
        const interval = setInterval(fetchStats, 5000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    const getCoreColor = (val) => {
        if (val > 80) return "#ef4444"; // Red
        if (val > 60) return "#f59e0b"; // Yellow
        return "#3b82f6"; // Blue
    };

    return (
        <div className="analytics-container">
            <div className="ah-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <img src={logo} alt="Servera Logo" style={{ width: 40, height: 40 }} />
                    <div>
                        <h1 className="ah-title">{profileName ? `${profileName} | Analytics Hub` : "Servera Analytics Hub"}</h1>
                        <div className="ah-subtitle">
                            <span>{user === "Local" ? "Local Machine Mode" : `Connected to ${user}@${ip}`}</span>
                            <span className="ah-dot">•</span>
                            <span>{initialLoad ? <span className="skeleton" style={{ width: 60, height: 14, display: 'inline-block' }} /> : stats.os}</span>
                            <span className="ah-dot">•</span>
                            <span>Uptime: {initialLoad ? <span className="skeleton" style={{ width: 50, height: 14, display: 'inline-block' }} /> : stats.uptime}</span>
                        </div>
                    </div>
                </div>

                <button className="ah-refresh-btn" onClick={fetchStats} disabled={refreshing}>
                    <RotateCw size={16} className={refreshing ? "spinning" : ""} />
                </button>
            </div>

            {/* Quick Metrics Row */}
            <div className="ah-quick-metrics">
                <div className="ah-metric-card">
                    <div className="ah-metric-icon" style={{ color: getCoreColor(liveStats.cpuPct), background: `${getCoreColor(liveStats.cpuPct)}20` }}>
                        <Cpu size={20} />
                    </div>
                    <div className="ah-metric-info">
                        <span className="ah-metric-label">CPU Usage</span>
                        <span className="ah-metric-val">{liveStats.cpuPct}%</span>
                    </div>
                </div>
                <div className="ah-metric-card">
                    <div className="ah-metric-icon" style={{ color: getCoreColor(liveStats.memPct), background: `${getCoreColor(liveStats.memPct)}20` }}>
                        <Server size={20} />
                    </div>
                    <div className="ah-metric-info">
                        <span className="ah-metric-label">Memory ({liveStats.memUsedStr} / {liveStats.memTotalStr})</span>
                        <span className="ah-metric-val">{liveStats.memPct}%</span>
                    </div>
                </div>
                <div className="ah-metric-card">
                    <div className="ah-metric-icon" style={{ color: '#8b5cf6', background: '#8b5cf620' }}>
                        <Activity size={20} />
                    </div>
                    <div className="ah-metric-info">
                        <span className="ah-metric-label">Network Flow</span>
                        <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginTop: '4px' }}>
                            <span className="ah-net-pill dn"><ArrowDown size={12} /> {liveStats.rxSpeed.toFixed(2)} MB/s</span>
                            <span className="ah-net-pill up"><ArrowUp size={12} /> {liveStats.txSpeed.toFixed(2)} MB/s</span>
                        </div>
                    </div>
                </div>
                <div className="ah-metric-card">
                    <div className="ah-metric-icon" style={{ color: '#f59e0b', background: '#f59e0b20' }}>
                        <Thermometer size={20} />
                    </div>
                    <div className="ah-metric-info">
                        <span className="ah-metric-label">Hardware Temp</span>
                        <span className="ah-metric-val">{liveStats.temp}</span>
                    </div>
                </div>
                {stats.disks.map((d, i) => {
                    const sizeInfo = d.label.includes('(') ? d.label.slice(d.label.indexOf('(')) : '';
                    return (
                        <div className="ah-metric-card" key={`disk-${i}`}>
                            <div className="ah-metric-icon" style={{ color: getCoreColor(d.pct), background: `${getCoreColor(d.pct)}20` }}>
                                <HardDrive size={20} />
                            </div>
                            <div className="ah-metric-info">
                                <span className="ah-metric-label">Storage {d.mount} {sizeInfo}</span>
                                <span className="ah-metric-val">{d.pct}%</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Main Content Grid */}
            <div className="ah-grid">

                {/* Left Col: Charts */}
                <div className="ah-charts-col">
                    <div className="ah-chart-card">
                        <h3>CPU Utilization Over Time</h3>
                        <div className="ah-chart-wrapper">
                            {initialLoad ? (
                                <div className="skeleton" style={{ width: '100%', height: '100%', minHeight: 200, borderRadius: 8 }}></div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
                                        <XAxis dataKey="time" stroke="#6b7280" fontSize={11} tickMargin={10} minTickGap={30} />
                                        <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} />
                                        <Tooltip contentStyle={{ background: '#11141d', border: '1px solid #2d3748', borderRadius: '8px' }} itemStyle={{ color: '#3b82f6' }} />
                                        <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#3b82f6" strokeWidth={2} fillOpacity={1} fill="url(#colorCpu)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    <div className="ah-chart-card">
                        <h3>Memory Allocation Over Time</h3>
                        <div className="ah-chart-wrapper">
                            {initialLoad ? (
                                <div className="skeleton" style={{ width: '100%', height: '100%', minHeight: 200, borderRadius: 8 }}></div>
                            ) : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                        <defs>
                                            <linearGradient id="colorRam" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#2d3748" vertical={false} />
                                        <XAxis dataKey="time" stroke="#6b7280" fontSize={11} tickMargin={10} minTickGap={30} />
                                        <YAxis stroke="#6b7280" fontSize={11} domain={[0, 100]} />
                                        <Tooltip contentStyle={{ background: '#11141d', border: '1px solid #2d3748', borderRadius: '8px' }} itemStyle={{ color: '#10b981' }} />
                                        <Area type="monotone" dataKey="ram" name="RAM %" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorRam)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Col: Leaderboards & Static */}
                <div className="ah-side-col">
                    <div className="ah-side-card">
                        <h3>🔥 Top Resource Hogs</h3>
                        <p className="ah-card-desc">Highest CPU consuming processes</p>

                        <div className="ah-proc-list">
                            {initialLoad ? (
                                Array.from({ length: 5 }).map((_, i) => (
                                    <div className="ah-proc-row skeleton" style={{ width: '100%', height: 32, marginBottom: 8 }} key={i}></div>
                                ))
                            ) : topProcs.length === 0 ? (
                                <div style={{ color: '#6b7280', textAlign: 'center', padding: '20px 0', fontSize: '13px' }}>No metrics available</div>
                            ) : topProcs.map(p => (
                                <div key={p.id} className="ah-proc-item">
                                    <div className="ah-proc-name" title={p.name}>{p.name}</div>
                                    <div className="ah-proc-stats">
                                        <span style={{ color: getCoreColor(p.cpu) }}>{p.cpu.toFixed(1)}% C</span>
                                        <span style={{ color: '#9ca3af' }}>{p.mem.toFixed(1)}% R</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

            </div>
        </div>
    );
}
