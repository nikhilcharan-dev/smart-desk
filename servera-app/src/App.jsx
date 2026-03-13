import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { LayoutDashboard, FolderOpen, Terminal as TerminalIcon, Monitor, LogOut, Settings, Cpu, Network, ScrollText, Code2, Command as CommandIcon, Box, Shield, PackageOpen, RefreshCw, ShieldCheck } from "lucide-react";

import "./App.css";
import { MAIN_SESSION_ID, fitAndResize } from "./utils/terminal";
import ConnectionHub from "./pages/login/Login.jsx";
import FileExplorerLayout from "./components/FileExplorer/FileExplorerLayout";
import Dashboard from "./components/Dashboard/Dashboard";
import SmartTerminal from "./components/SmartTerminal/SmartTerminal";
import TermHub from "./components/TermHub/TermHub";
import SettingsHub from "./components/Settings/SettingsHub";
import ErrorBoundary from "./components/ErrorBoundary";

// New Phase 2 Components
import CommandPalette from "./components/CommandPalette/CommandPalette";
import ProcessManager from "./components/ProcessManager/ProcessManager";
import PortScanner from "./components/PortScanner/PortScanner";
import Snippets from "./components/Snippets/Snippets";
import LogViewer from "./components/LogViewer/LogViewer";
import DockerManager from "./components/DockerManager/DockerManager";
import UFWManager from "./components/UFWManager/UFWManager";
import AptManager from "./components/AptManager/AptManager";
import PermissionModal from "./components/FileExplorer/PermissionModal";

