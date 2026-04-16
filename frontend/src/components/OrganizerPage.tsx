"use client";

import React, { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import { type VEvent } from "../lib/vryfd";
import { getENSOverride } from "../lib/ensOverrides";

interface OrganizerPageProps {
  events: VEvent[];
  deployedEventIds: Record<number, number>;
  onChainDeployedIds: Set<number>;
  onChainEventIds: Record<number, number>;
  onEventDeployed: (demoId: number, onChainId: number, txHash: string) => void;
  onEventCreated: (event: Omit<VEvent, "id">) => void;
  onEventUpdated: (id: number, patch: Partial<Pick<VEvent, "name" | "emoji" | "color" | "date">>) => void;
  onEventEnded: (id: number) => void;
  onEventResumed: (id: number) => void;
  onEventDeleted: (id: number) => void;
  onToast: (msg: string, type: "success" | "error" | "") => void;
  onLock?: () => void;
}

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

function adminHeaders(extra?: Record<string, string>): Record<string, string> {
  const secret = process.env.NEXT_PUBLIC_ADMIN_SECRET;
  return {
    "Content-Type": "application/json",
    ...(secret ? { "x-admin-secret": secret } : {}),
    ...extra,
  };
}

// For "live" events: startTime is 1 hour ago so check-in works immediately;
// endTime is 10 years from now so demo events never expire.
// Upcoming events keep their scheduled date.
async function fetchBadgeDataURI(eventId: number): Promise<string> {
  try {
    const res = await fetch(`${BACKEND}/api/metadata/badge/${eventId}/pin`);
    const data = await res.json();
    return data.metaURL as string;
  } catch {
    return `${BACKEND}/api/metadata/badge/${eventId}`;
  }
}

// Visually unambiguous chars (no I, O, 0, 1) — built from char codes to avoid spell-check noise
const CODE_CHARS = "23456789".split("").concat(
  Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i))
    .filter((c) => !["I", "O"].includes(c))
).join("");

function generateCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  }
  return code;
}

const COLORS: { hex: string; cls: string; label: string }[] = [
  { hex: "#7c6cf0", cls: "org-swatch-purple", label: "Purple" },
  { hex: "#34d399", cls: "org-swatch-green",  label: "Green"  },
  { hex: "#fbbf24", cls: "org-swatch-yellow", label: "Yellow" },
  { hex: "#f87171", cls: "org-swatch-red",    label: "Red"    },
  { hex: "#60a5fa", cls: "org-swatch-blue",   label: "Blue"   },
  { hex: "#f472b6", cls: "org-swatch-pink",   label: "Pink"   },
];
const EMOJIS = ["🎯", "🚀", "⚡", "🌐", "💻", "🎓", "🔥", "🌙"];

type Tab = "create" | "deploy" | "manage" | "attendance" | "certificates";

const EMPTY_CREATE = { name: "", emoji: "🎯", color: "#7c6cf0", startDate: "", endDate: "" };

