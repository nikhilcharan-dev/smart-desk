import "./styles.css";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import logo from "../../assets/logo-32.png";
import ImportWizard from "../../components/Onboarding/ImportWizard";
import Modal from "../../components/Common/Modal";
import { Download, Plus, Server, Pencil, Trash2, Key, Lock, ShieldCheck, Waypoints, Globe, User, Hash, Tag, LayoutList, LayoutGrid, Monitor, Laptop, ChevronRight, Shield } from "lucide-react";

const WG_STATUS_LABELS = {
    starting: "Starting…",
    running: "Connected (waiting for traffic)",
    active: "Active",
    restarting: "Restarting…",
    stopped: "Stopped",
    error: "Error",
};

/* ───────── SSH Key Card (inline) ───────── */

function KeyCard({ keyPath, onBrowse, onClear }) {
    const fileName = keyPath ? keyPath.split(/[\\/]/).pop() : null;
    return (
        <div className={`key-card ${keyPath ? "has-key" : ""}`} onClick={!keyPath ? onBrowse : undefined}>
            <div className="key-card-icon">
                <Key size={18} />
            </div>
            <div className="key-card-info">
                {keyPath ? (
                    <>
                        <div className="key-name">{fileName}</div>
                        <div className="key-path">{keyPath}</div>
                    </>
                ) : (
                    <>
                        <div className="key-name key-name--empty">Select SSH private key</div>
                        <div className="key-path">.pem / .key / id_rsa / id_ed25519</div>
                    </>
                )}
            </div>
            {keyPath ? (
                <>
                    <button type="button" className="key-action-btn key-action-btn--change" onClick={e => { e.stopPropagation(); onBrowse(); }} title="Change key">
                        <Pencil size={12} />
                    </button>
                    <button type="button" className="key-action-btn key-action-btn--clear" onClick={e => { e.stopPropagation(); onClear(); }} title="Remove key">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                            <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                            <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                        </svg>
                    </button>
                </>
            ) : (
                <button type="button" className="key-action-btn key-action-btn--browse" onClick={e => { e.stopPropagation(); onBrowse(); }}>
                    Browse
                </button>
            )}
        </div>
    );
}

/* ───────── Labeled Input ───────── */

function LabeledInput({ icon: Icon, label, children }) {
    return (
        <div className="labeled-field">
            <label className="labeled-field-label">
                {Icon && <Icon size={11} />}
                {label}
            </label>
            {children}
        </div>
    );
}

/* ───────── OS Icon (profile avatar glyph) ───────── */

function OsIcon({ os, size = 16 }) {
    if (os === "windows") return <Monitor size={size} />;
    if (os === "darwin") return <Laptop size={size} />;
    return <Server size={size} />;
}

/* ───────── Color Picker (for profiles) ───────── */

const PROFILE_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#06b6d4", "#84cc16"];

function ColorPicker({ value, onChange }) {
    return (
        <div className="color-picker-row">
            {PROFILE_COLORS.map(c => (
                <button
                    key={c}
                    type="button"
                    className={`color-dot ${value === c ? "active" : ""}`}
                    style={{ "--dot-color": c }}
                    onClick={() => onChange(c)}
                />
            ))}
        </div>
    );
}

/* ───────── Main Component ───────── */

