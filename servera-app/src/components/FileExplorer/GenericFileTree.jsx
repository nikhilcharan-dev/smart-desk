import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import { Folder, File, ArrowUp, RefreshCw, Plus, Monitor, Search, X, ChevronRight, Shield, CornerDownLeft, Pin, Check } from "lucide-react";
import "./FileExplorer.css";
import FileContextMenu from "./FileContextMenu";
import PermissionModal from "./PermissionModal";
import Modal from "../Common/Modal";
import { dragController } from "./ManualDragController";
import { useTransfers } from "./TransferContext";

const formatSize = (bytes) => {
    if (!bytes || bytes === 0) return "--";
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    if (i < 0) return "--";
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

/** Parse a path into breadcrumb segments */
const parseBreadcrumbs = (path, mode) => {
    if (!path || path === "DRIVES") return [{ label: "Computer", path: "DRIVES" }];

    if (mode === 'local') {
        const parts = path.split('\\').filter(p => p !== "");
        const crumbs = [{ label: "Computer", path: "DRIVES" }];
        let accumulated = "";
        for (const part of parts) {
            accumulated += accumulated ? `\\${part}` : part;
            // Add trailing backslash for drive root (e.g., "C:" → "C:\")
            const crumbPath = accumulated.length === 2 && accumulated.charAt(1) === ':' ? accumulated + '\\' : accumulated;
            crumbs.push({ label: part, path: crumbPath });
        }
        return crumbs;
    } else {
        // SFTP / remote
        if (path === "/") return [{ label: "/", path: "/" }];
        const parts = path.split('/').filter(p => p !== "");
        const crumbs = [{ label: "/", path: "/" }];
        let accumulated = "";
        for (const part of parts) {
            accumulated += `/${part}`;
            crumbs.push({ label: part, path: accumulated });
        }
        return crumbs;
    }
};

// mode: 'sftp' | 'local'
export default function GenericFileTree({ mode = 'sftp', initialPath = "/", profileId = null, onDropFile, onOpenFile, refreshTrigger }) {
    const { startTransfer } = useTransfers();
    const listRef = useRef(null);
    const [currentPath, setCurrentPath] = useState(initialPath);
    const [inputPath, setInputPath] = useState(initialPath);
    const [files, setFiles] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [viewMode, setViewMode] = useState('list');
    const [pathPinned, setPathPinned] = useState(false); // brief "saved" confirmation on the pin button
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState(null); // non-null = showing recursive search results
    const [searching, setSearching] = useState(false);
    const [searchCapped, setSearchCapped] = useState(false);
    const searchReqId = useRef(0);
    const [selectedFile, setSelectedFile] = useState(null);
    const [permissionFile, setPermissionFile] = useState(null);

    // Sorting state: { key: 'name' | 'size', dir: 'asc' | 'desc' }
    const [sortConfig, setSortConfig] = useState({ key: 'name', dir: 'asc' });

    // Modal State — using refs to avoid stale closure in showPrompt
    const [modal, setModal] = useState({
        isOpen: false,
        title: "",
        type: "prompt",
        confirmText: "OK",
        onConfirm: () => { },
        children: null,
        actions: null
    });
    const [modalInput, setModalInput] = useState("");
    const modalInputRef = useRef("");

    // Keep the ref in sync with state
    useEffect(() => {
        modalInputRef.current = modalInput;
    }, [modalInput]);

    const loadFiles = useCallback(async (path) => {
        setLoading(true);
        setError(null);
        try {
            const command = mode === 'sftp' ? "sftp_list" : "local_list_files";
            const args = mode === 'sftp'
                ? { sessionId: MAIN_SESSION_ID, path: path === "DRIVES" ? "" : path }
                : { path: path === "DRIVES" ? "" : path };
            const res = await invoke(command, args);
            setFiles(res);
        } catch (err) {
            console.error(`Failed to load ${mode} files:`, err);
            setError(err.toString());
        } finally {
            setLoading(false);
        }
    }, [mode]);

    // Remember currentPath as this profile's default starting path for this side
    // (local/remote), so the explorer reopens here next time instead of the hardcoded default.
    const pinTimeoutRef = useRef(null);
    const handleSetDefaultPath = useCallback(async () => {
        if (!profileId || currentPath === "DRIVES") return;
        try {
            await invoke("set_profile_default_path", { id: profileId, mode, path: currentPath });
            setPathPinned(true);
            clearTimeout(pinTimeoutRef.current);
            pinTimeoutRef.current = setTimeout(() => setPathPinned(false), 1500);
        } catch (err) {
            console.error("Failed to save default path:", err);
        }
    }, [profileId, mode, currentPath]);

    useEffect(() => () => clearTimeout(pinTimeoutRef.current), []);

    const clearSearch = useCallback(() => {
        searchReqId.current++; // invalidate any in-flight search
        setSearchQuery("");
        setSearchResults(null);
        setSearchCapped(false);
        setSearching(false);
    }, []);

    // Recursive server-side search (SFTP only) — runs a single remote find/Get-ChildItem
    // command instead of walking the tree via repeated directory listings.
    const handleRecursiveSearch = useCallback(async () => {
        if (mode !== 'sftp' || !searchQuery.trim()) return;
        const reqId = ++searchReqId.current;
        setSearching(true);
        setSearchCapped(false);
        try {
            const results = await invoke("sftp_search", {
                sessionId: MAIN_SESSION_ID,
                path: currentPath,
                query: searchQuery.trim(),
            });
            if (reqId !== searchReqId.current) return; // stale response
            setSearchResults(results);
            setSearchCapped(results.length >= 500);
        } catch (err) {
            if (reqId !== searchReqId.current) return;
            console.error("Search failed:", err);
            setSearchResults([]);
        } finally {
            if (reqId === searchReqId.current) setSearching(false);
        }
    }, [mode, currentPath, searchQuery]);

    const showAlert = useCallback((title, message) => {
        setModal({
            isOpen: true,
            title,
            type: "confirm",
            confirmText: "Close",
            children: message,
            actions: null,
            onConfirm: () => setModal(prev => ({ ...prev, isOpen: false }))
        });
    }, []);

    const showConfirm = useCallback((title, message, onConfirm) => {
        setModal({
            isOpen: true,
            title,
            type: "confirm",
            confirmText: "Execute",
            children: message,
            actions: null,
            onConfirm: () => {
                setModal(prev => ({ ...prev, isOpen: false }));
                onConfirm();
            }
        });
    }, []);

    const showPrompt = useCallback((title, defaultValue, onConfirm) => {
        setModalInput(defaultValue);
        modalInputRef.current = defaultValue;
        setModal({
            isOpen: true,
            title,
            type: "prompt",
            confirmText: "Submit",
            actions: null,
            onConfirm: () => {
                const value = modalInputRef.current;
                setModal(prev => ({ ...prev, isOpen: false }));
                onConfirm(value);
            }
        });
    }, []);

    const resolveManualDrop = useCallback(async (data, targetPath) => {
        const sep = (mode === 'local' && (targetPath.includes('\\') || targetPath === 'DRIVES')) ? '\\' : '/';
        const newPath = targetPath.endsWith(sep) ? targetPath + data.name : targetPath + sep + data.name;

        const args = mode === 'sftp' ? { sessionId: MAIN_SESSION_ID, mode, path: newPath } : { mode, path: newPath };
        const alreadyExists = await invoke("check_path_exists", args);

        const proceedWithDrop = () => {
            // Cross-Pane (Upload/Download)
            if (data.mode !== mode) {
                setModal({
                    isOpen: true,
                    title: "Drop Item",
                    type: "confirm",
                    children: `How would you like to drop ${data.name} to ${targetPath}?`,
                    actions: [
                        {
                            label: "Copy",
                            className: "primary",
                            onClick: () => {
                                setModal(m => ({ ...m, isOpen: false }));
                                onDropFile(data, targetPath, mode, 'copy');
                            }
                        },
                        {
                            label: "Move",
                            className: "primary",
                            onClick: () => {
                                setModal(m => ({ ...m, isOpen: false }));
                                onDropFile(data, targetPath, mode, 'move');
                            }
                        },
                        {
                            label: "Cancel",
                            className: "secondary",
                            onClick: () => setModal(m => ({ ...m, isOpen: false }))
                        }
                    ]
                });
                return;
            }

            // Same-Pane (Move/Copy)
            if (data.path !== newPath) {
                setModal({
                    isOpen: true,
                    title: "Drop Item",
                    type: "confirm",
                    children: `Move or Copy ${data.name} to ${targetPath}?`,
                    actions: [
                        {
                            label: "Move",
                            className: "primary",
                            onClick: async () => {
                                setModal(m => ({ ...m, isOpen: false }));
                                try {
                                    const command = mode === 'sftp' ? "sftp_rename" : "local_rename";
                                    const args = mode === 'sftp'
                                        ? { sessionId: MAIN_SESSION_ID, oldPath: data.path, newPath }
                                        : { oldPath: data.path, newPath };
                                    await invoke(command, args);
                                    loadFiles(currentPath);
                                } catch (err) {
                                    showAlert("Error", "Move failed: " + err);
                                }
                            }
                        },
                        {
                            label: "Copy",
                            className: "primary",
                            onClick: async () => {
                                setModal(m => ({ ...m, isOpen: false }));
                                showAlert("Note", "Same-pane copy not yet implemented in backend.");
                            }
                        },
                        {
                            label: "Cancel",
                            className: "secondary",
                            onClick: () => setModal(m => ({ ...m, isOpen: false }))
                        }
                    ]
                });
            }
        };

        if (alreadyExists && data.path !== newPath) {
            setModal({
                isOpen: true,
                title: "Overwrite Confirmation",
                type: "confirm",
                children: `An item named "${data.name}" already exists in the destination. Do you want to overwrite it?`,
                actions: [
                    {
                        label: "Overwrite",
                        className: "danger",
                        onClick: () => {
                            setModal(m => ({ ...m, isOpen: false }));
                            proceedWithDrop(true);
                        }
                    },
                    {
                        label: "Cancel",
                        className: "secondary",
                        onClick: () => setModal(m => ({ ...m, isOpen: false }))
                    }
                ]
            });
        } else {
            proceedWithDrop();
        }
    }, [mode, currentPath, onDropFile, loadFiles, showAlert]);

    const handleNavigate = useCallback((file) => {
        if (file.is_dir) {
            setCurrentPath(file.path);
        } else if (onOpenFile) {
            onOpenFile(file, mode);
        }
    }, [onOpenFile, mode]);

    const goUp = useCallback(() => {
        if (!currentPath || currentPath === "DRIVES") return;

        if (mode === 'local') {
            if (currentPath.match(/^[a-zA-Z]:\\?$/)) {
                setCurrentPath("DRIVES");
                return;
            }
            const parts = currentPath.split('\\').filter(p => p !== "");
            parts.pop();
            if (parts.length === 0) {
                setCurrentPath("DRIVES");
            } else {
                let parent = parts.join('\\');
                if (parent.length === 2 && parent.charAt(1) === ':') parent += '\\';
                setCurrentPath(parent);
            }
        } else {
            if (currentPath === "/" || currentPath === "") return;
            const parts = currentPath.split(/[/\\]/).filter(p => p !== "");
            if (parts.length <= 1) {
                setCurrentPath("/");
                return;
            }
            parts.pop();
            const newPath = "/" + parts.join("/");
            setCurrentPath(newPath);
        }
    }, [currentPath, mode]);

    // Parent directory of an item, derived from its own path rather than the browsed
    // currentPath — needed because search results can be nested several folders deep.
    const getParentDir = useCallback((filePath) => {
        if (mode !== 'sftp') return currentPath;
        const idx = filePath.lastIndexOf('/');
        if (idx <= 0) return '/';
        return filePath.slice(0, idx);
    }, [mode, currentPath]);

    const handleRename = useCallback((file) => {
        setContextMenu(null);
        showPrompt("Rename Item", file.name, async (newName) => {
            if (!newName || newName === file.name) return;

            const parentDir = getParentDir(file.path);
            const sep = (mode === 'local' && (parentDir.includes('\\') || parentDir === 'DRIVES')) ? '\\' : '/';
            const newPath = parentDir.endsWith(sep) ? parentDir + newName : parentDir + sep + newName;

            const checkArgs = mode === 'sftp' ? { sessionId: MAIN_SESSION_ID, mode, path: newPath } : { mode, path: newPath };
            const exists = await invoke("check_path_exists", checkArgs);
            if (exists) {
                showAlert("Conflict", `An item with the name "${newName}" already exists.`);
                return;
            }

            try {
                const command = mode === 'sftp' ? "sftp_rename" : "local_rename";
                const args = mode === 'sftp'
                    ? { sessionId: MAIN_SESSION_ID, oldPath: file.path, newPath }
                    : { oldPath: file.path, newPath };
                await invoke(command, args);
                loadFiles(currentPath);
            } catch (err) {
                showAlert("Error", "Rename failed: " + err);
            }
        });
    }, [mode, currentPath, loadFiles, showPrompt, showAlert, getParentDir]);

    const handleDelete = useCallback((file) => {
        setContextMenu(null);
        showConfirm("Delete Item", `Are you sure you want to delete ${file.name}?`, async () => {
            try {
                const command = mode === 'sftp' ? "sftp_delete" : "local_delete";
                const args = mode === 'sftp'
                    ? { sessionId: MAIN_SESSION_ID, path: file.path, isDir: file.is_dir }
                    : { path: file.path, isDir: file.is_dir };
                await invoke(command, args);
                if (selectedFile?.path === file.path) setSelectedFile(null);
                loadFiles(currentPath);
            } catch (err) {
                if (mode === 'sftp') {
                    setModal({
                        isOpen: true,
                        title: "Permission Denied",
                        type: "confirm",
                        confirmText: "Retry with Sudo",
                        children: `Delete failed: ${err}\n\nRetry with sudo (requires passwordless sudo on the server)?`,
                        onConfirm: async () => {
                            setModal(prev => ({ ...prev, isOpen: false }));
                            try {
                                await invoke("sftp_delete_sudo", { 
                                    sessionId: MAIN_SESSION_ID, 
                                    path: file.path, 
                                    isDir: file.is_dir 
                                });
                                if (selectedFile?.path === file.path) setSelectedFile(null);
                                loadFiles(currentPath);
                            } catch (sudoErr) {
                                showAlert("Sudo Error", "Sudo delete failed: " + sudoErr);
                            }
                        }
                    });
                } else {
                    showAlert("Error", "Delete failed: " + err);
                }
            }
        });
    }, [mode, currentPath, selectedFile, loadFiles, showConfirm, showAlert]);

    useEffect(() => {
        loadFiles(currentPath);
        setInputPath(currentPath === "DRIVES" ? "Computer" : currentPath);
        setSelectedFile(null);
        clearSearch();
    }, [currentPath, refreshTrigger, loadFiles, clearSearch]);

    // Listen for manual-drop on document (dispatched by ManualDragController)
    useEffect(() => {
        const handleManualDropEvent = (e) => {
            const { sourceData, targetPath, targetMode } = e.detail;
            if (targetMode === mode) {
                resolveManualDrop(sourceData, targetPath, targetMode);
            }
        };

        document.addEventListener('manual-drop', handleManualDropEvent);
        return () => document.removeEventListener('manual-drop', handleManualDropEvent);
    }, [mode, resolveManualDrop]);

    // Keyboard shortcuts
    useEffect(() => {
        const container = listRef.current?.parentElement;
        if (!container) return;

        const handleKeyDown = (e) => {
            // Only handle if this pane's container has focus somewhere inside
            if (!container.contains(document.activeElement) && document.activeElement !== container) return;

            switch (e.key) {
                case 'F5':
                    e.preventDefault();
                    loadFiles(currentPath);
                    break;
                case 'F2':
                    e.preventDefault();
                    if (selectedFile) handleRename(selectedFile);
                    break;
                case 'Delete':
                    e.preventDefault();
                    if (selectedFile) handleDelete(selectedFile);
                    break;
                case 'Enter':
                    e.preventDefault();
                    if (selectedFile) handleNavigate(selectedFile);
                    break;
                case 'Backspace':
                    e.preventDefault();
                    goUp();
                    break;
                default:
                    break;
            }
        };

        container.addEventListener('keydown', handleKeyDown);
        return () => container.removeEventListener('keydown', handleKeyDown);
    }, [currentPath, selectedFile, goUp, handleDelete, handleNavigate, handleRename, loadFiles]);

    const handlePathKeyDown = (e) => {
        if (e.key === "Enter") {
            setCurrentPath(inputPath);
        }
    };

    const handleContextMenu = (e, file = null) => {
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            file
        });
    };

    const handleCreate = (type) => {
        showPrompt(`New ${type}`, "", async (name) => {
            if (!name) return;

            const sep = (mode === 'local' && (currentPath.includes('\\') || currentPath === 'DRIVES')) ? '\\' : '/';
            if (currentPath === 'DRIVES') {
                showAlert("Error", "Cannot create files in Drive view.");
                return;
            }

            const newPath = currentPath.endsWith(sep) ? currentPath + name : currentPath + sep + name;

            try {
                let command;
                if (mode === 'sftp') {
                    command = type === 'folder' ? 'sftp_create_dir' : 'sftp_create_file';
                } else {
                    command = type === 'folder' ? 'local_create_dir' : 'local_create_file';
                }
                const args = mode === 'sftp' ? { sessionId: MAIN_SESSION_ID, path: newPath } : { path: newPath };
                await invoke(command, args);
                loadFiles(currentPath);
            } catch (err) {
                showAlert("Error", `Failed to create ${type}: ` + err);
            }
        });
    };

    const handleZip = async (file) => {
        setContextMenu(null);
        const zipName = file.name + ".zip";
        const parentDir = getParentDir(file.path);
        const sep = (mode === 'local' && (parentDir.includes('\\') || parentDir === 'DRIVES')) ? '\\' : '/';
        const dest = parentDir.endsWith(sep) ? parentDir + zipName : parentDir + sep + zipName;

        try {
            const command = mode === 'sftp' ? "sftp_zip" : "local_zip";
            const args = mode === 'sftp'
                ? { sessionId: MAIN_SESSION_ID, src: file.path, dest }
                : { src: file.path, dest };
            await invoke(command, args);
            showAlert("Success", "Compression started/finished.");
            loadFiles(currentPath);
        } catch (err) {
            showAlert("Error", "Zip failed: " + err);
        }
    };

    const handleUnzip = async (file) => {
        setContextMenu(null);
        const parentDir = getParentDir(file.path);
        try {
            const command = mode === 'sftp' ? "sftp_unzip" : "local_unzip";
            const args = mode === 'sftp'
                ? { sessionId: MAIN_SESSION_ID, src: file.path, dest: parentDir }
                : { src: file.path, dest: parentDir };
            await invoke(command, args);
            showAlert("Success", "Extraction started/finished.");
            loadFiles(currentPath);
        } catch (err) {
            showAlert("Error", "Unzip failed: " + err);
        }
    };

    const handleDownload = async (file) => {
        setContextMenu(null);
        try {
            const selectedDir = await open({
                directory: true,
                multiple: false,
                title: `Select download destination for ${file.name}`
            });

            if (selectedDir) {
                const sep = '\\';
                const localFile = selectedDir.endsWith(sep) ? selectedDir + file.name : selectedDir + sep + file.name;

                await startTransfer({
                    kind: 'download',
                    name: file.name,
                    isDir: file.isDir || false,
                    src: file.path,
                    dest: localFile,
                });
            }
        } catch (err) {
            showAlert("Error", "Download failed: " + err);
        }
    };

    const handleMouseDown = (e, file) => {
        dragController.start(e, {
            mode,
            path: file.path,
            name: file.name,
            isDir: file.is_dir
        }, onDropFile);
    };

    const handleFileClick = (e, file) => {
        e.stopPropagation();
        setSelectedFile(file);
    };

    // Sorting logic
    const toggleSort = (key) => {
        setSortConfig(prev => {
            if (prev.key === key) {
                return { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' };
            }
            return { key, dir: 'asc' };
        });
    };

    const getSortedFiles = useCallback(() => {
        // Recursive search results are already filtered server-side; otherwise
        // filter the current directory listing client-side as the user types.
        const filtered = searchResults !== null
            ? searchResults
            : files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));

        // Separate dirs and files, sort each group
        const dirs = filtered.filter(f => f.is_dir);
        const regularFiles = filtered.filter(f => !f.is_dir);

        const compare = (a, b) => {
            let result = 0;
            if (sortConfig.key === 'name') {
                result = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
            } else if (sortConfig.key === 'size') {
                result = (a.size || 0) - (b.size || 0);
            }
            return sortConfig.dir === 'desc' ? -result : result;
        };

        dirs.sort(compare);
        regularFiles.sort(compare);

        // Always show folders first
        return [...dirs, ...regularFiles];
    }, [files, searchResults, sortConfig, searchQuery]);

    const getSortIndicator = (key) => {
        if (sortConfig.key !== key) return null;
        return sortConfig.dir === 'asc' ? ' ↑' : ' ↓';
    };

    const sortedFiles = getSortedFiles();
    const breadcrumbs = parseBreadcrumbs(currentPath, mode);

    return (
        <div
            className="file-tree-container"
            tabIndex={0}
            onClick={() => { setContextMenu(null); }}
            onContextMenu={(e) => handleContextMenu(e, null)}
        >
            {/* Breadcrumb Navigation */}
            <div className="file-tree-breadcrumbs">
                {breadcrumbs.map((crumb, i) => (
                    <span key={crumb.path} className="breadcrumb-item">
                        {i > 0 && <ChevronRight size={12} className="breadcrumb-sep" />}
                        <button
                            className={`breadcrumb-btn ${i === breadcrumbs.length - 1 ? 'active' : ''}`}
                            onClick={(e) => { e.stopPropagation(); setCurrentPath(crumb.path); }}
                        >
                            {crumb.label}
                        </button>
                    </span>
                ))}
            </div>

            <div className="file-tree-header">
                <div className="path-bar">
                    <span className="mode-badge">{mode === 'sftp' ? 'REMOTE' : 'LOCAL'}</span>
                    <input
                        value={inputPath}
                        onChange={(e) => setInputPath(e.target.value)}
                        onKeyDown={handlePathKeyDown}
                        className="path-input"
                        readOnly={currentPath === "DRIVES"}
                    />
                </div>
                <div className="tree-actions">
                    <button onClick={() => setViewMode(viewMode === 'list' ? 'grid' : 'list')} title="Toggle View" className="icon-btn-small">
                        <Monitor size={16} />
                    </button>
                    <button onClick={() => handleCreate('folder')} title="New Folder" className="icon-btn-small">
                        <Plus size={16} />
                    </button>
                    <button onClick={() => handleCreate('file')} title="New File" className="icon-btn-small">
                        <File size={14} />
                    </button>
                    <button onClick={goUp} title="Up" className="icon-btn-small">
                        <ArrowUp size={16} />
                    </button>
                    <button onClick={() => loadFiles(currentPath)} title="Refresh" className="icon-btn-small">
                        <RefreshCw size={16} />
                    </button>
                    {profileId && currentPath !== "DRIVES" && (
                        <button
                            onClick={handleSetDefaultPath}
                            title={pathPinned ? "Saved as default" : `Open here by default for this profile`}
                            className={`icon-btn-small ${pathPinned ? 'pinned' : ''}`}
                        >
                            {pathPinned ? <Check size={16} /> : <Pin size={16} />}
                        </button>
                    )}
                </div>
            </div>

            {/* Sort Header (list view only) */}
            {viewMode === 'list' && (
                <div className="file-list-header">
                    <button className="sort-col sort-col-name" onClick={() => toggleSort('name')}>
                        Name{getSortIndicator('name')}
                    </button>
                    <button className="sort-col sort-col-size" onClick={() => toggleSort('size')}>
                        Size{getSortIndicator('size')}
                    </button>
                </div>
            )}

            <div
                ref={listRef}
                className={`file-list ${viewMode}`}
                data-mode={mode}
                data-current-path={currentPath}
            >
                {loading && <div className="loading-indicator">Loading...</div>}
                {searching && <div className="loading-indicator">Searching {currentPath} recursively...</div>}
                {error && <div className="error-message">{error}</div>}

                {sortedFiles.map((file) => (
                    <div
                        key={file.path}
                        className={`file-item ${viewMode === 'grid' ? 'grid-style' : 'list-style'} ${selectedFile?.path === file.path ? 'selected' : ''}`}
                        onDoubleClick={() => handleNavigate(file)}
                        onClick={(e) => handleFileClick(e, file)}
                        onContextMenu={(e) => handleContextMenu(e, file)}
                        onMouseDown={(e) => handleMouseDown(e, file)}
                        data-path={file.path}
                        data-is-dir={file.is_dir}
                        data-mode={mode}
                    >
                        <div className="file-icon">
                            {file.is_dir ? (
                                <Folder size={viewMode === 'grid' ? 32 : 18} fill="#FCD34D" stroke="#F59E0B" />
                            ) : (
                                <File size={viewMode === 'grid' ? 32 : 18} className="text-gray-400" />
                            )}
                        </div>
                        <div className="file-name" title={file.path}>{file.name}</div>
                        {viewMode === 'list' && searchResults !== null && (
                            <div className="file-path-hint" title={file.path}>{file.path}</div>
                        )}
                        {viewMode === 'list' && (
                            <div className="file-size">
                                {file.is_dir ? '--' : formatSize(file.size)}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            <div className="file-tree-footer">
                <div className="search-bar">
                    <Search size={14} className="text-gray-500 mr-2" />
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            if (searchResults !== null) setSearchResults(null); // typing after a search resumes local filtering
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                handleRecursiveSearch();
                            } else if (e.key === 'Escape') {
                                clearSearch();
                            }
                        }}
                    />
                    {mode === 'sftp' && searchQuery && searchResults === null && !searching && (
                        <span className="search-hint-chip" title="Press Enter to search all subfolders">
                            <CornerDownLeft size={9} /> all folders
                        </span>
                    )}
                    {searchQuery && (
                        <button
                            className="search-clear-btn"
                            onClick={clearSearch}
                        >
                            <X size={14} />
                        </button>
                    )}
                </div>
                <div className="item-count text-xs text-gray-400">
                    {selectedFile ? (
                        <span className="selected-info">
                            {selectedFile.name} {selectedFile.is_dir ? '' : `· ${formatSize(selectedFile.size)}`}
                        </span>
                    ) : searching ? (
                        "Searching..."
                    ) : searchResults !== null ? (
                        <span className="search-status-hint">
                            {sortedFiles.length}{searchCapped ? '+' : ''} result{sortedFiles.length === 1 ? '' : 's'} (recursive)
                        </span>
                    ) : searchQuery ? (
                        `${sortedFiles.length} matches`
                    ) : (
                        `${files.length} items`
                    )}
                </div>
            </div>

            {contextMenu && (
                <FileContextMenu
                    x={contextMenu.x}
                    y={contextMenu.y}
                    file={contextMenu.file}
                    isRemote={mode === 'sftp'}
                    onRename={handleRename}
                    onDelete={handleDelete}
                    onZip={handleZip}
                    onUnzip={handleUnzip}
                    onCreate={handleCreate}
                    onDownload={handleDownload}
                    onPermissions={() => { setContextMenu(null); setPermissionFile(contextMenu.file); }}
                    onClose={() => setContextMenu(null)}
                />
            )}

            {permissionFile && (
                <PermissionModal
                    isOpen={!!permissionFile}
                    file={permissionFile}
                    sessionId={MAIN_SESSION_ID}
                    onClose={() => { setPermissionFile(null); loadFiles(currentPath); }}
                />
            )}

            <Modal
                isOpen={modal.isOpen}
                title={modal.title}
                type={modal.type}
                confirmText={modal.confirmText}
                onConfirm={modal.onConfirm}
                onCancel={() => setModal({ ...modal, isOpen: false })}
                actions={modal.actions}
                inputValue={modalInput}
                setInputValue={(v) => { setModalInput(v); modalInputRef.current = v; }}
            >
                {modal.children}
            </Modal>
        </div>
    );
}
