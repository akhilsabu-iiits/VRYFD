"use client";

import React, { useState, useEffect, useRef } from "react";
import { useAccount, useChainId, useReadContract } from "wagmi";
import { CONTRACT_ADDRESSES } from "../utils/wagmiConfig";
import VryfdABI from "../abis/VryfdAttendance.json";
import { INITIAL_EVENTS } from "../lib/vryfd";

interface OrganizerPageProps {
  deployedEventIds: Record<number, number>;
  txHashes: Record<number, string>;
  onEventDeployed: (demoId: number, onChainId: number, txHash: string) => void;
  onToast: (msg: string, type: "success" | "error" | "") => void;
}

const PRESET_EVENTS = INITIAL_EVENTS.map((ev) => ({
  ...ev,
  startTime: Math.floor(new Date(`${ev.date} 00:00:00 UTC`).getTime() / 1000),
  endTime:   Math.floor(new Date(`${ev.date} 23:59:59 UTC`).getTime() / 1000),
  metadataURI: `ipfs://vryfd/${ev.id}/metadata.json`,
}));

const ORGANIZER_ROLE = "0x9f2df0fed2c77648de5860a4cc508cd0818c85b8b8a1ab4ceeef8d981c8956a6" as `0x${string}`;
const BACKEND = "http://localhost:3001";

type Tab = "deploy" | "manage" | "certificates";

