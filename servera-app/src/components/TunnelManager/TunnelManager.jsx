import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Plus, X, Globe, ArrowRight, AlertCircle, RefreshCw } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./TunnelManager.css";

export default function TunnelManager({ ip, user, port, password, privateKey, proxyJump }) {
    const [tunnels, setTunnels] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Form state
    const [tunnelType, setTunnelType] = useState("local");
    const [localPort, setLocalPort] = useState("");
    const [remoteHost, setRemoteHost] = useState("127.0.0.1");
    const [remotePort, setRemotePort] = useState("");
    const [creating, setCreating] = useState(false);

    const fetchTunnels = useCallback(async () => {
        try {
            const list = await invoke("list_tunnels");
            setTunnels(list);
        } catch {}
    }, []);

    useEffect(() => { fetchTunnels(); }, [fetchTunnels]);

    const handleCreate = async () => {
        if (!localPort) return;
        setCreating(true);
        setError(null);
        try {
            const tunnelId = `tunnel-${Date.now()}`;
            await invoke("create_tunnel", {
                sessionId: MAIN_SESSION_ID,
                tunnelId,
                tunnelType,
                localPort: parseInt(localPort),
                remoteHost: tunnelType === "local" ? remoteHost : null,
                remotePort: tunnelType === "local" ? parseInt(remotePort) || 80 : null,
                ip, user,
                port: port || 22,
                password: password || null,
                privateKey: privateKey || null,
                proxyJump: proxyJump || null,
            });
            setLocalPort("");
            setRemotePort("");
            fetchTunnels();
        } catch (err) {
            setError(String(err));
        } finally {
            setCreating(false);
        }
    };

    const handleClose = async (tunnelId) => {
        try {
            await invoke("close_tunnel", { tunnelId });
            setTunnels(prev => prev.filter(t => t.id !== tunnelId));
        } catch (err) {
            setError(String(err));
        }
    };

    return (
        <div className="tm-container">
            <div className="tm-header">
                <div>
                    <h2>SSH Tunnels</h2>
                    <p className="tm-subtitle">Port forwards (-L) and SOCKS proxies (-D) through {user}@{ip}</p>
                </div>
                <button className="tm-create-btn" onClick={fetchTunnels} style={{ background: '#1f2532', borderColor: 'transparent', color: '#d1d5db' }}>
                    <RefreshCw size={14} /> Refresh
                </button>
            </div>

            {error && (
                <div className="tm-error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                    <button onClick={() => setError(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}><X size={14} /></button>
                </div>
            )}

            {/* Create tunnel form */}
            <div className="tm-form">
                <div className="tm-field">
                    <label>Type</label>
                    <select value={tunnelType} onChange={e => setTunnelType(e.target.value)}>
                        <option value="local">Local Forward (-L)</option>
                        <option value="dynamic">SOCKS Proxy (-D)</option>
                    </select>
                </div>
                <div className="tm-field">
                    <label>Local Port</label>
                    <input
                        type="number"
                        placeholder="8080"
                        value={localPort}
                        onChange={e => setLocalPort(e.target.value)}
                        style={{ width: 90 }}
                    />
                </div>
                {tunnelType === "local" && (
                    <>
                        <div className="tm-field">
                            <label>Remote Host</label>
                            <input
                                placeholder="127.0.0.1"
                                value={remoteHost}
                                onChange={e => setRemoteHost(e.target.value)}
                                style={{ width: 140 }}
                            />
                        </div>
                        <div className="tm-field">
                            <label>Remote Port</label>
                            <input
                                type="number"
                                placeholder="80"
                                value={remotePort}
                                onChange={e => setRemotePort(e.target.value)}
                                style={{ width: 90 }}
                            />
                        </div>
                    </>
                )}
                <button className="tm-create-btn" onClick={handleCreate} disabled={creating || !localPort}>
                    {creating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                    {creating ? "Creating..." : "Create Tunnel"}
                </button>
            </div>

            {/* Active tunnels */}
            <div className="tm-card">
                <h3>Active Tunnels ({tunnels.length})</h3>
                {tunnels.length === 0 ? (
                    <div className="tm-empty">
                        <ArrowRightLeft size={32} opacity={0.4} />
                        <span>No active tunnels</span>
                        <span style={{ fontSize: 11 }}>Create a local port forward or SOCKS proxy above</span>
                    </div>
                ) : (
                    <div className="tm-grid">
                        {tunnels.map((t) => (
                            <div key={t.id} className="tm-tunnel-item">
                                <div className={`tm-tunnel-icon ${t.tunnel_type}`}>
                                    {t.tunnel_type === "dynamic" ? <Globe size={18} /> : <ArrowRightLeft size={18} />}
                                </div>
                                <div className="tm-tunnel-info">
                                    <div className="tm-tunnel-label">
                                        {t.tunnel_type === "dynamic"
                                            ? `SOCKS5 Proxy :${t.local_port}`
                                            : `localhost:${t.local_port}`}
                                        {t.tunnel_type === "local" && (
                                            <span style={{ color: '#6b7280', margin: '0 6px' }}><ArrowRight size={12} style={{ verticalAlign: 'middle' }} /></span>
                                        )}
                                        {t.tunnel_type === "local" && (
                                            <span style={{ color: '#9ca3af' }}>{t.remote_host}:{t.remote_port}</span>
                                        )}
                                    </div>
                                    <div className="tm-tunnel-detail">
                                        <span className={`tm-tunnel-badge ${t.tunnel_type}`}>
                                            {t.tunnel_type === "dynamic" ? "-D" : "-L"}
                                        </span>
                                    </div>
                                </div>
                                <button className="tm-close-btn" onClick={() => handleClose(t.id)} title="Close tunnel">
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
