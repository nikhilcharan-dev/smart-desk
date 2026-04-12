import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Zap, Play, Server, CheckSquare, Square, Loader2 } from "lucide-react";
import "./FleetRunner.css";

export default function FleetRunner() {
    const [profiles, setProfiles] = useState([]);
    const [selected, setSelected] = useState(new Set());
    const [command, setCommand] = useState("");
    const [results, setResults] = useState([]);
    const [running, setRunning] = useState(false);

    useEffect(() => {
        invoke("load_profiles").then(setProfiles).catch(() => {});
    }, []);

    const toggleServer = (id) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => setSelected(new Set(profiles.map(p => p.id)));
    const selectNone = () => setSelected(new Set());

    const runCommand = useCallback(async () => {
        if (!command.trim() || selected.size === 0) return;
        setRunning(true);
        setResults([]);
        try {
            const res = await invoke("fleet_run_command", {
                profileIds: Array.from(selected),
                command: command.trim(),
            });
            setResults(res);
        } catch (err) {
            setResults([{ profile_id: '', profile_name: 'Error', host: '', output: String(err), success: false, duration_ms: 0 }]);
        } finally {
            setRunning(false);
        }
    }, [command, selected]);

    return (
        <div className="fr-container">
            <div className="fr-header">
                <div>
                    <h2>Fleet Runner</h2>
                    <p className="fr-subtitle">Execute commands across multiple servers simultaneously</p>
                </div>
            </div>

            {/* Server selection */}
            <div className="fr-panel">
                <h3>Select Servers ({selected.size}/{profiles.length})</h3>
                {profiles.length === 0 ? (
                    <div className="fr-empty">
                        <Server size={28} opacity={0.4} />
                        <span>No saved profiles found. Add servers in the Connection Hub first.</span>
                    </div>
                ) : (
                    <>
                        <div className="fr-server-grid">
                            {profiles.map(p => (
                                <div
                                    key={p.id}
                                    className={`fr-server-chip ${selected.has(p.id) ? 'selected' : ''}`}
                                    onClick={() => toggleServer(p.id)}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selected.has(p.id)}
                                        onChange={() => toggleServer(p.id)}
                                        onClick={e => e.stopPropagation()}
                                    />
                                    <span className="fr-server-name">{p.name || `${p.user}@${p.ip}`}</span>
                                    <span className="fr-server-host">{p.user}@{p.ip}:{p.port}</span>
                                </div>
                            ))}
                        </div>
                        <div className="fr-select-actions">
                            <button className="fr-select-btn" onClick={selectAll}>Select All</button>
                            <button className="fr-select-btn" onClick={selectNone}>Deselect All</button>
                        </div>
                    </>
                )}
            </div>

            {/* Command input */}
            <div className="fr-cmd-bar">
                <input
                    className="fr-cmd-input"
                    placeholder="Enter command to run on all selected servers... (e.g. uptime, df -h, systemctl status nginx)"
                    value={command}
                    onChange={e => setCommand(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && runCommand()}
                    spellCheck={false}
                />
                <button className="fr-run-btn" onClick={runCommand} disabled={running || !command.trim() || selected.size === 0}>
                    {running ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                    {running ? `Running on ${selected.size} servers...` : `Run on ${selected.size} servers`}
                </button>
            </div>

            {/* Results */}
            {results.length > 0 && (
                <div className="fr-results">
                    {results.map((r, i) => (
                        <div key={i} className="fr-result-card">
                            <div className="fr-result-header">
                                <div className="fr-result-host">
                                    <span className={`fr-result-dot ${r.success ? 'success' : 'error'}`} />
                                    <span className="fr-result-name">{r.profile_name}</span>
                                </div>
                                <span className="fr-result-meta">
                                    {r.host} &middot; {r.duration_ms}ms
                                </span>
                            </div>
                            <div className="fr-result-output">{r.output || '(no output)'}</div>
                        </div>
                    ))}
                </div>
            )}

            {results.length === 0 && !running && (
                <div className="fr-empty">
                    <Zap size={32} opacity={0.3} />
                    <span>Select servers, enter a command, and hit Run</span>
                    <span style={{ fontSize: 11, color: '#374151' }}>Commands execute in parallel across all selected servers</span>
                </div>
            )}
        </div>
    );
}
