import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Webview } from "@tauri-apps/api/webview";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalPosition, LogicalSize } from "@tauri-apps/api/dpi";
import { ExternalLink, X, Globe, Cloud, ArrowRight, ArrowRightLeft } from "lucide-react";
import "./CloudBrowser.css";

// Present as a plain desktop Chrome build rather than an embedded WebView2.
// Many sign-in flows (Google's especially) refuse embedded webviews via
// user-agent sniffing; a clean Chrome UA is the standard best-effort
// workaround. Only applied to Cloud Browser webviews, never the main app.
const BROWSER_USER_AGENT =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// Adds a scheme if the user typed a bare host/port. localhost & LAN-style
// hosts default to http; everything else to https.
function normalizeUrl(raw) {
    const s = (raw || "").trim();
    if (!s) return null;
    if (/^https?:\/\//i.test(s)) return s;
    if (/^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(s)) return "http://" + s;
    return "https://" + s;
}

// Servera embeds forwarded VM services (dev servers, code-server, etc.) in a
// native child webview pinned over this panel, rather than kicking the user
// out to their OS browser. It also doubles as a general in-app browser — the
// same webview can surf the public internet when no tunnel is open.
export default function CloudBrowser({ active, url, onClose, onCreateTunnel }) {
    const containerRef = useRef(null);
    const webviewRef = useRef(null);
    const currentUrlRef = useRef(null);
    const [currentUrl, setCurrentUrl] = useState(url || null);
    const [addressInput, setAddressInput] = useState(url || "");
    const [status, setStatus] = useState(url ? "loading" : "idle");

    // Parent-driven navigation (a tunnel/link was opened elsewhere): when the
    // `url` prop changes, adopt it as the current page. This is React's
    // "storing info from previous renders" pattern (state, not an effect),
    // so a new tunnel/link always wins over whatever the user was browsing.
    const [prevUrl, setPrevUrl] = useState(url);
    if (url && url !== prevUrl) {
        setPrevUrl(url);
        setCurrentUrl(url);
        setAddressInput(url);
    }

    const closeWebview = useCallback(async () => {
        const wv = webviewRef.current;
        webviewRef.current = null;
        currentUrlRef.current = null;
        if (wv) {
            try { await wv.close(); } catch { /* already gone */ }
        }
    }, []);

    const syncBounds = useCallback(() => {
        if (!webviewRef.current || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        webviewRef.current.setPosition(new LogicalPosition(rect.left, rect.top)).catch(() => {});
        webviewRef.current.setSize(new LogicalSize(Math.max(rect.width, 1), Math.max(rect.height, 1))).catch(() => {});
    }, []);

    const createWebview = useCallback(async (targetUrl) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const appWindow = getCurrentWindow();
        setStatus("loading");
        const wv = new Webview(appWindow, `cloud-browser-${Date.now()}`, {
            url: targetUrl,
            x: Math.round(rect.left),
            y: Math.round(rect.top),
            width: Math.max(Math.round(rect.width), 1),
            height: Math.max(Math.round(rect.height), 1),
            userAgent: BROWSER_USER_AGENT,
        });
        webviewRef.current = wv;
        currentUrlRef.current = targetUrl;
        wv.once("tauri://created", () => setStatus("ready"));
        wv.once("tauri://error", () => setStatus("error"));
    }, []);

    // (Re)create the embedded webview whenever the target URL changes while active.
    useEffect(() => {
        if (!active || !currentUrl) return;
        if (currentUrlRef.current === currentUrl && webviewRef.current) {
            webviewRef.current.show().catch(() => {});
            syncBounds();
            return;
        }
        (async () => {
            await closeWebview();
            await createWebview(currentUrl);
        })();
    }, [active, currentUrl, closeWebview, createWebview, syncBounds]);

    // Hide (not close) when the panel is switched away from, so coming back
    // doesn't reload the page.
    useEffect(() => {
        if (!active && webviewRef.current) {
            webviewRef.current.hide().catch(() => {});
        }
    }, [active]);

    // Keep the embedded webview pinned to this panel's placeholder rect.
    useEffect(() => {
        if (!containerRef.current) return;
        const observer = new ResizeObserver(() => syncBounds());
        observer.observe(containerRef.current);
        window.addEventListener("resize", syncBounds);
        return () => {
            observer.disconnect();
            window.removeEventListener("resize", syncBounds);
        };
    }, [syncBounds]);

    // Real teardown only happens on unmount (app close), not on tab switch.
    useEffect(() => () => { closeWebview(); }, [closeWebview]);

    const navigateTo = (raw) => {
        const normalized = normalizeUrl(raw);
        if (!normalized) return;
        setCurrentUrl(normalized);
        setAddressInput(normalized);
    };

    const handleAddressSubmit = (e) => {
        e.preventDefault();
        navigateTo(addressInput);
    };

    const handleDetach = async () => {
        const targetUrl = currentUrlRef.current || currentUrl;
        await closeWebview();
        setCurrentUrl(null);
        setStatus("idle");
        if (targetUrl) {
            new WebviewWindow(`cloud-browser-detached-${Date.now()}`, {
                url: targetUrl,
                title: targetUrl,
                width: 1100,
                height: 750,
                userAgent: BROWSER_USER_AGENT,
            });
        }
        onClose?.();
    };

    const handleCloseTab = async () => {
        await closeWebview();
        setCurrentUrl(null);
        setAddressInput("");
        setStatus("idle");
        onClose?.();
    };

    return (
        <div className="cb-container">
            <div className="cb-header">
                <div className="cb-title">
                    <Cloud size={16} />
                    <span>Cloud Browser</span>
                </div>
                <form className="cb-address" onSubmit={handleAddressSubmit}>
                    <Globe size={13} />
                    <input
                        value={addressInput}
                        onChange={e => setAddressInput(e.target.value)}
                        placeholder="Search or enter a URL…"
                        spellCheck={false}
                        autoCapitalize="off"
                        autoCorrect="off"
                    />
                    {currentUrl && status === "loading" && <span className="cb-status">connecting…</span>}
                    <button type="submit" className="cb-go" title="Go" disabled={!addressInput.trim()}>
                        <ArrowRight size={14} />
                    </button>
                </form>
                <div className="cb-actions">
                    <button className="cb-btn" onClick={handleDetach} disabled={!currentUrl} title="Open in a separate window">
                        <ExternalLink size={14} /> Detach
                    </button>
                    <button className="cb-btn" onClick={handleCloseTab} disabled={!currentUrl} title="Close tab">
                        <X size={14} />
                    </button>
                </div>
            </div>
            <div className="cb-viewport" ref={containerRef}>
                {!currentUrl && (
                    <div className="cb-empty">
                        <Cloud size={40} className="cb-empty-icon" />
                        <div className="cb-empty-title">Nothing open yet</div>
                        <div className="cb-empty-sub">Surf the web, or forward a service from one of your VMs.</div>
                        <form className="cb-empty-search" onSubmit={handleAddressSubmit}>
                            <Globe size={15} />
                            <input
                                value={addressInput}
                                onChange={e => setAddressInput(e.target.value)}
                                placeholder="Search or enter a URL…"
                                spellCheck={false}
                                autoCapitalize="off"
                                autoCorrect="off"
                            />
                            <button type="submit" className="cb-empty-browse" disabled={!addressInput.trim()}>
                                Browse
                            </button>
                        </form>
                        {onCreateTunnel && (
                            <button className="cb-empty-tunnel" onClick={onCreateTunnel}>
                                <ArrowRightLeft size={14} /> Create a tunnel
                            </button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
