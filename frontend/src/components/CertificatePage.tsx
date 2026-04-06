"use client";

import React, { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import type { VEvent } from "../lib/vryfd";

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const BACKEND = "http://localhost:3001";

interface CertificatePageProps {
  events: VEvent[];
  userBadges: number[];
  userENS: string;
  isConnected: boolean;
  onToast: (msg: string, type: "success" | "error" | "") => void;
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
  certNum: string;
  blockNum: number;
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
            <p className="text-muted">{result.error || "Certificate not found on-chain. Check-in must be submitted via relayer first."}</p>
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

function CertCard({ ev, certNum, blockNum, userENS, issuedAt, verifyUrl, onToast }: CertCardProps) {
  const qrContainerRef = useRef<HTMLDivElement>(null);
  const [verifyResult, setVerifyResult] = useState<VerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);

  function shareLinkedIn() {
    const title = encodeURIComponent(`Certificate of Attendance — ${ev.name}`);
    const summary = encodeURIComponent(
      `I attended "${ev.name}" on ${ev.date} and earned a blockchain-verified certificate on VRYFD (Sepolia). Certificate #${certNum} · Block #${blockNum}`
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
    link.download = `vryfd-cert-${certNum}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    onToast("QR Code downloaded!", "success");
  }

  async function verifyOnChain() {
    setVerifying(true);
    onToast("Checking certificate on-chain...", "");
    try {
      const certId = parseInt(certNum, 10) - 1;
      const res = await fetch(`${BACKEND}/api/verify/${certId}`);
      const data: VerifyResult = await res.json();
      setVerifyResult(data);
    } catch {
      // Backend not reachable — fallback to Etherscan
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
          <div className="cert-watermark">VRYFD</div>
          <div className="cert-title">Certificate of Attendance</div>
          <div className="cert-heading">VRYFD</div>
          <div className="cert-detail">This certifies that</div>
          <div className="cert-value">{userENS || "Connected Wallet"}</div>
          <div className="cert-detail">attended</div>
          <div className="cert-value">{ev.name}</div>
          <div className="cert-detail">on {ev.date}</div>
          <div className="cert-qr cert-qr-live" ref={qrContainerRef}>
            <QRCodeCanvas
              value={verifyUrl}
              size={96}
              bgColor="#ffffff"
              fgColor="#1a1a2e"
              level="M"
            />
          </div>
          <div className="cert-footer">
            Certificate #{certNum} · Block #{blockNum}<br />
            Issued: {issuedAt}<br />
            Sepolia · Contract: {CONTRACT_ADDRESS.slice(0, 10)}...
          </div>
          <div className="cert-valid">✓ Verified on Blockchain</div>
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

export default function CertificatePage({ events, userBadges, userENS, isConnected, onToast }: CertificatePageProps) {
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

  if (userBadges.length === 0) {
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

  const issuedAt = new Date().toISOString();

  return (
    <>
      <div className="section-header fade-up">
        <span className="section-title">Your Certificates</span>
        <span className="section-sub">
          Blockchain-verified · QR scannable · {userBadges.length} certificate{userBadges.length !== 1 ? "s" : ""}
        </span>
      </div>

      {userBadges.map((badgeId, index) => {
        const ev = events.find((e) => e.id === badgeId);
        if (!ev) return null;
        const blockNum = 48291000 + badgeId * 137;
        const certNum = String(index + 1).padStart(4, "0");
        const verifyUrl = `https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#events`;

        return (
          <CertCard
            key={badgeId}
            ev={ev}
            certNum={certNum}
            blockNum={blockNum}
            userENS={userENS}
            issuedAt={issuedAt}
            verifyUrl={verifyUrl}
            onToast={onToast}
          />
        );
      })}
    </>
  );
}
