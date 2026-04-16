"use client";

import React, { useState, useCallback } from "react";
import type { VEvent } from "../lib/vryfd";

interface BadgesPageProps {
  events: VEvent[];
  userCheckins: number;
  userBadges: number[];
  isConnected: boolean;
  claimedMilestones: number[];
  isMilestoneLoading: boolean;
  onClaimMilestone: (threshold: number) => void;
  badgeTokenIds?: Record<number, string>;
  badgeContractAddrs?: Record<number, string>;
  milestoneNftIds?: Record<number, string>;
  onAddToWallet?: (eventId: number, tokenId: string, contractAddr: string, onSuccess: () => void) => void;
}

export default function BadgesPage({
  events, userCheckins, userBadges, isConnected, claimedMilestones, isMilestoneLoading,
  onClaimMilestone, badgeTokenIds = {}, badgeContractAddrs = {}, milestoneNftIds = {}, onAddToWallet,
}: BadgesPageProps) {
  // Tracks eventIds/tokenIds that have been successfully added to MetaMask this session.
  const [addedToWallet, setAddedToWallet] = useState<Set<string>>(new Set());

  const markAdded = useCallback((key: string) => {
    setAddedToWallet((prev) => new Set([...prev, key]));
  }, []);

  // eventId: demoId used to look up tokenId on-demand if not yet known.
  // contractAddr: the address stored at claim time — always correct even after a Reset.
  const AddButton = ({ eventId, tokenId, contractAddr, block }: { eventId: number; tokenId: string; contractAddr: string; block?: boolean }) => {
    const key = tokenId || String(eventId);
    const added = addedToWallet.has(key);
    return (
      <button
        type="button"
        className={block ? "btn btn-block" : "btn"}
        style={block
          ? { marginTop: "8px", fontSize: "12px", padding: "6px 12px" }
          : { fontSize: "11px", padding: "4px 10px", marginLeft: "8px" }}
        disabled={added || !onAddToWallet}
        onClick={() => onAddToWallet?.(eventId, tokenId, contractAddr, () => markAdded(key))}
      >
        {added ? "✓ Added" : block ? "+ Add to MetaMask" : "+ MetaMask"}
      </button>
    );
  };

  return (
    <>
      {/* POAP Badges */}
      <div className="section-header fade-up">
        <span className="section-title">Your POAP Badges</span>
        <span className="section-sub">Soulbound · Non-transferable</span>
      </div>
      <div className="grid grid-3 fade-up delay-1">
        {!isConnected ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem", gridColumn: "1/-1" }}>
            <p style={{ color: "var(--text3)" }}>Connect your wallet to view your POAP badges.</p>
          </div>
        ) : userBadges.length === 0 ? (
          <div className="card" style={{ textAlign: "center", padding: "3rem", gridColumn: "1/-1" }}>
            <p style={{ color: "var(--text3)" }}>No badges yet. Check in to events to earn POAP badges.</p>
          </div>
        ) : (
          userBadges.map((id) => {
            const ev = events.find((e) => e.id === id);
            const tid = badgeTokenIds[id];
            const caddr = badgeContractAddrs[id] ?? "";
            return (
              <div key={id} className="card badge">
                <div
                  className="badge-icon"
                  style={{ background: ev ? `linear-gradient(135deg,${ev.color},${ev.color}88)` : "linear-gradient(135deg,#555,#888)" }}
                >
                  {ev ? ev.emoji : "🏅"}
                </div>
                <div className="badge-name">{ev ? ev.name : `Event #${id}`}</div>
                <div className="badge-date">{ev ? ev.date : "—"}</div>
                <div className="badge-soulbound">SOULBOUND</div>
                <AddButton eventId={id} tokenId={tid ?? ""} contractAddr={caddr} block />
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
          <div className="badge-date">5 events required · +100 VRYF</div>
          <div style={{ marginTop: "8px", width: "100%" }}>
            <div style={{ background: "var(--bg3)", borderRadius: "50px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "50px",
                background: "linear-gradient(90deg,var(--amber),var(--green))",
                width: `${isConnected ? Math.min(userCheckins / 5 * 100, 100) : 0}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>
              {isConnected ? Math.min(userCheckins, 5) : 0}/5
            </div>
          </div>
          {isConnected && (
            claimedMilestones.includes(5) ? (
              <div className="milestone-claimed-row">
                <span className="milestone-claimed-label">✓ NFT Claimed</span>
                {milestoneNftIds[5] && <AddButton eventId={0} tokenId={milestoneNftIds[5]} contractAddr="" block={false} />}
              </div>
            ) : userCheckins >= 5 ? (
              <button type="button" className="btn btn-block btn-claim-milestone" onClick={() => onClaimMilestone(5)} disabled={isMilestoneLoading}>
                {isMilestoneLoading ? "Claiming..." : "Claim NFT Reward"}
              </button>
            ) : null
          )}
        </div>

        {/* Silver */}
        <div className="card badge">
          <div className="badge-icon" style={{ background: "linear-gradient(135deg,#64748b,#cbd5e1)" }}>🌟</div>
          <div className="badge-name">Silver Pioneer</div>
          <div className="badge-date">10 events required · +250 VRYF</div>
          <div style={{ marginTop: "8px", width: "100%" }}>
            <div style={{ background: "var(--bg3)", borderRadius: "50px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "50px",
                background: "linear-gradient(90deg,#64748b,#cbd5e1)",
                width: `${isConnected ? Math.min(userCheckins / 10 * 100, 100) : 0}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>
              {isConnected ? Math.min(userCheckins, 10) : 0}/10
            </div>
          </div>
          {isConnected && (
            claimedMilestones.includes(10) ? (
              <div className="milestone-claimed-row">
                <span className="milestone-claimed-label">✓ NFT Claimed</span>
                {milestoneNftIds[10] && <AddButton eventId={0} tokenId={milestoneNftIds[10]} contractAddr="" block={false} />}
              </div>
            ) : userCheckins >= 10 ? (
              <button type="button" className="btn btn-block btn-claim-milestone" onClick={() => onClaimMilestone(10)} disabled={isMilestoneLoading}>
                {isMilestoneLoading ? "Claiming..." : "Claim NFT Reward"}
              </button>
            ) : null
          )}
        </div>

        {/* Gold */}
        <div className="card badge">
          <div className="badge-icon" style={{ background: "linear-gradient(135deg,var(--accent3),var(--accent2))" }}>👑</div>
          <div className="badge-name">Gold Legend</div>
          <div className="badge-date">20 events required · +500 VRYF</div>
          <div style={{ marginTop: "8px", width: "100%" }}>
            <div style={{ background: "var(--bg3)", borderRadius: "50px", height: "6px", overflow: "hidden" }}>
              <div style={{
                height: "100%", borderRadius: "50px",
                background: "linear-gradient(90deg,var(--accent3),var(--accent2))",
                width: `${isConnected ? Math.min(userCheckins / 20 * 100, 100) : 0}%`,
                transition: "width 0.6s",
              }} />
            </div>
            <div style={{ fontSize: "11px", color: "var(--text3)", marginTop: "4px" }}>
              {isConnected ? Math.min(userCheckins, 20) : 0}/20
            </div>
          </div>
          {isConnected && (
            claimedMilestones.includes(20) ? (
              <div className="milestone-claimed-row">
                <span className="milestone-claimed-label">✓ NFT Claimed</span>
                {milestoneNftIds[20] && <AddButton eventId={0} tokenId={milestoneNftIds[20]} contractAddr="" block={false} />}
              </div>
            ) : userCheckins >= 20 ? (
              <button type="button" className="btn btn-block btn-claim-milestone" onClick={() => onClaimMilestone(20)} disabled={isMilestoneLoading}>
                {isMilestoneLoading ? "Claiming..." : "Claim NFT Reward"}
              </button>
            ) : null
          )}
        </div>
      </div>
    </>
  );
}
