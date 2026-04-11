import "./styles.css";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import logo from "../../assets/logo-32.png";
import ImportWizard from "../../components/Onboarding/ImportWizard";
import Modal from "../../components/Common/Modal";
import { Download } from "lucide-react";

function KeyCard({ keyPath, onBrowse, onClear }) {
    const fileName = keyPath ? keyPath.split(/[\\/]/).pop() : null;

    return (
        <div className={`key-card ${keyPath ? "has-key" : ""}`} onClick={!keyPath ? onBrowse : undefined}>
            <div className="key-card-icon">
                {keyPath ? (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <circle cx="8" cy="15" r="4" />
                        <path d="M12 15h8M16 15v-2M19 15v-2" strokeLinecap="round" />
                    </svg>
                ) : (
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <rect x="3" y="11" width="18" height="11" rx="2" />
                        <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
                    </svg>
                )}
            </div>

            <div className="key-card-info">
                {keyPath ? (
                    <>
                        <div className="key-name">{fileName}</div>
                        <div className="key-path">{keyPath}</div>
                    </>
                ) : (
                    <>
                        <div className="key-name key-name--empty">Click to select SSH private key</div>
                        <div className="key-path">.pem · .key · id_rsa · id_ed25519</div>
                    </>
                )}
            </div>

            {keyPath ? (
                <button type="button" className="key-action-btn key-action-btn--change" onClick={e => { e.stopPropagation(); onBrowse(); }} title="Change key">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" />
                        <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" />
                    </svg>
                </button>
            ) : (
                <button type="button" className="key-action-btn key-action-btn--browse" onClick={e => { e.stopPropagation(); onBrowse(); }}>
                    Browse
                </button>
            )}

            {keyPath && (
                <button type="button" className="key-action-btn key-action-btn--clear" onClick={e => { e.stopPropagation(); onClear(); }} title="Remove key">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" strokeLinecap="round" />
                        <line x1="6" y1="6" x2="18" y2="18" strokeLinecap="round" />
                    </svg>
                </button>
            )}
        </div>
    );
}

