"use client";

import React from "react";
import type { LBEntry } from "../lib/vryfd";

interface LeaderboardPageProps {
  leaderboard: LBEntry[];
  userENS: string;
  userAddr: string;
  isConnected: boolean;
}

const ROW_COLORS = [
  ["#7c6cf0","#5b4cc4"],["#34d399","#065f46"],["#fbbf24","#78350f"],
  ["#f87171","#991b1b"],["#60a5fa","#1d4ed8"],["#a78bfa","#6d28d9"],
  ["#fb923c","#c2410c"],["#38bdf8","#0369a1"],["#e879f9","#a21caf"],["#4ade80","#15803d"],
];

const TIER_CLASSES: Record<string, string> = {
  "Gold Legend": "tier-gold",
  "Silver Pioneer": "tier-silver",
  "Bronze Explorer": "tier-bronze",
};

export default function LeaderboardPage({ leaderboard, userENS, userAddr, isConnected }: LeaderboardPageProps) {
  const sorted = [...leaderboard].sort((a, b) => b.count - a.count);

  return (
    <>
      <div className="section-header fade-up">
        <span className="section-title">Attendance Leaderboard</span>
        <span className="section-sub">Top ENS holders by check-ins</span>
      </div>
      <div className="card fade-up delay-1" style={{ padding: 0, overflow: "hidden" }}>
        {sorted.map((entry, i) => {
          const rank = i + 1;
          const rankClass = rank === 1 ? "lb-rank gold" : rank === 2 ? "lb-rank silver" : rank === 3 ? "lb-rank bronze" : "lb-rank";
          const tierClass = TIER_CLASSES[entry.tier] || "tier-new";
          const isMe = (userENS && entry.ens === userENS) || (userAddr && entry.addr === userAddr);
          const [bg, fg] = ROW_COLORS[i % ROW_COLORS.length];

          return (
            <div
              key={entry.ens}
              className="lb-row"
              style={isMe ? { background: "rgba(124,108,240,0.05)" } : {}}
            >
              <div className={rankClass}>#{rank}</div>
              <div
                className="user-avatar"
                style={{
                  width: "36px",
                  height: "36px",
                  fontSize: "13px",
                  background: `linear-gradient(135deg,${bg},${fg})`,
                  color: "#fff",
                  flexShrink: 0,
                }}
              >
                {entry.ens.slice(0, 2).toUpperCase()}
              </div>
              <div className="lb-info">
                <div className="lb-name">
                  {entry.ens}{isMe ? " (you)" : ""}
                </div>
                <div className="lb-count">
                  {entry.count} events ·{" "}
                  <span style={{ fontFamily: "'Space Mono',monospace", fontSize: "10px", color: "var(--text3)" }}>
                    {entry.addr}
                  </span>
                </div>
              </div>
              <div className={`lb-tier ${tierClass}`}>{entry.tier}</div>
            </div>
          );
        })}
      </div>
    </>
  );
}
