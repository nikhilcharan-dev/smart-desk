"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Server, Zap, Shield, Globe, Download, Monitor, Smartphone,
  Terminal, Lock, Activity, ArrowRight, CheckCircle, Star,
  Wifi, Layers, Command, Package, ChevronRight, Key,
  BarChart2, FolderOpen, GitBranch
} from "lucide-react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/dist/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/* ═══════════════════════════════════════════
   PARTICLE BACKGROUND (Supernova)
═══════════════════════════════════════════ */
export const ParticleBackground = () => {
  const containerRef = useRef(null);
  const swarmRef = useRef(null);

  useEffect(() => {
    let mounted = true;

    import("@/lib/super_nova").then(({ ParticlesSwarm }) => {
      if (!mounted || !containerRef.current) return;
      swarmRef.current = new ParticlesSwarm(containerRef.current, 25000);
    });

    const onResize = () => {
      if (swarmRef.current) swarmRef.current.resize();
    };
    window.addEventListener("resize", onResize);

    return () => {
      mounted = false;
      window.removeEventListener("resize", onResize);
      if (swarmRef.current) {
        swarmRef.current.dispose();
        swarmRef.current = null;
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: -1,
        pointerEvents: "none",
      }}
    />
  );
};

/* ═══════════════════════════════════════════
   CURSOR SPOTLIGHT
═══════════════════════════════════════════ */
export const CursorSpotlight = () => {
  const ref = useRef(null);

  useEffect(() => {
    const move = (e) => {
      if (ref.current) {
        ref.current.style.left = `${e.clientX - 350}px`;
        ref.current.style.top  = `${e.clientY - 350}px`;
      }
    };
    window.addEventListener("mousemove", move, { passive: true });
    return () => window.removeEventListener("mousemove", move);
  }, []);

  return (
    <div
      ref={ref}
      style={{
        position: "fixed",
        width: 700,
        height: 700,
        borderRadius: "50%",
        background: "radial-gradient(circle, rgba(139,92,246,0.055) 0%, transparent 70%)",
        pointerEvents: "none",
        zIndex: 0,
        transition: "left 0.08s ease, top 0.08s ease",
        top: 0,
        left: 0,
      }}
    />
  );
};

/* ═══════════════════════════════════════════
   NAVBAR
═══════════════════════════════════════════ */
export const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const handler = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, []);

  if (!mounted) return <nav className="nav" style={{ height: 80 }} />;

  return (
    <nav className={`nav${scrolled ? " nav--scrolled" : ""}`}>
      {/* Logo */}
      <Link href="/" style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
        <Image
          src="/icon-32.png"
          alt="Servera"
          width={34}
          height={34}
          style={{ borderRadius: 9 }}
        />
        <span style={{ fontFamily: "var(--ffd)", fontWeight: 800, fontSize: "1.25rem", letterSpacing: "-0.04em" }}>
          Servera
        </span>
      </Link>

      {/* Links */}
      <div className="nav-links" style={{ display: "flex", gap: "2.25rem", alignItems: "center" }}>
        {[
          { label: "Features",     href: "#features"     },
          { label: "OpsPilot",     href: "#opspilot"     },
          { label: "How It Works", href: "#how-it-works" },
          { label: "Mobile",       href: "#mobile"       },
          { label: "Feedback",     href: "/feedback"     },
        ].map(({ label, href }) => (
          <a key={label} href={href} className="link-hover"
            style={{ fontSize: "0.875rem", fontWeight: 500, color: "var(--text-2)", letterSpacing: "-0.01em" }}>
            {label}
          </a>
        ))}
      </div>

      {/* CTA */}
      <Link href="/download" className="btn btn-primary">
        Download <Download size={14} />
      </Link>
    </nav>
  );
};

