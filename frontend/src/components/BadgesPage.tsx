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
  milestoneContractAddrs?: Record<number, string>;
  onAddToWallet?: (eventId: number, tokenId: string, contractAddr: string, onSuccess: (resolvedTokenId: string) => void) => Promise<void>;
  /** Keys already added to MetaMask (persisted across reloads by page.tsx). */
  addedToWalletKeys?: string[];
  /** Called when a key is newly added — page.tsx persists it to localStorage. */
  onMarkAddedToWallet?: (key: string) => void;
}

export default function BadgesPage({
  events, userCheckins, userBadges, isConnected, claimedMilestones, isMilestoneLoading,
  onClaimMilestone, badgeTokenIds = {}, badgeContractAddrs = {}, milestoneNftIds = {}, milestoneContractAddrs = {}, onAddToWallet,
  addedToWalletKeys = [], onMarkAddedToWallet,
}: BadgesPageProps) {
  // Tracks the key of the button currently awaiting MetaMask response.
  const [loadingKey, setLoadingKey] = useState<string | null>(null);
  // Tracks which manual-import panels are expanded (keyed by panelKey string).
  const [expandedManual, setExpandedManual] = useState<Set<string>>(new Set());
  // Tracks which copy button last received a click (for 2s "Copied!" feedback).
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const markAdded = useCallback((key: string) => {
    onMarkAddedToWallet?.(key);
  }, [onMarkAddedToWallet]);

  const toggleManual = useCallback((panelKey: string) => {
    setExpandedManual((prev) => {
      const next = new Set(prev);
      if (next.has(panelKey)) next.delete(panelKey);
      else next.add(panelKey);
      return next;
    });
  }, []);

  const copyToClipboard = useCallback(async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 2000);
    } catch { /* clipboard blocked — no feedback */ }
  }, []);

  // eventId: demoId used to look up tokenId on-demand if not yet known.
  // contractAddr: the address stored at claim time — always correct even after a Reset.
  const AddButton = ({ eventId, tokenId, contractAddr, block }: { eventId: number; tokenId: string; contractAddr: string; block?: boolean }) => {
    const key = tokenId || String(eventId);
    const added = addedToWalletKeys.includes(key);
    const isLoading = loadingKey === key;
    return (
      <button
        type="button"
        className={block ? "btn btn-block" : "btn"}
        style={block
          ? { marginTop: "8px", fontSize: "12px", padding: "6px 12px" }
          : { fontSize: "11px", padding: "4px 10px", marginLeft: "8px" }}
        disabled={added || isLoading || !onAddToWallet}
        onClick={() => {
          if (!onAddToWallet || isLoading || added) return;
          setLoadingKey(key);
          onAddToWallet(eventId, tokenId, contractAddr, (resolvedTokenId: string) => {
            // Use the resolved tokenId as the key — it may differ from the original tokenId
            // if handleAddToWallet fetched it on-chain (Step 3). This ensures the key saved
            // matches the key computed on reload (badgeTokenIds is updated before onSuccess fires).
            const savedKey = (resolvedTokenId && resolvedTokenId !== "0") ? resolvedTokenId : key;
            markAdded(savedKey);
          }).finally(() => setLoadingKey(null));
        }}
      >
        {added ? "✓ Added" : isLoading ? "Opening MetaMask…" : block ? "+ Add to MetaMask" : "+ MetaMask"}
      </button>
    );
  };

  /**
   * Collapsible manual import panel shown under every badge/milestone card.
   * Uses the nft-import-* CSS classes already defined in globals.css.
   */
  const ManualPanel = ({
    panelKey,
    contractAddr,
    tokenId,
  }: {
    panelKey: string;
    contractAddr: string;
    tokenId: string;
  }) => {
    const isOpen = expandedManual.has(panelKey);
    const hasAddr = contractAddr && contractAddr.startsWith("0x");
    const addrDisplay = hasAddr
      ? `${contractAddr.slice(0, 10)}…${contractAddr.slice(-8)}`
      : "Not yet available";
    const tid = tokenId && tokenId !== "0" ? tokenId : "";
    const etherscanBase = hasAddr
      ? `https://sepolia.etherscan.io/token/${contractAddr}`
      : "https://sepolia.etherscan.io";

    return (
      <div style={{ width: "100%", marginTop: "6px" }}>
        {/* Toggle link */}
        <button
          type="button"
          onClick={() => toggleManual(panelKey)}
          style={{
            background: "none", border: "none", cursor: "pointer",
            fontSize: "11px", color: "var(--text2)", padding: "4px 0",
            textDecoration: "none",
            display: "flex", alignItems: "center", gap: "4px",
          }}
        >
          <span style={{ fontSize: "9px" }}>{isOpen ? "▾" : "▸"}</span>
          {isOpen ? "Hide manual steps" : "Can't see the popup? Add manually"}
        </button>

        {/* Expanded panel */}
        {isOpen && (
          <div className="nft-import-panel">
            <div className="nft-import-title">Manual MetaMask Import</div>
            <div className="nft-import-hint">
              Open MetaMask → NFTs tab → Import NFT, then paste these values:
            </div>

            {/* Contract address row */}
            <div className="nft-import-row">
              <span className="nft-import-label">Contract:</span>
              <button
                type="button"
                className="nft-import-copy"
                disabled={!hasAddr}
                onClick={() => hasAddr && copyToClipboard(contractAddr, `${panelKey}-addr`)}
                title={hasAddr ? contractAddr : "Not yet available"}
              >
                <span>{addrDisplay}</span>
                <span className="nft-import-copy-icon">
                  {copiedKey === `${panelKey}-addr` ? "✓" : "📋"}
                </span>
              </button>
            </div>

            {/* Token ID row */}
            <div className="nft-import-row">
              <span className="nft-import-label">Token ID:</span>
              {tid ? (
                <button
                  type="button"
                  className="nft-import-copy"
                  onClick={() => copyToClipboard(tid, `${panelKey}-tid`)}
                  title={tid}
                >
                  <span>{tid}</span>
                  <span className="nft-import-copy-icon">
                    {copiedKey === `${panelKey}-tid` ? "✓" : "📋"}
                  </span>
                </button>
              ) : (
                <a
                  href={etherscanBase}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="nft-import-copy"
                  style={{ textDecoration: "none" }}
                  title="Check Etherscan for your token ID"
                >
                  <span>Find on Etherscan</span>
                  <span className="nft-import-copy-icon">↗</span>
                </a>
              )}
            </div>

            {/* Step-by-step mini guide */}
            <ol style={{
              margin: "4px 0 0", padding: "0 0 0 14px",
              fontSize: "10px", color: "var(--text3)", lineHeight: "1.7",
            }}>
              <li>Open <strong style={{ color: "var(--text2)" }}>MetaMask</strong> and click the <strong style={{ color: "var(--text2)" }}>NFTs</strong> tab</li>
              <li>Scroll down and click <strong style={{ color: "var(--text2)" }}>Import NFT</strong></li>
              <li>Paste the <strong style={{ color: "var(--text2)" }}>Contract address</strong> above</li>
              <li>Paste the <strong style={{ color: "var(--text2)" }}>Token ID</strong> above</li>
              <li>Click <strong style={{ color: "var(--text2)" }}>Add</strong></li>
            </ol>
          </div>
        )}
      </div>
    );
  };

  // Milestones the user is eligible to claim right now (unclaimed + count reached).
  // The contract always mints ALL eligible tiers in one transaction, so only the
  // LOWEST unclaimed eligible tier gets a claim button — higher tiers show a note
  // explaining they will be included in that claim.
  const MILESTONE_DEFS = [
    { threshold: 5,  icon: "🏆", label: "Bronze" },
    { threshold: 10, icon: "🌟", label: "Silver" },
    { threshold: 20, icon: "👑", label: "Gold"   },
  ] as const;
  const eligibleMilestones = isConnected
    ? MILESTONE_DEFS.filter((m) => userCheckins >= m.threshold && !claimedMilestones.includes(m.threshold))
    : [];
  // The card that owns the claim button — always the lowest unclaimed eligible tier.
  const claimHost = eligibleMilestones[0] ?? null;

  function claimButtonLabel(): string {
    if (isMilestoneLoading) return "Claiming...";
    if (eligibleMilestones.length <= 1) return "Claim NFT Reward";
    // Multiple tiers will be claimed together — list them all so the user knows
    const icons = eligibleMilestones.map((m) => m.icon).join(" ");
    return `Claim All Eligible NFTs ${icons}`;
  }

  function includedNote(threshold: number): string {
    if (!claimHost || claimHost.threshold === threshold) return "";
    return `Included in ${claimHost.icon} ${claimHost.label} claim`;
  }

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
            const tid = badgeTokenIds[id] ?? "";
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
                <AddButton eventId={id} tokenId={tid} contractAddr={caddr} block />
                <ManualPanel panelKey={`badge-${id}`} contractAddr={caddr} tokenId={tid} />
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
                  <AddButton eventId={0} tokenId={milestoneNftIds[5]} contractAddr={milestoneContractAddrs[5] ?? ""} block={false} />
                )}
                <ManualPanel
                  panelKey="milestone-5"
                  contractAddr={milestoneContractAddrs[5] ?? ""}
                  tokenId={milestoneNftIds[5] ?? ""}
                />
              </div>
            ) : claimHost?.threshold === 5 ? (
              <button type="button" className="btn btn-block btn-claim-milestone" onClick={() => onClaimMilestone(5)} disabled={isMilestoneLoading}>
                {claimButtonLabel()}
              </button>
            ) : userCheckins >= 5 ? (
              <div className="milestone-included-note">{includedNote(5)}</div>
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
                  <AddButton eventId={0} tokenId={milestoneNftIds[10]} contractAddr={milestoneContractAddrs[10] ?? ""} block={false} />
                )}
                <ManualPanel
                  panelKey="milestone-10"
                  contractAddr={milestoneContractAddrs[10] ?? ""}
                  tokenId={milestoneNftIds[10] ?? ""}
                />
              </div>
            ) : claimHost?.threshold === 10 ? (
              <button type="button" className="btn btn-block btn-claim-milestone" onClick={() => onClaimMilestone(10)} disabled={isMilestoneLoading}>
                {claimButtonLabel()}
              </button>
            ) : userCheckins >= 10 ? (
              <div className="milestone-included-note">{includedNote(10)}</div>
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
                  <AddButton eventId={0} tokenId={milestoneNftIds[20]} contractAddr={milestoneContractAddrs[20] ?? ""} block={false} />
                )}
                <ManualPanel
                  panelKey="milestone-20"
                  contractAddr={milestoneContractAddrs[20] ?? ""}
                  tokenId={milestoneNftIds[20] ?? ""}
                />
              </div>
            ) : claimHost?.threshold === 20 ? (
              <button type="button" className="btn btn-block btn-claim-milestone" onClick={() => onClaimMilestone(20)} disabled={isMilestoneLoading}>
                {claimButtonLabel()}
              </button>
            ) : userCheckins >= 20 ? (
              <div className="milestone-included-note">{includedNote(20)}</div>
            ) : null
          )}
        </div>
      </div>
    </>
  );
}
