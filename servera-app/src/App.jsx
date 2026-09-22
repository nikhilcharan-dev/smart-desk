import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { LayoutDashboard, FolderOpen, Terminal as TerminalIcon, Monitor, LogOut, Cpu, Network, ScrollText, Code2, Box, Shield, PackageOpen, RefreshCw, ShieldCheck, Sparkles, Palette, KeyRound } from "lucide-react";

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
import PackageManager from "./components/PackageManager/PackageManager";
import PermissionModal from "./components/FileExplorer/PermissionModal";
import MfaModal from "./components/Common/MfaModal";
import HostKeyModal from "./components/Common/HostKeyModal";
import TunnelManager from "./components/TunnelManager/TunnelManager";
import FleetRunner from "./components/FleetRunner/FleetRunner";
import PlaybookRunner from "./components/PlaybookRunner/PlaybookRunner";
import CloudBrowser from "./components/CloudBrowser/CloudBrowser";
import TopBar from "./components/TopBar/TopBar";
import QuickVaultModal from "./components/Vault/QuickVaultModal";
import VaultManager from "./components/Vault/VaultManager";
import Modal from "./components/Common/Modal";
import { DEFAULT_SIDEBAR_ITEMS } from "./constants";
import StartupAnimation from "./components/StartupAnimation/StartupAnimation";

