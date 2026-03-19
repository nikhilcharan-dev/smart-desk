"use client";
import { Navbar, Footer } from "../components";
import {
  ArrowLeft, MessageSquare, AlertTriangle, MessagesSquare,
  Star, Send, ChevronDown, Filter, User, Clock, ThumbsUp,
  BarChart2
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useCallback } from "react";
import gsap from "gsap";

const TYPES = [
  { value: "feedback",   label: "Feedback",   icon: <ThumbsUp size={14} />,       color: "var(--emerald)",  bg: "var(--emerald-sub)" },
  { value: "complaint",  label: "Complaint",  icon: <AlertTriangle size={14} />,   color: "var(--rose)",     bg: "var(--rose-sub)"    },
  { value: "discussion", label: "Discussion", icon: <MessagesSquare size={14} />,  color: "var(--cyan-2)",   bg: "var(--cyan-sub)"    },
];

/* ────────────────────────────────
   Star rating input
──────────────────────────────── */
function StarRating({ value, onChange, size = 22, readonly = false }) {
  const [hover, setHover] = useState(0);
  return (
    <div style={{ display: "inline-flex", gap: "0.25rem" }}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          onClick={() => !readonly && onChange?.(star)}
          onMouseEnter={() => !readonly && setHover(star)}
          onMouseLeave={() => !readonly && setHover(0)}
          style={{
            background: "none", border: "none", cursor: readonly ? "default" : "pointer",
            padding: 2, transition: "transform 0.15s",
            transform: !readonly && hover === star ? "scale(1.2)" : "scale(1)",
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
   Rating bar (horizontal fill)
──────────────────────────────── */
function RatingBar({ star, count, max }) {
  const pct = max > 0 ? (count / max) * 100 : 0;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", fontSize: "0.82rem" }}>
      <span style={{ width: 16, textAlign: "right", color: "var(--text-3)", fontWeight: 600 }}>{star}</span>
      <Star size={12} fill="#f59e0b" color="#f59e0b" />
      <div style={{ flex: 1, height: 8, background: "var(--s1)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "linear-gradient(90deg, var(--amber), #fbbf24)", borderRadius: 4, transition: "width 0.6s ease" }} />
      </div>
      <span className="mono" style={{ width: 32, textAlign: "right", fontSize: "0.75rem", color: "var(--text-3)" }}>{count}</span>
    </div>
  );
}

/* ────────────────────────────────
   Time ago helper
──────────────────────────────── */
function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

/* ────────────────────────────────
   Main feedback page
──────────────────────────────── */
export default function FeedbackPage() {
  const pageRef = useRef(null);
  const [entries, setEntries] = useState([]);
  const [stats, setStats] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  // form state
  const [form, setForm] = useState({ name: "", email: "", type: "feedback", rating: 0, message: "" });
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const fetchFeedback = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: String(page), limit: "15" });
      if (filterType) params.set("type", filterType);
      const res = await fetch(`/api/feedback?${params}`);
      if (res.ok) {
        const data = await res.json();
        setEntries(data.entries);
        setTotal(data.total);
        setStats(data.stats);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, [page, filterType]);

  useEffect(() => {
    fetchFeedback();
  }, [fetchFeedback]);

  useEffect(() => {
    gsap.from(pageRef.current.children, {
      y: 24, duration: 0.65, stagger: 0.12, ease: "power3.out", clearProps: "transform"
    });
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.message.trim()) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (res.ok) {
        setSubmitted(true);
        setForm({ name: "", email: "", type: "feedback", rating: 0, message: "" });
        setTimeout(() => setSubmitted(false), 4000);
        // re-fetch
        setPage(1);
        setTimeout(fetchFeedback, 300);
      }
    } catch { /* silent */ }
    setSubmitting(false);
  };

  const typeMeta = (t) => TYPES.find((x) => x.value === t) || TYPES[0];

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text)", position: "relative" }}>
      {/* Orbs */}
      <div style={{ position: "absolute", width: "50vw", height: "50vw", borderRadius: "50%", background: "var(--violet-glow)", filter: "blur(130px)", opacity: 0.15, top: "-10%", right: "-15%", pointerEvents: "none", zIndex: 0 }} />
      <div style={{ position: "absolute", width: "30vw", height: "30vw", borderRadius: "50%", background: "var(--cyan-glow)", filter: "blur(100px)", opacity: 0.1, bottom: "10%", left: "-10%", pointerEvents: "none", zIndex: 0 }} />

      <Navbar />

      <section style={{ paddingTop: "12rem", paddingBottom: "8rem", position: "relative", zIndex: 1 }}>
        <div className="section-inner" ref={pageRef}>

          {/* Back */}
          <Link href="/"
            style={{ display: "inline-flex", alignItems: "center", gap: "0.6rem", marginBottom: "3.5rem", color: "var(--violet-2)", fontWeight: 600, fontSize: "0.85rem", opacity: 0.85 }}
            className="link-hover"
          >
            <ArrowLeft size={16} /> Back to Home
          </Link>

          {/* Header */}
          <div style={{ marginBottom: "4rem" }}>
            <div className="section-tag">Community</div>
            <h1 style={{ fontSize: "clamp(2.8rem, 5vw, 4.5rem)", marginBottom: "1.25rem", letterSpacing: "-0.04em" }}>
              We&apos;re listening.<br />
              <span className="gradient-text">Share your voice.</span>
            </h1>
            <p style={{ fontSize: "1.15rem", color: "var(--text-2)", maxWidth: 640, lineHeight: 1.7 }}>
              Got feedback, a complaint, or just want to discuss something? Every message is read by the team.
            </p>
          </div>

          {/* ═══ Stats + Rating Overview ═══ */}
          {stats && stats.totalRatings > 0 && (
            <div className="glass" style={{ borderRadius: 20, padding: "2.5rem", marginBottom: "3rem", border: "1px solid rgba(139,92,246,0.12)" }}>
              <div style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "3rem", alignItems: "center" }}>
                {/* Big number */}
                <div style={{ textAlign: "center", minWidth: 140 }}>
                  <div style={{ fontFamily: "var(--ffd)", fontSize: "4rem", fontWeight: 900, lineHeight: 1, letterSpacing: "-0.05em" }}>
                    <span className="gradient-text">{stats.avgRating.toFixed(1)}</span>
                  </div>
                  <StarRating value={Math.round(stats.avgRating)} readonly size={18} />
                  <div style={{ fontSize: "0.75rem", color: "var(--text-3)", marginTop: "0.5rem" }}>
                    {stats.totalRatings} rating{stats.totalRatings !== 1 ? "s" : ""}
                  </div>
                </div>
                {/* Breakdown bars */}
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                  {[5, 4, 3, 2, 1].map((star) => (
                    <RatingBar
                      key={star}
                      star={star}
                      count={stats.ratingBreakdown[star] || 0}
                      max={stats.totalRatings}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2.5rem" }}>

            {/* ═══ LEFT — Submit Form ═══ */}
            <div>
              <div className="glass card" style={{ padding: "2.5rem", borderColor: "rgba(139,92,246,0.15)" }}>
                <h2 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>Submit Feedback</h2>
                <p style={{ color: "var(--text-3)", fontSize: "0.85rem", marginBottom: "2rem" }}>Your feedback helps us build a better Servera.</p>

                {submitted && (
                  <div style={{ background: "rgba(16,185,129,0.1)", border: "1px solid rgba(16,185,129,0.25)", borderRadius: 12, padding: "1rem 1.25rem", marginBottom: "1.5rem", display: "flex", alignItems: "center", gap: "0.6rem", color: "var(--emerald)", fontSize: "0.88rem", fontWeight: 600 }}>
                    <ThumbsUp size={16} /> Thank you! Your feedback has been submitted.
                  </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1.25rem" }}>
                  {/* Name + Email row */}
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem" }}>
                    <div>
                      <label style={labelStyle}>Name <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
                      <input
                        type="text"
                        placeholder="Your name"
                        value={form.name}
                        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                    <div>
                      <label style={labelStyle}>Email <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
                      <input
                        type="email"
                        placeholder="your@email.com"
                        value={form.email}
                        onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                        style={inputStyle}
                      />
                    </div>
                  </div>

                  {/* Type selector */}
                  <div>
                    <label style={labelStyle}>Type</label>
                    <div style={{ display: "flex", gap: "0.6rem" }}>
                      {TYPES.map((t) => (
                        <button
                          key={t.value}
                          type="button"
                          onClick={() => setForm((f) => ({ ...f, type: t.value }))}
                          style={{
                            flex: 1, padding: "0.65rem 0.8rem", borderRadius: 10, border: "1px solid",
                            borderColor: form.type === t.value ? t.color : "var(--b0)",
                            background: form.type === t.value ? t.bg : "var(--s0)",
                            color: form.type === t.value ? t.color : "var(--text-3)",
                            fontSize: "0.82rem", fontWeight: 600, cursor: "pointer",
                            display: "flex", alignItems: "center", justifyContent: "center", gap: "0.4rem",
                            transition: "all 0.2s",
                          }}
                        >
                          {t.icon} {t.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Rating */}
                  <div>
                    <label style={labelStyle}>Rating <span style={{ color: "var(--text-3)", fontWeight: 400 }}>(optional)</span></label>
                    <StarRating value={form.rating} onChange={(v) => setForm((f) => ({ ...f, rating: v }))} />
                  </div>

                  {/* Message */}
                  <div>
                    <label style={labelStyle}>Message *</label>
                    <textarea
                      placeholder="Tell us what's on your mind..."
                      rows={5}
                      value={form.message}
                      onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                      required
                      style={{ ...inputStyle, resize: "vertical", minHeight: 120, lineHeight: 1.6 }}
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={submitting || !form.message.trim()}
                    className="btn btn-download"
                    style={{ width: "100%", padding: "1rem", fontSize: "1rem", opacity: submitting ? 0.6 : 1 }}
                  >
                    {submitting ? "Submitting..." : <><Send size={16} /> Submit Feedback</>}
                  </button>
                </form>
              </div>
            </div>

            {/* ═══ RIGHT — Feed ═══ */}
            <div>
              {/* Filter bar */}
              <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "1.5rem", flexWrap: "wrap" }}>
                <Filter size={14} color="var(--text-3)" />
                <button
                  onClick={() => { setFilterType(null); setPage(1); }}
                  style={filterBtn(filterType === null)}
                >
                  All
                </button>
                {TYPES.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => { setFilterType(t.value); setPage(1); }}
                    style={filterBtn(filterType === t.value, t.color)}
                  >
                    {t.icon} {t.label}
                  </button>
                ))}
                <span style={{ marginLeft: "auto", fontSize: "0.75rem", color: "var(--text-3)" }}>
                  {total} entr{total === 1 ? "y" : "ies"}
                </span>
              </div>

              {/* Entries */}
              {loading ? (
                <div style={{ textAlign: "center", padding: "4rem 0", color: "var(--text-3)" }}>Loading...</div>
              ) : entries.length === 0 ? (
                <div className="glass" style={{ borderRadius: 16, padding: "4rem 2rem", textAlign: "center" }}>
                  <MessageSquare size={40} color="var(--text-3)" style={{ margin: "0 auto 1rem" }} />
                  <p style={{ color: "var(--text-3)", fontSize: "0.95rem" }}>No feedback yet. Be the first!</p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  {entries.map((entry) => {
                    const meta = typeMeta(entry.type);
                    return (
                      <div key={entry.id} className="glass" style={{ borderRadius: 16, padding: "1.5rem 1.75rem", transition: "border-color 0.2s", borderColor: "var(--b0)" }}>
                        {/* Top row */}
                        <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", marginBottom: "0.75rem" }}>
                          <div style={{ width: 32, height: 32, borderRadius: "50%", background: "var(--s2)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                            <User size={14} color="var(--text-3)" />
                          </div>
                          <div style={{ flex: 1 }}>
                            <span style={{ fontWeight: 600, fontSize: "0.88rem" }}>{entry.name}</span>
                            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                              <span className={`badge`} style={{ fontSize: "0.65rem", padding: "0.15rem 0.55rem", background: meta.bg, color: meta.color, border: "none" }}>
                                {meta.icon} {meta.label}
                              </span>
                              {entry.platform && (
                                <span style={{ fontSize: "0.7rem", color: "var(--text-3)" }}>{entry.platform}</span>
                              )}
                            </div>
                          </div>
                          <span style={{ fontSize: "0.72rem", color: "var(--text-3)", display: "flex", alignItems: "center", gap: "0.3rem" }}>
                            <Clock size={11} /> {timeAgo(entry.createdAt)}
                          </span>
                        </div>

                        {/* Rating */}
                        {entry.rating && (
                          <div style={{ marginBottom: "0.6rem" }}>
                            <StarRating value={entry.rating} readonly size={14} />
                          </div>
                        )}

                        {/* Message */}
                        <p style={{ fontSize: "0.88rem", color: "var(--text-2)", lineHeight: 1.65, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                          {entry.message}
                        </p>
                      </div>
                    );
                  })}

                  {/* Pagination */}
                  {total > 15 && (
                    <div style={{ display: "flex", justifyContent: "center", gap: "0.75rem", marginTop: "1rem" }}>
                      <button
                        disabled={page <= 1}
                        onClick={() => setPage((p) => p - 1)}
                        className="btn btn-ghost"
                        style={{ padding: "0.5rem 1.2rem", fontSize: "0.82rem" }}
                      >
                        Previous
                      </button>
                      <span style={{ display: "flex", alignItems: "center", fontSize: "0.82rem", color: "var(--text-3)" }}>
                        Page {page} of {Math.ceil(total / 15)}
                      </span>
                      <button
                        disabled={page >= Math.ceil(total / 15)}
                        onClick={() => setPage((p) => p + 1)}
                        className="btn btn-ghost"
                        style={{ padding: "0.5rem 1.2rem", fontSize: "0.82rem" }}
                      >
                        Next
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

        </div>
      </section>

      <Footer />

      <style>{`
        @media (max-width: 900px) {
          .section-inner > div:last-of-type {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </main>
  );
}

/* ── Shared styles ── */
const labelStyle = {
  display: "block", fontSize: "0.78rem", fontWeight: 600,
  color: "var(--text-2)", marginBottom: "0.45rem", letterSpacing: "0.02em",
};

const inputStyle = {
  width: "100%", padding: "0.75rem 1rem", borderRadius: 10,
  background: "var(--s0)", border: "1px solid var(--b0)", color: "var(--text)",
  fontSize: "0.88rem", fontFamily: "var(--ff)", outline: "none",
  transition: "border-color 0.2s",
};

function filterBtn(active, color) {
  return {
    padding: "0.35rem 0.85rem", borderRadius: 8, border: "1px solid",
    borderColor: active ? (color || "var(--violet)") : "var(--b0)",
    background: active ? "var(--s2)" : "transparent",
    color: active ? (color || "var(--violet-2)") : "var(--text-3)",
    fontSize: "0.78rem", fontWeight: 600, cursor: "pointer",
    display: "inline-flex", alignItems: "center", gap: "0.35rem",
    transition: "all 0.2s",
  };
}
