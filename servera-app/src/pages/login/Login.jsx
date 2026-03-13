import "./styles.css";
import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import logo from "../../assets/logo-32.png";

export default function ConnectionHub({ setConnected, setUser: setGlobalUser, setIp: setGlobalIp, setProfileName, setHostFingerprint, user, ip, setIsConnecting, setProfileId }) {
    const [activeTab, setActiveTab] = useState("profiles");
    const [profiles, setProfiles] = useState([]);
    const [isEditing, setIsEditing] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    // Quick Connect / Form State
    const [formData, setFormData] = useState({
        id: "",
        name: "",
        ip: ip || "",
        user: user || "",
        port: 22,
        password: ""
    });

    useEffect(() => {
        loadProfiles();
    }, []);

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
            if (activeTab === "quick" || isEditing) {
                // Manual Connect — now returns host key fingerprint
                const fingerprint = await invoke("start_ssh_session", {
                    sessionId: MAIN_SESSION_ID,
                    ip: formData.ip,
                    user: formData.user,
                    password: formData.password || null,
                    private_key: formData.private_key_path || null
                });
                if (setHostFingerprint) setHostFingerprint(fingerprint || "");
            }

            setGlobalUser(formData.user);
            setGlobalIp(formData.ip);
            setProfileName("Quick Connect");
            if (setProfileId) setProfileId(null); // Quick connect has no stored profile ID
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
            const fingerprint = await invoke("connect_to_profile", {
                profileId: profile.id,
                sessionId: MAIN_SESSION_ID
            });
            if (setHostFingerprint) setHostFingerprint(fingerprint || "");
            setGlobalUser(profile.user);
            setGlobalIp(profile.ip);
            setProfileName(profile.name);
            if (setProfileId) setProfileId(profile.id); // Store for reconnect
            setConnected(true);
        } catch (err) {
            setError(String(err)); // Likely password missing from keychain
        } finally {
            setIsLoading(false);
            setIsConnecting(false);
        }
    };

    const handleSaveProfile = async (e) => {
        e.preventDefault();
        if (!formData.name) {
            setError("Profile name required");
            return;
        }

        try {
            const profile = {
                id: formData.id || crypto.randomUUID(),
                name: formData.name,
                ip: formData.ip,
                user: formData.user,
                port: Number(formData.port) || 22,
                private_key_path: formData.private_key_path || null,
                tags: formData.tags || [],
                color: formData.color || "#3b82f6",
                last_connected: formData.last_connected || null
            };

            await invoke("save_profile", {
                profile,
                password: formData.password || null
            });

            setIsEditing(false);
            setFormData({ id: "", name: "", ip: "", user: "", port: 22, password: "", private_key_path: "" });
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
        setFormData({ ...profile, password: "" }); // Password not retrieved
        setIsEditing(true);
    };

    const switchToQuick = () => {
        setActiveTab("quick");
        setIsEditing(false);
        setFormData({ id: "", name: "", ip: "", user: "", port: 22, password: "" });
    };

    const handleBrowseKey = async () => {
        try {
            const selected = await open({
                multiple: false,
                directory: false,
                filters: [{
                    name: 'SSH Key',
                    extensions: ['pem', 'key', 'id_rsa', '*']
                }]
            });
            if (selected) {
                setFormData({ ...formData, private_key_path: selected });
            }
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="login-wrapper">
            <div className="login-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', justifyContent: 'center' }}>
                    <img src={logo} alt="Servera Logo" style={{ width: 100, height: 100 }} />
                    <h1 className="login-title" style={{ marginBottom: 0, fontSize: '3.5rem' }}>Servera</h1>
                </div>
                <p className="login-subtitle">Intelligent SSH Manager</p>
                <div className="login-micro">Agentless. Secure. Visual.</div>
            </div>

            <div className="login-card">
                <div className="tabs-header">
                    <button
                        className={`tab-btn ${activeTab === "profiles" && !isEditing ? "active" : ""}`}
                        onClick={() => { setActiveTab("profiles"); setIsEditing(false); }}
                    >
                        Profiles
                    </button>
                    <button
                        className={`tab-btn ${activeTab === "quick" ? "active" : ""}`}
                        onClick={switchToQuick}
                    >
                        Quick Connect
                    </button>
                </div>

                {/* PROFILES LIST */}
                {activeTab === "profiles" && !isEditing && (
                    <div className="profiles-view">
                        <div className="profiles-list">
                            {profiles.length === 0 && (
                                <div className="empty-state">No profiles found. Create one to get started.</div>
                            )}
                            {profiles.map(p => (
                                <div key={p.id} className="profile-item" onClick={() => handleProfileConnect(p)}>
                                    <div className="profile-info">
                                        <span className="profile-name">{p.name}</span>
                                        <span className="profile-sub">{p.user}@{p.ip}</span>
                                    </div>
                                    <div className="profile-actions">
                                        <button className="icon-btn" onClick={(e) => openEdit(e, p)}>✎</button>
                                        <button className="icon-btn danger" onClick={(e) => handleDelete(e, p.id)}>🗑</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                        <button className="primary-btn" onClick={() => {
                            setFormData({ id: "", name: "", ip: "", user: "", port: 22, password: "" });
                            setIsEditing(true);
                        }}>
                            + New Profile
                        </button>
                        {error && <div className="error-text">{error}</div>}
                    </div>
                )}

                {/* FORM (Quick Connect OR Edit Profile) */}
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

                            <div className="login-row">
                                <input
                                    placeholder="Username"
                                    value={formData.user}
                                    onChange={e => setFormData({ ...formData, user: e.target.value })}
                                    required
                                />
                                <input
                                    placeholder="Host / IP"
                                    value={formData.ip}
                                    onChange={e => setFormData({ ...formData, ip: e.target.value })}
                                    required
                                />
                            </div>

                            <div className="login-row" style={{ position: 'relative' }}>
                                <input
                                    placeholder="Private Key Path (Optional)"
                                    value={formData.private_key_path || ""}
                                    onChange={e => setFormData({ ...formData, private_key_path: e.target.value })}
                                    style={{ paddingRight: '50px', textOverflow: 'ellipsis' }}
                                />
                                <button
                                    type="button"
                                    onClick={handleBrowseKey}
                                    style={{
                                        position: 'absolute',
                                        right: '8px',
                                        top: '50%',
                                        transform: 'translateY(-50%)',
                                        background: 'transparent',
                                        border: 'none',
                                        fontSize: '1.2rem',
                                        cursor: 'pointer',
                                        padding: '4px 8px',
                                        borderRadius: '4px',
                                        transition: 'background 0.2s',
                                        color: '#fff' // Ensure emoji is visible/colored if it's text, though standard emojis have their own color
                                    }}
                                    className="icon-hover-btn"
                                    title="Browse for Key"
                                >
                                    📁
                                </button>
                            </div>

                            <input
                                type="password"
                                placeholder={isEditing ? "Password (leave empty if using key or unchanged)" : "Password"}
                                value={formData.password}
                                onChange={e => setFormData({ ...formData, password: e.target.value })}
                                required={!isEditing && !formData.private_key_path}
                            />

                            {error && <div className="error-text">{error}</div>}
                        </div>

                        <div className="login-row" style={{ marginTop: 20 }}>
                            {isEditing && (
                                <button type="button" className="primary-btn" style={{ background: 'transparent', width: 'auto' }} onClick={() => setIsEditing(false)}>
                                    Cancel
                                </button>
                            )}
                            <button className="primary-btn" type="submit" disabled={isLoading}>
                                {isLoading ? "Working..." : (isEditing ? "Save Profile" : "Connect")}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
}
