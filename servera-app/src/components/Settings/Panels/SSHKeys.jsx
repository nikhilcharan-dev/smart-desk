import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Key, Plus, Trash2, RefreshCw, AlertCircle, CheckCircle2, Copy } from "lucide-react";
import { MAIN_SESSION_ID } from "../../../utils/terminal";
import { formatRemoteError } from "../../../utils/errors";
import "./SettingsPanels.css";

export default function SSHKeys() {
    const [keys, setKeys] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [newKey, setNewKey] = useState("");
    const [addStatus, setAddStatus] = useState(null); // { type: 'success' | 'error', msg: string }

    const fetchKeys = async () => {
        setLoading(true);
        setError(null);
        try {
            // First ensure the file exists so cat doesn't fail catastrophically
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
            });

            const rawKeys = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "cat ~/.ssh/authorized_keys"
            });

            // Parse keys into objects
            const parsed = rawKeys.split('\n')
                .filter(line => line.trim() && !line.trim().startsWith('#'))
                .map((line, index) => {
                    const parts = line.split(' ');
                    const type = parts[0] || "Unknown";
                    const keyData = parts[1] || "";
                    const comment = parts.slice(2).join(' ') || "No comment";

                    // Create a short preview of the key data for display
                    const preview = keyData.length > 20
                        ? `${keyData.substring(0, 10)}...${keyData.substring(keyData.length - 10)}`
                        : keyData;

                    return { id: index, raw: line, type, preview, comment };
                });

            setKeys(parsed);
        } catch (err) {
            setError(formatRemoteError(err, "Reading authorized_keys"));
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchKeys();
    }, []);

    const handleAddKey = async () => {
        const key = newKey.trim();
        if (!key) return;

        // Validate the shape before it ever reaches a shell — a public key has a
        // known grammar, so reject anything that doesn't match rather than only
        // escaping. This blocks command injection at the source.
        if (!/^(ssh-(rsa|ed25519|dss)|ecdsa-sha2-nistp(256|384|521))\s+[A-Za-z0-9+/]+={0,3}(\s+\S.*)?$/.test(key)) {
            setAddStatus({ type: 'error', msg: 'Not a valid OpenSSH public key.' });
            return;
        }

        setLoading(true);
        setAddStatus(null);
        try {
            // Escape single quotes (the shell single-quote idiom) and ensure the
            // ~/.ssh dir exists with correct perms before appending.
            const safeKey = key.replace(/'/g, "'\\''");
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `mkdir -p ~/.ssh && chmod 700 ~/.ssh && echo '${safeKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
            });
            setAddStatus({ type: 'success', msg: 'Key added successfully' });
            setNewKey("");
            fetchKeys();
        } catch (err) {
            setAddStatus({ type: 'error', msg: formatRemoteError(err, "Adding the key") });
            setLoading(false);
        }
    };

    const handleRemoveKey = async (rawKey) => {
        if (!confirm("Are you sure you want to remove this public key?")) return;

        setLoading(true);
        try {
            // Using sed to delete the specific line matching this EXACT key string
            // We use awk/grep logic or exact matching carefully to avoid accidental deletions
            // The safest generic way is to backup the file, grep -v the exact key, and overwrite
            const safeKey = rawKey.replace(/'/g, "'\\''"); // Escape single quotes for bash
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `grep -vF '${safeKey}' ~/.ssh/authorized_keys > ~/.ssh/authorized_keys.tmp && mv ~/.ssh/authorized_keys.tmp ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`
            });
            fetchKeys();
        } catch (err) {
            setError(formatRemoteError(err, "Removing the key"));
            setLoading(false);
        }
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="sh-panel">
            <div className="sh-panel-header">
                <div>
                    <h2>SSH Authorized Keys</h2>
                    <p className="sh-panel-subtitle">Manage public keys allowed to connect to this server</p>
                </div>
                <button className="sh-action-btn" onClick={fetchKeys} disabled={loading}>
                    <RefreshCw size={14} className={loading && !newKey ? "animate-spin" : ""} />
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
                <h3>Add New Public Key</h3>
                <div className="sh-input-group row">
                    <input
                        type="text"
                        placeholder="ssh-rsa AAAAB3NzaC1yc... user@machine"
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        className="sh-input"
                        onKeyDown={(e) => e.key === 'Enter' && handleAddKey()}
                    />
                    <button className="sh-btn primary" onClick={handleAddKey} disabled={!newKey.trim() || loading}>
                        <Plus size={14} /> Add
                    </button>
                </div>
                {addStatus && (
                    <div className={`sh-status-message ${addStatus.type}`}>
                        {addStatus.type === 'success' ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                        <span>{addStatus.msg}</span>
                    </div>
                )}
            </div>

            <div className="sh-card">
                <div className="sh-card-header">
                    <h3>Active Keys ({keys.length})</h3>
                </div>

                {keys.length === 0 && !loading ? (
                    <div className="sh-empty-state">
                        <Key size={32} opacity={0.5} />
                        <p>No authorized keys found (or file is empty).</p>
                    </div>
                ) : (
                    <div className="sh-list">
                        {keys.map((key) => (
                            <div key={key.id} className="sh-list-item">
                                <div className="sh-list-icon">
                                    <Key size={16} />
                                </div>
                                <div className="sh-list-content">
                                    <div className="sh-list-title">{key.comment}</div>
                                    <div className="sh-list-desc">
                                        <span className="sh-badge">{key.type}</span>
                                        <span className="sh-mono">{key.preview}</span>
                                    </div>
                                </div>
                                <div className="sh-list-actions">
                                    <button className="sh-icon-btn" title="Copy Raw Key" onClick={() => copyToClipboard(key.raw)}>
                                        <Copy size={14} />
                                    </button>
                                    <button className="sh-icon-btn danger" title="Remove Key" onClick={() => handleRemoveKey(key.raw)}>
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
