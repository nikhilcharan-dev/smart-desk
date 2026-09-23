import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import "./WindowControls.css";

export default function WindowControls() {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        let unlisten = null;
        let active = true;

        const init = async () => {
            try {
                const win = getCurrentWindow();
                if (win && win.isMaximized) {
                    const maximized = await win.isMaximized();
                    if (active) setIsMaximized(maximized);

                    unlisten = await win.onResized(async () => {
                        try {
                            const m = await win.isMaximized();
                            if (active) setIsMaximized(m);
                        } catch {
                            // ignore resize query error
                        }
                    });
                }
            } catch {
                // Running in standard browser preview mode
            }
        };

        init();

        return () => {
            active = false;
            if (typeof unlisten === "function") {
                unlisten();
            }
        };
    }, []);

    const handleMinimize = async (e) => {
        e.stopPropagation();
        try {
            const win = getCurrentWindow();
            await win.minimize();
        } catch (err) {
            console.error("Window minimize error:", err);
        }
    };

    const handleToggleMaximize = async (e) => {
        e.stopPropagation();
        try {
            const win = getCurrentWindow();
            await win.toggleMaximize();
            const maximized = await win.isMaximized();
            setIsMaximized(maximized);
        } catch (err) {
            console.error("Window toggle maximize error:", err);
        }
    };

    const handleClose = async (e) => {
        e.stopPropagation();
        try {
            const win = getCurrentWindow();
            await win.close();
        } catch (err) {
            console.error("Window close error:", err);
        }
    };

    return (
        <div className="window-controls" data-tauri-drag-region="false">
            <button
                type="button"
                className="win-btn win-btn-minimize"
                onClick={handleMinimize}
                title="Minimize"
                aria-label="Minimize"
            >
                <Minus size={13} strokeWidth={2} />
            </button>
            <button
                type="button"
                className="win-btn win-btn-maximize"
                onClick={handleToggleMaximize}
                title={isMaximized ? "Restore Down" : "Maximize"}
                aria-label={isMaximized ? "Restore Down" : "Maximize"}
            >
                {isMaximized ? (
                    <Copy size={11} strokeWidth={2} style={{ transform: "rotate(90deg)" }} />
                ) : (
                    <Square size={11} strokeWidth={2} />
                )}
            </button>
            <button
                type="button"
                className="win-btn win-btn-close"
                onClick={handleClose}
                title="Close"
                aria-label="Close"
            >
                <X size={14} strokeWidth={2} />
            </button>
        </div>
    );
}
