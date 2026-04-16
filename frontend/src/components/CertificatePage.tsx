"use client";

import React, { useRef, useState, useEffect } from "react";
import { QRCodeCanvas } from "qrcode.react";
import type { VEvent } from "../lib/vryfd";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface OnChainCert {
  certId: number;
  eventId: number;
  eventName: string;
  timestamp: number;
  metadataURI: string;
  isValid: boolean;
}

interface CertificatePageProps {
  events: VEvent[];
  userBadges: number[];
  badgeBlockNums: Record<number, number>;
  badgeMintTimes: Record<number, string>;
  userENS: string;
  isConnected: boolean;
  onToast: (msg: string, type: "success" | "error" | "") => void;
  userCertificates?: OnChainCert[];
  checkedInIds?: number[];
  onChainEventIds?: Record<number, number>;
  walletAddress?: string;
  onRefresh?: () => Promise<void>;
}

interface VerifyResult {
  verified: boolean;
  certificateId?: number;
  eventName?: string;
  attendee?: string;
  attendeeENS?: string | null;
  issuedAt?: string;
  isValid?: boolean;
  explorerURL?: string;
  error?: string;
}

interface CertCardProps {
  ev: VEvent;
  certId: number;
  userENS: string;
  issuedAt: string;
  verifyUrl: string;
  onToast: (msg: string, type: "success" | "error" | "") => void;
}

function VerifyModal({ result, onClose }: { result: VerifyResult; onClose: () => void }) {
  return (
    <div className="verify-overlay" onClick={onClose}>
      <div className="verify-modal" onClick={(e) => e.stopPropagation()}>
        <div className="verify-modal-header">
          <span>{result.verified && result.isValid ? "✓ Certificate Verified" : "✗ Verification Failed"}</span>
          <button type="button" className="verify-close" onClick={onClose}>✕</button>
        </div>
        {result.verified && result.isValid ? (
          <div className="verify-modal-body">
            <div className="verify-row"><span className="verify-label">Event</span><span className="verify-val">{result.eventName}</span></div>
            <div className="verify-row"><span className="verify-label">Certificate ID</span><span className="verify-val mono">#{result.certificateId}</span></div>
            <div className="verify-row"><span className="verify-label">Attendee</span><span className="verify-val mono">{result.attendeeENS || result.attendee}</span></div>
            <div className="verify-row"><span className="verify-label">Issued At</span><span className="verify-val">{result.issuedAt ? new Date(result.issuedAt).toLocaleString() : "—"}</span></div>
            <div className="verify-row"><span className="verify-label">Status</span><span className="verify-val verify-valid">Valid ✓</span></div>
            {result.explorerURL && (
              <a href={result.explorerURL} target="_blank" rel="noopener noreferrer" className="verify-etherscan-link">
                View contract on Sepolia Etherscan ↗
              </a>
            )}
          </div>
        ) : (
          <div className="verify-modal-body">
            <p className="text-muted">{result.error || "Certificate not found on-chain."}</p>
            <a
              href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#events`}
              target="_blank" rel="noopener noreferrer"
              className="verify-etherscan-link"
            >
              View contract events on Etherscan ↗
            </a>
          </div>
        )}
      </div>
    </div>
  );
}

