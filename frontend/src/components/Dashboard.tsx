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

function getTierLabel(checkins: number): string {
  if (checkins >= 20) return "Gold";
  if (checkins >= 10) return "Silver";
  if (checkins >= 5) return "Bronze";
  return "—";
}

export default function Dashboard({ events, userCheckins, userBadges, deployedEventIds, isConnected, vryfBalance, onOpenEvent }: DashboardProps) {
  const activeCount = events.filter((e) => e.status === "live").length;
  const tier = isConnected ? getTierLabel(userCheckins) : "—";

  return (
    <>
      {/* Stat cards */}
      <div className="grid grid-4 fade-up">
        <div className="card stat-card">
          <div className="stat-icon" style={{ background: "rgba(124,108,240,0.12)", color: "var(--accent2)" }}>&#9877;</div>
          <div className="stat-value">{activeCount}</div>
          <div className="stat-label">Active Events</div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon" style={{ background: "rgba(52,211,153,0.12)", color: "var(--green)" }}>&#10003;</div>
          <div className="stat-value">{isConnected ? userCheckins : "—"}</div>
          <div className="stat-label">Your Check-ins</div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon" style={{ background: "rgba(251,191,36,0.12)", color: "var(--amber)" }}>&#9733;</div>
          <div className="stat-value">{isConnected ? userBadges.length : "—"}</div>
          <div className="stat-label">Badges Earned</div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon" style={{ background: "rgba(248,113,113,0.12)", color: "var(--coral)" }}>&#9830;</div>
          <div className="stat-value">{tier}</div>
          <div className="stat-label">Your Tier</div>
        </div>
        <div className="card stat-card">
          <div className="stat-icon stat-icon-vryf">&#11041;</div>
          <div className="stat-value">{isConnected ? vryfBalance : "—"}</div>
          <div className="stat-label">VRYF Tokens</div>
        </div>
      </div>

      {/* Events grid */}
      <div className="section-header fade-up delay-2">
        <span className="section-title">Live &amp; Upcoming Events</span>
      </div>
      <div className="grid grid-2 fade-up delay-2">
        {events.map((ev) => {
          const avCount = Math.min(ev.attendees, 4);
          return (
            <button
              key={ev.id}
              type="button"
              className="card event-card"
              onClick={() => onOpenEvent(ev.id)}
            >
              <div
                className="card-glow"
                style={{ background: `radial-gradient(circle at 50% 0%,${ev.color}11,transparent 70%)` }}
              />
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div className={`event-status ${ev.status}`}>
                  {ev.status === "live" ? "LIVE NOW" : ev.status === "upcoming" ? "UPCOMING" : "ENDED"}
                </div>
                {ev.id in deployedEventIds && (
                  <span style={{
                    fontSize: "11px", fontFamily: "var(--font-space-mono),'Space Mono',monospace",
                    color: "var(--green)", background: "rgba(52,211,153,0.1)",
                    border: "1px solid rgba(52,211,153,0.2)", borderRadius: "50px",
                    padding: "2px 8px",
                  }}>
                    #{deployedEventIds[ev.id]}
                  </span>
                )}
              </div>
              <div className="event-name">{ev.emoji} {ev.name}</div>
              <div className="event-meta">{ev.date}</div>
              <div className="event-attendees">
                {ev.attendees > 0 ? (
                  <>
                    <div className="avatar-stack">
                      {Array.from({ length: avCount }, (_, i) => (
                        <div
                          key={i}
                          className="av"
                          style={{ background: AVATAR_COLORS[i % 5], color: "#fff" }}
                        >
                          {String.fromCharCode(65 + i)}
                        </div>
                      ))}
                    </div>
                    <span>{ev.attendees} checked in</span>
                  </>
                ) : (
                  <span>Be the first to check in</span>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
