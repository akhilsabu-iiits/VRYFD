"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

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
  verificationNote?: string;
  error?: string;
}

export default function VerifyPage() {
  const searchParams = useSearchParams();
  const initialId = searchParams?.get("id") || "";
  const [certId, setCertId] = useState(initialId);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);

  const verifyById = useCallback(async (id: string) => {
    if (!id.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/verify/${id.trim()}`);
      const data = await res.json();
      setResult(data);
    } catch {
      setResult({ verified: false, error: "Network error — could not reach server" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (initialId) verifyById(initialId);
  }, [initialId, verifyById]);

  const handleVerify = (e: React.FormEvent) => {
    e.preventDefault();
    verifyById(certId);
  };

  return (
    <div className="space-y-8 max-w-2xl mx-auto">
      <div className="text-center">
        <span className="material-symbols-outlined text-5xl text-primary mb-3 block">verified</span>
        <h1 className="text-2xl font-bold font-headline text-on-surface">Certificate Verification</h1>
        <p className="text-on-surface-variant text-sm mt-2">
          Verify the authenticity of any VRYFD attendance certificate or POAP badge
        </p>
      </div>

      <form onSubmit={handleVerify} className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
        <label className="block text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-2">
          Certificate ID
        </label>
        <div className="flex gap-3">
          <input
            type="number"
            min="1"
            value={certId}
            onChange={(e) => setCertId(e.target.value)}
            placeholder="Enter certificate ID (e.g. 1)"
            required
            className="flex-1 px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
          />
          <button
            type="submit"
            disabled={loading || !certId.trim()}
            className="px-6 py-3 rounded-lg prism-gradient text-white font-bold text-sm disabled:opacity-50 flex items-center gap-2 active:scale-95 transition-all"
          >
            {loading ? (
              <div className="spinner text-white" style={{ width: 16, height: 16 }} />
            ) : (
              <>
                <span className="material-symbols-outlined text-sm">search</span>
                Verify
              </>
            )}
          </button>
        </div>
      </form>

      {result && (
        <div className={`rounded-xl overflow-hidden shadow-ambient border ${
          result.verified && result.isValid
            ? "border-emerald-200"
            : result.verified
            ? "border-amber-200"
            : "border-red-200"
        }`}>
          {/* Header */}
          <div className={`px-6 py-5 flex items-center gap-4 ${
            result.verified && result.isValid
              ? "bg-emerald-50"
              : result.verified
              ? "bg-amber-50"
              : "bg-red-50"
          }`}>
            <div className={`w-14 h-14 rounded-xl flex items-center justify-center ${
              result.verified && result.isValid
                ? "bg-emerald-100"
                : result.verified
                ? "bg-amber-100"
                : "bg-red-100"
            }`}>
              <span className={`material-symbols-outlined text-3xl ${
                result.verified && result.isValid
                  ? "text-emerald-600"
                  : result.verified
                  ? "text-amber-600"
                  : "text-red-600"
              }`}>
                {result.verified && result.isValid ? "verified" : result.verified ? "warning" : "cancel"}
              </span>
            </div>
            <div>
              <h2 className={`text-lg font-bold font-headline ${
                result.verified && result.isValid
                  ? "text-emerald-800"
                  : result.verified
                  ? "text-amber-800"
                  : "text-red-800"
              }`}>
                {result.verified && result.isValid
                  ? "Certificate Verified"
                  : result.verified
                  ? "Certificate Revoked"
                  : "Verification Failed"}
              </h2>
              <p className={`text-sm ${
                result.verified ? "text-emerald-600" : "text-red-600"
              }`}>
                {result.error || (result.verified ? "This certificate is authentic" : "")}
              </p>
            </div>
          </div>

          {/* Details */}
          {result.verified && (
            <div className="bg-white p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Certificate ID</p>
                  <p className="text-lg font-bold font-headline text-on-surface mt-1">#{result.certificateId}</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Event</p>
                  <p className="text-lg font-bold font-headline text-on-surface mt-1">{result.eventName}</p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-surface-container-low">
                <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Issued To</p>
                <p className="text-sm font-bold text-on-surface mt-1 font-mono break-all">
                  {result.attendeeENS || result.attendee}
                </p>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Issued Date</p>
                  <p className="text-sm font-bold text-on-surface mt-1">
                    {result.issuedAt ? new Date(result.issuedAt).toLocaleDateString("en-US", {
                      weekday: "short", year: "numeric", month: "short", day: "numeric"
                    }) : "—"}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Status</p>
                  <p className={`text-sm font-bold mt-1 flex items-center gap-1 ${
                    result.isValid ? "text-emerald-600" : "text-red-600"
                  }`}>
                    <span className="material-symbols-outlined text-sm">
                      {result.isValid ? "check_circle" : "cancel"}
                    </span>
                    {result.isValid ? "Valid" : "Revoked"}
                  </p>
                </div>
              </div>

              <div className="p-4 rounded-lg bg-surface-container-low">
                <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Storage</p>
                <p className="text-sm font-bold text-on-surface mt-1 flex items-center gap-2">
                  <span className="material-symbols-outlined text-sm text-primary">
                    {result.onChain ? "link" : "cloud"}
                  </span>
                  {result.onChain ? `On-Chain (${result.chain})` : "VRYFD Verified Store"}
                </p>
                {result.verificationNote && (
                  <p className="text-xs text-on-surface-variant mt-1">{result.verificationNote}</p>
                )}
              </div>

              {result.explorerURL && (
                <a
                  href={result.explorerURL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 px-4 py-3 rounded-lg bg-primary/5 text-primary text-sm font-bold hover:bg-primary/10 transition-colors"
                >
                  <span className="material-symbols-outlined text-sm">open_in_new</span>
                  View on Block Explorer
                </a>
              )}
            </div>
          )}
        </div>
      )}

      <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
        <h3 className="font-bold font-headline text-on-surface mb-3 flex items-center gap-2">
          <span className="material-symbols-outlined text-primary">help</span>
          How Verification Works
        </h3>
        <div className="space-y-3 text-sm text-on-surface-variant">
          <p>Each VRYFD certificate has a unique ID assigned when it is issued after event attendance.</p>
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-emerald-600 text-lg mt-0.5">badge</span>
            <div>
              <p className="font-bold text-on-surface">POAP Badge</p>
              <p>Soulbound token proving event attendance. Awards <strong className="text-primary">30 VRYF</strong> tokens.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-amber-600 text-lg mt-0.5">workspace_premium</span>
            <div>
              <p className="font-bold text-on-surface">Certificate</p>
              <p>Verifiable attendance certificate. Awards <strong className="text-primary">60 VRYF</strong> tokens.</p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <span className="material-symbols-outlined text-indigo-600 text-lg mt-0.5">token</span>
            <div>
              <p className="font-bold text-on-surface">VRYF Tokens</p>
              <p>Reward tokens credited on check-in (+10), badge claim (+30), and certificate (+60).</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
