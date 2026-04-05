"use client";

import React from "react";
import type { VEvent } from "../lib/vryfd";

interface BadgesPageProps {
  events: VEvent[];
  userCheckins: number;
  userBadges: number[];
}

export default function BadgesPage({ events, userCheckins, userBadges }: BadgesPageProps) {
  return (
    <>
      {/* POAP Badges */}
      <div className="section-header fade-up">
        <span className="section-title">Your POAP Badges</span>
        <span className="section-sub">Soulbound · Non-transferable</span>
      </div>
      <div className="grid grid-3 fade-up delay-1">
        {userBadges.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem", gridColumn: "1/-1" }}>
            <p style={{ color: "var(--text3)" }}>No badges yet. Check in to events to earn POAP badges.</p>
          </div>
        ) : (
          userBadges.map((id) => {
            const ev = events.find((e) => e.id === id);
            if (!ev) return null;
            return (
              <div key={id} className="card badge">
                <div
                  className="badge-icon"
                  style={{ background: `linear-gradient(135deg,${ev.color},${ev.color}88)` }}
                >
                  {ev.emoji}
                </div>
                <div className="badge-name">{ev.name}</div>
                <div className="badge-date">{ev.date}</div>
                <div className="badge-soulbound">SOULBOUND</div>
              </div>
            );
          })
        )}
      </div>

      {/* Milestones */}
      <div className="section-header fade-up delay-2" style={{ marginTop: "2rem" }}>
        <span className="section-title">Milestone Rewards</span>
      </div>
      <div className="grid grid-3 fade-up delay-3">
        {/* Bronze */}
        <div className="card badge">
          <div className="badge-icon" style={{ background: "linear-gradient(135deg,#d97706,#fbbf24)" }}>🏆</div>
          <div className="badge-name">Bronze Explorer</div>
          <div className="badge-date">5 events required</div>
          <div style={{ marginTop: "8px", width: "100%" }}>
            <div style={{ background: "var(--bg3)", borderRadius: "50px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                borderRadius: "50px",
                background: "linear-gradient(90deg,var(--amber),var(--green))",
                width: `${Math.min(userCheckins / 5 * 100, 100)}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>
              {Math.min(userCheckins, 5)}/5
            </div>
          </div>
        </div>

        {/* Silver */}
        <div className="card badge">
          <div className="badge-icon" style={{ background: "linear-gradient(135deg,#64748b,#cbd5e1)" }}>🌟</div>
          <div className="badge-name">Silver Pioneer</div>
          <div className="badge-date">10 events required</div>
          <div style={{ marginTop: "8px", width: "100%" }}>
            <div style={{ background: "var(--bg3)", borderRadius: "50px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                borderRadius: "50px",
                background: "linear-gradient(90deg,#64748b,#cbd5e1)",
                width: `${Math.min(userCheckins / 10 * 100, 100)}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>
              {Math.min(userCheckins, 10)}/10
            </div>
          </div>
        </div>

        {/* Gold */}
        <div className="card badge">
          <div className="badge-icon" style={{ background: "linear-gradient(135deg,var(--accent3),var(--accent2))" }}>👑</div>
          <div className="badge-name">Gold Legend</div>
          <div className="badge-date">20 events required</div>
          <div style={{ marginTop: "8px", width: "100%" }}>
            <div style={{ background: "var(--bg3)", borderRadius: "50px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%",
                borderRadius: "50px",
                background: "linear-gradient(90deg,var(--accent3),var(--accent2))",
                width: `${Math.min(userCheckins / 20 * 100, 100)}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>
              {Math.min(userCheckins, 20)}/20
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
