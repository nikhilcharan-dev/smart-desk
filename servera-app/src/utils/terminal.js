import { invoke } from "@tauri-apps/api/core";

/** Default session ID used across the app */
export const MAIN_SESSION_ID = "main-session";

/**
 * Fit an xterm terminal and sync dimensions with the Rust backend.
 * @param {import("@xterm/addon-fit").FitAddon} fitAddon
 * @param {string} sessionId
 */
export function fitAndResize(fitAddon, sessionId = MAIN_SESSION_ID) {
    if (!fitAddon) return;
    try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (
            dims &&
            typeof dims.cols === "number" && typeof dims.rows === "number" &&
            !isNaN(dims.cols) && !isNaN(dims.rows) &&
            dims.cols > 0 && dims.rows > 0
        ) {
            invoke("resize_terminal", {
                sessionId,
                cols: dims.cols,
                rows: dims.rows,
            }).catch(console.error);
        }
    } catch (e) {
        console.warn("Terminal fit failed:", e);
    }
}

/** Strip ANSI escape codes for clean text matching */
export function stripAnsi(str) {
    return str.replace(
        // eslint-disable-next-line no-control-regex
        /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
        ""
    );
}
