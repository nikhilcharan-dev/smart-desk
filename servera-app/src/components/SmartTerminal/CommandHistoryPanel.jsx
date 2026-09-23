import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
    Terminal, Clock, RefreshCw, Trash2, X, Search, Copy, Check, Play,
    PanelRightClose, User, Server, Layers, CornerDownLeft
} from "lucide-react";
import "./CommandHistoryPanel.css";

export default function CommandHistoryPanel({
    isOpen,
    onClose,
    onRun,
    user,
    ip,
    profileId,
    sessionId = "main-session",
}) {
    const storageKey = profileId
        ? `servera_cmd_history:profile:${profileId}`
        : `servera_cmd_history:${user}@${ip}`;

    const [history, setHistory] = useState([]);
    const [search, setSearch] = useState("");
    const [filter, setFilter] = useState("all"); // 'all' | 'host' | 'other-users' | 'sessions'
    const [syncing, setSyncing] = useState(false);
    const [copiedId, setCopiedId] = useState(null);
    const [quickInput, setQuickInput] = useState("");
    const [panelWidth, setPanelWidth] = useState(320);

    // Resizing
    const isDraggingRef = useRef(false);
    const dragStartXRef = useRef(0);
    const dragStartWidthRef = useRef(320);

    // Load saved history from localStorage on mount or host change
    useEffect(() => {
        try {
            const raw = localStorage.getItem(storageKey);
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) setHistory(parsed);
            }
        } catch (e) {
            console.warn("Failed to load command history from localStorage", e);
        }
    }, [storageKey]);

    // Save helper
    const persistHistory = (updated) => {
        setHistory(updated);
        try {
            localStorage.setItem(storageKey, JSON.stringify(updated.slice(0, 300)));
        } catch (e) {
            console.warn("Failed to persist command history", e);
        }
    };

    // Sync shell history from host (current user + other users if available)
    const syncHostHistory = async () => {
        setSyncing(true);
        try {
            // Command scans current user's history as well as other users' ~/.bash_history /root/.bash_history
            const script = `
                for f in ~/.bash_history ~/.zsh_history /home/*/.bash_history /root/.bash_history; do
                    if [ -f "$f" ]; then
                        u=$(echo "$f" | sed -E 's|/home/([^/]+)/.*|\\1|; s|/root/.*|root|; s|/.*current|current|')
                        tail -n 80 "$f" 2>/dev/null | while read -r line; do
                            [ -n "$line" ] && echo "[$u] $line"
                        done
                    fi
                done
            `;
            const raw = await invoke("exec_ssh_command", {
                sessionId: sessionId || "main-session",
                command: script,
            });

            if (raw && typeof raw === "string") {
                const lines = raw.split("\n")
                    .map(l => l.trim())
                    .filter(l => l && !l.includes("] #"));

                const existingCmds = new Set(history.map(h => h.command));
                const newEntries = [];

                // Reverse to get most recent first
                const reversed = lines.reverse();
                for (const line of reversed) {
                    const match = line.match(/^\[([^\]]+)\]\s*(.*)$/);
                    const tagUser = match ? match[1] : (user || "host");
                    const cmd = match ? match[2].trim() : line.trim();

                    if (cmd && !existingCmds.has(cmd)) {
                        existingCmds.add(cmd);
                        const isOtherUser = tagUser !== "current" && tagUser !== user;
                        newEntries.push({
                            id: "hst-" + Math.random().toString(36).slice(2, 9),
                            command: cmd,
                            targetUser: tagUser === "current" ? user : tagUser,
                            source: isOtherUser ? "other-user" : "host",
                            timestamp: "Host Shell",
                        });
                    }
                }

                if (newEntries.length > 0) {
                    persistHistory([...newEntries, ...history]);
                }
            }
        } catch (err) {
            console.error("Failed to sync host command history", err);
        } finally {
            setSyncing(false);
        }
    };

    // Copy command
    const handleCopy = (id, cmd) => {
        navigator.clipboard.writeText(cmd);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1400);
    };

    // Run / Paste in Terminal
    const handleRun = (cmd) => {
        if (onRun) {
            onRun(cmd);
        }
    };

    // Delete single item
    const handleDeleteItem = (id) => {
        const updated = history.filter(h => h.id !== id);
        persistHistory(updated);
    };

    // Clear all
    const handleClearAll = () => {
        if (window.confirm("Clear all recorded command history for this server?")) {
            persistHistory([]);
            try {
                localStorage.removeItem(storageKey);
            } catch (e) { /* ignore */ }
        }
    };

    // Quick run from input
    const handleQuickSubmit = (e) => {
        e.preventDefault();
        const cmd = quickInput.trim();
        if (!cmd) return;
        setQuickInput("");
        handleRun(cmd);
    };

    // Filter items
    const filtered = history.filter(item => {
        if (filter === "host" && item.source !== "host") return false;
        if (filter === "other-users" && item.source !== "other-user") return false;
        if (filter === "sessions" && (item.source === "host" || item.source === "other-user")) return false;
        if (search.trim()) {
            const q = search.toLowerCase().trim();
            return item.command.toLowerCase().includes(q) || (item.targetUser && item.targetUser.toLowerCase().includes(q));
        }
        return true;
    });

    const hostCount = history.filter(h => h.source === "host").length;
    const otherUserCount = history.filter(h => h.source === "other-user").length;
    const sessionCount = history.filter(h => h.source !== "host" && h.source !== "other-user").length;

    // Resizing logic
    const handleMouseDown = (e) => {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartWidthRef.current = panelWidth;
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        e.preventDefault();
    };

    const handleMouseMove = (e) => {
        if (!isDraggingRef.current) return;
        const delta = dragStartXRef.current - e.clientX;
        const newW = Math.min(560, Math.max(240, dragStartWidthRef.current + delta));
        setPanelWidth(newW);
    };

    const handleMouseUp = () => {
        isDraggingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
    };

    if (!isOpen) return null;

    return (
        <div className="cmd-history-container" style={{ width: panelWidth }}>
            {/* Drag Resizer on Left Edge */}
            <div
                className="cmd-history-resizer"
                onMouseDown={handleMouseDown}
                title="Drag to resize Command History"
            />

            <div className="cmd-history-content">
                {/* Header */}
                <div className="cmd-history-header">
                    <div className="cmd-history-title-row">
                        <Clock size={14} className="text-cyan-400" />
                        <span className="cmd-history-title">Command History</span>
                        <span className="cmd-history-badge">{history.length}</span>
                    </div>
                    <div className="cmd-history-actions">
                        <button
                            className="cmd-history-icon-btn"
                            onClick={syncHostHistory}
                            title="Sync Bash/Zsh History from Host & Other Users"
                            disabled={syncing}
                        >
                            <RefreshCw size={13} className={syncing ? "animate-spin text-cyan-400" : ""} />
                        </button>
                        {history.length > 0 && (
                            <button
                                className="cmd-history-icon-btn"
                                onClick={handleClearAll}
                                title="Clear History"
                            >
                                <Trash2 size={13} />
                            </button>
                        )}
                        <button
                            className="cmd-history-icon-btn"
                            onClick={onClose}
                            title="Close History Panel"
                        >
                            <PanelRightClose size={14} />
                        </button>
                    </div>
                </div>

                {/* Search Bar */}
                <div className="cmd-history-search-row">
                    <div className="cmd-history-search-box">
                        <Search size={13} className="text-gray-400 flex-shrink-0" />
                        <input
                            className="cmd-history-search-input"
                            placeholder="Search commands or user..."
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        {search && (
                            <button
                                className="cmd-history-icon-btn"
                                onClick={() => setSearch("")}
                                style={{ padding: 2 }}
                            >
                                <X size={11} />
                            </button>
                        )}
                    </div>
                </div>

                {/* Filter Pills */}
                <div className="cmd-history-pills">
                    <button
                        className={`cmd-history-pill ${filter === "all" ? "active" : ""}`}
                        onClick={() => setFilter("all")}
                    >
                        All ({history.length})
                    </button>
                    <button
                        className={`cmd-history-pill ${filter === "host" ? "active" : ""}`}
                        onClick={() => setFilter("host")}
                        title="Shell history from connected user"
                    >
                        Host ({hostCount})
                    </button>
                    {otherUserCount > 0 && (
                        <button
                            className={`cmd-history-pill ${filter === "other-users" ? "active" : ""}`}
                            onClick={() => setFilter("other-users")}
                            title="History from other system users (root, etc.)"
                        >
                            Other Users ({otherUserCount})
                        </button>
                    )}
                    <button
                        className={`cmd-history-pill ${filter === "sessions" ? "active" : ""}`}
                        onClick={() => setFilter("sessions")}
                        title="Previous Servera app sessions"
                    >
                        Sessions ({sessionCount})
                    </button>
                </div>

                {/* Quick Run Input Bar */}
                <form className="cmd-history-quick-bar" onSubmit={handleQuickSubmit}>
                    <span className="cmd-prompt-glyph">$</span>
                    <input
                        className="cmd-quick-input"
                        placeholder="Send command to terminal..."
                        value={quickInput}
                        onChange={(e) => setQuickInput(e.target.value)}
                    />
                    <button
                        type="submit"
                        className="cmd-quick-btn"
                        disabled={!quickInput.trim()}
                        title="Send to Terminal"
                    >
                        <CornerDownLeft size={12} />
                    </button>
                </form>

                {/* List of Commands */}
                <div className="cmd-history-list">
                    {filtered.length === 0 ? (
                        <div className="cmd-history-empty">
                            <Clock size={24} className="text-gray-600" />
                            <span>No commands found</span>
                            <span className="cmd-empty-hint">
                                {search
                                    ? "Try a different search query"
                                    : "Click ↺ to sync ~/.bash_history from the server"}
                            </span>
                        </div>
                    ) : (
                        filtered.map((item) => (
                            <div key={item.id} className="cmd-history-card">
                                <div className="cmd-card-header">
                                    <div className="cmd-card-meta">
                                        {item.source === "other-user" ? (
                                            <span className="cmd-user-badge other" title={`Command from user: ${item.targetUser}`}>
                                                <User size={10} /> {item.targetUser}
                                            </span>
                                        ) : item.source === "host" ? (
                                            <span className="cmd-user-badge host" title="From host shell history">
                                                <Server size={10} /> {item.targetUser || user || "host"}
                                            </span>
                                        ) : (
                                            <span className="cmd-user-badge session" title="From previous Servera session">
                                                <Layers size={10} /> session
                                            </span>
                                        )}
                                    </div>
                                    <span className="cmd-card-time">{item.timestamp || "Past"}</span>
                                </div>

                                <div className="cmd-code-box" onClick={() => handleCopy(item.id, item.command)} title="Click to copy">
                                    <code>{item.command}</code>
                                </div>

                                <div className="cmd-card-footer">
                                    <button
                                        className="cmd-card-btn run"
                                        onClick={() => handleRun(item.command)}
                                        title="Run command in active terminal"
                                    >
                                        <Play size={10} />
                                        <span>Run</span>
                                    </button>
                                    <button
                                        className="cmd-card-btn"
                                        onClick={() => handleCopy(item.id, item.command)}
                                        title="Copy to clipboard"
                                    >
                                        {copiedId === item.id ? (
                                            <span style={{ color: "#22c55e", display: "flex", alignItems: "center", gap: 3 }}>
                                                <Check size={10} /> Copied
                                            </span>
                                        ) : (
                                            <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
                                                <Copy size={10} /> Copy
                                            </span>
                                        )}
                                    </button>
                                    <button
                                        className="cmd-card-btn delete"
                                        onClick={() => handleDeleteItem(item.id)}
                                        title="Delete entry"
                                    >
                                        <Trash2 size={10} />
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </div>
        </div>
    );
}
