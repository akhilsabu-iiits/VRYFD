"use client";

import React from "react";
import type { VEvent } from "../lib/vryfd";

interface DashboardProps {
  events: VEvent[];
  userCheckins: number;
  userBadges: number[];
  deployedEventIds: Record<number, number>;
  isConnected: boolean;
  vryfBalance: number;
  onOpenEvent: (id: number) => void;
}

const AVATAR_COLORS = ["#7c6cf0", "#34d399", "#fbbf24", "#f87171", "#60a5fa"];

function getTierLabel(checkins: number): { label: string; color: string; bg: string; next: number } {
  if (checkins >= 20) return { label: "Gold", color: "#fbbf24", bg: "rgba(251,191,36,0.12)", next: 20 };
  if (checkins >= 10) return { label: "Silver", color: "#94a3b8", bg: "rgba(148,163,184,0.12)", next: 20 };
  if (checkins >= 5)  return { label: "Bronze", color: "#d97706", bg: "rgba(217,119,6,0.12)", next: 10 };
  return { label: "New", color: "var(--accent2)", bg: "rgba(124,108,240,0.1)", next: 5 };
}

function getMilestoneProgress(checkins: number): { pct: number; label: string } {
  if (checkins >= 20) return { pct: 100, label: "Max tier reached" };
  if (checkins >= 10) return { pct: Math.round(((checkins - 10) / 10) * 100), label: `${20 - checkins} to Gold` };
  if (checkins >= 5)  return { pct: Math.round(((checkins - 5) / 5) * 100), label: `${10 - checkins} to Silver` };
  return { pct: Math.round((checkins / 5) * 100), label: `${5 - checkins} to Bronze` };
}

