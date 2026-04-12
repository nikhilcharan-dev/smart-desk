import { useState, useEffect, useRef, useCallback } from "react";
import { RotateCw, Cpu, Server, Thermometer, HardDrive, Activity, ArrowDown, ArrowUp, Zap, Globe, Database } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import "./Dashboard.css";

/* ─── Gauge Ring ─── */
function GaugeRing({ value, color, size = 100, strokeWidth = 6 }) {
    const r = (size - strokeWidth) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (Math.min(value, 100) / 100) * circ;
    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: "rotate(-90deg)" }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a1f2e" strokeWidth={strokeWidth} />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={strokeWidth}
                strokeLinecap="round" strokeDasharray={circ} strokeDashoffset={offset}
                style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.4,0,0.2,1)" }} />
        </svg>
    );
}

/* ─── Process Bar ─── */
function ProcBar({ value, color }) {
    return (
        <div className="db-proc-bar-wrap">
            <div className="db-proc-bar"><div className="db-proc-bar-fill" style={{ width: `${Math.min(value, 100)}%`, background: color }} /></div>
            <span className="db-proc-bar-val" style={{ color }}>{value.toFixed(1)}</span>
        </div>
    );
}

export default function Dashboard({ user, ip, profileName }) {
    const [stats, setStats] = useState({ os: "Loading...", uptime: "Loading...", kernel: "", arch: "", cpuCores: 0, disks: [], isVirt: false });
    const [history, setHistory] = useState([]);
    const [liveStats, setLiveStats] = useState({ cpuPct: 0, memPct: 0, memUsedStr: "0MB", memTotalStr: "0MB", rxSpeed: 0, txSpeed: 0, temp: "N/A" });
    const [topProcs, setTopProcs] = useState([]);
    const [refreshing, setRefreshing] = useState(false);
    const [initialLoad, setInitialLoad] = useState(true);
    const [entered, setEntered] = useState(false);

    const prevNetRef = useRef(null);
    const isFetchingRef = useRef(false);

    // Trigger entry animation after mount
    useEffect(() => {
        const t = requestAnimationFrame(() => setEntered(true));
        return () => cancelAnimationFrame(t);
    }, []);

    const fetchStats = useCallback(async () => {
        if (isFetchingRef.current) return;
        isFetchingRef.current = true;
        setRefreshing(true);
        try {
            if (!user || user === "Local") {
                const ls = await invoke("get_local_stats");
                const uptimeDays = Math.floor(ls.uptime / 86400);
                const uptimeHours = Math.floor((ls.uptime % 86400) / 3600);
                const uptimeMins = Math.floor((ls.uptime % 3600) / 60);
                const uptimeStr = `${uptimeDays > 0 ? uptimeDays + 'd ' : ''}${uptimeHours}h ${uptimeMins}m`;

                setStats(p => ({
                    ...p, os: ls.os, uptime: uptimeStr, kernel: "", arch: "", cpuCores: ls.cpus.length,
                    disks: ls.disks.map(d => ({
                        mount: d.mount, pct: Math.round(d.usage_pct),
                        usedGB: ((d.total - d.available) / 1073741824).toFixed(1),
                        totalGB: (d.total / 1073741824).toFixed(1),
                    })),
                }));

                const cpuAvg = ls.cpus.length > 0 ? ls.cpus.reduce((a, b) => a + b.usage, 0) / ls.cpus.length : 0;
                const now = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });

                setLiveStats({
                    cpuPct: Math.round(cpuAvg), memPct: Math.round(ls.memory_pct),
                    memUsedStr: `${(ls.memory_used / 1073741824).toFixed(1)}GB`,
                    memTotalStr: `${(ls.memory_total / 1073741824).toFixed(1)}GB`,
                    rxSpeed: 0, txSpeed: 0, temp: "N/A"
                });

                setHistory(prev => {
                    const h = [...prev, { time: now, cpu: Math.round(cpuAvg), ram: Math.round(ls.memory_pct) }];
                    return h.length > 20 ? h.slice(-20) : h;
                });
            } else {
                const rm = await invoke("get_standard_metrics", { sessionId: MAIN_SESSION_ID });

                // If temp is N/A, try direct fallback + detect virtualization
                let tempVal = rm.temp;
                let isVirt = false;
                if (!tempVal || tempVal === "N/A") {
                    try {
                        const fallback = await invoke("exec_ssh_command", {
                            sessionId: MAIN_SESSION_ID,
                            command: "cat /sys/devices/virtual/thermal/thermal_zone*/temp 2>/dev/null || cat /sys/class/hwmon/*/temp*_input 2>/dev/null | head -1 || echo ''"
                        });
                        const v = fallback.trim();
                        if (v && !isNaN(Number(v))) {
                            const n = Number(v);
                            tempVal = n > 1000 ? `${(n / 1000).toFixed(1)}\u00b0C` : `${n.toFixed(1)}\u00b0C`;
                        }
                    } catch {}
                    if (!tempVal || tempVal === "N/A") {
                        try {
                            const virtCheck = await invoke("exec_ssh_command", {
                                sessionId: MAIN_SESSION_ID,
                                command: "systemd-detect-virt 2>/dev/null || ([ -f /proc/cpuinfo ] && grep -qE 'hypervisor|QEMU|KVM|Xen|VMware|VirtualBox' /proc/cpuinfo && echo 'vm' || echo 'none')"
                            });
                            const vt = virtCheck.trim().toLowerCase();
                            if (vt && vt !== "none" && vt !== "") isVirt = true;
                        } catch {}
                    }
                }

                setStats({
                    os: rm.os_name, uptime: rm.uptime,
                    kernel: rm.kernel || "", arch: rm.arch || "", cpuCores: rm.cpu_cores || 0,
                    isVirt,
                    disks: rm.disk_usage.map(d => ({
                        mount: d.mount, pct: d.pct,
                        usedGB: d.used_gb.toFixed(1), totalGB: d.total_gb.toFixed(1),
                    }))
                });

                const memUsed = rm.mem_used_mb > 1024 ? `${(rm.mem_used_mb / 1024).toFixed(1)}GB` : `${rm.mem_used_mb}MB`;
                const memTotal = rm.mem_total_mb > 1024 ? `${(rm.mem_total_mb / 1024).toFixed(1)}GB` : `${rm.mem_total_mb}MB`;

                let cpuPct = rm.cpu_usage;
                if (cpuPct === 0 && rm.top_processes.length > 0) {
                    cpuPct = rm.top_processes.reduce((a, b) => a + b.cpu_pct, 0) / 4;
                }

                let rxSpeed = 0, txSpeed = 0;
                const nowMs = Date.now();
                if (prevNetRef.current) {
                    const dt = (nowMs - prevNetRef.current.time) / 1000;
                    if (dt > 0) {
                        rxSpeed = ((rm.net_rx_bytes - prevNetRef.current.rx) / 1048576) / dt;
                        txSpeed = ((rm.net_tx_bytes - prevNetRef.current.tx) / 1048576) / dt;
                    }
                }
                prevNetRef.current = { time: nowMs, rx: rm.net_rx_bytes, tx: rm.net_tx_bytes };

                setLiveStats({
                    cpuPct: Math.round(cpuPct), memPct: Math.round(rm.mem_pct),
                    memUsedStr: memUsed, memTotalStr: memTotal,
                    rxSpeed: Math.max(0, rxSpeed), txSpeed: Math.max(0, txSpeed), temp: tempVal
                });

                const nowTime = new Date().toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                setHistory(prev => {
                    const h = [...prev, { time: nowTime, cpu: Math.round(cpuPct), ram: Math.round(rm.mem_pct) }];
                    return h.length > 20 ? h.slice(-20) : h;
                });

                setTopProcs(rm.top_processes.map((p, i) => ({ id: i, pid: p.pid, cpu: p.cpu_pct, mem: p.mem_pct, name: p.name })));
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
        const interval = setInterval(fetchStats, 5000);
        return () => clearInterval(interval);
    }, [fetchStats]);

    const getColor = (v) => v > 80 ? "#ef4444" : v > 60 ? "#f59e0b" : "#4f8fff";
    const primaryDisk = stats.disks[0] || { mount: "/", pct: 0, usedGB: "0", totalGB: "0" };

    return (
        <div className={`db-container ${entered ? "db-entered" : ""}`}>

            {/* ═══ HEADER ═══ */}
            <div className="db-header db-anim db-anim-1">
                <div className="db-header-left">
                    <div className="db-server-avatar">
                        <Server size={20} />
                    </div>
                    <div>
                        <h1 className="db-title">{profileName || "Servera"} &mdash; Dashboard</h1>
                        <div className="db-meta">
                            <span className="db-status-badge"><span className="db-status-dot" /> Connected</span>
                            <span className="db-dot">&middot;</span>
                            <span>{user === "Local" ? "Local Machine" : `${user}@${ip}`}</span>
                            <span className="db-dot">&middot;</span>
                            <span>{initialLoad ? <span className="skeleton" style={{ width: 60, height: 12, display: 'inline-block' }} /> : stats.os}</span>
                        </div>
                    </div>
                </div>
                <div className="db-header-right">
                    <div className="db-uptime-chip">Uptime <span>{initialLoad ? "..." : stats.uptime}</span></div>
                    <button className="db-refresh-btn" onClick={fetchStats} disabled={refreshing} title="Refresh">
                        <RotateCw size={15} className={refreshing ? "spinning" : ""} />
                    </button>
                </div>
            </div>

            {/* ═══ GAUGE ROW ═══ */}
            <div className="db-gauge-row">
                {/* CPU */}
                <div className="db-gauge-card db-anim db-anim-2">
                    <div className="db-gauge-ring">
                        <GaugeRing value={liveStats.cpuPct} color={getColor(liveStats.cpuPct)} />
                        <div className="db-gauge-val">{liveStats.cpuPct}%<small>avg</small></div>
                    </div>
                    <div className="db-gauge-label">CPU</div>
                    <div className="db-gauge-sub">{stats.cpuCores > 0 ? `${stats.cpuCores} cores` : ""}{stats.arch ? ` \u00b7 ${stats.arch}` : ""}</div>
                </div>

                {/* Memory */}
                <div className="db-gauge-card db-anim db-anim-3">
                    <div className="db-gauge-ring">
                        <GaugeRing value={liveStats.memPct} color={getColor(liveStats.memPct)} />
                        <div className="db-gauge-val">{liveStats.memPct}%<small>used</small></div>
                    </div>
                    <div className="db-gauge-label">Memory</div>
                    <div className="db-gauge-sub">{liveStats.memUsedStr} / {liveStats.memTotalStr}</div>
                </div>

                {/* Primary Disk */}
                <div className="db-gauge-card db-anim db-anim-4">
                    <div className="db-gauge-ring">
                        <GaugeRing value={primaryDisk.pct} color={primaryDisk.pct > 80 ? "#ef4444" : "#f59e0b"} />
                        <div className="db-gauge-val">{primaryDisk.pct}%<small>{primaryDisk.mount}</small></div>
                    </div>
                    <div className="db-gauge-label">Storage</div>
                    <div className="db-gauge-sub">{primaryDisk.usedGB} / {primaryDisk.totalGB} GB</div>
                </div>

                {/* Network */}
                <div className="db-gauge-card db-anim db-anim-5">
                    <div className="db-gauge-ring" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 100, height: 100 }}>
                        <div className="db-net-center">
                            <div className="db-net-line up"><ArrowUp size={11} />{liveStats.txSpeed.toFixed(2)}</div>
                            <div className="db-net-unit">MB/s</div>
                            <div className="db-net-line dn"><ArrowDown size={11} />{liveStats.rxSpeed.toFixed(2)}</div>
                        </div>
                    </div>
                    <div className="db-gauge-label">Network</div>
                </div>
            </div>

            {/* ═══ MAIN GRID ═══ */}
            <div className="db-main-grid">

                {/* Charts */}
                <div className="db-charts-col">
                    <div className="db-card db-anim db-anim-6">
                        <div className="db-card-header">
                            <div className="db-card-title">
                                <span className="db-card-icon" style={{ background: 'rgba(79,143,255,0.1)', color: '#4f8fff' }}><Activity size={14} /></span>
                                CPU Utilization
                            </div>
                            <span className="db-card-badge" style={{ background: 'rgba(79,143,255,0.08)', color: '#4f8fff' }}>Live</span>
                        </div>
                        <div className="db-chart-wrap">
                            {initialLoad ? <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 8 }} /> : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                        <defs><linearGradient id="gCpu" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#4f8fff" stopOpacity={0.25} /><stop offset="95%" stopColor="#4f8fff" stopOpacity={0} /></linearGradient></defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" vertical={false} />
                                        <XAxis dataKey="time" stroke="#505872" fontSize={10} tickMargin={8} minTickGap={30} />
                                        <YAxis stroke="#505872" fontSize={10} domain={[0, 100]} />
                                        <Tooltip contentStyle={{ background: '#0c0f16', border: '1px solid #1a1f2e', borderRadius: '8px', fontSize: 12 }} itemStyle={{ color: '#4f8fff' }} />
                                        <Area type="monotone" dataKey="cpu" name="CPU %" stroke="#4f8fff" strokeWidth={2} fillOpacity={1} fill="url(#gCpu)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>

                    <div className="db-card db-anim db-anim-7">
                        <div className="db-card-header">
                            <div className="db-card-title">
                                <span className="db-card-icon" style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e' }}><Server size={14} /></span>
                                Memory Usage
                            </div>
                            <span className="db-card-badge" style={{ background: 'rgba(34,197,94,0.08)', color: '#22c55e' }}>{liveStats.memUsedStr} / {liveStats.memTotalStr}</span>
                        </div>
                        <div className="db-chart-wrap">
                            {initialLoad ? <div className="skeleton" style={{ width: '100%', height: '100%', borderRadius: 8 }} /> : (
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={history} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
                                        <defs><linearGradient id="gRam" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#22c55e" stopOpacity={0.25} /><stop offset="95%" stopColor="#22c55e" stopOpacity={0} /></linearGradient></defs>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#1a1f2e" vertical={false} />
                                        <XAxis dataKey="time" stroke="#505872" fontSize={10} tickMargin={8} minTickGap={30} />
                                        <YAxis stroke="#505872" fontSize={10} domain={[0, 100]} />
                                        <Tooltip contentStyle={{ background: '#0c0f16', border: '1px solid #1a1f2e', borderRadius: '8px', fontSize: 12 }} itemStyle={{ color: '#22c55e' }} />
                                        <Area type="monotone" dataKey="ram" name="RAM %" stroke="#22c55e" strokeWidth={2} fillOpacity={1} fill="url(#gRam)" animationDuration={300} />
                                    </AreaChart>
                                </ResponsiveContainer>
                            )}
                        </div>
                    </div>
                </div>

                {/* Side panels */}
                <div className="db-side-col">

                    {/* Top Processes */}
                    <div className="db-card db-anim db-anim-6">
                        <div className="db-card-header">
                            <div className="db-card-title">
                                <span className="db-card-icon" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}><Zap size={14} /></span>
                                Top Processes
                            </div>
                        </div>
                        {initialLoad ? (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {Array.from({ length: 5 }).map((_, i) => <div className="skeleton" style={{ height: 28, borderRadius: 6 }} key={i} />)}
                            </div>
                        ) : (
                            <table className="db-proc-table">
                                <thead>
                                    <tr><th>Process</th><th>PID</th><th>CPU</th><th>MEM</th></tr>
                                </thead>
                                <tbody>
                                    {topProcs.length === 0 ? (
                                        <tr><td colSpan={4} style={{ textAlign: 'center', color: '#505872', padding: 20 }}>No metrics</td></tr>
                                    ) : topProcs.slice(0, 6).map(p => (
                                        <tr key={p.id}>
                                            <td className="db-proc-name" title={p.name}>{p.name}</td>
                                            <td className="db-proc-pid">{p.pid}</td>
                                            <td><ProcBar value={p.cpu} color={getColor(p.cpu)} /></td>
                                            <td><ProcBar value={p.mem} color="#22c55e" /></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Storage */}
                    {stats.disks.length > 0 && (
                        <div className="db-card db-anim db-anim-7">
                            <div className="db-card-header">
                                <div className="db-card-title">
                                    <span className="db-card-icon" style={{ background: 'rgba(245,158,11,0.1)', color: '#f59e0b' }}><Database size={14} /></span>
                                    Storage
                                </div>
                            </div>
                            <div className="db-disk-grid">
                                {stats.disks.map((d, i) => (
                                    <div className="db-disk-item" key={i}>
                                        <div className="db-disk-icon"><HardDrive size={15} /></div>
                                        <div className="db-disk-info">
                                            <div className="db-disk-label">{d.mount}</div>
                                            <div className="db-disk-usage">{d.usedGB} / {d.totalGB} GB</div>
                                            <div className="db-disk-bar"><div className="db-disk-bar-fill" style={{ width: `${d.pct}%`, background: d.pct > 80 ? '#ef4444' : d.pct > 60 ? '#f59e0b' : '#4f8fff' }} /></div>
                                        </div>
                                        <div className="db-disk-pct" style={{ color: d.pct > 80 ? '#ef4444' : d.pct > 60 ? '#f59e0b' : '#4f8fff' }}>{d.pct}%</div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* ═══ BOTTOM ROW ═══ */}
            <div className="db-bottom-row db-anim db-anim-8">
                <div className="db-qi-card">
                    <div className="db-qi-icon" style={{ background: 'rgba(245,158,11,0.08)', color: '#f59e0b' }}><Thermometer size={18} /></div>
                    <div className="db-qi-info">
                        <span className="db-qi-label">Temperature</span>
                        {liveStats.temp && liveStats.temp !== "N/A" ? (
                            <span className="db-qi-value" style={{ color: '#f59e0b' }}>{liveStats.temp}</span>
                        ) : (
                            <span className="db-qi-value db-qi-na">{stats.isVirt ? "Virtualized" : "N/A"}</span>
                        )}
                    </div>
                </div>
                <div className="db-qi-card">
                    <div className="db-qi-icon" style={{ background: 'rgba(34,211,238,0.08)', color: '#22d3ee' }}><Globe size={18} /></div>
                    <div className="db-qi-info"><span className="db-qi-label">OS</span><span className="db-qi-value" style={{ color: '#22d3ee' }}>{stats.os}</span></div>
                </div>
                <div className="db-qi-card">
                    <div className="db-qi-icon" style={{ background: 'rgba(167,139,250,0.08)', color: '#a78bfa' }}><Cpu size={18} /></div>
                    <div className="db-qi-info"><span className="db-qi-label">Kernel</span><span className="db-qi-value" style={{ color: '#a78bfa' }}>{stats.kernel || stats.os || "N/A"}</span></div>
                </div>
                <div className="db-qi-card">
                    <div className="db-qi-icon" style={{ background: 'rgba(79,143,255,0.08)', color: '#4f8fff' }}><Server size={18} /></div>
                    <div className="db-qi-info"><span className="db-qi-label">Architecture</span><span className="db-qi-value" style={{ color: '#4f8fff' }}>{stats.arch || "N/A"}</span></div>
                </div>
            </div>
        </div>
    );
}