export default function OrganizerPage({ events, deployedEventIds, onChainDeployedIds, onChainEventIds, onEventDeployed, onEventCreated, onEventUpdated, onEventEnded, onEventDeleted, onToast, onLock }: OrganizerPageProps) {
  const { address } = useAccount();

  const [activeTab, setActiveTab] = useState<Tab>("create");
  const [deployingId, setDeployingId] = useState<number | null>(null);
  const [createForm, setCreateForm] = useState(EMPTY_CREATE);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ name: "", emoji: "", color: "", date: "" });
  const [attendees, setAttendees] = useState<{ attendee: string; timestamp: number | null; txHash: string | null; ens?: string | null }[]>([]);
  const [isLoadingAttendees, setIsLoadingAttendees] = useState(false);
  const [certDemoId, setCertDemoId] = useState<string>("");
  const [isBulkIssuing, setIsBulkIssuing] = useState(false);
  const [bulkResults, setBulkResults] = useState<{ issued: number; skipped: number; failed: number } | null>(null);
  const [certList, setCertList] = useState<{ certId: number; attendee: string; attendeeENS?: string; timestamp: number; metadataURI: string; isValid: boolean }[]>([]);
  const [isLoadingCerts, setIsLoadingCerts] = useState(false);
  const [verifyingCertId, setVerifyingCertId] = useState<number | null>(null);
  const [certVerifyResults, setCertVerifyResults] = useState<Record<number, { ok: boolean; msg: string; url?: string }>>({});
  const [pendingDemoId, setPendingDemoId] = useState<string>("");
  const [pendingList, setPendingList] = useState<{ attendee: string; ens: string | null }[]>([]);
  const [isLoadingPending, setIsLoadingPending] = useState(false);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [confirmingAttendee, setConfirmingAttendee] = useState<string | null>(null);
  const [isConfirmingAll, setIsConfirmingAll] = useState(false);
  // demoId → join code string (fetched from backend, deterministic per on-chain ID)
  const [joinCodes, setJoinCodes] = useState<Record<number, string>>({});
  // demoId → confirmed attendee count (fetched from backend)
  const [checkinCounts, setCheckinCounts] = useState<Record<number, number>>({});

  // Fetch join codes for all deployed events whenever the deployed set changes
  // NOTE: deployedEvents is computed below; this effect recomputes it internally to avoid
  // a "used before declaration" error.
  useEffect(() => {
    const deployed = events.filter((ev) => onChainDeployedIds.has(ev.id));
    const missingIds = deployed.filter((ev) => !joinCodes[ev.id]);
    if (missingIds.length === 0) return;
    Promise.all(
      missingIds.map(async (ev) => {
        const onChainId = onChainEventIds[ev.id];
        if (onChainId === undefined) return null;
        try {
          const res = await fetch(`${BACKEND}/api/relay/join-code/${onChainId}`);
          const data = await res.json();
          return data.code ? { id: ev.id, code: data.code as string } : null;
        } catch { return null; }
      })
    ).then((results) => {
      const patch: Record<number, string> = {};
      results.forEach((r) => { if (r) patch[r.id] = r.code; });
      if (Object.keys(patch).length > 0) setJoinCodes((prev) => ({ ...prev, ...patch }));
    });
  }, [events, onChainDeployedIds, onChainEventIds, joinCodes]);

  // Fetch confirmed check-in counts for all deployed events, then poll every 10s
  useEffect(() => {
    const deployed = events.filter((ev) => onChainDeployedIds.has(ev.id));
    if (deployed.length === 0) return;
    const fetchCounts = () => {
      Promise.all(
        deployed.map(async (ev) => {
          const onChainId = onChainEventIds[ev.id];
          if (onChainId === undefined) return null;
          try {
            const res = await fetch(`${BACKEND}/api/relay/attendee-count/${onChainId}`);
            const data = await res.json();
            return data.count !== undefined ? { id: ev.id, count: data.count as number } : null;
          } catch { return null; }
        })
      ).then((results) => {
        const patch: Record<number, number> = {};
        results.forEach((r) => { if (r) patch[r.id] = r.count; });
        if (Object.keys(patch).length > 0) setCheckinCounts((prev) => ({ ...prev, ...patch }));
      });
    };
    fetchCounts();
    const id = setInterval(fetchCounts, 10000);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events, onChainDeployedIds, onChainEventIds]);

  // Role check removed — all on-chain actions go through the backend relayer wallet,
  // so the connected wallet does not need ORGANIZER_ROLE.

  // ── Create event locally with join code ──────────────────────────────────
  function createEvent() {
    if (!createForm.name || !createForm.startDate || !createForm.endDate) {
      onToast("Fill in Event Name, Start Date and End Date", "error");
      return;
    }
    const startTime = Math.floor(new Date(createForm.startDate).getTime() / 1000);
    const endTime   = Math.floor(new Date(createForm.endDate).getTime() / 1000);
    if (endTime <= startTime) { onToast("End date must be after start date", "error"); return; }
    const dateLabel = new Date(createForm.startDate).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
    const joinCode = generateCode();
    onEventCreated({
      name: createForm.name, date: dateLabel, status: "upcoming",
      attendees: 0, emoji: createForm.emoji, color: createForm.color,
      startTime, endTime, joinCode,
    });
    setCreateForm(EMPTY_CREATE);
    onToast(`"${createForm.name}" created — go to Deploy tab to publish on-chain`, "success");
  }

  // ── Deploy event to blockchain ────────────────────────────────────────────
  async function deployEvent(ev: VEvent & { startTime: number; endTime: number }) {
    setDeployingId(ev.id);
    try {
      const regRes = await fetch(`${BACKEND}/api/metadata/badge/register`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ id: ev.id, name: ev.name, date: ev.date, color: ev.color, emoji: ev.emoji }),
      });
      if (!regRes.ok) {
        const regErr = await regRes.json().catch(() => ({}));
        throw new Error(regErr.error || "Badge metadata registration failed");
      }
      const metaURI = await fetchBadgeDataURI(ev.id);
      const now = Math.floor(Date.now() / 1000);
      const deployStart = ev.startTime > now ? now - 3600 : ev.startTime;
      const res = await fetch(`${BACKEND}/api/relay/createEvent`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ name: ev.name, metadataURI: metaURI, startTime: deployStart, endTime: ev.endTime, demoId: ev.id, joinCode: ev.joinCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      onEventDeployed(ev.id, Number(data.eventId), data.txHash);
      const code = ev.joinCode ?? "";
      if (code) setJoinCodes((prev) => ({ ...prev, [ev.id]: code }));
      onToast(`"${ev.name}" deployed! Join code: ${code}`, "success");
    } catch (err: unknown) {
      onToast(`Deploy failed: ${err instanceof Error ? err.message : "Unknown error"}`, "error");
    } finally {
      setDeployingId(null);
    }
  }

  // ── Auto-load pending + confirmed when event selector changes ───────────
  useEffect(() => {
    if (!pendingDemoId) { setPendingList([]); setAttendees([]); setBackendError(null); return; }
    const onChainId = onChainEventIds[Number(pendingDemoId)];
    if (onChainId === undefined) return;

    const controller = new AbortController();
    const { signal } = controller;

    setBackendError(null);
    setIsLoadingPending(true);
    fetch(`${BACKEND}/api/relay/pending-attendees/${onChainId}`, { signal })
      .then((r) => r.json())
      .then((data) => { if (!signal.aborted) setPendingList(data.attendees || []); })
      .catch(() => { if (!signal.aborted) setBackendError("Cannot reach backend — make sure the server is running on port 3001."); })
      .finally(() => { if (!signal.aborted) setIsLoadingPending(false); });

    setIsLoadingAttendees(true);
    fetch(`${BACKEND}/api/relay/attendees/${onChainId}`, { signal })
      .then((r) => r.json())
      .then(async (data) => {
        if (signal.aborted) return;
        const list: { attendee: string; timestamp: number | null; txHash: string | null; ens?: string | null }[] = data.attendees || [];
        setAttendees(list);
        // Resolve ENS for each attendee in the background — checks override first, then backend
        list.forEach(async (a) => {
          const override = getENSOverride(a.attendee);
          if (override) {
            setAttendees((prev) => prev.map((x) => x.attendee === a.attendee ? { ...x, ens: override } : x));
            return;
          }
          try {
            const r = await fetch(`${BACKEND}/api/relay/ens/${a.attendee}`, { signal });
            if (signal.aborted || !r.ok) return;
            const { ens } = await r.json();
            if (signal.aborted) return;
            setAttendees((prev) => prev.map((x) => x.attendee === a.attendee ? { ...x, ens } : x));
          } catch { /* ENS lookup failed — keep address */ }
        });
      })
      .catch(() => {})
      .finally(() => { if (!signal.aborted) setIsLoadingAttendees(false); });

    return () => controller.abort();
  }, [pendingDemoId, onChainEventIds]);

  // ── Auto-refresh pending + confirmed lists every 5s when an event is selected ─
  useEffect(() => {
    if (!pendingDemoId) return;
    const onChainId = onChainEventIds[Number(pendingDemoId)];
    if (onChainId === undefined) return;

    const id = setInterval(() => {
      fetch(`${BACKEND}/api/relay/pending-attendees/${onChainId}`)
        .then((r) => r.json())
        .then((data) => setPendingList(data.attendees || []))
        .catch(() => {});

      fetch(`${BACKEND}/api/relay/attendees/${onChainId}`)
        .then((r) => r.json())
        .then((data) => {
          const list = data.attendees || [];
          setAttendees((prev) => {
            // Only update if count changed to avoid ENS flicker
            if (prev.length === list.length) return prev;
            return list;
          });
          // Refresh the checked-in count badge on the event card
          setCheckinCounts((prev) => ({ ...prev, [Number(pendingDemoId)]: list.length }));
        })
        .catch(() => {});
    }, 5000);

    return () => clearInterval(id);
  }, [pendingDemoId, onChainEventIds]);

  async function refreshCount(demoId: number) {
    const onChainId = onChainEventIds[demoId];
    if (onChainId === undefined) return;
    try {
      const res = await fetch(`${BACKEND}/api/relay/attendee-count/${onChainId}`);
      const data = await res.json();
      if (data.count !== undefined) setCheckinCounts((prev) => ({ ...prev, [demoId]: data.count }));
    } catch {}
  }

  async function confirmOne(attendee: string) {
    const demoId = Number(pendingDemoId);
    const onChainId = onChainEventIds[demoId];
    if (onChainId === undefined) return;
    setConfirmingAttendee(attendee);
    try {
      const res = await fetch(`${BACKEND}/api/relay/confirmAttendee`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ onChainEventId: onChainId, attendee }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setPendingList((prev) => prev.filter((a) => a.attendee !== attendee));
      // Optimistically add to confirmed list + update count immediately
      const pendingEntry = pendingList.find((p) => p.attendee === attendee);
      setAttendees((prev) => {
        if (prev.some((a) => a.attendee === attendee)) return prev;
        return [...prev, { attendee, timestamp: Date.now(), txHash: data.txHash ?? null, ens: pendingEntry?.ens ?? null }];
      });
      setCheckinCounts((prev) => ({ ...prev, [demoId]: (prev[demoId] ?? 0) + 1 }));
      onToast(`Confirmed! Tx: ${data.txHash?.slice(0, 10) ?? "already on-chain"}...`, "success");
    } catch (err: unknown) {
      onToast(`Confirm failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
    } finally {
      setConfirmingAttendee(null);
    }
  }

  async function confirmAll() {
    const demoId = Number(pendingDemoId);
    const onChainId = onChainEventIds[demoId];
    if (onChainId === undefined) return;
    const count = pendingList.length;
    if (!window.confirm(`Confirm all ${count} pending attendee${count !== 1 ? "s" : ""} on-chain? This cannot be undone.`)) return;
    setIsConfirmingAll(true);
    try {
      const res = await fetch(`${BACKEND}/api/relay/confirmAllAttendees`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ onChainEventId: onChainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      // Fetch fresh attendees + count immediately so the UI reflects the new state
      fetch(`${BACKEND}/api/relay/attendees/${onChainId}`)
        .then((r) => r.json())
        .then((d) => {
          const list = d.attendees || [];
          setAttendees(list);
          setCheckinCounts((prev) => ({ ...prev, [demoId]: list.length }));
        })
        .catch(() => {});
      setPendingList([]);
      onToast(`Done! Confirmed: ${data.confirmed} · Already on-chain: ${data.alreadyConfirmed} · Failed: ${data.failed}`, data.failed > 0 ? "error" : "success");
    } catch (err: unknown) {
      onToast(`Confirm all failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
    } finally {
      setIsConfirmingAll(false);
    }
  }

  // ── Auto-load certificates when event selector changes ───────────────────
  useEffect(() => {
    if (!certDemoId) { setCertList([]); setBulkResults(null); return; }
    const onChainId = onChainEventIds[Number(certDemoId)];
    if (onChainId === undefined) return;
    setIsLoadingCerts(true);
    fetch(`${BACKEND}/api/relay/certificates/${onChainId}`)
      .then((r) => r.json())
      .then((data) => setCertList(data.certificates || []))
      .catch(() => {})
      .finally(() => setIsLoadingCerts(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [certDemoId]);

  // ── Issue certificates to all confirmed attendees ─────────────────────────
  async function issueBulkCertificates() {
    if (!certDemoId) { onToast("Select an event", "error"); return; }
    const onChainId = onChainEventIds[Number(certDemoId)];
    if (onChainId === undefined) { onToast("Event not deployed on-chain", "error"); return; }
    setIsBulkIssuing(true);
    setBulkResults(null);
    try {
      const res = await fetch(`${BACKEND}/api/relay/issueCertificatesBulk`, {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({ onChainEventId: onChainId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setBulkResults({ issued: data.issued, skipped: data.skipped, failed: data.failed });
      onToast(
        `Done! Issued: ${data.issued} · Skipped: ${data.skipped} · Failed: ${data.failed}`,
        data.failed > 0 ? "error" : "success"
      );
      // Refresh cert list after issuing
      setIsLoadingCerts(true);
      fetch(`${BACKEND}/api/relay/certificates/${onChainId}`)
        .then((r) => r.json())
        .then((d) => setCertList(d.certificates || []))
        .catch(() => {})
        .finally(() => setIsLoadingCerts(false));
    } catch (err: unknown) {
      onToast(`Bulk issue failed: ${err instanceof Error ? err.message : "Unknown"}`, "error");
    } finally {
      setIsBulkIssuing(false);
    }
  }

  // ── Verify certificate on-chain ───────────────────────────────────────────
  async function verifyCertificate(certId: number) {
    setVerifyingCertId(certId);
    try {
      const res = await fetch(`${BACKEND}/api/verify/${certId}`);
      const data = await res.json();
      if (data.verified && data.isValid) {
        setCertVerifyResults((prev) => ({
          ...prev,
          [certId]: {
            ok: true,
            msg: `Valid · ${data.attendeeENS || (data.attendee ? data.attendee.slice(0, 8) + "…" + data.attendee.slice(-6) : "?")}`,
            url: data.explorerURL,
          },
        }));
      } else {
        setCertVerifyResults((prev) => ({
          ...prev,
          [certId]: { ok: false, msg: data.error || "Not found on-chain" },
        }));
      }
    } catch {
      setCertVerifyResults((prev) => ({
        ...prev,
        [certId]: { ok: false, msg: "Backend unreachable" },
      }));
    } finally {
      setVerifyingCertId(null);
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

  const TABS: { key: Tab; label: string }[] = [
    { key: "create",       label: "✏️ Create Event"    },
    { key: "deploy",       label: "🚀 Deploy Events"   },
    { key: "manage",       label: "📋 Manage Events"   },
    { key: "attendance",   label: "✅ Attendance"       },
    { key: "certificates", label: "📜 Certificates"    },
  ];

  const deployedEvents = events.filter((ev) =>  onChainDeployedIds.has(ev.id));
  const savedEvents    = events.filter((ev) => !onChainDeployedIds.has(ev.id));

  // Next event ID is based on ALL events (created + deployed), not just deployed ones
  const nextEventId = events.length > 0 ? Math.max(...events.map((e) => e.id)) + 1 : 1;

  return (
    <>
      <div className="section-header fade-up">
        <div className="org-header-row">
          <span className="section-title">Organizer Dashboard</span>
          {onLock && (
            <button type="button" className="btn btn-outline btn-sm" onClick={onLock} title="Lock organizer dashboard">
              🔒 Lock
            </button>
          )}
        </div>
        <span className="section-sub">Next Event ID: #{nextEventId} · {deployedEvents.length} deployed</span>
      </div>

      <div className="org-badges fade-up">
        <span className="org-badge-role">✓ Backend Relayer Active</span>
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

      {/* ── Create Event ── */}
      {activeTab === "create" && (
        <div className="fade-up">
          <div className="card org-create-card">
            <div className="event-name org-card-title">✏️ Create New Event</div>
            <p className="org-create-hint">Fill in the details and save. A unique join code is generated automatically. Go to <strong>Deploy Events</strong> to publish on-chain.</p>
            <div className="org-form">
              <div>
                <div className="org-field-label">Event Name *</div>
                <input type="text" className="org-input"
                  value={createForm.name} placeholder="e.g. Web3 Builders Summit 2026"
                  onChange={(e) => setCreateForm((f) => ({ ...f, name: e.target.value }))}
                />
              </div>
              <div className="org-emoji-row">
                <div className="org-emoji-col">
                  <div className="org-field-label">Emoji</div>
                  <input type="text" className="org-input org-emoji-input"
                    value={createForm.emoji} maxLength={2} title="Event emoji"
                    onChange={(e) => setCreateForm((f) => ({ ...f, emoji: e.target.value }))}
                  />
                </div>
                <div className="org-emoji-quick">
                  {EMOJIS.map((em) => (
                    <button key={em} type="button"
                      className={`org-emoji-btn${createForm.emoji === em ? " selected" : ""}`}
                      onClick={() => setCreateForm((f) => ({ ...f, emoji: em }))}
                    >{em}</button>
                  ))}
                </div>
              </div>
              <div>
                <div className="org-field-label">Color</div>
                <div className="org-color-row">
                  {COLORS.map((c) => (
                    <button key={c.hex} type="button" title={c.label}
                      className={`org-color-swatch ${c.cls}${createForm.color === c.hex ? " selected" : ""}`}
                      onClick={() => setCreateForm((f) => ({ ...f, color: c.hex }))}
                    />
                  ))}
                </div>
              </div>
              <div className="org-datetime-grid">
                <div>
                  <div className="org-field-label">Start Date *</div>
                  <input type="date" className="org-input" title="Start date"
                    value={createForm.startDate}
                    onChange={(e) => setCreateForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <div className="org-field-label">End Date *</div>
                  <input type="date" className="org-input" title="End date"
                    value={createForm.endDate}
                    onChange={(e) => setCreateForm((f) => ({ ...f, endDate: e.target.value }))}
                  />
                </div>
              </div>
              <button type="button" className="btn btn-primary btn-block" onClick={createEvent}>
                ✏️ Create Event
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Deploy Events ── */}
      {activeTab === "deploy" && (
        <div className="fade-up">
          {savedEvents.length === 0 ? (
            <div className="card">
              <p className="text-muted">No pending events. Create one first, or all events are already deployed.</p>
            </div>
          ) : (
            <div className="grid grid-2">
              {savedEvents.map((ev) => {
                const isDeployingThis = deployingId === ev.id;
                const now = Math.floor(Date.now() / 1000);
                const startTime = ev.startTime ?? Math.floor(new Date(`${ev.date} 00:00:00 UTC`).getTime() / 1000);
                const endTime   = ev.endTime   ?? (now + 10 * 365 * 86400); // default: 10 years from now
                const code = ev.joinCode;
                return (
                  <div key={ev.id} className="card">
                    <div className={`card-glow ${COLORS.find((c) => c.hex === ev.color)?.cls ?? "org-swatch-purple"}-glow`} />
                    <div className="org-deploy-card-row">
                      <span className="org-manage-emoji">{ev.emoji}</span>
                      <div>
                        <div className="event-name">{ev.name}</div>
                        <div className="event-meta">{ev.date}</div>
                      </div>
                      <span className="event-status upcoming org-deploy-status-badge">PENDING</span>
                    </div>
                    {code && (
                      <div className="org-manage-code-row org-deploy-code-row">
                        <span className="org-manage-code-label">Join Code</span>
                        <span className="org-manage-code-val">{code}</span>
                        <button type="button" className="org-manage-copy-btn"
                          onClick={() => { navigator.clipboard.writeText(code); onToast(`Code ${code} copied!`, "success"); }}
                        >Copy</button>
                      </div>
                    )}
                    <button type="button" className="btn btn-primary btn-block org-deploy-btn-mt"
                      disabled={isDeployingThis || deployingId !== null}
                      onClick={() => deployEvent({ ...ev, startTime, endTime })}
                    >
                      {isDeployingThis ? <><span className="spinner" /> Deploying...</> : "🚀 Deploy to Chain"}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Manage Events ── */}
      {activeTab === "manage" && (
        <div className="fade-up">
          {events.length === 0 ? (
            <div className="card"><p className="text-muted">No events yet. Create one first.</p></div>
          ) : (
            <div className="org-manage-list">
              {events.map((ev) => {
                const displayId = deployedEventIds[ev.id];
                const isDeployed = onChainDeployedIds.has(ev.id);
                const isEditing = editingId === ev.id;

                return (
                  <div key={ev.id} className={`card org-manage-card${ev.status === "ended" ? " org-manage-ended" : ""}`}>
                    {/* ── Header row ── */}
                    <div className="org-manage-header">
                      <div className="org-manage-title">
                        <span className="org-manage-emoji">{ev.emoji}</span>
                        <div>
                          <div className="event-name">{ev.name}</div>
                          <div className="event-meta">{ev.date}</div>
                        </div>
                      </div>
                      <div className="org-manage-badges">
                        <span className={`event-status ${ev.status}`}>
                          {ev.status === "live" ? "LIVE" : ev.status === "ended" ? "ENDED" : "UPCOMING"}
                        </span>
                        {isDeployed && <span className="org-manage-chainbadge">⛓ #{displayId}</span>}
                        {!isDeployed && <span className="org-manage-localbadge">◦ Local</span>}
                      </div>
                    </div>

                    {/* ── Join code (organizer shares with participants) ── */}
                    {(() => {
                      const code = ev.joinCode ?? joinCodes[ev.id];
                      return (
                        <div className="org-manage-code-row">
                          <span className="org-manage-code-label">Join Code</span>
                          <span className="org-manage-code-val">{code ?? (isDeployed ? "loading..." : "—")}</span>
                          {code && (
                            <button type="button" className="org-manage-copy-btn"
                              onClick={() => { navigator.clipboard.writeText(code); onToast(`Code ${code} copied!`, "success"); }}
                            >Copy</button>
                          )}
                        </div>
                      );
                    })()}

                    {/* ── Stats row ── */}
                    <div className="org-manage-stats">
                      <div className="org-manage-stat">
                        <span className="org-manage-stat-val">{isDeployed ? (checkinCounts[ev.id] ?? "—") : ev.attendees}</span>
                        <span className="org-manage-stat-label">Check-ins</span>
                      </div>
                      {isDeployed && ev.deployTxHash && (
                        <div className="org-manage-stat">
                          <a href={`https://sepolia.etherscan.io/tx/${ev.deployTxHash}`} target="_blank" rel="noopener noreferrer" className="tx-link">Tx ↗</a>
                          <span className="org-manage-stat-label">Etherscan</span>
                        </div>
                      )}
                    </div>

                    {/* ── Edit form (inline) ── */}
                    {isEditing && (
                      <div className="org-manage-edit-form">
                        <div className="org-datetime-grid">
                          <div>
                            <div className="org-field-label">Event Name</div>
                            <input type="text" className="org-input" title="Event name" placeholder="Event name"
                              value={editForm.name}
                              onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
                            />
                          </div>
                          <div>
                            <div className="org-field-label">Date Label</div>
                            <input type="text" className="org-input"
                              value={editForm.date} placeholder="e.g. Apr 20, 2026"
                              onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))}
                            />
                          </div>
                        </div>
                        <div className="org-emoji-row">
                          <div className="org-emoji-col">
                            <div className="org-field-label">Emoji</div>
                            <input type="text" className="org-input org-emoji-input"
                              value={editForm.emoji} maxLength={2} title="Emoji"
                              onChange={(e) => setEditForm((f) => ({ ...f, emoji: e.target.value }))}
                            />
                          </div>
                          <div className="org-emoji-quick">
                            {EMOJIS.map((em) => (
                              <button key={em} type="button"
                                className={`org-emoji-btn${editForm.emoji === em ? " selected" : ""}`}
                                onClick={() => setEditForm((f) => ({ ...f, emoji: em }))}
                              >{em}</button>
                            ))}
                          </div>
                        </div>
                        <div>
                          <div className="org-field-label">Color</div>
                          <div className="org-color-row">
                            {COLORS.map((c) => (
                              <button key={c.hex} type="button" title={c.label}
                                className={`org-color-swatch ${c.cls}${editForm.color === c.hex ? " selected" : ""}`}
                                onClick={() => setEditForm((f) => ({ ...f, color: c.hex }))}
                              />
                            ))}
                          </div>
                        </div>
                        <div className="org-manage-edit-actions">
                          <button type="button" className="btn btn-primary"
                            onClick={() => {
                              onEventUpdated(ev.id, { name: editForm.name, emoji: editForm.emoji, color: editForm.color, date: editForm.date });
                              setEditingId(null);
                              onToast("Event updated!", "success");
                            }}
                          >Save Changes</button>
                          <button type="button" className="btn btn-outline"
                            onClick={() => setEditingId(null)}
                          >Cancel</button>
                        </div>
                      </div>
                    )}

                    {/* ── Action buttons ── */}
                    {!isEditing && (
                      <div className="org-manage-actions">
                        <button type="button" className="btn btn-outline org-manage-btn"
                          onClick={() => {
                            setEditForm({ name: ev.name, emoji: ev.emoji, color: ev.color, date: ev.date });
                            setEditingId(ev.id);
                          }}
                        >✏️ Edit</button>

                        {isDeployed && ev.status !== "ended" && (
                          <button type="button" className="btn org-manage-btn org-end-btn"
                            onClick={() => {
                              if (!window.confirm(`Mark "${ev.name}" as ended?`)) return;
                              onEventEnded(ev.id);
                              onToast(`"${ev.name}" marked as ended`, "success");
                            }}
                          >⏹ End Event</button>
                        )}

                        <button type="button" className="btn org-manage-btn org-delete-btn"
                          onClick={() => {
                            if (!window.confirm(`Delete "${ev.name}"? This cannot be undone.`)) return;
                            onEventDeleted(ev.id);
                            onToast(`"${ev.name}" deleted`, "");
                          }}
                        >🗑 Delete</button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Attendance ── */}
      {activeTab === "attendance" && (
        <div className="fade-up">
          {/* Event selector */}
          <div className="card org-create-card">
            <div className="event-name org-card-title">✅ Attendance</div>
            <p className="org-create-hint">
              Select an event to view participants who checked in with the join code and confirm their attendance on-chain.
            </p>
            <div>
              <div className="org-field-label">Event</div>
              <select
                className="org-input"
                title="Select event"
                value={pendingDemoId}
                onChange={(e) => setPendingDemoId(e.target.value)}
              >
                <option value="">— select a deployed event —</option>
                {deployedEvents.map((ev) => (
                  <option key={ev.id} value={String(ev.id)}>
                    #{deployedEventIds[ev.id]} — {ev.emoji} {ev.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {pendingDemoId && (
            <>
              {backendError && (
                <div className="card org-create-card org-backend-error">
                  ⚠️ {backendError}
                </div>
              )}
              {/* ── Awaiting Confirmation ── */}
              <div className="card org-create-card org-attendance-section">
                <div className="org-pending-header">
                  <div className="event-name org-card-title org-title-inline">⏳ Awaiting Confirmation</div>
                  {isLoadingPending && <span className="spinner" />}
                  {pendingList.length > 0 && (
                    <button type="button" className="btn btn-primary"
                      disabled={isConfirmingAll} onClick={confirmAll}
                    >
                      {isConfirmingAll ? <><span className="spinner" /> Confirming all...</> : "✅ Confirm All"}
                    </button>
                  )}
                </div>
                <p className="org-create-hint org-hint-tight">
                  Participants who entered the join code and are waiting for on-chain confirmation.
                </p>

                {pendingList.length > 0 ? (
                  <div className="org-attendee-list">
                    <table className="cert-history-table">
                      <thead>
                        <tr><th>Wallet</th><th>Action</th></tr>
                      </thead>
                      <tbody>
                        {pendingList.map((p) => (
                          <tr key={p.attendee}>
                            <td className="cert-history-name">
                              {p.ens
                                ? <><span className="org-cert-ens">{p.ens}</span><span className="org-attendee-addr-sub mono"> {p.attendee.slice(0, 6)}…{p.attendee.slice(-4)}</span></>
                                : <span className="mono">{p.attendee.slice(0, 10)}...{p.attendee.slice(-8)}</span>}
                            </td>
                            <td>
                              <button type="button" className="btn btn-primary org-confirm-btn"
                                disabled={confirmingAttendee === p.attendee || isConfirmingAll}
                                onClick={() => confirmOne(p.attendee)}
                              >
                                {confirmingAttendee === p.attendee
                                  ? <><span className="spinner" /> Confirming...</>
                                  : "Confirm"}
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !isLoadingPending && (
                    <p className="text-muted org-attendee-empty">No participants awaiting confirmation.</p>
                  )
                )}

              </div>

              {/* ── Confirmed On-Chain ── */}
              <div className="card org-create-card org-attendance-section">
                <div className="org-pending-header">
                  <div className="event-name org-card-title org-title-inline">📋 Confirmed Attendees</div>
                  {isLoadingAttendees && <span className="spinner" />}
                  {attendees.length > 0 && (
                    <span className="org-attendee-count">{attendees.length} confirmed</span>
                  )}
                </div>
                <p className="org-create-hint org-hint-tight">
                  Attendance records written on-chain — verifiable on Sepolia Etherscan.
                </p>

                {attendees.length > 0 ? (
                  <div className="org-attendee-list">
                    <table className="cert-history-table">
                      <thead>
                        <tr><th>Wallet</th><th>Confirmed At</th><th>Tx</th></tr>
                      </thead>
                      <tbody>
                        {attendees.map((a, i) => (
                          <tr key={a.txHash ?? a.attendee ?? i}>
                            <td className="cert-history-name">
                              {a.ens
                                ? <><span className="org-cert-ens">{a.ens}</span><span className="org-attendee-addr-sub mono"> {a.attendee.slice(0, 6)}…{a.attendee.slice(-4)}</span></>
                                : <span className="mono">{a.attendee.slice(0, 8)}…{a.attendee.slice(-6)}</span>}
                            </td>
                            <td className="org-attendee-time">{a.timestamp ? new Date(a.timestamp * 1000).toLocaleString() : "—"}</td>
                            <td>
                              {a.txHash ? (
                                <a href={`https://sepolia.etherscan.io/tx/${a.txHash}`}
                                  target="_blank" rel="noopener noreferrer" className="tx-link"
                                >
                                  {a.txHash.slice(0, 8)}...↗
                                </a>
                              ) : "—"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  !isLoadingAttendees && (
                    <p className="text-muted org-attendee-empty">No confirmed attendees yet.</p>
                  )
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Certificates ── */}
      {activeTab === "certificates" && (
        <div className="fade-up">
          {/* Event selector + Issue action */}
          <div className="card org-create-card">
            <div className="event-name org-card-title">📜 Certificates</div>
            <p className="org-create-hint">
              Select an event to issue certificates. Only attendees who have confirmed attendance <strong>and</strong> claimed their POAP badge are eligible. Already-certified attendees are skipped automatically.
            </p>
            <div className="org-form">
              <div>
                <div className="org-field-label">Event</div>
                <select className="org-input" title="Select event"
                  value={certDemoId}
                  onChange={(e) => setCertDemoId(e.target.value)}
                >
                  <option value="">— select a deployed event —</option>
                  {deployedEvents.map((ev) => (
                    <option key={ev.id} value={String(ev.id)}>
                      #{deployedEventIds[ev.id]} — {ev.emoji} {ev.name}
                    </option>
                  ))}
                </select>
              </div>
              {certDemoId && (
                <button type="button" className="btn btn-primary btn-block"
                  disabled={isBulkIssuing} onClick={issueBulkCertificates}
                >
                  {isBulkIssuing ? <><span className="spinner" /> Issuing...</> : "📜 Issue Certificates to All Attendees"}
                </button>
              )}
            </div>
            {bulkResults && (
              <div className="org-bulk-results">
                <span className="org-bulk-issued">✓ Issued: {bulkResults.issued}</span>
                <span className="org-bulk-skipped">↷ Skipped: {bulkResults.skipped}</span>
                {bulkResults.failed > 0 && <span className="org-bulk-failed">✗ Failed: {bulkResults.failed}</span>}
              </div>
            )}
          </div>

          {/* Issued certificates list */}
          {certDemoId && (
            <div className="card org-create-card org-attendance-section">
              <div className="org-pending-header">
                <div className="event-name org-card-title org-title-inline">📋 Issued Certificates</div>
                {isLoadingCerts && <span className="spinner" />}
                {certList.length > 0 && (
                  <span className="org-attendee-count">{certList.length} certificate{certList.length !== 1 ? "s" : ""}</span>
                )}
              </div>
              {certList.length > 0 ? (
                <div className="org-attendee-list">
                  <table className="cert-history-table">
                    <thead>
                      <tr><th>#</th><th>Attendee</th><th>Issued At</th><th>Verify</th></tr>
                    </thead>
                    <tbody>
                      {certList.map((c) => {
                        const vr = certVerifyResults[c.certId];
                        return (
                          <tr key={c.certId}>
                            <td className="org-cert-id">#{c.certId}</td>
                            <td className="cert-history-name">
                              {c.attendeeENS
                                ? <span className="org-cert-ens">{c.attendeeENS}</span>
                                : <span className="mono">{c.attendee.slice(0, 8)}…{c.attendee.slice(-6)}</span>}
                            </td>
                            <td className="org-attendee-time">{new Date(c.timestamp * 1000).toLocaleString()}</td>
                            <td>
                              <button
                                type="button"
                                className="btn btn-outline org-verify-btn"
                                disabled={verifyingCertId === c.certId}
                                onClick={() => verifyCertificate(c.certId)}
                              >
                                {verifyingCertId === c.certId ? <span className="spinner" /> : "🔍 Verify"}
                              </button>
                              {vr && (
                                <div className={`org-verify-result${vr.ok ? " org-verify-ok" : " org-verify-fail"}`}>
                                  {vr.ok ? "✓" : "✗"} {vr.msg}
                                  {vr.ok && vr.url && (
                                    <a href={vr.url} target="_blank" rel="noopener noreferrer" className="org-verify-link">↗</a>
                                  )}
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                !isLoadingCerts && (
                  <p className="text-muted org-attendee-empty">No certificates issued for this event yet.</p>
                )
              )}
            </div>
          )}
        </div>
      )}
    </>
  );
}
