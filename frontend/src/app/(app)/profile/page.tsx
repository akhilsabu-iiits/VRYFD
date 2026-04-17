"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "../../../contexts/AuthContext";
import { getMyBadges, watchNftInMetaMask, type MyBadge } from "../../../lib/badgeApi";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface EnrichedBadge extends MyBadge {
  resolvedImage?: string | null;
  resolvedName?: string | null;
}

function ipfsToHttp(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  return uri;
}

async function enrichBadge(b: MyBadge): Promise<EnrichedBadge> {
  const httpUri = ipfsToHttp(b.tokenURI);
  if (!httpUri) return { ...b };
  try {
    const res = await fetch(httpUri, { cache: "force-cache" });
    if (!res.ok) return { ...b };
    const meta = await res.json();
    return { ...b, resolvedImage: ipfsToHttp(meta?.image), resolvedName: meta?.name || null };
  } catch {
    return { ...b };
  }
}

interface Certificate {
  certId: number;
  eventId: number;
  eventName: string;
  attendee: string;
  timestamp: number;
  metadataURI: string;
  isValid: boolean;
  onChain?: boolean;
  txHash?: string;
}

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const REWARD_CHECKIN = 10;
const REWARD_BADGE = 30;
const REWARD_CERTIFICATE = 60;

interface CheckinRecord {
  eventId: string;
  email: string;
  timestamp: number;
  eventName: string;
  eventStatus: string;
}

