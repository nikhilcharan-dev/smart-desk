import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PackageOpen, DownloadCloud, CheckCircle2, AlertCircle, RefreshCw, TerminalSquare, X } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./PackageManager.css";

export default function PackageManager() {
    const [managerInfo, setManagerInfo] = useState({ name: "Package Manager", has_manager: true });
    const [packages, setPackages] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [statusText, setStatusText] = useState("Checking for updates...");

    // Live update terminal state
    const [isUpdating, setIsUpdating] = useState(false);
    const [updateLog, setUpdateLog] = useState("");
    const logEndRef = useRef(null);

    // Only check if we haven't already
    const [hasChecked, setHasChecked] = useState(false);

    const fetchUpdates = async () => {
        setLoading(true);
        setError(null);
        setPackages([]);
        setStatusText("Detecting OS and checking for updates...");

        try {
            // 1. Get Metadata
            const meta = await invoke("get_system_metadata", { sessionId: MAIN_SESSION_ID });
            setManagerInfo(meta);

            if (!meta.has_manager) {
                setError("No supported package manager detected on this OS. This feature supports Debian (APT), RHEL/CentOS (YUM/DNF), and Arch (Pacman).");
                setLoading(false);
                return;
            }

            setStatusText(`Refreshing ${meta.manager} repositories...`);

            // 2. Fetch updates (Backend handles refresh + list + parse)
            const updates = await invoke("get_package_updates", { sessionId: MAIN_SESSION_ID });

            setPackages(updates);
            setStatusText(updates.length > 0 ? `${updates.length} packages can be upgraded via ${meta.manager}.` : "System is fully up to date! 🎉");
            setHasChecked(true);

        } catch (err) {
            setError(err.toString());
            setStatusText("Failed to check for updates.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!hasChecked) {
            fetchUpdates();
        }
    }, [hasChecked]);

    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [updateLog]);

    const performUpgrade = async () => {
        if (!confirm(`This will perform a system upgrade using ${managerInfo.manager}. Do you want to proceed?`)) return;

        setIsUpdating(true);
        setUpdateLog(`> Executing upgrade via ${managerInfo.manager}...\n\n`);

        try {
            setUpdateLog(prev => prev + "Contacting remote host... This may take several minutes.\n");

            const result = await invoke("perform_package_upgrade", {
                sessionId: MAIN_SESSION_ID
            });

            setUpdateLog(prev => prev + "\n" + result + "\n\n> Upgrade completed successfully 🎉");

            // Refresh list behind the scenes
            await fetchUpdates();

        } catch (err) {
            setUpdateLog(prev => prev + "\n" + "ERROR OCCURRED:\n" + err);
        }
    };

    return (
        <div className="pm-container">
            <div className="pm-header">
                <div>
                    <h2>{managerInfo.name}</h2>
                    <p className="pm-subtitle">Keep your remote server secure and patched</p>
                </div>
                <button className="pm-action-btn" onClick={fetchUpdates} disabled={loading || isUpdating}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    {hasChecked ? "Check Again" : "Check for Updates"}
                </button>
            </div>

            {error && (
                <div className="pm-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {!error && (
                <div className="pm-hero-card" data-has-updates={packages.length > 0}>
                    <div className="pm-hero-icon">
                        {loading ? <RefreshCw size={32} className="animate-spin" /> :
                            packages.length > 0 ? <DownloadCloud size={32} /> : <CheckCircle2 size={32} />}
                    </div>
                    <div className="pm-hero-content">
                        <h3>{statusText}</h3>
                        {packages.length > 0 && !isUpdating && (
                            <p>It is recommended to apply security patches regularly to prevent vulnerabilities.</p>
                        )}
                        {!loading && packages.length > 0 && !isUpdating && (
                            <button className="pm-upgrade-btn" onClick={performUpgrade}>
                                <TerminalSquare size={16} />
                                Upgrade {packages.length} Packages Now
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Terminal Overlay during upgrades */}
            {isUpdating && (
                <div className="pm-terminal-overlay">
                    <div className="pm-terminal-header">
                        <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'JetBrains Mono', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TerminalSquare size={14} color="#10b981" /> upgrade execution log
                        </span>
                        <button className="pm-close-btn" onClick={() => setIsUpdating(false)} title="Close log">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="pm-terminal-body">
                        {updateLog}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}

            {!isUpdating && packages.length > 0 && (
                <div className="pm-card">
                    <div className="pm-card-header">
                        <h3>Pending Upgrades ({packages.length})</h3>
                    </div>
                    <div className="pm-list">
                        {packages.map((pkg, idx) => (
                            <div key={`${pkg.name}-${idx}`} className="pm-list-item">
                                <div className="pm-pkg-icon">
                                    <PackageOpen size={20} />
                                </div>
                                <div className="pm-pkg-info">
                                    <div className="pm-pkg-name">{pkg.name}</div>
                                    <div className="pm-pkg-versions">
                                        <span className="pm-v-old">{pkg.old_version}</span>
                                        <span style={{ color: '#6b7280' }}>→</span>
                                        <span className="pm-v-new">{pkg.new_version}</span>
                                    </div>
                                    <div className="pm-pkg-source">Repo: {pkg.source} • Arch: {pkg.arch}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
