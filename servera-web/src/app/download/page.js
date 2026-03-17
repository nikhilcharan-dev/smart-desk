"use client";
import { Navbar, Footer } from "../components";
import {
  Monitor, Smartphone, Globe, ArrowLeft, Download,
  ShieldCheck, Zap, CheckCircle, Package, ChevronRight
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";
import gsap from "gsap";

export default function DownloadPage() {
  const ref = useRef(null);

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

          {/* Cards */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: "2rem", marginBottom: "3rem" }}>

            {/* Windows — Available */}
            <div className="glass card" style={{ padding: "3rem", display: "flex", flexDirection: "column", borderColor: "rgba(139,92,246,0.2)" }}>
              {/* Top row */}
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
                v0.1.0
              </div>

              {/* Checklist */}
              <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem", marginBottom: "3rem" }}>
                {["Native Windows desktop app", "AES-256 encrypted credential vault", "One-click installer (~82 MB)", "No account or internet required"].map((t, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.875rem", color: "var(--text-2)" }}>
                    <CheckCircle size={14} style={{ color: "var(--emerald)", flexShrink: 0 }} />
                    {t}
                  </div>
                ))}
              </div>

              {/* Info strip */}
              <div style={{ background: "rgba(255,255,255,0.025)", borderRadius: 12, padding: "1rem 1.25rem", border: "1px solid var(--b0)", display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1.75rem" }}>
                <span style={{ fontSize: "0.82rem", color: "var(--text-3)" }}>
                  Size: <b style={{ color: "var(--text-2)" }}>~82 MB</b>
                </span>
                <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", color: "var(--cyan-2)", fontSize: "0.72rem", fontWeight: 700, letterSpacing: "0.08em" }}>
                  <ShieldCheck size={14} /> SIGNED BUILD
                </div>
              </div>

              <a
                href="/downloads/Servera.exe"
                download
                className="btn btn-download"
                style={{ width: "100%", padding: "1rem", fontSize: "1rem" }}
              >
                <Download size={18} /> Download for Windows
              </a>
            </div>

            {/* iOS — Coming Soon */}
            <div className="glass card" style={{ padding: "3rem", display: "flex", flexDirection: "column", opacity: 0.75 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "2.5rem" }}>
                <div style={{ background: "rgba(6,182,212,0.08)", width: 64, height: 64, borderRadius: 18, display: "flex", alignItems: "center", justifyContent: "center", border: "1px solid rgba(6,182,212,0.15)" }}>
                  <Smartphone size={30} color="var(--cyan)" />
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
                style={{ width: "100%", padding: "1rem", fontSize: "1rem", background: "var(--s1)", color: "var(--text-3)", border: "1px solid var(--b0)", cursor: "not-allowed", borderRadius: 13 }}
              >
                Not Available Yet
              </button>
            </div>
          </div>

          {/* Linux callout */}
          <div className="glass" style={{ borderRadius: 24, padding: "2.5rem 3rem", display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: "3rem" }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "0.75rem" }}>
                <div style={{ background: "rgba(16,185,129,0.08)", width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <Globe size={18} color="var(--emerald)" />
                </div>
                <h3 style={{ fontSize: "1.2rem" }}>Linux & macOS</h3>
              </div>
              <p style={{ color: "var(--text-2)", fontSize: "0.9rem", lineHeight: 1.65 }}>
                The GUI build for Linux and macOS is currently in private beta.
                Reach out if you want early access — we&apos;re onboarding testers now.
              </p>
            </div>
            <a href="mailto:hello@servera.io" className="btn btn-ghost" style={{ padding: "0.85rem 2rem", whiteSpace: "nowrap" }}>
              Request Access <ChevronRight size={16} />
            </a>
          </div>

        </div>
      </section>

      <Footer />

      <style>{`
        @media (max-width: 640px) {
          .linux-callout { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </main>
  );
}