export default function ConnectionHub({ isEntering, setConnected, setUser: setGlobalUser, setIp: setGlobalIp, setProfileName, setHostFingerprint, user, ip, setIsConnecting, setProfileId, setConnPort, setConnPassword, setConnPrivateKey, setConnProxyJump }) {
    const [activeTab, setActiveTab] = useState("profiles");
    const [profiles, setProfiles] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [authMode, setAuthMode] = useState("password"); // password | key | agent
    const [showImportWizard, setShowImportWizard] = useState(false);
    const [viewMode, setViewMode] = useState(() => localStorage.getItem('profileViewMode') || "grid");
    const [tunnels, setTunnels] = useState([]);
    const [wizardMode, setWizardMode] = useState("import"); // import | gateway
    const [preSelectedPath, setPreSelectedPath] = useState(null);
    const [wgStatus, setWgStatus] = useState(null); // live WireGuard gateway status from the backend

    const [formData, setFormData] = useState({
        id: "",
        name: "",
        ip: ip || "",
        user: user || "",
        port: "22",
        password: "",
        sudo_password: "",
        private_key_path: "",
        proxy_jump: "",
        wg_mode: "auto",
        color: "#3b82f6"
    });
    // Whether the profile being edited already has a sudo password in the keyring
    const [sudoIsSet, setSudoIsSet] = useState(false);

    useEffect(() => { loadProfiles(); }, []);
 
    useEffect(() => {
        // Initial snapshot only. Live updates arrive via the backend-pushed
        // "tunnel-status" event below, and local mutations reload explicitly —
        // so there's no need to poll get_active_tunnels/get_wireguard_status.
        loadTunnels();
        loadWgStatus();
    }, []);

    // Live WireGuard status pushed from the backend (starting/active/restarting/etc.)
    useEffect(() => {
        let unlisten;
        listen("tunnel-status", (e) => {
            if (e.payload?.type === "wireguard") {
                setWgStatus(e.payload.status === "stopped" ? null : e.payload);
                loadTunnels();
            }
        }).then(fn => (unlisten = fn));
        return () => { if (unlisten) unlisten(); };
    }, []);

    const loadTunnels = async () => {
        try {
            const data = await invoke("get_active_tunnels");
            setTunnels(data);
        } catch (err) {
            console.error("Failed to load tunnels:", err);
        }
    };

    const loadWgStatus = async () => {
        try {
            const status = await invoke("get_wireguard_status");
            setWgStatus(status);
        } catch (err) {
            console.error("Failed to load WireGuard status:", err);
        }
    };

    const handleStopTunnel = async (tunnelId) => {
        try {
            await invoke("close_tunnel", { tunnelId });
            loadTunnels();
        } catch (err) {
            setError(String(err));
        }
    };

    const handleImportGateway = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: false,
                filters: [{ name: "SSH Config", extensions: ["conf", "config", "*"] }]
            });
            if (selected) {
                setPreSelectedPath(selected);
                setWizardMode("gateway");
                setShowImportWizard(true);
            }
        } catch (err) {
            console.error(err);
        }
    };

    const handleOpenImport = () => {
        setPreSelectedPath(null);
        setWizardMode("import");
        setShowImportWizard(true);
    };

    useEffect(() => {
        // Re-derive authMode only when switching profiles, not on every
        // keystroke — otherwise this would fight the user's manual
        // password/key/agent toggle while editing the form.
        if (formData.private_key_path) setAuthMode("key");
        else setAuthMode("password");
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [formData.id]);

    const loadProfiles = async () => {
        try {
            const data = await invoke("load_profiles");
            setProfiles(data);
        } catch (err) {
            console.error(err);
        }
    };

    const set = (key, val) => setFormData(prev => ({ ...prev, [key]: val }));

    const handleConnect = async (e) => {
        e.preventDefault();

        setError("");
        setIsLoading(true);
        setIsConnecting(true);
        try {
            const fingerprint = await invoke("start_ssh_session", {
                sessionId: MAIN_SESSION_ID,
                ip: formData.ip,
                user: formData.user,
                port: Number(formData.port) || 22,
                password: authMode === "password" ? (formData.password || null) : null,
                privateKey: authMode === "key" ? (formData.private_key_path || null) : null,
                proxyJump: formData.proxy_jump || null
            });
            if (setHostFingerprint) setHostFingerprint(fingerprint || "");
            setGlobalUser(formData.user);
            setGlobalIp(formData.ip);
            setProfileName("Quick Connect");
            if (setProfileId) setProfileId(null);
            if (setConnPort) setConnPort(Number(formData.port) || 22);
            if (setConnPassword) setConnPassword(authMode === "password" ? formData.password : "");
            if (setConnPrivateKey) setConnPrivateKey(authMode === "key" ? formData.private_key_path : "");
            if (setConnProxyJump) setConnProxyJump(formData.proxy_jump || "");
            setConnected(true);
        } catch (err) {
            const hint = !navigator.onLine ? " (your machine reports no network connection)" : "";
            setError(String(err) + hint);
        } finally {
            setIsLoading(false);
            setIsConnecting(false);
        }
    };

    const handleProfileConnect = async (profile) => {
        setError("");
        setIsLoading(true);
        setIsConnecting(true);
        try {
            const fingerprint = await invoke("connect_to_profile", { profileId: profile.id, sessionId: MAIN_SESSION_ID });
            if (setHostFingerprint) setHostFingerprint(fingerprint || "");
            setGlobalUser(profile.user);
            setGlobalIp(profile.ip);
            setProfileName(profile.name);
            if (setProfileId) setProfileId(profile.id);
            if (setConnPort) setConnPort(profile.port || 22);
            // The password lives only in the OS keyring on the backend — not
            // available here for profile connections (unlike Quick Connect).
            if (setConnPassword) setConnPassword("");
            if (setConnPrivateKey) setConnPrivateKey(profile.private_key_path || "");
            if (setConnProxyJump) setConnProxyJump(profile.proxy_jump || "");
            setConnected(true);
        } catch (err) {
            const hint = !navigator.onLine ? " (your machine reports no network connection)" : "";
            setError(String(err) + hint);
        } finally {
            setIsLoading(false);
            setIsConnecting(false);
        }
    };

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        if (!formData.name) { setError("Profile name is required"); return; }
        if (!formData.ip) { setError("Host / IP address is required"); return; }
        if (!formData.user) { setError("Username is required"); return; }
        try {
            // Spread formData rather than rebuilding from a fixed field list —
            // fields the form doesn't own (wg_config, tunnels, remote_os) must
            // survive an edit unchanged, or editing a gateway profile silently
            // wipes its WireGuard config and orphans its keyring entries.
            const profile = {
                ...formData,
                id: formData.id || crypto.randomUUID(),
                port: Number(formData.port) || 22,
                private_key_path: authMode === "key" ? (formData.private_key_path || null) : null,
                tags: formData.tags || [],
                color: formData.color || "#3b82f6",
                last_connected: formData.last_connected || null,
                proxy_jump: formData.proxy_jump || null,
                wg_mode: formData.wg_mode && formData.wg_mode !== "auto" ? formData.wg_mode : null
            };
            delete profile.password;
            delete profile.sudo_password;
            await invoke("save_profile", {
                profile,
                password: authMode === "password" ? (formData.password || null) : null,
                // Empty means "unchanged" on edit; a typed value sets/updates it.
                sudoPassword: formData.sudo_password || null,
            });
            setIsEditing(false);
            resetForm();
            loadProfiles();
        } catch (err) {
            setError(String(err));
        }
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (!confirm("Delete this profile?")) return;
        try {
            await invoke("delete_profile", { id });
            loadProfiles();
        } catch (err) {
            console.error(err);
        }
    };

    const openEdit = (e, profile) => {
        e.stopPropagation();
        setFormData({ ...profile, port: String(profile.port || 22), password: "", sudo_password: "", proxy_jump: profile.proxy_jump || "", wg_mode: profile.wg_mode || "auto", color: profile.color || "#3b82f6" });
        setIsEditing(true);
        // Reflect whether a sudo password is already stored (value stays hidden).
        setSudoIsSet(false);
        invoke("has_sudo_password", { id: profile.id }).then(setSudoIsSet).catch(() => setSudoIsSet(false));
    };

    const resetForm = () => {
        setFormData({ id: "", name: "", ip: "", user: "", port: "22", password: "", sudo_password: "", private_key_path: "", proxy_jump: "", wg_mode: "auto", color: "#3b82f6" });
        setAuthMode("password");
        setSudoIsSet(false);
        setError("");
    };

    const switchToQuick = () => {
        setActiveTab("quick");
        setIsEditing(false);
        resetForm();
    };

    const handleBrowseKey = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: false,
                filters: [{ name: "SSH Key", extensions: ["pem", "key", "id_rsa", "id_ed25519", "id_ecdsa", "*"] }]
            });
            if (selected) set("private_key_path", selected);
        } catch (err) {
            console.error(err);
        }
    };

    /* ─── Render: Profile Form (shared between Quick Connect and Edit) ─── */

    const renderForm = () => {
        const isQuick = activeTab === "quick" && !isEditing;

        return (
            <form onSubmit={isEditing ? handleSaveProfile : handleConnect} className="conn-form">

                {/* Profile name + color (edit mode only) */}
                {isEditing && (
                    <div className="form-section">
                        <div className="form-section-title">
                            <Tag size={13} />
                            Profile Identity
                        </div>
                        <LabeledInput icon={Tag} label="Profile Name">
                            <input
                                placeholder="e.g. Production DB, Staging API"
                                value={formData.name}
                                onChange={e => set("name", e.target.value)}
                                autoFocus
                            />
                        </LabeledInput>
                        <ColorPicker value={formData.color} onChange={c => set("color", c)} />
                    </div>
                )}

                {/* Connection details */}
                <div className="form-section">
                    <div className="form-section-title">
                        <Server size={13} />
                        {isQuick ? "Server Connection" : "Connection Details"}
                    </div>

                    <div className="form-grid-2">
                        <LabeledInput icon={Globe} label="Host / IP Address">
                            <input
                                placeholder="192.168.1.100 or hostname.com"
                                value={formData.ip}
                                onChange={e => set("ip", e.target.value)}
                                required
                                autoFocus={!isEditing}
                                spellCheck={false}
                            />
                        </LabeledInput>
                        <LabeledInput icon={Hash} label="Port">
                            <input
                                placeholder="22"
                                value={formData.port}
                                onChange={e => set("port", e.target.value.replace(/\D/g, "").slice(0, 5))}
                                className="port-field"
                            />
                        </LabeledInput>
                    </div>

                    <LabeledInput icon={User} label="Username">
                        <input
                            placeholder="root, ubuntu, admin..."
                            value={formData.user}
                            onChange={e => set("user", e.target.value)}
                            required
                            spellCheck={false}
                        />
                    </LabeledInput>
                </div>

                {/* Authentication */}
                <div className="form-section">
                    <div className="form-section-title">
                        <ShieldCheck size={13} />
                        Authentication
                    </div>

                    <div className="auth-toggle">
                        <button type="button" className={`auth-mode-btn ${authMode === "password" ? "active" : ""}`} onClick={() => setAuthMode("password")}>
                            <Lock size={13} />
                            Password
                        </button>
                        <button type="button" className={`auth-mode-btn ${authMode === "key" ? "active" : ""}`} onClick={() => setAuthMode("key")}>
                            <Key size={13} />
                            SSH Key
                        </button>
                        <button type="button" className={`auth-mode-btn ${authMode === "agent" ? "active" : ""}`} onClick={() => setAuthMode("agent")}>
                            <ShieldCheck size={13} />
                            Agent
                        </button>
                    </div>

                    {authMode === "password" && (
                        <LabeledInput icon={Lock} label="Password">
                            <input
                                type="password"
                                placeholder={isEditing ? "Leave empty if unchanged" : "Enter password"}
                                value={formData.password}
                                onChange={e => set("password", e.target.value)}
                                required={!isEditing && authMode === "password"}
                            />
                        </LabeledInput>
                    )}

                    {authMode === "key" && (
                        <KeyCard
                            keyPath={formData.private_key_path}
                            onBrowse={handleBrowseKey}
                            onClear={() => set("private_key_path", "")}
                        />
                    )}

                    {authMode === "agent" && (
                        <div className="agent-info">
                            <ShieldCheck size={16} />
                            <div>
                                <div className="agent-info-title">SSH Agent / Pageant</div>
                                <div className="agent-info-desc">Authenticates using keys loaded in your system's ssh-agent, Pageant, or hardware keys (YubiKey)</div>
                            </div>
                        </div>
                    )}

                    {/* Sudo password — optional. Lets Servera elevate commands
                        (view root-only logs, edit protected files) when you log
                        in as a non-root user whose sudo needs a password. */}
                    <LabeledInput icon={Shield} label="Sudo password (optional)">
                        <input
                            type="password"
                            placeholder={sudoIsSet ? "Stored — leave empty to keep" : "For non-root logins that need sudo"}
                            value={formData.sudo_password}
                            onChange={e => set("sudo_password", e.target.value)}
                            autoComplete="off"
                        />
                    </LabeledInput>
                    <div className="agent-info-desc" style={{ marginTop: 6, fontSize: 11, opacity: 0.7 }}>
                        Stored securely in your OS keyring. Used to run privileged commands via sudo and to read protected logs.
                    </div>
                </div>

                {/* Advanced */}
                <div className="form-section">
                    <div className="form-section-title">
                        <Waypoints size={13} />
                        Advanced
                    </div>
                    <LabeledInput icon={Waypoints} label="ProxyJump (optional)">
                        <input
                            placeholder="user@bastion1, user@bastion2:2222"
                            value={formData.proxy_jump}
                            onChange={e => set("proxy_jump", e.target.value)}
                            spellCheck={false}
                        />
                    </LabeledInput>
                    {isEditing && (
                        <LabeledInput icon={Shield} label="VPN Routing">
                            <select value={formData.wg_mode || "auto"} onChange={e => set("wg_mode", e.target.value)}>
                                <option value="auto">Auto (route when IP matches active gateway)</option>
                                <option value="always">Always via WireGuard gateway</option>
                                <option value="never">Never (direct connection)</option>
                            </select>
                        </LabeledInput>
                    )}
                </div>

                {error && <div className="error-text">{error}</div>}

                {/* Actions */}
                <div className="form-actions">
                    {isEditing && (
                        <button type="button" className="cancel-btn" onClick={() => { setIsEditing(false); resetForm(); }}>
                            Cancel
                        </button>
                    )}
                    <button className="primary-btn" type="submit" disabled={isLoading}>
                        {isLoading
                            ? "Connecting..."
                            : isEditing
                                ? (formData.id ? "Update Profile" : "Create Profile")
                                : "Connect"
                        }
                    </button>
                </div>
            </form>
        );
    };

    return (
        <div className={`login-wrapper${isEntering ? " login-entering" : ""}`}>
            <div className="login-header">
                <div style={{ display: "flex", alignItems: "center", gap: "24px", justifyContent: "center" }}>
                    <img src={logo} alt="Servera Logo" style={{ width: 100, height: 100 }} />
                    <h1 className="login-title" style={{ marginBottom: 0, fontSize: "3.5rem" }}>Servera</h1>
                </div>
                <p className="login-subtitle">Intelligent SSH Manager</p>
                <div className="login-micro">Agentless. Secure. Visual.</div>
            </div>

            <div className="login-card">
                <div className="tabs-header">
                    <button className={`tab-btn ${activeTab === "profiles" && !isEditing ? "active" : ""}`}
                        onClick={() => { setActiveTab("profiles"); setIsEditing(false); setError(""); }}>
                        <Server size={14} />
                        Profiles
                    </button>
                    <button className={`tab-btn ${activeTab === "gateways" && !isEditing ? "active" : ""}`}
                        onClick={() => { setActiveTab("gateways"); setIsEditing(false); setError(""); }}>
                        <Waypoints size={14} />
                        Gateways
                    </button>
                    <button className={`tab-btn ${activeTab === "quick" && !isEditing ? "active" : ""}`} onClick={switchToQuick}>
                        <Globe size={14} />
                        Quick Connect
                    </button>
                    {isEditing && (
                        <button className="tab-btn active">
                            <Pencil size={14} />
                            {formData.id ? "Edit Profile" : "New Profile"}
                        </button>
                    )}
                </div>

                {/* PROFILES */}
                {activeTab === "profiles" && !isEditing && (() => {
                    const regularProfiles = profiles.filter(p => !p.tags?.includes("gateway"));
                    return (
                    <div className="profiles-view">
                        {/* Toolbar: count + view toggle */}
                        <div className="profiles-toolbar">
                            <span className="profiles-count">{regularProfiles.length} server{regularProfiles.length !== 1 ? 's' : ''}</span>
                            <div className="view-toggle">
                                <button
                                    className={`view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                                    onClick={() => { setViewMode('list'); localStorage.setItem('profileViewMode', 'list'); }}
                                    title="List view"
                                >
                                    <LayoutList size={14} />
                                </button>
                                <button
                                    className={`view-toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
                                    onClick={() => { setViewMode('grid'); localStorage.setItem('profileViewMode', 'grid'); }}
                                    title="Grid view"
                                >
                                    <LayoutGrid size={14} />
                                </button>
                            </div>
                        </div>

                        <div className={`profiles-list ${viewMode === 'grid' ? 'profiles-grid' : ''}`}>
                            {regularProfiles.length === 0 && (
                                <div className="empty-state">
                                    <Server size={28} strokeWidth={1.2} />
                                    <span>No profiles yet</span>
                                    <span className="empty-hint">Add a profile or import from ~/.ssh/config</span>
                                </div>
                            )}
                            {regularProfiles.map((p, idx) => (
                                viewMode === 'grid' ? (
                                    /* ─── Grid Tile ─── */
                                    <div
                                        key={p.id}
                                        className="profile-tile"
                                        style={isEntering ? { "--item-idx": idx } : undefined}
                                        onClick={() => handleProfileConnect(p)}
                                    >
                                        <div className="tile-actions">
                                            <button className="icon-btn" onClick={(e) => openEdit(e, p)} title="Edit">
                                                <Pencil size={11} />
                                            </button>
                                            <button className="icon-btn danger" onClick={(e) => handleDelete(e, p.id)} title="Delete">
                                                <Trash2 size={11} />
                                            </button>
                                        </div>
                                        <div className="tile-avatar" style={{ "--pc": p.color || "#3b82f6" }} title={p.remote_os || "linux"}>
                                            <OsIcon os={p.remote_os} size={18} />
                                        </div>
                                        <div className="tile-name" title={p.name}>{p.name}</div>
                                        <div className="tile-host">{p.ip}<span className="tile-port">:{p.port || 22}</span></div>
                                        <div className="tile-user">{p.user}</div>
                                    </div>
                                ) : (
                                    /* ─── List Row ─── */
                                    <div
                                        key={p.id}
                                        className="profile-item"
                                        style={isEntering ? { "--item-idx": idx } : undefined}
                                        onClick={() => handleProfileConnect(p)}
                                    >
                                        <div className="profile-avatar" style={{ "--pc": p.color || "#3b82f6" }} title={p.remote_os || "linux"}>
                                            <OsIcon os={p.remote_os} size={16} />
                                        </div>
                                        <div className="profile-info">
                                            <span className="profile-name" title={p.name}>{p.name}</span>
                                            <span className="profile-sub">
                                                {p.user}@{p.ip}<span className="profile-port">:{p.port || 22}</span>
                                            </span>
                                        </div>
                                        <div className="profile-actions">
                                            <button className="icon-btn" onClick={(e) => openEdit(e, p)} title="Edit">
                                                <Pencil size={13} />
                                            </button>
                                            <button className="icon-btn danger" onClick={(e) => handleDelete(e, p.id)} title="Delete">
                                                <Trash2 size={13} />
                                            </button>
                                        </div>
                                        <ChevronRight className="profile-chevron" size={16} />
                                    </div>
                                )
                            ))}
                        </div>
                        <div className="profiles-footer">
                            <button className="primary-btn" onClick={() => {
                                resetForm();
                                setIsEditing(true);
                            }}>
                                <Plus size={15} />
                                New Profile
                            </button>
                            <button className="import-btn" title="Import from ~/.ssh/config" onClick={handleOpenImport}>
                                <Download size={14} />
                                Import
                            </button>
                        </div>
                        {error && <div className="error-text">{error}</div>}
                    </div>
                    );
                })()}

                {/* GATEWAYS */}
                {activeTab === "gateways" && !isEditing && (
                    <div className="gateways-view">
                        <div className="gateways-header">
                            <h3>Pre-connection Tunnels</h3>
                            <p>Establish a tunnel to your bastion or gateway server to access private IP profiles.</p>
                        </div>

                        <div className="tunnels-status-list">
                            {tunnels.length === 0 && profiles.filter(p => p.tags?.includes("gateway")).length === 0 ? (
                                <div className="empty-state">
                                    <Waypoints size={28} strokeWidth={1.2} />
                                    <span>No active gateways</span>
                                    <span className="empty-hint">Start a tunnel to access private network profiles</span>
                                </div>
                            ) : (
                                <>
                                    {/* 1. Show saved gateways (Active or Offline) */}
                                    {profiles.filter(p => p.tags?.includes("gateway")).map(p => {
                                        const isActive = tunnels.some(t => t.id.includes(p.ip));
                                        const isWg = !!p.wg_config;
                                        const wgLive = isWg && wgStatus?.profileId === p.id ? wgStatus : null;
                                        const statusLabel = wgLive
                                            ? (WG_STATUS_LABELS[wgLive.status] || wgLive.status)
                                            : (isActive ? "ACTIVE" : "SAVED");
                                        const isErrored = wgLive?.status === "error";
                                        return (
                                            <div key={p.id} className={`gateway-status-item ${isActive ? 'active' : 'saved'}`}>
                                                <div className={`gateway-dot ${isErrored ? 'offline' : isActive ? 'local' : 'offline'}`}></div>
                                                <div className="gateway-info">
                                                    <div className="gateway-label">
                                                        {p.name}
                                                        <span className={`status-tag ${isActive && !isErrored ? '' : 'saved'}`}>
                                                            {statusLabel}
                                                        </span>
                                                    </div>
                                                    <div className="gateway-detail">
                                                        {p.wg_config ? `WireGuard: ${p.wg_config.endpoint}` : `SSH Gateway: ${p.ip}`}
                                                        {wgLive?.message ? ` — ${wgLive.message}` : ""}
                                                    </div>
                                                </div>
                                                {isActive ? (
                                                    <button className="gateway-stop-btn" onClick={async () => {
                                                        try {
                                                            await invoke("stop_all_tunnels");
                                                            loadTunnels();
                                                            loadWgStatus();
                                                        } catch (err) {
                                                            setError("Failed to stop gateway: " + err);
                                                        }
                                                    }}>Stop</button>
                                                ) : (
                                                    <button className="gateway-start-btn" onClick={async () => {
                                                        try {
                                                            await invoke("start_gateway_from_profile", { profileId: p.id });
                                                            loadTunnels();
                                                            loadWgStatus();
                                                        } catch (err) {
                                                            setError("Failed to start gateway: " + err);
                                                        }
                                                    }}>Start</button>
                                                )}
                                            </div>
                                        );
                                    })}

                                    {/* 2. Show "Manual" tunnels (not associated with any profile) */}
                                    {tunnels.filter(t => !profiles.some(p => t.id.includes(p.ip))).map(t => (
                                        <div key={t.id} className="gateway-status-item active">
                                            <div className={`gateway-dot ${t.tunnel_type}`}></div>
                                            <div className="gateway-info">
                                                <div className="gateway-label">
                                                    {t.tunnel_type === "remote" ? "Remote Forward" : t.tunnel_type === "dynamic" ? "SOCKS Proxy" : "Local Tunnel"}
                                                    <span className="status-tag">MANUAL</span>
                                                </div>
                                                <div className="gateway-detail">
                                                    {t.tunnel_type === "dynamic" ? `Port ${t.local_port}` : `${t.local_port} → ${t.remote_host}:${t.remote_port}`}
                                                </div>
                                            </div>
                                            <button className="gateway-stop-btn" onClick={() => handleStopTunnel(t.id)}>Stop</button>
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>

                        <div className="gateways-actions">
                            <button className="primary-btn" onClick={handleImportGateway}>
                                <Download size={15} />
                                Start from .conf File
                            </button>
                            <button className="secondary-btn" onClick={() => setActiveTab("quick")}>
                                <Plus size={15} />
                                Manual Tunnel
                            </button>
                        </div>
                    </div>
                )}

                {/* Quick Connect or Edit form */}
                {(activeTab === "quick" || isEditing) && renderForm()}
            </div>

            <Modal
                isOpen={showImportWizard}
                type="custom"
                title={wizardMode === "gateway" ? "Establish Gateway Tunnels" : "SSH Config Import"}
                onCancel={() => setShowImportWizard(false)}
                footer={null}
                actions={[]}
            >
                <ImportWizard
                    mode={wizardMode}
                    initialPath={preSelectedPath}
                    onComplete={() => {
                        setShowImportWizard(false);
                        setPreSelectedPath(null);
                        if (wizardMode === "gateway") {
                            loadTunnels();
                            setActiveTab("gateways");
                        } else {
                            loadProfiles();
                        }
                    }}
                    onCancel={() => setShowImportWizard(false)}
                />
            </Modal>
        </div>
    );
}
