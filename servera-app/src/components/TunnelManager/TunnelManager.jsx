import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ArrowRightLeft, Plus, X, Globe, ArrowRight, AlertCircle, RefreshCw, Cloud } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./TunnelManager.css";

export default function TunnelManager({ ip, user, port, password, privateKey, proxyJump, profileId, onOpenCloudBrowser }) {
    const [tunnels, setTunnels] = useState([]);
    const [error, setError] = useState(null);

    // Form state
    const [tunnelType, setTunnelType] = useState("local");
    const [localPort, setLocalPort] = useState("");
    const [remoteHost, setRemoteHost] = useState("127.0.0.1");
    const [remotePort, setRemotePort] = useState("");
    const [creating, setCreating] = useState(false);

    const fetchTunnels = useCallback(async () => {
        try {
            const list = await invoke("get_active_tunnels");
            setTunnels(list);
        } catch (err) {
            console.error("Failed to load tunnels:", err);
        }
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
                remoteHost: tunnelType === "dynamic" ? null : remoteHost,
                remotePort: tunnelType === "dynamic" ? null : (parseInt(remotePort) || null),
                ip, user,
                port: port || 22,
                password: password || null,
                privateKey: privateKey || null,
                proxyJump: proxyJump || null,
                // For a saved profile, credentials are resolved server-side
                // from the keyring — the password never lives in the UI.
                profileId: profileId || null,
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
                    <select value={tunnelType} onChange={e => {
                        setTunnelType(e.target.value);
                        if (e.target.value === "remote") {
                            setRemoteHost("127.0.0.1");
                        } else if (e.target.value === "local") {
                            setRemoteHost("127.0.0.1");
                        }
                    }}>
                        <option value="local">Local Forward (-L)</option>
                        <option value="remote">Remote Forward (-R)</option>
                        <option value="dynamic">SOCKS Proxy (-D)</option>
                    </select>
                </div>

                {tunnelType === "local" && (
                    <>
                        <div className="tm-field">
                            <label>Local Port</label>
                            <input
                                type="number"
                                placeholder="8080"
                                value={localPort}
                                onChange={e => setLocalPort(e.target.value)}
                                style={{ width: 80 }}
                            />
                        </div>
                        <div className="tm-field">
                            <label>Remote Destination</label>
                            <div className="tm-field-group">
                                <input
                                    placeholder="127.0.0.1"
                                    value={remoteHost}
                                    onChange={e => setRemoteHost(e.target.value)}
                                    style={{ width: 120 }}
                                />
                                <span className="tm-sep">:</span>
                                <input
                                    type="number"
                                    placeholder="80"
                                    value={remotePort}
                                    onChange={e => setRemotePort(e.target.value)}
                                    style={{ width: 70 }}
                                />
                            </div>
                        </div>
                    </>
                )}

                {tunnelType === "remote" && (
                    <>
                        <div className="tm-field">
                            <label>Remote Port</label>
                            <input
                                type="number"
                                placeholder="8080"
                                value={localPort}
                                onChange={e => setLocalPort(e.target.value)}
                                style={{ width: 80 }}
                            />
                        </div>
                        <div className="tm-field">
                            <label>Local Target</label>
                            <div className="tm-field-group">
                                <input
                                    placeholder="127.0.0.1"
                                    value={remoteHost}
                                    onChange={e => setRemoteHost(e.target.value)}
                                    style={{ width: 120 }}
                                />
                                <span className="tm-sep">:</span>
                                <input
                                    type="number"
                                    placeholder="3000"
                                    value={remotePort}
                                    onChange={e => setRemotePort(e.target.value)}
                                    style={{ width: 70 }}
                                />
                            </div>
                        </div>
                    </>
                )}

                {tunnelType === "dynamic" && (
                    <div className="tm-field">
                        <label>Local Proxy Port</label>
                        <input
                            type="number"
                            placeholder="1080"
                            value={localPort}
                            onChange={e => setLocalPort(e.target.value)}
                            style={{ width: 90 }}
                        />
                    </div>
                )}

                <button className="tm-create-btn" onClick={handleCreate} disabled={creating || !localPort}>
                    {creating ? <RefreshCw size={14} className="animate-spin" /> : <Plus size={14} />}
                    {creating ? "Creating..." : "Start Tunnel"}
                </button>
            </div>

            {/* Active tunnels */}
            <div className="tm-card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                    <h3 style={{ margin: 0 }}>Active Tunnels ({tunnels.length})</h3>
                    <div className="tm-legend">
                        <span className="tm-dot local"></span> Local (-L)
                        <span className="tm-dot remote" style={{ marginLeft: 12 }}></span> Remote (-R)
                        <span className="tm-dot dynamic" style={{ marginLeft: 12 }}></span> Proxy (-D)
                    </div>
                </div>

                {tunnels.length === 0 ? (
                    <div className="tm-empty">
                        <ArrowRightLeft size={32} opacity={0.4} />
                        <span>No active tunnels</span>
                        <span style={{ fontSize: 11, color: '#6b7280' }}>
                            Major companies use <b>Remote Tunnels (-R)</b> to access private IPs without exposing them to the internet.
                        </span>
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
                                        {t.tunnel_type === "dynamic" ? (
                                            `SOCKS5 Proxy :${t.local_port}`
                                        ) : t.tunnel_type === "remote" ? (
                                            <>
                                                <span style={{ color: '#9ca3af' }}>{t.remote_host}:{t.local_port}</span>
                                                <span style={{ color: '#6b7280', margin: '0 6px' }}><ArrowRight size={12} style={{ verticalAlign: 'middle' }} /></span>
                                                <span style={{ color: '#f59e0b' }}>Remote:{t.remote_port}</span>
                                            </>
                                        ) : (
                                            <>
                                                <span>localhost:{t.local_port}</span>
                                                <span style={{ color: '#6b7280', margin: '0 6px' }}><ArrowRight size={12} style={{ verticalAlign: 'middle' }} /></span>
                                                <span style={{ color: '#9ca3af' }}>{t.remote_host}:{t.remote_port}</span>
                                            </>
                                        )}
                                    </div>
                                    <div className="tm-tunnel-detail">
                                        <span className={`tm-tunnel-badge ${t.tunnel_type}`}>
                                            {t.tunnel_type === "dynamic" ? "-D" : t.tunnel_type === "remote" ? "-R" : "-L"}
                                        </span>
                                        <span style={{ marginLeft: 8, fontSize: 10, color: '#4b5563' }}>
                                            {t.tunnel_type === "remote" ? "Reverse Tunnel (Secure Access)" : "Port Forward"}
                                        </span>
                                    </div>
                                </div>
                                {t.tunnel_type === "local" && onOpenCloudBrowser && (
                                    <button
                                        className="tm-close-btn"
                                        onClick={() => onOpenCloudBrowser(`http://localhost:${t.local_port}`)}
                                        title="Open in Cloud Browser"
                                    >
                                        <Cloud size={16} />
                                    </button>
                                )}
                                <button className="tm-close-btn" onClick={() => handleClose(t.id)} title="Close tunnel">
                                    <X size={16} />
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div className="tm-info-card">
                <AlertCircle size={18} style={{ color: '#3b82f6' }} />
                <div className="tm-info-content">
                    <h4>Why use Remote Tunneling?</h4>
                    <p>
                        Instead of exposing your private server to the public internet, you create a <b>Reverse Tunnel (-R)</b>. 
                        This connects your local private resource to a public gateway server securely. 
                        It's how major companies maintain "Private IP" accessibility while keeping the front door locked.
                    </p>
                </div>
            </div>
        </div>
    );
}
