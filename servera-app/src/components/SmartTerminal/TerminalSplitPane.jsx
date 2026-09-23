import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X, Terminal as TerminalIcon } from "lucide-react";
import { fitAndResize } from "../../utils/terminal";
import "@xterm/xterm/css/xterm.css";
import "./TerminalSplitPane.css";

const LOCAL_LINK_RE = /\b(?:localhost|127\.0\.0\.1):(\d{2,5})\b/g;

export default function TerminalSplitPane({
    sessionId,
    title,
    isPrimary = false,
    isActive = false,
    theme,
    onFocus,
    onClose,
    onOpenVault,
    onOpenCloudBrowser,
    style = {},
}) {
    const canvasRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);

    const onCloseRef = useRef(onClose);
    const onOpenVaultRef = useRef(onOpenVault);
    const onOpenCloudBrowserRef = useRef(onOpenCloudBrowser);
    const initialThemeRef = useRef(theme);

    useEffect(() => {
        onCloseRef.current = onClose;
        onOpenVaultRef.current = onOpenVault;
        onOpenCloudBrowserRef.current = onOpenCloudBrowser;
    });

    useEffect(() => {
        if (!sessionId) return;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 13,
            theme: initialThemeRef.current || {
                background: "#0b0e14",
                foreground: "#4af626",
                cursor: "#4af626",
                selection: "#1c2230",
            },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        if (canvasRef.current) {
            term.open(canvasRef.current);
        }

        const handleResize = () => {
            if (!fitAddonRef.current || !xtermRef.current) return;
            fitAndResize(fitAddonRef.current, sessionId);
        };

        setTimeout(handleResize, 100);
        window.addEventListener("resize", handleResize);
        window.addEventListener("focus", handleResize);

        // ResizeObserver to automatically refit when pane sizes change
        const resizeObserver = new ResizeObserver(() => {
            handleResize();
        });
        if (canvasRef.current) {
            resizeObserver.observe(canvasRef.current);
        }

        // Handle user keyboard input to this session
        term.onData((data) => {
            invoke("send_ssh_input", { sessionId, input: data }).catch(() => {});
        });

        // Register link provider for localhost:PORT -> Cloud Browser
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
                        activate: () => {
                            if (onOpenCloudBrowserRef.current) onOpenCloudBrowserRef.current(port);
                        },
                    });
                }
                callback(links.length ? links : undefined);
            },
        });

        // Key handler for copy/paste & Alt+V Quick Vault
        term.attachCustomKeyEventHandler((e) => {
            if (e.type !== "keydown") return true;

            // Alt+V -> Open Quick Secrets Vault
            if (e.altKey && e.key.toLowerCase() === "v") {
                e.preventDefault();
                if (onOpenVaultRef.current) onOpenVaultRef.current();
                return false;
            }

            // Alt+T -> Open another split terminal
            if (e.altKey && e.key.toLowerCase() === "t") {
                e.preventDefault();
                window.dispatchEvent(new CustomEvent("open-split-terminal"));
                return false;
            }

            // Alt+W -> Close this split terminal (if not primary)
            if (e.altKey && e.key.toLowerCase() === "w" && !isPrimary && onCloseRef.current) {
                e.preventDefault();
                onCloseRef.current();
                return false;
            }

            const ctrl = e.ctrlKey || e.metaKey;
            if (!ctrl) return true;

            // Ctrl+C with active selection -> copy (no SIGINT)
            if (e.key === "c" && !e.shiftKey && term.hasSelection()) {
                navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                return false;
            }

            // Ctrl+Shift+C -> copy selection
            if (e.key === "C" && e.shiftKey) {
                if (term.hasSelection()) {
                    navigator.clipboard.writeText(term.getSelection()).catch(() => {});
                }
                return false;
            }

            // Ctrl+V / Ctrl+Shift+V -> paste from clipboard into terminal
            if (e.key === "v" || e.key === "V") {
                e.preventDefault();
                navigator.clipboard.readText().then((text) => {
                    if (text) invoke("send_ssh_input", { sessionId, input: text });
                }).catch(() => {});
                return false;
            }

            return true;
        });

        // Listen for output on this session's channel
        let unlisten;
        let cancelled = false;
        // `cancelled` closes the gap between registering the listener and the
        // promise resolving: an unmount in that window used to leave `unlisten`
        // undefined, so the handler stayed attached for the rest of the session.
        listen(`ssh-output:${sessionId}`, (e) => {
            term.write(e.payload);
        }).then((fn) => {
            if (cancelled) fn();
            else unlisten = fn;
        });

        xtermRef.current = term;

        return () => {
            window.removeEventListener("resize", handleResize);
            window.removeEventListener("focus", handleResize);
            resizeObserver.disconnect();
            cancelled = true;
            if (unlisten) unlisten();
            term.dispose();
            fitAddonRef.current = null;
            xtermRef.current = null;
        };
    }, [sessionId, isPrimary]);

    // Apply updated theme dynamically
    useEffect(() => {
        if (xtermRef.current && theme) {
            xtermRef.current.options.theme = theme;
        }
    }, [theme]);

    return (
        <div
            className={`term-split-pane ${isActive ? "active" : ""}`}
            style={style}
            onClick={onFocus}
        >
            <div className="term-split-pane-bar">
                <div className="term-split-pane-tag">
                    <TerminalIcon size={12} className="term-split-icon" />
                    <span className="term-split-title">{title}</span>
                    <span className={`term-split-dot ${isPrimary ? "primary" : "sub"}`} />
                </div>
                <div className="term-split-pane-actions">
                    {!isPrimary && onClose && (
                        <button
                            className="term-split-close-btn"
                            onClick={(e) => {
                                e.stopPropagation();
                                onClose();
                            }}
                            title="Close this terminal pane (Alt+W)"
                        >
                            <X size={13} />
                        </button>
                    )}
                </div>
            </div>
            <div className="term-split-canvas" ref={canvasRef} />
        </div>
    );
}
