import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PackageOpen, DownloadCloud, CheckCircle2, AlertCircle, RefreshCw, TerminalSquare, X } from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./AptManager.css";

export default function AptManager() {
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
        setStatusText("Syncing package lists (apt-get update)...");

        try {
            // 1. Check if apt exists
            const hasApt = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "command -v apt-get || echo 'missing'"
            });

            if (hasApt.trim() === 'missing') {
                setError("APT Package Manager is not installed on this OS. This feature only supports Debian/Ubuntu based distros.");
                setLoading(false);
                return;
            }

            // 2. Perform silent update to refresh lists
            await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "sudo apt-get update -qq"
            });

            setStatusText("Calculating upgradable packages...");

            // 3. List upgradable
            const rawOutput = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "apt list --upgradable 2>/dev/null"
            });

            // Parse output:
            // Listing... Done
            // base-files/jammy-updates 12ubuntu4.8 amd64 [upgradable from: 12ubuntu4.7]
            // curl/jammy-updates,jammy-security 7.81.0-1ubuntu1.20 amd64 [upgradable from: 7.81.0-1ubuntu1.19]

            const lines = rawOutput.split('\n').filter(l => l.includes('[upgradable from:'));
            const parsedPkgs = lines.map((line, idx) => {
                // e.g. "curl/jammy-updates,jammy-security 7.81.0-1ubuntu1.20 amd64 [upgradable from: 7.81.0-1ubuntu1.19]"
                const parts = line.split(' ');
                const nameSource = parts[0];
                const newVer = parts[1];
                const arch = parts[2];
                // Extract old version from brackets
                const match = line.match(/\[upgradable from:\s+(.*)\]/);
                const oldVer = match ? match[1] : "unknown";

                const [name, source] = nameSource.split('/');

                return {
                    id: idx,
                    name,
                    source: source || "unknown",
                    newVer,
                    oldVer,
                    arch,
                    raw: line
                };
            });

            setPackages(parsedPkgs);
            setStatusText(parsedPkgs.length > 0 ? `${parsedPkgs.length} packages can be upgraded.` : "System is fully up to date! 🎉");
            setHasChecked(true);

        } catch (err) {
            setError(err.toString());
            setStatusText("Failed to check for updates.");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        // Auto-fetch on mount if not checked
        if (!hasChecked) {
            fetchUpdates();
        }
    }, [hasChecked]);

    // Scroll to bottom of logs when they update
    useEffect(() => {
        if (logEndRef.current) {
            logEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [updateLog]);

    const performUpgrade = async () => {
        if (!confirm("This will run 'sudo apt-get upgrade -y'. Do you want to proceed?")) return;

        setIsUpdating(true);
        setUpdateLog("> sudo apt-get update && sudo apt-get upgrade -y\n\n");

        try {
            // Note: Ideally, we would stream this output in real-time.
            // Since `exec_ssh_command` waits for the command to finish, 
            // we will simulate the streaming by taking the result at the end,
            // or we could chunk it if we modify the backend.
            // For now, we wait for the full upgrade to complete.

            setUpdateLog(prev => prev + "Executing upgrade on remote host... This may take several minutes. Please do not close the app.\n");

            const result = await invoke("exec_ssh_command", {
                sessionId: MAIN_SESSION_ID,
                command: "sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y"
            });

            setUpdateLog(prev => prev + "\n" + result + "\n\n> Upgrade completed successfully 🎉");

            // Refresh list behind the scenes
            await fetchUpdates();

        } catch (err) {
            setUpdateLog(prev => prev + "\n" + "ERROR OCCURRED:\n" + err);
        }
    };

    return (
        <div className="apt-container">
            <div className="am-header">
                <div>
                    <h2>System Updates (APT)</h2>
                    <p className="am-subtitle">Keep your Debian/Ubuntu server secure and patched</p>
                </div>
                <button className="am-action-btn" onClick={fetchUpdates} disabled={loading || isUpdating}>
                    <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
                    {hasChecked ? "Check Again" : "Check for Updates"}
                </button>
            </div>

            {error && (
                <div className="am-alert error">
                    <AlertCircle size={16} />
                    <span>{error}</span>
                </div>
            )}

            {!error && (
                <div className="am-hero-card" data-has-updates={packages.length > 0}>
                    <div className="am-hero-icon">
                        {loading ? <RefreshCw size={32} className="animate-spin" /> :
                            packages.length > 0 ? <DownloadCloud size={32} /> : <CheckCircle2 size={32} />}
                    </div>
                    <div className="am-hero-content">
                        <h3>{statusText}</h3>
                        {packages.length > 0 && !isUpdating && (
                            <p>It is recommended to apply security patches regularly to prevent vulnerabilities.</p>
                        )}
                        {!loading && packages.length > 0 && !isUpdating && (
                            <button className="am-upgrade-btn" onClick={performUpgrade}>
                                <TerminalSquare size={16} />
                                Upgrade {packages.length} Packages Now
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Terminal Overlay during upgrades */}
            {isUpdating && (
                <div className="am-terminal-overlay">
                    <div className="am-terminal-header">
                        <span style={{ fontSize: '13px', fontWeight: 600, fontFamily: 'JetBrains Mono', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <TerminalSquare size={14} color="#10b981" /> apt-get upgrade execution log
                        </span>
                        <button className="am-close-btn" onClick={() => setIsUpdating(false)} title="Close log">
                            <X size={16} />
                        </button>
                    </div>
                    <div className="am-terminal-body">
                        {updateLog}
                        <div ref={logEndRef} />
                    </div>
                </div>
            )}

            {!isUpdating && packages.length > 0 && (
                <div className="am-card">
                    <div className="am-card-header">
                        <h3>Pending Upgrades ({packages.length})</h3>
                    </div>
                    <div className="am-list">
                        {packages.map(pkg => (
                            <div key={pkg.id} className="am-list-item">
                                <div className="am-pkg-icon">
                                    <PackageOpen size={20} />
                                </div>
                                <div className="am-pkg-info">
                                    <div className="am-pkg-name">{pkg.name}</div>
                                    <div className="am-pkg-versions">
                                        <span className="am-v-old">{pkg.oldVer}</span>
                                        <span style={{ color: '#6b7280' }}>→</span>
                                        <span className="am-v-new">{pkg.newVer}</span>
                                    </div>
                                    <div className="am-pkg-source">Repo: {pkg.source} • Arch: {pkg.arch}</div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
