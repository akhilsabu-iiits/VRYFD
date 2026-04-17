"use client";

import React, { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { QRCodeSVG } from "qrcode.react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";

interface VerifyResult {
  verified: boolean;
  certificateId?: number;
  eventName?: string;
  eventId?: number;
  attendee?: string;
  attendeeENS?: string;
  issuedAt?: string;
  isValid?: boolean;
  onChain?: boolean;
  contractAddress?: string;
  chain?: string;
  explorerURL?: string;
  error?: string;
}

export default function CertificateViewPage() {
  const params = useParams();
  const certId = params?.id as string;
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    if (!certId) return;
    fetch(`${BACKEND_URL}/api/verify/${certId}`)
      .then((r) => r.json())
      .then(setResult)
      .catch(() => setResult({ verified: false, error: "Network error" }))
      .finally(() => setLoading(false));
  }, [certId]);

  const verifyURL =
    typeof window !== "undefined" ? `${window.location.origin}/verify?id=${certId}` : `/verify?id=${certId}`;

  const imageURL = `${BACKEND_URL}/api/certificates/image/${certId}`;

  const handlePrint = () => window.print();

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = imageURL;
    a.download = `vryfd-certificate-${certId}.png`;
    a.click();
  };

  const handleShare = () => {
    navigator.clipboard.writeText(verifyURL);
    alert("Verification link copied to clipboard");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner text-primary" />
      </div>
    );
  }

  if (!result?.verified) {
    return (
      <div className="text-center py-20">
        <span className="material-symbols-outlined text-5xl text-red-400 mb-4 block">cancel</span>
        <h2 className="text-xl font-bold font-headline mb-2">Certificate not found</h2>
        <p className="text-on-surface-variant text-sm mb-6">{result?.error || "We couldn't load this certificate."}</p>
        <Link href="/verify" className="text-primary font-bold hover:underline">
          Try the verify page
        </Link>
      </div>
    );
  }

  const issued = result.issuedAt ? new Date(result.issuedAt) : null;

  return (
    <div className="space-y-6 max-w-4xl mx-auto print:max-w-none print:p-0">
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant print:hidden">
        <Link href="/profile" className="hover:text-primary">Profile</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface font-medium">Certificate #{certId}</span>
      </nav>

      {/* Certificate visual */}
      <div className="bg-white rounded-2xl shadow-2xl overflow-hidden border-4 border-primary/20 print:shadow-none print:border-none">
        {/* Header gradient */}
        <div className="prism-gradient h-3" />

        <div className="p-12 md:p-16 relative">
          {/* Decorative corner ornaments */}
          <div className="absolute top-4 left-4 w-16 h-16 border-t-2 border-l-2 border-primary/40 rounded-tl-2xl" />
          <div className="absolute top-4 right-4 w-16 h-16 border-t-2 border-r-2 border-primary/40 rounded-tr-2xl" />
          <div className="absolute bottom-4 left-4 w-16 h-16 border-b-2 border-l-2 border-primary/40 rounded-bl-2xl" />
          <div className="absolute bottom-4 right-4 w-16 h-16 border-b-2 border-r-2 border-primary/40 rounded-br-2xl" />

          <div className="text-center space-y-6 relative">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-primary font-bold">VRYFD</p>
              <h1 className="text-4xl md:text-5xl font-bold font-headline text-gray-900 mt-3">
                Certificate of Attendance
              </h1>
              <div className="w-24 h-1 prism-gradient mx-auto mt-4 rounded-full" />
            </div>

            <p className="text-base text-gray-600">This certifies that</p>

            <p className="text-3xl md:text-4xl font-bold font-headline text-primary">
              {result.attendeeENS || (result.attendee ? `${result.attendee.slice(0, 8)}…${result.attendee.slice(-6)}` : "Attendee")}
            </p>

            <p className="text-base text-gray-600">attended</p>

            <p className="text-2xl md:text-3xl font-bold font-headline text-gray-900">
              {result.eventName}
            </p>

            <p className="text-sm text-gray-500">
              on{" "}
              {issued?.toLocaleDateString("en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
              })}
            </p>

            {/* QR + cert id row */}
            <div className="flex flex-col md:flex-row items-center justify-center gap-8 pt-8">
              <div className="bg-white p-3 rounded-lg border-2 border-gray-200">
                <QRCodeSVG value={verifyURL} size={160} level="H" includeMargin />
              </div>
              <div className="text-left space-y-2">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Certificate ID</p>
                  <p className="text-2xl font-mono font-bold text-gray-900">#{result.certificateId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Event ID</p>
                  <p className="text-sm font-mono text-gray-700">#{result.eventId}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-400 font-bold">Status</p>
                  <p className={`text-sm font-bold flex items-center gap-1 ${result.isValid ? "text-emerald-600" : "text-red-600"}`}>
                    <span className="material-symbols-outlined text-base">
                      {result.isValid ? "verified" : "cancel"}
                    </span>
                    {result.isValid ? "Valid" : "Revoked"}
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-gray-100 text-xs text-gray-400">
              Issued by VRYFD · Verified on {result.chain || "Sepolia Testnet"} · Scan QR to verify authenticity
            </div>
          </div>
        </div>
      </div>

      {/* Action bar (hidden in print) */}
      <div className="flex flex-wrap gap-3 justify-center print:hidden">
        <button
          onClick={handlePrint}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-surface-container text-on-surface font-bold text-sm hover:bg-surface-container-high"
        >
          <span className="material-symbols-outlined text-base">print</span>
          Print
        </button>
        <button
          onClick={handleDownload}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/10 text-primary font-bold text-sm hover:bg-primary/20"
        >
          <span className="material-symbols-outlined text-base">download</span>
          Download Image
        </button>
        <button
          onClick={handleShare}
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100"
        >
          <span className="material-symbols-outlined text-base">share</span>
          Copy Verify Link
        </button>
        <a
          href={verifyURL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl prism-gradient text-white font-bold text-sm hover:opacity-90"
        >
          <span className="material-symbols-outlined text-base">verified</span>
          Open Verify Page
        </a>
        {result.explorerURL && (
          <a
            href={result.explorerURL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-50 text-indigo-700 font-bold text-sm hover:bg-indigo-100"
          >
            <span className="material-symbols-outlined text-base">open_in_new</span>
            View on Etherscan
          </a>
        )}
      </div>

      {/* Server-rendered PNG preview (uses certificateService) */}
      {!imageError && (
        <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 print:hidden">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold font-headline text-on-surface">Server-rendered preview</h3>
            <span className="text-xs text-on-surface-variant">Same image used for download</span>
          </div>
          <img
            src={imageURL}
            alt={`Certificate ${certId}`}
            className="w-full h-auto rounded-lg border border-outline-variant/20"
            onError={() => setImageError(true)}
          />
        </div>
      )}
    </div>
  );
}