export default function ConnectionHub({ isEntering, setConnected, setUser: setGlobalUser, setIp: setGlobalIp, setProfileName, setHostFingerprint, user, ip, setIsConnecting, setProfileId }) {
    const [activeTab, setActiveTab] = useState("profiles");
    const [profiles, setProfiles] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");
    const [authMode, setAuthMode] = useState("password");
    const [showImportWizard, setShowImportWizard] = useState(false);

    const [formData, setFormData] = useState({
        id: "",
        name: "",
        ip: ip || "",
        user: user || "",
        port: "22",
        password: "",
        private_key_path: "",
        proxy_jump: ""
    });

    useEffect(() => { loadProfiles(); }, []);

    useEffect(() => {
        if (formData.private_key_path) setAuthMode("key");
        else setAuthMode("password");
    }, [formData.id]);

    const loadProfiles = async () => {
        try {
            const data = await invoke("load_profiles");
            setProfiles(data);
        } catch (err) {
            console.error(err);
        }
    };

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
                private_key: authMode === "key" ? (formData.private_key_path || null) : null,
                proxy_jump: formData.proxy_jump || null
            });
            if (setHostFingerprint) setHostFingerprint(fingerprint || "");
            setGlobalUser(formData.user);
            setGlobalIp(formData.ip);
            setProfileName("Quick Connect");
            if (setProfileId) setProfileId(null);
            setConnected(true);
        } catch (err) {
            setError(String(err));
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
            setConnected(true);
        } catch (err) {
            setError(String(err));
        } finally {
            setIsLoading(false);
            setIsConnecting(false);
        }
    };

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        if (!formData.name) { setError("Profile name required"); return; }
        try {
            const profile = {
                id: formData.id || crypto.randomUUID(),
                name: formData.name,
                ip: formData.ip,
                user: formData.user,
                port: Number(formData.port) || 22,
                private_key_path: authMode === "key" ? (formData.private_key_path || null) : null,
                tags: formData.tags || [],
                color: formData.color || "#3b82f6",
                last_connected: formData.last_connected || null,
                proxy_jump: formData.proxy_jump || null
            };
            await invoke("save_profile", { profile, password: authMode === "password" ? (formData.password || null) : null });
            setIsEditing(false);
            setFormData({ id: "", name: "", ip: "", user: "", port: "22", password: "", private_key_path: "", proxy_jump: "" });
            setAuthMode("password");
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
        setFormData({ ...profile, port: String(profile.port || 22), password: "", proxy_jump: profile.proxy_jump || "" });
        setIsEditing(true);
    };

    const switchToQuick = () => {
        setActiveTab("quick");
        setIsEditing(false);
        setFormData({ id: "", name: "", ip: "", user: "", port: "22", password: "", private_key_path: "", proxy_jump: "" });
        setAuthMode("password");
    };

    const handleBrowseKey = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: false,
                filters: [{ name: "SSH Key", extensions: ["pem", "key", "id_rsa", "id_ed25519", "id_ecdsa", "*"] }]
            });
            if (selected) setFormData(prev => ({ ...prev, private_key_path: selected }));
        } catch (err) {
            console.error(err);
        }
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
                    <button className={`tab-btn ${activeTab === "profiles" && !isEditing ? "active" : ""}`} onClick={() => { setActiveTab("profiles"); setIsEditing(false); }}>
                        Profiles
                    </button>
                    <button className={`tab-btn ${activeTab === "quick" ? "active" : ""}`} onClick={switchToQuick}>
                        Quick Connect
                    </button>
                </div>

                {/* PROFILES LIST */}
                {activeTab === "profiles" && !isEditing && (
                    <div className="profiles-view">
                        <div className="profiles-list">
                            {profiles.length === 0 && (
                                <div className="empty-state">No profiles yet. Create one to get started.</div>
                            )}
                            {profiles.map((p, idx) => (
                                <div
                                    key={p.id}
                                    className="profile-item"
                                    style={isEntering ? { "--item-idx": idx } : undefined}
                                    onClick={() => handleProfileConnect(p)}
                                >
                                    <div className="profile-dot" style={{ background: p.color || "#3b82f6" }} />
                                    <div className="profile-info">
                                        <span className="profile-name">{p.name}</span>
                                        <span className="profile-sub">{p.user}@{p.ip}<span className="profile-port">:{p.port || 22}</span></span>
                                    </div>
                                    <div className="profile-actions">
                                        <button className="icon-btn" onClick={(e) => openEdit(e, p)} title="Edit">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" />
                                                <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" />
                                            </svg>
                                        </button>
                                        <button className="icon-btn danger" onClick={(e) => handleDelete(e, p.id)} title="Delete">
                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                <polyline points="3 6 5 6 21 6" />
                                                <path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" />
                                                <path d="M10 11v6M14 11v6" strokeLinecap="round" />
                                                <path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '12px', marginTop: '12px' }}>
                            <button className="primary-btn" style={{ flex: 1 }} onClick={() => {
                                setFormData({ id: "", name: "", ip: "", user: "", port: "22", password: "", private_key_path: "", proxy_jump: "" });
                                setAuthMode("password");
                                setIsEditing(true);
                            }}>+ New Profile</button>
                            
                            <button className="secondary-btn" title="Import from ~/.ssh/config" onClick={() => setShowImportWizard(true)} style={{ 
                                padding: '0 16px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                background: 'rgba(56, 139, 253, 0.1)',
                                border: '1px solid rgba(56, 139, 253, 0.2)',
                                color: '#58a6ff',
                                borderRadius: '8px',
                                cursor: 'pointer',
                                fontSize: '13px',
                                fontWeight: 500,
                                transition: 'all 0.2s'
                            }}>
                                <Download size={14} /> Import
                            </button>
                        </div>
                        {error && <div className="error-text">{error}</div>}
                    </div>
                )}

                {/* FORM: Quick Connect OR Edit Profile */}
                {(activeTab === "quick" || isEditing) && (
                    <form onSubmit={isEditing ? handleSaveProfile : handleConnect}>
                        <div className="login-fields">

                            {isEditing && (
                                <input
                                    placeholder="Profile Name (e.g. Prod DB)"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    autoFocus
                                />
                            )}

                            <input
                                placeholder="Username"
                                value={formData.user}
                                onChange={e => setFormData({ ...formData, user: e.target.value })}
                                required
                                autoFocus={!isEditing}
                            />

                            <div className="login-row">
                                <input
                                    placeholder="Host / IP"
                                    value={formData.ip}
                                    onChange={e => setFormData({ ...formData, ip: e.target.value })}
                                    required
                                    style={{ flex: 1 }}
                                />
                                <input
                                    placeholder="Port"
                                    value={formData.port}
                                    onChange={e => setFormData({ ...formData, port: e.target.value.replace(/\D/g, "").slice(0, 5) })}
                                    className="port-field"
                                />
                            </div>

                            <div className="auth-toggle">
                                <button type="button" className={`auth-mode-btn ${authMode === "password" ? "active" : ""}`} onClick={() => setAuthMode("password")}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                                        <rect x="3" y="11" width="18" height="11" rx="2" />
                                        <path d="M7 11V7a5 5 0 0110 0v4" strokeLinecap="round" />
                                    </svg>
                                    Password
                                </button>
                                <button type="button" className={`auth-mode-btn ${authMode === "key" ? "active" : ""}`} onClick={() => setAuthMode("key")}>
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: 6 }}>
                                        <circle cx="8" cy="15" r="4" />
                                        <path d="M12 15h8M16 13v4M19 13v4" strokeLinecap="round" />
                                    </svg>
                                    SSH Key
                                </button>
                            </div>

                            {authMode === "password" && (
                                <input
                                    type="password"
                                    placeholder={isEditing ? "Password (leave empty if unchanged)" : "Password"}
                                    value={formData.password}
                                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                                    required={!isEditing}
                                />
                            )}

                            {authMode === "key" && (
                                <KeyCard
                                    keyPath={formData.private_key_path}
                                    onBrowse={handleBrowseKey}
                                    onClear={() => setFormData(prev => ({ ...prev, private_key_path: "" }))}
                                />
                            )}

                            <div className="proxy-jump-container">
                                <label className="field-label">ProxyJump (Optional)</label>
                                <input
                                    placeholder="user@hop1,user@hop2"
                                    value={formData.proxy_jump}
                                    onChange={e => setFormData({ ...formData, proxy_jump: e.target.value })}
                                />
                            </div>

                            {error && <div className="error-text">{error}</div>}
                        </div>

                        <div className="login-row" style={{ marginTop: 20 }}>
                            {isEditing && (
                                <button type="button" className="cancel-btn" onClick={() => setIsEditing(false)}>Cancel</button>
                            )}
                            <button className="primary-btn" type="submit" disabled={isLoading} style={{ marginTop: 0 }}>
                                {isLoading ? "Connecting…" : (isEditing ? "Save Profile" : "Connect")}
                            </button>
                        </div>
                    </form>
                )}
            </div>

            <Modal 
                isOpen={showImportWizard} 
                title="SSH Config Import" 
                onCancel={() => setShowImportWizard(false)}
                footer={null}
                actions={[]}
            >
                <ImportWizard 
                    onComplete={() => {
                        setShowImportWizard(false);
                        loadProfiles();
                    }} 
                    onCancel={() => setShowImportWizard(false)} 
                />
            </Modal>
        </div>
    );
}
