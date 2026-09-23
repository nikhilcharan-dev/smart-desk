import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Wifi, WifiOff, Shield, KeyRound, Search, Settings } from "lucide-react";
import WindowControls from "../Common/WindowControls";
import "./TopBar.css";

const WG_STATUS_LABELS = {
    starting: "Starting…",
    running: "Connected",
    active: "Active",
    restarting: "Restarting…",
    error: "Error",
};

// macOS/mobile-style Control Center: a WiFi-shaped icon in the top-right
// that reflects the active gateway's live status, and opens a
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
    const [wgStatus, setWgStatus] = useState(null); // null = no active wireguard gateway
    const [tunnels, setTunnels] = useState([]);
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

    const loadTunnels = useCallback(async () => {
        try {
            const list = await invoke("get_active_tunnels");
            setTunnels(list || []);
        } catch { /* ignore */ }
    }, []);

    const refreshAll = useCallback(() => {
        loadProfiles();
        loadStatus();
        loadTunnels();
    }, [loadProfiles, loadStatus, loadTunnels]);

    useEffect(() => {
        refreshAll();
    }, [refreshAll]);

    useEffect(() => {
        if (open) {
            refreshAll();
        }
    }, [open, refreshAll]);

    useEffect(() => {
        let unlisten;
        listen("tunnel-status", (e) => {
            if (e.payload?.type !== "wireguard") return;
            setWgStatus(e.payload.status === "stopped" ? null : e.payload);
            loadTunnels();
        }).then(fn => (unlisten = fn));
        return () => { if (unlisten) unlisten(); };
    }, [loadTunnels]);

    useEffect(() => {
        if (!open) return;
        const onClick = (e) => {
            if (anchorRef.current && !anchorRef.current.contains(e.target)) setOpen(false);
        };
        document.addEventListener("mousedown", onClick);
        return () => document.removeEventListener("mousedown", onClick);
    }, [open]);

    const gateways = profiles.filter(p => p.wg_config || p.tags?.includes("gateway"));

    const isGatewayActive = useCallback((g) => {
        if (g.wg_config) {
            const matchesId = wgStatus?.profileId === g.id;
            const matchesEndpoint = wgStatus?.endpoint && g.wg_config?.endpoint && wgStatus.endpoint === g.wg_config.endpoint;
            return !!(wgStatus && (matchesId || matchesEndpoint) && wgStatus.status !== "stopped" && wgStatus.status !== "error");
        }
        return tunnels.some(t => t.id.includes(g.ip) || (g.id && t.id.includes(g.id)));
    }, [wgStatus, tunnels]);

    const isAnyWgActive = wgStatus && wgStatus.status !== "stopped" && wgStatus.status !== "error";
    const isAnySshActive = tunnels.some(t => !t.id.startsWith("wg-"));
    const isAnyActive = isAnyWgActive || isAnySshActive;

    const status = wgStatus?.status || null;
    const iconClass = status === "error"
        ? "error"
        : isAnyActive
            ? (status === "starting" || status === "restarting" ? "connecting" : "connected")
            : "";

    const handleToggle = async (profile) => {
        setBusyId(profile.id);
        setError(null);
        const active = isGatewayActive(profile);
        try {
            if (active) {
                await invoke("stop_all_tunnels");
                setWgStatus(null);
                setTunnels([]);
            } else {
                await invoke("start_gateway_from_profile", { profileId: profile.id });
            }
            await loadStatus();
            await loadTunnels();
        } catch (err) {
            setError(String(err));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="topbar" data-tauri-drag-region>
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
                    className={`topbar-icon-btn ${open ? "active" : ""} ${iconClass}`}
                    onClick={() => setOpen(p => !p)}
                    title={
                        status && status !== "stopped"
                            ? `WireGuard: ${WG_STATUS_LABELS[status] || status}`
                            : isAnySshActive
                                ? "SSH Gateway: Active"
                                : "Gateways: Off"
                    }
                >
                    {isAnyActive && status !== "error" ? <Wifi size={15} /> : <WifiOff size={15} />}
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

                <div className="topbar-divider" />
                <WindowControls />

                {open && (
                    <div className="topbar-popover">
                        <div className="topbar-popover-title">
                            <Shield size={13} /> Gateways & Tunnels
                        </div>
                        {gateways.length === 0 ? (
                            <div className="topbar-popover-empty">
                                No gateway profiles yet — import or configure a gateway from the Gateways tab.
                            </div>
                        ) : (
                            <div className="topbar-popover-list">
                                {gateways.map(g => {
                                    const isWg = !!g.wg_config;
                                    const isLiveWg = isWg && (wgStatus?.profileId === g.id || (wgStatus?.endpoint && g.wg_config?.endpoint && wgStatus.endpoint === g.wg_config.endpoint));
                                    const isLiveSsh = !isWg && tunnels.some(t => t.id.includes(g.ip) || (g.id && t.id.includes(g.id)));
                                    const active = isWg
                                        ? !!(isLiveWg && wgStatus?.status !== "stopped" && wgStatus?.status !== "error")
                                        : isLiveSsh;
                                    const isErrored = isWg && isLiveWg && wgStatus?.status === "error";

                                    let label = "Off";
                                    if (busyId === g.id) {
                                        label = "…";
                                    } else if (isErrored) {
                                        label = "Error";
                                    } else if (isWg && isLiveWg) {
                                        label = WG_STATUS_LABELS[wgStatus.status] || wgStatus.status;
                                    } else if (isLiveSsh) {
                                        label = "Active";
                                    }

                                    return (
                                        <button
                                            key={g.id}
                                            className={`topbar-gw-row ${active ? "active" : ""}`}
                                            onClick={() => handleToggle(g)}
                                            disabled={busyId === g.id}
                                            title={g.wg_config ? `WireGuard: ${g.wg_config.endpoint}` : `SSH Gateway: ${g.ip}`}
                                        >
                                            <span className={`topbar-gw-dot ${isErrored ? "error" : active ? "on" : ""}`} />
                                            <span className="topbar-gw-name">{g.name || g.ip}</span>
                                            <span className="topbar-gw-status">{label}</span>
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
