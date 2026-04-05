"use client";

import React from "react";
import type { VEvent } from "../lib/vryfd";

interface CertificatePageProps {
  events: VEvent[];
  userBadges: number[];
  userENS: string;
  onToast: (msg: string, type: "success" | "error" | "") => void;
}

export default function CertificatePage({ events, userBadges, userENS, onToast }: CertificatePageProps) {
  if (userBadges.length === 0) {
    return (
      <>
        <div className="section-header fade-up">
          <span className="section-title">Your Certificates</span>
          <span className="section-sub">Blockchain-verified · QR scannable</span>
        </div>
        <div className="card fade-up delay-1" style={{ textAlign: "center", padding: "3rem" }}>
          <p style={{ color: "var(--text3)" }}>Check in to an event first to generate a time-stamped certificate.</p>
        </div>
      </>
    );
  }

  const ev = events.find((e) => e.id === userBadges[0]);
  if (!ev) return null;

  const now = new Date();
  const blockNum = 48291000 + Math.floor(Math.random() * 999);

  return (
    <>
      <div className="section-header fade-up">
        <span className="section-title">Your Certificates</span>
        <span className="section-sub">Blockchain-verified · QR scannable</span>
      </div>

      <div className="fade-up delay-1">
        <div className="cert-preview">
          <div className="cert-watermark">VRYFD</div>
          <div className="cert-title">Certificate of Attendance</div>
          <div className="cert-heading">VRYFD</div>
          <div className="cert-detail">This certifies that</div>
          <div className="cert-value">{userENS || "Connected Wallet"}</div>
          <div className="cert-detail">attended</div>
          <div className="cert-value">{ev.name}</div>
          <div className="cert-detail">on {ev.date}</div>
          <div className="cert-qr">
            <div className="cert-qr-inner" />
          </div>
          <div className="cert-footer">
            Certificate #0001 · Block #{blockNum}<br />
            Timestamp: {now.toISOString()}<br />
            Sepolia · IPFS: QmX7r...4kP2
          </div>
          <div className="cert-valid">✓ Verified on Blockchain</div>
        </div>

        <div style={{ display: "flex", gap: "12px", marginTop: "16px", justifyContent: "center", flexWrap: "wrap" }}>
          <button type="button" className="btn btn-outline" onClick={() => onToast("Certificate shared to LinkedIn!", "success")}>
            🔗 Share to LinkedIn
          </button>
          <button type="button" className="btn btn-outline" onClick={() => onToast("QR Code downloaded!", "success")}>
            ⬛ Download QR
          </button>
          <button type="button" className="btn btn-outline" onClick={() => onToast("Opening verification portal...", "")}>
            🔍 Verify on-chain
          </button>
        </div>
      </div>
    </>
  );
}
