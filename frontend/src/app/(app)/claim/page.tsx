"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../../../contexts/AuthContext";
import {
  claimBadgeGasless,
  getMyBadges,
  watchNftInMetaMask,
  type MyBadge,
} from "../../../lib/badgeApi";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface EventItem {
  id: number;
  onChainId?: string;
  eventId?: string;
  name: string;
  active?: boolean;
  status?: string;
  attendeeCount?: number;
  attendees?: number;
  createdBy?: string;
}

interface BadgeEventState {
  configured: boolean;
  metadataURI: string;
  claimed: boolean;
  eligible: boolean;
}

interface EnrichedBadge extends MyBadge {
  resolvedImage?: string | null;
  resolvedName?: string | null;
}

function ipfsToHttp(uri: string | null | undefined): string | null {
  if (!uri) return null;
  if (uri.startsWith("ipfs://")) return `https://gateway.pinata.cloud/ipfs/${uri.slice(7)}`;
  return uri;
}

async function resolveBadgeMetadata(b: MyBadge): Promise<EnrichedBadge> {
  const httpUri = ipfsToHttp(b.tokenURI);
  if (!httpUri) return { ...b };
  try {
    const res = await fetch(httpUri, { cache: "force-cache" });
    if (!res.ok) return { ...b };
    const meta = await res.json();
    return {
      ...b,
      resolvedImage: ipfsToHttp(meta?.image),
      resolvedName: meta?.name || null,
    };
  } catch {
    return { ...b };
  }
}

