import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Wifi, WifiOff, Shield, KeyRound, Search, Settings } from "lucide-react";
import "./TopBar.css";

const WG_STATUS_LABELS = {
    starting: "Starting…",
    running: "Connected (waiting for traffic)",
    active: "Active",
    restarting: "Restarting…",
    error: "Error",
};

// macOS/mobile-style Control Center: a WiFi-shaped icon in the top-right
// that reflects the active WireGuard gateway's live status, and opens a
// popover to switch gateways on/off without leaving whatever view is open.
export default function TopBar({
    ip,
    user,
    profileName,
    onOpenVault,
    onOpenCmd,
    onOpenSettings,
    isSettingsActive,
}) {
    const [profiles, setProfiles] = useState([]);
    const [wgStatus, setWgStatus] = useState(null); // null = no active gateway
    const [open, setOpen] = useState(false);
    const [busyId, setBusyId] = useState(null);
    const [error, setError] = useState(null);
    const anchorRef = useRef(null);

    const loadProfiles = useCallback(async () => {
        try {
            const list = await invoke("load_profiles");
            setProfiles(list || []);
        } catch { /* ignore */ }
    }, []);

    const loadStatus = useCallback(async () => {
        try {
            const status = await invoke("get_wireguard_status");
            setWgStatus(status || null);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => { loadProfiles(); loadStatus(); }, [loadProfiles, loadStatus]);

    useEffect(() => {
        let unlisten;
        listen("tunnel-status", (e) => {
            if (e.payload?.type !== "wireguard") return;
            setWgStatus(e.payload.status === "stopped" ? null : e.payload);
        }).then(fn => (unlisten = fn));
        return () => { if (unlisten) unlisten(); };
    }, []);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => {
            if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [open]);

    const gateways = profiles.filter(p => p.wg_config);
    const status = wgStatus?.status || null;
    const iconClass = !status ? "" : status === "error" ? "error" : status === "active" ? "connected" : "connecting";

    const handleToggle = async (profile) => {
        setBusyId(profile.id);
        setError(null);
        try {
            if (wgStatus?.profileId === profile.id) {
                await invoke("stop_wireguard_gateway");
                setWgStatus(null);
            } else {
                const started = await invoke("start_gateway_from_profile", { profileId: profile.id });
                setWgStatus(started);
            }
        } catch (err) {
            setError(String(err));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="topbar">
            <div className="topbar-left">
                {(ip || profileName) && (
                    <span className="topbar-conn">
                        {profileName || `${user}@${ip}`}
                    </span>
                )}
            </div>
            <div className="topbar-right" ref={anchorRef}>
                {onOpenCmd && (
                    <button
                        className="topbar-cmd-btn"
                        onClick={onOpenCmd}
                        title="Command Palette (Ctrl+K)"
                    >
                        <Search size={13} />
                        <span className="topbar-cmd-text">Commands</span>
                        <kbd className="topbar-cmd-kbd">Ctrl+K</kbd>
                    </button>
                )}

                <div className="topbar-divider" />

                {onOpenVault && (
                    <button
                        className="topbar-icon-btn"
                        onClick={onOpenVault}
                        title="Secrets Vault (Alt+V) — Quick Copy"
                    >
                        <KeyRound size={15} />
                    </button>
                )}

                <button
                    className={`topbar-icon-btn ${iconClass}`}
                    onClick={() => setOpen(p => !p)}
                    title={status ? `WireGuard: ${WG_STATUS_LABELS[status] || status}` : "WireGuard: Off"}
                >
                    {status && status !== "error" ? <Wifi size={15} /> : <WifiOff size={15} />}
                </button>

                {onOpenSettings && (
                    <button
                        className={`topbar-icon-btn ${isSettingsActive ? "active" : ""}`}
                        onClick={onOpenSettings}
                        title="Settings & Tools"
                    >
                        <Settings size={15} />
                    </button>
                )}
                {open && (
                    <div className="topbar-popover">
                        <div className="topbar-popover-title">
                            <Shield size={13} /> WireGuard Gateways
                        </div>
                        {gateways.length === 0 ? (
                            <div className="topbar-popover-empty">
                                No gateway profiles yet — import a .conf from the Gateways tab.
                            </div>
                        ) : (
                            <div className="topbar-popover-list">
                                {gateways.map(g => {
                                    const live = wgStatus?.profileId === g.id ? wgStatus : null;
                                    const label = live ? (WG_STATUS_LABELS[live.status] || live.status) : "Off";
                                    return (
                                        <button
                                            key={g.id}
                                            className={`topbar-gw-row ${live ? "active" : ""}`}
                                            onClick={() => handleToggle(g)}
                                            disabled={busyId === g.id}
                                        >
                                            <span className={`topbar-gw-dot ${live?.status === "error" ? "error" : live ? "on" : ""}`} />
                                            <span className="topbar-gw-name">{g.name}</span>
                                            <span className="topbar-gw-status">{busyId === g.id ? "…" : label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                        {error && <div className="topbar-popover-error">{error}</div>}
                    </div>
                )}
            </div>
        </div>
    );
}
