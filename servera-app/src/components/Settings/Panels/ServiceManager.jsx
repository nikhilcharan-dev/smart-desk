import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, RefreshCw, AlertCircle, Play, Square, RotateCcw } from "lucide-react";
import { MAIN_SESSION_ID } from "../../../utils/terminal";
import { formatRemoteError } from "../../../utils/errors";
import "./SettingsPanels.css";

// Common developer services to monitor
const KNOWN_SERVICES = [
    { id: "docker", name: "Docker", desc: "Container Runtime" },
    { id: "nginx", name: "Nginx", desc: "Web Server" },
    { id: "apache2", name: "Apache", desc: "Web Server" },
    { id: "mysql", name: "MySQL", desc: "Database Server" },
    { id: "postgresql", name: "PostgreSQL", desc: "Database Server" },
    { id: "redis-server", name: "Redis", desc: "In-Memory Datastore" },
    { id: "ufw", name: "UFW Firewall", desc: "Uncomplicated Firewall" },
    { id: "ssh", name: "SSH Daemon", desc: "Openssh Server" },
];

export default function ServiceManager() {
    const [services, setServices] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [pendingAction, setPendingAction] = useState(null);

    const fetchServices = async () => {
        setLoading(true);
        setError(null);
        try {
            // We check the status of all known services in one shot using space-separated args
            // systemctl is-active returns 'active', 'inactive', 'failed', or 'unknown'
            const svcNames = KNOWN_SERVICES.map(s => s.id).join(' ');

            // Note: systemctl returns non-zero exit code if ANY service is not active, 
            // so we MUST catch the error and parse its stdout regardless.
            try {
                // The bulk command might fail if any service is down, which is normal
                await invoke("exec_ssh_command", {
                    sessionId: MAIN_SESSION_ID,
                    command: `systemctl is-active ${svcNames}`
                });
            } catch {
                // Ignore bulk error, fall back to individual checks
            }

            // Safer individual fallback if bulk fails or returns messy error strings
            const results = await Promise.all(
                KNOWN_SERVICES.map(async (svc) => {
                    let status = "unknown";
                    try {
                        // Using || echo to guarantee a 0 exit code so invoke doesn't throw
                        const out = await invoke("exec_ssh_command", {
                            sessionId: MAIN_SESSION_ID,
                            command: `systemctl is-active ${svc.id} || echo "inactive"`
                        });
                        status = out.trim();
                    } catch {
                        status = "error";
                    }

                    return { ...svc, status };
                })
            );

            setServices(results);
        } catch (err) {
            setError(formatRemoteError(err, "Reading service status"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchServices();

        // Auto-refresh every 10s
        const interval = setInterval(fetchServices, 10000);
        return () => clearInterval(interval);
    }, []);

    const performAction = async (serviceId, action) => {
        setPendingAction(serviceId);
        try {
            // The backend runs this plain first and re-runs it through sudo
            // (NOPASSWD, else the profile's stored sudo password) when the bare
            // attempt is refused or the inner sudo cannot prompt for a password.
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `systemctl ${action} ${serviceId}`
            });

            // Wait a second for state to settle, then refresh
            setTimeout(fetchServices, 1000);
        } catch (err) {
            setError(formatRemoteError(err, `${action} of ${serviceId}`));
        } finally {
            setPendingAction(null);
        }
    };

    const getStatusColor = (status) => {
        if (status === 'active') return '#10b981'; // Green
        if (status === 'inactive') return '#6b7280'; // Gray
        if (status === 'failed') return '#ef4444'; // Red
        return '#f59e0b'; // Yellow for unknown/activating
    };

    return (
        <div className="sh-panel">
            <div className="sh-panel-header">
                <div>
                    <h2>Service Manager</h2>
                    <p className="sh-panel-subtitle">Manage systemd services running on the remote host</p>
                </div>
                <button className="sh-action-btn" onClick={fetchServices} disabled={loading || pendingAction}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    Refresh
                </button>
            </div>

            {error && (
                <div className="sh-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            <div className="sh-card">
                <div className="sh-card-header">
                    <h3>Monitored Services</h3>
                </div>

                <div className="sh-list">
                    {services.map((svc) => (
                        <div key={svc.id} className="sh-list-item">
                            <div className="sh-list-icon">
                                <Activity size={16} style={{ color: getStatusColor(svc.status) }} />
                            </div>
                            <div className="sh-list-content">
                                <div className="sh-list-title">{svc.name}</div>
                                <div className="sh-list-desc">
                                    <span className="sh-mono" style={{ color: getStatusColor(svc.status) }}>
                                        {svc.status.toUpperCase()}
                                    </span>
                                    <span>· {svc.desc}</span>
                                </div>
                            </div>

                            {svc.status !== 'unknown' && svc.status !== 'error' && (
                                <div className="sh-list-actions" style={{ opacity: pendingAction === svc.id ? 1 : undefined }}>
                                    {svc.status === 'active' ? (
                                        <>
                                            <button
                                                className="sh-icon-btn"
                                                title="Restart Service"
                                                disabled={pendingAction === svc.id}
                                                onClick={() => performAction(svc.id, 'restart')}
                                            >
                                                <RotateCcw size={14} className={pendingAction === svc.id ? "animate-spin" : ""} />
                                            </button>
                                            <button
                                                className="sh-icon-btn danger"
                                                title="Stop Service"
                                                disabled={pendingAction === svc.id}
                                                onClick={() => performAction(svc.id, 'stop')}
                                            >
                                                <Square size={14} />
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="sh-icon-btn"
                                            style={{ color: '#10b981' }}
                                            title="Start Service"
                                            disabled={pendingAction === svc.id}
                                            onClick={() => performAction(svc.id, 'start')}
                                        >
                                            <Play size={14} />
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    ))}
                </div>
            </div>

            <p style={{ fontSize: '12px', color: '#6b7280', marginTop: '16px', textAlign: 'center' }}>
                Note: Starting/Stopping services needs root. Servera escalates automatically using
                passwordless sudo, or the sudo password saved on this profile.
            </p>
        </div>
    );
}