export default function ClaimPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<EventItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [claimingId, setClaimingId] = useState<string | null>(null);
  const [claimResult, setClaimResult] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [badges, setBadges] = useState<EnrichedBadge[]>([]);
  const [certificates, setCertificates] = useState<Record<string, number>>({}); // eventId -> certId
  const [badgeState, setBadgeState] = useState<Record<string, BadgeEventState>>({});
  const [certCount, setCertCount] = useState(0);

  const fetchEvents = useCallback(() => {
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const fetchCertificates = useCallback(() => {
    if (!user?.address) return;
    fetch(`${BACKEND_URL}/api/certificates/mine/${encodeURIComponent(user.address)}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.certificates) {
          const map: Record<string, number> = {};
          for (const c of data.certificates) map[String(c.eventId)] = c.certId;
          setCertificates(map);
          setCertCount(data.certificates.length);
        }
      })
      .catch(() => {});
  }, [user?.address]);

  const fetchBadges = useCallback(async () => {
    if (!user?.address) return;
    try {
      const raw = await getMyBadges(user.address);
      const enriched = await Promise.all(raw.map(resolveBadgeMetadata));
      setBadges(enriched);
    } catch { /* badge contract may not be deployed yet */ }
  }, [user?.address]);

  // For each known event, fetch (a) whether organizer has set badge metadata, (b) whether I've claimed,
  // (c) whether I'm eligible (threshold met). Runs in parallel.
  const refreshBadgeStates = useCallback(async (eventIds: string[]) => {
    if (!user?.address) return;
    const entries = await Promise.all(
      eventIds.map(async (eid) => {
        try {
          const [ev, status] = await Promise.all([
            fetch(`${BACKEND_URL}/api/badge/event/${eid}`).then((r) => r.json()).catch(() => ({})),
            fetch(
              `${BACKEND_URL}/api/badge/claim-status?eventId=${eid}&address=${encodeURIComponent(user.address!)}`
            ).then((r) => r.json()).catch(() => ({})),
          ]);
          const state: BadgeEventState = {
            configured: Boolean(ev?.configured),
            metadataURI: ev?.metadataURI || "",
            claimed: Boolean(status?.claimed),
            eligible: Boolean(status?.eligible),
          };
          return [eid, state] as const;
        } catch {
          return [eid, { configured: false, metadataURI: "", claimed: false, eligible: false }] as const;
        }
      })
    );
    setBadgeState((prev) => ({ ...prev, ...Object.fromEntries(entries) }));
  }, [user?.address]);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);
  useEffect(() => { fetchCertificates(); }, [fetchCertificates]);
  useEffect(() => { fetchBadges(); }, [fetchBadges]);
  useEffect(() => {
    if (!user?.address || events.length === 0) return;
    const ids = events.map((ev) => getEventId(ev)).filter(Boolean) as string[];
    refreshBadgeStates(ids);
  }, [user?.address, events, refreshBadgeStates]);

  const getEventId = (ev: EventItem) => ev.onChainId || ev.eventId || String(ev.id);

  const handleClaimBadge = async (ev: EventItem) => {
    const eid = getEventId(ev);
    if (!user?.address) {
      setClaimResult({ type: "error", text: "Connect your wallet to claim a badge." });
      return;
    }
    setClaimingId(`badge-${eid}`);
    setClaimResult(null);
    try {
      const result = await claimBadgeGasless(user.address, eid);
      await fetchBadges();
      await refreshBadgeStates([eid]);
      let toastMsg = `POAP badge minted for "${ev.name}"!`;
      if (result.tokenId && result.contract) {
        const added = await watchNftInMetaMask(result.contract, result.tokenId);
        toastMsg = added
          ? `POAP badge #${result.tokenId} minted and added to MetaMask!`
          : `POAP badge #${result.tokenId} minted. Open MetaMask → NFTs → "Import NFT" and paste contract ${result.contract.slice(0, 8)}… tokenId ${result.tokenId} if it doesn't auto-appear.`;
      }
      setClaimResult({ type: "success", text: toastMsg });
    } catch (err: unknown) {
      console.error("[claim] POAP claim failed:", err);
      const e = err as { code?: number; message?: string; error?: string };
      const rawMsg = e?.message || e?.error || (err instanceof Error ? err.message : String(err));
      if (e?.code === 4001 || /user rejected/i.test(rawMsg)) {
        setClaimResult({ type: "error", text: "You cancelled the signature request" });
      } else {
        setClaimResult({ type: "error", text: rawMsg || "Failed to claim badge — open browser console for details" });
      }
    } finally {
      setClaimingId(null);
    }
  };

  const handleClaimCertificate = async (ev: EventItem) => {
    const eid = getEventId(ev);
    if (!user?.address) {
      setClaimResult({ type: "error", text: "Connect your wallet to claim a certificate." });
      return;
    }
    const eth = (globalThis as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
    if (!eth) {
      setClaimResult({ type: "error", text: "MetaMask not detected — please install or unlock it." });
      return;
    }
    setClaimingId(`cert-${eid}`);
    setClaimResult(null);
    try {
      const issuedAt = Date.now();
      const message =
        `VRYFD – Claim Certificate\n\n` +
        `Event: ${eid}\n` +
        `Attendee: ${user.address.toLowerCase()}\n` +
        `Issued At: ${issuedAt}`;

      const signature = (await eth.request({
        method: "personal_sign",
        params: [message, user.address],
      })) as string;

      const res = await fetch(`${BACKEND_URL}/api/attendance/claim-certificate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventId: Number(eid),
          attendee: user.address,
          issuedAt,
          signature,
        }),
      });
      const text = await res.text();
      let data: { success?: boolean; error?: string; certificateId?: string; txHash?: string } = {};
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 120) }; }

      if (res.ok && data.success) {
        setClaimResult({
          type: "success",
          text: `Certificate #${data.certificateId} minted for "${ev.name}" — no gas charged. +60 VRYF credited!`,
        });
        fetchCertificates();
      } else if (res.status === 409 || data.error?.toLowerCase().includes("already")) {
        setClaimResult({ type: "success", text: `Certificate already issued for "${ev.name}"` });
        fetchCertificates();
      } else {
        setClaimResult({ type: "error", text: data.error || "Failed to issue certificate" });
      }
    } catch (err: unknown) {
      const rawMsg = err instanceof Error ? err.message : "Network error";
      const code = (err as { code?: number })?.code;
      if (code === 4001 || /user rejected/i.test(rawMsg)) {
        setClaimResult({ type: "error", text: "You cancelled the signature request" });
      } else {
        setClaimResult({ type: "error", text: rawMsg });
      }
    } finally {
      setClaimingId(null);
    }
  };

  const activeEvents = events.filter((ev) => ev.active || ev.status === "live");
  const endedEvents = events.filter((ev) => !ev.active && ev.status !== "live");

  // Determine if the current user is the organizer of this event so we can
  // show a direct "Configure badge" CTA instead of a passive "Badge pending" pill.
  const isOrganizerRole = user?.role === "admin" || user?.role === "organizer";
  const isOrganizerOfEvent = (ev: EventItem) => {
    if (!isOrganizerRole) return false;
    const email = (user?.email || "").toLowerCase();
    const createdBy = (ev.createdBy || "").toLowerCase();
    return user?.role === "admin" || (email && email === createdBy);
  };

  const renderEventRow = (ev: EventItem) => {
    const eid = getEventId(ev);
    const bs = badgeState[eid];
    const certId = certificates[eid];
    const certClaimed = Boolean(certId);
    const badgeClaimed = Boolean(bs?.claimed);
    const eligible = Boolean(bs?.eligible);
    const badgeReady = Boolean(bs?.configured);
    const iAmOrganizer = isOrganizerOfEvent(ev);

    let badgeBtn: React.ReactNode;
    if (badgeClaimed) {
      badgeBtn = (
        <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          Badge claimed
        </span>
      );
    } else if (!badgeReady) {
      badgeBtn = iAmOrganizer ? (
        <Link
          href={`/organizer/events/${eid}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold active:scale-95 transition-all hover:bg-amber-600"
          title="You're the organizer — click to set this event's POAP badge artwork"
        >
          <span className="material-symbols-outlined text-sm">edit</span>
          Configure badge
        </Link>
      ) : (
        <span
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-container text-on-surface-variant text-xs font-bold"
          title="The organizer hasn't configured the POAP badge for this event yet."
        >
          <span className="material-symbols-outlined text-sm">hourglass_empty</span>
          Badge pending
        </span>
      );
    } else if (!eligible) {
      badgeBtn = (
        <span
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold"
          title="You haven't reached the event's attendance threshold yet."
        >
          <span className="material-symbols-outlined text-sm">lock</span>
          Threshold not met
        </span>
      );
    } else {
      badgeBtn = (
        <button
          onClick={() => handleClaimBadge(ev)}
          disabled={claimingId === `badge-${eid}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-500 text-white text-xs font-bold active:scale-95 transition-all disabled:opacity-50 hover:bg-amber-600"
        >
          {claimingId === `badge-${eid}` ? (
            <div className="spinner text-white" style={{ width: 14, height: 14 }} />
          ) : (
            <>
              <span className="material-symbols-outlined text-sm">military_tech</span>
              Claim POAP
            </>
          )}
        </button>
      );
    }

    let certBtn: React.ReactNode;
    if (certClaimed) {
      certBtn = (
        <span className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold">
          <span className="material-symbols-outlined text-sm">check_circle</span>
          Certificate issued
        </span>
      );
    } else if (bs && !eligible) {
      // bs is loaded and we know the attendee hasn't reached the threshold yet
      certBtn = (
        <span
          className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-amber-50 text-amber-700 text-xs font-bold"
          title="You haven't reached the event's attendance threshold yet."
        >
          <span className="material-symbols-outlined text-sm">lock</span>
          Threshold not met
        </span>
      );
    } else {
      certBtn = (
        <button
          onClick={() => handleClaimCertificate(ev)}
          disabled={claimingId === `cert-${eid}`}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg prism-gradient text-white text-xs font-bold active:scale-95 transition-all disabled:opacity-50"
        >
          {claimingId === `cert-${eid}` ? (
            <div className="spinner text-white" style={{ width: 14, height: 14 }} />
          ) : (
            <>
              <span className="material-symbols-outlined text-sm">workspace_premium</span>
              Claim Certificate
            </>
          )}
        </button>
      );
    }

    return (
      <div key={eid} className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 px-6 py-4 hover:bg-surface-container-low/50 transition-colors">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-10 h-10 rounded-lg prism-gradient flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
            {(ev.name || "E").charAt(0)}
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm text-on-surface truncate">{ev.name}</p>
            <div className="flex items-center gap-3 mt-1">
              {ev.active || ev.status === "live" ? (
                <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  Active
                </span>
              ) : (
                <span className="text-xs text-on-surface-variant">Ended</span>
              )}
              <span className="text-xs text-on-surface-variant">{ev.attendeeCount || ev.attendees || 0} attendees</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {badgeBtn}
          {certBtn}
        </div>
      </div>
    );
  };

  // Count events where the current user is the organizer AND badge isn't configured yet.
  const pendingBadgeEventsForOrganizer = events.filter((ev) => {
    const eid = getEventId(ev);
    return isOrganizerOfEvent(ev) && badgeState[eid] && !badgeState[eid].configured;
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold font-headline text-on-surface">Claim Center</h1>
        <p className="text-on-surface-variant text-sm mt-1">Claim your POAP badges and verifiable certificates</p>
      </div>

      {pendingBadgeEventsForOrganizer.length > 0 && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <span className="material-symbols-outlined text-amber-600 mt-0.5">info</span>
          <div className="flex-1">
            <p className="text-sm font-bold text-amber-800">
              {pendingBadgeEventsForOrganizer.length} event
              {pendingBadgeEventsForOrganizer.length > 1 ? "s" : ""} missing a POAP badge
            </p>
            <p className="text-xs text-amber-700 mt-0.5">
              You&apos;re the organizer. Attendees can&apos;t claim a POAP until you upload
              the badge artwork (or paste a metadata URI) on each event&apos;s page.
              Click &ldquo;Configure badge&rdquo; below to set it up.
            </p>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 border-l-[3px] border-l-amber-500">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-amber-600 text-xl">military_tech</span>
            <span className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">POAP Badges</span>
          </div>
          <p className="text-3xl font-bold font-headline text-on-surface">{badges.length}</p>
          <p className="text-xs text-on-surface-variant mt-1">Soulbound ERC-721 NFTs owned</p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 border-l-[3px] border-l-emerald-500">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-emerald-600 text-xl">workspace_premium</span>
            <span className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Certificates</span>
          </div>
          <p className="text-3xl font-bold font-headline text-on-surface">{certCount}</p>
          <p className="text-xs text-on-surface-variant mt-1">Verified certificates</p>
        </div>
        <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 border-l-[3px] border-l-primary">
          <div className="flex items-center gap-3 mb-3">
            <span className="material-symbols-outlined text-primary text-xl">token</span>
            <span className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Events Attended</span>
          </div>
          <p className="text-3xl font-bold font-headline text-on-surface">{events.length}</p>
          <p className="text-xs text-on-surface-variant mt-1">Total events on platform</p>
        </div>
      </div>

      {/* My POAP Badges */}
      {badges.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
          <div className="px-6 py-4 border-b border-outline-variant/10">
            <h2 className="font-bold font-headline text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-amber-600">military_tech</span>
              My POAP Badges
            </h2>
          </div>
          <div className="p-6 grid grid-cols-2 md:grid-cols-4 gap-4">
            {badges.map((b) => (
              <div key={b.tokenId} className="bg-surface-container-low rounded-xl p-3 border border-outline-variant/10">
                <div className="aspect-square rounded-lg overflow-hidden bg-surface-container-high flex items-center justify-center mb-2">
                  {b.resolvedImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={b.resolvedImage} alt={b.resolvedName || `Badge #${b.tokenId}`} className="w-full h-full object-cover" />
                  ) : (
                    <span className="material-symbols-outlined text-4xl text-on-surface-variant">military_tech</span>
                  )}
                </div>
                <p className="text-xs font-bold text-on-surface truncate">{b.resolvedName || `Badge #${b.tokenId}`}</p>
                <p className="text-[10px] text-on-surface-variant font-mono">Token #{b.tokenId} · Event #{b.eventId}</p>
                <button
                  onClick={() => watchNftInMetaMask(b.contract, b.tokenId)}
                  className="mt-2 w-full text-[10px] text-primary font-bold hover:underline"
                >
                  Add to MetaMask
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Events */}
      {activeEvents.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
          <div className="px-6 py-4 border-b border-outline-variant/10">
            <h2 className="font-bold font-headline text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">event_available</span>
              Active Events
            </h2>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {activeEvents.map(renderEventRow)}
          </div>
        </div>
      )}

      {/* Ended Events */}
      {endedEvents.length > 0 && (
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
          <div className="px-6 py-4 border-b border-outline-variant/10">
            <h2 className="font-bold font-headline text-on-surface flex items-center gap-2">
              <span className="material-symbols-outlined text-on-surface-variant">history</span>
              Past Events
            </h2>
          </div>
          <div className="divide-y divide-outline-variant/10">
            {endedEvents.map(renderEventRow)}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && events.length === 0 && (
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 p-12 text-center">
          <span className="material-symbols-outlined text-5xl text-outline mb-4 block">inbox</span>
          <p className="text-on-surface-variant text-sm">No events available. Events created by organizers will appear here.</p>
        </div>
      )}

      {/* Info card for browsing certificates */}
      {Object.keys(certificates).length > 0 && (
        <div className="bg-primary/5 rounded-xl p-4 border border-primary/20 text-center">
          <Link href="/profile?tab=certificates" className="text-sm text-primary font-bold hover:underline">
            View all your certificates in your profile →
          </Link>
        </div>
      )}

      {/* Toast */}
      {claimResult && (
        <div className={`fixed bottom-6 right-6 max-w-sm px-5 py-4 rounded-xl shadow-ambient-lg border z-50 flex items-start gap-3 fade-up ${
          claimResult.type === "error"
            ? "bg-white border-error/20 text-error"
            : "bg-white border-emerald-200 text-emerald-700"
        }`}>
          <span className="material-symbols-outlined flex-shrink-0">
            {claimResult.type === "error" ? "error" : "check_circle"}
          </span>
          <span className="text-sm">{claimResult.text}</span>
          <button onClick={() => setClaimResult(null)} className="ml-auto text-on-surface-variant hover:text-on-surface flex-shrink-0">
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>
      )}
    </div>
  );
}
