import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import { formatRemoteError } from "../../utils/errors";
import GenericFileTree from "./GenericFileTree";
import TransferProgress from "./TransferProgress";
import TransferManager from "./TransferManager";
import { TransferProvider, useTransfers } from "./TransferContext";
import FileEditor from "./FileEditor";
import "./FileExplorer.css";

const FALLBACK_LOCAL_PATH = "DRIVES";
const FALLBACK_REMOTE_PATH = "/home";

// Guard against a saved default that no longer exists (folder deleted/moved/renamed
// since it was pinned) — fall back to the normal hardcoded starting path instead.
async function resolveStartPath(mode, savedPath, fallback) {
    if (!savedPath) return fallback;
    try {
        const exists = await invoke("check_path_exists", {
            sessionId: mode === 'sftp' ? MAIN_SESSION_ID : undefined,
            mode,
            path: savedPath,
        });
        return exists ? savedPath : fallback;
    } catch {
        return fallback;
    }
}

export default function FileExplorerLayout(props) {
    return (
        <TransferProvider>
            <FileExplorerLayoutInner {...props} />
        </TransferProvider>
    );
}

function FileExplorerLayoutInner({ profileId }) {
    const { startTransfer } = useTransfers();
    const [refreshLocal, setRefreshLocal] = useState(0);
    const [refreshRemote, setRefreshRemote] = useState(0);
    const [editingFile, setEditingFile] = useState(null); // { file, mode }

    // Per-profile default starting paths — resolved before the trees mount so
    // they open directly at the saved path instead of flashing the hardcoded default.
    const [defaultPaths, setDefaultPaths] = useState({ local: FALLBACK_LOCAL_PATH, remote: FALLBACK_REMOTE_PATH });
    const [resolvedForId, setResolvedForId] = useState(undefined); // undefined = nothing resolved yet
    const pathsReady = resolvedForId === (profileId || null);

    useEffect(() => {
        let cancelled = false;

        const fetchDefaults = profileId
            ? invoke("load_profiles")
                .then((profiles) => {
                    const profile = profiles.find((p) => p.id === profileId);
                    return Promise.all([
                        resolveStartPath('local', profile?.default_local_path, FALLBACK_LOCAL_PATH),
                        resolveStartPath('sftp', profile?.default_remote_path, FALLBACK_REMOTE_PATH),
                    ]).then(([local, remote]) => ({ local, remote }));
                })
                .catch((err) => {
                    console.error("Failed to load profile default paths:", err);
                    return { local: FALLBACK_LOCAL_PATH, remote: FALLBACK_REMOTE_PATH };
                })
            : Promise.resolve({ local: FALLBACK_LOCAL_PATH, remote: FALLBACK_REMOTE_PATH });

        fetchDefaults.then((paths) => {
            if (cancelled) return;
            setDefaultPaths(paths);
            setResolvedForId(profileId || null);
        });

        return () => { cancelled = true; };
    }, [profileId]);

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
                await startTransfer({
                    kind: 'download',
                    name: data.name,
                    isDir: data.isDir || false,
                    src: remoteFile,
                    dest: localFile,
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
                alert(formatRemoteError(e, `Downloading ${data.name}`));
            }

        } else if (targetMode === 'sftp' && data.mode === 'local') {
            const remoteFile = targetPath.endsWith('/') ? targetPath + data.name : targetPath + '/' + data.name;
            const localFile = data.path;

            try {
                // `sftp_upload` stages through /tmp and moves into place with
                // sudo by itself when the destination is not writable, so there
                // is no separate elevated retry to offer here.
                await startTransfer({
                    kind: 'upload',
                    name: data.name,
                    isDir: data.isDir || false,
                    src: localFile,
                    dest: remoteFile,
                });
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
                console.error("Upload failed:", e);
                alert(formatRemoteError(e, `Uploading ${data.name} to ${remoteFile}`));
            }
        }
    }, [startTransfer]);

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

    if (!pathsReady) {
        return <div className="explorer-split-view" />;
    }

    return (
        <div className="explorer-split-view">
            <div className="explorer-pane">
                <GenericFileTree
                    key={`local-${profileId || 'quick'}`}
                    mode="local"
                    initialPath={defaultPaths.local}
                    profileId={profileId}
                    onDropFile={handleCrossDrop}
                    onOpenFile={handleOpenFile}
                    refreshTrigger={refreshLocal}
                />
            </div>
            <div className="explorer-divider"></div>
            <div className="explorer-pane">
                <GenericFileTree
                    key={`sftp-${profileId || 'quick'}`}
                    mode="sftp"
                    initialPath={defaultPaths.remote}
                    profileId={profileId}
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
            <TransferManager />
        </div>
    );
}
