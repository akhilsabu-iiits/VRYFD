"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "../../../../../contexts/AuthContext";
import {
  getEventBadge,
  setEventBadgeMetadata,
  uploadBadgeArtwork,
} from "../../../../../lib/badgeApi";
import { QRCodeSVG } from "qrcode.react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface EventInfo {
  id: number;
  onChainId?: string | number;
  eventId?: number;
  name: string;
  status: "upcoming" | "live" | "ended";
  active: boolean;
  canCheckIn: boolean;
  canCheckOut: boolean;
  lifecycleStatus?: "not_started" | "live" | "ended";
  startTime: number;
  endTime: number;
  attendeeCount?: number;
  attendanceThreshold?: number;
  durationMinutes?: number;
  organizer?: string;
  createdBy?: string;
  joinCode?: string;
  startedAt?: number;
  endedAt?: number;
  eventType?: number; // 0=Virtual, 1=In-Person, 2=Hybrid (matches on-chain enum)
}

interface AttendeeRow {
  attendee: string;
  email?: string | null;
  name?: string | null;
  checkInTime: number;
  checkOutTime: number | null;
  durationSeconds: number;
  durationMinutes: number;
  currentlyActive: boolean;
}

/**
 * Compute attendance % for an attendee against the EFFECTIVE event duration.
 * "Effective" = actual time the event has been running (not scheduled duration):
 *   - Live event:   now - startedAt
 *   - Ended event:  endedAt - startedAt
 * Passed in as `effectiveEventSeconds`.
 */
function attendancePercent(
  durationSeconds: number,
  effectiveEventSeconds: number,
  _unused?: number
): number {
  if (durationSeconds <= 0 || effectiveEventSeconds <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((durationSeconds / effectiveEventSeconds) * 100)));
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const min = Math.floor(seconds / 60);
  const sec = seconds % 60;
  return sec > 0 ? `${min}m ${sec}s` : `${min}m`;
}

interface IssuedCert {
  certId: number;
  attendee: string;
}

