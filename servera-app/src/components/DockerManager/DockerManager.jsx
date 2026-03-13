import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Box, Play, Square, RotateCcw, Trash2, RefreshCw, AlertCircle, Download } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./DockerManager.css";

export default function DockerManager() {
    const [containers, setContainers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pendingAction, setPendingAction] = useState(null);
    const [missingDocker, setMissingDocker] = useState(false);
    const [installing, setInstalling] = useState(false);

    const fetchContainers = async () => {
        setLoading(true);
        setError(null);
        try {
            // Check if docker exists first
            const hasDocker = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "command -v docker || echo 'missing'"
            });

            if (hasDocker.trim() === 'missing') {
                setMissingDocker(true);
                setLoading(false);
                return;
            }
            setMissingDocker(false);

            // Using format string to make parsing easy and deterministic
            const rawOutput = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `sudo docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}"`
            });

            const parsed = rawOutput.split('\n')
                .filter(line => line.includes('|'))
                .map(line => {
                    const [id, names, image, state, status, ports] = line.split('|');
                    return { id, names, image, state, status, ports: ports || 'No ports mapped' };
                });

            setContainers(parsed);
        } catch (err) {
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
    }, []);

    const performAction = async (containerId, action) => {
        setPendingAction(containerId);
        try {
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `sudo docker ${action} ${containerId}`
            });
            setTimeout(fetchContainers, 1000);
        } catch (err) {
            setError(`Failed to ${action} container: ` + err);
        } finally {
            setPendingAction(null);
        }
    };

    const handleInstallDocker = async () => {
        setInstalling(true);
        setError(null);
        try {
            // Need sudo privileges without password for this to be completely silent
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io"
            });
            setTimeout(fetchContainers, 2000);
        } catch (err) {
            setError(`Installation failed: ${err}`);
            setInstalling(false);
        }
    };

    const getStatusColor = (state) => {
        if (state === 'running') return '#10b981'; // Green
        if (state === 'exited') return '#6b7280'; // Gray
        if (state === 'paused') return '#f59e0b'; // Yellow
        if (state === 'dead' || state.includes('error')) return '#ef4444'; // Red
        return '#3b82f6'; // Blue default
    };

    return (
        <div className="docker-container">
            <div className="dm-header">
                <div>
                    <h2>Docker Manager</h2>
                    <p className="dm-subtitle">Manage container lifecycles on the remote VM</p>
                </div>
                <button className="dm-action-btn" onClick={fetchContainers} disabled={loading || pendingAction}>
                    <RefreshCw size={14} className={loading && !pendingAction ? "animate-spin" : ""} />
                    Refresh
                </button>
            </div>

            {error && !missingDocker && (
                <div className="dm-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {missingDocker ? (
                <div className="dm-empty-state">
                    <Box size={40} opacity={0.6} color="#ef4444" />
                    <h3>Docker Not Installed</h3>
                    <p style={{ maxWidth: '400px', margin: '8px auto', color: '#9ca3af' }}>
                        Docker is required to manage containers. It seems it is not installed or not in the system PATH on the remote host.
                    </p>
                    <button
                        className="dm-action-btn"
                        style={{ marginTop: '16px', background: '#3b82f6', color: 'white', border: 'none' }}
                        onClick={handleInstallDocker}
                        disabled={installing}
                    >
                        {installing ? (
                            <><RefreshCw size={16} className="animate-spin" /> Installing... (This may take a minute)</>
                        ) : (
                            <><Download size={16} /> 1-Click Install Docker</>
                        )}
                    </button>
                    {error && (
                        <div style={{ marginTop: '16px', color: '#ef4444', fontSize: '12px' }}>
                            {error}
                        </div>
                    )}
                </div>
            ) : (
                <div className="dm-card">
                    <div className="dm-card-header">
                        <h3>All Containers ({containers.length})</h3>
                    </div>

                    {containers.length === 0 && !loading && !error ? (
                        <div className="dm-empty-state">
                            <Box size={32} opacity={0.5} />
                            <p>No Docker containers found.</p>
                        </div>
                    ) : (
                        <div className="dm-grid">
                            {containers.map((c) => (
                                <div key={c.id} className="dm-list-item">
                                    <div className="dm-list-icon">
                                        <Box size={20} style={{ color: getStatusColor(c.state) }} />
                                    </div>
                                    <div className="dm-list-content">
                                        <div className="dm-list-title">
                                            {c.names}
                                            <span className="dm-badge" style={{ backgroundColor: `${getStatusColor(c.state)}20`, color: getStatusColor(c.state) }}>
                                                {c.state.toUpperCase()}
                                            </span>
                                        </div>
                                        <div className="dm-list-desc">
                                            <span>📦 {c.image}</span>
                                            <span className="dm-mono">🏷️ {c.id.substring(0, 12)}</span>
                                        </div>
                                        <div className="dm-list-subtext">
                                            <span>Status: {c.status}</span>
                                            <span style={{ display: 'block', marginTop: '4px', opacity: 0.8 }}>Ports: {c.ports}</span>
                                        </div>
                                    </div>

                                    <div className="dm-list-actions" style={{ opacity: pendingAction === c.id ? 1 : undefined }}>
                                        {c.state === 'running' ? (
                                            <>
                                                <button
                                                    className="dm-icon-btn"
                                                    title="Restart Container"
                                                    onClick={() => performAction(c.id, 'restart')}
                                                >
                                                    <RotateCcw size={16} className={pendingAction === c.id ? "animate-spin" : ""} />
                                                </button>
                                                <button
                                                    className="dm-icon-btn danger"
                                                    title="Stop Container"
                                                    onClick={() => performAction(c.id, 'stop')}
                                                >
                                                    <Square size={16} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button
                                                    className="dm-icon-btn"
                                                    style={{ color: '#10b981' }}
                                                    title="Start Container"
                                                    disabled={pendingAction === c.id}
                                                    onClick={() => performAction(c.id, 'start')}
                                                >
                                                    <Play size={16} />
                                                </button>
                                                {c.state !== 'running' && (
                                                    <button
                                                        className="dm-icon-btn danger"
                                                        title="Remove Container"
                                                        disabled={pendingAction === c.id}
                                                        onClick={() => {
                                                            if (confirm(`Delete container ${c.names}?`)) performAction(c.id, 'rm');
                                                        }}
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
