import React, { useEffect, useRef } from 'react';
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { X } from 'lucide-react';
import "@xterm/xterm/css/xterm.css";
import './TerminalPane.css';

export default function TerminalPane({ sessionId, profile, isActive, onFocus, onClose, showCloseBtn }) {
    const terminalRef = useRef(null);
    const xtermRef = useRef(null);
    const fitAddonRef = useRef(null);

    useEffect(() => {
        if (!sessionId) return;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 13,
            theme: {
                background: "#0a0e17",
                foreground: "#c9d1d9",
                cursor: "#3b82f6",
                selection: "#1c2a42",
                black: "#0a0e17",
                red: "#ef4444",
                green: "#10b981",
                yellow: "#f59e0b",
                blue: "#3b82f6",
                magenta: "#8b5cf6",
                cyan: "#06b6d4",
                white: "#e8edf5",
            },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        fitAddonRef.current = fitAddon;

        if (terminalRef.current) {
            term.open(terminalRef.current);
        }

        const handleResize = () => {
            if (!fitAddonRef.current || !xtermRef.current) return;
            try {
                fitAddon.fit();
                const dims = fitAddon.proposeDimensions();
                if (dims && dims.cols > 0 && dims.rows > 0) {
                    invoke("resize_terminal", {
                        sessionId: sessionId,
                        cols: dims.cols,
                        rows: dims.rows
                    }).catch(console.error);
                }
            } catch (e) {
                console.warn("Pane resize failed:", e);
            }
        };

        // Listen for SSH output for this session
        let unlisten;
        listen(`ssh-output:${sessionId}`, (e) => {
            term.write(e.payload);
        }).then(fn => unlisten = fn);

        // Handle user input
        term.onData(data => {
            invoke("send_ssh_input", { sessionId, input: data })
                .catch(err => {
                    term.write(`\r\n\x1b[31m[Error] ${err}\x1b[0m\r\n`);
                });
        });

        // Clipboard integration: Ctrl+C copies selection (no SIGINT), Ctrl+V pastes
        term.attachCustomKeyEventHandler((e) => {
            if (e.type !== 'keydown') return true;
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
                    if (text) invoke("send_ssh_input", { sessionId, input: text });
                }).catch(() => {});
                return false;
            }
            return true;
        });

        xtermRef.current = term;

        // Initial fit
        setTimeout(handleResize, 150);
        const resizeObserver = new ResizeObserver(() => handleResize());
        if (terminalRef.current) resizeObserver.observe(terminalRef.current);

        return () => {
            unlisten && unlisten();
            resizeObserver.disconnect();
            term.dispose();
        };
    }, [sessionId]);

    // Re-fit when pane becomes active
    useEffect(() => {
        if (isActive && fitAddonRef.current && xtermRef.current) {
            setTimeout(() => {
                try {
                    fitAddonRef.current.fit();
                    const dims = fitAddonRef.current.proposeDimensions();
                    if (dims && dims.cols > 0 && dims.rows > 0) {
                        invoke("resize_terminal", {
                            sessionId: sessionId,
                            cols: dims.cols,
                            rows: dims.rows
                        }).catch(console.error);
                    }
                } catch (e) {
                    console.warn("Fit on activate failed:", e);
                }
            }, 100);
        }
    }, [isActive, sessionId]);

    return (
        <div
            className={`tp ${isActive ? 'tp--active' : ''}`}
            onClick={onFocus}
        >
            <div className="tp__header">
                <div className="tp__header-left">
                    <span className="tp__indicator" />
                    <span className="tp__title">
                        {profile ? profile.name : 'Terminal'}
                    </span>
                </div>
                <div className="tp__header-right">
                    <span className="tp__session-id">
                        {profile ? `${profile.user}@${profile.ip}` : sessionId}
                    </span>
                    {showCloseBtn && onClose && (
                        <button
                            className="tp__close-btn"
                            onClick={(e) => { e.stopPropagation(); onClose(); }}
                            title="Close session"
                        >
                            <X size={11} />
                        </button>
                    )}
                </div>
            </div>
            <div className="tp__body" ref={terminalRef} />
        </div>
    );
}
