import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import GenericFileTree from "./GenericFileTree";
import TransferProgress from "./TransferProgress";
import FileEditor from "./FileEditor";
import "./FileExplorer.css";

export default function FileExplorerLayout() {
    const [refreshLocal, setRefreshLocal] = useState(0);
    const [refreshRemote, setRefreshRemote] = useState(0);
    const [editingFile, setEditingFile] = useState(null); // { file, mode }

    // Handler for Cross-Pane Drops (supports 'copy' and 'move' actions)
    const handleCrossDrop = useCallback(async (data, targetPath, targetMode, action = 'copy') => {
        console.log("Cross Drop:", data, "to", targetPath, "in", targetMode, "action:", action);

        if (targetMode === 'local' && data.mode === 'sftp') {
            if (targetPath === 'DRIVES') {
                console.error("Cannot drop into Drives view.");
                return;
            }

            const localFile = targetPath.endsWith('\\') ? targetPath + data.name : targetPath + '\\' + data.name;
            const remoteFile = data.path;

            try {
                await invoke("sftp_download", {
                    sessionId: MAIN_SESSION_ID,
                    remotePath: remoteFile,
                    localPath: localFile
                });
                setRefreshLocal(prev => prev + 1);

                // If move action, delete the source file on the remote
                if (action === 'move') {
                    try {
                        await invoke("sftp_delete", {
                            sessionId: MAIN_SESSION_ID,
                            path: remoteFile,
                            isDir: data.isDir || false
                        });
                        setRefreshRemote(prev => prev + 1);
                    } catch (delErr) {
                        console.error("Move: source deletion failed:", delErr);
                    }
                }
            } catch (e) {
                console.error("Download failed:", e);
            }

        } else if (targetMode === 'sftp' && data.mode === 'local') {
            const remoteFile = targetPath.endsWith('/') ? targetPath + data.name : targetPath + '/' + data.name;
            const localFile = data.path;

            const doUpload = async (useSudo = false) => {
                const cmd = useSudo ? "sftp_upload_sudo" : "sftp_upload";
                await invoke(cmd, {
                    sessionId: MAIN_SESSION_ID,
                    localPath: localFile,
                    remotePath: remoteFile
                });
            };

            try {
                await doUpload(false);
                setRefreshRemote(prev => prev + 1);

                // If move action, delete the source file locally
                if (action === 'move') {
                    try {
                        await invoke("local_delete", {
                            path: localFile,
                            isDir: data.isDir || false
                        });
                        setRefreshLocal(prev => prev + 1);
                    } catch (delErr) {
                        console.error("Move: source deletion failed:", delErr);
                    }
                }
            } catch (e) {
                const errMsg = String(e);
                const isPermissionDenied = errMsg.includes("permission") || errMsg.includes("Permission") || errMsg.includes("SFTP(3)");
                if (isPermissionDenied && confirm(`Permission denied uploading to ${remoteFile}.\n\nRetry with sudo (requires passwordless sudo on the server)?`)) {
                    try {
                        await doUpload(true);
                        setRefreshRemote(prev => prev + 1);
                    } catch (sudoErr) {
                        console.error("Sudo upload failed:", sudoErr);
                        alert(`Sudo upload also failed: ${sudoErr}`);
                    }
                } else if (!isPermissionDenied) {
                    console.error("Upload failed:", e);
                    alert(`Upload failed: ${e}`);
                }
            }
        }
    }, []);

    const handleOpenFile = (file, mode) => {
        setEditingFile({ file, mode });
    };

    const handleSaveSuccess = () => {
        if (editingFile.mode === 'local') {
            setRefreshLocal(prev => prev + 1);
        } else {
            setRefreshRemote(prev => prev + 1);
        }
    };

    return (
        <div className="explorer-split-view">
            <div className="explorer-pane">
                <GenericFileTree
                    mode="local"
                    initialPath="DRIVES"
                    onDropFile={handleCrossDrop}
                    onOpenFile={handleOpenFile}
                    refreshTrigger={refreshLocal}
                />
            </div>
            <div className="explorer-divider"></div>
            <div className="explorer-pane">
                <GenericFileTree
                    mode="sftp"
                    initialPath="/home"
                    onDropFile={handleCrossDrop}
                    onOpenFile={handleOpenFile}
                    refreshTrigger={refreshRemote}
                />
            </div>

            {editingFile && (
                <FileEditor
                    file={editingFile.file}
                    mode={editingFile.mode}
                    onClose={() => setEditingFile(null)}
                    onSaveSuccess={handleSaveSuccess}
                />
            )}

            <TransferProgress />
        </div>
    );
}