export default function ProfilePage() {
  const { user } = useAuth();
  const searchParams = useSearchParams();
  const initialTab = (() => {
    const t = searchParams?.get("tab");
    if (t === "certificates" || t === "tokens" || t === "activity" || t === "badges") return t;
    return "badges";
  })();
  const [activeTab, setActiveTab] = useState<"badges" | "certificates" | "tokens" | "activity">(initialTab);
  const [certificates, setCertificates] = useState<Certificate[]>([]);
  const [checkins, setCheckins] = useState<CheckinRecord[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingCerts, setLoadingCerts] = useState(false);
  const [loadingCheckins, setLoadingCheckins] = useState(false);
  const [tokenBalance, setTokenBalance] = useState(0);
  const [tokenHistory, setTokenHistory] = useState<any[]>([]);
  const [selectedCert, setSelectedCert] = useState<Certificate | null>(null);
  const [badges, setBadges] = useState<EnrichedBadge[]>([]);

  const displayName = user?.name || user?.ensName || user?.email || "User";
  const shortAddr = user?.address
    ? `${user.address.slice(0, 6)}...${user.address.slice(-4)}`
    : null;

  const fetchCertificates = useCallback(() => {
    if (!user?.address) return;
    setLoadingCerts(true);
    fetch(`${BACKEND_URL}/api/certificates/mine/${encodeURIComponent(user.address)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.certificates) setCertificates(data.certificates);
      })
      .catch(() => {})
      .finally(() => setLoadingCerts(false));
  }, [user?.address]);

  const fetchCheckins = useCallback(() => {
    if (!user?.address) return;
    setLoadingCheckins(true);
    fetch(`${BACKEND_URL}/api/attendance/my-checkins?wallet=${encodeURIComponent(user.address)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.checkins) setCheckins(data.checkins);
      })
      .catch(() => {})
      .finally(() => setLoadingCheckins(false));
  }, [user?.address]);

  const fetchEvents = useCallback(() => {
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(() => {});
  }, []);

  const fetchTokens = useCallback(() => {
    if (!user?.address) return;
    fetch(`${BACKEND_URL}/api/relay/token-history/${encodeURIComponent(user.address)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.balance !== undefined) setTokenBalance(data.balance);
        if (data.transactions) setTokenHistory(data.transactions);
      })
      .catch(() => {});
  }, [user?.address]);

  const fetchBadges = useCallback(async () => {
    if (!user?.address) return;
    try {
      const raw = await getMyBadges(user.address);
      const enriched = await Promise.all(raw.map(enrichBadge));
      setBadges(enriched);
    } catch { /* contract may not be deployed yet — leave empty */ }
  }, [user?.address]);

  useEffect(() => {
    fetchCertificates();
    fetchCheckins();
    fetchEvents();
    fetchTokens();
    fetchBadges();
  }, [fetchCertificates, fetchCheckins, fetchEvents, fetchTokens, fetchBadges]);

  const eventsAttended = checkins.length;
  const badgesEarned = badges.length;
  const certsEarned = certificates.length;
  const role = user?.role || "attendee";

  const tabs = [
    { id: "badges" as const, label: "Badges", icon: "military_tech", count: badgesEarned },
    { id: "certificates" as const, label: "Certificates", icon: "workspace_premium", count: certsEarned },
    { id: "tokens" as const, label: "VRYF Tokens", icon: "token", count: tokenBalance },
    { id: "activity" as const, label: "Activity", icon: "timeline", count: eventsAttended },
  ];

  return (
    <div className="space-y-8">
      {/* Profile header */}
      <div className="relative">
        <div className="h-48 md:h-56 rounded-2xl overflow-hidden prism-gradient">
          <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
          <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-white/5" />
        </div>
        <div className="relative -mt-16 px-6 flex flex-col sm:flex-row items-start sm:items-end gap-4">
          <div className="w-28 h-28 rounded-2xl bg-surface-container-lowest border-4 border-surface flex items-center justify-center shadow-ambient-lg">
            <span className="text-4xl font-bold font-headline text-primary">
              {displayName.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 pb-2">
            <h1 className="text-2xl font-bold font-headline text-on-surface">{displayName}</h1>
            {user?.email && (
              <p className="text-sm text-on-surface-variant mt-0.5">{user.email}</p>
            )}
            {shortAddr && (
              <p className="text-sm text-on-surface-variant font-mono mt-1">{shortAddr}</p>
            )}
            <div className="flex items-center gap-2 mt-2">
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                role === "admin" ? "bg-red-50 text-red-700" :
                role === "organizer" ? "bg-blue-50 text-blue-700" :
                "bg-emerald-50 text-emerald-700"
              }`}>
                <span className="material-symbols-outlined text-sm">
                  {role === "admin" ? "admin_panel_settings" : role === "organizer" ? "event" : "person"}
                </span>
                {role.charAt(0).toUpperCase() + role.slice(1)}
              </span>
              {user?.ensName && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
                  <span className="material-symbols-outlined text-sm">verified</span>
                  ENS Verified
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Stats — click a card to jump to that tab */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: "check_circle", label: "Events Attended", value: String(eventsAttended), accent: "text-emerald-600", bg: "bg-emerald-50", tab: "activity" as const },
          { icon: "military_tech", label: "Badges Earned", value: String(badgesEarned), accent: "text-amber-600", bg: "bg-amber-50", tab: "badges" as const },
          { icon: "workspace_premium", label: "Certificates", value: String(certsEarned), accent: "text-primary", bg: "bg-primary-fixed/30", tab: "certificates" as const },
          { icon: "token", label: "VRYF Balance", value: String(tokenBalance), accent: "text-indigo-600", bg: "bg-indigo-50", tab: "tokens" as const },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={() => setActiveTab(stat.tab)}
            className={`group text-left bg-surface-container-lowest rounded-xl p-5 shadow-ambient border transition-all hover:-translate-y-0.5 hover:shadow-ambient-lg relative ${
              activeTab === stat.tab ? "border-primary ring-2 ring-primary/20" : "border-outline-variant/10"
            }`}
          >
            <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
              <span className={`material-symbols-outlined ${stat.accent}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-bold font-headline text-on-surface">{stat.value}</p>
            <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider mt-1">{stat.label}</p>
            <span className="absolute top-3 right-3 material-symbols-outlined text-sm text-outline group-hover:text-primary transition-colors">
              arrow_outward
            </span>
          </button>
        ))}
      </div>

      {/* Tabs */}
      <div className="border-b border-outline-variant/20">
        <div className="flex gap-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-bold font-headline transition-colors border-b-2 ${
                activeTab === tab.id
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              <span className="material-symbols-outlined text-lg">{tab.icon}</span>
              {tab.label}
              {tab.count > 0 && (
                <span className="ml-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs font-bold">{tab.count}</span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div>
        {activeTab === "badges" && (
          <>
            {badges.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {badges.map((b) => (
                  <div
                    key={b.tokenId}
                    className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg transition-all"
                  >
                    <div className="aspect-square rounded-xl overflow-hidden bg-surface-container-high mb-4 flex items-center justify-center">
                      {b.resolvedImage ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={b.resolvedImage} alt={b.resolvedName || `Badge #${b.tokenId}`} className="w-full h-full object-cover" />
                      ) : (
                        <span className="material-symbols-outlined text-6xl text-on-surface-variant">military_tech</span>
                      )}
                    </div>
                    <p className="font-bold text-sm text-on-surface truncate">
                      {b.resolvedName || `POAP Badge #${b.tokenId}`}
                    </p>
                    <p className="text-xs text-on-surface-variant mt-0.5 font-mono">
                      Token #{b.tokenId} · Event #{b.eventId}
                    </p>
                    <div className="mt-3 pt-3 border-t border-outline-variant/10 flex items-center justify-between gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700 font-bold">
                        <span className="material-symbols-outlined text-xs">lock</span>
                        Soulbound
                      </span>
                      <button
                        onClick={() => watchNftInMetaMask(b.contract, b.tokenId)}
                        className="text-[11px] text-primary font-bold hover:underline"
                      >
                        Add to MetaMask
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : checkins.length > 0 ? (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-5xl text-amber-400 mb-4 block">military_tech</span>
                <h3 className="text-lg font-bold font-headline text-on-surface mb-2">Badges Available</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto mb-4">
                  You&apos;ve attended {checkins.length} event{checkins.length > 1 ? "s" : ""}! Visit the Claim Center to mint your POAP badges.
                </p>
                <a href="/claim" className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg prism-gradient text-white text-sm font-bold">
                  <span className="material-symbols-outlined text-sm">redeem</span>
                  Go to Claim Center
                </a>
              </div>
            ) : (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-5xl text-outline mb-4 block">military_tech</span>
                <h3 className="text-lg font-bold font-headline text-on-surface mb-2">No Badges Yet</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto">
                  Attend events and check in to earn soulbound POAP badges.
                </p>
              </div>
            )}
          </>
        )}

        {activeTab === "certificates" && (
          <>
            {loadingCerts ? (
              <div className="flex justify-center py-12"><div className="spinner text-primary" /></div>
            ) : certificates.length > 0 ? (
              <div className="space-y-4">
                {certificates.map((cert) => (
                  <button
                    key={cert.certId}
                    onClick={() => setSelectedCert(cert)}
                    className="w-full text-left bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 flex items-center gap-4 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all"
                  >
                    <div className="w-14 h-14 rounded-xl bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-emerald-600 text-2xl">workspace_premium</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-on-surface">{cert.eventName}</p>
                      <div className="flex items-center gap-4 mt-1 text-xs text-on-surface-variant flex-wrap">
                        <span>Certificate #{cert.certId}</span>
                        <span>Event #{cert.eventId}</span>
                        <span>{new Date(cert.timestamp * 1000).toLocaleDateString()}</span>
                        <span className="inline-flex items-center gap-1">
                          <span className="material-symbols-outlined text-xs">{cert.onChain ? "link" : "cloud"}</span>
                          {cert.onChain ? "On-Chain" : "Off-Chain"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-3 flex-shrink-0">
                      <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${
                        cert.isValid ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                      }`}>
                        <span className="material-symbols-outlined text-sm">{cert.isValid ? "verified" : "cancel"}</span>
                        {cert.isValid ? "Valid" : "Revoked"}
                      </span>
                      <span className="material-symbols-outlined text-on-surface-variant">chevron_right</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-5xl text-outline mb-4 block">workspace_premium</span>
                <h3 className="text-lg font-bold font-headline text-on-surface mb-2">No Certificates Yet</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto">
                  Complete event attendance requirements to earn on-chain certificates.
                </p>
              </div>
            )}
          </>
        )}

        {activeTab === "tokens" && (
          <>
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 mb-6">
              <div className="flex items-center gap-4">
                <div className="w-16 h-16 rounded-xl prism-gradient flex items-center justify-center">
                  <span className="material-symbols-outlined text-white text-3xl">token</span>
                </div>
                <div>
                  <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider">Total Balance</p>
                  <p className="text-3xl font-bold font-headline text-on-surface">{tokenBalance} <span className="text-lg text-primary">VRYF</span></p>
                </div>
              </div>
            </div>
            {tokenHistory.length > 0 ? (
              <div className="space-y-3">
                <h3 className="text-sm font-bold font-headline text-on-surface">Transaction History</h3>
                {tokenHistory.sort((a, b) => b.timestamp - a.timestamp).map((tx) => (
                  <div key={tx.id} className="bg-surface-container-lowest rounded-xl p-4 shadow-ambient border border-outline-variant/10 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-emerald-600">add_circle</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-on-surface">+{tx.amount} VRYF</p>
                      <p className="text-xs text-on-surface-variant">{tx.reason}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-xs text-on-surface-variant">{new Date(tx.timestamp).toLocaleDateString()}</p>
                      <p className="text-xs font-mono text-on-surface-variant">Bal: {tx.balance}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-5xl text-outline mb-4 block">token</span>
                <h3 className="text-lg font-bold font-headline text-on-surface mb-2">No Tokens Yet</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto">
                  Earn VRYF tokens by checking into events (+10), claiming badges (+30), and earning certificates (+60).
                </p>
              </div>
            )}
          </>
        )}

        {activeTab === "activity" && (
          <>
            {loadingCheckins ? (
              <div className="flex justify-center py-12"><div className="spinner text-primary" /></div>
            ) : checkins.length > 0 ? (
              <div className="space-y-3">
                {checkins.sort((a, b) => b.timestamp - a.timestamp).map((ci, i) => (
                  <div key={`${ci.eventId}-${i}`} className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10 flex items-center gap-4">
                    <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                      <span className="material-symbols-outlined text-emerald-600">check_circle</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-bold text-sm text-on-surface">{ci.eventName}</p>
                      <div className="flex items-center gap-3 mt-1 text-xs text-on-surface-variant">
                        <span>Checked in</span>
                        <span>{new Date(ci.timestamp).toLocaleString()}</span>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-bold ${
                      ci.eventStatus === "live" ? "bg-emerald-50 text-emerald-700" :
                      ci.eventStatus === "ended" ? "bg-gray-100 text-gray-600" :
                      "bg-blue-50 text-blue-700"
                    }`}>
                      {ci.eventStatus === "live" ? "Live" : ci.eventStatus === "ended" ? "Ended" : ci.eventStatus}
                    </span>
                  </div>
                ))}
              </div>
            ) : events.length > 0 ? (
              <div className="text-center py-12">
                <span className="material-symbols-outlined text-5xl text-outline mb-4 block">timeline</span>
                <h3 className="text-lg font-bold font-headline text-on-surface mb-2">No Check-ins Yet</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto">
                  Join an active event and check in to start building your activity history.
                </p>
              </div>
            ) : (
              <div className="text-center py-16">
                <span className="material-symbols-outlined text-5xl text-outline mb-4 block">timeline</span>
                <h3 className="text-lg font-bold font-headline text-on-surface mb-2">No Activity Yet</h3>
                <p className="text-on-surface-variant text-sm max-w-md mx-auto">
                  Your on-chain activity and event history will be tracked here.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* Certificate Detail Modal */}
      {selectedCert && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={() => setSelectedCert(null)}
        >
          <div
            className="bg-surface-container-lowest rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="prism-gradient p-6 text-white">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-xs font-label uppercase tracking-wider opacity-80">Certificate of Attendance</p>
                  <h2 className="text-2xl font-bold font-headline mt-1">{selectedCert.eventName}</h2>
                  <p className="text-sm opacity-80 mt-1">Certificate #{selectedCert.certId}</p>
                </div>
                <button
                  onClick={() => setSelectedCert(null)}
                  className="text-white/80 hover:text-white"
                  aria-label="Close"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>
            </div>

            <div className="p-6 space-y-4">
              {/* Status banner */}
              <div className={`p-4 rounded-xl flex items-center gap-3 ${
                selectedCert.isValid ? "bg-emerald-50 border border-emerald-200" : "bg-red-50 border border-red-200"
              }`}>
                <span className={`material-symbols-outlined text-2xl ${
                  selectedCert.isValid ? "text-emerald-600" : "text-red-600"
                }`}>
                  {selectedCert.isValid ? "verified" : "cancel"}
                </span>
                <div>
                  <p className={`font-bold text-sm ${selectedCert.isValid ? "text-emerald-800" : "text-red-800"}`}>
                    {selectedCert.isValid ? "Certificate is Valid" : "Certificate Revoked"}
                  </p>
                  <p className={`text-xs ${selectedCert.isValid ? "text-emerald-600" : "text-red-600"}`}>
                    {selectedCert.onChain
                      ? `Stored on-chain (Sepolia testnet)`
                      : `Stored in VRYFD verified off-chain store`}
                  </p>
                </div>
              </div>

              {/* Details grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">Certificate ID</p>
                  <p className="text-sm font-bold text-on-surface mt-1 font-mono">#{selectedCert.certId}</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">Event ID</p>
                  <p className="text-sm font-bold text-on-surface mt-1 font-mono">#{selectedCert.eventId}</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-low col-span-2">
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">Issued To</p>
                  <p className="text-sm font-bold text-on-surface mt-1 font-mono break-all">{selectedCert.attendee}</p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">Issued On</p>
                  <p className="text-sm font-bold text-on-surface mt-1">
                    {new Date(selectedCert.timestamp * 1000).toLocaleString()}
                  </p>
                </div>
                <div className="p-4 rounded-lg bg-surface-container-low">
                  <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">Storage</p>
                  <p className="text-sm font-bold text-on-surface mt-1 flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm text-primary">
                      {selectedCert.onChain ? "link" : "cloud"}
                    </span>
                    {selectedCert.onChain ? "On-Chain (Sepolia)" : "VRYFD Off-Chain"}
                  </p>
                </div>
                {selectedCert.metadataURI && (
                  <div className="p-4 rounded-lg bg-surface-container-low col-span-2">
                    <p className="text-[10px] text-on-surface-variant font-label uppercase tracking-wider">Metadata URI</p>
                    <p className="text-xs font-mono text-on-surface mt-1 break-all">{selectedCert.metadataURI}</p>
                  </div>
                )}
              </div>

              {/* Transaction details */}
              <div className="p-4 rounded-xl border border-outline-variant/15">
                <h4 className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-3 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">receipt_long</span>
                  Transaction Details
                </h4>
                {selectedCert.onChain && selectedCert.txHash ? (
                  <div className="space-y-2">
                    <div>
                      <p className="text-[10px] text-on-surface-variant uppercase tracking-wider">Transaction Hash</p>
                      <p className="text-xs font-mono text-on-surface mt-0.5 break-all">{selectedCert.txHash}</p>
                    </div>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${selectedCert.txHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-primary text-xs font-bold hover:underline"
                    >
                      <span className="material-symbols-outlined text-sm">open_in_new</span>
                      View on Etherscan
                    </a>
                  </div>
                ) : selectedCert.onChain ? (
                  <div className="space-y-2">
                    <p className="text-xs text-on-surface-variant">
                      This certificate is recorded on-chain via the VRYFD Attendance contract on Sepolia testnet.
                    </p>
                    {CONTRACT_ADDRESS && (
                      <a
                        href={`https://sepolia.etherscan.io/address/${CONTRACT_ADDRESS}#events`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-primary text-xs font-bold hover:underline"
                      >
                        <span className="material-symbols-outlined text-sm">open_in_new</span>
                        View Contract on Etherscan
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs text-on-surface-variant">
                      Issued via VRYFD off-chain ledger (local Hardhat node not running).
                      The certificate is still verifiable and can be promoted on-chain when blockchain is available.
                    </p>
                    <p className="text-[10px] text-on-surface-variant font-mono mt-2">
                      Ledger ID: cert-{selectedCert.eventId}-{selectedCert.timestamp}
                    </p>
                  </div>
                )}
              </div>

              {/* Token rewards */}
              <div className="p-4 rounded-xl bg-indigo-50 border border-indigo-100">
                <h4 className="text-xs font-label font-bold text-indigo-700 uppercase tracking-wider mb-3 flex items-center gap-1">
                  <span className="material-symbols-outlined text-sm">token</span>
                  VRYF Token Rewards
                </h4>
                <div className="space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-emerald-600">login</span>
                      Check-in
                    </span>
                    <span className="font-bold text-on-surface">+{REWARD_CHECKIN} VRYF</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-amber-600">military_tech</span>
                      Badge claim
                    </span>
                    <span className="font-bold text-on-surface">+{REWARD_BADGE} VRYF</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-on-surface-variant flex items-center gap-2">
                      <span className="material-symbols-outlined text-base text-primary">workspace_premium</span>
                      Certificate
                    </span>
                    <span className="font-bold text-on-surface">+{REWARD_CERTIFICATE} VRYF</span>
                  </div>
                  <div className="flex items-center justify-between pt-2 border-t border-indigo-200">
                    <span className="font-bold text-indigo-700">Total earned</span>
                    <span className="font-bold text-indigo-700">{REWARD_CHECKIN + REWARD_BADGE + REWARD_CERTIFICATE} VRYF</span>
                  </div>
                </div>
                <p className="text-[10px] text-indigo-600 mt-3">
                  Tokens are credited automatically when you check in and claim your certificate.
                </p>
              </div>

              {/* Actions */}
              <div className="flex flex-col sm:flex-row gap-2 pt-2">
                <a
                  href={`/certificate/${selectedCert.certId}`}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl prism-gradient text-white text-sm font-bold active:scale-[0.98] transition-all"
                >
                  <span className="material-symbols-outlined text-base">workspace_premium</span>
                  View Certificate
                </a>
                <a
                  href={`/verify?id=${selectedCert.certId}`}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-surface-container text-on-surface text-sm font-bold hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-base">verified</span>
                  Verify Page
                </a>
                <button
                  onClick={() => {
                    const url = `${window.location.origin}/certificate/${selectedCert.certId}`;
                    navigator.clipboard.writeText(url);
                  }}
                  className="flex-1 inline-flex items-center justify-center gap-2 py-3 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-bold hover:bg-emerald-100 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">share</span>
                  Copy Link
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
