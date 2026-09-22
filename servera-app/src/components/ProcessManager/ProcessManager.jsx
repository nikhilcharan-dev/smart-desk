import { useState, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MAIN_SESSION_ID } from '../../utils/terminal';
import { formatRemoteError } from '../../utils/errors';
import { Cpu, RefreshCw, Search, X, Skull, ArrowUpDown, Pause, Play } from 'lucide-react';
import './ProcessManager.css';

function parseProcesses(raw) {
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    return lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 11) return null;
        const [user, pid, cpu, mem, vsz, rss, tty, stat, start, time, ...cmdParts] = parts;
        return {
            user,
            pid: parseInt(pid, 10),
            cpu: parseFloat(cpu),
            mem: parseFloat(mem),
            vsz, rss, tty, stat, start, time,
            command: cmdParts.join(' ')
        };
    }).filter(Boolean);
}

export default function ProcessManager() {
    const [processes, setProcesses] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [sortKey, setSortKey] = useState('cpu');
    const [sortDir, setSortDir] = useState('desc');
    const [autoRefresh, setAutoRefresh] = useState(false);
    const intervalRef = useRef(null);

    const loadProcesses = async () => {
        setLoading(true);
        setError(null);
        try {
            const output = await invoke('exec_ssh_command', {
                sessionId: MAIN_SESSION_ID,
                command: 'ps aux --sort=-%cpu'
            });
            setProcesses(parseProcesses(output));
        } catch (err) {
            setError(formatRemoteError(err, "Listing processes"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProcesses();
    }, []);

    useEffect(() => {
        if (autoRefresh) {
            intervalRef.current = setInterval(loadProcesses, 5000);
        }
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [autoRefresh]);

    const killProcess = async (pid) => {
        try {
            await invoke('exec_ssh_command', {
                sessionId: MAIN_SESSION_ID,
                command: `kill -9 ${pid}`
            });
            setTimeout(loadProcesses, 500);
        } catch (err) {
            // The backend escalates a denied kill on its own, so an error here
            // means sudo was unavailable or refused — say which.
            setError(formatRemoteError(err, `Killing PID ${pid}`));
        }
    };

    const toggleSort = (key) => {
        if (sortKey === key) {
            setSortDir(d => d === 'asc' ? 'desc' : 'asc');
        } else {
            setSortKey(key);
            setSortDir('desc');
        }
    };

    const sorted = [...processes]
        .filter(p => {
            if (!search) return true;
            const q = search.toLowerCase();
            return p.command.toLowerCase().includes(q) ||
                p.user.toLowerCase().includes(q) ||
                p.pid.toString().includes(q);
        })
        .sort((a, b) => {
            let result = 0;
            if (sortKey === 'cpu') result = a.cpu - b.cpu;
            else if (sortKey === 'mem') result = a.mem - b.mem;
            else if (sortKey === 'pid') result = a.pid - b.pid;
            else if (sortKey === 'user') result = a.user.localeCompare(b.user);
            else if (sortKey === 'command') result = a.command.localeCompare(b.command);
            return sortDir === 'desc' ? -result : result;
        });

    const indicator = (key) => sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '';

    return (
        <div className="pm-container">
            <div className="pm-header">
                <div className="pm-title-row">
                    <Cpu size={20} className="pm-icon" />
                    <h2 className="pm-title">Process Manager</h2>
                    <span className="pm-count">{sorted.length} processes</span>
                </div>
                <div className="pm-toolbar">
                    <div className="pm-search">
                        <Search size={14} />
                        <input
                            placeholder="Filter by name, user, or PID..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && <button className="pm-clear" onClick={() => setSearch('')}><X size={12} /></button>}
                    </div>
                    <button
                        className={`pm-btn ${autoRefresh ? 'active' : ''}`}
                        onClick={() => setAutoRefresh(!autoRefresh)}
                        title={autoRefresh ? 'Pause auto-refresh' : 'Auto-refresh every 5s'}
                    >
                        {autoRefresh ? <Pause size={14} /> : <Play size={14} />}
                        <span>{autoRefresh ? 'Pause' : 'Auto'}</span>
                    </button>
                    <button className="pm-btn" onClick={loadProcesses} disabled={loading}>
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                        <span>Refresh</span>
                    </button>
                </div>
            </div>

            {error && <div className="pm-error">{error}</div>}

            <div className="pm-table-wrap">
                <table className="pm-table">
                    <thead>
                        <tr>
                            <th className="pm-th-pid" onClick={() => toggleSort('pid')}>PID{indicator('pid')}</th>
                            <th className="pm-th-user" onClick={() => toggleSort('user')}>User{indicator('user')}</th>
                            <th className="pm-th-cpu" onClick={() => toggleSort('cpu')}>CPU%{indicator('cpu')}</th>
                            <th className="pm-th-mem" onClick={() => toggleSort('mem')}>MEM%{indicator('mem')}</th>
                            <th className="pm-th-cmd" onClick={() => toggleSort('command')}>Command{indicator('command')}</th>
                            <th className="pm-th-action">Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        {sorted.map(p => (
                            <tr key={p.pid} className={p.cpu > 50 ? 'high-cpu' : ''}>
                                <td className="mono">{p.pid}</td>
                                <td>{p.user}</td>
                                <td>
                                    <span className={`cpu-badge ${p.cpu > 80 ? 'critical' : p.cpu > 50 ? 'warn' : 'ok'}`}>
                                        {p.cpu.toFixed(1)}%
                                    </span>
                                </td>
                                <td>
                                    <span className={`mem-badge ${p.mem > 80 ? 'critical' : p.mem > 50 ? 'warn' : 'ok'}`}>
                                        {p.mem.toFixed(1)}%
                                    </span>
                                </td>
                                <td className="cmd-cell" title={p.command}>{p.command}</td>
                                <td>
                                    <button className="pm-kill-btn" onClick={() => killProcess(p.pid)} title={`Kill PID ${p.pid}`}>
                                        <Skull size={13} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                {sorted.length === 0 && !loading && (
                    <div className="pm-empty">No processes found</div>
                )}
            </div>
        </div>
    );
}
