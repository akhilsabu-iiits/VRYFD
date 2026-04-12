"use client";

import React from "react";
import type { VRYFEntry } from "../app/app/page";

interface VRYFPageProps {
  balance: number;
  onChainBalance: number | null;
  history: VRYFEntry[];
  isConnected: boolean;
}

const TYPE_LABEL: Record<VRYFEntry["type"], string> = {
  checkin:   "Check-in",
  badge:     "POAP Badge",
  milestone: "Milestone",
};

const TYPE_COLOR: Record<VRYFEntry["type"], string> = {
  checkin:   "#7c6cf0",
  badge:     "#34d399",
  milestone: "#fbbf24",
};

const TYPE_ICON: Record<VRYFEntry["type"], string> = {
  checkin:   "✅",
  badge:     "🎖️",
  milestone: "🏆",
};

function fmt(ts: number) {
  return new Date(ts * 1000).toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

export default function VRYFPage({ balance, onChainBalance, history, isConnected }: VRYFPageProps) {
  const totalCheckin   = history.filter((e) => e.type === "checkin").reduce((s, e) => s + e.amount, 0);
  const totalBadge     = history.filter((e) => e.type === "badge").reduce((s, e) => s + e.amount, 0);
  const totalMilestone = history.filter((e) => e.type === "milestone").reduce((s, e) => s + e.amount, 0);
  const totalEarned    = totalCheckin + totalBadge + totalMilestone;

  if (!isConnected) {
    return (
      <div className="fade-up">
        <div className="card" style={{ textAlign: "center", padding: "3rem 2rem" }}>
          <div style={{ fontSize: "3rem", marginBottom: "1rem" }}>🪙</div>
          <div className="event-name" style={{ marginBottom: "0.5rem" }}>VRYF Token History</div>
          <p className="text-muted">Connect your wallet to view your VRYF token balance and history.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="fade-up">
      {/* ── Balance Header ── */}
      <div className="card" style={{ padding: "2rem", marginBottom: "1.5rem" }}>
        <div className="vryf-balance-hd" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem" }}>
          <div>
            <div className="text-muted" style={{ fontSize: "0.85rem", marginBottom: "0.25rem", textTransform: "uppercase", letterSpacing: "0.05em" }}>Total VRYF Balance</div>
            <div style={{ fontSize: "3rem", fontWeight: 800, color: "#7c6cf0", lineHeight: 1 }}>
              {balance.toLocaleString()} <span style={{ fontSize: "1.2rem", fontWeight: 600, color: "var(--text-muted)" }}>VRYF</span>
            </div>
            {onChainBalance !== null && onChainBalance !== balance && (
              <div className="text-muted" style={{ fontSize: "0.78rem", marginTop: "0.35rem" }}>
                On-chain: {onChainBalance.toLocaleString()} VRYF
              </div>
            )}
          </div>
          <div style={{ fontSize: "3.5rem" }}>🪙</div>
        </div>
      </div>

      {/* ── Breakdown Stats ── */}
      <div className="vryf-stats-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "1rem", marginBottom: "1.5rem" }}>
        {(["checkin", "badge", "milestone"] as VRYFEntry["type"][]).map((type) => {
          const amount = type === "checkin" ? totalCheckin : type === "badge" ? totalBadge : totalMilestone;
          const count  = history.filter((e) => e.type === type).length;
          return (
            <div key={type} className="card" style={{ padding: "1.25rem", borderTop: `3px solid ${TYPE_COLOR[type]}` }}>
              <div style={{ fontSize: "1.5rem", marginBottom: "0.4rem" }}>{TYPE_ICON[type]}</div>
              <div style={{ fontSize: "1.5rem", fontWeight: 700, color: TYPE_COLOR[type] }}>{amount.toLocaleString()}</div>
              <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.15rem" }}>
                {TYPE_LABEL[type]} · {count} {count === 1 ? "time" : "times"}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── History Table ── */}
      <div className="card" style={{ padding: "1.5rem" }}>
        <div className="event-name org-card-title" style={{ marginBottom: "1rem" }}>
          📜 Earning History
          {totalEarned > 0 && (
            <span style={{ fontSize: "0.85rem", fontWeight: 500, color: "var(--text-muted)", marginLeft: "0.75rem" }}>
              {history.length} transaction{history.length !== 1 ? "s" : ""} · {totalEarned.toLocaleString()} VRYF earned
            </span>
          )}
        </div>

        {history.length === 0 ? (
          <p className="text-muted" style={{ textAlign: "center", padding: "2rem 0" }}>
            No VRYF earnings yet. Attend events to start earning!
          </p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="cert-history-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>Activity</th>
                  <th>Type</th>
                  <th style={{ textAlign: "right" }}>Amount</th>
                  <th>Date</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry, i) => (
                  <tr key={`${entry.timestamp}-${i}`}>
                    <td className="cert-history-name">
                      <span style={{ marginRight: "0.4rem" }}>{TYPE_ICON[entry.type]}</span>
                      {entry.label}
                    </td>
                    <td>
                      <span style={{
                        display: "inline-block", padding: "0.15rem 0.5rem", borderRadius: "999px",
                        fontSize: "0.75rem", fontWeight: 600,
                        background: `${TYPE_COLOR[entry.type]}22`, color: TYPE_COLOR[entry.type],
                      }}>
                        {TYPE_LABEL[entry.type]}
                      </span>
                    </td>
                    <td style={{ textAlign: "right", fontWeight: 700, color: "#34d399", whiteSpace: "nowrap" }}>
                      +{entry.amount.toLocaleString()} VRYF
                    </td>
                    <td className="org-attendee-time" style={{ whiteSpace: "nowrap" }}>{fmt(entry.timestamp)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
