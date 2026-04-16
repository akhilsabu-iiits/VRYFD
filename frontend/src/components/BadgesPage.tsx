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
  badgeTokenIds: Record<number, string>;
  milestoneNftIds: Record<number, string>;
  badgeMmAdded: Record<number, boolean>;
  contractAddress: string;
  onClaimMilestone: (threshold: number) => void;
  onAddNftToWallet: (tokenId: string) => void;
  onAddBadgeToWallet: (eventId: number, tokenId: string) => void;
}

export default function BadgesPage({
  events, userCheckins, userBadges, isConnected, claimedMilestones, isMilestoneLoading,
  badgeTokenIds, milestoneNftIds, badgeMmAdded, contractAddress,
  onClaimMilestone, onAddNftToWallet, onAddBadgeToWallet,
}: BadgesPageProps) {
  // Which badge / milestone panel is open (null = all closed)
  const [badgePanelId, setBadgePanelId] = useState<number | null>(null);
  const [milestonePanelThreshold, setMilestonePanelThreshold] = useState<number | null>(null);
  // "addr" or "tokenId" — shared since only one panel is open at a time
  const [copiedField, setCopiedField] = useState<"addr" | "tokenId" | null>(null);

  const copyText = useCallback((text: string, field: "addr" | "tokenId") => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField((prev) => (prev === field ? null : prev)), 2000);
    }).catch(() => {});
  }, []);

  const renderImportPanel = (tokenId: string) => (
    <div className="nft-import-panel">
      <div className="nft-import-title">Import into MetaMask</div>
      <div className="nft-import-hint">MetaMask → NFTs tab → Import NFT</div>
      <div className="nft-import-row">
        <span className="nft-import-label">Contract</span>
        <button
          type="button"
          className="nft-import-copy"
          onClick={() => copyText(contractAddress, "addr")}
        >
          <span>{contractAddress.slice(0, 10)}…{contractAddress.slice(-6)}</span>
          <span className="nft-import-copy-icon">{copiedField === "addr" ? "✓ Copied" : "📋 Copy"}</span>
        </button>
      </div>
      <div className="nft-import-row">
        <span className="nft-import-label">Token ID</span>
        <button
          type="button"
          className="nft-import-copy"
          onClick={() => copyText(tokenId, "tokenId")}
        >
          <span>{tokenId}</span>
          <span className="nft-import-copy-icon">{copiedField === "tokenId" ? "✓ Copied" : "📋 Copy"}</span>
        </button>
      </div>
    </div>
  );

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
            if (!ev) return null;
            const tokenId = badgeTokenIds[id];
            const alreadyAdded = !!badgeMmAdded[id];
            const panelOpen = badgePanelId === id && !alreadyAdded;
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
                {tokenId && (
                  alreadyAdded ? (
                    <div className="btn-add-metamask btn-add-metamask--added">✓ Added to MetaMask</div>
                  ) : (
                    <button
                      type="button"
                      className={`btn-add-metamask${panelOpen ? " btn-add-metamask--active" : ""}`}
                      onClick={() => {
                        setBadgePanelId(panelOpen ? null : id);
                        setMilestonePanelThreshold(null);
                        onAddBadgeToWallet(id, tokenId);
                      }}
                    >
                      🦊 {panelOpen ? "Hide Import Details" : "Add to MetaMask"}
                    </button>
                  )
                )}
                {panelOpen && tokenId && contractAddress && renderImportPanel(tokenId)}
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
                {milestoneNftIds[5] && (
                  <>
                    <button
                      type="button"
                      className={`btn-add-metamask${milestonePanelThreshold === 5 ? " btn-add-metamask--active" : ""}`}
                      onClick={() => {
                        setMilestonePanelThreshold(milestonePanelThreshold === 5 ? null : 5);
                        setBadgePanelId(null);
                        onAddNftToWallet(milestoneNftIds[5]);
                      }}
                    >
                      🦊 {milestonePanelThreshold === 5 ? "Hide Import Details" : "Add to MetaMask"}
                    </button>
                    {milestonePanelThreshold === 5 && contractAddress && renderImportPanel(milestoneNftIds[5])}
                  </>
                )}
              </div>
            ) : userCheckins >= 5 ? (
              <button
                type="button"
                className="btn btn-block btn-claim-milestone"
                onClick={() => onClaimMilestone(5)}
                disabled={isMilestoneLoading}
              >
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
                {milestoneNftIds[10] && (
                  <>
                    <button
                      type="button"
                      className={`btn-add-metamask${milestonePanelThreshold === 10 ? " btn-add-metamask--active" : ""}`}
                      onClick={() => {
                        setMilestonePanelThreshold(milestonePanelThreshold === 10 ? null : 10);
                        setBadgePanelId(null);
                        onAddNftToWallet(milestoneNftIds[10]);
                      }}
                    >
                      🦊 {milestonePanelThreshold === 10 ? "Hide Import Details" : "Add to MetaMask"}
                    </button>
                    {milestonePanelThreshold === 10 && contractAddress && renderImportPanel(milestoneNftIds[10])}
                  </>
                )}
              </div>
            ) : userCheckins >= 10 ? (
              <button
                type="button"
                className="btn btn-block btn-claim-milestone"
                onClick={() => onClaimMilestone(10)}
                disabled={isMilestoneLoading}
              >
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
                {milestoneNftIds[20] && (
                  <>
                    <button
                      type="button"
                      className={`btn-add-metamask${milestonePanelThreshold === 20 ? " btn-add-metamask--active" : ""}`}
                      onClick={() => {
                        setMilestonePanelThreshold(milestonePanelThreshold === 20 ? null : 20);
                        setBadgePanelId(null);
                        onAddNftToWallet(milestoneNftIds[20]);
                      }}
                    >
                      🦊 {milestonePanelThreshold === 20 ? "Hide Import Details" : "Add to MetaMask"}
                    </button>
                    {milestonePanelThreshold === 20 && contractAddress && renderImportPanel(milestoneNftIds[20])}
                  </>
                )}
              </div>
            ) : userCheckins >= 20 ? (
              <button
                type="button"
                className="btn btn-block btn-claim-milestone"
                onClick={() => onClaimMilestone(20)}
                disabled={isMilestoneLoading}
              >
                {isMilestoneLoading ? "Claiming..." : "Claim NFT Reward"}
              </button>
            ) : null
          )}
        </div>
      </div>
    </>
  );
}
