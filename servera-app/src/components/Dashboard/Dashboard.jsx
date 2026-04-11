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
                // Fetch remote stats via SSH using standardized metrics
                const rawMetrics = await invoke("get_standard_metrics", { sessionId: MAIN_SESSION_ID });
                
                // 1. Static OS & Uptime
                setStats({
                    os: rawMetrics.os_name,
                    uptime: rawMetrics.uptime,
                    diskPct: rawMetrics.disk_usage[0]?.pct || 0,
                    disks: rawMetrics.disk_usage.map(d => ({
                        mount: d.mount,
                        pct: d.pct,
                        label: `${d.pct}% (${d.used_gb.toFixed(1)}GB / ${d.total_gb.toFixed(1)}GB)`
                    }))
                });

                // 2. Memory
                const memUsed = (rawMetrics.mem_used_mb > 1024) ? `${(rawMetrics.mem_used_mb / 1024).toFixed(1)}GB` : `${rawMetrics.mem_used_mb}MB`;
                const memTotal = (rawMetrics.mem_total_mb > 1024) ? `${(rawMetrics.mem_total_mb / 1024).toFixed(1)}GB` : `${rawMetrics.mem_total_mb}MB`;

                // 3. CPU Global (Deltas still handled on frontend for now or using first-hop pcpu)
                // Note: The standardized metrics return a snapshot.
                let cpuPct = rawMetrics.cpu_usage;
                if (cpuPct === 0 && rawMetrics.top_processes.length > 0) {
                    cpuPct = rawMetrics.top_processes.reduce((a, b) => a + b.cpu_pct, 0) / 4; // normalized approx
                }

                // 4. Network Bandwidth deltas
                let rxSpeed = 0, txSpeed = 0;
                const nowMs = Date.now();
                if (prevNetRef.current) {
                    const timeDiff = (nowMs - prevNetRef.current.time) / 1000;
                    if (timeDiff > 0) {
                        rxSpeed = ((rawMetrics.net_rx_bytes - prevNetRef.current.rx) / 1024 / 1024) / timeDiff;
                        txSpeed = ((rawMetrics.net_tx_bytes - prevNetRef.current.tx) / 1024 / 1024) / timeDiff;
                    }
                }
                prevNetRef.current = { time: nowMs, rx: rawMetrics.net_rx_bytes, tx: rawMetrics.net_tx_bytes };

                // 5. Update Life & History
                setLiveStats({
                    cpuPct: Math.round(cpuPct),
                    memPct: Math.round(rawMetrics.mem_pct),
                    memUsedStr: memUsed,
                    memTotalStr: memTotal,
                    rxSpeed: Math.max(0, rxSpeed),
                    txSpeed: Math.max(0, txSpeed),
                    temp: rawMetrics.temp
                });

                const nowTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                setHistory(prev => {
                    const newHist = [...prev, { time: nowTime, cpu: Math.round(cpuPct), ram: Math.round(rawMetrics.mem_pct) }];
                    if (newHist.length > 20) newHist.shift();
                    return newHist;
                });

                // 6. Top Processes
                setTopProcs(rawMetrics.top_processes.map((p, i) => ({
                    id: i,
                    pid: p.pid,
                    cpu: p.cpu_pct,
                    mem: p.mem_pct,
                    name: p.name
                })));
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
