"use client";

import React from "react";
import type { VEvent } from "../lib/vryfd";

interface EventsPageProps {
  events: VEvent[];
  currentEventId: number | null;
  checkinStep: number;
  isConnected: boolean;
  userBadges: number[];
  userAddress: string;
  userENS: string;
  deployedEventIds: Record<number, number>;
  onCheckin: () => Promise<void>;
}

const STEP_LABELS = ["Connect", "Sign", "Confirm", "Badge"];

export default function EventsPage({
  events,
  currentEventId,
  checkinStep,
  isConnected,
  userBadges,
  userAddress,
  userENS,
  deployedEventIds,
  onCheckin,
}: EventsPageProps) {
  const ev = currentEventId !== null ? events.find((e) => e.id === currentEventId) : null;
  const badgeClaimed = currentEventId !== null && userBadges.includes(currentEventId);

  const initials = userENS
    ? userENS.slice(0, 2).toUpperCase()
    : userAddress
    ? userAddress.slice(2, 4).toUpperCase()
    : "??";

  function getStepClass(stepNum: number) {
    if (stepNum < checkinStep) return "step done";
    if (stepNum === checkinStep) return "step current";
    return "step";
  }

  function getBtnLabel() {
    if (badgeClaimed) return "✓ Badge Claimed";
    if (!isConnected) return "Connect wallet first";
    if (checkinStep <= 1) return "Check In (Sign Message)";
    if (checkinStep === 2) return "Confirming on-chain...";
    if (checkinStep === 3) return "Claim POAP Badge";
    return "✓ Badge Claimed!";
  }

  function getBtnClass() {
    if (badgeClaimed || checkinStep === 4) return "btn btn-success btn-block";
    if (checkinStep === 3) return "btn btn-success btn-block";
    return "btn btn-primary btn-block";
  }

  const btnDisabled = !isConnected || badgeClaimed || checkinStep === 2 || checkinStep === 4;

  return (
    <div className="checkin-panel fade-up">
      <h2>{ev ? ev.name : "Select an event"}</h2>
      <div className="sub">
        {ev
          ? `${ev.date} · ${ev.status.toUpperCase()}`
          : "Go to Dashboard and click an event to check in"}
      </div>
      {ev && currentEventId !== null && currentEventId in deployedEventIds && (
        <div style={{
          display: "inline-flex", alignItems: "center", gap: "6px",
          margin: "8px 0", padding: "4px 14px", borderRadius: "50px", fontSize: "12px",
          background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.2)",
          color: "var(--green)", fontFamily: "var(--font-space-mono),'Space Mono',monospace",
        }}>
          ⛓ On-chain Event ID #{deployedEventIds[currentEventId]}
        </div>
      )}

      {/* User identity */}
      {isConnected && (
        <div className="user-identity">
          <div
            className="user-avatar"
            style={{ background: "linear-gradient(135deg,var(--accent),var(--green))", color: "#fff" }}
          >
            {initials}
          </div>
          <div>
            <div className="user-ens">{userENS || userAddress || "Connected"}</div>
            {userENS && <div className="user-addr">{userAddress}</div>}
          </div>
        </div>
      )}

      {/* Steps */}
      {ev && (
        <div className="steps">
          {STEP_LABELS.map((label, i) => {
            const num = i + 1;
            return (
              <div key={label} className={getStepClass(num)}>
                <div className="step-dot">
                  {num < checkinStep ? "✓" : num}
                </div>
                <div className="step-label">{label}</div>
                {i < STEP_LABELS.length - 1 && <div className="step-line" />}
              </div>
            );
          })}
        </div>
      )}

      {/* Action button */}
      <button
        type="button"
        className={getBtnClass()}
        disabled={btnDisabled}
        onClick={onCheckin}
      >
        {checkinStep === 2 && (
          <span className="spinner" />
        )}
        {getBtnLabel()}
      </button>
    </div>
  );
}
