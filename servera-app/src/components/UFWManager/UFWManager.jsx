import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield, ShieldAlert, ShieldCheck, Plus, Trash2, RefreshCw, AlertCircle, Info, Download } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./UFWManager.css";

export default function UFWManager() {
    const [status, setStatus] = useState("checking"); // 'active' | 'inactive' | 'checking' | 'error'
    const [rules, setRules] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [isAdding, setIsAdding] = useState(false);
    const [missingUfw, setMissingUfw] = useState(false);
    const [installing, setInstalling] = useState(false);

    // New rule state
    const [newPort, setNewPort] = useState("");
    const [newProto, setNewProto] = useState("tcp");
    const [newAction, setNewAction] = useState("allow");

    const fetchUfw = async () => {
        setLoading(true);
        setError(null);
        try {
            // First check if ufw is installed and we have sudo
            const hasUfw = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "command -v ufw || echo 'missing'"
            });

            if (hasUfw.trim() === 'missing') {
                setMissingUfw(true);
                setStatus("error");
                setLoading(false);
                return;
            }
            setMissingUfw(false);

            // Get status and numbered rules
            // stderr redirected to stdout just in case it fails due to permissions
            const rawOutput = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "sudo ufw status numbered 2>&1"
            });

            if (rawOutput.includes("inactive")) {
                setStatus("inactive");
                setRules([]);
            } else if (rawOutput.includes("Status: active")) {
                setStatus("active");

                // Parse the numbered rules table
                // Example Output:
                // Status: active
                //
                //      To                         Action      From
                //      --                         ------      ----
                // [ 1] 22/tcp                     ALLOW IN    Anywhere
                // [ 2] 80/tcp                     ALLOW IN    Anywhere

                const lines = rawOutput.split('\n');
                const parsedRules = [];

                let inTable = false;
                for (const line of lines) {
                    if (line.includes('--')) {
                        inTable = true;
                        continue;
                    }
                    if (inTable && line.match(/^\[\s*\d+\]/)) {
                        // regex to extract: [ ID] TARGET ACTION FROM
                        const match = line.match(/^\[\s*(\d+)\]\s+(.*?)\s+(ALLOW IN|DENY IN|REJECT IN|ALLOW OUT|DENY OUT)\s+(.*)$/i) ||
                            line.match(/^\[\s*(\d+)\]\s+(.*?)\s+(ALLOW|DENY|REJECT)\s+(.*)$/i);

                        if (match) {
                            parsedRules.push({
                                id: parseInt(match[1]),
                                target: match[2].trim(),
                                action: match[3].trim(),
                                from: match[4].trim(),
                                raw: line
                            });
                        }
                    }
                }
                setRules(parsedRules);
            } else {
                // E.g. permission denied or other error
                throw new Error("Could not read UFW status. Does the user have sudo privileges without a password prompt?");
            }
        } catch (err) {
            setError(err.toString());
            setStatus("error");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchUfw();
    }, []);

    const toggleUfw = async () => {
        if (!confirm(`Are you sure you want to ${status === 'active' ? 'disable' : 'enable'} the firewall? Disabling it may expose all ports. Enabling it without an SSH allow rule WILL lock you out.`)) {
            return;
        }

        setLoading(true);
        try {
            const cmd = status === 'active' ? 'sudo ufw disable' : 'sudo ufw --force enable';
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: cmd
            });
            setTimeout(fetchUfw, 1000);
        } catch (err) {
            setError("Failed to toggle UFW: " + err);
            setLoading(false);
        }
    };

    const handleInstallUfw = async () => {
        setInstalling(true);
        setError(null);
        try {
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "sudo apt-get update && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y ufw"
            });
            setTimeout(fetchUfw, 2000);
        } catch (err) {
            setError(`Installation failed: ${err}`);
            setInstalling(false);
        }
    };

    const handleAddRule = async () => {
        if (!newPort) return;
        setLoading(true);
        try {
            const ruleTarget = newProto === 'any' ? newPort : `${newPort}/${newProto}`;
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `sudo ufw ${newAction} ${ruleTarget}`
            });
            setIsAdding(false);
            setNewPort("");
            setTimeout(fetchUfw, 1000);
        } catch (err) {
            setError("Failed to add rule: " + err);
            setLoading(false);
        }
    };

    const handleDeleteRule = async (id, target) => {
        if (!confirm(`Delete Rule [${id}] for ${target}?`)) return;
        setLoading(true);
        try {
            // Using --force to bypass confirmation prompt of ufw delete
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `sudo ufw --force delete ${id}`
            });
            setTimeout(fetchUfw, 1000);
        } catch (err) {
            setError("Failed to delete rule: " + err);
            setLoading(false);
        }
    };

    return (
        <div className="ufw-container">
            <div className="um-header">
                <div>
                    <h2>Firewall Manager (UFW)</h2>
                    <p className="um-subtitle">Secure your server gracefully</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {status !== 'error' && status !== 'checking' && (
                        <button
                            className={`um-action-btn ${status === 'active' ? 'danger' : 'success'}`}
                            onClick={toggleUfw}
                            disabled={loading}
                        >
                            {status === 'active' ? <ShieldAlert size={14} /> : <ShieldCheck size={14} />}
                            {status === 'active' ? 'Disable UFW' : 'Enable UFW'}
                        </button>
                    )}
                    <button className="um-action-btn" onClick={fetchUfw} disabled={loading}>
                        <RefreshCw size={14} className={loading && !isAdding ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {error && !missingUfw && (
                <div className="um-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {missingUfw ? (
                <div className="um-status-card" data-status="error">
                    <div className="um-status-icon" style={{ color: '#ef4444' }}>
                        <ShieldAlert size={28} />
                    </div>
                    <div className="um-status-text" style={{ flex: 1 }}>
                        <h3 style={{ color: '#ef4444' }}>UFW Not Installed</h3>
                        <p>UFW (Uncomplicated Firewall) is missing from the remote host.</p>

                        <button
                            style={{
                                marginTop: '16px',
                                background: '#3b82f6',
                                color: 'white',
                                border: 'none',
                                padding: '8px 16px',
                                borderRadius: '6px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 600
                            }}
                            onClick={handleInstallUfw}
                            disabled={installing}
                        >
                            {installing ? (
                                <><RefreshCw size={14} className="animate-spin" /> Installing... (This may take a minute)</>
                            ) : (
                                <><Download size={14} /> 1-Click Install UFW</>
                            )}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="um-status-card" data-status={status}>
                    <div className="um-status-icon">
                        <Shield size={28} />
                    </div>
                    <div className="um-status-text">
                        <h3>Firewall is {status.toUpperCase()}</h3>
                        {status === 'active' && <p>Incoming traffic is DENIED by default unless a rule allows it.</p>}
                        {status === 'inactive' && <p>All incoming traffic is ALLOWED. Your ports are exposed.</p>}
                        {status === 'checking' && <p>Querying firewall status...</p>}
                    </div>
                </div>
            )}

            {status === 'active' && (
                <>
                    <div className="um-controls">
                        <h3>Active Rules</h3>
                        <button className={`um-btn ${isAdding ? 'active' : ''}`} onClick={() => setIsAdding(!isAdding)}>
                            <Plus size={14} /> Add new rule
                        </button>
                    </div>

                    {isAdding && (
                        <div className="um-card" style={{ borderLeft: '3px solid #3b82f6', marginBottom: '20px' }}>
                            <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end' }}>
                                <div className="um-input-group" style={{ flex: 1 }}>
                                    <label>Action</label>
                                    <select className="um-input" value={newAction} onChange={e => setNewAction(e.target.value)}>
                                        <option value="allow">ALLOW</option>
                                        <option value="deny">DENY</option>
                                    </select>
                                </div>
                                <div className="um-input-group" style={{ flex: 2 }}>
                                    <label>Port or Service (e.g., 8080, http, OpenSSH)</label>
                                    <input
                                        className="um-input"
                                        type="text"
                                        placeholder="8080"
                                        value={newPort}
                                        onChange={e => setNewPort(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && handleAddRule()}
                                    />
                                </div>
                                <div className="um-input-group" style={{ flex: 1 }}>
                                    <label>Protocol</label>
                                    <select className="um-input" value={newProto} onChange={e => setNewProto(e.target.value)}>
                                        <option value="tcp">TCP</option>
                                        <option value="udp">UDP</option>
                                        <option value="any">Both / Any</option>
                                    </select>
                                </div>
                                <button className="um-btn primary" style={{ height: '39px', padding: '0 20px' }} onClick={handleAddRule} disabled={!newPort || loading}>
                                    Save
                                </button>
                            </div>
                        </div>
                    )}

                    <div className="um-card" style={{ padding: 0, overflow: 'hidden' }}>
                        {rules.length === 0 ? (
                            <div className="um-empty-state">
                                <Info size={24} />
                                <p>No rules defined. Beware: This might lock you out if SSH isn't allowed!</p>
                            </div>
                        ) : (
                            <table className="um-table">
                                <thead>
                                    <tr>
                                        <th width="50">ID</th>
                                        <th>Target Port/Service</th>
                                        <th>Action</th>
                                        <th>From Source</th>
                                        <th width="80" style={{ textAlign: 'right' }}>Manage</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rules.map(rule => (
                                        <tr key={rule.id}>
                                            <td className="um-mono" style={{ color: '#6b7280' }}>[{rule.id}]</td>
                                            <td className="um-mono" style={{ color: '#e5e7eb', fontWeight: 600 }}>{rule.target}</td>
                                            <td>
                                                <span className={`um-badge ${rule.action.includes('ALLOW') ? 'allow' : 'deny'}`}>
                                                    {rule.action}
                                                </span>
                                            </td>
                                            <td style={{ color: '#9ca3af' }}>{rule.from}</td>
                                            <td style={{ textAlign: 'right' }}>
                                                <button className="um-icon-btn danger" title="Delete Rule" onClick={() => handleDeleteRule(rule.id, rule.target)}>
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>
                </>
            )}
        </div>
    );
}
