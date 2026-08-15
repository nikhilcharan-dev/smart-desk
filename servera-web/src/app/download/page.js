"use client";
import { Navbar, Footer } from "../components";
import {
  Monitor, Smartphone, Globe, ArrowLeft, Download, Command,
  ShieldCheck, Zap, CheckCircle, Package, ChevronRight,
  TrendingUp, BarChart2, Clock, Users, Star, Send, X,
  MessageSquare
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import gsap from "gsap";

/* ────────────────────────────────
   Star rating input
──────────────────────────────── */
function StarRating({ value, onChange, size = 28 }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "inline-flex", gap: "0.3rem" }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => onChange?.(star)}
          onMouseEnter={() => setHover(star)}
          onMouseLeave={() => setHover(0)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            padding: 2, transition: "transform 0.15s",
            transform: hover === star ? "scale(1.25)" : "scale(1)",
          }}
        >
          <Star
            size={size}
            fill={(hover || value) >= star ? "#f59e0b" : "transparent"}
            color={(hover || value) >= star ? "#f59e0b" : "var(--text-3)"}
            strokeWidth={1.5}
          />
        </button>
      ))}
    </div>
  );
}

/* ────────────────────────────────
   Post-download feedback modal
──────────────────────────────── */
function DownloadFeedbackModal({ platform, onClose }) {
  const [rating, setRating] = useState(0);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const handleSubmit = async () => {
    if (!rating && !message.trim()) { onClose(); return; }
    setSubmitting(true);
    try {
      await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || "Anonymous",
          type: "feedback",
          rating: rating || null,
          message: message.trim() || `Downloaded Servera for ${platform}${rating ? ` — rated ${rating}/5` : ""}`,
          platform,
        }),
      });
      setDone(true);
      setTimeout(onClose, 1800);
    } catch { onClose(); }
    setSubmitting(false);
  };

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 9999,
      background: "rgba(0,0,0,0.7)", backdropFilter: "blur(8px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      animation: "fadeIn 0.25s ease",
    }} onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="glass-strong" style={{
        borderRadius: 24, padding: "3rem", maxWidth: 460, width: "90vw",
        border: "1px solid rgba(139,92,246,0.2)", position: "relative",
        animation: "slideUp 0.3s ease",
      }}>
        {/* Close */}
        <button onClick={onClose} style={{ position: "absolute", top: 16, right: 16, background: "none", border: "none", cursor: "pointer", color: "var(--text-3)", padding: 4 }}>
          <X size={18} />
        </button>

        {done ? (
          <div style={{ textAlign: "center", padding: "2rem 0" }}>
            <div style={{ fontSize: "2.5rem", marginBottom: "0.75rem" }}>&#10024;</div>
            <h3 style={{ fontSize: "1.4rem", marginBottom: "0.5rem" }}>Thank you!</h3>
            <p style={{ color: "var(--text-3)", fontSize: "0.9rem" }}>Your feedback means a lot to us.</p>
          </div>
        ) : (
          <>
            <div style={{ textAlign: "center", marginBottom: "2rem" }}>
              <div style={{ background: "rgba(139,92,246,0.1)", width: 56, height: 56, borderRadius: 16, display: "inline-flex", alignItems: "center", justifyContent: "center", marginBottom: "1rem" }}>
                <MessageSquare size={24} color="var(--violet-2)" />
              </div>
              <h3 style={{ fontSize: "1.4rem", marginBottom: "0.4rem" }}>Your download has started!</h3>
              <p style={{ color: "var(--text-3)", fontSize: "0.88rem" }}>
                Mind leaving a quick rating? It really helps.
              </p>
            </div>

            {/* Stars */}
            <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
              <StarRating value={rating} onChange={setRating} size={36} />
              {rating > 0 && (
                <div style={{ fontSize: "0.78rem", color: "var(--amber)", marginTop: "0.5rem", fontWeight: 600 }}>
                  {["", "Needs work", "Fair", "Good", "Great", "Amazing!"][rating]}
                </div>
              )}
            </div>

            {/* Name */}
            <input
              type="text"
              placeholder="Your name (optional)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                width: "100%", padding: "0.7rem 1rem", borderRadius: 10,
                background: "var(--s0)", border: "1px solid var(--b0)", color: "var(--text)",
                fontSize: "0.85rem", fontFamily: "var(--ff)", outline: "none",
                marginBottom: "0.75rem",
              }}
            />

            {/* Message */}
            <textarea
              placeholder="Any thoughts? (optional)"
              rows={3}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              style={{
                width: "100%", padding: "0.75rem 1rem", borderRadius: 10,
                background: "var(--s0)", border: "1px solid var(--b0)", color: "var(--text)",
                fontSize: "0.85rem", fontFamily: "var(--ff)", outline: "none",
                resize: "vertical", lineHeight: 1.6, marginBottom: "1.25rem",
              }}
            />

            <div style={{ display: "flex", gap: "0.75rem" }}>
              <button onClick={onClose} className="btn btn-ghost" style={{ flex: 1, padding: "0.85rem", justifyContent: "center" }}>
                Skip
              </button>
              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="btn btn-download"
                style={{ flex: 2, padding: "0.85rem", justifyContent: "center", opacity: submitting ? 0.6 : 1 }}
              >
                {submitting ? "Sending..." : <><Send size={15} /> Submit</>}
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideUp { from { opacity: 0; transform: translateY(20px) } to { opacity: 1; transform: translateY(0) } }
      `}</style>
    </div>
  );
}

/* ────────────────────────────────
   Animated counter (rolls up)
──────────────────────────────── */
function AnimatedNumber({ value, duration = 1200 }) {
  const [display, setDisplay] = useState(0);
  const ref = useRef({ start: 0, target: 0, raf: null });

  useEffect(() => {
    const r = ref.current;
    r.start = display;
    r.target = value;
    const startTime = performance.now();

    function tick(now) {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setDisplay(Math.round(r.start + (r.target - r.start) * ease));
      if (t < 1) r.raf = requestAnimationFrame(tick);
    }
    r.raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(r.raf);
  }, [value, duration]);

  return <>{display.toLocaleString()}</>;
}

/* ────────────────────────────────
   Main page
──────────────────────────────── */
export default function DownloadPage() {
  const ref = useRef(null);
  const [counts, setCounts] = useState(null);
  const [totalAll, setTotalAll] = useState(0);
  const [feedbackModal, setFeedbackModal] = useState(null); // platform name or null

  // fetch download stats
  const fetchCounts = useCallback(async () => {
    try {
      const res = await fetch("/api/downloads");
      if (res.ok) {
        const data = await res.json();
        setCounts(data.counts);
        setTotalAll(data.totalAll);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchCounts();
    const iv = setInterval(fetchCounts, 30000); // refresh every 30s
    return () => clearInterval(iv);
  }, [fetchCounts]);

  // track download click + show feedback modal
  const trackDownload = async (platform) => {
    try {
      await fetch("/api/downloads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ platform }),
      });
      // optimistic update
      setCounts((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          [platform]: {
            total: (prev[platform]?.total || 0) + 1,
            today: (prev[platform]?.today || 0) + 1,
          },
        };
      });
      setTotalAll((prev) => prev + 1);
    } catch { /* silent */ }
    // show feedback modal after a short delay
    setTimeout(() => setFeedbackModal(platform), 1500);
  };

  useEffect(() => {
    gsap.from(ref.current.children, {
      y: 24, duration: 0.65, stagger: 0.12, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", position: "relative" }}>
      {/* Background orbs */}
      <div style={{ position: "absolute", width: "50vw", height: "50vw", borderRadius: "50%", background: "var(--violet-glow)", filter: "blur(130px)", opacity: 0.18, top: "-10%", left: "-15%", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "absolute", width: "30vw", height: "30vw", borderRadius: "50%", background: "var(--cyan-glow)",   filter: "blur(100px)", opacity: 0.12, bottom: "5%",  right: "-5%",  pointerEvents: "none", zIndex: 0 }} />

      <Navbar />

      <section style={{ paddingTop: "12rem", paddingBottom: "8rem", position: "relative", zIndex: 1 }}>
        <div className="section-inner" ref={ref}>

          {/* Back link */}
          <Link href="/"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", marginBottom: "3.5rem", color: "var(--violet-2)", fontWeight: 600, fontSize: "0.85rem", opacity: 0.85 }}
            className="link-hover"
          >
            <ArrowLeft size={16} /> Back to Home
          </Link>

          {/* Header */}
          <div style={{ marginBottom: "5rem" }}>
            <div className="section-tag">Downloads</div>
            <h1 style={{ fontSize: "clamp(2.8rem, 5vw, 5rem)", marginBottom: "1.25rem", letterSpacing: "-0.04em" }}>
              Pick your platform.<br />
              <span className="gradient-text">Start in seconds.</span>
            </h1>
            <p style={{ fontSize: "1.15rem", color: "var(--text-2)", maxWidth: 640, lineHeight: 1.7 }}>
              Every build is cryptographically signed. Your credentials stay on your machine — we never touch them.
            </p>
          </div>

          {/* ═══ Download Stats Banner ═══ */}
          {counts && (
            <div className="glass" style={{ borderRadius: 20, padding: "2rem 2.5rem", marginBottom: "3rem", border: "1px solid rgba(139,92,246,0.15)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.75rem" }}>
                <TrendingUp size={18} color="var(--violet-2)" />
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--violet-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Live Download Statistics</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: "1.5rem" }}>
                {/* Total */}
                <div style={{ textAlign: "center", padding: "1rem 0" }}>
                  <div style={{ fontFamily: "var(--ffd)", fontSize: "2.4rem", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
                    <span className="gradient-text"><AnimatedNumber value={totalAll} /></span>
                  </div>
                  <div style={{ fontSize: "0.78rem", color: "var(--text-3)", marginTop: "0.5rem", fontWeight: 500 }}>Total Downloads</div>
                </div>
                {/* Windows */}
                <StatCell
                  icon={<Monitor size={16} />}
                  label="Windows"
                  total={counts.windows?.total || 0}
                  today={counts.windows?.today || 0}
                  color="var(--violet-2)"
                  bg="rgba(139,92,246,0.08)"
                />
                {/* macOS */}
                <StatCell
                  icon={<Command size={16} />}
                  label="macOS"
                  total={counts.macos?.total || 0}
                  today={counts.macos?.today || 0}
                  color="var(--cyan-2)"
                  bg="rgba(6,182,212,0.08)"
                />
                {/* Linux */}
                <StatCell
                  icon={<Globe size={16} />}
                  label="Linux"
                  total={counts.linux?.total || 0}
                  today={counts.linux?.today || 0}
                  color="var(--emerald)"
                  bg="rgba(16,185,129,0.08)"
                />
                {/* iOS */}
                <StatCell
                  icon={<Smartphone size={16} />}
                  label="iOS"
                  total={counts.ios?.total || 0}
                  today={counts.ios?.today || 0}
                  color="var(--amber)"
                  bg="rgba(245,158,11,0.08)"
                />
              </div>
            </div>
          )}

          {/* ═══ Platform Cards ═══ */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "2rem", marginBottom: "3rem" }}>

            {/* ── Windows — Available ── */}
            <div className="glass card" style={{ padding: "3rem", display: "flex", flexDirection: "column", borderColor: "rgba(139,92,246,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
                <div style={{ background: "rgba(139,92,246,0.1)", width: 64, height: 64, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <Monitor size={30} color="var(--violet-2)" />
                </div>
                <span className="badge badge-g">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }} />
                  Available
                </span>
              </div>

              <h2 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Windows</h2>
              <p style={{ color: "var(--text-2)", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Requires Windows 10 / 11 (x64)</p>

              <div className="mono" style={{ fontSize: "0.75rem", color: "var(--violet-2)", marginBottom: "2.5rem", padding: "0.5rem 0.85rem", background: "var(--violet-sub)", borderRadius: 8, display: "inline-block", alignSelf: "flex-start" }}>
                v2.0.0
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "3rem" }}>
                {["Native Windows desktop app", "AES-256 encrypted credential vault", "One-click installer (~82 MB)", "No account required"].map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.875rem", color: "var(--text-2)" }}>
                    <CheckCircle size={14} style={{ color: "var(--emerald)", flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>

              <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "1rem 1.25rem", border: "1px solid var(--b0)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>
                  Size: <b style={{ color: "var(--text-2)" }}>~82 MB</b>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--cyan-2)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                  <ShieldCheck size={14} /> SIGNED BUILD
                </div>
              </div>

              {/* Download count inline */}
              {counts?.windows && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.78rem", color: "var(--text-3)" }}>
                  <BarChart2 size={13} />
                  <span><b style={{ color: "var(--text-2)" }}>{counts.windows.total.toLocaleString()}</b> downloads</span>
                  {counts.windows.today > 0 && (
                    <span style={{ marginLeft: "auto", color: "var(--emerald)", fontWeight: 600 }}>+{counts.windows.today} today</span>
                  )}
                </div>
              )}

              <a
                href="/downloads/Servera.exe"
                download
                className="btn btn-download"
                style={{ width: "100%", padding: "1rem", fontSize: "1rem", marginTop: "auto" }}
                onClick={() => trackDownload("windows")}
              >
                <Download size={18} /> Download for Windows
              </a>
            </div>

            {/* ── macOS — Available ── */}
            <div className="glass card" style={{ padding: "3rem", display: "flex", flexDirection: "column", borderColor: "rgba(6,182,212,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
                <div style={{ background: "rgba(6,182,212,0.08)", width: 64, height: 64, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(6,182,212,0.15)" }}>
                  <Command size={30} color="var(--cyan-2)" />
                </div>
                <span className="badge badge-g">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }} />
                  Available
                </span>
              </div>

              <h2 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>macOS</h2>
              <p style={{ color: "var(--text-2)", marginBottom: "0.5rem", fontSize: "0.9rem" }}>macOS 12 Monterey or later (Universal)</p>

              <div className="mono" style={{ fontSize: "0.75rem", color: "var(--cyan-2)", marginBottom: "2.5rem", padding: "0.5rem 0.85rem", background: "var(--cyan-sub)", borderRadius: 8, display: "inline-block", alignSelf: "flex-start" }}>
                v2.0.0
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "3rem" }}>
                {["Native macOS desktop app", "Keychain-integrated credential vault", "DMG installer — drag & drop", "Universal binary (Intel + Apple Silicon)"].map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.875rem", color: "var(--text-2)" }}>
                    <CheckCircle size={14} style={{ color: "var(--emerald)", flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>

              <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "1rem 1.25rem", border: "1px solid var(--b0)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>
                  Size: <b style={{ color: "var(--text-2)" }}>~95 MB</b>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--cyan-2)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                  <ShieldCheck size={14} /> SIGNED BUILD
                </div>
              </div>

              {/* Download count inline */}
              {counts?.macos && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.78rem", color: "var(--text-3)" }}>
                  <BarChart2 size={13} />
                  <span><b style={{ color: "var(--text-2)" }}>{counts.macos.total.toLocaleString()}</b> downloads</span>
                  {counts.macos.today > 0 && (
                    <span style={{ marginLeft: "auto", color: "var(--emerald)", fontWeight: 600 }}>+{counts.macos.today} today</span>
                  )}
                </div>
              )}

              <a
                href="/downloads/Servera-MAC"
                download="Servera.dmg"
                className="btn btn-download"
                style={{ width: "100%", padding: "1rem", fontSize: "1rem", background: "linear-gradient(135deg, var(--cyan) 0%, #0e7490 100%)", marginTop: "auto" }}
                onClick={() => trackDownload("macos")}
              >
                <Download size={18} /> Download for macOS
              </a>
            </div>

            {/* ── Linux — Available ── */}
            <div className="glass card" style={{ padding: "3rem", display: "flex", flexDirection: "column", borderColor: "rgba(16,185,129,0.2)" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
                <div style={{ background: "rgba(16,185,129,0.08)", width: 64, height: 64, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(16,185,129,0.15)" }}>
                  <Globe size={30} color="var(--emerald)" />
                </div>
                <span className="badge badge-g">
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }} />
                  Available
                </span>
              </div>

              <h2 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>Linux</h2>
              <p style={{ color: "var(--text-2)", marginBottom: "0.5rem", fontSize: "0.9rem" }}>Ubuntu, Debian, Fedora & more (x64)</p>

              <div className="mono" style={{ fontSize: "0.75rem", color: "var(--emerald)", marginBottom: "2.5rem", padding: "0.5rem 0.85rem", background: "rgba(16,185,129,0.06)", borderRadius: 8, display: "inline-block", alignSelf: "flex-start" }}>
                v2.0.0
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "3rem" }}>
                {["Native Linux desktop app", "AES-256 encrypted credential vault", ".deb & .AppImage packages", "No account required"].map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.875rem", color: "var(--text-2)" }}>
                    <CheckCircle size={14} style={{ color: "var(--emerald)", flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>

              <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "1rem 1.25rem", border: "1px solid var(--b0)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>
                  Size: <b style={{ color: "var(--text-2)" }}>~14 MB (.deb) · ~84 MB (.AppImage)</b>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--emerald)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                  <ShieldCheck size={14} /> SIGNED BUILD
                </div>
              </div>

              {/* Download count inline */}
              {counts?.linux && (
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "1rem", fontSize: "0.78rem", color: "var(--text-3)" }}>
                  <BarChart2 size={13} />
                  <span><b style={{ color: "var(--text-2)" }}>{counts.linux.total.toLocaleString()}</b> downloads</span>
                  {counts.linux.today > 0 && (
                    <span style={{ marginLeft: "auto", color: "var(--emerald)", fontWeight: 600 }}>+{counts.linux.today} today</span>
                  )}
                </div>
              )}

              <div style={{ display: "flex", gap: "0.75rem", marginTop: "auto" }}>
                <a
                  href="/downloads/Servera.deb"
                  download
                  className="btn btn-download"
                  style={{ flex: 1, padding: "1rem", fontSize: "0.95rem", background: "linear-gradient(135deg, var(--emerald) 0%, #047857 100%)" }}
                  onClick={() => trackDownload("linux")}
                >
                  <Download size={18} /> .deb
                </a>
                <a
                  href="/downloads/Servera.AppImage"
                  download
                  className="btn btn-download"
                  style={{ flex: 1, padding: "1rem", fontSize: "0.95rem", background: "linear-gradient(135deg, var(--emerald) 0%, #047857 100%)" }}
                  onClick={() => trackDownload("linux")}
                >
                  <Download size={18} /> .AppImage
                </a>
              </div>
            </div>

            {/* ── iOS — Coming Q3 ── */}
            <div className="glass card" style={{ padding: "3rem", display: "flex", flexDirection: "column", opacity: 0.75 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
                <div style={{ background: "rgba(245,158,11,0.08)", width: 64, height: 64, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(245,158,11,0.15)" }}>
                  <Smartphone size={30} color="var(--amber)" />
                </div>
                <span className="badge badge-a">Coming Q3</span>
              </div>

              <h2 style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>iOS</h2>
              <p style={{ color: "var(--text-2)", marginBottom: "0.5rem", fontSize: "0.9rem" }}>iPhone & iPad · iOS 16+</p>

              <div className="mono" style={{ fontSize: "0.75rem", color: "var(--text-3)", marginBottom: "2.5rem", padding: "0.5rem 0.85rem", background: "var(--s1)", borderRadius: 8, display: "inline-block", alignSelf: "flex-start" }}>
                In Development
              </div>

              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "3rem" }}>
                {["100% native SwiftUI", "Face ID & Touch ID auth", "Full SSH terminal", "Real-time server metrics"].map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.875rem", color: "var(--text-3)" }}>
                    <div style={{ width: 14, height: 14, borderRadius: "50%", border: "1px solid var(--b1)", flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>

              <div style={{ background: "rgba(255,255,255,0.02)", borderRadius: 12, padding: "1rem 1.25rem", border: "1px solid var(--b0)", marginBottom: "1.75rem", fontSize: "0.82rem", color: "var(--text-3)" }}>
                Join the waitlist to get early access →
              </div>

              <button
                disabled
                className="btn"
                style={{ width: "100%", padding: "1rem", fontSize: "1rem", background: "var(--s1)", color: "var(--text-3)", border: "1px solid var(--b0)", cursor: "not-allowed", borderRadius: 13, marginTop: "auto" }}
              >
                Not Available Yet
              </button>
            </div>
          </div>

          {/* ── Linux packages note ── */}
          <div className="glass" style={{ borderRadius: 24, padding: "2.5rem 3rem", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: "3rem", marginBottom: "3rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <div style={{ background: "rgba(16,185,129,0.08)", width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Globe size={18} color="var(--emerald)" />
                </div>
                <h3 style={{ fontSize: "1.2rem" }}>Linux Packages</h3>
              </div>
              <p style={{ color: "var(--text-2)", fontSize: "0.9rem", lineHeight: 1.65 }}>
                Servera is available as <b>.deb</b> (Ubuntu, Debian) and <b>.AppImage</b> (universal).
                Need a different format? Let us know.
              </p>
            </div>
            <a href="mailto:hello@servera.io" className="btn btn-ghost" style={{ padding: "0.85rem 2rem", whiteSpace: "nowrap" }}>
              Contact Us <ChevronRight size={16} />
            </a>
          </div>

          {/* ═══ Detailed Download Breakdown ═══ */}
          {counts && (
            <div className="glass" style={{ borderRadius: 20, padding: "2.5rem 3rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "2rem" }}>
                <Users size={18} color="var(--cyan-2)" />
                <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "var(--cyan-2)", letterSpacing: "0.06em", textTransform: "uppercase" }}>Download Breakdown</span>
              </div>

              {/* Table header */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "1rem", padding: "0.75rem 1rem", borderBottom: "1px solid var(--b0)", marginBottom: "0.5rem" }}>
                {["Platform", "Total", "Today", "Status"].map((h) => (
                  <span key={h} style={{ fontSize: "0.72rem", fontWeight: 700, color: "var(--text-3)", letterSpacing: "0.1em", textTransform: "uppercase" }}>{h}</span>
                ))}
              </div>

              {/* Rows */}
              {[
                { key: "windows", name: "Windows (EXE)", icon: <Monitor size={16} />, color: "var(--violet-2)", status: "Available", statusClass: "badge-g" },
                { key: "macos",   name: "macOS (DMG)",   icon: <Command size={16} />,   color: "var(--cyan-2)",   status: "Available", statusClass: "badge-g" },
                { key: "linux",   name: "Linux (DEB / AppImage)", icon: <Globe size={16} />, color: "var(--emerald)", status: "Available", statusClass: "badge-g" },
                { key: "ios",     name: "iOS (IPA)",     icon: <Smartphone size={16} />, color: "var(--amber)", status: "Coming Q3", statusClass: "badge-a" },
              ].map((row) => (
                <div key={row.key} style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "1rem", padding: "1rem", borderBottom: "1px solid var(--b0)", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <div style={{ color: row.color }}>{row.icon}</div>
                    <span style={{ fontSize: "0.9rem", fontWeight: 600 }}>{row.name}</span>
                  </div>
                  <span className="mono" style={{ fontSize: "0.95rem", fontWeight: 700 }}>
                    {(counts[row.key]?.total || 0).toLocaleString()}
                  </span>
                  <span className="mono" style={{ fontSize: "0.9rem", color: counts[row.key]?.today > 0 ? "var(--emerald)" : "var(--text-3)" }}>
                    {counts[row.key]?.today > 0 ? `+${counts[row.key].today}` : "0"}
                  </span>
                  <span className={`badge ${row.statusClass}`} style={{ fontSize: "0.68rem", justifySelf: "start" }}>
                    {row.status}
                  </span>
                </div>
              ))}

              {/* Total row */}
              <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: "1rem", padding: "1rem", alignItems: "center" }}>
                <span style={{ fontSize: "0.9rem", fontWeight: 700, color: "var(--text)" }}>All Platforms</span>
                <span className="mono gradient-text" style={{ fontSize: "1.05rem", fontWeight: 800 }}>
                  {totalAll.toLocaleString()}
                </span>
                <span className="mono" style={{ fontSize: "0.9rem", color: "var(--emerald)", fontWeight: 600 }}>
                  +{(counts.windows?.today || 0) + (counts.macos?.today || 0) + (counts.linux?.today || 0) + (counts.ios?.today || 0)}
                </span>
                <span />
              </div>
            </div>
          )}

        </div>
      </section>

      {/* ═══ Feedback CTA ═══ */}
      <section style={{ padding: "0 4rem 6rem", position: "relative", zIndex: 1 }}>
        <div className="section-inner">
          <div className="glass" style={{ borderRadius: 20, padding: "2rem 2.5rem", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "2rem", flexWrap: "wrap" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
              <div style={{ background: "rgba(139,92,246,0.1)", width: 44, height: 44, borderRadius: 12, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <MessageSquare size={20} color="var(--violet-2)" />
              </div>
              <div>
                <h3 style={{ fontSize: "1.1rem", marginBottom: "0.2rem" }}>Have feedback or a complaint?</h3>
                <p style={{ fontSize: "0.85rem", color: "var(--text-3)" }}>Visit our community page to share your thoughts and see what others are saying.</p>
              </div>
            </div>
            <Link href="/feedback" className="btn btn-primary" style={{ whiteSpace: "nowrap" }}>
              Go to Feedback <ChevronRight size={15} />
            </Link>
          </div>
        </div>
      </section>

      <Footer />

      {/* Feedback modal after download */}
      {feedbackModal && (
        <DownloadFeedbackModal
          platform={feedbackModal}
          onClose={() => setFeedbackModal(null)}
        />
      )}

      <style>{`
        @media (max-width: 640px) {
          .linux-callout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}

/* ────────────────────────────────
   Stat Cell for banner
──────────────────────────────── */
function StatCell({ icon, label, total, today, color, bg }) {
  return (
    <div style={{ textAlign: "center", padding: "1rem 0.5rem", background: bg, borderRadius: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem", marginBottom: "0.5rem", color }}>
        {icon}
        <span style={{ fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.04em" }}>{label}</span>
      </div>
      <div style={{ fontFamily: "var(--ffd)", fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.04em", lineHeight: 1 }}>
        <AnimatedNumber value={total} />
      </div>
      {today > 0 && (
        <div style={{ fontSize: "0.7rem", color: "var(--emerald)", marginTop: "0.4rem", fontWeight: 600 }}>+{today} today</div>
      )}
    </div>
  );
}
