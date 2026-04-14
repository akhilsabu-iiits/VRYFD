"use client";

import React, { useState, useEffect } from "react";
import type { VEvent } from "../lib/vryfd";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface EventsPageProps {
  events: VEvent[];
  currentEventId: number | null;
  checkinStep: number;
  isMinting: boolean;
  isConnected: boolean;
  userBadges: number[];
  userAddress: string;
  userENS: string;
  deployedEventIds: Record<number, number>;
  onChainEventIds: Record<number, number>;
  lastTxHash?: string;
  joinCode: string;
  isJoinCodeLoading: boolean;
  pendingRegistrationIds: number[];
  manualEns: string;
  manualEnsStatus: "idle" | "resolving" | "verified" | "mismatch" | "not_found";
  onJoinCodeChange: (code: string) => void;
  onJoinCodeCheckin: () => Promise<void>;
  onCheckPendingStatus: () => Promise<void>;
  onCheckin: () => Promise<void>;
  onSelectEvent: (id: number) => void;
  onManualEnsChange: (val: string) => void;
  onVerifyEns: () => void;
  onUnlinkEns: () => void;
}

export default function EventsPage({
  events,
  currentEventId,
  checkinStep,
  isMinting,
  isConnected,
  userBadges,
  userAddress,
  userENS,
  deployedEventIds,
  onChainEventIds,
  lastTxHash,
  joinCode,
  isJoinCodeLoading,
  pendingRegistrationIds,
  manualEns,
  manualEnsStatus,
  onJoinCodeChange,
  onJoinCodeCheckin,
  onCheckPendingStatus,
  onCheckin,
  onSelectEvent,
  onManualEnsChange,
  onVerifyEns,
  onUnlinkEns,
}: EventsPageProps) {
  const ev = currentEventId !== null ? events.find((e) => e.id === currentEventId) : null;
  const badgeClaimed = currentEventId !== null && userBadges.includes(currentEventId);

  // Fetch real on-chain attendee count when event panel opens, then poll every 5s
  const [onChainAttendeeCount, setOnChainAttendeeCount] = useState<number | null>(null);
  useEffect(() => {
    const onChainId = currentEventId !== null ? onChainEventIds[currentEventId] : undefined;
    if (onChainId === undefined) { setOnChainAttendeeCount(null); return; }
    setOnChainAttendeeCount(null);
    const fetchCount = () => {
      fetch(`${BACKEND}/api/relay/attendee-count/${onChainId}`)
        .then((r) => r.ok ? r.json() : null)
        .then((d) => { if (d?.count !== undefined) setOnChainAttendeeCount(d.count); })
        .catch(() => {});
    };
    fetchCount();
    const id = setInterval(fetchCount, 5000);
    return () => clearInterval(id);
  }, [currentEventId, onChainEventIds]);

  const initials = userENS
    ? userENS.slice(0, 2).toUpperCase()
    : userAddress
    ? userAddress.slice(2, 4).toUpperCase()
    : "??";

  // Pending: join code accepted, awaiting organizer confirmation
  const isPending = currentEventId !== null && pendingRegistrationIds.includes(currentEventId);

  // Part 1 state derivations
  const checkinDone = checkinStep >= 3 || badgeClaimed;
  const checkinLoading = checkinStep === 2;

  // Part 2 state derivations
  const badgeDone = checkinStep === 4 || badgeClaimed;
  const badgeAvailable = checkinStep === 3 && !badgeClaimed;

  const isStatusBlocked = ev?.status === "upcoming" || ev?.status === "ended";

  return (
    <div className="ev-page-layout fade-up">

      {/* ── Left: Event list ─────────────────────────────────────────────── */}
      <div className="ev-list">
        <div className="section-header">
          <span className="section-title">Events</span>
          <span className="section-sub">{events.length} events</span>
        </div>

        {events.map((e) => {
          const isSelected = e.id === currentEventId;
          const claimed = userBadges.includes(e.id);
          return (
            <button
              key={e.id}
              type="button"
              className={`ev-list-item${isSelected ? " selected" : ""}${e.status === "ended" ? " ended" : ""}`}
              onClick={() => onSelectEvent(e.id)}
            >
              <div className="ev-list-emoji">{e.emoji}</div>
              <div className="ev-list-info">
                <div className="ev-list-name">{e.name}</div>
                <div className="ev-list-meta">{e.date}</div>
              </div>
              <div className="ev-list-right">
                <span className={`event-status ${e.status}`}>
                  {e.status === "live" ? "LIVE" : e.status === "ended" ? "ENDED" : "SOON"}
                </span>
                {claimed && <span className="ev-list-claimed">✓</span>}
                {!claimed && pendingRegistrationIds.includes(e.id) && (
                  <span className="ev-list-pending">⏳</span>
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* ── Right: Check-in panel ────────────────────────────────────────── */}
      <div className="checkin-panel">

        {/* Event content */}
        {!ev ? (
          <div className="ev-no-selection">
            <div className="ev-no-selection-icon">👈</div>
            <p>Select an event to check in</p>
          </div>
        ) : (
          <>
            {/* Event header */}
            <div className="ev-panel-header">
              <div className="ev-panel-emoji">{ev.emoji}</div>
              <div>
                <h2>{ev.name}</h2>
                <div className="checkin-panel-sub">{ev.date}</div>
              </div>
            </div>

            {/* On-chain badge */}
            {currentEventId !== null && onChainEventIds[currentEventId] !== undefined && (
              <div className="ev-onchain-badge">
                ⛓ Event #{currentEventId}
              </div>
            )}

            {/* Status block for upcoming/ended */}
            {ev.status === "upcoming" && (
              <div className="ev-status-block ev-status-upcoming">
                <div className="ev-status-icon">🗓</div>
                <div>
                  <div className="ev-status-title">Event Not Started Yet</div>
                  <div className="ev-status-sub">Check-in opens when the event goes live</div>
                </div>
              </div>
            )}
            {ev.status === "ended" && (
              <div className="ev-status-block ev-status-ended">
                <div className="ev-status-icon">🏁</div>
                <div>
                  <div className="ev-status-title">Event Has Ended</div>
                  <div className="ev-status-sub">Check-in is no longer available</div>
                </div>
              </div>
            )}

            {/* ENS Identity — shown when connected, regardless of event status */}
            {isConnected && (
              <div className="ens-identity-card">
                <div className="ens-identity-hd">
                  <span className="ens-identity-label">🌐 Decentralized Identity</span>
                  {(userENS || manualEnsStatus === "verified") && (
                    <span className="ens-verified-badge">✓ ENS Verified</span>
                  )}
                </div>
                <div className="user-identity">
                  <div className="user-avatar ev-avatar-grad">{initials}</div>
                  <div>
                    <div className="user-ens">
                      {userENS || (manualEnsStatus === "verified" ? manualEns : userAddress || "Connected")}
                    </div>
                    {(userENS || manualEnsStatus === "verified") && (
                      <div className="user-addr">{userAddress}</div>
                    )}
                  </div>
                  {/* Verified row — right side of identity */}
                  {(userENS || manualEnsStatus === "verified") && (
                    <div className="ens-verified-row">
                      <span className="ens-status ens-status-ok">
                        ✓ {userENS || manualEns}
                      </span>
                      <button type="button" className="ens-unlink-btn" onClick={onUnlinkEns}>
                        Unlink
                      </button>
                      <span className="ens-linked-suffix">linked to your attendance</span>
                    </div>
                  )}
                </div>
                <div className="ens-manual-wrap">
                  {(userENS || manualEnsStatus === "verified") ? (
                    null
                  ) : (
                    <>
                      <div className="ens-manual-row">
                        <input
                          type="text"
                          className="joincode-input ens-manual-input"
                          placeholder="enter your ens domain"
                          value={manualEns}
                          onChange={(e) => onManualEnsChange(e.target.value.toLowerCase())}
                          onKeyDown={(e) => { if (e.key === "Enter") onVerifyEns(); }}
                          disabled={manualEnsStatus === "resolving"}
                        />
                        <button
                          type="button"
                          className="btn btn-outline joincode-btn"
                          disabled={!manualEns.trim() || manualEnsStatus === "resolving" || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(manualEns.trim())}
                          onClick={onVerifyEns}
                        >
                          {manualEnsStatus === "resolving" ? <span className="spinner" /> : "Link ENS"}
                        </button>
                      </div>
                      {manualEns.trim() && !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(manualEns.trim()) && (
                        <p className="ens-status ens-status-err">✗ Invalid format — expected e.g. yourname.eth</p>
                      )}
                      {manualEnsStatus === "mismatch" && (
                        <p className="ens-status ens-status-err">✗ ENS domain resolves to a different wallet</p>
                      )}
                      {manualEnsStatus === "not_found" && (
                        <p className="ens-status ens-status-err">✗ ENS domain not found on mainnet</p>
                      )}
                      <p className="ens-manual-hint">Optionally link your ENS domain to your attendance record</p>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ── Two-part flow ── */}
            {!isStatusBlocked && (
              <div className="checkin-parts">

                {/* Part 1: Confirm Attendance */}
                <div className={`checkin-part${checkinDone ? " part-done" : " part-active"}`}>
                  <div className="checkin-part-hd">
                    <div className={`checkin-part-num${checkinDone ? " num-done" : ""}`}>
                      {checkinDone ? "✓" : "1"}
                    </div>
                    <div className="checkin-part-meta">
                      <div className="checkin-part-title">Confirm Attendance</div>
                      <div className="checkin-part-sub">Enter join code → organizer confirms → recorded on Sepolia · +10 VRYF</div>
                    </div>
                  </div>

                  {lastTxHash && checkinDone && (
                    <a
                      href={`https://sepolia.etherscan.io/tx/${lastTxHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ev-tx-link"
                    >
                      ✓ View on Sepolia Etherscan ↗
                    </a>
                  )}

                  {checkinDone ? (
                    <button type="button" className="btn btn-block btn-success" disabled>
                      ✓ Attendance Confirmed
                    </button>
                  ) : isPending ? (
                    <div className="checkin-pending-wrap">
                      <div className="checkin-pending-badge">⏳ Registered — awaiting organizer confirmation</div>
                      <p className="checkin-pending-sub">
                        Your join code was accepted. The organizer will confirm your attendance from their dashboard.
                      </p>
                      <button
                        type="button"
                        className="btn btn-block btn-outline"
                        onClick={onCheckPendingStatus}
                      >
                        Check Confirmation Status
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="joincode-row joincode-row-primary">
                        <input
                          type="text"
                          className="joincode-input"
                          placeholder="Enter event join code"
                          maxLength={8}
                          value={joinCode}
                          disabled={!isConnected || isJoinCodeLoading}
                          onChange={(e) => onJoinCodeChange(e.target.value.toUpperCase())}
                          onKeyDown={(e) => { if (e.key === "Enter") onJoinCodeCheckin(); }}
                        />
                        <button
                          type="button"
                          className="btn btn-primary joincode-btn"
                          disabled={!isConnected || !joinCode.trim() || isJoinCodeLoading || checkinLoading}
                          onClick={onJoinCodeCheckin}
                        >
                          {isJoinCodeLoading ? <span className="spinner" /> : "Register"}
                        </button>
                      </div>
                      <div className="joincode-hint">Enter the 6-char code from the organizer · sign in MetaMask (no gas)</div>
                    </>
                  )}
                </div>

                {/* Part 2: Claim Badge — locked until organizer confirms */}
                <div className={`checkin-part${badgeDone ? " part-done" : badgeAvailable ? " part-active" : " part-locked"}`}>
                  <div className="checkin-part-hd">
                    <div className={`checkin-part-num${badgeDone ? " num-done" : ""}`}>
                      {badgeDone ? "✓" : "2"}
                    </div>
                    <div className="checkin-part-meta">
                      <div className="checkin-part-title">Claim POAP Badge</div>
                      <div className="checkin-part-sub">Soulbound NFT · Minted on-chain · +25 VRYF</div>
                    </div>
                  </div>

                  <button
                    type="button"
                    className={`btn btn-block${badgeDone ? " btn-success" : " btn-primary"}`}
                    disabled={!badgeAvailable || isMinting || badgeDone}
                    onClick={onCheckin}
                  >
                    {isMinting && <span className="spinner" />}
                    {badgeDone
                      ? "✓ POAP Badge Claimed"
                      : isMinting
                      ? "Minting on-chain..."
                      : "Claim POAP Badge"}
                  </button>
                </div>

              </div>
            )}

            {/* Attendee count */}
            <div className="ev-panel-stats">
              <span className="ev-panel-stat-val">{onChainAttendeeCount ?? 0}</span>
              <span className="ev-panel-stat-label">attendees checked in</span>
            </div>

            {!isConnected && (
              <p className="ev-connect-hint">Connect your wallet to check in</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