function CertCard({ ev, certId, userENS, issuedAt, verifyUrl, onToast }: CertCardProps) {
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  function shareLinkedIn() {
    const title = encodeURIComponent(`Certificate of Attendance — ${ev.name}`);
    const summary = encodeURIComponent(
      `I attended "${ev.name}" on ${ev.date} and earned a blockchain-verified certificate on VRYFD (Sepolia). Certificate #${certId}`
    );
    const url = encodeURIComponent(verifyUrl);
    window.open(
      `https://www.linkedin.com/shareArticle?mini=true&url=${url}&title=${title}&summary=${summary}`,
      "_blank",
      "noopener,noreferrer,width=600,height=600"
    );
    onToast(`Opened LinkedIn share for "${ev.name}"`, "success");
  }

  function downloadQR() {
    const canvas = qrContainerRef.current?.querySelector("canvas");
    if (!canvas) { onToast("QR not ready, try again", "error"); return; }
    const link = document.createElement("a");
    link.download = `vryfd-cert-${certId}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    onToast("QR Code downloaded!", "success");
  }

  async function verifyOnChain() {
    setVerifying(true);
    onToast("Checking certificate on-chain...", "");
    try {
      const res = await fetch(`${BACKEND}/api/verify/${certId}`);
      const data: VerifyResult = await res.json();
      setVerifyResult(data);
    } catch {
      setVerifyResult({
        verified: false,
        error: "Backend unavailable. Opening Etherscan instead.",
        explorerURL: `https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#events`,
      });
    } finally {
      setVerifying(false);
    }
  }

  return (
    <>
      <div className="cert-card-wrap fade-up delay-1">
        <div className="cert-preview">
          {/* Corner ornaments */}
          <span className="cert-corner cert-corner-tl" />
          <span className="cert-corner cert-corner-tr" />
          <span className="cert-corner cert-corner-bl" />
          <span className="cert-corner cert-corner-br" />

          {/* Top ribbon */}
          <div className="cert-ribbon">
            <span className="cert-ribbon-line" />
            <span className="cert-ribbon-label">Certificate of Attendance</span>
            <span className="cert-ribbon-line" />
          </div>

          {/* Issuer */}
          <div className="cert-issuer">VRYFD</div>

          {/* Subtitle */}
          <div className="cert-subtitle">This certifies that</div>

          {/* Attendee name */}
          <div className="cert-attendee">{userENS || "Connected Wallet"}</div>

          {/* Divider with emoji */}
          <div className="cert-divider-row">
            <span className="cert-divider-line" />
            <span className="cert-event-emoji">{ev.emoji}</span>
            <span className="cert-divider-line" />
          </div>

          {/* Body */}
          <div className="cert-subtitle">successfully attended</div>
          <div className="cert-event-name">{ev.name}</div>
          <div className="cert-date">{ev.date}</div>

          {/* Bottom section */}
          <div className="cert-bottom">
            <div className="cert-bottom-left">
              <div className="cert-meta-label">Certificate ID</div>
              <div className="cert-meta-val mono">#{certId}</div>
              <div className="cert-meta-label cert-meta-gap">Issued</div>
              <div className="cert-meta-val">{issuedAt}</div>
              <div className="cert-meta-label cert-meta-gap">Network</div>
              <div className="cert-meta-val mono">Sepolia</div>
              <div className="cert-meta-label cert-meta-gap-sm">Contract</div>
              <div className="cert-meta-val mono">{CONTRACT_ADDRESS.slice(0, 10)}…</div>
            </div>
            <div className="cert-bottom-right">
              <div className="cert-qr-label">Scan to verify</div>
              <div className="cert-qr cert-qr-live" ref={qrContainerRef}>
                <QRCodeCanvas
                  value={verifyUrl}
                  size={108}
                  bgColor="#ffffff"
                  fgColor="#1a1a2e"
                  level="M"
                />
              </div>
            </div>
          </div>

          {/* Verified badge */}
          <div className="cert-verified-badge">
            <span className="cert-verified-dot" />
            Verified on Blockchain
          </div>
        </div>

        <div className="cert-actions">
          <button type="button" className="btn btn-outline" onClick={shareLinkedIn}>
            🔗 Share to LinkedIn
          </button>
          <button type="button" className="btn btn-outline" onClick={downloadQR}>
            ⬛ Download QR
          </button>
          <button type="button" className="btn btn-outline" disabled={verifying} onClick={verifyOnChain}>
            {verifying ? <><span className="spinner" /> Verifying...</> : "🔍 Verify on-chain"}
          </button>
        </div>
      </div>

      {verifyResult && (
        <VerifyModal result={verifyResult} onClose={() => setVerifyResult(null)} />
      )}
    </>
  );
}

