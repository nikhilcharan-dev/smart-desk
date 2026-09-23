import { useEffect, useRef } from "react";

/**
 * An interval that only runs while its panel is actually on screen.
 *
 * Every view in App.jsx stays mounted once opened and is hidden with
 * `display: none`, so a plain setInterval keeps hammering the remote host from
 * tabs the user cannot see. This runs `fn` only while `active` is true and the
 * window is visible, and fires once immediately on (re)activation so a panel is
 * never shown with stale data.
 *
 * Connection liveness does not depend on this: the backend pings the exec
 * connection on its own (`spawn_exec_keepalive_thread`), so pausing here costs
 * bandwidth only — never the session.
 */
export function usePolling(fn, intervalMs, active = true) {
    // Held in a ref so a re-created callback does not restart the interval;
    // only `active`/`intervalMs` control the timer's lifetime. Declared before
    // the timer effect so each render refreshes it first.
    const savedFn = useRef(fn);
    useEffect(() => {
        savedFn.current = fn;
    }, [fn]);

    useEffect(() => {
        if (!active) return;

        let timer = null;
        const tick = () => savedFn.current();

        const start = () => {
            if (timer !== null) return;
            tick();
            timer = setInterval(tick, intervalMs);
        };
        const stop = () => {
            if (timer === null) return;
            clearInterval(timer);
            timer = null;
        };
        const onVisibilityChange = () => (document.hidden ? stop() : start());

        if (!document.hidden) start();
        document.addEventListener("visibilitychange", onVisibilityChange);

        return () => {
            stop();
            document.removeEventListener("visibilitychange", onVisibilityChange);
        };
    }, [intervalMs, active]);
}