import { DEFAULT_SIDEBAR_ITEMS } from "./constants";
export default function App() {
    const [connected, setConnected] = useState(false);
    const [ip, setIp] = useState("");
    const [user, setUser] = useState("");
    const [profileName, setProfileName] = useState("");
    const [connectedProfileId, setConnectedProfileId] = useState(null);
    const [isReconnecting, setIsReconnecting] = useState(false);
    // eslint-disable-next-line no-unused-vars
    const [hostFingerprint, setHostFingerprint] = useState("");

    // Views: 'dashboard' | 'files' | 'terminal' | 'termhub' | 'processes' | 'ports' | 'logs' | 'snippets' | 'ai-settings'
    const [activeView, setActiveView] = useState("dashboard");
    const [isConnecting, setIsConnecting] = useState(false);
    const [cmdOpen, setCmdOpen] = useState(false);

    // Sidebar customization — persisted to localStorage
    const [sidebarItems, setSidebarItemsRaw] = useState(() => {
        try {
            const saved = localStorage.getItem('sidebarItems');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch { /* ignore parse errors */ }
        return DEFAULT_SIDEBAR_ITEMS.map(i => i.id);
    });
    const setSidebarItems = (items) => {
        setSidebarItemsRaw(items);
        localStorage.setItem('sidebarItems', JSON.stringify(items));
    };

    // Command Palette global listener (Ctrl+K or Cmd+K)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setCmdOpen(prev => !prev);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // XTerm Refs for Bottom Manual Drawer
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);
    const [isTerminalOpen, setTerminalOpen] = useState(false);
    const [smartLayout, setSmartLayout] = useState("side-by-side"); // "side-by-side" | "stacked"
    const [splitRatio, setSplitRatio] = useState(50); // terminal takes this % of space
    const appMainRef = useRef(null);
    const resizerDragging = useRef(false);

    useEffect(() => {
        if (!connected) return;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 14,
            theme: {
                background: "#0b0e14",
                foreground: "#4af626",
                cursor: "#4af626",
                selection: "#1c2230",
            },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        setTimeout(() => {
            if (terminalRef.current) {
                term.open(terminalRef.current);
            }
        }, 10);

        const handleResize = () => {
            if (!fitAddonRef.current || !xtermRef.current) return;
            fitAndResize(fitAddonRef.current, MAIN_SESSION_ID);
        };

        setTimeout(handleResize, 200);
        window.addEventListener("resize", handleResize);

        term.onData(data => {
            invoke("send_ssh_input", { sessionId: MAIN_SESSION_ID, input: data });
        });

        xtermRef.current = term;

        // Single SSH output listener — shared with SmartTerminal via xtermRef
        let unlisten;
        listen(`ssh-output:${MAIN_SESSION_ID}`, e => {
            xtermRef.current?.write(e.payload);
        }).then(fn => (unlisten = fn));

        return () => {
            window.removeEventListener("resize", handleResize);
            if (unlisten) unlisten();
            term.dispose();
            fitAddonRef.current = null;
        };
    }, [connected]);

    const isSmartTerminalActive = activeView === "terminal";

    // Re-fit terminal when layout/split changes
    useEffect(() => {
        if (connected && fitAddonRef.current && isTerminalOpen) {
            setTimeout(() => {
                fitAndResize(fitAddonRef.current, MAIN_SESSION_ID);
            }, 300);
        }
    }, [isTerminalOpen, connected, activeView, smartLayout, splitRatio]);

    // Draggable resizer between terminal and AI IDE
    const handleResizerMouseDown = useCallback((e) => {
        e.preventDefault();
        resizerDragging.current = true;
        document.body.style.cursor = smartLayout === "stacked" ? "row-resize" : "col-resize";
        document.body.style.userSelect = "none";

        const onMouseMove = (ev) => {
            if (!resizerDragging.current || !appMainRef.current) return;
            const rect = appMainRef.current.getBoundingClientRect();
            let ratio;
            if (smartLayout === "stacked") {
                ratio = ((ev.clientY - rect.top) / rect.height) * 100;
            } else {
                ratio = ((ev.clientX - rect.left) / rect.width) * 100;
            }
            setSplitRatio(Math.max(20, Math.min(80, ratio)));
        };

        const onMouseUp = () => {
            resizerDragging.current = false;
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
            // Refit after drag ends
            if (fitAddonRef.current) {
                setTimeout(() => fitAndResize(fitAddonRef.current, MAIN_SESSION_ID), 50);
            }
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
    }, [smartLayout]);

    const reconnect = useCallback(async () => {
        if (!connectedProfileId) {
            // Quick-connect: no stored credentials — fall back to login
            await invoke("close_ssh_session", { sessionId: MAIN_SESSION_ID }).catch(() => {});
            setConnected(false);
            xtermRef.current?.dispose();
            return;
        }
        setIsReconnecting(true);
        try {
            await invoke("close_ssh_session", { sessionId: MAIN_SESSION_ID }).catch(() => {});
            await invoke("connect_to_profile", { profileId: connectedProfileId, sessionId: MAIN_SESSION_ID });
            xtermRef.current?.clear();
            if (fitAddonRef.current) {
                setTimeout(() => fitAndResize(fitAddonRef.current, MAIN_SESSION_ID), 300);
            }
        } catch (err) {
            console.error("Reconnect failed:", err);
            setConnected(false);
            xtermRef.current?.dispose();
        } finally {
            setIsReconnecting(false);
        }
    }, [connectedProfileId]);

    const disconnect = async () => {
        await invoke("close_ssh_session", { sessionId: MAIN_SESSION_ID });
        setConnected(false);
        xtermRef.current?.dispose();
    };

    if (!connected) {
        return (
            <>
                <ConnectionHub
                    setConnected={setConnected}
                    ip={ip}
                    user={user}
                    setIp={setIp}
                    setUser={setUser}
                    setProfileName={setProfileName}
                    setHostFingerprint={setHostFingerprint}
                    userProp={user}
                    ipProp={ip}
                    setIsConnecting={setIsConnecting}
                    setProfileId={setConnectedProfileId}
                />
                {isConnecting && (
                    <div className="loading-overlay">
                        <div className="spinner"></div>
                        <div className="loading-text">Connecting to Server...</div>
                        <div className="loading-subtext">Establishing secure SSH handshake</div>
                    </div>
                )}
            </>
        );
    }

    return (
        <div className="app-shell" onDragOver={(e) => e.preventDefault()}>
            {/* Sidebar */}
            <div className="app-sidebar">
                {DEFAULT_SIDEBAR_ITEMS.filter(item => sidebarItems.includes(item.id)).map(item => {
                    const IconComp = item.icon;
                    return (
                        <div
                            key={item.id}
                            className="sidebar-icon"
                            title={item.label}
                            onClick={() => {
                                setActiveView(item.id);
                                // Auto-open terminal drawer when navigating to terminal view
                                if (item.id === "terminal" && !isTerminalOpen) setTerminalOpen(true);
                            }}
                            data-active={activeView === item.id}
                        >
                            <IconComp size={24} />
                        </div>
                    );
                })}

                <div className="sidebar-spacer"></div>

                <div className="sidebar-icon" title="Command Palette (Ctrl+K)"
                    onClick={() => setCmdOpen(true)}>
                    <CommandIcon size={24} />
                </div>
                <div className="sidebar-icon" title="Settings & Tools"
                    onClick={() => setActiveView("settings")}
                    data-active={activeView === "settings"}>
                    <Settings size={24} />
                </div>
                <div className="sidebar-icon danger" title="Disconnect" onClick={disconnect}>
                    <LogOut size={24} />
                </div>
            </div>

            {/* Main Content — all views stay mounted via display:none for state preservation */}
            <div ref={appMainRef} className={`app-main ${isSmartTerminalActive ? `smart-terminal-layout ${smartLayout}` : ""}`} onDragOver={(e) => e.preventDefault()}>
                <div className="view-container" onDragOver={(e) => e.preventDefault()}
                    style={isSmartTerminalActive && isTerminalOpen ? {
                        flex: `${100 - splitRatio} 1 0`,
                        minHeight: 0,
                        minWidth: 0,
                        overflow: "hidden",
                    } : undefined}>
                    <div style={{ display: activeView === "dashboard" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <Dashboard user={user} ip={ip} profileName={profileName} />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "files" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <FileExplorerLayout />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "terminal" ? "block" : "none", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <SmartTerminal
                                xtermRef={xtermRef}
                                onClose={() => setActiveView("dashboard")}
                                layout={smartLayout}
                                onLayoutChange={setSmartLayout}
                            />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "termhub" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <TermHub />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "processes" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <ProcessManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "ports" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <PortScanner />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "logs" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <LogViewer />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "snippets" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <Snippets />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "docker" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <DockerManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "ufw" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <UFWManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "apt" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <AptManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "permissions" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <PermissionModal 
                                isOpen={activeView === "permissions"} 
                                sessionId={MAIN_SESSION_ID} 
                                onClose={() => setActiveView("dashboard")} 
                            />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "settings" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <SettingsHub sidebarItems={sidebarItems} setSidebarItems={setSidebarItems} />
                        </ErrorBoundary>
                    </div>
                </div>

                {/* Draggable resizer between panels */}
                {isSmartTerminalActive && isTerminalOpen && (
                    <div
                        className={`split-resizer ${smartLayout}`}
                        onMouseDown={handleResizerMouseDown}
                    />
                )}

                {/* Terminal Drawer — forced open & larger when SmartTerminal active */}
                <div className={`terminal-drawer ${isTerminalOpen ? "open" : "closed"} ${isSmartTerminalActive ? "smart-terminal-mode" : ""}`}
                    style={isSmartTerminalActive && isTerminalOpen ? {
                        flex: `${splitRatio} 1 0`,
                        minHeight: 0,
                        minWidth: 0,
                    } : undefined}>
                    <div className="drawer-handle" onClick={() => {
                        if (!isSmartTerminalActive) setTerminalOpen(!isTerminalOpen);
                    }}>
                        <div className="handle-title">
                            <TerminalIcon size={14} />
                            <span style={{ marginLeft: 8 }}>Terminal</span>
                            {isSmartTerminalActive && <span className="handle-live-badge">LIVE</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="handle-status">{user}@{ip}</div>
                            <button
                                title={isReconnecting ? "Reconnecting..." : "Reconnect SSH"}
                                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
                                onClick={(e) => { e.stopPropagation(); reconnect(); }}
                                disabled={isReconnecting}
                            >
                                <RefreshCw size={12} style={isReconnecting ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>
                        </div>
                    </div>
                    <div className="terminal-container" ref={terminalRef}
                        style={{ display: (isTerminalOpen || isSmartTerminalActive) ? "block" : "none" }}></div>
                </div>
            </div>

            <div className="drag-underlay" onDragOver={(e) => e.preventDefault()} />

            <CommandPalette
                isOpen={cmdOpen}
                onClose={() => setCmdOpen(false)}
                onAction={(action, value) => {
                    if (action === 'setView') setActiveView(value);
                    if (action === 'disconnect') disconnect();
                }}
            />
        </div>
    );
}
