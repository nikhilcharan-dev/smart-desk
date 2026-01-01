import "./styles.css";
import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Login({ setConnected, setUser, setIp, user, ip }) {
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");

    const connect = async (e) => {
        e.preventDefault();

        if (!ip.trim() || !user.trim() || !password.trim()) {
            setError("All fields are required");
            return;
        }

        setError("");

        try {
            await invoke("start_ssh_session", { ip, user, password });
            setConnected(true);
        } catch (e) {
            setError(String(e));
        }
    };

    return (
        <div className="login-wrapper">
            <div className="login-header">
                <h1 className="login-title">Smart Desk</h1>

                <p className="login-subtitle">
                    SSH → Reimagined. Rebuilt for You.
                </p>

                <p className="login-micro">
                    Built for headless servers and focused workflows.
                </p>
            </div>

            <form className="login-card" onSubmit={connect}>
                <h3 className="login-card-title">SSH Credentials</h3>
                <div className="login-fields">
                    <div className="login-row">
                        <input
                            placeholder="Username"
                            value={user}
                            onChange={(e) => setUser(e.target.value)}
                            required
                        />

                        <input
                            placeholder="Server IP"
                            value={ip}
                            onChange={(e) => setIp(e.target.value)}
                            required
                        />
                    </div>

                    <input
                        type="password"
                        placeholder="Password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                    />

                    {error && <div className="error-text">{error}</div>}
                </div>

                <button className="primary-btn" type="submit">
                    Connect
                </button>
            </form>
        </div>
    );
}
