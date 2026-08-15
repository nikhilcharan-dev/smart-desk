import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Database, Plus, RefreshCw, AlertCircle, Save, Variable } from "lucide-react";
import { MAIN_SESSION_ID } from "../../../utils/terminal";
import "./SettingsPanels.css";

export default function EnvManager() {
    const [envVars, setEnvVars] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [searchQuery, setSearchQuery] = useState("");

    const [isCreating, setIsCreating] = useState(false);
    const [newKey, setNewKey] = useState("");
    const [newValue, setNewValue] = useState("");

    const fetchEnvVars = async () => {
        setLoading(true);
        setError(null);
        try {
            // Getting a clean list of environment variables
            const rawEnv = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "printenv"
            });

            const parsed = rawEnv.split('\n')
                .filter(line => line.includes('='))
                .map((line, index) => {
                    const firstEq = line.indexOf('=');
                    const key = line.substring(0, firstEq);
                    const value = line.substring(firstEq + 1);
                    return { id: index, key, value };
                })
                // Sort alphabetically by key
                .sort((a, b) => a.key.localeCompare(b.key));

            setEnvVars(parsed);
        } catch (err) {
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchEnvVars();
    }, []);

    const handleAddEnv = async () => {
        if (!newKey.trim() || !newValue.trim()) return;
        // Wrap an arbitrary string as a single-quoted shell token — the only
        // context where $, backticks and quotes are all inert.
        const sq = (s) => `'${s.replace(/'/g, "'\\''")}'`;
        const safeKey = newKey.replace(/[^a-zA-Z0-9_]/g, ''); // POSIX-valid name only
        if (!safeKey) {
            setError("Variable name must contain only letters, digits or underscores.");
            return;
        }

        setLoading(true);
        try {
            // Build the exact line to append, with the value single-quoted, then
            // single-quote the whole line for the shell. No double-quote layer
            // means no expansion of $ / backticks in a user-supplied value.
            const line = `export ${safeKey}=${sq(newValue)}`;
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: `printf '%s\\n' ${sq(line)} >> ~/.bashrc`
            });

            setIsCreating(false);
            setNewKey("");
            setNewValue("");

            // To show it immediately, we might not see it via standard printenv since it runs non-interactive
            // Let's manually inject it into our view state to simulate the update
            setEnvVars(prev => {
                const updated = [...prev, { id: Date.now(), key: safeKey, value: newValue }];
                return updated.sort((a, b) => a.key.localeCompare(b.key));
            });

            alert(`Added export ${safeKey} to ~/.bashrc. Note: This will only affect new SSH sessions.`);
        } catch (err) {
            setError("Failed to add environment variable: " + err);
        } finally {
            setLoading(false);
        }
    };

    const filteredVars = envVars.filter(ev =>
        ev.key.toLowerCase().includes(searchQuery.toLowerCase()) ||
        ev.value.toLowerCase().includes(searchQuery.toLowerCase())
    );

    return (
        <div className="sh-panel">
            <div className="sh-panel-header">
                <div>
                    <h2>Environment Variables</h2>
                    <p className="sh-panel-subtitle">View active environment variables and inject new ones into ~/.bashrc</p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className={`sh-action-btn ${isCreating ? 'active' : ''}`} onClick={() => setIsCreating(!isCreating)}>
                        <Plus size={14} /> New Export
                    </button>
                    <button className="sh-action-btn" onClick={fetchEnvVars} disabled={loading}>
                        <RefreshCw size={14} className={loading && !isCreating ? "animate-spin" : ""} />
                        Refresh
                    </button>
                </div>
            </div>

            {error && (
                <div className="sh-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {isCreating && (
                <div className="sh-card" style={{ borderLeft: '3px solid #3b82f6' }}>
                    <h3>Add Global Env Variable</h3>
                    <p style={{ fontSize: '12px', color: '#9ca3af', marginBottom: '16px', marginTop: '-8px' }}>
                        This will append an `export KEY="VALUE"` statement to the remote user's <span className="sh-mono">~/.bashrc</span>.
                    </p>

                    <div style={{ display: 'flex', gap: '16px' }}>
                        <div className="sh-input-group" style={{ flex: 1 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>KEY (e.g. NODE_ENV)</label>
                            <input
                                className="sh-input"
                                style={{ fontFamily: 'monospace' }}
                                value={newKey}
                                onChange={e => setNewKey(e.target.value.toUpperCase())}
                                placeholder="APP_SECRET_KEY"
                            />
                        </div>
                        <div className="sh-input-group" style={{ flex: 2 }}>
                            <label style={{ fontSize: '11px', color: '#9ca3af', marginBottom: '-4px' }}>VALUE</label>
                            <input
                                className="sh-input"
                                style={{ fontFamily: 'monospace' }}
                                value={newValue}
                                onChange={e => setNewValue(e.target.value)}
                                placeholder="my-secret-value-123"
                            />
                        </div>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', marginTop: '16px' }}>
                        <button className="sh-btn" onClick={() => setIsCreating(false)}>Cancel</button>
                        <button className="sh-btn primary" onClick={handleAddEnv} disabled={!newKey || !newValue || loading}>
                            <Save size={14} /> Inject to .bashrc
                        </button>
                    </div>
                </div>
            )}

            <div className="sh-card">
                <div className="sh-card-header">
                    <h3>Active Variables ({filteredVars.length})</h3>
                    <div className="sh-input-group row" style={{ margin: 0, width: '250px' }}>
                        <input
                            className="sh-input"
                            placeholder="Search vars..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            style={{ padding: '6px 12px' }}
                        />
                    </div>
                </div>

                {filteredVars.length === 0 && !loading ? (
                    <div className="sh-empty-state">
                        <Variable size={32} opacity={0.5} />
                        <p>No environment variables found matching your search.</p>
                    </div>
                ) : (
                    <div className="sh-list" style={{ maxHeight: '500px' }}>
                        {filteredVars.map((ev) => (
                            <div key={ev.id} className="sh-list-item" style={{ padding: '8px 16px' }}>
                                <div className="sh-list-content" style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                                    <div className="sh-list-title" style={{ width: '25%', flexShrink: 0, marginBottom: 0, color: '#f3f4f6' }}>
                                        {ev.key}
                                    </div>
                                    <div className="sh-list-desc" style={{ flex: 1, overflow: 'hidden' }}>
                                        <span className="sh-mono" style={{ color: '#9ca3af', wordBreak: 'break-all', whiteSpace: 'normal', display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical' }}>
                                            {ev.value}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
