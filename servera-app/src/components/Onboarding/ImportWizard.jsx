import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileSearch, CheckCircle, AlertTriangle, Shield, Key, ChevronRight, ChevronLeft, Download, FolderOpen, Waypoints } from "lucide-react";
import "./ImportWizard.css";

export default function ImportWizard({ onComplete, onCancel, mode = "import", initialPath = null }) {
    const [step, setStep] = useState(1);
    const [detection, setDetection] = useState(null);
    const [entries, setEntries] = useState([]);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [result, setResult] = useState(null);

    useEffect(() => {
        if (step === 1) {
            if (initialPath) {
                const det = {
                    path: initialPath,
                    exists: true,
                    entry_count: "..."
                };
                setDetection(det);
                // Auto-trigger parse for manually selected files
                handleParse(det.path);
            } else {
                detectConfig();
            }
        }
    }, [step, initialPath]);

    const detectConfig = async () => {
        setLoading(true);
        try {
            const res = await invoke("detect_ssh_config_path");
            setDetection(res);
        } catch (err) {
            setError("Failed to detect SSH config: " + err);
        } finally {
            setLoading(false);
        }
    };

    const handleBrowse = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: false,
                filters: [{ name: "SSH Config", extensions: ["conf", "config", "*"] }]
            });
            if (selected) {
                setDetection({
                    path: selected,
                    exists: true,
                    entry_count: "..." // Will be determined on scan
                });
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleParse = async (overridePath = null) => {
        const targetPath = overridePath || detection?.path;
        if (!targetPath) return;

        setLoading(true);
        setError(null);
        try {
            const res = await invoke("parse_ssh_config", { path: targetPath });
            // Add unique ID for internal selection
            const entriesWithIds = res.map((e, idx) => ({ ...e, _id: idx }));
            setEntries(entriesWithIds);
            
            // Auto-select entries that have tunnel rules if in gateway mode
            if (mode === "gateway") {
                const tunnelEntries = entriesWithIds.filter(e => 
                    e.is_wireguard || (e.local_forwards?.length > 0 || e.remote_forwards?.length > 0)
                ).map(e => e._id);
                setSelectedIds(new Set(tunnelEntries));
            } else {
                setSelectedIds(new Set(entriesWithIds.filter(e => !e.is_wildcard).map(e => e._id)));
            }
            
            setStep(2);
        } catch (err) {
            setError("Failed to parse config: " + err);
        } finally {
            setLoading(false);
        }
    };

    const handleAction = async () => {
        setLoading(true);
        setError(null);
        try {
            const selected = entries.filter(e => selectedIds.has(e._id));
            
            if (mode === "gateway") {
                for (const entry of selected) {
                    try {
                        await invoke("start_tunnels_from_entry", { entry });
                    } catch (err) {
                        console.error("Failed to start tunnel for entry:", entry, err);
                    }
                }
                
                // Also save them as profiles
                await invoke("import_ssh_profiles", { entries: selected });
                
                setResult({
                    imported: selected.length,
                    skipped: 0,
                    type: 'gateways'
                });
            } else {
                const res = await invoke("import_ssh_profiles", { entries: selected });
                setResult(res);
            }
            setStep(3);
        } catch (err) {
            setError("Action failed: " + err);
        } finally {
            setLoading(false);
        }
    };

    const toggleSelection = (id) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const renderStep1 = () => (
        <div className="wizard-content">
            <div className="detection-card">
                <FileSearch size={48} color="#58a6ff" style={{ marginBottom: 16 }} />
                <h3>SSH Config Detected</h3>
                <p style={{ color: "#8b949e", marginTop: 8 }}>
                    We found an SSH config file on your system. Importing it will instantly add your server profiles to Servera.
                </p>
                <div className="path-preview-container">
                    <div className="path-preview">
                        {detection?.path || "Detecting..."}
                    </div>
                    <button className="browse-inline-btn" onClick={handleBrowse} title="Select manually">
                        <FolderOpen size={14} />
                        Choose manually
                    </button>
                </div>
                {detection?.exists ? (
                    <div style={{ fontSize: 13, color: "#3fb950", display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 12 }}>
                        <CheckCircle size={14} />
                        {detection.entry_count === "..." ? "Custom file selected" : `Found ${detection.entry_count} host definitions`}
                    </div>
                ) : (
                    <div style={{ fontSize: 13, color: "#f85149", marginTop: 12 }}>
                        Could not find config at default location.
                    </div>
                )}
            </div>
            
            <div className="wizard-actions">
                <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
                <button 
                    className="btn btn-primary" 
                    onClick={handleParse} 
                    disabled={loading || !detection?.exists}
                >
                    {loading ? "Parsing..." : "Scan Config File"}
                </button>
            </div>
        </div>
    );

    const renderStep2 = () => (
        <div className="wizard-content">
            <h3>{mode === 'gateway' ? 'Select Gateway Tunnels' : 'Select Profiles to Import'}</h3>
            <p style={{ color: "#8b949e", fontSize: 13, marginBottom: 16 }}>
                Choose which servers you want to {mode === 'gateway' ? 'establish tunnels for' : 'add to your dashboard'}.
            </p>

            <div className="config-table-container">
                <table className="config-table">
                    <thead>
                        <tr>
                            <th style={{ width: 40 }}>
                                <input 
                                    type="checkbox" 
                                    checked={selectedIds.size === entries.length}
                                    onChange={(e) => {
                                        if (e.target.checked) setSelectedIds(new Set(entries.map(en => en._id)));
                                        else setSelectedIds(new Set());
                                    }}
                                />
                            </th>
                            <th>Host</th>
                            <th>Hostname / IP</th>
                            <th>User</th>
                            <th>Tunnels</th>
                            <th>Auth</th>
                        </tr>
                    </thead>
                    <tbody>
                        {entries.map(entry => (
                            <tr key={entry._id} onClick={() => toggleSelection(entry._id)}>
                                <td>
                                    <input 
                                        type="checkbox" 
                                        checked={selectedIds.has(entry._id)}
                                        onChange={() => {}} // handled by row click
                                    />
                                </td>
                                <td>
                                    <div style={{ fontWeight: 600 }}>{entry.host_patterns.join(", ")}</div>
                                    {entry.is_match_block && (
                                        <div className="warning-row">
                                            <AlertTriangle size={10} /> Match block logic ignored
                                        </div>
                                    )}
                                </td>
                                <td>{entry.hostname || "---"}</td>
                                <td>{entry.user || "root"}</td>
                                <td>
                                    {entry.is_wireguard ? (
                                        <div className="tunnel-badge" style={{ borderColor: '#238636', background: 'rgba(35, 134, 54, 0.1)', color: '#3fb950' }}>
                                            <Shield size={10} /> WireGuard VPN
                                        </div>
                                    ) : (entry.local_forwards?.length > 0 || entry.remote_forwards?.length > 0) ? (
                                        <div className="tunnel-badge">
                                            <Waypoints size={10} />
                                            {entry.local_forwards.length + entry.remote_forwards.length} rules
                                        </div>
                                    ) : (
                                        <span style={{ color: '#484f58', fontSize: 11 }}>None</span>
                                    )}
                                </td>
                                <td>
                                    {entry.identity_files.length > 0 ? (
                                        <div className="auth-badge">
                                            <Key size={10} /> Key
                                        </div>
                                    ) : (
                                        <div className="auth-badge">
                                            <Shield size={10} /> Password
                                        </div>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            <div className="wizard-actions">
                <button className="btn btn-secondary" onClick={() => setStep(1)}><ChevronLeft size={16} /> Back</button>
                <div style={{ flex: 1 }}></div>
                <button 
                    className="btn btn-primary" 
                    onClick={handleAction}
                    disabled={loading || selectedIds.size === 0}
                >
                    {loading ? "Processing..." : (mode === 'gateway' ? `Start ${selectedIds.size} Gateway Tunnels` : `Import ${selectedIds.size} Profiles`)}
                </button>
            </div>
        </div>
    );

    const renderStep3 = () => (
        <div className="wizard-content">
            <div className="import-summary">
                <div className="success-icon">
                    <CheckCircle size={64} />
                </div>
                <h2>{result?.type === 'gateways' ? 'Gateways Established!' : 'Import Successful!'}</h2>
                <p style={{ color: "#8b949e", marginTop: 12 }}>
                    {result?.type === 'gateways' ? (
                        <>Successfully established <strong>{result.imported}</strong> SSH tunnels.</>
                    ) : (
                        <>
                            Successfully imported <strong>{result?.imported}</strong> profiles.
                            {result?.skipped > 0 && ` ${result.skipped} profiles were skipped as duplicates.`}
                        </>
                    )}
                </p>
                
                <div style={{ marginTop: 32, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    <button className="btn btn-primary" onClick={onComplete}>
                        {result?.type === 'gateways' ? 'View Gateways' : 'Go to Dashboard'}
                    </button>
                    <button className="btn btn-secondary" onClick={onCancel}>Close</button>
                </div>
            </div>
        </div>
    );

    return (
        <div className="import-wizard">
            <div className="wizard-steps">
                <div className={`step-indicator ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>1</div>
                <div className={`step-indicator ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>2</div>
                <div className={`step-indicator ${step >= 3 ? 'active' : ''}`}>3</div>
            </div>

            {error && (
                <div style={{ background: "#f8514920", border: "1px solid #f85149", padding: 12, borderRadius: 6, color: "#f85149", fontSize: 13, marginBottom: 20 }}>
                    {error}
                </div>
            )}

            {step === 1 && renderStep1()}
            {step === 2 && renderStep2()}
            {step === 3 && renderStep3()}
        </div>
    );
}
