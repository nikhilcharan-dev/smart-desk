import { createContext, useContext, useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { MAIN_SESSION_ID } from "../../utils/terminal";

const TransferContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export function useTransfers() {
    const ctx = useContext(TransferContext);
    if (!ctx) throw new Error("useTransfers must be used within <TransferProvider>");
    return ctx;
}

const isActive = (s) => s === "uploading" || s === "downloading" || s === "queued";

// Run a single SFTP transfer for a record. Convention:
//   upload   → src = local path,  dest = remote path
//   download → src = remote path, dest = local path
async function runTransfer(rec) {
    if (rec.kind === "upload") {
        await invoke(rec.useSudo ? "sftp_upload_sudo" : "sftp_upload", {
            sessionId: MAIN_SESSION_ID,
            localPath: rec.src,
            remotePath: rec.dest,
        });
    } else {
        await invoke("sftp_download", {
            sessionId: MAIN_SESSION_ID,
            remotePath: rec.src,
            localPath: rec.dest,
        });
    }
}

export function TransferProvider({ children }) {
    const [transfers, setTransfers] = useState([]);
    const [managerOpen, setManagerOpen] = useState(false);

    // Maps a transfer's display name -> record id, so incoming progress events
    // (which only carry `root_name`) can be routed to the right record.
    const activeByName = useRef({});

    const patch = useCallback((id, changes) => {
        setTransfers((prev) => prev.map((t) => (t.id === id ? { ...t, ...changes } : t)));
    }, []);

    // Live progress from the Rust backend. Match by name to the active record.
    useEffect(() => {
        const unlisten = listen("transfer-progress", (event) => {
            const data = event.payload || {};
            const name = data.root_name || data.filename || "General";
            const id = activeByName.current[name];
            if (!id) return; // event for a transfer we didn't initiate through the store

            const changes = {};
            if (data.status && data.status !== "finished") changes.status = data.status;
            if (typeof data.progress === "number") changes.progress = data.progress;
            if (data.details) changes.details = data.details;
            if (data.filename) changes.filename = data.filename;
            if (data.error) changes.error = data.error;
            if (Object.keys(changes).length) patch(id, changes);
        });
        return () => { unlisten.then((f) => f()); };
    }, [patch]);

    // Records a transfer and executes it. Resolves on success, rejects on
    // failure so callers can keep their own orchestration (sudo fallback,
    // post-move source deletion, etc.).
    const startTransfer = useCallback(async ({ kind, name, isDir = false, src, dest, useSudo = false }) => {
        const id = (crypto.randomUUID && crypto.randomUUID()) || `${Date.now()}-${Math.random()}`;
        const rec = {
            id, kind, name, filename: name, isDir, src, dest,
            useSudo: !!useSudo,
            status: kind === "upload" ? "uploading" : "downloading",
            progress: 0, details: "", error: null, startedAt: Date.now(),
        };
        setTransfers((prev) => [rec, ...prev]);
        activeByName.current[name] = id;
        try {
            await runTransfer(rec);
            patch(id, { status: "finished", progress: 1, error: null });
        } catch (e) {
            patch(id, { status: "error", error: String(e) });
            throw e;
        } finally {
            if (activeByName.current[name] === id) delete activeByName.current[name];
        }
        return id;
    }, [patch]);

    const retry = useCallback(async (id) => {
        let rec;
        setTransfers((prev) => prev.map((t) => {
            if (t.id !== id) return t;
            rec = t;
            return { ...t, status: t.kind === "upload" ? "uploading" : "downloading", progress: 0, error: null };
        }));
        if (!rec) return;
        activeByName.current[rec.name] = id;
        try {
            await runTransfer(rec);
            patch(id, { status: "finished", progress: 1, error: null });
        } catch (e) {
            patch(id, { status: "error", error: String(e) });
        } finally {
            if (activeByName.current[rec.name] === id) delete activeByName.current[rec.name];
        }
    }, [patch]);

    const retryAllFailed = useCallback(() => {
        transfers.filter((t) => t.status === "error").forEach((t) => retry(t.id));
    }, [transfers, retry]);

    const remove = useCallback((id) => {
        setTransfers((prev) => prev.filter((t) => t.id !== id));
    }, []);

    // Clears completed + failed, keeps in-flight transfers.
    const clearFinished = useCallback(() => {
        setTransfers((prev) => prev.filter((t) => isActive(t.status)));
    }, []);

    const clearAll = useCallback(() => {
        setTransfers((prev) => prev.filter((t) => isActive(t.status)));
    }, []);

    const value = {
        transfers,
        managerOpen,
        openManager: () => setManagerOpen(true),
        closeManager: () => setManagerOpen(false),
        startTransfer,
        retry,
        retryAllFailed,
        remove,
        clearFinished,
        clearAll,
    };

    return <TransferContext.Provider value={value}>{children}</TransferContext.Provider>;
}
