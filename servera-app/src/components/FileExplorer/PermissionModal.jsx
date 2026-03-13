import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Shield, User, FileText, AlertTriangle, CheckCircle } from "lucide-react";
import Modal from "../Common/Modal";

export default function PermissionModal({ isOpen, file, sessionId, onClose }) {
    const [userInfo, setUserInfo] = useState("");
    const [filePerms, setFilePerms] = useState("");
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [actionStatus, setActionStatus] = useState(null);

    useEffect(() => {
        if (isOpen) {
            loadPermissions();
        }
    }, [isOpen, file]);

    const loadPermissions = async () => {
        if (!sessionId) {
            setError("No active session ID provided.");
            setLoading(false);
            return;
        }
        setLoading(true);
        setError(null);
        console.log("Loading permissions for session:", sessionId);
        try {
            const user = await invoke("get_remote_user_info", { sessionId });
            setUserInfo(user);
            if (file) {
                console.log("Loading file perms for:", file.path);
                const perms = await invoke("sftp_get_permissions", { sessionId, path: file.path });
                setFilePerms(perms);
            }
        } catch (err) {
            console.error("Permission load error:", err);
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    };

    const handleUpgrade = async (action) => {
        setActionStatus("Processing...");
        try {
            const result = await invoke("upgrade_remote_access", { 
                sessionId, 
                path: file?.path || "", 
                action 
            });
            setActionStatus(`Success: ${result || "Command executed"}`);
            loadPermissions();
            setTimeout(() => setActionStatus(null), 3000);
        } catch (err) {
            setError("Upgrade failed: " + err);
            setActionStatus(null);
        }
    };

    const parseUserInfo = (raw) => {
        if (!raw) return null;
        const lines = raw.split("\n").filter(l => l.trim());
        return {
            username: lines[0] || "unknown",
            idInfo: lines[1] || "",
            groups: lines[2] || "",
            sudoStatus: lines[3] || "Sudo: checking..."
        };
    };

    const parseFilePerms = (raw) => {
        if (!raw) return null;
        const parts = raw.split(/\s+/);
        if (parts.length < 9) return { raw };
        return {
            mode: parts[0],
            links: parts[1],
            owner: parts[2],
            group: parts[3],
            size: parts[4],
            date: `${parts[5]} ${parts[6]} ${parts[7]}`,
            name: parts[8]
        };
    };

    const userData = parseUserInfo(userInfo);
    const fileData = parseFilePerms(filePerms);

    if (!isOpen) return null;

    return (
        <Modal
            isOpen={isOpen}
            title={file ? "File Permissions" : "Access Control"}
            type="confirm"
            onCancel={onClose}
            actions={[
                { label: "EXIT", onClick: onClose, className: "secondary" }
            ]}
        >
            <div className="permission-modal-content">
                {loading ? (
                    <div className="text-center p-12 text-green-500">
                        <Shield className="mx-auto mb-4 animate-pulse" size={32} />
                        <div className="animate-pulse tracking-[0.3em] text-[10px] font-bold">
                            ENCRYPTED DATA ACCESS...
                        </div>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {/* USER SESSION BLOCK */}
                        <div className="section">
                            <div className="flex items-center justify-between mb-3 border-b border-green-900 pb-1">
                                <div className="flex items-center text-green-400 text-[10px] uppercase font-black tracking-widest">
                                    <User size={14} className="mr-2" /> User Identity
                                </div>
                                <div className={`text-[9px] px-2 py-0.5 rounded border ${userData?.groups?.includes('sudo') ? 'border-green-500 text-green-500 bg-green-500/10' : 'border-yellow-600 text-yellow-600 bg-yellow-600/10'}`}>
                                    {userData?.groups?.includes('sudo') ? 'ROOT PRIVILEGES' : 'STANDARD USER'}
                                </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4 text-[11px]">
                                <div className="bg-black/40 p-3 border border-green-900/30">
                                    <div className="text-green-700 text-[9px] uppercase mb-1">Username</div>
                                    <div className="text-green-400 font-mono font-bold truncate">{userData?.username}</div>
                                </div>
                                <div className="bg-black/40 p-3 border border-green-900/30">
                                    <div className="text-green-700 text-[9px] uppercase mb-1">UID/GID</div>
                                    <div className="text-green-400 font-mono text-[10px] truncate">{userData?.idInfo?.split(' ')?.[0]?.replace('uid=', '')}</div>
                                </div>
                            </div>
                            
                            <div className="mt-3 bg-black/40 p-3 border border-green-900/30">
                                <div className="text-green-700 text-[9px] uppercase mb-1">Active Groups</div>
                                <div className="text-green-500 font-mono text-[10px] leading-relaxed">
                                    {userData?.groups}
                                </div>
                            </div>
                        </div>

                        {/* FILE ATTRIBUTES BLOCK */}
                        {file && (
                            <div className="section">
                                <div className="flex items-center text-green-400 text-[10px] uppercase font-black tracking-widest mb-3 border-b border-green-900 pb-1">
                                    <FileText size={14} className="mr-2" /> File Metadata
                                </div>
                                <div className="bg-black/40 border border-green-900/30 overflow-hidden">
                                    <div className="grid grid-cols-4 gap-px bg-green-900/20">
                                        <div className="p-2 text-center border-r border-green-900/30">
                                            <div className="text-green-700 text-[8px] uppercase">Mode</div>
                                            <div className="text-green-400 font-mono text-[10px]">{fileData?.mode}</div>
                                        </div>
                                        <div className="p-2 text-center border-r border-green-900/30">
                                            <div className="text-green-700 text-[8px] uppercase">Owner</div>
                                            <div className="text-green-400 font-mono text-[10px]">{fileData?.owner}</div>
                                        </div>
                                        <div className="p-2 text-center border-r border-green-900/30">
                                            <div className="text-green-700 text-[8px] uppercase">Group</div>
                                            <div className="text-green-400 font-mono text-[10px]">{fileData?.group}</div>
                                        </div>
                                        <div className="p-2 text-center">
                                            <div className="text-green-700 text-[8px] uppercase">Size</div>
                                            <div className="text-green-400 font-mono text-[10px]">{fileData?.size}</div>
                                        </div>
                                    </div>
                                    <div className="p-2 bg-black/60 text-center border-t border-green-900/30">
                                        <div className="text-green-700 text-[8px] uppercase">Last Modified</div>
                                        <div className="text-green-500 font-mono text-[10px]">{fileData?.date}</div>
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* STATUS MESSAGES */}
                        {(error || actionStatus) && (
                            <div className="space-y-2">
                                {error && (
                                    <div className="flex items-center text-red-500 text-[10px] bg-red-900/10 p-2 border border-red-900/40 animate-pulse">
                                        <AlertTriangle size={12} className="mr-2" /> ERR: {error}
                                    </div>
                                )}
                                {actionStatus && (
                                    <div className="flex items-center text-blue-400 text-[10px] bg-blue-900/10 p-2 border border-blue-900/40">
                                        <CheckCircle size={12} className="mr-2" /> SYS: {actionStatus}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ACTION PANEL */}
                        <div className="pt-4 border-t border-green-900/40">
                            <div className="text-green-800 text-[9px] uppercase mb-3 text-center tracking-widest">Available Operations</div>
                            <div className={`grid ${file ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                                {file && (
                                    <>
                                        <button className="modal-btn" onClick={() => handleUpgrade("exec")}>
                                            CHMOD +X
                                        </button>
                                        <button className="modal-btn" onClick={() => handleUpgrade("full")}>
                                            CHMOD 777
                                        </button>
                                        <button className="modal-btn" onClick={() => handleUpgrade("own")}>
                                            CHOWN
                                        </button>
                                        <button className="modal-btn primary" onClick={() => handleUpgrade("sudoer")}>
                                            USFRMOD SUDO
                                        </button>
                                    </>
                                )}
                                {!file && (
                                    <button className="modal-btn primary py-3 text-[12px]" onClick={() => handleUpgrade("sudoer")}>
                                        UPGRADE TO SUDOER PRIVILEGES
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </Modal>
    );
}
