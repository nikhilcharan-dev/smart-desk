import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MAIN_SESSION_ID } from '../../utils/terminal';
import { Network, RefreshCw, Search, X, Globe, Shield, Database, Server } from 'lucide-react';
import './PortScanner.css';

const KNOWN_PORTS = {
    22: { name: 'SSH', color: '#10b981' },
    80: { name: 'HTTP', color: '#3b82f6' },
    443: { name: 'HTTPS', color: '#3b82f6' },
    3000: { name: 'Dev Server', color: '#f59e0b' },
    3306: { name: 'MySQL', color: '#8b5cf6' },
    5432: { name: 'PostgreSQL', color: '#8b5cf6' },
    6379: { name: 'Redis', color: '#ef4444' },
    8080: { name: 'HTTP Alt', color: '#3b82f6' },
    8443: { name: 'HTTPS Alt', color: '#3b82f6' },
    27017: { name: 'MongoDB', color: '#10b981' },
    9090: { name: 'Prometheus', color: '#f59e0b' },
    9200: { name: 'Elasticsearch', color: '#f59e0b' },
    5000: { name: 'Flask/Dev', color: '#f59e0b' },
    8888: { name: 'Jupyter', color: '#f59e0b' },
    21: { name: 'FTP', color: '#6b7280' },
    25: { name: 'SMTP', color: '#6b7280' },
    53: { name: 'DNS', color: '#10b981' },
    993: { name: 'IMAPS', color: '#6b7280' },
    995: { name: 'POP3S', color: '#6b7280' },
    2049: { name: 'NFS', color: '#6b7280' },
    11211: { name: 'Memcached', color: '#ef4444' },
};

function parsePorts(raw) {
    const lines = raw.split('\n').filter(l => l.trim());
    if (lines.length < 2) return [];

    return lines.slice(1).map(line => {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) return null;

        // ss format: State Recv-Q Send-Q Local_Address:Port Peer_Address:Port Process
        const state = parts[0];
        const localAddr = parts[3] || '';
        const processInfo = parts.slice(5).join(' ');

        const lastColon = localAddr.lastIndexOf(':');
        const address = localAddr.substring(0, lastColon);
        const port = parseInt(localAddr.substring(lastColon + 1), 10);

        if (isNaN(port)) return null;

        const known = KNOWN_PORTS[port];

        return {
            port,
            address: address || '*',
            state,
            process: processInfo.replace(/users:\(\("|"\)\)/g, '').replace(/,.*$/, '') || 'unknown',
            service: known?.name || `Port ${port}`,
            color: known?.color || '#6b7280',
        };
    }).filter(Boolean).sort((a, b) => a.port - b.port);
}

export default function PortScanner() {
    const [ports, setPorts] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');

    const scanPorts = async () => {
        setLoading(true);
        setError(null);
        try {
            const output = await invoke('exec_ssh_command', {
                sessionId: MAIN_SESSION_ID,
                command: 'ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null'
            });
            setPorts(parsePorts(output));
        } catch (err) {
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        scanPorts();
    }, []);

    const filtered = ports.filter(p => {
        if (!search) return true;
        const q = search.toLowerCase();
        return p.service.toLowerCase().includes(q) ||
            p.port.toString().includes(q) ||
            p.process.toLowerCase().includes(q) ||
            p.address.includes(q);
    });

    const getIcon = (service) => {
        const s = service.toLowerCase();
        if (s.includes('http') || s.includes('nginx')) return <Globe size={14} />;
        if (s.includes('ssh') || s.includes('ssl') || s.includes('https')) return <Shield size={14} />;
        if (s.includes('mysql') || s.includes('postgres') || s.includes('mongo') || s.includes('redis')) return <Database size={14} />;
        return <Server size={14} />;
    };

    return (
        <div className="ps-container">
            <div className="ps-header">
                <div className="ps-title-row">
                    <Network size={20} className="ps-icon" />
                    <h2 className="ps-title">Port Scanner</h2>
                    <span className="ps-count">{filtered.length} open ports</span>
                </div>
                <div className="ps-toolbar">
                    <div className="ps-search">
                        <Search size={14} />
                        <input
                            placeholder="Filter by port, service, or process..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                        />
                        {search && <button className="ps-clear" onClick={() => setSearch('')}><X size={12} /></button>}
                    </div>
                    <button className="ps-btn" onClick={scanPorts} disabled={loading}>
                        <RefreshCw size={14} className={loading ? 'spin' : ''} />
                        <span>Scan</span>
                    </button>
                </div>
            </div>

            {error && <div className="ps-error">{error}</div>}

            <div className="ps-grid">
                {filtered.map(p => (
                    <div key={`${p.address}:${p.port}`} className="ps-card">
                        <div className="ps-card-header">
                            <div className="ps-port-badge" style={{ borderColor: p.color, color: p.color }}>
                                {getIcon(p.service)}
                                <span className="ps-port-num">{p.port}</span>
                            </div>
                            <span className="ps-service-name" style={{ color: p.color }}>{p.service}</span>
                        </div>
                        <div className="ps-card-body">
                            <div className="ps-detail">
                                <span className="ps-label">Address</span>
                                <span className="ps-value mono">{p.address}</span>
                            </div>
                            <div className="ps-detail">
                                <span className="ps-label">State</span>
                                <span className="ps-state-badge">{p.state}</span>
                            </div>
                            <div className="ps-detail">
                                <span className="ps-label">Process</span>
                                <span className="ps-value mono" title={p.process}>{p.process}</span>
                            </div>
                        </div>
                    </div>
                ))}
                {filtered.length === 0 && !loading && (
                    <div className="ps-empty">No open ports found</div>
                )}
            </div>
        </div>
    );
}