export default function CertificatePage({
  events,
  userBadges,
  badgeMintTimes,
  userENS,
  isConnected,
  onToast,
  userCertificates = [],
  checkedInIds = [],
  onChainEventIds = {},
  onRefresh,
}: CertificatePageProps) {
  const [refreshing, setRefreshing] = useState(false);

  // Auto-poll every 15s so newly issued certificates appear without manual action
  useEffect(() => {
    if (!onRefresh) return;
    const id = setInterval(() => { onRefresh(); }, 15_000);
    return () => clearInterval(id);
  }, [onRefresh]);

  async function handleRefresh() {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    await onRefresh();
    setRefreshing(false);
  }
  if (!isConnected) {
    return (
      <>
        <div className="section-header fade-up">
          <span className="section-title">Your Certificates</span>
          <span className="section-sub">Blockchain-verified · QR scannable</span>
        </div>
        <div className="card fade-up delay-1 cert-empty">
          <p className="text-muted">Connect your wallet to view your certificates.</p>
        </div>
      </>
    );
  }

  // Build attendance history rows for events that have been deployed on-chain
  const historyRows = events
    .filter((ev) => onChainEventIds[ev.id] !== undefined)
    .map((ev) => {
      const onChainId = Number(onChainEventIds[ev.id]); // cast — stored as string in localStorage
      const hasBadge = userBadges.includes(ev.id);
      // Match cert by onChainId only — name fallback caused wrong certs when two events share a name
      const cert = userCertificates.find((c) => c.isValid && c.eventId === onChainId);
      // Attended = checked in via UI flow OR badge claimed (badge requires attendance on-chain)
      const checkedIn = checkedInIds.includes(ev.id) || hasBadge || !!cert;
      return { ev, checkedIn, hasBadge, cert };
    })
    .filter((row) => row.checkedIn || row.hasBadge || row.cert);

  const validCerts = userCertificates.filter((c) => c.isValid);
  const hasAnyCerts = validCerts.length > 0;
  const hasAnyActivity = historyRows.length > 0 || hasAnyCerts;

  if (!hasAnyActivity && userBadges.length === 0) {
    return (
      <>
        <div className="section-header fade-up">
          <span className="section-title">Your Certificates</span>
          <span className="section-sub">Blockchain-verified · QR scannable</span>
        </div>
        <div className="card fade-up delay-1 cert-empty">
          <p className="text-muted">Check in to an event first to generate a time-stamped certificate.</p>
        </div>
      </>
    );
  }

  return (
    <>
      {/* ── Attendance History ── */}
      {historyRows.length > 0 && (
        <>
          <div className="section-header fade-up">
            <span className="section-title">Attendance History</span>
            <span className="section-sub">{historyRows.length} event{historyRows.length !== 1 ? "s" : ""} on-chain</span>
          </div>
          <div className="card fade-up delay-1 cert-history-card">
            <table className="cert-history-table">
              <thead>
                <tr>
                  <th>Event</th>
                  <th>Attended</th>
                  <th>Badge</th>
                  <th>Certificate</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map(({ ev, checkedIn, hasBadge, cert }) => (
                  <tr key={ev.id}>
                    <td className="cert-history-name">{ev.name}</td>
                    <td>{checkedIn ? <span className="cert-status-ok">✓</span> : <span className="cert-status-na">—</span>}</td>
                    <td>{hasBadge ? <span className="cert-status-ok">✓</span> : <span className="cert-status-na">—</span>}</td>
                    <td>
                      {cert
                        ? <span className="cert-status-ok">✓</span>
                        : <span className="cert-status-pending">pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* ── Certificates ── */}
      <div className="section-header fade-up">
        <span className="section-title">Your Certificates</span>
        <span className="section-sub section-sub-row">
          <span>
            Blockchain-verified · QR scannable
            {hasAnyCerts && ` · ${validCerts.length} certificate${validCerts.length !== 1 ? "s" : ""}`}
          </span>
          {onRefresh && (
            <button
              type="button"
              className="btn btn-outline btn-refresh"
              disabled={refreshing}
              onClick={handleRefresh}
            >
              {refreshing ? "Refreshing…" : "↻ Refresh"}
            </button>
          )}
        </span>
      </div>

      {hasAnyCerts ? (
        validCerts.map((cert) => {
          // Match event by on-chain ID; fall back to a synthetic placeholder
          // so certificates always render even when onChainEventIds is empty (e.g. after reset).
          const ev: VEvent = events.find((e) => Number(onChainEventIds[e.id]) === cert.eventId)
            ?? {
              id: cert.eventId,
              name: cert.eventName,
              date: new Date(cert.timestamp * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
              status: "live" as const,
              attendees: 0,
              emoji: "🎓",
              color: "#7c6cf0",
            };
          const issuedAt = new Date(cert.timestamp * 1000).toLocaleString();
          const verifyUrl = `${BACKEND}/api/verify/${cert.certId}`;
          return (
            <CertCard
              key={cert.certId}
              ev={ev}
              certId={cert.certId}
              userENS={userENS}
              issuedAt={issuedAt}
              verifyUrl={verifyUrl}
              onToast={onToast}
            />
          );
        })
      ) : checkedInIds.length > 0 ? (
        <div className="card fade-up delay-1 cert-empty">
          <p className="text-muted">
            You&apos;ve confirmed attendance at {checkedInIds.length} event{checkedInIds.length !== 1 ? "s" : ""}.
            Certificates will appear here once the organizer issues them on-chain.
          </p>
        </div>
      ) : userBadges.length > 0 ? (
        <div className="card fade-up delay-1 cert-empty">
          <p className="text-muted">
            You have {userBadges.length} attendance badge{userBadges.length !== 1 ? "s" : ""}.
            Certificates will appear here once the organizer issues them on-chain.
          </p>
        </div>
      ) : (
        <div className="card fade-up delay-1 cert-empty">
          <p className="text-muted">No certificates yet. Check in to events to earn certificates.</p>
        </div>
      )}
    </>
  );
}