// Matches "localhost:PORT" / "127.0.0.1:PORT" printed by dev servers in
// terminal output, so they can be forwarded and opened in Cloud Browser.
const LOCAL_LINK_RE = /\b(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g;

/* ─────────────────────────────────────
   TERMINAL THEMES
───────────────────────────────────── */
const TERMINAL_THEMES = [
    {
        id: "hacker",
        name: "Hacker Green",
        swatch: "#0b0e14", accent: "#4af626",
        theme: { background: "#0b0e14", foreground: "#4af626", cursor: "#4af626", selection: "#1c2230",
            black: "#0b0e14", red: "#ff5555", green: "#4af626", yellow: "#f1fa8c",
            blue: "#6272a4", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
            brightBlack: "#44475a", brightRed: "#ff6e6e", brightGreen: "#69ff47", brightYellow: "#ffffa5",
            brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff" },
    },
    {
        id: "github-dark",
        name: "GitHub Dark",
        swatch: "#0d1117", accent: "#58a6ff",
        theme: { background: "#0d1117", foreground: "#c9d1d9", cursor: "#58a6ff", selection: "#1c2a42",
            black: "#0d1117", red: "#ff7b72", green: "#3fb950", yellow: "#d29922",
            blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
            brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341",
            brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc" },
    },
    {
        id: "dracula",
        name: "Dracula",
        swatch: "#282a36", accent: "#bd93f9",
        theme: { background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f0", selection: "#44475a",
            black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c",
            blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
            brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff47", brightYellow: "#ffffa5",
            brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff" },
    },
    {
        id: "nord",
        name: "Nord",
        swatch: "#2e3440", accent: "#88c0d0",
        theme: { background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", selection: "#434c5e",
            black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b",
            blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
            brightBlack: "#4c566a", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b",
            brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4" },
    },
    {
        id: "monokai",
        name: "Monokai",
        swatch: "#272822", accent: "#a6e22e",
        theme: { background: "#272822", foreground: "#f8f8f2", cursor: "#f8f8f0", selection: "#49483e",
            black: "#272822", red: "#f92672", green: "#a6e22e", yellow: "#f4bf75",
            blue: "#66d9e8", magenta: "#ae81ff", cyan: "#a1efe4", white: "#f8f8f2",
            brightBlack: "#75715e", brightRed: "#f92672", brightGreen: "#a6e22e", brightYellow: "#f4bf75",
            brightBlue: "#66d9e8", brightMagenta: "#ae81ff", brightCyan: "#a1efe4", brightWhite: "#f9f8f5" },
    },
    {
        id: "solarized",
        name: "Solarized Dark",
        swatch: "#002b36", accent: "#268bd2",
        theme: { background: "#002b36", foreground: "#839496", cursor: "#839496", selection: "#073642",
            black: "#073642", red: "#dc322f", green: "#859900", yellow: "#b58900",
            blue: "#268bd2", magenta: "#d33682", cyan: "#2aa198", white: "#eee8d5",
            brightBlack: "#002b36", brightRed: "#cb4b16", brightGreen: "#586e75", brightYellow: "#657b83",
            brightBlue: "#839496", brightMagenta: "#6c71c4", brightCyan: "#93a1a1", brightWhite: "#fdf6e3" },
    },
    {
        id: "one-dark",
        name: "One Dark",
        swatch: "#282c34", accent: "#61afef",
        theme: { background: "#282c34", foreground: "#abb2bf", cursor: "#528bff", selection: "#3e4451",
            black: "#282c34", red: "#e06c75", green: "#98c379", yellow: "#e5c07b",
            blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#abb2bf",
            brightBlack: "#5c6370", brightRed: "#e06c75", brightGreen: "#98c379", brightYellow: "#e5c07b",
            brightBlue: "#61afef", brightMagenta: "#c678dd", brightCyan: "#56b6c2", brightWhite: "#ffffff" },
    },
];

export default function App() {
    const [showStartup, setShowStartup] = useState(true);
    const [loginEntering, setLoginEntering] = useState(false);
    const [connected, setConnected] = useState(false);
    const [ip, setIp] = useState("");
    const [user, setUser] = useState("");
    const [profileName, setProfileName] = useState("");
    const [connectedProfileId, setConnectedProfileId] = useState(null);
    // Held only for the lifetime of the session so TunnelManager can open
    // new tunnels with the same credentials used to connect.
    const [connPort, setConnPort] = useState(22);
    const [connPassword, setConnPassword] = useState("");
    const [connPrivateKey, setConnPrivateKey] = useState("");
    const [connProxyJump, setConnProxyJump] = useState("");
    const [isReconnecting, setIsReconnecting] = useState(false);
    // eslint-disable-next-line no-unused-vars
    const [hostFingerprint, setHostFingerprint] = useState("");

    // Views: 'dashboard' | 'files' | 'terminal' | 'termhub' | 'processes' | 'ports' | 'logs' | 'snippets' | 'ai-settings'
    const [activeView, setActiveView] = useState("dashboard");
    const [isConnecting, setIsConnecting] = useState(false);
    const [cmdOpen, setCmdOpen] = useState(false);
    const [quickVaultOpen, setQuickVaultOpen] = useState(false);

    // Sidebar customization — persisted to localStorage
    // Merges any newly added DEFAULT_SIDEBAR_ITEMS so existing users see new features
    const [sidebarItems, setSidebarItemsRaw] = useState(() => {
        const allIds = DEFAULT_SIDEBAR_ITEMS.map(i => i.id);
        try {
            const saved = localStorage.getItem('sidebarItems');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    const savedSet = new Set(parsed);
                    const missing = allIds.filter(id => !savedSet.has(id));
                    if (missing.length > 0) {
                        const merged = [...parsed, ...missing];
                        localStorage.setItem('sidebarItems', JSON.stringify(merged));
                        return merged;
                    }
                    return parsed;
                }
            }
        } catch { /* ignore parse errors */ }
        return allIds;
    });
    const setSidebarItems = (items) => {
        setSidebarItemsRaw(items);
        localStorage.setItem('sidebarItems', JSON.stringify(items));
    };

    // Global listeners: Command Palette (Ctrl+K) & Quick Vault (Alt+V)
    useEffect(() => {
        const handleKeyDown = (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setCmdOpen(prev => !prev);
            }
            if (e.altKey && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                setQuickVaultOpen(prev => !prev);
            }
        };
        const handleOpenVaultEvent = () => setQuickVaultOpen(true);
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('open-quick-vault', handleOpenVaultEvent);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('open-quick-vault', handleOpenVaultEvent);
        };
    }, []);

    // XTerm Refs for Bottom Manual Drawer
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);
    const [isTerminalOpen, setTerminalOpen] = useState(false);
    const [smartLayout] = useState("side-by-side");
    const [splitRatio, setSplitRatio] = useState(50); // terminal takes this % of space
    const [showOpsPilot, setShowOpsPilot] = useState(false); // whether OpsPilot panel is visible

    // Cloud Browser — the currently-shown forwarded URL, plus terminal
    // link-click auto-tunneling state.
    const [cloudBrowserUrl, setCloudBrowserUrl] = useState(null);
    const [portConfirm, setPortConfirm] = useState(null); // { port } | null
    const confirmedPortsRef = useRef(new Set());
    // Always-fresh snapshot of connection params, read by the terminal link
    // handler so its closure (captured once when the xterm instance is
    // created) never sees stale credentials.
    const connParamsRef = useRef({});
    connParamsRef.current = { ip, user, connPort, connPassword, connPrivateKey, connProxyJump, connectedProfileId };

    // Sidebar tooltip (fixed-position, immune to overflow clipping)
    const [sidebarTip, setSidebarTip] = useState(null); // { text, top, left }

    const showTip = (e, text) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setSidebarTip({ text, top: rect.top + rect.height / 2, left: rect.right + 12 });
    };
    const hideTip = () => setSidebarTip(null);

    // Terminal theme
    const [termThemeId, setTermThemeId] = useState(() => localStorage.getItem("term_theme") || "hacker");
    const [termThemePickerOpen, setTermThemePickerOpen] = useState(false);
    const appMainRef = useRef(null);
    const resizerDragging = useRef(false);

    useEffect(() => {
        if (!connected) return;

        const initialTheme = TERMINAL_THEMES.find(t => t.id === termThemeId)?.theme
            ?? TERMINAL_THEMES[0].theme;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 14,
            theme: initialTheme,
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

        // Clipboard integration: Ctrl+C copies selection (no SIGINT), Ctrl+V pastes
        term.attachCustomKeyEventHandler((e) => {
            if (e.type !== 'keydown') return true;

            // Alt+V → Open Quick Secrets Vault directly from terminal
            if (e.altKey && e.key.toLowerCase() === 'v') {
                e.preventDefault();
                setQuickVaultOpen(prev => !prev);
                return false;
            }

            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return true;

            // Ctrl+C with active selection → copy, don't send SIGINT
            if (e.key === 'c' && !e.shiftKey && term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                return false;
            }
            // Ctrl+Shift+C → copy selection (always)
            if (e.key === 'C' && e.shiftKey) {
                if (term.hasSelection()) {
                    navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                }
                return false;
            }
            // Ctrl+V / Ctrl+Shift+V → paste from clipboard into terminal
            if (e.key === 'v' || e.key === 'V') {
                e.preventDefault();
                navigator.clipboard.readText().then(text => {
                    if (text) invoke("send_ssh_input", { sessionId: MAIN_SESSION_ID, input: text });
                }).catch(() => {});
                return false;
            }
            return true;
        });

        xtermRef.current = term;

        // Detect "localhost:PORT" / "127.0.0.1:PORT" in terminal output and
        // make it clickable — activating it auto-forwards the port and opens
        // it in Cloud Browser (see handleLocalLinkClick).
        term.registerLinkProvider({
            provideLinks(bufferLineNumber, callback) {
                const line = term.buffer.active.getLine(bufferLineNumber - 1);
                if (!line) { callback(undefined); return; }
                const text = line.translateToString(true);
                const links = [];
                LOCAL_LINK_RE.lastIndex = 0;
                let match;
                while ((match = LOCAL_LINK_RE.exec(text)) !== null) {
                    const port = parseInt(match[1], 10);
                    links.push({
                        range: {
                            start: { x: match.index + 1, y: bufferLineNumber },
                            end: { x: match.index + match[0].length + 1, y: bufferLineNumber },
                        },
                        text: match[0],
                        activate: () => handleLocalLinkClickRef.current(port),
                    });
                }
                callback(links.length ? links : undefined);
            },
        });

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

    // Apply terminal theme dynamically when changed
    useEffect(() => {
        localStorage.setItem("term_theme", termThemeId);
        const t = TERMINAL_THEMES.find(t => t.id === termThemeId);
        if (t && xtermRef.current) {
            xtermRef.current.options.theme = t.theme;
        }
    }, [termThemeId]);

    const openInCloudBrowser = useCallback((url) => {
        setCloudBrowserUrl(url);
        setActiveView("cloudbrowser");
    }, []);

    // Ensures a local port-forward to 127.0.0.1:<port> on the connected VM
    // exists (reusing one if already active), then opens it in Cloud Browser.
    const forwardPortToCloudBrowser = useCallback(async (port) => {
        const { ip, user, connPort, connPassword, connPrivateKey, connProxyJump, connectedProfileId } = connParamsRef.current;
        try {
            const active = await invoke("get_active_tunnels").catch(() => []);
            const existing = (active || []).find(t =>
                t.tunnel_type === "local" &&
                t.remote_port === port &&
                (t.remote_host === "127.0.0.1" || t.remote_host === "localhost")
            );
            if (existing) {
                openInCloudBrowser(`http://localhost:${existing.local_port}`);
                return;
            }

            const tryCreate = async (localPort) => invoke("create_tunnel", {
                sessionId: MAIN_SESSION_ID,
                tunnelId: `cloud-${port}-${Date.now()}`,
                tunnelType: "local",
                localPort,
                remoteHost: "127.0.0.1",
                remotePort: port,
                ip, user,
                port: connPort || 22,
                password: connPassword || null,
                privateKey: connPrivateKey || null,
                proxyJump: connProxyJump || null,
                profileId: connectedProfileId || null,
            });

            let info;
            try {
                info = await tryCreate(port);
            } catch {
                // Local port already taken by something else — retry once on a random free-ish port.
                const fallbackPort = 20000 + Math.floor(Math.random() * 20000);
                info = await tryCreate(fallbackPort);
            }
            openInCloudBrowser(`http://localhost:${info.local_port}`);
        } catch (err) {
            console.error("Failed to forward port to Cloud Browser:", err);
        }
    }, [openInCloudBrowser]);

    // First click on a given remote port asks for confirmation; afterwards
    // (for this session) it forwards straight through. Exposed via a ref so
    // the terminal's link provider (registered once per xterm instance) always
    // calls the latest version without needing to be in that effect's deps.
    const handleLocalLinkClickRef = useRef(() => {});
    handleLocalLinkClickRef.current = (port) => {
        if (confirmedPortsRef.current.has(port)) {
            forwardPortToCloudBrowser(port);
        } else {
            setPortConfirm({ port });
        }
    };

    const isSmartTerminalActive = activeView === "terminal" && showOpsPilot;
    // Terminal-only mode: terminal tab active but OpsPilot closed → xterm goes fullscreen
    const terminalOnlyMode = activeView === "terminal" && !showOpsPilot;

    // Re-fit terminal when layout/split changes
    useEffect(() => {
        if (connected && fitAddonRef.current && isTerminalOpen) {
            setTimeout(() => {
                fitAndResize(fitAddonRef.current, MAIN_SESSION_ID);
            }, 300);
        }
    }, [isTerminalOpen, connected, activeView, smartLayout, splitRatio, showOpsPilot]);

    // Draggable resizer between terminal and AI IDE
    const handleResizerMouseDown = useCallback((e) => {
        e.preventDefault();
        resizerDragging.current = true;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";

        const onMouseMove = (ev) => {
            if (!resizerDragging.current || !appMainRef.current) return;
            const rect = appMainRef.current.getBoundingClientRect();
            const ratio = ((ev.clientX - rect.left) / rect.width) * 100;
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
        // Tear down every backend session — the main terminal, TermHub panes,
        // log streams and tunnels. Closing only the main session left readers
        // and forwards attached to the old host, so its output kept arriving
        // after connecting to a different server.
        await invoke("disconnect_all").catch(() => {});
        setConnected(false);
        setLoginEntering(false);
        // Connection identity
        setConnectedProfileId(null);
        setIp("");
        setUser("");
        setProfileName("");
        setHostFingerprint("");
        setConnPort(22);
        setConnPassword("");
        setConnPrivateKey("");
        setConnProxyJump("");
        // Per-connection UI state
        setActiveView("dashboard");
        setTerminalOpen(false);
        setShowOpsPilot(false);
        setCloudBrowserUrl(null);
        setPortConfirm(null);
        confirmedPortsRef.current = new Set();
        xtermRef.current?.dispose();
        xtermRef.current = null;
    };

    if (!connected) {
        return (
            <>
                {/* ConnectionHub always rendered — startup animation overlays on top */}
                <ConnectionHub
                    isEntering={loginEntering}
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
                    setConnPort={setConnPort}
                    setConnPassword={setConnPassword}
                    setConnPrivateKey={setConnPrivateKey}
                    setConnProxyJump={setConnProxyJump}
                />
                {/* Startup sits on top (position:fixed z-index:9999), fades to reveal ConnectionHub */}
                {showStartup && (
                    <StartupAnimation
                        onFadingStart={() => setLoginEntering(true)}
                        onDone={() => setShowStartup(false)}
                    />
                )}
                {isConnecting && (
                    <div className="loading-overlay">
                        <div className="spinner"></div>
                        <div className="loading-text">Connecting to Server...</div>
                        <div className="loading-subtext">Establishing secure SSH handshake</div>
                    </div>
                )}
                {/* Prompts fire during the initial handshake, before `connected`
                    flips — so they must be mounted on the login screen too. */}
                <HostKeyModal />
                <MfaModal />
                <QuickVaultModal
                    isOpen={quickVaultOpen}
                    onClose={() => setQuickVaultOpen(false)}
                />
            </>
        );
    }

    return (
        <div className="app-shell" onDragOver={(e) => e.preventDefault()}>
            <TopBar
                ip={ip}
                user={user}
                profileName={profileName}
                onOpenVault={() => setQuickVaultOpen(true)}
                onOpenCmd={() => setCmdOpen(true)}
                onOpenSettings={() => setActiveView("settings")}
                isSettingsActive={activeView === "settings"}
            />
            <div className="app-shell-row">
            {/* Sidebar */}
            <div className="app-sidebar">
                {DEFAULT_SIDEBAR_ITEMS.filter(item => sidebarItems.includes(item.id)).map(item => {
                    const IconComp = item.icon;
                    return (
                        <div
                            key={item.id}
                            className="sidebar-icon"
                            onClick={() => {
                                setActiveView(item.id);
                                if (item.id === "terminal") {
                                    if (!isTerminalOpen) setTerminalOpen(true);
                                }
                            }}
                            onMouseEnter={(e) => showTip(e, item.label)}
                            onMouseLeave={hideTip}
                            data-active={activeView === item.id}
                        >
                            <IconComp size={22} />
                        </div>
                    );
                })}

                <div className="sidebar-spacer"></div>

                <div className="sidebar-icon danger"
                    onClick={disconnect}
                    onMouseEnter={(e) => showTip(e, "Disconnect")}
                    onMouseLeave={hideTip}>
                    <LogOut size={22} />
                </div>

                {sidebarTip && (
                    <div className="sidebar-tip" style={{ top: sidebarTip.top, left: sidebarTip.left }}>
                        {sidebarTip.text}
                    </div>
                )}
            </div>

            {/* Main Content — all views stay mounted via display:none for state preservation */}
            <div ref={appMainRef} className={`app-main ${isSmartTerminalActive ? `smart-terminal-layout ${smartLayout}` : ""}`} onDragOver={(e) => e.preventDefault()}>
                <div className="view-container" onDragOver={(e) => e.preventDefault()}
                    style={terminalOnlyMode ? { display: "none" } : isSmartTerminalActive && isTerminalOpen ? {
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
                            <FileExplorerLayout profileId={connectedProfileId} />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "terminal" ? "flex" : "none", flexDirection: "column", flex: "1 1 0", minHeight: 0, minWidth: 0 }}>
                        <ErrorBoundary>
                            <SmartTerminal
                                xtermRef={xtermRef}
                                onClose={() => setShowOpsPilot(false)}
                                layout={smartLayout}
                                onLayoutChange={() => {}}
                                ip={ip}
                                user={user}
                                port={connPort}
                                password={connPassword}
                                privateKey={connPrivateKey}
                                proxyJump={connProxyJump}
                                profileId={connectedProfileId}
                                onOpenCloudBrowser={openInCloudBrowser}
                            />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "cloudbrowser" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <CloudBrowser
                                active={activeView === "cloudbrowser"}
                                url={cloudBrowserUrl}
                                onClose={() => setCloudBrowserUrl(null)}
                                onCreateTunnel={() => setActiveView("tunnels")}
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
                            <LogViewer profileId={connectedProfileId} ip={ip} user={user} port={connPort} password={connPassword} privateKey={connPrivateKey} proxyJump={connProxyJump} />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "snippets" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <Snippets />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "vault" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <VaultManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "docker" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <DockerManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "tunnels" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <TunnelManager
                                ip={ip}
                                user={user}
                                port={connPort}
                                password={connPassword}
                                privateKey={connPrivateKey}
                                proxyJump={connProxyJump}
                                profileId={connectedProfileId}
                                onOpenCloudBrowser={openInCloudBrowser}
                            />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "fleet" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <FleetRunner />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "playbooks" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <PlaybookRunner />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "ufw" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <UFWManager />
                        </ErrorBoundary>
                    </div>
                    <div style={{ display: activeView === "apt" ? "flex" : "none", flexDirection: "column", height: "100%", width: "100%" }}>
                        <ErrorBoundary>
                            <PackageManager />
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
                <div className={`terminal-drawer ${(isTerminalOpen || terminalOnlyMode) ? "open" : "closed"} ${(isSmartTerminalActive || terminalOnlyMode) ? "smart-terminal-mode" : ""}`}
                    style={terminalOnlyMode ? {
                        flex: "1 1 0",
                        minHeight: 0,
                        minWidth: 0,
                        height: "auto",
                    } : isSmartTerminalActive && isTerminalOpen ? {
                        flex: `${splitRatio} 1 0`,
                        minHeight: 0,
                        minWidth: 0,
                    } : undefined}>
                    <div className="drawer-handle" onClick={() => {
                        if (!isSmartTerminalActive && !terminalOnlyMode) setTerminalOpen(!isTerminalOpen);
                    }}>
                        <div className="handle-title">
                            <TerminalIcon size={14} />
                            <span style={{ marginLeft: 8 }}>Terminal</span>
                            {(isSmartTerminalActive || terminalOnlyMode) && <span className="handle-live-badge">LIVE</span>}
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div className="handle-status">{user}@{ip}</div>

                            {/* Terminal Theme Swatches — inline when open */}
                            {termThemePickerOpen && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                                    {TERMINAL_THEMES.map(t => (
                                        <button
                                            key={t.id}
                                            title={t.name}
                                            className={`term-swatch-btn ${termThemeId === t.id ? 'active' : ''}`}
                                            onClick={(e) => { e.stopPropagation(); setTermThemeId(t.id); setTermThemePickerOpen(false); }}
                                            style={{
                                                width: 14, height: 14,
                                                background: t.swatch,
                                                border: `2px solid ${termThemeId === t.id ? t.accent : 'transparent'}`,
                                                boxShadow: termThemeId === t.id ? `0 0 0 2px ${t.accent}55` : 'none',
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                            <button
                                title="Terminal Theme"
                                onClick={(e) => { e.stopPropagation(); setTermThemePickerOpen(p => !p); }}
                                style={{ background: termThemePickerOpen ? '#1c2230' : 'none', border: 'none', color: termThemePickerOpen ? '#c9d1d9' : '#9ca3af', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center', borderRadius: 4 }}
                            >
                                <Palette size={12} />
                            </button>

                            <button
                                title={isReconnecting ? "Reconnecting..." : "Reconnect SSH"}
                                style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', padding: '2px 4px', display: 'flex', alignItems: 'center' }}
                                onClick={(e) => { e.stopPropagation(); reconnect(); }}
                                disabled={isReconnecting}
                            >
                                <RefreshCw size={12} style={isReconnecting ? { animation: 'spin 1s linear infinite' } : {}} />
                            </button>

                            <button
                                title="Secrets Vault (Alt+V) — Copy credentials & paste"
                                style={{
                                    background: 'rgba(79, 124, 255, 0.15)',
                                    border: '1px solid rgba(79, 124, 255, 0.3)',
                                    borderRadius: '4px',
                                    color: '#c9d1d9',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                    fontSize: '11px',
                                }}
                                onClick={(e) => { e.stopPropagation(); setQuickVaultOpen(true); }}
                            >
                                <KeyRound size={12} style={{ color: '#4f7cff' }} />
                                <span>Vault</span>
                            </button>
                            {terminalOnlyMode && (
                                <button
                                    title="Open OpsPilot AI"
                                    onClick={(e) => { e.stopPropagation(); setShowOpsPilot(true); }}
                                    style={{
                                        background: 'linear-gradient(135deg, #1f6feb, #388bfd)',
                                        border: 'none',
                                        borderRadius: '6px',
                                        color: 'white',
                                        cursor: 'pointer',
                                        padding: '3px 10px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '5px',
                                        fontSize: '11px',
                                        fontWeight: 700,
                                        letterSpacing: '0.02em',
                                    }}
                                >
                                    <Sparkles size={11} />
                                    OpsPilot
                                </button>
                            )}
                        </div>
                    </div>
                    <div className="terminal-container" ref={terminalRef}
                        style={{ display: (isTerminalOpen || isSmartTerminalActive) ? "block" : "none" }}></div>
                </div>
            </div>
            </div>

            <div className="drag-underlay" onDragOver={(e) => e.preventDefault()} />

            <CommandPalette
                isOpen={cmdOpen}
                onClose={() => setCmdOpen(false)}
                onAction={(action, value) => {
                    if (action === 'setView') setActiveView(value);
                    if (action === 'disconnect') disconnect();
                    if (action === 'openQuickVault') setQuickVaultOpen(true);
                }}
            />

            <QuickVaultModal
                isOpen={quickVaultOpen}
                onClose={() => setQuickVaultOpen(false)}
                onOpenFullVault={() => {
                    setQuickVaultOpen(false);
                    setActiveView("vault");
                }}
            />

            <HostKeyModal />
            <MfaModal />

            <Modal
                isOpen={!!portConfirm}
                title="Forward to Cloud Browser?"
                type="confirm"
                confirmText="Open"
                cancelText="Cancel"
                onCancel={() => setPortConfirm(null)}
                onConfirm={() => {
                    const port = portConfirm.port;
                    confirmedPortsRef.current.add(port);
                    setPortConfirm(null);
                    forwardPortToCloudBrowser(port);
                }}
            >
                Forward <strong>localhost:{portConfirm?.port}</strong> through this SSH session and open it in Cloud Browser?
            </Modal>
        </div>
    );
}