export default function OrganizerPage({ deployedEventIds, txHashes, onEventDeployed, onToast }: OrganizerPageProps) {
  const { address } = useAccount();
  const chainId = useChainId();
  const contractAddress = CONTRACT_ADDRESSES[chainId];

  const [activeTab, setActiveTab] = useState<Tab>("deploy");
  const [deployingId, setDeployingId] = useState<number | null>(null);
  const autoDeployedRef = useRef(false);
  const [certForm, setCertForm] = useState({ eventId: "", attendee: "", metadataURI: "ipfs://vryfd/cert/" });
  const [revokeId, setRevokeId] = useState("");
  const [isIssuing, setIsIssuing] = useState(false);
  const [isRevoking, setIsRevoking] = useState(false);

  // ── Role check ──────────────────────────────────────────────────────────
  const { data: isOrganizer } = useReadContract({
    address: contractAddress,
    abi: VryfdABI.abi,
    functionName: "hasRole",
    args: address ? [ORGANIZER_ROLE, address] : undefined,
  });

  const { data: nextEventId, refetch: refetchNextId } = useReadContract({
    address: contractAddress,
    abi: VryfdABI.abi,
    functionName: "nextEventId",
  });

  // ── Auto-deploy first 2 events sequentially on first load if no real tx ──
  useEffect(() => {
    if (autoDeployedRef.current) return;
    autoDeployedRef.current = true;

    async function runAutoDeploySequential() {
      for (const demoId of [0, 1]) {
        const hash = txHashes[demoId];
        if (hash && !hash.startsWith("https://")) continue;
        const ev = PRESET_EVENTS.find((e) => e.id === demoId);
        if (!ev) continue;
        try {
          const res = await fetch(`${BACKEND}/api/relay/createEvent`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: ev.name, metadataURI: ev.metadataURI, startTime: ev.startTime, endTime: ev.endTime }),
          });
          const data = await res.json();
          if (!res.ok) continue;
          onEventDeployed(demoId, Number(data.eventId), data.txHash);
          refetchNextId();
        } catch {}
      }
    }

    runAutoDeploySequential();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Deploy event via backend relayer ──────────────────────────────────────
  async function deployEvent(demoId: number) {
    const ev = PRESET_EVENTS.find((e) => e.id === demoId);
    if (!ev) return;
    setDeployingId(demoId);
    try {
      const res = await fetch(`${BACKEND}/api/relay/createEvent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: ev.name, metadataURI: ev.metadataURI, startTime: ev.startTime, endTime: ev.endTime }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onEventDeployed(demoId, Number(data.eventId), data.txHash);
      onToast(`"${ev.name}" deployed! On-chain ID: #${data.eventId}`, "success");
      refetchNextId();
    } catch (err: unknown) {
      onToast(`Deploy failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setDeployingId(null);
    }
  }

  // ── Issue certificate ─────────────────────────────────────────────────────
  async function issueCertificate() {
    if (!certForm.eventId || !certForm.attendee) {
      onToast("Fill in Event ID and attendee address", "error");
      return;
    }
    setIsIssuing(true);
    try {
      const res = await fetch(`${BACKEND}/api/relay/issueCertificate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(certForm),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onToast(`Certificate issued! Tx: ${data.txHash?.slice(0, 10)}...`, "success");
      setCertForm({ eventId: "", attendee: "", metadataURI: "ipfs://vryfd/cert/" });
    } catch (err: unknown) {
      onToast(`Issue failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setIsIssuing(false);
    }
  }

  // ── Revoke certificate ────────────────────────────────────────────────────
  async function revokeCertificate() {
    if (!revokeId) { onToast("Enter a certificate ID", "error"); return; }
    setIsRevoking(true);
    try {
      const res = await fetch(`${BACKEND}/api/relay/revokeCertificate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificateId: revokeId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onToast("Certificate revoked on-chain!", "success");
      setRevokeId("");
    } catch (err: unknown) {
      onToast(`Revoke failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setIsRevoking(false);
    }
  }

  // ── Guards ────────────────────────────────────────────────────────────────
  if (!address) {
    return (
      <div className="card fade-up org-guard">
        <p className="text-muted">Connect your organizer wallet to access this panel.</p>
      </div>
    );
  }

  if (isOrganizer === false) {
    return (
      <div className="card fade-up org-guard">
        <div className="org-guard-icon">🔒</div>
        <p className="org-guard-title">Access Denied</p>
        <p className="org-guard-sub">
          Connected wallet does not have ORGANIZER_ROLE.<br />
          Only the deployer wallet can manage events.
        </p>
      </div>
    );
  }

  const TABS: { key: Tab; label: string }[] = [
    { key: "deploy",       label: "🚀 Deploy Events" },
    { key: "manage",       label: "📋 Manage Events" },
    { key: "certificates", label: "📜 Certificates" },
  ];

  return (
    <>
      <div className="section-header fade-up">
        <span className="section-title">Organizer Dashboard</span>
        <span className="section-sub">Next Event ID: #{String(nextEventId ?? "...")}</span>
      </div>

      <div className="org-badges fade-up">
        <span className="org-badge-role">✓ ORGANIZER_ROLE verified</span>
        <span className="org-badge-gasless">⚡ Gasless — backend pays gas</span>
      </div>

      <div className="org-tabs fade-up">
        {TABS.map((t) => (
          <button key={t.key} type="button"
            className={`nav-link${activeTab === t.key ? " active" : ""}`}
            onClick={() => setActiveTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Deploy Events ── */}
      {activeTab === "deploy" && (
        <div className="grid grid-2 fade-up">
          {PRESET_EVENTS.map((ev) => {
            const deployed = ev.id in deployedEventIds || ev.status === "live";
            const isDeploying = deployingId === ev.id;
            return (
              <div key={ev.id} className="card">
                <div className="card-glow"
                  style={{ background: `radial-gradient(circle at 50% 0%,${ev.color}11,transparent 70%)` }} />
                <div className={`event-status ${ev.status}`}>
                  {ev.status === "live" ? "LIVE NOW" : "UPCOMING"}
                </div>
                <div className="event-name">{ev.emoji} {ev.name}</div>
                <div className="event-meta">{ev.date}</div>
                <div className="org-event-times">
                  <div>Start: {new Date(ev.startTime * 1000).toUTCString()}</div>
                  <div>End: {new Date(ev.endTime * 1000).toUTCString()}</div>
                </div>

                {deployed ? (
                  <div className="org-deployed-box">
                    <div>✓ On-chain · Event ID #{deployedEventIds[ev.id] ?? "—"}</div>
                    {txHashes[ev.id] && (() => {
                      const isUrl = txHashes[ev.id].startsWith("http");
                      const href = isUrl ? txHashes[ev.id] : `https://sepolia.etherscan.io/tx/${txHashes[ev.id]}`;
                      const label = isUrl ? "View on Etherscan ↗" : `Tx: ${txHashes[ev.id].slice(0, 18)}...`;
                      return <a href={href} target="_blank" rel="noopener noreferrer" className="tx-link">{label}</a>;
                    })()}
                  </div>
                ) : (
                  <button type="button" className="btn btn-primary btn-block"
                    disabled={isDeploying} onClick={() => deployEvent(ev.id)}
                  >
                    {isDeploying ? <><span className="spinner" /> Deploying...</> : "Deploy to Chain"}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Manage Events ── */}
      {activeTab === "manage" && (
        <div className="fade-up">
          <div className="grid grid-2">
            {INITIAL_EVENTS.map((ev) => {
              const onChainId = deployedEventIds[ev.id];
              const isLive = ev.status === "live" || onChainId !== undefined;
              if (!isLive) return null;
              return (
                <div key={ev.id} className="card">
                  <div className="event-name">{ev.emoji} {ev.name}</div>
                  <div className="event-meta">{ev.date}</div>
                  <div className="org-manage-row">
                    <span className="org-manage-label">On-chain ID</span>
                    <span className="org-manage-id">{onChainId !== undefined ? `#${onChainId}` : "Pre-deployed"}</span>
                  </div>
                  <button type="button" className="btn btn-outline btn-block org-issue-btn"
                    onClick={() => {
                      setActiveTab("certificates");
                      setCertForm((f) => ({ ...f, eventId: String(onChainId) }));
                    }}
                  >
                    Issue Certificate
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Certificates ── */}
      {activeTab === "certificates" && (
        <div className="fade-up grid grid-2">
          <div className="card">
            <div className="event-name org-card-title">📜 Issue Certificate</div>
            <div className="org-form">
              {[
                { label: "Event ID (on-chain)", key: "eventId", placeholder: "e.g. 0" },
                { label: "Attendee Wallet Address", key: "attendee", placeholder: "0x..." },
                { label: "Metadata URI", key: "metadataURI", placeholder: "ipfs://..." },
              ].map(({ label, key, placeholder }) => (
                <div key={key}>
                  <div className="org-field-label">{label}</div>
                  <input type="text"
                    className="org-input"
                    value={certForm[key as keyof typeof certForm]}
                    placeholder={placeholder}
                    onChange={(e) => setCertForm((f) => ({ ...f, [key]: e.target.value }))}
                  />
                </div>
              ))}
              <button type="button" className="btn btn-primary btn-block"
                disabled={isIssuing} onClick={issueCertificate}
              >
                {isIssuing ? <><span className="spinner" /> Issuing...</> : "Issue Certificate"}
              </button>
            </div>
          </div>

          <div className="card">
            <div className="event-name org-card-title">🚫 Revoke Certificate</div>
            <div className="org-form">
              <div>
                <div className="org-field-label">Certificate ID</div>
                <input type="text" className="org-input" value={revokeId} placeholder="e.g. 0"
                  onChange={(e) => setRevokeId(e.target.value)}
                />
              </div>
              <button type="button" className="btn btn-block org-revoke-btn"
                disabled={isRevoking} onClick={revokeCertificate}
              >
                {isRevoking ? <><span className="spinner" /> Revoking...</> : "Revoke Certificate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
