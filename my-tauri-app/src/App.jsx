import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef, useState } from "react";

import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import "./App.css";
import Login from "./pages/login/Login.jsx";

export default function App() {
    const [connected, setConnected] = useState(false);
    const [ip, setIp] = useState("");
    const [user, setUser] = useState("");

    const terminalRef = useRef(null);
    const xtermRef = useRef(null);

    useEffect(() => {
        if (!connected) return;

        const term = new Terminal({
            cursorBlink: true,
            fontFamily: "JetBrains Mono, monospace",
            fontSize: 14,
            theme: {
                background: "#0b0e14",
                foreground: "#eaeaea",
                cursor: "#4f9cff",
                selection: "#1c2230",
            },
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.open(terminalRef.current);
        fitAddon.fit();

        term.onData(data => {
            invoke("send_ssh_input", { input: data });
        });

        xtermRef.current = term;

        return () => term.dispose();
    }, [connected]);

    useEffect(() => {
        let unlisten;
        listen("ssh-output", e => {
            xtermRef.current?.write(e.payload);
        }).then(fn => (unlisten = fn));

        return () => unlisten && unlisten();
    }, []);

    const disconnect = async () => {
        await invoke("close_ssh_session");
        xtermRef.current?.dispose();
        xtermRef.current = null;
        setConnected(false);
    };


    if (!connected) {
        return (
            <Login
                setConnected={setConnected}
                ip={ip}
                user={user}
                setIp={setIp}
                setUser={setUser}
            />
        );
    }

    return (
        <div className="app-shell">
            <header className="terminal-header">
                <span className="session-id">
                  {user}@{ip}
                </span>
                <button className="disconnect-btn" onClick={disconnect}>
                    Disconnect
                </button>
            </header>

            <div className="terminal-container" ref={terminalRef} />
        </div>
    );
}
