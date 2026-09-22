import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Box, Play, Square, RotateCcw, Trash2, RefreshCw, AlertCircle, Download, FileText, Layers, Terminal, X, ArrowDown, ArrowUp } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import { formatRemoteError } from "../../utils/errors";
import "./DockerManager.css";

// Docker commands go down the plain channel WITHOUT a `sudo` prefix: a user in
// the `docker` group needs none, and for everyone else the backend escalates by
// itself once the socket refuses the connection. A hardcoded `sudo docker …`
// broke the first group's hosts and, where sudo wants a password, both.

// ─── Sub-components ──────────────────────────────────────────────────────────

function ContainerLogs({ containerId, containerName, onClose }) {
    const [logLines, setLogLines] = useState([]);
    const [streaming, setStreaming] = useState(false);
    const [tail, setTail] = useState(100);
    const logRef = useRef(null);
    const streamIdRef = useRef(null);
    const unlistenRef = useRef(null);

    const fetchStaticLogs = useCallback(async () => {
        try {
            const output = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `docker logs --tail ${tail} ${containerId} 2>&1`
            });
            setLogLines(output.split('\n').filter(l => l.length > 0));
        } catch (err) {
            setLogLines([formatRemoteError(err, `Reading logs for ${containerName}`)]);
        }
    }, [containerId, containerName, tail]);

    useEffect(() => { fetchStaticLogs(); }, [fetchStaticLogs]);

    useEffect(() => {
        if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
    }, [logLines]);

    const toggleStream = useCallback(async () => {
        if (streaming) {
            // Stop stream
            if (streamIdRef.current) {
                try { await invoke('stop_log_stream', { streamId: streamIdRef.current }); } catch { /* best-effort teardown — stream is being discarded anyway */ }
                streamIdRef.current = null;
            }
            if (unlistenRef.current) { unlistenRef.current(); unlistenRef.current = null; }
            setStreaming(false);
            return;
        }

        // Start stream via docker logs -f using a streaming exec
        const sid = `docker-log-${containerId}-${Date.now()}`;
        streamIdRef.current = sid;
        setStreaming(true);

        const unlisten = await listen(`log-stream:${sid}`, (event) => {
            if (event.payload === '__EOF__') { setStreaming(false); return; }
            const newLines = event.payload.split('\n').filter(l => l.length > 0);
            if (newLines.length > 0) {
                setLogLines(prev => {
                    const combined = [...prev, ...newLines];
                    return combined.length > 2000 ? combined.slice(-2000) : combined;
                });
            }
        });
        unlistenRef.current = unlisten;

        try {
            await invoke('start_log_stream', {
                sessionId: MAIN_SESSION_ID,
                streamId: sid,
                logPath: `__docker__:${containerId}`,
                ip: '', user: '', port: 22,
            });
        } catch {
            // Fallback: use exec_ssh_command for simple tail
            setStreaming(false);
        }
    }, [streaming, containerId]);

    useEffect(() => {
        return () => {
            if (streamIdRef.current) {
                invoke('stop_log_stream', { streamId: streamIdRef.current }).catch(() => {});
            }
            if (unlistenRef.current) unlistenRef.current();
        };
    }, []);

    return (
        <div className="dm-logs-panel">
            <div className="dm-logs-header">
                <FileText size={14} />
                <span>Logs: {containerName}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
                    <button className={`dm-icon-btn ${streaming ? 'streaming' : ''}`}
                        onClick={toggleStream} title={streaming ? 'Stop stream' : 'Stream logs (docker logs -f)'}>
                        {streaming ? <Square size={12} /> : <Play size={12} />}
                    </button>
                    <button className="dm-icon-btn" onClick={fetchStaticLogs} title="Refresh"><RefreshCw size={12} /></button>
                    <button className="dm-icon-btn danger" onClick={onClose} title="Close"><X size={12} /></button>
                </div>
            </div>
            <div className="dm-logs-body" ref={logRef}>
                {logLines.map((line, i) => (
                    <div key={i} className="dm-log-line">{line}</div>
                ))}
                {logLines.length === 0 && <div className="dm-log-empty">No log output</div>}
            </div>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DockerManager() {
    const [containers, setContainers] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pendingAction, setPendingAction] = useState(null);
    const [missingDocker, setMissingDocker] = useState(false);
    const [installing, setInstalling] = useState(false);

    // Compose state
    const [composeFiles, setComposeFiles] = useState([]);
    const [composeLoading, setComposeLoading] = useState(false);
    const [composeAction, setComposeAction] = useState(null);

    // Logs overlay
    const [logsTarget, setLogsTarget] = useState(null); // { id, name }

    // Active tab
    const [activeTab, setActiveTab] = useState('containers'); // 'containers' | 'compose'

    const fetchContainers = async () => {
        setLoading(true);
        setError(null);
        try {
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

            const rawOutput = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.State}}|{{.Status}}|{{.Ports}}"`
            });

            const parsed = rawOutput.split('\n')
                .filter(line => line.includes('|'))
                .map(line => {
                    const [id, names, image, state, status, ports] = line.split('|');
                    return { id, names, image, state, status, ports: ports || 'No ports mapped' };
                });

            setContainers(parsed);
        } catch (err) {
            setError(formatRemoteError(err, "Listing containers"));
        } finally {
            setLoading(false);
        }
    };

    const fetchComposeFiles = async () => {
        setComposeLoading(true);
        try {
            const output = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "find / -maxdepth 4 -name 'docker-compose.yml' -o -name 'docker-compose.yaml' -o -name 'compose.yml' -o -name 'compose.yaml' 2>/dev/null | head -20"
            });
            const files = output.split('\n').filter(l => l.trim()).map(path => {
                const dir = path.replace(/\/[^/]+$/, '');
                const name = dir.split('/').filter(Boolean).pop() || dir;
                return { path, dir, name };
            });
            setComposeFiles(files);
        } catch {
            setComposeFiles([]);
        } finally {
            setComposeLoading(false);
        }
    };

    useEffect(() => {
        fetchContainers();
    }, []);

    useEffect(() => {
        if (activeTab === 'compose' && composeFiles.length === 0) fetchComposeFiles();
    }, [activeTab]);

    const performAction = async (containerId, action) => {
        setPendingAction(containerId);
        try {
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `docker ${action} ${containerId}`
            });
            setTimeout(fetchContainers, 1000);
        } catch (err) {
            setError(formatRemoteError(err, `${action} of container ${containerId}`));
        } finally {
            setPendingAction(null);
        }
    };

    const execIntoContainer = async (containerId, containerName) => {
        // Send docker exec command through the main terminal
        try {
            await invoke("send_ssh_input", {
                sessionId: MAIN_SESSION_ID,
                input: `sudo docker exec -it ${containerId} /bin/sh -c 'if [ -x /bin/bash ]; then exec /bin/bash; else exec /bin/sh; fi'\n`
            });
        } catch (err) {
            setError(`Failed to exec into ${containerName}: ${err}`);
        }
    };

    const composeExec = async (dir, action) => {
        setComposeAction(`${dir}:${action}`);
        setError(null);
        try {
            const composeCmd = `cd ${dir} && (docker compose ${action} || docker-compose ${action})`;
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: composeCmd
            });
            if (action === 'up -d' || action === 'down' || action === 'restart') {
                setTimeout(fetchContainers, 2000);
            }
        } catch (err) {
            setError(formatRemoteError(err, `Compose ${action} in ${dir}`));
        } finally {
            setComposeAction(null);
        }
    };

    const handleInstallDocker = async () => {
        setInstalling(true);
        setError(null);
        try {
            // Installing packages always needs root — go straight to the
            // elevated path rather than failing once on the way there.
            await invoke("exec_ssh_command_sudo", {
                sessionId: MAIN_SESSION_ID,
                command: "apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y docker.io docker-compose-plugin"
            });
            setTimeout(fetchContainers, 2000);
        } catch (err) {
            setError(formatRemoteError(err, "Installing Docker"));
            setInstalling(false);
        }
    };

    const getStatusColor = (state) => {
        if (state === 'running') return '#10b981';
        if (state === 'exited') return '#6b7280';
        if (state === 'paused') return '#f59e0b';
        if (state === 'dead' || state?.includes?.('error')) return '#ef4444';
        return '#3b82f6';
    };

    return (
        <div className="docker-container">
            <div className="dm-header">
                <div>
                    <h2>Docker Manager</h2>
                    <p className="dm-subtitle">Manage containers, compose stacks, and logs</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Tab switcher */}
                    <div className="dm-tabs">
                        <button className={`dm-tab ${activeTab === 'containers' ? 'active' : ''}`}
                            onClick={() => setActiveTab('containers')}>
                            <Box size={13} /> Containers
                        </button>
                        <button className={`dm-tab ${activeTab === 'compose' ? 'active' : ''}`}
                            onClick={() => setActiveTab('compose')}>
                            <Layers size={13} /> Compose
                        </button>
                    </div>
                    <button className="dm-action-btn" onClick={activeTab === 'containers' ? fetchContainers : fetchComposeFiles}
                        disabled={loading || composeLoading || !!pendingAction}>
                        <RefreshCw size={14} className={(loading || composeLoading) && !pendingAction ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
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
                            <><RefreshCw size={16} className="animate-spin" /> Installing...</>
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
            ) : activeTab === 'compose' ? (
                /* ─── Compose Tab ───────────────────────────────────────────── */
                <div className="dm-card">
                    <div className="dm-card-header">
                        <h3>Compose Stacks ({composeFiles.length})</h3>
                    </div>
                    {composeLoading && <div className="dm-empty-state"><RefreshCw size={24} className="animate-spin" /></div>}
                    {!composeLoading && composeFiles.length === 0 && (
                        <div className="dm-empty-state">
                            <Layers size={32} opacity={0.5} />
                            <p>No docker-compose files found (searched up to depth 4)</p>
                        </div>
                    )}
                    <div className="dm-grid">
                        {composeFiles.map((f) => (
                            <div key={f.path} className="dm-list-item">
                                <div className="dm-list-icon">
                                    <Layers size={20} style={{ color: '#3b82f6' }} />
                                </div>
                                <div className="dm-list-content">
                                    <div className="dm-list-title">{f.name}</div>
                                    <div className="dm-list-desc">
                                        <span className="dm-mono" style={{ fontSize: 11 }}>{f.path}</span>
                                    </div>
                                </div>
                                <div className="dm-list-actions" style={{ opacity: 1, flexDirection: 'row' }}>
                                    <button className="dm-icon-btn" style={{ color: '#10b981' }}
                                        title="Up (detached)"
                                        disabled={composeAction === `${f.dir}:up -d`}
                                        onClick={() => composeExec(f.dir, 'up -d')}>
                                        <ArrowUp size={16} />
                                    </button>
                                    <button className="dm-icon-btn danger"
                                        title="Down"
                                        disabled={composeAction === `${f.dir}:down`}
                                        onClick={() => composeExec(f.dir, 'down')}>
                                        <ArrowDown size={16} />
                                    </button>
                                    <button className="dm-icon-btn"
                                        title="Restart"
                                        disabled={!!composeAction}
                                        onClick={() => composeExec(f.dir, 'restart')}>
                                        <RotateCcw size={16} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            ) : (
                /* ─── Containers Tab ────────────────────────────────────────── */
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
                                            <span>{c.image}</span>
                                            <span className="dm-mono">{c.id.substring(0, 12)}</span>
                                        </div>
                                        <div className="dm-list-subtext">
                                            <span>Status: {c.status}</span>
                                            <span style={{ display: 'block', marginTop: '4px', opacity: 0.8 }}>Ports: {c.ports}</span>
                                        </div>
                                    </div>

                                    <div className="dm-list-actions" style={{ opacity: pendingAction === c.id ? 1 : undefined }}>
                                        {/* Logs button — always visible */}
                                        <button className="dm-icon-btn" title="View Logs"
                                            onClick={() => setLogsTarget({ id: c.id, name: c.names })}>
                                            <FileText size={16} />
                                        </button>

                                        {c.state === 'running' ? (
                                            <>
                                                {/* Exec into container */}
                                                <button className="dm-icon-btn" title="Exec Shell"
                                                    style={{ color: '#60a5fa' }}
                                                    onClick={() => execIntoContainer(c.id, c.names)}>
                                                    <Terminal size={16} />
                                                </button>
                                                <button className="dm-icon-btn" title="Restart Container"
                                                    onClick={() => performAction(c.id, 'restart')}>
                                                    <RotateCcw size={16} className={pendingAction === c.id ? "animate-spin" : ""} />
                                                </button>
                                                <button className="dm-icon-btn danger" title="Stop Container"
                                                    onClick={() => performAction(c.id, 'stop')}>
                                                    <Square size={16} />
                                                </button>
                                            </>
                                        ) : (
                                            <>
                                                <button className="dm-icon-btn" style={{ color: '#10b981' }}
                                                    title="Start Container"
                                                    disabled={pendingAction === c.id}
                                                    onClick={() => performAction(c.id, 'start')}>
                                                    <Play size={16} />
                                                </button>
                                                {c.state !== 'running' && (
                                                    <button className="dm-icon-btn danger" title="Remove Container"
                                                        disabled={pendingAction === c.id}
                                                        onClick={() => {
                                                            if (confirm(`Delete container ${c.names}?`)) performAction(c.id, 'rm');
                                                        }}>
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

            {/* Logs overlay panel */}
            {logsTarget && (
                <ContainerLogs
                    containerId={logsTarget.id}
                    containerName={logsTarget.name}
                    onClose={() => setLogsTarget(null)}
                />
            )}
        </div>
    );
}
