import { useState, useRef, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
    Send, X, Loader2, Copy, Sparkles, RotateCcw,
    CheckCircle2, Circle, AlertCircle, Play, StopCircle,
    Pencil, Trash2, ChevronRight, Bot, Columns2,
    PlusCircle, MessageSquare, History, PanelLeftClose, PanelLeftOpen,
    Palette, Check
} from "lucide-react";
import { MAIN_SESSION_ID } from "../../utils/terminal";
import "./SmartTerminal.css";

/* ──────────────────────────────────
   PLAN PARSER
   ────────────────────────────────── */

/**
 * Parse AI output into a structured command plan.
 * Expected format: `N. \`command\` - description`
 * Falls back to extracting ```bash blocks.
 */
function parsePlan(content) {
    const planRegex = /^\d+\.\s+`([^`]+)`\s*[-–—]\s*(.+)$/gm;
    const commands = [];
    let match;
    while ((match = planRegex.exec(content)) !== null) {
        commands.push({
            text: match[1].trim(),
            description: match[2].trim(),
            status: "pending",
            enabled: true,
            editing: false,
            exitCode: null,
            duration: null,
        });
    }
    if (commands.length > 0) return commands;

    // Fallback: extract ```bash blocks
    const bashRegex = /```(?:bash|sh)?\s*\n([\s\S]*?)```/g;
    while ((match = bashRegex.exec(content)) !== null) {
        const code = match[1].trim();
        if (code) {
            commands.push({
                text: code,
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

export default function SmartTerminal({ xtermRef, onClose, layout, onLayoutChange }) {
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
    const retryCountRef = useRef(0);
    const MAX_RETRIES = 3;

    // Chat history for AI context continuity
    const chatHistoryRef = useRef([]);

    // Auto-scroll
    const timelineEndRef = useRef(null);

    // Sessions management
    const [sessions, setSessions] = useState([]);
    const [activeSessionId, setActiveSessionId] = useState(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(260);

    // Theme
    const [themeId, setThemeId] = useState(() => localStorage.getItem("opspilot_theme") || "github-dark");
    const [showThemePicker, setShowThemePicker] = useState(false);

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

    // Sidebar drag-to-resize global mouse handlers
    useEffect(() => {
        const handleMouseMove = (e) => {
            if (!isDraggingRef.current) return;
            const delta = e.clientX - dragStartXRef.current;
            const newW = dragStartWidthRef.current + delta;
            if (newW < SIDEBAR_COLLAPSE_AT) {
                setSidebarOpen(false);
            } else {
                setSidebarOpen(true);
                setSidebarWidth(Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, newW)));
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleResizerMouseDown = useCallback((e) => {
        isDraggingRef.current = true;
        dragStartXRef.current = e.clientX;
        dragStartWidthRef.current = sidebarOpen ? sidebarWidth : 0;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        e.preventDefault();
    }, [sidebarOpen, sidebarWidth]);

    // Initial load from localStorage
    useEffect(() => {
        const savedSessions = localStorage.getItem("opspilot_sessions");
        const lastActiveId = localStorage.getItem("opspilot_active_session_id");

        let loadedSessions = [];
        if (savedSessions) {
            try {
                loadedSessions = JSON.parse(savedSessions);
                setSessions(loadedSessions);
            } catch (e) {
                console.error("Failed to parse saved sessions", e);
            }
        }

        const defaultPrompt = "You are OpsPilot, an expert Linux/DevOps AI assistant integrated into an SSH terminal IDE.\n\nWhen the user gives you a task, generate a numbered command plan. Format each command EXACTLY as:\n## Command Plan\n1. `command here` - Brief description of what this does\n2. `another command` - Brief description of what this does\n\nWhen a command fails and you are asked to fix it, provide a new command plan for the fix.\nIf the user asks a general question (not a task), respond normally in markdown.\nAlways consider the terminal context provided. Wrap any standalone commands in ```bash blocks.";

        // Handle migration from old single-session storage or empty state
        if (loadedSessions.length === 0) {
            const oldTimeline = localStorage.getItem("opspilot_timeline");
            const oldHistory = localStorage.getItem("opspilot_chat_history");
            
            const newSession = {
                id: Date.now().toString(),
                title: "New Conversation",
                timeline: oldTimeline ? JSON.parse(oldTimeline) : [],
                chatHistory: oldHistory ? JSON.parse(oldHistory) : [{ role: "system", content: defaultPrompt }],
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
            chatHistoryRef.current = active.chatHistory;
        }

        // Clean up old storage keys if they exist
        localStorage.removeItem("opspilot_timeline");
        localStorage.removeItem("opspilot_chat_history");
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
            localStorage.setItem("opspilot_sessions", JSON.stringify(updated));
            localStorage.setItem("opspilot_active_session_id", activeSessionId);
            return updated;
        });
    }, [timeline, activeSessionId]);

    useEffect(() => {
        timelineEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [timeline, aiLoading, streamBuffer]);

    // Listen for AI stream events
    useEffect(() => {
        let unlistenChunk, unlistenDone;

        listen("ai-response-chunk", (event) => {
            setStreamBuffer(prev => prev + event.payload);
        }).then(f => unlistenChunk = f);

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
        }).then(f => unlistenDone = f);

        return () => {
            if (unlistenChunk) unlistenChunk();
            if (unlistenDone) unlistenDone();
        };
    }, []);

    // Monitor terminal output for errors with a rolling buffer
    useEffect(() => {
        let unlisten;
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

            // Keep buffer size manageable (last 2000 chars)
            if (bufferRef.text.length > 2000) {
                bufferRef.text = bufferRef.text.slice(-2000);
            }

            // Debounce error checking to handle fragmented output
            if (bufferTimeoutRef.current) clearTimeout(bufferTimeoutRef.current);
            bufferTimeoutRef.current = setTimeout(() => {
                checkBufferForErrors();
            }, 300); // Wait for potential follow-up chunks
        }).then(f => unlisten = f);

        return () => {
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
    const pollExitCode = useCallback(async (execId, maxWaitMs = 120000) => {
        const rcFile = `/tmp/.opspilot_rc_${execId}`;
        const startTime = Date.now();
        let delay = 500; // start fast, then slow down

        while (Date.now() - startTime < maxWaitMs && chainRef.current) {
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
        }

        // Timeout or cancelled
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
            await invoke("stream_ai_chat", { messages: chatHistoryRef.current });
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
        const entry = timeline[planIndex];
        if (!entry || entry.type !== "plan") return;

        setExecutingPlanIdx(planIndex);
        setExecutingCmdIdx(0);
        retryCountRef.current = 0;
        chainRef.current = true;

        executeCommandAt(planIndex, 0);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timeline]);

    const executeCommandAt = useCallback(async (planIdx, cmdIdx) => {
        if (!chainRef.current) return;

        // Skip disabled commands and find next enabled one
        const plan = timeline[planIdx];
        let idx = cmdIdx;
        while (idx < plan.commands.length && !plan.commands[idx].enabled) {
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

        // Send command — exit code gets written to a temp file
        await invoke("send_ssh_input", {
            sessionId: MAIN_SESSION_ID,
            input: `${cmd.text} ; echo $? > ${rcFile}\n`,
        });

        // Poll exit code via separate SSH channel (no PTY noise)
        const { code, timedOut } = await pollExitCode(execId, 120000);

        if (!chainRef.current) return;

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const hasError = timedOut || (code !== 0);

        if (hasError) {
            const exitCode = timedOut ? -1 : code;
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
                    ? `Command timed out after 2 minutes: \`${cmd.text}\``
                    : `Command failed (exit code ${exitCode}): \`${cmd.text}\``;

                setTimeline(prev => [...prev, {
                    type: "error_recovery",
                    failedCommand: cmd.text,
                    exitCode,
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
                    executeCommandAt(planIdx, idx + 1);
                }
            }, 300);
        }
    }, [timeline, pollExitCode, sendToAI, getTerminalContext]);

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

    const executeSingleCommand = (code) => {
        invoke("send_ssh_input", { sessionId: MAIN_SESSION_ID, input: code + "\n" });
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
        // Keep only system prompt
        const systemMsg = chatHistoryRef.current[0];
        chatHistoryRef.current = [systemMsg];
        localStorage.removeItem("opspilot_timeline");
        localStorage.removeItem("opspilot_chat_history");
    };

    const handleNewChat = () => {
        const defaultPrompt = chatHistoryRef.current[0].content;
        const newSession = {
            id: Date.now().toString(),
            title: "New Conversation",
            timeline: [],
            chatHistory: [{ role: "system", content: defaultPrompt }],
            timestamp: new Date().toLocaleString()
        };

        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSession.id);
        setTimeline([]);
        chatHistoryRef.current = newSession.chatHistory;
        setPrompt("");
        setStreamBuffer("");
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
                                        <code className="op-cmd-text">{cmd.text}</code>
                                    )}
                                    {cmd.description && <span className="op-cmd-desc">{cmd.description}</span>}
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
                                        <button className="op-icon-btn run" onClick={() => executeSingleCommand(cmd.text)} title="Run individually">
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
                                <button className="op-icon-btn run" onClick={() => executeSingleCommand(code)}><Play size={10} /> Run</button>
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
                                            Command failed (exit code {entry.exitCode}): <code>{entry.failedCommand}</code>
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