export default function Dashboard({ events, userCheckins, userBadges, deployedEventIds, isConnected, vryfBalance, onOpenEvent }: DashboardProps) {
  const activeCount = events.filter((e) => e.status === "live").length;
  const upcomingCount = events.filter((e) => e.status === "upcoming").length;
  const tier = isConnected ? getTierLabel(userCheckins) : null;
  const progress = isConnected ? getMilestoneProgress(userCheckins) : null;
  const liveEvents = events.filter((e) => e.status === "live");
  const otherEvents = events.filter((e) => e.status !== "live");

  return (
    <>
      {/* Hero */}
      <div className="hero fade-up">
        <div className="hero-badge">&#9671; SEPOLIA NETWORK</div>
        <h1>
          Attendance,<br />
          <span className="gradient">verified on-chain</span>
        </h1>
        <p>Check in with your ENS identity. Earn soulbound POAPs. Unlock milestone rewards. Get verifiable certificates.</p>
      </div>

      {/* ── Top stat row: Check-ins + VRYF ── */}
      <div className="fade-up delay-1" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", margin: "2rem 0 0" }}>

        {/* Check-ins card */}
        <div className="card" style={{ padding: "1.5rem", position: "relative", overflow: "hidden" }}>
          <div className="card-glow" style={{ background: "radial-gradient(circle at 0% 0%, rgba(52,211,153,0.08), transparent 70%)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>Your Check-ins</div>
              <div style={{ fontFamily: "var(--font-space-mono),'Space Mono',monospace", fontSize: "42px", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>
                {isConnected ? userCheckins : "—"}
              </div>
            </div>
            <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(52,211,153,0.12)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px", color: "var(--green)", flexShrink: 0 }}>
              ✓
            </div>
          </div>
          {isConnected && progress && (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                <span style={{ fontSize: "11px", color: "var(--text3)" }}>{progress.label}</span>
                <span style={{ fontSize: "11px", color: "var(--green)", fontWeight: 600 }}>{progress.pct}%</span>
              </div>
              <div style={{ height: "4px", background: "var(--bg4)", borderRadius: "2px", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${progress.pct}%`, background: "linear-gradient(90deg, var(--accent), var(--green))", borderRadius: "2px", transition: "width 0.6s ease" }} />
              </div>
            </>
          )}
          {!isConnected && (
            <div style={{ fontSize: "12px", color: "var(--text3)" }}>Connect wallet to track progress</div>
          )}
        </div>

        {/* VRYF Token card */}
        <div className="card" style={{ padding: "1.5rem", position: "relative", overflow: "hidden", background: "linear-gradient(135deg, rgba(124,108,240,0.08) 0%, rgba(18,18,31,1) 60%)" }}>
          <div className="card-glow" style={{ background: "radial-gradient(circle at 100% 0%, rgba(124,108,240,0.12), transparent 70%)" }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "1rem" }}>
            <div>
              <div style={{ fontSize: "12px", color: "var(--text3)", textTransform: "uppercase", letterSpacing: "1px", marginBottom: "4px" }}>VRYF Balance</div>
              <div style={{ fontFamily: "var(--font-space-mono),'Space Mono',monospace", fontSize: "42px", fontWeight: 700, background: "linear-gradient(135deg, var(--accent2), var(--green))", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>
                {isConnected ? vryfBalance : "—"}
              </div>
            </div>
            <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "rgba(124,108,240,0.15)", border: "1px solid rgba(124,108,240,0.25)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", flexShrink: 0 }}>
              ⬡
            </div>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
            {["+10 check-in", "+25 badge", "+100 bronze"].map((tip) => (
              <span key={tip} style={{ fontSize: "10px", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--accent2)", background: "rgba(124,108,240,0.08)", border: "1px solid rgba(124,108,240,0.15)", borderRadius: "4px", padding: "2px 7px" }}>
                {tip}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom stat row: Events / Badges / Tier ── */}
      <div className="fade-up delay-1" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "16px", margin: "16px 0 0" }}>

        {/* Active Events */}
        <div className="card stat-card" style={{ padding: "1.25rem" }}>
          <div className="stat-icon" style={{ background: "rgba(124,108,240,0.12)", color: "var(--accent2)", marginBottom: "10px" }}>⊞</div>
          <div className="stat-value" style={{ fontSize: "28px" }}>{activeCount}</div>
          <div className="stat-label">Active Events</div>
          {upcomingCount > 0 && (
            <div style={{ fontSize: "10px", color: "var(--amber)", marginTop: "4px", fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
              +{upcomingCount} upcoming
            </div>
          )}
        </div>

        {/* Badges */}
        <div className="card stat-card" style={{ padding: "1.25rem" }}>
          <div className="stat-icon" style={{ background: "rgba(251,191,36,0.12)", color: "var(--amber)", marginBottom: "10px" }}>★</div>
          <div className="stat-value" style={{ fontSize: "28px" }}>{isConnected ? userBadges.length : "—"}</div>
          <div className="stat-label">Badges Earned</div>
          {isConnected && userBadges.length > 0 && (
            <div style={{ fontSize: "10px", color: "var(--text3)", marginTop: "4px" }}>soulbound NFTs</div>
          )}
        </div>

        {/* Tier */}
        <div className="card stat-card" style={{ padding: "1.25rem" }}>
          <div className="stat-icon" style={{ background: "rgba(248,113,113,0.12)", color: "var(--coral)", marginBottom: "10px" }}>◆</div>
          {isConnected && tier ? (
            <>
              <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", padding: "4px 14px", borderRadius: "50px", background: tier.bg, color: tier.color, fontFamily: "var(--font-space-mono),'Space Mono',monospace", fontSize: "14px", fontWeight: 700, marginBottom: "4px" }}>
                {tier.label}
              </div>
              <div className="stat-label">Your Tier</div>
            </>
          ) : (
            <>
              <div className="stat-value" style={{ fontSize: "28px" }}>—</div>
              <div className="stat-label">Your Tier</div>
            </>
          )}
        </div>
      </div>

      {/* ── Live Events ── */}
      {liveEvents.length > 0 && (
        <>
          <div className="section-header fade-up delay-2" style={{ marginTop: "2.5rem" }}>
            <span className="section-title">
              <span style={{ display: "inline-block", width: "8px", height: "8px", borderRadius: "50%", background: "var(--green)", boxShadow: "0 0 8px var(--green)", marginRight: "8px", animation: "pulse 1.5s infinite" }} />
              Live Now
            </span>
            <span className="section-sub">{liveEvents.length} event{liveEvents.length > 1 ? "s" : ""} happening</span>
          </div>
          <div className="grid grid-2 fade-up delay-2">
            {liveEvents.map((ev) => {
              const avCount = Math.min(ev.attendees, 4);
              return (
                <button key={ev.id} type="button" className="card event-card" onClick={() => onOpenEvent(ev.id)}>
                  <div className="card-glow" style={{ background: `radial-gradient(circle at 50% 0%,${ev.color}15,transparent 70%)` }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div className="event-status live">LIVE NOW</div>
                    {ev.id in deployedEventIds && (
                      <span style={{ fontSize: "11px", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--green)", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: "50px", padding: "2px 8px" }}>
                        #{deployedEventIds[ev.id]}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                    <div style={{ fontSize: "28px", lineHeight: 1 }}>{ev.emoji}</div>
                    <div className="event-name" style={{ margin: 0 }}>{ev.name}</div>
                  </div>
                  <div className="event-meta" style={{ marginBottom: "14px" }}>{ev.date}</div>
                  <div style={{ height: "1px", background: "var(--border)", marginBottom: "14px" }} />
                  <div className="event-attendees">
                    {ev.attendees > 0 ? (
                      <>
                        <div className="avatar-stack">
                          {Array.from({ length: avCount }, (_, i) => (
                            <div key={i} className="av" style={{ background: AVATAR_COLORS[i % 5], color: "#fff" }}>
                              {String.fromCharCode(65 + i)}
                            </div>
                          ))}
                        </div>
                        <span>{ev.attendees} checked in</span>
                      </>
                    ) : (
                      <span>Be the first to check in</span>
                    )}
                    <span style={{ marginLeft: "auto", fontSize: "11px", color: "var(--accent2)", fontWeight: 600 }}>Check in →</span>
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* ── Other Events ── */}
      {otherEvents.length > 0 && (
        <>
          <div className="section-header fade-up delay-3" style={{ marginTop: "2rem" }}>
            <span className="section-title">All Events</span>
            <span className="section-sub">{events.length} total</span>
          </div>
          <div className="grid grid-2 fade-up delay-3">
            {otherEvents.map((ev) => {
              const avCount = Math.min(ev.attendees, 4);
              return (
                <button key={ev.id} type="button" className="card event-card" onClick={() => onOpenEvent(ev.id)}>
                  <div className="card-glow" style={{ background: `radial-gradient(circle at 50% 0%,${ev.color}11,transparent 70%)` }} />
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div className={`event-status ${ev.status}`}>
                      {ev.status === "upcoming" ? "UPCOMING" : "ENDED"}
                    </div>
                    {ev.id in deployedEventIds && (
                      <span style={{ fontSize: "11px", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--green)", background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)", borderRadius: "50px", padding: "2px 8px" }}>
                        #{deployedEventIds[ev.id]}
                      </span>
                    )}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                    <div style={{ fontSize: "28px", lineHeight: 1 }}>{ev.emoji}</div>
                    <div className="event-name" style={{ margin: 0 }}>{ev.name}</div>
                  </div>
                  <div className="event-meta" style={{ marginBottom: "14px" }}>{ev.date}</div>
                  <div style={{ height: "1px", background: "var(--border)", marginBottom: "14px" }} />
                  <div className="event-attendees">
                    {ev.attendees > 0 ? (
                      <>
                        <div className="avatar-stack">
                          {Array.from({ length: avCount }, (_, i) => (
                            <div key={i} className="av" style={{ background: AVATAR_COLORS[i % 5], color: "#fff" }}>
                              {String.fromCharCode(65 + i)}
                            </div>
                          ))}
                        </div>
                        <span>{ev.attendees} checked in</span>
                      </>
                    ) : (
                      <span style={{ color: "var(--text3)" }}>No check-ins yet</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </>
      )}

      {/* Empty state */}
      {events.length === 0 && (
        <div className="fade-up delay-2" style={{ textAlign: "center", padding: "4rem 1rem", color: "var(--text3)" }}>
          <div style={{ fontSize: "2.5rem", marginBottom: "1rem" }}>◇</div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "var(--text2)", marginBottom: "0.5rem" }}>No events yet</div>
          <div style={{ fontSize: "13px" }}>Events will appear here once organizers deploy them on-chain.</div>
        </div>
      )}
    </>
  );
}
