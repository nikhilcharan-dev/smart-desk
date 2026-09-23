import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    Send, X, Loader2, Copy, Sparkles, RotateCcw,
    CheckCircle2, Circle, AlertCircle, Play, StopCircle,
    Pencil, Trash2, ChevronRight, Bot, Columns2,
    PlusCircle, MessageSquare, History, PanelLeftClose, PanelLeftOpen,
    Palette, Check, Code2, ArrowRightLeft, Cloud, Plus
} from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./SmartTerminal.css";

/* ──────────────────────────────────
   PLAN PARSER
   ────────────────────────────────── */

/**
 * Parse AI output into a structured command plan.
 * Strategy:
 *   1. Try strict format: `N. \`command\` - description`
 *   2. Fallback: numbered lines with backtick-wrapped commands (no dash separator)
 *   3. Fallback: extract ```bash code blocks
 * Sanitises extracted commands by stripping comments/explanations that
 * the LLM occasionally leaks inside backticks.
 */
function sanitizeCommand(raw) {
    // Strip leading/trailing whitespace
    let cmd = raw.trim();
    // Remove inline comments the LLM sometimes appends (e.g. "apt update # updates packages")
    // But keep comments that are part of real shell syntax (heredocs, sed, etc.)
    // Simple heuristic: only strip if the comment looks like natural language
    cmd = cmd.replace(/\s+#\s+[A-Z][a-z].*$/gm, '');
    // Remove leading "Run: " or "Execute: " prefixes
    cmd = cmd.replace(/^(?:Run|Execute|Then|Next|First|Finally)[:\s]+/i, '');
    // Remove wrapping backticks if the LLM double-wrapped
    cmd = cmd.replace(/^`+|`+$/g, '');
    return cmd.trim();
}

function parsePlan(content) {
    const commands = [];
    let match;

    // Strategy 0: ```opsplan fenced JSON block — the primary, most reliable
    // format (see the system prompt). Falls through to the regex-based
    // strategies below if the model didn't follow it or emitted malformed JSON.
    const opsplanMatch = /```opsplan\s*\n([\s\S]*?)```/.exec(content);
    if (opsplanMatch) {
        try {
            const parsed = JSON.parse(opsplanMatch[1].trim());
            if (Array.isArray(parsed)) {
                const jsonCommands = parsed
                    .filter(item => item && typeof item.command === "string" && item.command.trim())
                    .map(item => ({
                        text: sanitizeCommand(item.command),
                        description: typeof item.description === "string" ? item.description.trim() : "",
                        status: "pending",
                        enabled: true,
                        editing: false,
                        exitCode: null,
                        duration: null,
                    }));
                if (jsonCommands.length > 0) return jsonCommands;
            }
        } catch {
            // Malformed JSON — fall through to the regex-based strategies.
        }
    }

    // Strategy 1: Strict format — N. `command` - description
    const strictRegex = /^\d+\.\s+`([^`]+)`\s*[-–—]\s*(.+)$/gm;
    while ((match = strictRegex.exec(content)) !== null) {
        const cmd = sanitizeCommand(match[1]);
        if (cmd) {
            commands.push({
                text: cmd,
                description: match[2].trim(),
                status: "pending",
                enabled: true,
                editing: false,
                exitCode: null,
                duration: null,
            });
        }
    }
    if (commands.length > 0) return commands;

    // Strategy 2: Numbered list with backtick commands but no dash
    // e.g. "1. `apt update`" or "1. `apt update` updates the package list"
    const looseRegex = /^\d+\.\s+`([^`]+)`(?:\s*[-–—]?\s*(.*))?$/gm;
    while ((match = looseRegex.exec(content)) !== null) {
        const cmd = sanitizeCommand(match[1]);
        if (cmd) {
            commands.push({
                text: cmd,
                description: (match[2] || "").trim(),
                status: "pending",
                enabled: true,
                editing: false,
                exitCode: null,
                duration: null,
            });
        }
    }
    if (commands.length > 0) return commands;

    // Strategy 3: Extract ```bash code blocks.
    // Treat each block as ONE command, not one-per-line — a block may be a
    // single multi-line script (loop, if/else, heredoc) that splitting would shred.
    const bashRegex = /```(?:bash|sh)?\s*\n([\s\S]*?)```/g;
    while ((match = bashRegex.exec(content)) !== null) {
        const block = match[1].trim();
        if (block) {
            commands.push({
                text: sanitizeCommand(block),
                description: "",
                status: "pending",
                enabled: true,
                editing: false,
                exitCode: null,
                duration: null,
            });
        }
    }
    return commands.length > 0 ? commands : null;
}

/* ──────────────────────────────────
   EXECUTION TIMEOUTS
   ────────────────────────────────── */

// A running command is judged by silence, not by elapsed time: as long as it
// keeps printing to the PTY it may run as long as it likes. Only this much
// output-free time counts as a stall.
const STALL_IDLE_MS = 10 * 60 * 1000;
// Absolute ceiling so a chain can never poll forever.
const HARD_TIMEOUT_MS = 6 * 60 * 60 * 1000;

/* ──────────────────────────────────
   THEMES
   ────────────────────────────────── */

const THEMES = [
    { id: "github-dark",  name: "GitHub Dark",    swatch: "#0d1117", accent: "#58a6ff" },
    { id: "dracula",      name: "Dracula",         swatch: "#282a36", accent: "#bd93f9" },
    { id: "nord",         name: "Nord",            swatch: "#2e3440", accent: "#88c0d0" },
    { id: "monokai",      name: "Monokai",         swatch: "#272822", accent: "#a6e22e" },
    { id: "solarized",    name: "Solarized Dark",  swatch: "#002b36", accent: "#268bd2" },
    { id: "one-dark",     name: "One Dark",        swatch: "#282c34", accent: "#61afef" },
];

/* ──────────────────────────────────
   SMART TERMINAL COMPONENT
   ────────────────────────────────── */

export default function SmartTerminal({
    xtermRef, onClose, layout: _layout, onLayoutChange: _onLayoutChange,
    ip, user, port, password, privateKey, proxyJump, profileId,
    onOpenCloudBrowser,
}) {
    // OpsPilot conversations store real command output from the connected host,
    // so they are scoped per connection the same way LogViewer scopes its tabs.
    // A single global key meant the previous VM's outputs reappeared after
    // logging out and connecting somewhere else.
    const sessionsKey = profileId ? `opspilot_sessions:profile:${profileId}` : `opspilot_sessions:${user}@${ip}`;
    const activeSessionKey = `${sessionsKey}:active`;

    // Core state
    const [prompt, setPrompt] = useState("");
    const [timeline, setTimeline] = useState([]); // Array of timeline entries
    const [aiLoading, setAiLoading] = useState(false);
    const [streamBuffer, setStreamBuffer] = useState("");
    const [detectedError, setDetectedError] = useState(null); // { message, type }

    // Execution state
    const [executingPlanIdx, setExecutingPlanIdx] = useState(-1); // Which timeline plan is executing
    // eslint-disable-next-line no-unused-vars
    const [executingCmdIdx, setExecutingCmdIdx] = useState(-1);
    const chainRef = useRef(false);
    const executeCommandAtRef = useRef(null);
    const retryCountRef = useRef(0);
    // Timestamp of the last byte seen on the PTY. The exit-code poller uses this
    // instead of a fixed wall-clock budget so a genuinely long build/install is
    // never mistaken for a hang.
    const lastOutputAtRef = useRef(Date.now());
    const timelineRef = useRef([]); // mirrors `timeline` so the exec chain always reads live state
    const MAX_RETRIES = 3;

    useEffect(() => {
        timelineRef.current = timeline;
    }, [timeline]);

    // Chat history for AI context continuity
    const chatHistoryRef = useRef([]);

    // Auto-scroll
    const timelineEndRef = useRef(null);

    // Sessions management
    const [sessions, setSessions] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarWidth, setSidebarWidth] = useState(260);

    // Theme
    const [themeId, setThemeId] = useState(() => localStorage.getItem("opspilot_theme") || "github-dark");
    const [showThemePicker, setShowThemePicker] = useState(false);

    // VS Code Tunnel — launches local VS Code Desktop via Remote-SSH
    const [vscodeBusy, setVscodeBusy] = useState(false);
    const [vscodeStatus, setVscodeStatus] = useState(null); // { type: "error"|"info", message }

    // Other Tunnels — quick popover for forwarding/viewing ports without leaving the terminal
    const [showTunnelPopover, setShowTunnelPopover] = useState(false);
    const [popoverTunnels, setPopoverTunnels] = useState([]);
    const [quickLocalPort, setQuickLocalPort] = useState("");
    const [quickRemotePort, setQuickRemotePort] = useState("");
    const [quickTunnelBusy, setQuickTunnelBusy] = useState(false);
    const [quickTunnelError, setQuickTunnelError] = useState(null);

    // Sidebar drag-resize refs
    const isDraggingRef = useRef(false);
    const dragStartXRef = useRef(0);
    const dragStartWidthRef = useRef(260);
    const SIDEBAR_MIN = 180;
    const SIDEBAR_MAX = 420;
    const SIDEBAR_COLLAPSE_AT = 100;

    // Persist theme selection
    useEffect(() => {
        localStorage.setItem("opspilot_theme", themeId);
    }, [themeId]);

    // Global mouse handlers for left sidebar drag-to-resize
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (isDraggingRef.current) {
                const delta = e.clientX - dragStartXRef.current;
                const newW = dragStartWidthRef.current + delta;
                if (newW < SIDEBAR_COLLAPSE_AT) {
                    setSidebarOpen(false);
                } else {
                    setSidebarOpen(true);
                    setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, newW)));
                }
            }
        };
        const handleMouseUp = () => {
            if (isDraggingRef.current) {
                isDraggingRef.current = false;
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            }
        };
        document.addEventListener("mousemove", handleMouseMove);
        document.addEventListener("mouseup", handleMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, []);

    const handleResizerMouseDown = useCallback((e) => {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartWidthRef.current = sidebarOpen ? sidebarWidth : 0;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    }, [sidebarOpen, sidebarWidth]);

    const cmdHistoryKey = profileId
        ? `servera_cmd_history:profile:${profileId}`
        : `servera_cmd_history:${user}@${ip}`;

    // Append or update command history entry in shared storage
    const recordExecutedCommand = useCallback(({
        id = null,
        command,
        status = "completed",
        exitCode = null,
        duration = null,
        source = "plan",
    }) => {
        if (!command || !command.trim()) return null;
        const trimmed = command.trim();
        const entryId = id || (Date.now().toString(36) + Math.random().toString(36).slice(2, 6));

        try {
            const raw = localStorage.getItem(cmdHistoryKey);
            let prev = [];
            if (raw) {
                const parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) prev = parsed;
            }
            const existingIdx = prev.findIndex(item => item.id === entryId);
            let updated;
            if (existingIdx >= 0) {
                updated = [...prev];
                updated[existingIdx] = {
                    ...updated[existingIdx],
                    command: trimmed,
                    status,
                    exitCode: exitCode !== null ? exitCode : updated[existingIdx].exitCode,
                    duration: duration !== null ? duration : updated[existingIdx].duration,
                    source: source || updated[existingIdx].source,
                };
            } else {
                const newEntry = {
                    id: entryId,
                    command: trimmed,
                    status,
                    exitCode,
                    duration,
                    source,
                    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
                };
                updated = [newEntry, ...prev.slice(0, 199)];
            }
            localStorage.setItem(cmdHistoryKey, JSON.stringify(updated.slice(0, 150)));
        } catch (err) {
            console.warn("Failed to persist command history", err);
        }

        return entryId;
    }, [cmdHistoryKey]);

    // Global listener for commands dispatched from elsewhere in the app
    useEffect(() => {
        const handler = (e) => {
            if (e.detail?.command) {
                recordExecutedCommand({
                    command: e.detail.command,
                    status: e.detail.status || "executed",
                    source: e.detail.source || "external",
                });
            }
        };
        window.addEventListener("servera-command-executed", handler);
        return () => window.removeEventListener("servera-command-executed", handler);
    }, [recordExecutedCommand]);

    // Initial load from localStorage
    useEffect(() => {
        const savedSessions = localStorage.getItem(sessionsKey);
        const lastActiveId = localStorage.getItem(activeSessionKey);

        let loadedSessions = [];
        if (savedSessions) {
            try {
                loadedSessions = JSON.parse(savedSessions);
                setSessions(loadedSessions);
            } catch (e) {
                console.error("Failed to parse saved sessions", e);
            }
        }

        // Start a fresh conversation when this connection has none. Nothing is
        // carried over from another host: the timeline holds that host's real
        // command output, so importing it would put the previous VM's results
        // in front of the current one.
        if (loadedSessions.length === 0) {
            const newSession = {
                id: Date.now().toString(),
                title: "New Conversation",
                timeline: [],
                // No system-role entry here — the backend prepends the user's
                // configured system prompt (Settings > AI > System Prompt) on
                // every request. Keeping a second copy here caused the two to
                // silently contradict each other when a user customized theirs.
                chatHistory: [],
                timestamp: new Date().toLocaleString()
            };
            
            setSessions([newSession]);
            setActiveSessionId(newSession.id);
            setTimeline(newSession.timeline);
            chatHistoryRef.current = newSession.chatHistory;
        } else {
            const activeId = lastActiveId || loadedSessions[0].id;
            const active = loadedSessions.find(s => s.id === activeId) || loadedSessions[0];
            setActiveSessionId(active.id);
            setTimeline(active.timeline);
            // Strip any system-role entry persisted by older versions of this app.
            chatHistoryRef.current = (active.chatHistory || []).filter(m => m.role !== "system");
        }

        // Drop the pre-scoping global keys. They are host-agnostic, so there is
        // no safe host to attribute them to and nothing to migrate them into.
        localStorage.removeItem("opspilot_timeline");
        localStorage.removeItem("opspilot_chat_history");
        localStorage.removeItem("opspilot_sessions");
        localStorage.removeItem("opspilot_active_session_id");
    // Storage keys are fixed for the component's lifetime — it remounts per connection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Save current active session data to sessions list and localStorage
    useEffect(() => {
        if (!activeSessionId) return;

        setSessions(prev => {
            const updated = prev.map(s => {
                if (s.id === activeSessionId) {
                    return {
                        ...s,
                        timeline: timeline,
                        chatHistory: chatHistoryRef.current,
                        timestamp: new Date().toLocaleString()
                    };
                }
                return s;
            });
            localStorage.setItem(sessionsKey, JSON.stringify(updated));
            localStorage.setItem(activeSessionKey, activeSessionId);
            return updated;
        });
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeline, activeSessionId]);

    useEffect(() => {
        timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [timeline, aiLoading, streamBuffer]);

    // Listen for AI stream events
    useEffect(() => {
        let unlistenChunk, unlistenDone;
        let cancelled = false;
        // `cancelled` closes the gap between registering the listener and the
        // promise resolving: an unmount in that window used to leave `unlisten`
        // undefined, so the handler stayed attached for the rest of the session.

        listen("ai-response-chunk", (event) => {
            setStreamBuffer(prev => prev + event.payload);
        }).then(f => { if (cancelled) f(); else unlistenChunk = f; });

        listen("ai-response-done", () => {
            setStreamBuffer(prev => {
                if (prev) {
                    // Finalize: parse plan or create message entry
                    const commands = parsePlan(prev);
                    if (commands) {
                        setTimeline(t => [...t, { type: "plan", commands, rawContent: prev, timestamp: new Date().toLocaleTimeString() }]);
                    } else {
                        setTimeline(t => [...t, { type: "ai_message", content: prev, timestamp: new Date().toLocaleTimeString() }]);
                    }
                    // Add to chat history
                    chatHistoryRef.current.push({ role: "assistant", content: prev });
                }
                setAiLoading(false);
                return "";
            });
        }).then(f => { if (cancelled) f(); else unlistenDone = f; });

        return () => {
            cancelled = true;
            if (unlistenChunk) unlistenChunk();
            if (unlistenDone) unlistenDone();
        };
    }, []);

    // Monitor terminal output for errors with a rolling buffer
    useEffect(() => {
        let unlisten;
        let cancelled = false;
        // `cancelled` closes the gap between registering the listener and the
        // promise resolving: an unmount in that window used to leave `unlisten`
        // undefined, so the handler stayed attached for the rest of the session.
        const bufferRef = { text: "" };
        const bufferTimeoutRef = { current: null };

        const errorPatterns = [
            /bash: .+: command not found/i,
            /Permission denied/i,
            /Error: .+/i,
            /fatal: .+/i,
            /Traceback \(most recent call last\):/i,
            /SyntaxError: .+/i,
            /No such file or directory/i,
            /git: '.+' is not a git command/i, // Added git specific pattern
            /npm ERR!/i,
            /node:.+ error/i,
            /ModuleNotFoundError/i,
            /ImportError/i
        ];

        const checkBufferForErrors = () => {
            const output = bufferRef.text;
            for (const pattern of errorPatterns) {
                if (pattern.test(output)) {
                    const match = output.match(pattern);
                    setDetectedError({
                        message: match[0].trim(),
                        type: "terminal_error",
                        timestamp: Date.now()
                    });
                    
                    // Clear error suggestion after 15 seconds
                    setTimeout(() => setDetectedError(prev => 
                        (prev && Date.now() - prev.timestamp >= 14000) ? null : prev
                    ), 15000);
                    
                    // Reset buffer after detection to avoid duplicate triggers
                    bufferRef.text = "";
                    break;
                }
            }
        };

        listen(`ssh-output:${MAIN_SESSION_ID}`, (event) => {
            const chunk = event.payload;
            bufferRef.text += chunk;
            // Liveness signal for the exit-code poller: a command that is still
            // printing is still working, however long it takes.
            lastOutputAtRef.current = Date.now();

            // Keep buffer size manageable (last 2000 chars)
            if (bufferRef.text.length > 2000) {
                bufferRef.text = bufferRef.text.slice(-2000);
            }

            // Debounce error checking to handle fragmented output
            if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
            bufferTimeoutRef.current = setTimeout(() => {
                checkBufferForErrors();
            }, 300); // Wait for potential follow-up chunks
        }).then(f => { if (cancelled) f(); else unlisten = f; });

        return () => {
            cancelled = true;
            if (unlisten) unlisten();
            if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
        };
    }, []);

    // Terminal context capture
    const getTerminalContext = useCallback(() => {
        if (!xtermRef?.current) return "";
        const buffer = xtermRef.current.buffer.active;
        let output = "";
        const start = Math.max(0, buffer.length - 100);
        for (let i = start; i < buffer.length; i++) {
            const line = buffer.getLine(i);
            if (line) output += line.translateToString(true) + "\n";
        }
        return output;
    }, [xtermRef]);

    /**
     * Poll for command exit code via a temp file.
     * Uses exec_ssh_command (separate SSH channel) to read the file,
     * completely bypassing noisy PTY output parsing.
     */
    const pollExitCode = useCallback(async (execId) => {
        const rcFile = `/tmp/.opspilot_rc_${execId}`;
        const startTime = Date.now();
        let delay = 500; // start fast, then slow down

        // Count the dispatch itself as activity so a command that takes a while
        // to print its first line isn't judged idle straight away.
        lastOutputAtRef.current = Date.now();

        while (chainRef.current) {
            await new Promise(r => setTimeout(r, delay));
            delay = Math.min(delay + 250, 2000); // ramp up to 2s

            try {
                const result = await invoke("exec_ssh_command", {
                    sessionId: MAIN_SESSION_ID,
                    command: `cat ${rcFile} 2>/dev/null`,
                });
                const trimmed = result.trim();
                if (trimmed !== "" && /^\d+$/.test(trimmed)) {
                    // Clean up temp file in background
                    invoke("exec_ssh_command", {
                        sessionId: MAIN_SESSION_ID,
                        command: `rm -f ${rcFile}`,
                    }).catch(() => { });
                    return { code: parseInt(trimmed, 10), timedOut: false };
                }
            } catch {
                // File doesn't exist yet or channel busy — keep polling
            }

            // Give up on silence, not on elapsed time. The previous fixed 2-minute
            // budget failed any build, package install or migration that ran longer
            // than that — the command kept going and succeeded, but the chain had
            // already marked it timed out and stopped, so nothing auto-ran next.
            const idleFor = Date.now() - lastOutputAtRef.current;
            if (idleFor > STALL_IDLE_MS || Date.now() - startTime > HARD_TIMEOUT_MS) break;
        }

        // Stalled or cancelled
        invoke("exec_ssh_command", {
            sessionId: MAIN_SESSION_ID,
            command: `rm -f ${rcFile}`,
        }).catch(() => { });
        return { code: -1, timedOut: true };
    }, []);

    /* ──── SEND MESSAGE TO AI ──── */
    const sendToAI = useCallback(async (userMessage, addToTimeline = true) => {
        if (aiLoading) return;

        // Capture last 100 lines and strip ANSI codes for AI readability
        const termContext = getTerminalContext().replace(
            // eslint-disable-next-line no-control-regex
            /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
            ""
        );
        
        const fullPrompt = `TERMINAL_SCREEN_CONTEXT:\n\`\`\`\n${termContext}\n\`\`\`\n\nUSER_REQUEST: ${userMessage}`;

        if (addToTimeline) {
            setTimeline(prev => {
                const next = [...prev, { type: "prompt", text: userMessage, timestamp: new Date().toLocaleTimeString() }];
                
                // Auto-title the session if it's the first message
                const promptCount = next.filter(e => e.type === "prompt").length;
                if (promptCount === 1) {
                    setSessions(sArr => sArr.map(s => {
                        if (s.id === activeSessionId) {
                            return { ...s, title: userMessage.slice(0, 40) + (userMessage.length > 40 ? "..." : "") };
                        }
                        return s;
                    }));
                }
                return next;
            });
        }

        chatHistoryRef.current.push({ role: "user", content: fullPrompt });
        setAiLoading(true);
        setStreamBuffer("");
        try {
            // Filter out any system-role entries (e.g. leftover from older
            // versions' localStorage). The backend prepends the configured
            // system prompt on its own — sending a second one here would
            // silently contradict it.
            await invoke("stream_ai_chat", { messages: chatHistoryRef.current.filter(m => m.role !== "system") });
        } catch (err) {
            setTimeline(prev => [...prev, { type: "ai_message", content: `Error: ${err}` }]);
            setAiLoading(false);
        }
    }, [aiLoading, getTerminalContext, activeSessionId]);

    const handleSend = () => {
        if (!prompt.trim() || aiLoading) return;
        const msg = prompt.trim();
        setPrompt("");
        sendToAI(msg);
    };

    const handleKeyDown = (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    /* ──── PLAN EXECUTION ENGINE (marker-based) ──── */
    const approveAndExecute = useCallback((planIndex) => {
        const entry = timelineRef.current[planIndex];
        if (!entry || entry.type !== "plan") return;

        setExecutingPlanIdx(planIndex);
        setExecutingCmdIdx(0);
        retryCountRef.current = 0;
        chainRef.current = true;

        // Reset pipefail state for this shell so a failed command inside a
        // pipeline (e.g. `curl ... | bash`) can't masquerade as success.
        invoke("send_ssh_input", {
            sessionId: MAIN_SESSION_ID,
            input: "set -o pipefail\n",
        }).catch(() => { });

        executeCommandAtRef.current?.(planIndex, 0);
    }, []);

    const executeCommandAt = useCallback(async (planIdx, cmdIdx) => {
        if (!chainRef.current) return;

        // Skip disabled commands and find next enabled one
        // Read from the ref (not the `timeline` closure) so edits/toggles made
        // to the plan mid-run are honored on the next step instead of being
        // silently overridden by a stale snapshot from when the chain started.
        const plan = timelineRef.current[planIdx];
        let idx = cmdIdx;
        // Blank commands are skipped alongside disabled ones — an empty brace
        // group is a shell syntax error, which would break the whole chain.
        while (idx < plan.commands.length
            && (!plan.commands[idx].enabled || !plan.commands[idx].text.trim())) {
            setTimeline(prev => {
                const next = [...prev];
                const p = { ...next[planIdx], commands: [...next[planIdx].commands] };
                p.commands[idx] = { ...p.commands[idx], status: "skipped" };
                next[planIdx] = p;
                return next;
            });
            idx++;
        }
        if (idx >= plan.commands.length) {
            chainRef.current = false;
            setExecutingPlanIdx(-1);
            setExecutingCmdIdx(-1);
            return;
        }

        // Mark current command as running
        setTimeline(prev => {
            const next = [...prev];
            const p = { ...next[planIdx], commands: [...next[planIdx].commands] };
            p.commands[idx] = { ...p.commands[idx], status: "running" };
            next[planIdx] = p;
            return next;
        });
        setExecutingCmdIdx(idx);

        const cmd = plan.commands[idx];
        const startTime = Date.now();
        const execId = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const rcFile = `/tmp/.opspilot_rc_${execId}`;

        // Track in Command History as running
        recordExecutedCommand({
            id: execId,
            command: cmd.text,
            status: "running",
            source: "plan",
        });

        // Wrap the command in a brace group and put the exit-code capture on the
        // group's closing line:
        //
        //     {
        //     <cmd.text>
        //     }; echo $? > <rcFile>
        //
        // cmd.text still occupies whole lines of its own, so trailing `#`
        // comments and heredocs/multi-line scripts stay intact — the reason the
        // capture was previously sent as a separate write.
        //
        // The difference is that the shell now parses the *entire* construct
        // before it runs anything, so nothing of ours is left sitting in the tty
        // input buffer. Sent as two separate lines, the `echo $?` line waited in
        // that buffer and was swallowed by any command that reads stdin — a sudo
        // password prompt, `apt` asking a config question, `docker run -i`. The
        // rc file was then never written, the poller ran out its budget, and the
        // chain stopped even though the command itself had succeeded.
        //
        // A brace group is not a subshell, so `cd` and other state changes still
        // affect the session exactly as before.
        await invoke("send_ssh_input", {
            sessionId: MAIN_SESSION_ID,
            input: `{\n${cmd.text}\n}; echo $? > ${rcFile}\n`,
        });

        // Poll exit code via separate SSH channel (no PTY noise)
        const { code, timedOut } = await pollExitCode(execId);

        if (!chainRef.current) return;

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const hasError = timedOut || (code !== 0);

        if (hasError) {
            const exitCode = timedOut ? -1 : code;
            recordExecutedCommand({
                id: execId,
                command: cmd.text,
                status: "failed",
                exitCode,
                duration,
                source: "plan",
            });
            setTimeline(prev => {
                const next = [...prev];
                const p = { ...next[planIdx], commands: [...next[planIdx].commands] };
                p.commands[idx] = { ...p.commands[idx], status: "failed", exitCode, duration };
                next[planIdx] = p;
                return next;
            });

            // Auto-troubleshoot: ask AI for a fix
            if (retryCountRef.current < MAX_RETRIES) {
                retryCountRef.current++;
                chainRef.current = false;
                setExecutingPlanIdx(-1);

                // Wait for PTY to flush the error output so it gets captured
                await new Promise(r => setTimeout(r, 800));

                const termOutput = getTerminalContext();
                const errorMsg = timedOut
                    ? `Command produced no output for ${STALL_IDLE_MS / 60000} minutes and was treated as stalled: \`${cmd.text}\``
                    : `Command failed (exit code ${exitCode}): \`${cmd.text}\``;

                setTimeline(prev => [...prev, {
                    type: "error_recovery",
                    failedCommand: cmd.text,
                    exitCode,
                    timedOut,
                    retryNum: retryCountRef.current,
                }]);

                sendToAI(
                    `${errorMsg}\n\nTerminal output:\n\`\`\`\n${termOutput}\n\`\`\`\n\nPlease analyze the error and provide a fix as a command plan. Retry ${retryCountRef.current}/${MAX_RETRIES}.`,
                    false
                );
            } else {
                chainRef.current = false;
                setExecutingPlanIdx(-1);
                setTimeline(prev => [...prev, {
                    type: "ai_message",
                    content: `Max retries (${MAX_RETRIES}) reached for command: \`${cmd.text}\`. Execution stopped.`,
                }]);
            }
        } else {
            // Success — mark completed and proceed to next command
            recordExecutedCommand({
                id: execId,
                command: cmd.text,
                status: "completed",
                exitCode: 0,
                duration,
                source: "plan",
            });
            setTimeline(prev => {
                const next = [...prev];
                const p = { ...next[planIdx], commands: [...next[planIdx].commands] };
                p.commands[idx] = { ...p.commands[idx], status: "completed", exitCode: 0, duration };
                next[planIdx] = p;
                return next;
            });

            retryCountRef.current = 0;
            setTimeout(() => {
                if (chainRef.current) {
                    executeCommandAtRef.current?.(planIdx, idx + 1);
                }
            }, 300);
        }
    }, [pollExitCode, sendToAI, getTerminalContext]);

    // The chain is driven through a ref so each step runs the current
    // executeCommandAt rather than the one captured when Approve All was
    // clicked — otherwise every step after the first ran against a stale
    // sendToAI/session snapshot from the render that started the chain.
    useEffect(() => {
        executeCommandAtRef.current = executeCommandAt;
    }, [executeCommandAt]);

    // A chain outliving its component would keep polling a session that is gone
    // (e.g. after logout), so stop it when OpsPilot unmounts.
    useEffect(() => () => { chainRef.current = false; }, []);

    const cancelExecution = () => {
        chainRef.current = false;
        setExecutingPlanIdx(-1);
        setExecutingCmdIdx(-1);
    };

    /* ──── PLAN EDITING ──── */
    const toggleCommand = (planIdx, cmdIdx) => {
        setTimeline(prev => {
            const next = [...prev];
            const plan = { ...next[planIdx], commands: [...next[planIdx].commands] };
            plan.commands[cmdIdx] = { ...plan.commands[cmdIdx], enabled: !plan.commands[cmdIdx].enabled };
            next[planIdx] = plan;
            return next;
        });
    };

    const removeCommand = (planIdx, cmdIdx) => {
        setTimeline(prev => {
            const next = [...prev];
            const plan = { ...next[planIdx], commands: [...next[planIdx].commands] };
            plan.commands.splice(cmdIdx, 1);
            next[planIdx] = plan;
            return next;
        });
    };

    const startEditCommand = (planIdx, cmdIdx) => {
        setTimeline(prev => {
            const next = [...prev];
            const plan = { ...next[planIdx], commands: [...next[planIdx].commands] };
            plan.commands[cmdIdx] = { ...plan.commands[cmdIdx], editing: true };
            next[planIdx] = plan;
            return next;
        });
    };

    const finishEditCommand = (planIdx, cmdIdx, newText) => {
        setTimeline(prev => {
            const next = [...prev];
            const plan = { ...next[planIdx], commands: [...next[planIdx].commands] };
            plan.commands[cmdIdx] = { ...plan.commands[cmdIdx], text: newText, editing: false };
            next[planIdx] = plan;
            return next;
        });
    };

    const executeSingleCommand = (code, source = "single") => {
        invoke("send_ssh_input", { sessionId: MAIN_SESSION_ID, input: code + "\n" });
        recordExecutedCommand({
            command: code,
            status: "executed",
            source,
        });
    };

    const copyToClipboard = (text) => {
        navigator.clipboard.writeText(text);
    };

    /* ──── RESET ──── */
    const handleReset = () => {
        cancelExecution();
        xtermRef.current?.clear();
        invoke("send_ssh_input", { sessionId: MAIN_SESSION_ID, input: "reset\n" });
        setTimeline([]);
        setPrompt("");
        setStreamBuffer("");
        chatHistoryRef.current = [];
    };

    const handleNewChat = () => {
        const newSession = {
            id: Date.now().toString(),
            title: "New Conversation",
            timeline: [],
            chatHistory: [],
            timestamp: new Date().toLocaleString()
        };

        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        setTimeline([]);
        chatHistoryRef.current = newSession.chatHistory;
        setPrompt("");
        setStreamBuffer("");
    };

    /* ──── VS CODE TUNNEL ──── */
    // Launches local VS Code Desktop over Remote-SSH, rooted at this
    // session's current remote directory — the VM never needs a public IP,
    // VS Code connects over the same SSH credentials Servera already has.
    const handleVscodeTunnel = async () => {
        if (!profileId) {
            setVscodeStatus({ type: "error", message: "Save this connection as a profile first to use VS Code Tunnel." });
            return;
        }
        setVscodeBusy(true);
        setVscodeStatus(null);
        try {
            const hasCli = await invoke("check_vscode_cli");
            if (!hasCli) {
                setVscodeStatus({ type: "error", message: "VS Code not found on this machine. Install VS Code Desktop, or use Cloud Browser instead." });
                return;
            }
            const installed = await invoke("ensure_remote_ssh_extension");
            if (installed) {
                setVscodeStatus({ type: "info", message: "Installed the Remote-SSH extension…" });
            }

            let remotePath = "~";
            try {
                const pwdOut = await invoke("exec_ssh_command", { sessionId: MAIN_SESSION_ID, command: "pwd" });
                const trimmed = String(pwdOut || "").trim();
                if (trimmed) remotePath = trimmed;
            } catch { /* fall back to home dir */ }

            const alias = await invoke("ensure_ssh_config_host", { profileId });
            await invoke("open_vscode_remote", { alias, path: remotePath });
            setVscodeStatus(null);
        } catch (err) {
            setVscodeStatus({ type: "error", message: String(err) });
        } finally {
            setVscodeBusy(false);
        }
    };

    /* ──── OTHER TUNNELS (quick popover) ──── */
    const refreshPopoverTunnels = useCallback(async () => {
        try {
            const list = await invoke("get_active_tunnels");
            setPopoverTunnels(list || []);
        } catch { /* ignore */ }
    }, []);

    useEffect(() => {
        if (showTunnelPopover) refreshPopoverTunnels();
    }, [showTunnelPopover, refreshPopoverTunnels]);

    const handleQuickCreateTunnel = async () => {
        if (!quickLocalPort || !quickRemotePort) return;
        setQuickTunnelBusy(true);
        setQuickTunnelError(null);
        try {
            await invoke("create_tunnel", {
                sessionId: MAIN_SESSION_ID,
                tunnelId: `quick-${Date.now()}`,
                tunnelType: "local",
                localPort: parseInt(quickLocalPort, 10),
                remoteHost: "127.0.0.1",
                remotePort: parseInt(quickRemotePort, 10),
                ip, user,
                port: port || 22,
                password: password || null,
                privateKey: privateKey || null,
                proxyJump: proxyJump || null,
                profileId: profileId || null,
            });
            setQuickLocalPort("");
            setQuickRemotePort("");
            refreshPopoverTunnels();
        } catch (err) {
            setQuickTunnelError(String(err));
        } finally {
            setQuickTunnelBusy(false);
        }
    };

    const handleQuickCloseTunnel = async (tunnelId) => {
        try {
            await invoke("close_tunnel", { tunnelId });
            refreshPopoverTunnels();
        } catch { /* ignore */ }
    };

    const switchSession = (sessionId) => {
        if (sessionId === activeSessionId) return;
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setActiveSessionId(session.id);
            setTimeline(session.timeline);
            chatHistoryRef.current = session.chatHistory;
        }
    };

    const deleteSession = (e, sessionId) => {
        e.stopPropagation();
        const filtered = sessions.filter(s => s.id !== sessionId);
        
        if (filtered.length === 0) {
            // Always keep at least one session
            handleNewChat();
            return;
        }

        setSessions(filtered);
        if (sessionId === activeSessionId) {
            const nextSession = filtered[0];
            setActiveSessionId(nextSession.id);
            setTimeline(nextSession.timeline);
            chatHistoryRef.current = nextSession.chatHistory;
        }
    };

    /* ──── RENDER HELPERS ──── */

    const renderPlanEntry = (entry, planIdx) => {
        const isExecuting = executingPlanIdx === planIdx;
        const allDone = entry.commands.every(c => c.status === "completed" || c.status === "skipped");
        const hasFailed = entry.commands.some(c => c.status === "failed");
        const isPending = entry.commands.every(c => c.status === "pending");

        return (
            <div className={`op-plan-card ${isExecuting ? "executing" : ""} ${allDone ? "done" : ""} ${hasFailed ? "has-error" : ""}`}>
                <div className="op-plan-header">
                    <div className="op-plan-title">
                        {allDone ? <CheckCircle2 size={16} className="icon-success" /> :
                            hasFailed ? <AlertCircle size={16} className="icon-error" /> :
                                isExecuting ? <Loader2 size={16} className="animate-spin icon-running" /> :
                                    <ChevronRight size={16} />}
                        <span>Command Plan ({entry.commands.length} steps)</span>
                    </div>
                    {isPending && !isExecuting && (
                        <div className="op-plan-actions">
                            <button className="op-btn reject" onClick={() => {
                                setTimeline(prev => prev.filter((_, i) => i !== planIdx));
                            }}>
                                <X size={12} /> Reject
                            </button>
                            <button className="op-btn approve" onClick={() => approveAndExecute(planIdx)}>
                                <Play size={12} /> Approve All
                            </button>
                        </div>
                    )}
                    {isExecuting && (
                        <button className="op-btn cancel" onClick={cancelExecution}>
                            <StopCircle size={12} /> Cancel
                        </button>
                    )}
                </div>

                <div className="op-command-list">
                    {entry.commands.map((cmd, cmdIdx) => (
                        <div key={cmdIdx} className={`op-command-item ${cmd.status} ${!cmd.enabled ? "disabled" : ""}`}>
                            <div className="op-cmd-left">
                                {cmd.status === "pending" && !isExecuting && (
                                    <button className="op-checkbox" onClick={() => toggleCommand(planIdx, cmdIdx)}>
                                        {cmd.enabled ? <CheckCircle2 size={14} className="icon-check" /> : <Circle size={14} />}
                                    </button>
                                )}
                                {cmd.status === "completed" && <CheckCircle2 size={14} className="icon-success" />}
                                {cmd.status === "running" && <Loader2 size={14} className="animate-spin icon-running" />}
                                {cmd.status === "failed" && <AlertCircle size={14} className="icon-error" />}
                                {cmd.status === "skipped" && <Circle size={14} className="icon-skipped" />}
                                {(cmd.status === "pending" && isExecuting) && <Circle size={14} className="icon-pending" />}

                                <div className="op-cmd-content">
                                    <span className="op-cmd-number">{cmdIdx + 1}.</span>
                                    {cmd.editing ? (
                                        <input
                                            className="op-cmd-edit-input"
                                            defaultValue={cmd.text}
                                            autoFocus
                                            onBlur={e => finishEditCommand(planIdx, cmdIdx, e.target.value)}
                                            onKeyDown={e => {
                                                if (e.key === "Enter") finishEditCommand(planIdx, cmdIdx, e.target.value);
                                                if (e.key === "Escape") finishEditCommand(planIdx, cmdIdx, cmd.text);
                                            }}
                                        />
                                    ) : (
                                        <code className="op-cmd-text" title={cmd.text}>{cmd.text}</code>
                                    )}
                                    {cmd.description && <span className="op-cmd-desc" title={cmd.description}>{cmd.description}</span>}
                                </div>
                            </div>

                            <div className="op-cmd-right">
                                {cmd.duration && <span className="op-cmd-duration">{cmd.duration}s</span>}
                                {cmd.status === "pending" && !isExecuting && (
                                    <>
                                        <button className="op-icon-btn" onClick={() => startEditCommand(planIdx, cmdIdx)} title="Edit">
                                            <Pencil size={12} />
                                        </button>
                                        <button className="op-icon-btn" onClick={() => removeCommand(planIdx, cmdIdx)} title="Remove">
                                            <Trash2 size={12} />
                                        </button>
                                        <button className="op-icon-btn run" onClick={() => executeSingleCommand(cmd.text, "plan")} title="Run individually">
                                            <Play size={12} />
                                        </button>
                                    </>
                                )}
                                {(cmd.status === "completed" || cmd.status === "failed") && (
                                    <button className="op-icon-btn" onClick={() => copyToClipboard(cmd.text)} title="Copy">
                                        <Copy size={12} />
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    };

    const renderAIMessage = (content) => {
        // Render markdown-ish content with bash block support
        const parts = content.split(/(```(?:bash|sh)?\s*\n[\s\S]*?```)/g);
        return parts.map((part, i) => {
            if (part.startsWith("```")) {
                const code = part.replace(/```(?:bash|sh)?|```/g, "").trim();
                return (
                    <div key={i} className="op-code-block">
                        <div className="op-code-header">
                            <span>BASH</span>
                            <div className="op-code-actions">
                                <button className="op-icon-btn" onClick={() => copyToClipboard(code)}><Copy size={10} /></button>
                                <button className="op-icon-btn run" onClick={() => executeSingleCommand(code, "snippet")}><Play size={10} /> Run</button>
                            </div>
                        </div>
                        <pre className="op-code-content">{code}</pre>
                    </div>
                );
            }
            return <span key={i} style={{ whiteSpace: "pre-wrap" }}>{part}</span>;
        });
    };

    /* ──── MAIN RENDER ──── */
    return (
        <div className="opspilot-main-wrapper" data-theme={themeId}>
            {/* Session Sidebar */}
            <div
                className={`op-sidebar-panel ${sidebarOpen ? "open" : "collapsed"}`}
                style={{ width: sidebarOpen ? sidebarWidth : 0 }}
            >
                <div className="op-sidebar-header">
                    <History size={14} />
                    <span>Chat History</span>
                    <button className="op-sidebar-toggle" onClick={() => setSidebarOpen(false)}>
                        <PanelLeftClose size={14} />
                    </button>
                </div>
                <div className="op-session-list">
                    <button className="op-new-btn-sidebar" onClick={handleNewChat}>
                        <PlusCircle size={14} /> New Chat
                    </button>
                    {sessions.map(session => (
                        <div 
                            key={session.id} 
                            className={`op-session-item ${session.id === activeSessionId ? "active" : ""}`}
                            onClick={() => switchSession(session.id)}
                        >
                            <MessageSquare size={14} className="session-icon" />
                            <div className="session-info">
                                <span className="session-title">{session.title}</span>
                                <span className="session-date">{session.timestamp}</span>
                            </div>
                            <button className="session-delete" onClick={(e) => deleteSession(e, session.id)}>
                                <Trash2 size={12} />
                            </button>
                        </div>
                    ))}
                </div>
            </div>

            {/* Drag Resizer */}
            <div
                className="op-sidebar-resizer"
                onMouseDown={handleResizerMouseDown}
                title={sidebarOpen ? "Drag to resize or collapse" : "Drag right to open"}
            />

            <div className="opspilot-container">
                {/* Header */}
                <div className="op-header">
                    <div className="op-header-left">
                        {!sidebarOpen && (
                            <button className="op-sidebar-open-btn" onClick={() => setSidebarOpen(true)}>
                                <PanelLeftOpen size={16} />
                            </button>
                        )}
                        <Sparkles size={18} color="#79c0ff" />
                        <span className="op-title">OpsPilot</span>
                        <span className="op-badge">AI Terminal</span>
                    </div>
                <div className="op-header-right">
                    {/* Theme swatches always visible when picker is open */}
                    {showThemePicker && (
                        <div className="op-theme-swatches">
                            {THEMES.map(t => (
                                <button
                                    key={t.id}
                                    className={`op-swatch-btn ${themeId === t.id ? "active" : ""}`}
                                    style={{ background: t.swatch, borderColor: themeId === t.id ? t.accent : "transparent", boxShadow: themeId === t.id ? `0 0 0 2px ${t.accent}55` : "none" }}
                                    onClick={() => { setThemeId(t.id); setShowThemePicker(false); }}
                                    title={t.name}
                                />
                            ))}
                        </div>
                    )}
                    <div className="op-layout-toggle" style={{ border: 'none' }}>
                        <button
                            className="op-layout-btn"
                            style={{ background: '#1f6feb', color: 'white', borderRadius: 4, padding: '4px 10px' }}
                            onClick={handleNewChat}
                            title="New Chat"
                        >
                            <PlusCircle size={14} />
                            <span style={{ marginLeft: 4, fontSize: 11, fontWeight: 700 }}>New Chat</span>
                        </button>
                    </div>
                    <div className="op-popover-anchor">
                        <button
                            className="op-icon-btn"
                            onClick={handleVscodeTunnel}
                            title="Open VS Code here via Remote-SSH"
                            disabled={vscodeBusy}
                        >
                            {vscodeBusy ? <Loader2 size={14} className="animate-spin" /> : <Code2 size={14} />}
                        </button>
                        {vscodeStatus && (
                            <div className={`op-status-popover ${vscodeStatus.type}`}>
                                <span>{vscodeStatus.message}</span>
                                <button className="op-icon-btn" onClick={() => setVscodeStatus(null)} title="Dismiss">
                                    <X size={12} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="op-popover-anchor">
                        <button
                            className={`op-icon-btn ${showTunnelPopover ? "active" : ""}`}
                            onClick={() => setShowTunnelPopover(p => !p)}
                            title="Other Tunnels"
                        >
                            <ArrowRightLeft size={14} />
                        </button>
                        {showTunnelPopover && (
                            <div className="op-tunnel-popover">
                                <div className="op-tunnel-popover-title">Quick Tunnels</div>

                                <div className="op-tunnel-popover-form">
                                    <input
                                        type="number"
                                        placeholder="Local"
                                        value={quickLocalPort}
                                        onChange={e => setQuickLocalPort(e.target.value)}
                                    />
                                    <ChevronRight size={12} />
                                    <input
                                        type="number"
                                        placeholder="Remote"
                                        value={quickRemotePort}
                                        onChange={e => setQuickRemotePort(e.target.value)}
                                    />
                                    <button
                                        className="op-icon-btn"
                                        onClick={handleQuickCreateTunnel}
                                        disabled={quickTunnelBusy || !quickLocalPort || !quickRemotePort}
                                        title="Create tunnel"
                                    >
                                        <Plus size={14} />
                                    </button>
                                </div>
                                {quickTunnelError && <div className="op-tunnel-popover-error">{quickTunnelError}</div>}

                                <div className="op-tunnel-popover-list">
                                    {popoverTunnels.length === 0 ? (
                                        <div className="op-tunnel-popover-empty">No active tunnels</div>
                                    ) : popoverTunnels.map(t => (
                                        <div key={t.id} className="op-tunnel-popover-item">
                                            <span>
                                                {t.tunnel_type === "dynamic" ? `SOCKS5 :${t.local_port}` : `:${t.local_port} → ${t.remote_host}:${t.remote_port}`}
                                            </span>
                                            <div className="op-tunnel-popover-item-actions">
                                                {t.tunnel_type === "local" && onOpenCloudBrowser && (
                                                    <button
                                                        className="op-icon-btn"
                                                        title="Open in Cloud Browser"
                                                        onClick={() => { onOpenCloudBrowser(`http://localhost:${t.local_port}`); setShowTunnelPopover(false); }}
                                                    >
                                                        <Cloud size={13} />
                                                    </button>
                                                )}
                                                <button className="op-icon-btn" title="Close tunnel" onClick={() => handleQuickCloseTunnel(t.id)}>
                                                    <X size={13} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </div>

                    <button
                        className={`op-icon-btn ${showThemePicker ? "active" : ""}`}
                        onClick={() => setShowThemePicker(p => !p)}
                        title="Change Theme"
                    >
                        <Palette size={14} />
                    </button>
                    <button className="op-icon-btn" onClick={handleReset} title="Reset Session">
                        <RotateCcw size={14} />
                    </button>
                    <button className="op-icon-btn" onClick={onClose} title="Close">
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* Timeline */}
            <div className="op-timeline">
                {timeline.length === 0 && !aiLoading && (
                    <div className="op-empty-state">
                        <Sparkles size={40} color="#30363d" />
                        <h3>What would you like to do?</h3>
                        <p>Describe a task and OpsPilot will generate commands for you to review and execute.</p>
                        <div className="op-suggestions">
                            <button className="op-suggestion" onClick={() => { setPrompt("Check disk usage and memory stats"); }}>
                                Check disk & memory
                            </button>
                            <button className="op-suggestion" onClick={() => { setPrompt("Install and configure nginx"); }}>
                                Install nginx
                            </button>
                            <button className="op-suggestion" onClick={() => { setPrompt("Show running Docker containers and their resource usage"); }}>
                                Docker status
                            </button>
                        </div>
                    </div>
                )}

                {timeline.map((entry, idx) => {
                    switch (entry.type) {
                        case "prompt":
                            return (
                                <div key={idx} className="op-timeline-entry prompt">
                                    <div className="op-prompt-bubble">
                                        <div className="op-bubble-content">{entry.text}</div>
                                        {entry.timestamp && <div className="op-bubble-time">{entry.timestamp}</div>}
                                    </div>
                                </div>
                            );

                        case "plan":
                            return (
                                <div key={idx} className="op-timeline-entry plan">
                                    {renderPlanEntry(entry, idx)}
                                </div>
                            );

                        case "ai_message":
                            return (
                                <div key={idx} className="op-timeline-entry ai-message">
                                    <div className="op-ai-bubble">
                                        <div className="op-ai-sender">
                                            <div className="sender-info">
                                                <Bot size={12} /> OpsPilot
                                            </div>
                                            {entry.timestamp && <span className="sender-time">{entry.timestamp}</span>}
                                        </div>
                                        {renderAIMessage(entry.content)}
                                    </div>
                                </div>
                            );

                        case "error_recovery":
                            return (
                                <div key={idx} className="op-timeline-entry error-recovery">
                                    <div className="op-error-card">
                                        <AlertCircle size={14} className="icon-error" />
                                        <span>
                                            {entry.timedOut
                                                ? <>Command went silent for {STALL_IDLE_MS / 60000} minutes and was treated as stalled: <code>{entry.failedCommand}</code></>
                                                : <>Command failed (exit code {entry.exitCode}): <code>{entry.failedCommand}</code></>}
                                            {" "} — Asking AI for fix (attempt {entry.retryNum}/{MAX_RETRIES})
                                        </span>
                                    </div>
                                </div>
                            );

                        default:
                            return null;
                    }
                })}

                {/* Streaming indicator */}
                {aiLoading && (
                    <div className="op-timeline-entry ai-message">
                        <div className="op-ai-bubble streaming">
                            <div className="op-ai-sender"><Bot size={12} /> OpsPilot</div>
                            {streamBuffer ? (
                                <span style={{ whiteSpace: "pre-wrap" }}>{streamBuffer}</span>
                            ) : (
                                <div className="op-typing">
                                    <Loader2 size={14} className="animate-spin" />
                                    <span>Thinking...</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                <div ref={timelineEndRef} />
            </div>

            {/* Error Detection Overlay/Suggestion */}
            {detectedError && (
                <div className="op-error-suggestion">
                    <div className="op-suggestion-content">
                        <AlertCircle size={16} className="text-red-400" />
                        <div className="op-suggestion-text">
                            <strong>Potential error detected:</strong>
                            <span>{detectedError.message}</span>
                        </div>
                    </div>
                    <div className="op-suggestion-actions">
                        <button className="op-suggestion-btn secondary" onClick={() => setDetectedError(null)}>
                            Ignore
                        </button>
                        <button className="op-suggestion-btn primary" onClick={() => {
                            const msg = `I see a terminal error: "${detectedError.message}". Can you help me debug and fix it?`;
                            setDetectedError(null);
                            sendToAI(msg);
                        }}>
                            <Sparkles size={14} /> Debug with AI
                        </button>
                    </div>
                </div>
            )}

            {/* Input Bar */}
            <div className="op-input-bar">
                <input
                    className="op-input"
                    placeholder={aiLoading ? "OpsPilot is thinking..." : "Describe what you want to do..."}
                    value={prompt}
                    onChange={e => setPrompt(e.target.value)}
                    onKeyDown={handleKeyDown}
                    disabled={aiLoading}
                />
                <button className="op-send-btn" onClick={handleSend} disabled={aiLoading || !prompt.trim()}>
                    <Send size={16} />
                </button>
            </div>
        </div>

        </div>
    );
}