/* ═══════════════════════════════════════════
   TERMINAL ANIMATION
═══════════════════════════════════════════ */
const TerminalDemo = () => {
  const [visible, setVisible] = useState(0);

  const lines = [
    { cls: "t-prompt", text: "$ servera connect prod-01.company.io" },
    { cls: "t-ok",     text: "  ✓ SSH-2 authenticated — 47ms" },
    { cls: "t-muted",  text: "  Ubuntu 22.04 LTS  ·  4 vCPU  ·  16 GB" },
    { cls: "",         text: "" },
    { cls: "t-prompt", text: "$ servera monitor --live" },
    { cls: "t-info",   text: "  CPU  ██████████░░░░░░  63%" },
    { cls: "t-info",   text: "  RAM  ███████░░░░░░░░░  44%" },
    { cls: "t-info",   text: "  DISK ████░░░░░░░░░░░░  27%" },
    { cls: "",         text: "" },
    { cls: "t-ok",     text: "  ● prod-01    online  ↑ 18 d" },
    { cls: "t-ok",     text: "  ● prod-02    online  ↑ 7 d" },
    { cls: "t-amber",  text: "  ● staging-01 warning ↑ 2 d" },
  ];

  useEffect(() => {
    let i = 0;
    const tick = () => {
      if (i < lines.length) {
        i++;
        setVisible(i);
        setTimeout(tick, i < 3 ? 480 : 220);
      }
    };
    const t = setTimeout(tick, 600);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="terminal" style={{ maxWidth: 480, width: "100%" }}>
      <div className="terminal__bar">
        <div className="terminal__dot" style={{ background: "#ff5f57" }} />
        <div className="terminal__dot" style={{ background: "#febc2e" }} />
        <div className="terminal__dot" style={{ background: "#28c840" }} />
        <span className="terminal__title">servera — SSH & Server Management</span>
      </div>
      <div className="terminal__body mono">
        {lines.slice(0, visible).map((line, i) => (
          <div key={i} className={line.cls} style={{ minHeight: "1.75em" }}>
            {line.text}
          </div>
        ))}
        {visible < lines.length && (
          <span className="t-prompt cursor-blink">▋</span>
        )}
      </div>
    </div>
  );
};

/* ═══════════════════════════════════════════
   HERO
═══════════════════════════════════════════ */
export const Hero = () => {
  const leftRef  = useRef(null);
  const rightRef = useRef(null);

  useEffect(() => {
    gsap.from(leftRef.current.children, {
      y: 36, duration: 0.85, stagger: 0.1, ease: "power3.out", clearProps: "transform"
    });
    gsap.from(rightRef.current, {
      x: 30, duration: 1, delay: 0.25, ease: "expo.out", clearProps: "transform"
    });
  }, []);

  return (
    <section style={{ minHeight: "100vh", display: "flex", alignItems: "center", paddingTop: "8rem" }}>
      {/* Background orbs */}
      <div className="orb" style={{ width: "55vw", height: "55vw", background: "var(--violet-glow)", opacity: 0.22, top: "-10%", left: "-15%", filter: "blur(120px)" }} />
      <div className="orb" style={{ width: "35vw", height: "35vw", background: "var(--cyan-glow)",   opacity: 0.15, bottom: "5%",  right: "-8%",  filter: "blur(100px)" }} />

      <div className="section-inner" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5rem", alignItems: "center", width: "100%" }}>
        {/* Text */}
        <div ref={leftRef} style={{ display: "flex", flexDirection: "column", gap: "0", position: "relative", zIndex: 1 }}>
          {/* Badge */}
          <div style={{ marginBottom: "1.75rem" }}>
            <span className="badge badge-v" style={{ fontSize: "0.72rem" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--violet-2)", display: "inline-block" }} />
              v0.1.0 now available for Windows, macOS & Linux
              <ChevronRight size={12} style={{ marginLeft: 2, opacity: 0.7 }} />
            </span>
          </div>

          {/* Headline */}
          <h1 style={{ fontSize: "clamp(3rem, 5.5vw, 5.5rem)", marginBottom: "1.5rem", letterSpacing: "-0.04em" }}>
            Your servers,<br />
            finally at your<br />
            <span className="gradient-text">command.</span>
          </h1>

          {/* Subheadline */}
          <p style={{ fontSize: "1.15rem", color: "var(--text-2)", lineHeight: 1.7, marginBottom: "2.75rem", maxWidth: 520 }}>
            Servera is the server management desktop app engineers actually enjoy using.
            Connect via SSH, watch real-time metrics, and control all your machines — from one beautiful interface.
          </p>

          {/* CTAs */}
          <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap", marginBottom: "3rem" }}>
            <Link href="/download" className="btn btn-download btn-lg">
              <Monitor size={18} /> Download for Windows
            </Link>
            <a href="#features" className="btn btn-ghost btn-lg">
              See features <ArrowRight size={16} />
            </a>
          </div>

          {/* Social proof micro */}
          <div style={{ display: "flex", alignItems: "center", gap: "1.25rem", flexWrap: "wrap" }}>
            {[
              { icon: <CheckCircle size={14} color="var(--emerald)" />, label: "Free core version" },
              { icon: <CheckCircle size={14} color="var(--emerald)" />, label: "Windows · macOS · Linux" },
              { icon: <CheckCircle size={14} color="var(--emerald)" />, label: "No account required" },
            ].map(({ icon, label }, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", color: "var(--text-2)" }}>
                {icon} {label}
              </div>
            ))}
          </div>
        </div>

        {/* Terminal Demo */}
        <div ref={rightRef} style={{ display: "flex", justifyContent: "center", position: "relative", zIndex: 1 }}>
          <TerminalDemo />
        </div>
      </div>

      {/* Responsive: stack on mobile */}
      <style>{`
        @media (max-width: 900px) {
          .hero-grid { grid-template-columns: 1fr !important; }
          .hero-terminal { display: none !important; }
        }
      `}</style>
    </section>
  );
};

/* ═══════════════════════════════════════════
   STATS BAR
═══════════════════════════════════════════ */
export const StatsBar = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current.children, {
      scrollTrigger: { trigger: ref.current, start: "top 85%" },
      y: 20, duration: 0.6, stagger: 0.12, ease: "power2.out", clearProps: "transform"
    });
  }, []);

  const stats = [
    { num: "< 50ms", label: "Average SSH connect time" },
    { num: "1-click", label: "Instant session resume"   },
    { num: "AES-256", label: "Credential encryption"    },
    { num: "Free",    label: "Core version, forever"    },
  ];

  return (
    <section style={{ padding: "0" }}>
      <div className="glass" style={{ borderLeft: "none", borderRight: "none", borderRadius: 0 }}>
        <div ref={ref} className="stats-bar section-inner" style={{ maxWidth: "100%" }}>
          {stats.map(({ num, label }, i) => (
            <div key={i} className="stat-item">
              <div className="stat-num gradient-text">{num}</div>
              <div className="stat-label">{label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════════
   WHY SECTION
═══════════════════════════════════════════ */
export const WhySection = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current.querySelectorAll(".why-card"), {
      scrollTrigger: { trigger: ref.current, start: "top 80%" },
      y: 32, duration: 0.7, stagger: 0.18, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  return (
    <section ref={ref} id="why">
      <div className="section-inner">
        <div style={{ textAlign: "center", marginBottom: "5rem" }}>
          <div className="section-tag" style={{ justifyContent: "center" }}>Why Servera</div>
          <h2 style={{ fontSize: "clamp(2.2rem, 4vw, 3.8rem)", marginBottom: "1.25rem" }}>
            Stop fighting your tools.<br />
            <span className="gradient-text">Start shipping faster.</span>
          </h2>
          <p style={{ fontSize: "1.1rem", color: "var(--text-2)", maxWidth: 600, margin: "0 auto", lineHeight: 1.7 }}>
            Most engineers manage servers with a patchwork of terminal windows, PuTTY sessions, and sticky-note IP lists.
            Servera brings order to the chaos.
          </p>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2rem" }}>
          {/* Before */}
          <div className="why-card glass card" style={{ padding: "3rem", borderColor: "rgba(244,63,94,0.15)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "2rem" }}>
              <div style={{ background: "var(--rose-sub)", padding: "0.6rem", borderRadius: 10 }}>
                <span style={{ fontSize: "1rem" }}>😮‍💨</span>
              </div>
              <h3 style={{ fontSize: "1.3rem" }}>Before Servera</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              {[
                "Hunting for server IPs in old Slack messages",
                "6 PuTTY windows open with no idea which is which",
                "SSH-ing just to run df -h and exit",
                "Forgetting to close tunnels when you're done",
                "No visibility until something breaks in prod",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.7rem", color: "var(--text-2)", fontSize: "0.92rem" }}>
                  <span style={{ color: "var(--rose)", marginTop: 2, flexShrink: 0 }}>✕</span>
                  {t}
                </div>
              ))}
            </div>
          </div>

          {/* After */}
          <div className="why-card glass card" style={{ padding: "3rem", borderColor: "rgba(16,185,129,0.18)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem", marginBottom: "2rem" }}>
              <div style={{ background: "var(--emerald-sub)", padding: "0.6rem", borderRadius: 10 }}>
                <span style={{ fontSize: "1rem" }}>⚡</span>
              </div>
              <h3 style={{ fontSize: "1.3rem" }}>With Servera</h3>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.1rem" }}>
              {[
                "Every server saved with name, tags, and notes",
                "One click to open a terminal, no typing IPs",
                "Real-time CPU / RAM / Disk on every machine",
                "Port forwarding managed from a clean UI",
                "Live alerts before problems hit production",
              ].map((t, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.7rem", color: "var(--text-2)", fontSize: "0.92rem" }}>
                  <CheckCircle size={15} style={{ color: "var(--emerald)", marginTop: 2, flexShrink: 0 }} />
                  {t}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .why-card { padding: 2rem !important; }
          .why-section-grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
};

/* ═══════════════════════════════════════════
   FEATURES BENTO
═══════════════════════════════════════════ */
export const Features = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current.querySelectorAll(".feat"), {
      scrollTrigger: { trigger: ref.current, start: "top 80%" },
      y: 28, duration: 0.65, stagger: 0.07, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  /* Small feature pill used in the grid rows */
  const Pill = ({ icon, label, sub, iconBg }) => (
    <div style={{ display: "flex", alignItems: "flex-start", gap: "0.85rem" }}>
      <div style={{ width: 36, height: 36, borderRadius: 10, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        {icon}
      </div>
      <div>
        <div style={{ fontSize: "0.9rem", fontWeight: 600, marginBottom: "0.2rem" }}>{label}</div>
        <div style={{ fontSize: "0.78rem", color: "var(--text-3)", lineHeight: 1.5 }}>{sub}</div>
      </div>
    </div>
  );

  return (
    <section ref={ref} id="features">
      <div className="section-inner">
        <div style={{ textAlign: "center", marginBottom: "4.5rem" }}>
          <div className="section-tag" style={{ justifyContent: "center" }}>Everything Included</div>
          <h2 style={{ fontSize: "clamp(2.2rem, 4vw, 3.8rem)" }}>
            One app. Every tool<br />
            <span className="gradient-text">your server needs.</span>
          </h2>
          <p style={{ color: "var(--text-2)", fontSize: "1.05rem", marginTop: "1rem", maxWidth: 520, margin: "1rem auto 0" }}>
            No plugin marketplace. No paid tiers. Every feature ships in the core build.
          </p>
        </div>

        {/* Row 1 */}
        <div className="bento bento-3" style={{ marginBottom: "1.5rem" }}>

          {/* LARGE — TermHub */}
          <div className="feat glass card card-lift bento-span-2" style={{ padding: "2.75rem 3rem" }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1.5rem", flexWrap: "wrap" }}>
              <div style={{ flex: 1, minWidth: 220 }}>
                <div className="feat-icon" style={{ background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.2)" }}>
                  <Terminal size={22} color="var(--violet-2)" />
                </div>
                <h3 style={{ fontSize: "1.55rem", marginBottom: "0.65rem" }}>TermHub — Multi-pane Terminal</h3>
                <p style={{ color: "var(--text-2)", fontSize: "0.9rem", lineHeight: 1.65, maxWidth: 380 }}>
                  Split your workspace into as many terminal panes as you need. Each pane is a live SSH session. Drag, resize, and tile them your way.
                </p>
              </div>
              {/* Mini preview */}
              <div style={{ background: "rgba(4,4,8,0.9)", borderRadius: 12, padding: "1rem 1.25rem", border: "1px solid rgba(255,255,255,0.07)", fontFamily: "var(--ffm)", fontSize: "0.75rem", lineHeight: 1.8, minWidth: 220, flexShrink: 0 }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "0.4rem 0.6rem", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ color: "var(--text-3)", fontSize: "0.65rem", marginBottom: 3 }}>prod-01</div>
                    <div style={{ color: "var(--violet-2)" }}>$ nginx -t</div>
                  </div>
                  <div style={{ background: "rgba(255,255,255,0.03)", borderRadius: 6, padding: "0.4rem 0.6rem", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div style={{ color: "var(--text-3)", fontSize: "0.65rem", marginBottom: 3 }}>prod-02</div>
                    <div style={{ color: "var(--cyan-2)" }}>$ tail -f app.log</div>
                  </div>
                </div>
                <div style={{ color: "rgba(255,255,255,0.2)", fontSize: "0.65rem" }}>2 panes · SSH-2 · encrypted</div>
              </div>
            </div>
          </div>

          {/* SMALL — SFTP */}
          <div className="feat glass card card-lift" style={{ padding: "2.5rem" }}>
            <div className="feat-icon" style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.18)" }}>
              <FolderOpen size={22} color="var(--cyan)" />
            </div>
            <h3 style={{ fontSize: "1.25rem", marginBottom: "0.6rem" }}>SFTP File Transfer</h3>
            <p style={{ color: "var(--text-2)", lineHeight: 1.6, fontSize: "0.87rem" }}>
              Browse your server like a local drive. Drag-drop upload, download, rename, chmod — all over SFTP. Built-in file editor for quick changes.
            </p>
            <div style={{ marginTop: "1.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
              {["Upload", "Download", "Edit", "chmod"].map(t => (
                <span key={t} className="badge badge-c" style={{ fontSize: "0.68rem" }}>{t}</span>
              ))}
            </div>
          </div>

        </div>

        {/* Row 2 — 3 equal cards */}
        <div className="bento bento-3" style={{ marginBottom: "1.5rem" }}>

          {/* Dashboard */}
          <div className="feat glass card card-lift" style={{ padding: "2.5rem" }}>
            <div className="feat-icon" style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.18)" }}>
              <BarChart2 size={22} color="var(--emerald)" />
            </div>
            <h3 style={{ fontSize: "1.25rem", marginBottom: "0.6rem" }}>Live Dashboard</h3>
            <p style={{ color: "var(--text-2)", lineHeight: 1.6, fontSize: "0.87rem", marginBottom: "1.5rem" }}>
              Real-time CPU, RAM, Disk, and network at a glance. See every server&apos;s health on one screen.
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
              {[{ label: "CPU", pct: 63, color: "var(--emerald)" }, { label: "RAM", pct: 44, color: "var(--cyan)" }, { label: "Disk", pct: 27, color: "var(--violet)" }].map(({ label, pct, color }) => (
                <div key={label} style={{ display: "flex", alignItems: "center", gap: "0.6rem" }}>
                  <span style={{ fontSize: "0.7rem", color: "var(--text-3)", width: 28 }}>{label}</span>
                  <div style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
                    <div style={{ height: "100%", width: `${pct}%`, background: color, borderRadius: 2 }} />
                  </div>
                  <span style={{ fontSize: "0.7rem", color, width: 28, textAlign: "right" }}>{pct}%</span>
                </div>
              ))}
            </div>
          </div>

          {/* Docker */}
          <div className="feat glass card card-lift" style={{ padding: "2.5rem" }}>
            <div className="feat-icon" style={{ background: "rgba(6,182,212,0.1)", border: "1px solid rgba(6,182,212,0.18)" }}>
              <Layers size={22} color="var(--cyan)" />
            </div>
            <h3 style={{ fontSize: "1.25rem", marginBottom: "0.6rem" }}>Docker Manager</h3>
            <p style={{ color: "var(--text-2)", lineHeight: 1.6, fontSize: "0.87rem" }}>
              View, start, stop, and inspect containers without typing a single Docker command. Logs, stats, and exec — all in one panel.
            </p>
          </div>

          {/* Process Manager */}
          <div className="feat glass card card-lift" style={{ padding: "2.5rem" }}>
            <div className="feat-icon" style={{ background: "rgba(245,158,11,0.1)", border: "1px solid rgba(245,158,11,0.18)" }}>
              <Activity size={22} color="var(--amber)" />
            </div>
            <h3 style={{ fontSize: "1.25rem", marginBottom: "0.6rem" }}>Process Manager</h3>
            <p style={{ color: "var(--text-2)", lineHeight: 1.6, fontSize: "0.87rem" }}>
              Browse running processes sorted by CPU or memory. Kill, renice, or inspect any PID — without opening htop.
            </p>
          </div>

        </div>

        {/* Row 3 — wide card + small */}
        <div className="bento bento-3">

          {/* Security — wide */}
          <div className="feat glass card card-lift bento-span-2" style={{ padding: "2.75rem 3rem" }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5rem", alignItems: "start" }}>
              <div>
                <div className="feat-icon" style={{ background: "rgba(244,63,94,0.08)", border: "1px solid rgba(244,63,94,0.15)" }}>
                  <Lock size={22} color="var(--rose)" />
                </div>
                <h3 style={{ fontSize: "1.5rem", marginBottom: "0.65rem" }}>Security Built-in</h3>
                <p style={{ color: "var(--text-2)", fontSize: "0.9rem", lineHeight: 1.65 }}>
                  Credentials encrypted at rest with AES-256. SSH key management, UFW firewall rules,
                  and environment variable vaults — all inside Servera.
                </p>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "0.85rem" }}>
                <Pill icon={<Key size={15} color="var(--violet-2)" />}     label="SSH Key Manager"     sub="Import, generate & manage keys"   iconBg="rgba(139,92,246,0.1)" />
                <Pill icon={<Shield size={15} color="var(--rose)" />}       label="UFW Firewall"         sub="Add/remove rules visually"         iconBg="rgba(244,63,94,0.08)" />
                <Pill icon={<Command size={15} color="var(--amber)" />}     label="Env Variables"       sub="Per-server .env vault"             iconBg="rgba(245,158,11,0.08)" />
                <Pill icon={<Globe size={15} color="var(--emerald)" />}     label="Port Scanner"        sub="Detect open ports instantly"       iconBg="rgba(16,185,129,0.08)" />
              </div>
            </div>
          </div>

          {/* Toolbox column */}
          <div className="feat glass card card-lift" style={{ padding: "2.5rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
            <h3 style={{ fontSize: "1.25rem", marginBottom: "0.25rem" }}>More Tools</h3>
            <Pill icon={<Package size={15} color="var(--cyan)" />}       label="APT Manager"        sub="Install & remove packages"         iconBg="rgba(6,182,212,0.1)" />
            <Pill icon={<GitBranch size={15} color="var(--violet-2)" />} label="Log Viewer"         sub="Tail any log file live"            iconBg="rgba(139,92,246,0.1)" />
            <Pill icon={<Zap size={15} color="var(--amber)" />}          label="Command Snippets"   sub="Save & reuse frequent commands"    iconBg="rgba(245,158,11,0.08)" />
            <Pill icon={<Command size={15} color="var(--emerald)" />}    label="Command Palette"    sub="⌘K to reach anything in one step" iconBg="rgba(16,185,129,0.08)" />
            <Pill icon={<Activity size={15} color="var(--rose)" />}      label="Service Manager"    sub="systemctl start/stop from UI"      iconBg="rgba(244,63,94,0.08)" />
            <Pill icon={<Wifi size={15} color="var(--cyan-2)" />}        label="Cron Jobs"          sub="Schedule tasks visually"           iconBg="rgba(6,182,212,0.1)" />
          </div>

        </div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════════
   OPS PILOT — AI SECTION
═══════════════════════════════════════════ */
export const OpsPilotSection = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current.querySelectorAll(".ops-anim"), {
      scrollTrigger: { trigger: ref.current, start: "top 78%" },
      y: 30, duration: 0.7, stagger: 0.12, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  const providers = [
    {
      label: "Ollama",
      sub: "Self-hosted",
      desc: "Run Qwen 2.5 Coder, Llama 3, or CodeGemma locally. Zero API costs, fully air-gapped.",
      badge: "Self-hosted",
      badgeCls: "badge-g",
      dot: "var(--emerald)",
      models: ["qwen2.5-coder:7b", "llama3:8b", "codegemma:7b"],
      iconBg: "rgba(16,185,129,0.1)",
      borderColor: "rgba(16,185,129,0.18)",
    },
    {
      label: "OpenAI",
      sub: "API Key",
      desc: "GPT-4o, GPT-4 Turbo, o1-preview. Industry-standard models, plug in your key.",
      badge: "API Key",
      badgeCls: "badge-c",
      dot: "var(--cyan)",
      models: ["gpt-4o", "gpt-4o-mini", "o1-preview"],
      iconBg: "rgba(6,182,212,0.09)",
      borderColor: "rgba(6,182,212,0.18)",
    },
    {
      label: "Gemini",
      sub: "API Key",
      desc: "Gemini 1.5 Pro and Flash via Google API. Fast, cheap, and multimodal.",
      badge: "API Key",
      badgeCls: "badge-c",
      dot: "var(--cyan)",
      models: ["gemini-1.5-pro", "gemini-2.0-flash"],
      iconBg: "rgba(6,182,212,0.09)",
      borderColor: "rgba(6,182,212,0.18)",
    },
    {
      label: "AWS Bedrock",
      sub: "Enterprise",
      desc: "Claude 3.5 Sonnet, Llama 3.1 70B, Mistral Large — on your AWS account. No data leaves your cloud.",
      badge: "Enterprise",
      badgeCls: "badge-a",
      dot: "var(--amber)",
      models: ["claude-3-5-sonnet", "llama-3.1-70b", "mistral-large"],
      iconBg: "rgba(245,158,11,0.09)",
      borderColor: "rgba(245,158,11,0.18)",
    },
  ];

  return (
    <section ref={ref} id="opspilot" style={{ background: "linear-gradient(180deg, transparent, rgba(139,92,246,0.03) 50%, transparent)" }}>
      <div className="section-inner">

        {/* Header */}
        <div className="ops-anim" style={{ textAlign: "center", marginBottom: "5rem" }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: "0.5rem", background: "rgba(139,92,246,0.1)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: 100, padding: "0.35rem 1rem 0.35rem 0.6rem", marginBottom: "1.5rem" }}>
            <div style={{ background: "var(--violet)", borderRadius: "50%", width: 22, height: 22, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Zap size={12} color="white" />
            </div>
            <span style={{ fontSize: "0.75rem", fontWeight: 700, color: "var(--violet-2)", letterSpacing: "0.05em" }}>New in v0.1.0</span>
          </div>
          <h2 style={{ fontSize: "clamp(2.4rem, 4.5vw, 4.2rem)", marginBottom: "1.25rem" }}>
            Meet <span className="gradient-text">OpsPilot</span> —<br />
            your AI terminal buddy.
          </h2>
          <p style={{ fontSize: "1.1rem", color: "var(--text-2)", maxWidth: 640, margin: "0 auto", lineHeight: 1.7 }}>
            Describe any server task in plain English. OpsPilot generates a numbered command plan,
            lets you review and edit every step, then executes it — and auto-fixes failures on its own.
          </p>
        </div>

        {/* Main split: mock UI + key capabilities */}
        <div className="ops-anim" style={{ display: "grid", gridTemplateColumns: "1.15fr 0.85fr", gap: "3.5rem", alignItems: "start", marginBottom: "4rem" }}>

          {/* Mock OpsPilot UI */}
          <div style={{ background: "rgba(4,4,8,0.97)", borderRadius: 20, overflow: "hidden", border: "1px solid rgba(255,255,255,0.085)", boxShadow: "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(139,92,246,0.08)", fontFamily: "var(--ffm)", fontSize: "0.8rem" }}>
            {/* Header bar */}
            <div style={{ background: "rgba(255,255,255,0.03)", padding: "0.85rem 1.25rem", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.55rem" }}>
                <Zap size={14} color="var(--violet-2)" />
                <span style={{ fontWeight: 700, fontSize: "0.82rem", fontFamily: "var(--ff)" }}>OpsPilot</span>
                <span className="badge badge-v" style={{ fontSize: "0.62rem", padding: "0.15rem 0.55rem" }}>AI Terminal</span>
              </div>
              <div style={{ display: "flex", gap: "0.4rem", opacity: 0.4 }}>
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
                <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(255,255,255,0.2)" }} />
              </div>
            </div>

            <div style={{ padding: "1.25rem 1.5rem", display: "flex", flexDirection: "column", gap: "1rem", minHeight: 360 }}>
              {/* User prompt bubble */}
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ background: "rgba(139,92,246,0.18)", border: "1px solid rgba(139,92,246,0.25)", borderRadius: "14px 14px 4px 14px", padding: "0.65rem 1rem", maxWidth: "80%", fontSize: "0.8rem", color: "var(--violet-3)", fontFamily: "var(--ff)" }}>
                  Install nginx and configure it for a React SPA with SSL
                </div>
              </div>

              {/* AI plan card */}
              <div style={{ background: "rgba(255,255,255,0.025)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 12, overflow: "hidden" }}>
                <div style={{ padding: "0.65rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", fontSize: "0.75rem", fontFamily: "var(--ff)", fontWeight: 600, color: "var(--text-2)" }}>
                    <ChevronRight size={13} /> Command Plan (4 steps)
                  </div>
                  <div style={{ display: "flex", gap: "0.4rem" }}>
                    <span style={{ padding: "0.2rem 0.55rem", borderRadius: 6, border: "1px solid rgba(244,63,94,0.3)", fontSize: "0.68rem", color: "var(--rose)", fontFamily: "var(--ff)", cursor: "pointer" }}>Reject</span>
                    <span style={{ padding: "0.2rem 0.55rem", borderRadius: 6, background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)", fontSize: "0.68rem", color: "var(--emerald)", fontFamily: "var(--ff)", cursor: "pointer" }}>▶ Approve All</span>
                  </div>
                </div>
                {[
                  { n: 1, cmd: "apt update && apt install -y nginx", desc: "Update packages and install nginx", status: "done" },
                  { n: 2, cmd: "systemctl enable --now nginx", desc: "Enable and start nginx service", status: "done" },
                  { n: 3, cmd: "certbot --nginx -d yourdomain.com", desc: "Obtain SSL certificate via Let's Encrypt", status: "running" },
                  { n: 4, cmd: "nginx -t && systemctl reload nginx", desc: "Test config and reload", status: "pending" },
                ].map(({ n, cmd, desc, status }) => (
                  <div key={n} style={{ padding: "0.55rem 1rem", borderBottom: "1px solid rgba(255,255,255,0.04)", display: "flex", alignItems: "center", gap: "0.65rem" }}>
                    <span style={{ fontSize: "0.65rem", color: status === "done" ? "var(--emerald)" : status === "running" ? "var(--amber)" : "var(--text-3)", flexShrink: 0 }}>
                      {status === "done" ? "✓" : status === "running" ? "⟳" : "○"}
                    </span>
                    <span style={{ fontSize: "0.65rem", color: "var(--text-3)", flexShrink: 0, width: 16 }}>{n}.</span>
                    <code style={{ color: status === "done" ? "rgba(255,255,255,0.55)" : status === "running" ? "var(--cyan-2)" : "var(--text-2)", fontSize: "0.75rem", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cmd}</code>
                    <span style={{ fontSize: "0.62rem", color: "var(--text-3)", flexShrink: 0, fontFamily: "var(--ff)" }}>{desc}</span>
                  </div>
                ))}
              </div>

              {/* Input */}
              <div style={{ marginTop: "auto", display: "flex", gap: "0.6rem", alignItems: "center", background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.07)", borderRadius: 10, padding: "0.6rem 0.85rem" }}>
                <span style={{ flex: 1, color: "var(--text-3)", fontFamily: "var(--ff)", fontSize: "0.78rem" }}>Describe what you want to do...</span>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: "var(--violet)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <ArrowRight size={13} color="white" />
                </div>
              </div>
            </div>
          </div>

          {/* Capabilities list */}
          <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
            <h3 style={{ fontSize: "1.4rem", marginBottom: "0.25rem" }}>How OpsPilot works</h3>
            {[
              {
                icon: <Zap size={17} color="var(--violet-2)" />,
                title: "Plain English → Command Plan",
                desc: "Type what you want done. OpsPilot breaks it into numbered, reviewable steps you approve before anything runs.",
                bg: "var(--violet-sub)",
              },
              {
                icon: <CheckCircle size={17} color="var(--emerald)" />,
                title: "Review, Edit & Approve",
                desc: "Toggle steps on/off, edit individual commands inline, or run a single step. You stay in full control.",
                bg: "var(--emerald-sub)",
              },
              {
                icon: <Activity size={17} color="var(--cyan)" />,
                title: "Reads Live Terminal Context",
                desc: "OpsPilot sees your last 100 lines of terminal output, so suggestions are always grounded in your actual server state.",
                bg: "var(--cyan-sub)",
              },
              {
                icon: <Shield size={17} color="var(--amber)" />,
                title: "Auto-retry on Failure",
                desc: "If a command fails, OpsPilot automatically reads the error, generates a fix plan, and retries — up to 3 times.",
                bg: "var(--amber-sub)",
              },
            ].map(({ icon, title, desc, bg }, i) => (
              <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "1rem" }}>
                <div style={{ width: 38, height: 38, borderRadius: 11, background: bg, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 2 }}>
                  {icon}
                </div>
                <div>
                  <div style={{ fontWeight: 600, marginBottom: "0.25rem", fontSize: "0.95rem" }}>{title}</div>
                  <div style={{ color: "var(--text-2)", fontSize: "0.84rem", lineHeight: 1.6 }}>{desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Provider cards */}
        <div className="ops-anim">
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <p style={{ color: "var(--text-2)", fontSize: "0.9rem" }}>
              Bring your own model — OpsPilot works with all major providers, including fully self-hosted.
            </p>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "1.25rem" }}>
            {providers.map(({ label, sub, desc, badge, badgeCls, dot, models, iconBg, borderColor }) => (
              <div key={label} className="glass card" style={{ padding: "1.75rem", borderColor }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: "1rem" }}>
                  <div style={{ width: 40, height: 40, borderRadius: 11, background: iconBg, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ width: 8, height: 8, borderRadius: "50%", background: dot, display: "block", boxShadow: `0 0 8px ${dot}` }} />
                  </div>
                  <span className={`badge ${badgeCls}`} style={{ fontSize: "0.65rem" }}>{badge}</span>
                </div>
                <h4 style={{ fontSize: "1rem", marginBottom: "0.2rem" }}>{label}</h4>
                <p style={{ fontSize: "0.78rem", color: "var(--text-2)", lineHeight: 1.55, marginBottom: "1rem" }}>{desc}</p>
                <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
                  {models.map(m => (
                    <span key={m} className="mono" style={{ fontSize: "0.68rem", color: "var(--text-3)", background: "rgba(255,255,255,0.03)", padding: "0.2rem 0.5rem", borderRadius: 5, display: "block" }}>
                      {m}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

      <style>{`
        @media (max-width: 1024px) {
          #opspilot .section-inner > div:nth-child(3) { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 900px) {
          #opspilot .section-inner > div:nth-child(2) { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          #opspilot .section-inner > div:last-child > div { grid-template-columns: 1fr 1fr !important; }
        }
        @media (max-width: 480px) {
          #opspilot .section-inner > div:last-child > div { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
};

/* ═══════════════════════════════════════════
   HOW IT WORKS
═══════════════════════════════════════════ */
export const HowItWorks = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current.querySelectorAll(".step-card"), {
      scrollTrigger: { trigger: ref.current, start: "top 80%" },
      y: 32, duration: 0.65, stagger: 0.2, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  const steps = [
    {
      icon: <Package size={22} color="var(--violet-2)" />,
      label: "01",
      title: "Install & Launch",
      desc: "Download the installer for your platform, run it, and Servera is up in under 30 seconds. No dependencies, no config files.",
      detail: "The installer weighs under 90 MB. Available for Windows 10/11, macOS 12+, and Linux (deb & AppImage).",
      color: "var(--violet)",
    },
    {
      icon: <Key size={22} color="var(--cyan)" />,
      label: "02",
      title: "Add Your Servers",
      desc: "Enter a hostname, port, and your SSH credentials once. Servera encrypts everything and stores it locally — never online.",
      detail: "Supports password auth, private key files, and SSH agent forwarding. Works with any SSH-accessible server.",
      color: "var(--cyan)",
    },
    {
      icon: <Zap size={22} color="var(--emerald)" />,
      label: "03",
      title: "Connect & Control",
      desc: "Click a server to open a terminal session instantly. Monitor metrics live, run commands, and never lose context.",
      detail: "Open multiple servers in tabs. Metrics update in real time. Close and re-open sessions without losing history.",
      color: "var(--emerald)",
    },
  ];

  return (
    <section ref={ref} id="how-it-works">
      <div className="section-inner">
        <div style={{ textAlign: "center", marginBottom: "5rem" }}>
          <div className="section-tag" style={{ justifyContent: "center" }}>How It Works</div>
          <h2 style={{ fontSize: "clamp(2.2rem, 4vw, 3.8rem)" }}>
            Up and running in<br />
            <span className="gradient-text">under a minute.</span>
          </h2>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "2rem" }}>
          {steps.map(({ icon, label, title, desc, detail, color }, i) => (
            <div key={i} className="step-card glass card" style={{ padding: "2.75rem 2.25rem", display: "flex", flexDirection: "column", gap: "1.25rem" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <div style={{ width: 44, height: 44, borderRadius: 12, background: `rgba(${color === "var(--violet)" ? "139,92,246" : color === "var(--cyan)" ? "6,182,212" : "16,185,129"},0.1)`, border: `1px solid rgba(${color === "var(--violet)" ? "139,92,246" : color === "var(--cyan)" ? "6,182,212" : "16,185,129"},0.2)`, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  {icon}
                </div>
                <span className="mono" style={{ fontSize: "0.75rem", color: "var(--text-3)", fontWeight: 600 }}>{label}</span>
              </div>
              <h3 style={{ fontSize: "1.35rem" }}>{title}</h3>
              <p style={{ color: "var(--text-2)", lineHeight: 1.65, fontSize: "0.92rem" }}>{desc}</p>
              <p style={{ color: "var(--text-3)", lineHeight: 1.6, fontSize: "0.82rem", borderTop: "1px solid var(--b0)", paddingTop: "1.25rem", marginTop: "auto" }}>
                {detail}
              </p>
            </div>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          .step-card { padding: 2rem 1.75rem !important; }
        }
        @media (max-width: 640px) {
          #how-it-works .section-inner > div:last-child { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
};

/* ═══════════════════════════════════════════
   MOBILE TEASER
═══════════════════════════════════════════ */
export const MobileTeaser = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current.children, {
      scrollTrigger: { trigger: ref.current, start: "top 80%" },
      y: 32, duration: 0.8, stagger: 0.2, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  return (
    <section id="mobile" style={{ background: "linear-gradient(180deg, transparent, rgba(139,92,246,0.04) 50%, transparent)" }}>
      <div className="section-inner">
        <div ref={ref} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6rem", alignItems: "center" }}>
          {/* Image */}
          <div style={{ position: "relative", display: "flex", justifyContent: "center" }}>
            <div className="float" style={{ position: "relative", maxWidth: 280 }}>
              <Image
                src="/mobile-preview.png"
                alt="Servera iOS App Preview"
                width={400}
                height={640}
                style={{ width: "100%", height: "auto", borderRadius: 40, border: "8px solid rgba(255,255,255,0.08)", boxShadow: "0 32px 80px rgba(0,0,0,0.6)" }}
              />
              {/* SOON badge */}
              <div style={{
                position: "absolute", top: "12%", right: "-10%",
                background: "linear-gradient(135deg, var(--violet), var(--cyan))",
                color: "white", padding: "0.6rem 1.25rem",
                borderRadius: 100, fontWeight: 800, fontSize: "0.78rem",
                transform: "rotate(12deg)",
                boxShadow: "0 8px 24px var(--violet-glow)",
                letterSpacing: "0.06em",
              }}>
                LIVE SOON
              </div>
            </div>
          </div>

          {/* Text */}
          <div>
            <div className="section-tag">Q3 Roadmap</div>
            <h2 style={{ fontSize: "clamp(2rem, 3.5vw, 3.5rem)", marginBottom: "1.5rem" }}>
              Your infrastructure,<br />
              <span className="gradient-text">in your pocket.</span>
            </h2>
            <p style={{ fontSize: "1.1rem", color: "var(--text-2)", lineHeight: 1.7, marginBottom: "3rem", maxWidth: 480 }}>
              The Servera mobile app brings the same power to iOS.
              Real-time server metrics, terminal access, and emergency controls — natively on iPhone and iPad.
            </p>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.25rem" }}>
              {[
                { icon: <Zap size={17} color="var(--violet-2)" />, title: "100% Native",      desc: "No slow wrappers. Pure performance.",      bg: "var(--violet-sub)" },
                { icon: <Shield size={17} color="var(--cyan)" />,  title: "Face ID Gate",     desc: "Biometric auth for full cluster access.",  bg: "var(--cyan-sub)"   },
                { icon: <Monitor size={17} color="var(--amber)" />,title: "Emergency Ops",    desc: "One-tap rollback and service restart.",     bg: "var(--amber-sub)"  },
                { icon: <Globe size={17} color="var(--emerald)" />, title: "Always in Sync",  desc: "Real-time metrics, everywhere you go.",     bg: "var(--emerald-sub)"},
              ].map(({ icon, title, desc, bg }, i) => (
                <div key={i} className="glass card" style={{ padding: "1.5rem", borderRadius: 16 }}>
                  <div style={{ background: bg, width: 36, height: 36, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: "0.85rem" }}>
                    {icon}
                  </div>
                  <h4 style={{ fontSize: "0.95rem", marginBottom: "0.35rem" }}>{title}</h4>
                  <p style={{ fontSize: "0.8rem", color: "var(--text-3)", lineHeight: 1.5 }}>{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 900px) {
          #mobile .section-inner > div { grid-template-columns: 1fr !important; gap: 3rem !important; }
        }
      `}</style>
    </section>
  );
};

/* ═══════════════════════════════════════════
   DOWNLOAD CTA
═══════════════════════════════════════════ */
export const DownloadCTA = () => {
  const ref = useRef(null);

  useEffect(() => {
    gsap.from(ref.current, {
      scrollTrigger: { trigger: ref.current, start: "top 85%" },
      y: 40, duration: 0.9, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  return (
    <section id="download">
      <div className="section-inner">
        <div
          ref={ref}
          className="glass-strong"
          style={{
            borderRadius: 32,
            padding: "5.5rem 4rem",
            textAlign: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          {/* Glow */}
          <div className="orb glow-pulse" style={{ width: 500, height: 500, background: "var(--violet-glow)", opacity: 0.25, bottom: "-30%", right: "-5%", zIndex: 0 }} />
          <div className="orb" style={{ width: 300, height: 300, background: "var(--cyan-glow)", opacity: 0.12, top: "-20%", left: "10%", zIndex: 0 }} />

          <div style={{ position: "relative", zIndex: 1 }}>
            <div className="badge badge-g" style={{ marginBottom: "1.5rem" }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--emerald)", display: "inline-block" }} />
              v0.1.0 Stable
            </div>

            <h2 style={{ fontSize: "clamp(2.5rem, 5vw, 4.5rem)", marginBottom: "1.25rem", letterSpacing: "-0.045em" }}>
              Power up your<br />
              <span className="gradient-text">workflow today.</span>
            </h2>

            <p style={{ fontSize: "1.15rem", color: "var(--text-2)", maxWidth: 580, margin: "0 auto 3.5rem", lineHeight: 1.7 }}>
              Join engineers who&apos;ve replaced their messy terminal setups with Servera.
              Free to download. No account required.
            </p>

            <div style={{ display: "flex", gap: "1.25rem", justifyContent: "center", flexWrap: "wrap", marginBottom: "2.5rem" }}>
              <a href="/downloads/Servera.exe" download className="btn btn-download btn-lg">
                <Monitor size={19} /> Download for Windows
              </a>
              <Link href="/download" className="btn btn-ghost btn-lg">
                All Downloads <ChevronRight size={17} />
              </Link>
            </div>

            <p className="mono" style={{ fontSize: "0.75rem", color: "var(--text-3)" }}>
              Windows · macOS · Linux · x64 · Free
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ═══════════════════════════════════════════
   FOOTER
═══════════════════════════════════════════ */
export const Footer = () => {
  return (
    <footer style={{ borderTop: "1px solid var(--b0)", padding: "3.5rem 4rem", position: "relative", zIndex: 1 }}>
      <div className="section-inner" style={{ display: "grid", gridTemplateColumns: "1fr auto", alignItems: "center", gap: "2rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          <div style={{ background: "linear-gradient(135deg, var(--violet) 0%, #5b21b6 100%)", width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <Server size={14} color="white" />
          </div>
          <span style={{ fontFamily: "var(--ffd)", fontWeight: 700, fontSize: "1rem", letterSpacing: "-0.03em" }}>Servera</span>
          <span style={{ color: "var(--text-3)", fontSize: "0.8rem", marginLeft: "0.5rem" }} suppressHydrationWarning>
            © {new Date().getFullYear()} Servera Intelligence
          </span>
        </div>

        <div style={{ display: "flex", gap: "2rem", flexWrap: "wrap" }}>
          {[
            { label: "Privacy Policy",   href: "#" },
            { label: "Terms of Service", href: "#" },
            { label: "Contact Support",  href: "#" },
          ].map(({ label, href }) => (
            <a key={label} href={href} className="link-hover"
              style={{ fontSize: "0.82rem", color: "var(--text-3)", fontWeight: 500 }}>
              {label}
            </a>
          ))}
        </div>
      </div>

      <style>{`
        @media (max-width: 640px) {
          footer > div { grid-template-columns: 1fr !important; text-align: center; }
          footer > div > div:last-child { justify-content: center; }
        }
      `}</style>
    </footer>
  );
};