export default function OrganizerEventDetail() {
  const params = useParams();
  const router = useRouter();
  const eventId = params?.id as string;
  const { user } = useAuth();

  const [event, setEvent] = useState<EventInfo | null>(null);
  const [attendees, setAttendees] = useState<AttendeeRow[]>([]);
  const [activeCount, setActiveCount] = useState(0);
  const [issuedCerts, setIssuedCerts] = useState<IssuedCert[]>([]);
  const [pendingRequests, setPendingRequests] = useState<Array<{
    attendee: string;
    name?: string | null;
    email?: string | null;
    requestedAt: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Badge NFT configuration — organizer sets ERC-721 metadata URI per event
  const [badgeURI, setBadgeURI] = useState<string>("");
  const [badgeMode, setBadgeMode] = useState<"upload" | "uri">("upload");
  const [badgeFile, setBadgeFile] = useState<File | null>(null);
  const [badgeFilePreview, setBadgeFilePreview] = useState<string | null>(null);
  const [badgeURIInput, setBadgeURIInput] = useState<string>("");
  const [badgeDescription, setBadgeDescription] = useState<string>("");
  const [badgeMessage, setBadgeMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const badgeFileRef = useRef<HTMLInputElement | null>(null);

  const isAuthorized = user?.role === "admin" || user?.role === "organizer";

  useEffect(() => {
    if (user && !isAuthorized) router.replace("/dashboard");
  }, [user, isAuthorized, router]);

  const authHeaders = useCallback((): Record<string, string> => {
    const token = typeof window !== "undefined" ? localStorage.getItem("vryfd_token") : null;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }, []);

  const fetchEvent = useCallback(async () => {
    const res = await fetch(`${BACKEND_URL}/api/relay/events`);
    const data = await res.json();
    const found = (data.events || []).find(
      (e: any) =>
        String(e.id) === String(eventId) ||
        String(e.eventId) === String(eventId) ||
        String(e.onChainId) === String(eventId)
    );
    setEvent(found || null);
  }, [eventId]);

  const fetchAttendees = useCallback(async () => {
    const onChainId = event?.onChainId || event?.eventId || event?.id || eventId;
    const res = await fetch(`${BACKEND_URL}/api/attendance/event/${onChainId}/attendees`);
    const data = await res.json();
    setAttendees(data.attendees || []);
    setActiveCount(data.activeCount || 0);
  }, [event, eventId]);

  const fetchPending = useCallback(async () => {
    const onChainId = event?.onChainId || event?.eventId || event?.id || eventId;
    try {
      const res = await fetch(
        `${BACKEND_URL}/api/attendance/event/${onChainId}/pending`,
        { headers: authHeaders() }
      );
      if (!res.ok) return;
      const data = await res.json();
      setPendingRequests(data.pending || []);
    } catch { /* best effort */ }
  }, [event, eventId, authHeaders]);

  const handleApprove = async (attendee: string, approved: boolean) => {
    const onChainId = event?.onChainId || event?.eventId || event?.id || eventId;
    setBusy(`approve-${attendee}`);
    try {
      const res = await fetch(`${BACKEND_URL}/api/attendance/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ eventId: Number(onChainId), attendee, approved }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Action failed");
      const shortAddr = `${attendee.slice(0, 8)}…${attendee.slice(-4)}`;
      if (approved) {
        if (data.checkedInOnChain) {
          const txBit = data.checkinTx ? ` (tx ${String(data.checkinTx).slice(0, 10)}…)` : "";
          setMessage({ type: "success", text: `Approved ${shortAddr} — on-chain check-in recorded${txBit}` });
        } else if (data.checkinError) {
          setMessage({
            type: "error",
            text: `Approved ${shortAddr}, but on-chain check-in failed: ${data.checkinError}. Click Approve again to retry.`,
          });
        } else {
          setMessage({ type: "success", text: `Approved ${shortAddr} — they can now join` });
        }
      } else {
        setMessage({ type: "success", text: `Rejected ${shortAddr}` });
      }
      await fetchPending();
      await fetchAttendees();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const fetchBadgeURI = useCallback(async () => {
    const onChainId = event?.onChainId || event?.eventId || event?.id || eventId;
    if (onChainId === undefined || onChainId === null) return;
    try {
      const { metadataURI } = await getEventBadge(onChainId);
      setBadgeURI(metadataURI || "");
    } catch { /* best effort */ }
  }, [event, eventId]);

  const handleBadgeFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setMessage({ type: "error", text: "Badge must be an image (png, jpg, gif, webp, svg)" });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setMessage({ type: "error", text: "Image must be under 5 MB" });
      return;
    }
    setBadgeFile(file);
    const reader = new FileReader();
    reader.onload = () => setBadgeFilePreview(reader.result as string);
    reader.readAsDataURL(file);
  };

  const handleSaveBadge = async () => {
    const onChainId = event?.onChainId || event?.eventId || event?.id || eventId;
    if (onChainId === undefined) return;
    setBusy("save-badge");
    setBadgeMessage(null);
    try {
      let metadataURI = badgeURIInput.trim();
      if (badgeMode === "upload") {
        if (!badgeFile) throw new Error("Pick an image file first");
        try {
          const uploaded = await uploadBadgeArtwork({
            file: badgeFile,
            eventName: event?.name || `Event ${onChainId}`,
            eventId: onChainId,
            description: badgeDescription || undefined,
            eventDate: event?.startTime ? new Date(event.startTime * 1000).toISOString().split("T")[0] : undefined,
            organizer: event?.createdBy || event?.organizer || undefined,
          });
          metadataURI = uploaded.metadataURI;
        } catch (upErr: unknown) {
          const rawMsg = upErr instanceof Error ? upErr.message : String(upErr);
          // Pinata JWT is the most common misconfiguration — surface it clearly.
          if (/Failed to (upload|create) (to IPFS|badge metadata)/i.test(rawMsg) || /pinata/i.test(rawMsg)) {
            throw new Error(
              "IPFS upload failed — the backend's PINATA_JWT is likely missing or invalid. " +
              "Add it to .env and restart, OR switch to \"Paste metadata URI\" and use any hosted JSON URL."
            );
          }
          throw upErr;
        }
      }
      if (!metadataURI) throw new Error("Provide a metadata URI or upload an image");
      await setEventBadgeMetadata(onChainId, metadataURI);
      setBadgeURI(metadataURI);
      setBadgeURIInput("");
      setBadgeFile(null);
      setBadgeFilePreview(null);
      if (badgeFileRef.current) badgeFileRef.current.value = "";
      setBadgeMessage({ type: "success", text: "Badge NFT metadata saved on-chain — attendees can now claim after they meet the attendance threshold." });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Failed to save badge";
      setBadgeMessage({ type: "error", text: msg });
    } finally {
      setBusy(null);
    }
  };

  const fetchIssuedCerts = useCallback(async () => {
    const onChainId = Number(event?.onChainId || event?.eventId || event?.id || eventId);
    if (!onChainId && onChainId !== 0) return;
    // Pull cert list per attendee — best-effort
    const certs: IssuedCert[] = [];
    for (const a of attendees) {
      try {
        const r = await fetch(`${BACKEND_URL}/api/certificates/mine/${a.attendee}`);
        const d = await r.json();
        for (const c of d.certificates || []) {
          if (Number(c.eventId) === onChainId) certs.push({ certId: c.certId, attendee: a.attendee });
        }
      } catch { /* ignore */ }
    }
    setIssuedCerts(certs);
  }, [attendees, event, eventId]);

  useEffect(() => {
    fetchEvent().finally(() => setLoading(false));
  }, [fetchEvent]);

  useEffect(() => {
    if (event) {
      fetchAttendees();
      fetchPending();
      fetchBadgeURI();
    }
  }, [event, fetchAttendees, fetchPending, fetchBadgeURI]);

  useEffect(() => {
    if (attendees.length > 0) fetchIssuedCerts();
  }, [attendees, fetchIssuedCerts]);

  // Auto-refresh attendees + pending while the event is live.
  // Pending polls faster (2s) so organizers see new join requests instantly.
  useEffect(() => {
    if (event?.status !== "live") return;
    const a = setInterval(() => fetchAttendees(), 5000);
    const p = setInterval(() => fetchPending(), 2000);
    return () => { clearInterval(a); clearInterval(p); };
  }, [event?.status, fetchAttendees, fetchPending]);

  const onChainEventId = Number(event?.onChainId || event?.eventId || event?.id || eventId);

  const handleStart = async () => {
    setBusy("start");
    setMessage(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/relay/startEvent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ eventId: onChainEventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to start event");
      setMessage({ type: "success", text: "Event started — attendees can now check in" });
      await fetchEvent();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleEnd = async () => {
    if (!confirm("End this event? Attendees won't be able to check in or out after this.")) return;
    setBusy("end");
    setMessage(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/relay/endEvent`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ eventId: onChainEventId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to end event");
      setMessage({ type: "success", text: "Event ended" });
      await fetchEvent();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleIssueCertificate = async (attendee: string) => {
    setBusy(`cert-${attendee}`);
    setMessage(null);
    try {
      const res = await fetch(`${BACKEND_URL}/api/relay/issueCertificate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          eventId: onChainEventId,
          attendee,
          metadataURI: `ipfs://cert-${onChainEventId}-${Date.now()}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to issue certificate");
      setMessage({
        type: "success",
        text: `Certificate #${data.certId || data.certificateId} issued to ${attendee.slice(0, 10)}…`,
      });
      await fetchIssuedCerts();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  const handleBulkIssue = async () => {
    if (!event) return;
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = event.startedAt ? Math.floor(event.startedAt / 1000) : event.startTime;
    const endSec = event.endedAt ? Math.floor(event.endedAt / 1000) : Math.min(nowSec, event.endTime);
    const effectiveEventSec = Math.max(1, endSec - startSec);
    const threshold = event.attendanceThreshold || 75;
    const eligible = attendees.filter(
      (a) => attendancePercent(a.durationSeconds, effectiveEventSec) >= threshold
    );
    if (eligible.length === 0) {
      setMessage({ type: "error", text: `No attendees have reached the ${threshold}% threshold yet.` });
      return;
    }
    if (!confirm(`Issue certificates to ${eligible.length} eligible attendee(s) (≥${threshold}% attendance)?`)) return;
    setBusy("bulk");
    setMessage(null);
    try {
      let ok = 0;
      let failed = 0;
      for (const a of eligible) {
        try {
          const res = await fetch(`${BACKEND_URL}/api/relay/issueCertificate`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
              eventId: onChainEventId,
              attendee: a.attendee,
              metadataURI: `ipfs://cert-${onChainEventId}-${Date.now()}`,
            }),
          });
          if (res.ok) ok++;
          else failed++;
        } catch {
          failed++;
        }
      }
      setMessage({
        type: ok > 0 ? "success" : "error",
        text: `Issued ${ok} cert(s); ${failed} failed`,
      });
      await fetchIssuedCerts();
    } catch (e: any) {
      setMessage({ type: "error", text: e.message });
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="spinner text-primary" />
      </div>
    );
  }

  if (!event) {
    return (
      <div className="text-center py-20">
        <span className="material-symbols-outlined text-5xl text-outline mb-4 block">event_busy</span>
        <h2 className="text-xl font-bold font-headline mb-2">Event not found</h2>
        <Link href="/organizer" className="text-primary font-bold hover:underline">
          Back to Organizer
        </Link>
      </div>
    );
  }

  const certForAttendee = (addr: string) => issuedCerts.find((c) => c.attendee.toLowerCase() === addr.toLowerCase());

  const statusColor =
    event.status === "live" ? "bg-emerald-50 text-emerald-700"
      : event.status === "ended" ? "bg-gray-100 text-gray-700"
      : "bg-amber-50 text-amber-700";

  const statusDot =
    event.status === "live" ? "bg-emerald-500"
      : event.status === "ended" ? "bg-gray-500"
      : "bg-amber-500";

  return (
    <div className="space-y-6">
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/organizer" className="hover:text-primary">Organizer</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface font-medium">{event.name}</span>
      </nav>

      {/* Header card */}
      <div className="bg-surface-container-lowest rounded-2xl p-6 shadow-ambient border border-outline-variant/10">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold font-headline text-on-surface">{event.name}</h1>
            <div className="flex flex-wrap items-center gap-3 mt-2 text-xs text-on-surface-variant">
              <span className="font-mono">Event #{onChainEventId}</span>
              <span>·</span>
              <span>{new Date(event.startTime * 1000).toLocaleString()}</span>
              <span>—</span>
              <span>{new Date(event.endTime * 1000).toLocaleString()}</span>
            </div>
          </div>
          <span className={`inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${statusColor}`}>
            <span className={`w-2 h-2 rounded-full ${statusDot} ${event.status === "live" ? "animate-pulse" : ""}`} />
            {event.status === "live" ? "Live" : event.status === "ended" ? "Ended" : "Not started"}
          </span>
        </div>

        {/* Lifecycle controls */}
        <div className="flex flex-wrap items-center gap-3 mt-6 pt-6 border-t border-outline-variant/10">
          {event.status !== "live" && event.status !== "ended" && (
            <button
              onClick={handleStart}
              disabled={busy === "start"}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl prism-gradient text-white font-bold text-sm disabled:opacity-50"
            >
              {busy === "start" ? <div className="spinner text-white" style={{ width: 14, height: 14 }} /> :
                <span className="material-symbols-outlined text-base">play_arrow</span>}
              Start Event
            </button>
          )}
          {event.status === "live" && (
            <>
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-sm font-bold">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Check-ins are open
              </span>
              <button
                onClick={handleEnd}
                disabled={busy === "end"}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-50 text-red-700 font-bold text-sm hover:bg-red-100 disabled:opacity-50"
              >
                {busy === "end" ? <div className="spinner text-red-700" style={{ width: 14, height: 14 }} /> :
                  <span className="material-symbols-outlined text-base">stop_circle</span>}
                End Event
              </button>
            </>
          )}
          {event.status === "ended" && (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gray-100 text-gray-600 text-sm font-bold">
              <span className="material-symbols-outlined text-base">lock</span>
              Event closed — no further check-ins
            </span>
          )}

          <a
            href={`/live/${onChainEventId}`}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-primary/10 text-primary font-bold text-sm hover:bg-primary/20"
          >
            <span className="material-symbols-outlined text-base">videocam</span>
            Live Session
          </a>

          {event.joinCode && (
            <span className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container text-on-surface text-sm">
              Join code: <span className="font-mono font-bold">{event.joinCode}</span>
            </span>
          )}
        </div>

        {message && (
          <div className={`mt-4 px-4 py-3 rounded-lg text-sm flex items-center gap-2 ${
            message.type === "success" ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}>
            <span className="material-symbols-outlined text-base">
              {message.type === "success" ? "check_circle" : "error"}
            </span>
            {message.text}
          </div>
        )}
      </div>

      {/* Stats */}
      {(() => {
        // --- Effective duration ---
        // The denominator for attendance % is the ACTUAL time the event has
        // been running, not the scheduled `durationMinutes` from creation:
        //   - If organizer ended the event: endedAt - startedAt (final duration)
        //   - If organizer started and is running: now - startedAt (live elapsed)
        //   - Fallback to scheduled start/end if no manual lifecycle used
        const nowSec = Math.floor(Date.now() / 1000);
        const startSec = event.startedAt
          ? Math.floor(event.startedAt / 1000)
          : event.startTime;
        const endSec = event.endedAt
          ? Math.floor(event.endedAt / 1000)
          : Math.min(nowSec, event.endTime);
        const effectiveEventSec = Math.max(1, endSec - startSec);
        const threshold = event.attendanceThreshold || 75;

        const avgPct =
          attendees.length === 0
            ? 0
            : Math.round(
                attendees.reduce(
                  (sum, a) => sum + attendancePercent(a.durationSeconds, effectiveEventSec, effectiveEventSec),
                  0
                ) / attendees.length
              );
        const eligibleCount = attendees.filter(
          (a) => attendancePercent(a.durationSeconds, effectiveEventSec, effectiveEventSec) >= threshold
        ).length;
        return (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <StatCard icon="group" color="primary" label="Total Attendees" value={attendees.length} />
            <StatCard icon="bolt" color="emerald" label="Active Now" value={activeCount} />
            <StatCard
              icon="schedule"
              color="indigo"
              label={event.status === "ended" ? "Final Duration" : "Elapsed"}
              value={formatDuration(effectiveEventSec)}
            />
            <StatCard
              icon="trending_up"
              color={avgPct >= threshold ? "emerald" : "amber"}
              label="Avg Attendance"
              value={`${avgPct}%`}
            />
            <StatCard
              icon="workspace_premium"
              color="amber"
              label={`Eligible (≥${threshold}%) / Issued`}
              value={`${eligibleCount} / ${issuedCerts.length}`}
            />
          </div>
        );
      })()}

      {/* Check-in sharing — join code + QR code (QR only for In-Person / Hybrid) */}
      {(() => {
        const onChainId = event.onChainId || event.eventId || event.id || eventId;
        const frontendOrigin = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
        const checkInUrl = `${frontendOrigin}/live/${onChainId}?checkin=true`;
        const isInPerson = event.eventType === 1;
        const isHybrid = event.eventType === 2;
        const showQR = isInPerson || isHybrid;
        const typeLabel = isInPerson ? "In-Person" : isHybrid ? "Hybrid" : "Virtual";
        const typeColor = isInPerson ? "bg-indigo-50 text-indigo-700"
          : isHybrid ? "bg-violet-50 text-violet-700"
          : "bg-emerald-50 text-emerald-700";
        const iconBg = showQR ? "bg-indigo-50" : "bg-emerald-50";
        const iconColor = showQR ? "text-indigo-600" : "text-emerald-600";
        return (
          <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-lg ${iconBg} flex items-center justify-center`}>
                  <span className={`material-symbols-outlined ${iconColor}`}>
                    {showQR ? "qr_code_2" : "link"}
                  </span>
                </div>
                <div>
                  <h2 className="text-lg font-bold font-headline">Check-in link</h2>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {showQR
                      ? "Print the QR for the venue entrance — attendees scan, enter the join code, and sign."
                      : "Share this link with attendees — they enter the join code and sign to request access."}
                  </p>
                </div>
              </div>
              <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-bold ${typeColor}`}>
                {typeLabel}
              </span>
            </div>

            <div className={`p-6 grid grid-cols-1 ${showQR ? "md:grid-cols-[auto,1fr]" : ""} gap-6`}>
              {showQR && (
                <div className="flex items-center justify-center bg-white p-4 rounded-xl border-2 border-outline-variant/20 w-fit">
                  <QRCodeSVG
                    value={checkInUrl}
                    size={180}
                    bgColor="#ffffff"
                    fgColor="#1a1a2e"
                    level="M"
                    includeMargin={false}
                  />
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                    Check-in URL
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={checkInUrl}
                      readOnly
                      className="flex-1 px-3 py-2 rounded-lg border border-outline-variant/30 bg-surface-container-low text-xs font-mono text-on-surface"
                    />
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(checkInUrl).then(
                          () => setMessage({ type: "success", text: "Check-in URL copied to clipboard" }),
                          () => setMessage({ type: "error", text: "Copy failed — please select and copy manually" })
                        );
                      }}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20"
                      title="Copy URL"
                    >
                      <span className="material-symbols-outlined text-sm">content_copy</span>
                      Copy
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                    Join code
                  </label>
                  <div className="flex items-center gap-3">
                    <span className="text-2xl font-mono font-bold text-primary tracking-[0.2em] px-4 py-2 rounded-lg bg-primary/5 border border-primary/20">
                      {event.joinCode || "—"}
                    </span>
                    {event.joinCode && (
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(event.joinCode!).then(
                            () => setMessage({ type: "success", text: `Join code ${event.joinCode} copied` })
                          );
                        }}
                        className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-bold hover:bg-surface-container-high"
                      >
                        <span className="material-symbols-outlined text-sm">content_copy</span>
                        Copy
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <a
                    href={checkInUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-white text-xs font-bold hover:bg-primary/90"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    Open check-in page
                  </a>
                  {showQR && (
                    <button
                      onClick={() => {
                        const printW = window.open("", "_blank", "width=800,height=900");
                        if (!printW) return;
                        const qrHtml = document.getElementById(`qr-svg-${onChainId}`)?.outerHTML || "";
                        printW.document.write(
                          `<!DOCTYPE html><html><head><title>${event.name} – Check-In QR</title>` +
                          `<style>body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;padding:60px}` +
                          `h1{font-size:28px;margin-bottom:8px}.sub{color:#666;margin-bottom:32px}` +
                          `.qr{border:3px solid #000;padding:32px;background:#fff}.code{font-family:monospace;font-size:24px;letter-spacing:0.3em;margin-top:24px;padding:12px 24px;border:2px dashed #666;border-radius:8px}` +
                          `@media print{button{display:none}}</style></head><body>` +
                          `<h1>${event.name}</h1><p class="sub">Scan to check in</p>` +
                          `<div class="qr">${qrHtml}</div>` +
                          (event.joinCode ? `<div class="code">${event.joinCode}</div>` : "") +
                          `<button onclick="window.print()" style="margin-top:32px;padding:12px 32px;font-size:16px;cursor:pointer;background:#6750a4;color:#fff;border:none;border-radius:12px">Print</button>` +
                          `</body></html>`
                        );
                        printW.document.close();
                      }}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-surface-container text-on-surface text-xs font-bold hover:bg-surface-container-high"
                    >
                      <span className="material-symbols-outlined text-sm">print</span>
                      Print QR poster
                    </button>
                  )}
                </div>

                {isInPerson && (
                  <p className="text-[11px] text-on-surface-variant pt-2 border-t border-outline-variant/10">
                    Tip: print the QR and display it at the venue entrance — attendees scan with their phone camera.
                  </p>
                )}
                {isHybrid && (
                  <p className="text-[11px] text-on-surface-variant pt-2 border-t border-outline-variant/10">
                    Tip: print the QR for in-person attendees AND share the URL for remote attendees — both paths converge on the same check-in flow.
                  </p>
                )}
              </div>
            </div>

            {/* Hidden duplicate kept in DOM with a stable id — the print button grabs its innerHTML */}
            {showQR && (
              <div id={`qr-svg-${onChainId}`} className="hidden">
                <QRCodeSVG value={checkInUrl} size={320} bgColor="#ffffff" fgColor="#1a1a2e" level="M" />
              </div>
            )}
          </div>
        );
      })()}

      {/* Badge NFT configuration */}
      <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center">
              <span className="material-symbols-outlined text-amber-600">military_tech</span>
            </div>
            <div>
              <h2 className="text-lg font-bold font-headline">POAP Badge NFT</h2>
              <p className="text-xs text-on-surface-variant mt-0.5">
                Soulbound ERC-721 awarded to eligible attendees — shows up in their MetaMask NFT tab
              </p>
            </div>
          </div>
          {badgeURI ? (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
              <span className="material-symbols-outlined text-sm">check_circle</span>
              Configured
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold">
              <span className="material-symbols-outlined text-sm">warning</span>
              Not set
            </span>
          )}
        </div>

        <div className="p-6 space-y-5">
          {badgeURI && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-surface-container-low border border-outline-variant/10">
              <span className="material-symbols-outlined text-primary mt-0.5">link</span>
              <div className="min-w-0 flex-1">
                <p className="text-xs text-on-surface-variant">Current metadata URI</p>
                <p className="font-mono text-xs text-on-surface break-all mt-1">{badgeURI}</p>
                {badgeURI.startsWith("ipfs://") && (
                  <a
                    href={`https://gateway.pinata.cloud/ipfs/${badgeURI.replace("ipfs://", "")}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 mt-2 text-xs text-primary font-bold hover:underline"
                  >
                    <span className="material-symbols-outlined text-sm">open_in_new</span>
                    Open on IPFS gateway
                  </a>
                )}
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              onClick={() => setBadgeMode("upload")}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                badgeMode === "upload"
                  ? "bg-primary text-white"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <span className="material-symbols-outlined text-sm mr-1 align-middle">upload</span>
              Upload image
            </button>
            <button
              onClick={() => setBadgeMode("uri")}
              className={`flex-1 px-4 py-2 rounded-lg text-sm font-bold transition-colors ${
                badgeMode === "uri"
                  ? "bg-primary text-white"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              <span className="material-symbols-outlined text-sm mr-1 align-middle">link</span>
              Paste metadata URI
            </button>
          </div>

          {badgeMode === "upload" ? (
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  Badge artwork
                </label>
                <div
                  onClick={() => badgeFileRef.current?.click()}
                  className="border-2 border-dashed border-outline-variant/40 rounded-xl p-6 text-center cursor-pointer hover:border-primary/40 hover:bg-surface-container-low transition-colors"
                >
                  {badgeFilePreview ? (
                    <div className="flex items-center gap-4 justify-center">
                      <img src={badgeFilePreview} alt="Badge preview" className="w-24 h-24 rounded-lg object-cover border border-outline-variant/20" />
                      <div className="text-left">
                        <p className="font-bold text-sm text-on-surface">{badgeFile?.name}</p>
                        <p className="text-xs text-on-surface-variant">{badgeFile ? `${(badgeFile.size / 1024).toFixed(1)} KB` : ""}</p>
                        <p className="text-xs text-primary font-bold mt-1">Click to replace</p>
                      </div>
                    </div>
                  ) : (
                    <div className="text-on-surface-variant">
                      <span className="material-symbols-outlined text-4xl mb-2 block">image</span>
                      <p className="text-sm font-bold text-on-surface">Click to upload badge artwork</p>
                      <p className="text-xs mt-1">PNG, JPG, GIF, WebP, SVG — up to 5 MB</p>
                    </div>
                  )}
                </div>
                <input
                  ref={badgeFileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
                  className="hidden"
                  onChange={handleBadgeFileChange}
                />
              </div>
              <div>
                <label className="block text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                  Description (optional)
                </label>
                <textarea
                  value={badgeDescription}
                  onChange={(e) => setBadgeDescription(e.target.value)}
                  maxLength={300}
                  rows={2}
                  placeholder={`Proof of Attendance for ${event?.name || "your event"}`}
                  className="w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-surface text-sm text-on-surface focus:outline-none focus:border-primary"
                />
              </div>
            </div>
          ) : (
            <div>
              <label className="block text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-2">
                Metadata URI
              </label>
              <input
                type="text"
                value={badgeURIInput}
                onChange={(e) => setBadgeURIInput(e.target.value)}
                placeholder="ipfs://bafk... or https://..."
                className="w-full px-3 py-2 rounded-lg border border-outline-variant/30 bg-surface text-sm text-on-surface font-mono focus:outline-none focus:border-primary"
              />
              <p className="text-xs text-on-surface-variant mt-2">
                JSON must contain <span className="font-mono">name</span>, <span className="font-mono">description</span>, <span className="font-mono">image</span> fields (ERC-721 metadata schema).
              </p>
            </div>
          )}

          {badgeMessage && (
            <div className={`flex items-start gap-2 px-4 py-3 rounded-lg text-sm ${
              badgeMessage.type === "error"
                ? "bg-red-50 border border-red-200 text-red-700"
                : "bg-emerald-50 border border-emerald-200 text-emerald-700"
            }`}>
              <span className="material-symbols-outlined text-lg flex-shrink-0">
                {badgeMessage.type === "error" ? "error" : "check_circle"}
              </span>
              <span className="flex-1">{badgeMessage.text}</span>
              <button
                onClick={() => setBadgeMessage(null)}
                className="flex-shrink-0 opacity-60 hover:opacity-100"
                title="Dismiss"
              >
                <span className="material-symbols-outlined text-base">close</span>
              </button>
            </div>
          )}

          <button
            onClick={handleSaveBadge}
            disabled={busy === "save-badge" || (badgeMode === "upload" ? !badgeFile : !badgeURIInput.trim())}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl prism-gradient text-white font-bold text-sm disabled:opacity-50"
          >
            {busy === "save-badge" ? (
              <div className="spinner text-white" style={{ width: 14, height: 14 }} />
            ) : (
              <span className="material-symbols-outlined text-base">save</span>
            )}
            {badgeURI ? "Update badge" : "Save badge"}
          </button>
        </div>
      </div>

      {/* Pending join requests — only shown when there are any */}
      {pendingRequests.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl shadow-ambient overflow-hidden">
          <div className="px-6 py-4 border-b border-amber-200 flex items-center gap-3">
            <span className="material-symbols-outlined text-amber-700">pending_actions</span>
            <div>
              <h2 className="text-lg font-bold font-headline text-amber-900">
                {pendingRequests.length} Pending Join Request{pendingRequests.length > 1 ? "s" : ""}
              </h2>
              <p className="text-xs text-amber-800 mt-0.5">
                Attendees have signed the join code and are waiting for your approval
              </p>
            </div>
          </div>
          <div className="divide-y divide-amber-200">
            {pendingRequests.map((p) => {
              const displayName = p.name || (p.email ? p.email.split("@")[0] : null) ||
                `Attendee ${p.attendee.slice(2, 6).toUpperCase()}`;
              return (
                <div key={p.attendee} className="flex items-center justify-between gap-4 px-6 py-4 bg-white/60">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-10 h-10 rounded-full prism-gradient flex items-center justify-center text-white text-sm font-bold shrink-0">
                      {displayName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-sm text-on-surface truncate">{displayName}</p>
                      <p className="text-[11px] text-on-surface-variant font-mono">
                        {p.attendee.slice(0, 10)}…{p.attendee.slice(-6)}
                      </p>
                      {p.email && <p className="text-[11px] text-on-surface-variant">{p.email}</p>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[11px] text-on-surface-variant hidden md:inline">
                      Requested {Math.max(1, Math.floor((Date.now() - p.requestedAt) / 1000))}s ago
                    </span>
                    <button
                      onClick={() => handleApprove(p.attendee, true)}
                      disabled={busy === `approve-${p.attendee}`}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-emerald-600 text-white text-xs font-bold hover:bg-emerald-700 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">check</span>
                      Approve
                    </button>
                    <button
                      onClick={() => handleApprove(p.attendee, false)}
                      disabled={busy === `approve-${p.attendee}`}
                      className="inline-flex items-center gap-1 px-3 py-2 rounded-lg bg-red-100 text-red-700 text-xs font-bold hover:bg-red-200 disabled:opacity-50"
                    >
                      <span className="material-symbols-outlined text-sm">close</span>
                      Reject
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Attendees Table */}
      <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 overflow-hidden">
        <div className="px-6 py-4 border-b border-outline-variant/10 flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold font-headline">Participants</h2>
            <p className="text-xs text-on-surface-variant mt-0.5">
              Live attendance updates every 5 seconds while event is active
            </p>
          </div>
          {attendees.length > 0 && (
            <button
              onClick={handleBulkIssue}
              disabled={busy === "bulk"}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-50 text-emerald-700 font-bold text-sm hover:bg-emerald-100 disabled:opacity-50"
              title={`Issue certificates only to attendees who reached ${event.attendanceThreshold || 75}% attendance`}
            >
              {busy === "bulk" ? <div className="spinner text-emerald-700" style={{ width: 14, height: 14 }} /> :
                <span className="material-symbols-outlined text-base">workspace_premium</span>}
              Issue Certificates to Eligible
            </button>
          )}
        </div>

        {attendees.length === 0 ? (
          <div className="text-center py-12 px-6">
            <span className="material-symbols-outlined text-5xl text-outline mb-3 block">person_search</span>
            <p className="text-on-surface-variant text-sm">No participants yet</p>
            {event.status === "live" && (
              <p className="text-xs text-on-surface-variant mt-2">
                Share the join code <span className="font-mono font-bold">{event.joinCode}</span> or the live link with attendees
              </p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-surface-container-low">
                  <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Name</th>
                  <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Wallet</th>
                  <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Check-in</th>
                  <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Duration</th>
                  <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Attendance</th>
                  <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                  <th className="text-right px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const nowSec = Math.floor(Date.now() / 1000);
                  const startSec = event.startedAt
                    ? Math.floor(event.startedAt / 1000)
                    : event.startTime;
                  const endSec = event.endedAt
                    ? Math.floor(event.endedAt / 1000)
                    : Math.min(nowSec, event.endTime);
                  const effectiveEventSec = Math.max(1, endSec - startSec);
                  const threshold = event.attendanceThreshold || 75;
                  return attendees.map((a) => {
                    const cert = certForAttendee(a.attendee);
                    const pct = attendancePercent(a.durationSeconds, effectiveEventSec);
                    const eligible = pct >= threshold;
                    // Prefer registered name → email local-part → short wallet prefix.
                    const displayName =
                      a.name ||
                      (a.email ? a.email.split("@")[0] : null) ||
                      `Attendee ${a.attendee.slice(2, 6).toUpperCase()}`;
                    return (
                    <tr key={a.attendee} className="border-t border-outline-variant/10 hover:bg-surface-container-low/50">
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full prism-gradient flex items-center justify-center text-white text-xs font-bold shrink-0">
                            {displayName.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <div className="font-medium text-on-surface truncate">{displayName}</div>
                            {a.email && (
                              <div className="text-[10px] text-on-surface-variant truncate">{a.email}</div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <code className="font-mono text-[11px] text-on-surface-variant bg-surface-container px-2 py-1 rounded">
                          {a.attendee.slice(0, 8)}…{a.attendee.slice(-6)}
                        </code>
                      </td>
                      <td className="px-6 py-4 text-on-surface-variant text-xs">
                        {new Date(a.checkInTime).toLocaleString()}
                      </td>
                      <td className="px-6 py-4 text-on-surface-variant">
                        <div className="font-medium text-on-surface">{formatDuration(a.durationSeconds)}</div>
                        <div className="text-[10px] text-on-surface-variant mt-0.5">
                          of {formatDuration(effectiveEventSec)}
                        </div>
                      </td>
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 max-w-[100px] h-2 rounded-full bg-surface-container overflow-hidden">
                            <div
                              className={`h-full rounded-full ${eligible ? "bg-emerald-500" : "bg-amber-500"}`}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <span className={`text-xs font-bold ${eligible ? "text-emerald-700" : "text-amber-700"}`}>
                            {pct}%
                          </span>
                        </div>
                        {eligible ? (
                          <p className="text-[10px] text-emerald-600 mt-1 flex items-center gap-1">
                            <span className="material-symbols-outlined text-[10px]">check</span>
                            Eligible (≥{threshold}%)
                          </p>
                        ) : (
                          <p className="text-[10px] text-amber-600 mt-1">
                            Below {threshold}% threshold
                          </p>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        {a.currentlyActive ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-emerald-50 text-emerald-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            Active
                          </span>
                        ) : a.checkOutTime ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-gray-100 text-gray-600">
                            Checked out
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700">
                            Idle
                          </span>
                        )}
                      </td>
                      <td className="px-6 py-4 text-right">
                        {cert ? (
                          <a
                            href={`/certificate/${cert.certId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                          >
                            <span className="material-symbols-outlined text-sm">verified</span>
                            Cert #{cert.certId}
                          </a>
                        ) : (
                          <button
                            onClick={() => handleIssueCertificate(a.attendee)}
                            disabled={busy === `cert-${a.attendee}` || !eligible}
                            title={
                              eligible
                                ? "Issue certificate to this attendee"
                                : `Attendee must reach ${threshold}% attendance to be eligible`
                            }
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 disabled:opacity-40 disabled:cursor-not-allowed"
                          >
                            {busy === `cert-${a.attendee}` ? (
                              <div className="spinner text-primary" style={{ width: 12, height: 12 }} />
                            ) : (
                              <span className="material-symbols-outlined text-sm">workspace_premium</span>
                            )}
                            Issue Certificate
                          </button>
                        )}
                      </td>
                    </tr>
                    );
                  });
                })()}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ icon, color, label, value }: { icon: string; color: string; label: string; value: string | number }) {
  const colorMap: Record<string, { bg: string; text: string }> = {
    primary: { bg: "bg-primary-fixed/30", text: "text-primary" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-600" },
    amber: { bg: "bg-amber-50", text: "text-amber-600" },
    indigo: { bg: "bg-indigo-50", text: "text-indigo-600" },
  };
  const c = colorMap[color] || colorMap.primary;
  return (
    <div className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10">
      <div className={`w-10 h-10 rounded-lg ${c.bg} flex items-center justify-center mb-3`}>
        <span className={`material-symbols-outlined ${c.text}`}>{icon}</span>
      </div>
      <p className="text-2xl font-bold font-headline text-on-surface">{value}</p>
      <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider mt-1">{label}</p>
    </div>
  );
}
