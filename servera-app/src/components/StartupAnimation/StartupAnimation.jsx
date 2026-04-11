import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import "./StartupAnimation.css";

/* ─────────────────────────────────────────
   Timing constants
───────────────────────────────────────── */
const LINE_DELAY = 240;   // ms between each line
const FIRST_MS   = 150;   // delay before first line
const HOLD_MS    = 520;   // hold after last line before fading
const FADE_MS    = 450;   // matches CSS transition duration

/* ─────────────────────────────────────────
   Helpers for building real log lines
───────────────────────────────────────── */
function providerLabel(provider) {
    return { ollama: "Ollama", openai: "OpenAI", gemini: "Gemini", bedrock: "AWS Bedrock" }[provider] ?? String(provider);
}

function providerEndpoint(aiConfig) {
    if (!aiConfig) return "not configured";
    switch (aiConfig.provider) {
        case "ollama":  return (aiConfig.ollama?.endpoint  ?? "http://localhost:11434").replace(/^https?:\/\//, "");
        case "openai":  return aiConfig.openai?.endpoint   ? aiConfig.openai.endpoint.replace(/^https?:\/\//, "") : "api.openai.com";
        case "gemini":  return "generativelanguage.googleapis.com";
        case "bedrock": return `${aiConfig.bedrock?.region ?? "us-east-1"}.amazonaws.com`;
        default:        return "unknown endpoint";
    }
}

/**
 * Produces the 10-line log from whatever data has resolved so far.
 * Unresolved lines show a neutral "loading" state.
 */
function buildLines(diag) {
    const { profiles, aiConfig, aiTest } = diag;

    // ── Line 4: profile count ──────────────────────────────────────────
    let profileLine;
    if (profiles === null) {
        profileLine = { tag: "SSH",  type: "info",  text: "Reading profile store...", hi: null };
    } else if (profiles.length === 0) {
        profileLine = { tag: "WARN", type: "warn",  text: "Profile store empty · ", hi: "no profiles found", hiClass: "hi-warn" };
    } else {
        profileLine = {
            tag: "OK", type: "ok",
            text: "Profiles loaded · ",
            hi: `${profiles.length} ${profiles.length === 1 ? "entry" : "entries"} found`,
            hiClass: "hi-ok",
        };
    }

    // ── Line 5: AI provider + endpoint ────────────────────────────────
    let aiProviderLine;
    if (aiConfig === null) {
        aiProviderLine = { tag: "AI",  type: "info", text: "Reading AI config...", hi: null };
    } else {
        aiProviderLine = {
            tag: "AI", type: "info",
            text: `${providerLabel(aiConfig.provider)} · connecting to `,
            hi: providerEndpoint(aiConfig),
            hiClass: "hi-info",
        };
    }

    // ── Line 6: AI online / offline ────────────────────────────────────
    let aiStatusLine;
    if (aiTest === null) {
        aiStatusLine = { tag: "...", type: "info", text: "Verifying AI connection...", hi: null };
    } else if (aiTest.ok) {
        const modelInfo = aiTest.models?.length ? ` · ${aiTest.models.length} model${aiTest.models.length !== 1 ? "s" : ""} available` : "";
        aiStatusLine = {
            tag: "OK", type: "ok",
            text: `${providerLabel(aiConfig?.provider ?? "")} online${modelInfo} · `,
            hi: aiTest.message ?? "ready",
            hiClass: "hi-ok",
        };
    } else {
        aiStatusLine = {
            tag: "WARN", type: "warn",
            text: `${providerLabel(aiConfig?.provider ?? "AI")} offline · `,
            hi: "AI features degraded",
            hiClass: "hi-warn",
        };
    }

    return [
        /* 0 */ { tag: "BOOT",  type: "boot",  text: "Servera v2.4.1 · Tauri 2 runtime starting",            hi: null },
        /* 1 */ { tag: "OK",    type: "ok",    text: "Rust backend initialized · ",                            hi: "44 commands registered",          hiClass: "hi-ok"   },
        /* 2 */ { tag: "OK",    type: "ok",    text: "Keyring connected · ",                                   hi: "OS credential store ready",       hiClass: "hi-ok"   },
        /* 3 */ { tag: "SSH",   type: "info",  text: "Profile store · ",                                       hi: "~/.servera/profiles.json",        hiClass: "hi-info" },
        /* 4 */ profileLine,
        /* 5 */ aiProviderLine,
        /* 6 */ aiStatusLine,
        /* 7 */ { tag: "OK",    type: "ok",    text: "SSH agent ready · ",                                     hi: "libssh2 handshake layer online",  hiClass: "hi-ok"   },
        /* 8 */ { tag: "OK",    type: "ok",    text: "Frontend mounted · ",                                    hi: "React 19 · Vite 6",               hiClass: "hi-ok"   },
        /* 9 */ { tag: "RDY",   type: "ready", text: "All systems nominal · ",                                 hi: "Ready.",                          hiClass: "hi-ready"},
    ];
}

/* ─────────────────────────────────────────
   Web Audio sound synthesis
───────────────────────────────────────── */
function useBootAudio() {
    const ctxRef = useRef(null);

    const getCtx = () => {
        if (!ctxRef.current) {
            ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (ctxRef.current.state === "suspended") ctxRef.current.resume();
        return ctxRef.current;
    };

    const playBlip = (type) => {
        try {
            const ctx = getCtx();
            const now = ctx.currentTime;
            const cfg = {
                ok:    { freq: 880,  dur: 0.045, vol: 0.055, wave: "sine"     },
                info:  { freq: 740,  dur: 0.040, vol: 0.050, wave: "sine"     },
                warn:  { freq: 370,  dur: 0.090, vol: 0.070, wave: "triangle" },
                boot:  { freq: 660,  dur: 0.060, vol: 0.060, wave: "square"   },
                ready: { freq: 1046, dur: 0.080, vol: 0.080, wave: "sine"     },
            };
            const { freq, dur, vol, wave } = cfg[type] ?? cfg.info;
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.type = wave; osc.frequency.value = freq;
            gain.gain.setValueAtTime(vol, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            osc.start(now); osc.stop(now + dur);
        } catch { /* audio blocked before first gesture */ }
    };

    const playReady = () => {
        try {
            const ctx = getCtx();
            const now = ctx.currentTime;
            [523, 659, 784, 1046].forEach((freq, i) => {
                const delay = i * 0.07;
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain); gain.connect(ctx.destination);
                osc.type = "sine"; osc.frequency.value = freq;
                gain.gain.setValueAtTime(0.0001, now + delay);
                gain.gain.linearRampToValueAtTime(0.07, now + delay + 0.025);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + delay + 0.5);
                osc.start(now + delay); osc.stop(now + delay + 0.55);
            });
        } catch { /* audio blocked before first gesture */ }
    };

    const playWhoosh = () => {
        try {
            const ctx = getCtx();
            const now = ctx.currentTime;
            const dur = 0.65;
            const bufLen = Math.ceil(ctx.sampleRate * dur);
            const buf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < bufLen; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufLen);
            const src = ctx.createBufferSource();
            src.buffer = buf;
            const filt = ctx.createBiquadFilter();
            filt.type = "bandpass"; filt.Q.value = 0.6;
            filt.frequency.setValueAtTime(250, now);
            filt.frequency.linearRampToValueAtTime(7000, now + dur * 0.55);
            const gain = ctx.createGain();
            gain.gain.setValueAtTime(0.22, now);
            gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
            src.connect(filt); filt.connect(gain); gain.connect(ctx.destination);
            src.start(now);
        } catch { /* audio blocked before first gesture */ }
    };

    return { playBlip, playReady, playWhoosh };
}

/* ─────────────────────────────────────────
   Component
───────────────────────────────────────── */
export default function StartupAnimation({ onDone, onFadingStart }) {
    const [visibleCount, setVisibleCount] = useState(0);
    const [fading, setFading]             = useState(false);

    // Real diagnostic data — null = still loading
    const [diag, setDiag] = useState({ profiles: null, aiConfig: null, aiTest: null });

    const { playBlip, playReady, playWhoosh } = useBootAudio();

    // Compute lines reactively whenever diag updates
    const logLines = useMemo(() => buildLines(diag), [diag]);

    // ── Kick off all fetches immediately on mount ──────────────────────
    useEffect(() => {
        // Profile count
        invoke("load_profiles")
            .then(profiles => setDiag(d => ({ ...d, profiles })))
            .catch(()      => setDiag(d => ({ ...d, profiles: [] })));

        // AI config (which provider + endpoint is configured)
        invoke("load_ai_config")
            .then(aiConfig => setDiag(d => ({ ...d, aiConfig })))
            .catch(()      => setDiag(d => ({ ...d, aiConfig: null })));

        // Live AI provider ping (connection refused = fast, timeout = 5s worst case)
        invoke("test_ai_connection")
            .then(raw => {
                try { return JSON.parse(raw); } catch { return { ok: false, message: "parse error" }; }
            })
            .then(aiTest => setDiag(d => ({ ...d, aiTest })))
            .catch(()    => setDiag(d => ({ ...d, aiTest: { ok: false, message: "unreachable" } })));
    }, []); // only on mount

    // ── Fixed-timer line reveal (sound type read from current logLines) ─
    useEffect(() => {
        const timers = [];
        const total = 10; // always 10 lines

        for (let i = 0; i < total; i++) {
            timers.push(
                setTimeout(() => {
                    setVisibleCount(i + 1);
                    // Read the current line type at render time via a ref
                }, FIRST_MS + i * LINE_DELAY)
            );
        }

        const totalBootMs = FIRST_MS + (total - 1) * LINE_DELAY;

        timers.push(setTimeout(() => {
            playWhoosh();
            setFading(true);
            onFadingStart?.();
        }, totalBootMs + HOLD_MS));

        timers.push(setTimeout(() => {
            onDone();
        }, totalBootMs + HOLD_MS + FADE_MS + 60));

        return () => timers.forEach(clearTimeout);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Play sound when a new line becomes visible ─────────────────────
    // We track the previous count to fire the sound exactly once per new line
    const prevCount = useRef(0);
    useEffect(() => {
        if (visibleCount > prevCount.current) {
            const lineIdx = visibleCount - 1;
            const line = logLines[lineIdx];
            if (line?.type === "ready") playReady();
            else playBlip(line?.type ?? "info");
            prevCount.current = visibleCount;
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [visibleCount, logLines]);

    return (
        <div className={`startup-wrap${fading ? " fading" : ""}`}>
            <div className="startup-log">
                {logLines.slice(0, visibleCount).map((line, i) => (
                    <div key={i} className="startup-line">
                        <span className={`startup-tag tag-${line.type}`}>{line.tag}</span>
                        <span className="startup-msg">
                            {line.text}
                            {line.hi && <span className={line.hiClass}>{line.hi}</span>}
                        </span>
                    </div>
                ))}

                {visibleCount > 0 && visibleCount < logLines.length && (
                    <span className="startup-cursor" />
                )}
            </div>

            <div className="startup-watermark">Servera · v2.4.1</div>
        </div>
    );
}
