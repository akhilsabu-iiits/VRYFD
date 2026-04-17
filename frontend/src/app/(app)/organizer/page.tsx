"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../contexts/AuthContext";
import { QRCodeSVG } from "qrcode.react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const FRONTEND_URL = process.env.NEXT_PUBLIC_FRONTEND_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

export default function OrganizerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState<"overview" | "create" | "manage">("overview");

  useEffect(() => {
    if (user && user.role !== "admin" && user.role !== "organizer") {
      router.replace("/dashboard");
    }
  }, [user, router]);
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Create event form state
  const [eventName, setEventName] = useState("");
  const [metadataURI, setMetadataURI] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [attendanceThreshold, setAttendanceThreshold] = useState(75);
  const [claimPeriodDays, setClaimPeriodDays] = useState(30);
  const [eventType, setEventType] = useState(0);
  const [creating, setCreating] = useState(false);
  const [createResult, setCreateResult] = useState<string | null>(null);
  const [lastCreatedEventId, setLastCreatedEventId] = useState<string | null>(null);
  const [issuingCerts, setIssuingCerts] = useState<string | null>(null);
  const [certResult, setCertResult] = useState<{id: string; type: "success"|"error"; text: string} | null>(null);
  const [qrEventId, setQrEventId] = useState<string | null>(null);
  const qrRef = useRef<HTMLDivElement>(null);

  const fetchEvents = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("vryfd_token") : null;
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    fetch(`${BACKEND_URL}/api/relay/my-events`, { headers })
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { fetchEvents(); }, [fetchEvents]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setCreateResult(null);
    try {
      if (!startTime || !endTime) {
        setCreateResult("Error: Start and end time are required");
        setCreating(false);
        return;
      }
      const startMs = new Date(startTime).getTime();
      const endMs = new Date(endTime).getTime();
      if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
        setCreateResult("Error: Invalid start or end time");
        setCreating(false);
        return;
      }
      if (endMs <= startMs) {
        setCreateResult("Error: End time must be AFTER start time");
        setCreating(false);
        return;
      }
      if (endMs <= Date.now()) {
        setCreateResult("Error: End time must be in the future");
        setCreating(false);
        return;
      }
      const start = Math.floor(startMs / 1000);
      const end = Math.floor(endMs / 1000);
      const duration = Math.floor((end - start) / 60);
      if (duration < 1) {
        setCreateResult("Error: Event must be at least 1 minute long");
        setCreating(false);
        return;
      }
      const token = localStorage.getItem("vryfd_token");
      const res = await fetch(`${BACKEND_URL}/api/relay/createEvent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          name: eventName,
          metadataURI: metadataURI || `ipfs://event-${Date.now()}`,
          startTime: start,
          endTime: end,
          attendanceThreshold,
          claimPeriodDays,
          durationMinutes: duration,
          eventType,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCreateResult(`Event created! ID: ${data.eventId}`);
        setLastCreatedEventId(String(data.eventId));
        setEventName("");
        setMetadataURI("");
        setStartTime("");
        setEndTime("");
        setAttendanceThreshold(75);
        setClaimPeriodDays(30);
        setEventType(0);
        // Allow the backend index to catch up before refetching
        setTimeout(() => fetchEvents(), 2000);
      } else {
        setCreateResult(`Error: ${data.error || "Failed to create event"}`);
        setLastCreatedEventId(null);
      }
    } catch (err: any) {
      setCreateResult(`Error: ${err.message}`);
    } finally {
      setCreating(false);
    }
  };

  const handleIssueCertificates = async (ev: any) => {
    const eid = ev.onChainId || ev.eventId || ev.id;
    setIssuingCerts(String(eid));
    setCertResult(null);
    try {
      const token = localStorage.getItem("vryfd_token");
      const res = await fetch(`${BACKEND_URL}/api/relay/issueCertificatesBulk`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ onChainEventId: Number(eid) }),
      });
      const text = await res.text();
      let data: any;
      try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 100) }; }
      if (res.ok && data.success) {
        setCertResult({ id: String(eid), type: "success", text: `Issued ${data.issued} cert(s), ${data.skipped} skipped, ${data.failed} failed` });
      } else {
        setCertResult({ id: String(eid), type: "error", text: data.error || "Failed to issue certificates" });
      }
    } catch (err: any) {
      setCertResult({ id: String(eid), type: "error", text: err.message || "Network error" });
    } finally {
      setIssuingCerts(null);
    }
  };

  const downloadQR = () => {
    if (!qrRef.current) return;
    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `event-${qrEventId}-checkin-qr.png`;
        a.click();
        URL.revokeObjectURL(url);
      });
    };
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
  };

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: "dashboard" },
    { id: "create" as const, label: "Create Event", icon: "add_circle" },
    { id: "manage" as const, label: "Manage Events", icon: "settings" },
  ];

  if (user && user.role !== "admin" && user.role !== "organizer") return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-headline text-on-surface">Organizer Dashboard</h1>
          <p className="text-on-surface-variant text-sm mt-1">Create and manage your events</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-emerald-50 text-emerald-700 text-xs font-bold">
            <span className="material-symbols-outlined text-sm">verified</span>
            Organizer
          </span>
          <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-primary-fixed/30 text-primary text-xs font-bold">
            <span className="material-symbols-outlined text-sm">local_gas_station</span>
            Gasless
          </span>
        </div>
      </div>

      {/* Stats — click to jump to that view */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: "event", label: "Total Events", value: events.length, accent: "text-primary", bg: "bg-primary-fixed/30", onClick: () => setActiveTab("manage") },
          { icon: "event_available", label: "Active", value: events.filter((e) => e.active).length, accent: "text-emerald-600", bg: "bg-emerald-50", onClick: () => setActiveTab("manage") },
          { icon: "group", label: "Total Attendees", value: events.reduce((a: number, e: any) => a + (e.attendeeCount || 0), 0), accent: "text-indigo-600", bg: "bg-indigo-50", onClick: () => setActiveTab("manage") },
          { icon: "add_circle", label: "Create Event", value: "+", accent: "text-amber-600", bg: "bg-amber-50", onClick: () => setActiveTab("create") },
        ].map((stat) => (
          <button
            key={stat.label}
            onClick={stat.onClick}
            className="group text-left bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all relative"
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
        <div className="flex gap-1 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-bold font-headline transition-colors border-b-2 whitespace-nowrap ${
                activeTab === tab.id
                  ? "text-primary border-primary"
                  : "text-on-surface-variant border-transparent hover:text-on-surface hover:border-outline-variant/30"
              }`}
            >
              <span className="material-symbols-outlined text-lg">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <h2 className="text-lg font-bold font-headline text-on-surface">Quick Actions</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <button
              onClick={() => setActiveTab("create")}
              className="flex items-center gap-4 p-5 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all text-left group"
            >
              <div className="w-12 h-12 rounded-xl prism-gradient flex items-center justify-center">
                <span className="material-symbols-outlined text-white text-2xl">add</span>
              </div>
              <div>
                <p className="font-bold font-headline text-on-surface group-hover:text-primary transition-colors">Create Event</p>
                <p className="text-xs text-on-surface-variant mt-0.5">Launch a new on-chain event</p>
              </div>
            </button>
            <button
              onClick={() => setActiveTab("manage")}
              className="flex items-center gap-4 p-5 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all text-left group"
            >
              <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-emerald-600 text-2xl">tune</span>
              </div>
              <div>
                <p className="font-bold font-headline text-on-surface group-hover:text-primary transition-colors">Manage Events</p>
                <p className="text-xs text-on-surface-variant mt-0.5">View and edit your events</p>
              </div>
            </button>
            <div className="flex items-center gap-4 p-5 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
              <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
                <span className="material-symbols-outlined text-amber-600 text-2xl">analytics</span>
              </div>
              <div>
                <p className="font-bold font-headline text-on-surface">Analytics</p>
                <p className="text-xs text-on-surface-variant mt-0.5">View event performance</p>
              </div>
            </div>
          </div>

          {/* Recent events table */}
          <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10">
              <h3 className="font-bold font-headline text-on-surface">Your Events</h3>
            </div>
            {loading ? (
              <div className="flex justify-center py-8"><div className="spinner text-primary" /></div>
            ) : events.length === 0 ? (
              <div className="p-8 text-center text-on-surface-variant text-sm">No events yet. Create your first event!</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-container-low">
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Event</th>
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Attendees</th>
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {events.map((ev: any, i: number) => (
                      <tr key={ev.eventId || i} className="border-t border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-on-surface">{ev.name || `Event #${ev.eventId}`}</td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                            ev.active ? "bg-emerald-50 text-emerald-700" : "bg-surface-container text-on-surface-variant"
                          }`}>
                            {ev.active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                            {ev.active ? "Active" : "Ended"}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-on-surface-variant">{ev.attendeeCount || 0}</td>
                        <td className="px-6 py-4 text-on-surface-variant font-mono text-xs">
                          {ev.startTime ? new Date(Number(ev.startTime) * 1000).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "create" && (
        <div className="max-w-xl">
          <div className="bg-surface-container-lowest rounded-xl p-8 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">add_circle</span>
              Create New Event
            </h2>
            <form onSubmit={handleCreate} className="space-y-5">
              <div>
                <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Event Name *
                </label>
                <input
                  type="text"
                  value={eventName}
                  onChange={(e) => setEventName(e.target.value)}
                  placeholder="e.g. Ethereum Builder Summit"
                  required
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
                />
              </div>
              <div>
                <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Metadata URI
                </label>
                <input
                  type="text"
                  value={metadataURI}
                  onChange={(e) => setMetadataURI(e.target.value)}
                  placeholder="ipfs://..."
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                    Start Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={startTime}
                    onChange={(e) => {
                      setStartTime(e.target.value);
                      if (endTime && e.target.value && endTime <= e.target.value) setEndTime("");
                    }}
                    required
                    className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                    End Time *
                  </label>
                  <input
                    type="datetime-local"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    required
                    min={startTime || undefined}
                    className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  {startTime && endTime && endTime <= startTime && (
                    <p className="text-[11px] text-error mt-1">End time must be after start time</p>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                    Threshold %
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={attendanceThreshold}
                    onChange={(e) => setAttendanceThreshold(Number(e.target.value))}
                    className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <p className="text-[10px] text-on-surface-variant mt-1.5">Min attendance to qualify</p>
                </div>
                <div>
                  <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                    Claim Days
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={claimPeriodDays}
                    onChange={(e) => setClaimPeriodDays(Number(e.target.value))}
                    className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                  <p className="text-[10px] text-on-surface-variant mt-1.5">Days to claim after event</p>
                </div>
                <div>
                  <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                    Event Type
                  </label>
                  <select
                    value={eventType}
                    onChange={(e) => setEventType(Number(e.target.value))}
                    className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all"
                  >
                    <option value={0}>Virtual</option>
                    <option value={1}>In-Person</option>
                    <option value={2}>Hybrid</option>
                  </select>
                  <p className="text-[10px] text-on-surface-variant mt-1.5">Format of the event</p>
                </div>
              </div>

              {createResult && createResult.startsWith("Error") && (
                <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm bg-error-container/30 border border-error/20 text-error">
                  <span className="material-symbols-outlined text-lg">error</span>
                  {createResult}
                </div>
              )}

              {lastCreatedEventId ? (
                <div className="rounded-xl border-2 border-emerald-200 bg-emerald-50 p-5 space-y-4">
                  <div className="flex items-start gap-3">
                    <span className="material-symbols-outlined text-emerald-600 text-3xl">rocket_launch</span>
                    <div>
                      <p className="font-bold font-headline text-emerald-800">
                        Event #{lastCreatedEventId} deployed on-chain
                      </p>
                      <p className="text-xs text-emerald-700 mt-0.5">
                        It&apos;s live on the Sepolia attendance contract. You can now configure the POAP badge, share the join code, and start the event.
                      </p>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <a
                      href={`/organizer/events/${lastCreatedEventId}`}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg prism-gradient text-white text-sm font-bold active:scale-[0.98] transition-transform"
                    >
                      <span className="material-symbols-outlined text-base">settings</span>
                      Manage event
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        setLastCreatedEventId(null);
                        setCreateResult(null);
                      }}
                      className="flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-white border border-emerald-200 text-emerald-700 text-sm font-bold hover:bg-emerald-100 transition-colors"
                    >
                      <span className="material-symbols-outlined text-base">add</span>
                      Create another
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={creating}
                  className="w-full py-3.5 rounded-xl prism-gradient text-white font-headline font-bold text-sm active:scale-[0.98] transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {creating ? <div className="spinner text-white" /> : (
                    <>
                      <span className="material-symbols-outlined">rocket_launch</span>
                      Deploy Event On-Chain
                    </>
                  )}
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {activeTab === "manage" && (
        <div className="space-y-4">
          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner text-primary" /></div>
          ) : events.length === 0 ? (
            <div className="text-center py-16 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
              <span className="material-symbols-outlined text-5xl text-outline mb-4 block">event_note</span>
              <p className="text-on-surface-variant">No events to manage. Create one first!</p>
            </div>
          ) : (
            events.map((ev: any, i: number) => (
              <div key={ev.eventId || i} className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg prism-gradient flex items-center justify-center text-white font-bold">
                      {(ev.name || "E").charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-on-surface">{ev.name || `Event #${ev.eventId}`}</h3>
                      <p className="text-xs text-on-surface-variant">ID: {ev.eventId}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                      ev.active ? "bg-emerald-50 text-emerald-700" : "bg-surface-container text-on-surface-variant"
                    }`}>
                      {ev.active ? "Active" : "Ended"}
                    </span>
                    {ev.onChainPending && (
                      <span
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-50 text-amber-700"
                        title="Waiting for Sepolia block confirmation (~15s after submission)"
                      >
                        <div className="spinner text-amber-700" style={{ width: 10, height: 10 }} />
                        Confirming
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-3 mb-4">
                  <div className="px-4 py-2 rounded-lg bg-surface-container-low text-xs">
                    <span className="text-on-surface-variant">Attendees: </span>
                    <span className="font-bold text-on-surface">{ev.attendeeCount || 0}</span>
                  </div>
                  <div className="px-4 py-2 rounded-lg bg-surface-container-low text-xs">
                    <span className="text-on-surface-variant">Threshold: </span>
                    <span className="font-bold text-on-surface">{ev.attendanceThreshold || 75}%</span>
                  </div>
                  <div className="px-4 py-2 rounded-lg bg-surface-container-low text-xs">
                    <span className="text-on-surface-variant">Join Code: </span>
                    <span className="font-bold text-on-surface font-mono">{ev.joinCode || "—"}</span>
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <a
                    href={`/organizer/events/${ev.onChainId || ev.eventId || ev.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg prism-gradient text-white text-xs font-bold hover:opacity-90 transition-opacity"
                  >
                    <span className="material-symbols-outlined text-sm">tune</span>
                    Manage
                  </a>
                  <a
                    href={`/live/${ev.onChainId || ev.eventId || ev.id}`}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-primary/10 text-primary text-xs font-bold hover:bg-primary/20 transition-colors"
                  >
                    <span className="material-symbols-outlined text-sm">videocam</span>
                    Go Live
                  </a>
                  {/* QR is useful for both In-Person (1) and Hybrid (2) events.
                      For Virtual events (0) the join link alone is enough so we skip the QR. */}
                  {(ev.eventType === 1 || ev.eventType === 2) && (
                    <button
                      onClick={() => setQrEventId(String(ev.onChainId || ev.eventId || ev.id))}
                      className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-indigo-50 text-indigo-700 text-xs font-bold hover:bg-indigo-100 transition-colors"
                    >
                      <span className="material-symbols-outlined text-sm">qr_code_2</span>
                      Check-In QR
                    </button>
                  )}
                  <button
                    onClick={() => handleIssueCertificates(ev)}
                    disabled={issuingCerts === String(ev.onChainId || ev.eventId || ev.id)}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100 transition-colors disabled:opacity-50"
                  >
                    {issuingCerts === String(ev.onChainId || ev.eventId || ev.id) ? (
                      <div className="spinner text-emerald-700" style={{ width: 12, height: 12 }} />
                    ) : (
                      <span className="material-symbols-outlined text-sm">workspace_premium</span>
                    )}
                    Issue Certificates
                  </button>
                </div>
                {certResult && certResult.id === String(ev.onChainId || ev.eventId || ev.id) && (
                  <div className={`mt-3 flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${
                    certResult.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
                  }`}>
                    <span className="material-symbols-outlined text-sm">{certResult.type === "error" ? "error" : "check_circle"}</span>
                    {certResult.text}
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}
      {/* QR Code Modal */}
      {qrEventId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setQrEventId(null)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-bold font-headline text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">qr_code_2</span>
                Event Check-In QR
              </h3>
              <button onClick={() => setQrEventId(null)} className="text-on-surface-variant hover:text-on-surface">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>

            <div ref={qrRef} className="flex justify-center items-center bg-white p-6 rounded-xl border-2 border-outline-variant/20 mb-4">
              <QRCodeSVG
                value={`${FRONTEND_URL}/live/${qrEventId}?checkin=true`}
                size={260}
                level="H"
                includeMargin
              />
            </div>

            <p className="text-xs text-center text-on-surface-variant mb-4">
              Attendees scan this QR code to open the event and check in.
            </p>

            <div className="space-y-2">
              <button
                onClick={downloadQR}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary/10 text-primary text-sm font-bold hover:bg-primary/20 transition-colors"
              >
                <span className="material-symbols-outlined text-lg">download</span>
                Download QR Image
              </button>
              <button
                onClick={() => {
                  const printW = window.open("", "_blank");
                  if (!printW) return;
                  const evName = events.find((e: any) => String(e.onChainId || e.eventId || e.id) === qrEventId)?.name || `Event ${qrEventId}`;
                  printW.document.write(`<!DOCTYPE html><html><head><title>${evName} – Check-In QR</title><style>body{font-family:Arial,sans-serif;display:flex;flex-direction:column;align-items:center;padding:60px}h1{font-size:28px;margin-bottom:8px}.sub{color:#666;margin-bottom:32px}.qr{border:3px solid #000;padding:32px;background:#fff}@media print{button{display:none}}</style></head><body><h1>${evName}</h1><p class="sub">Scan to check in</p><div class="qr">${qrRef.current?.innerHTML || ""}</div><button onclick="window.print()" style="margin-top:32px;padding:12px 32px;font-size:16px;cursor:pointer;background:#6750a4;color:#fff;border:none;border-radius:12px">Print</button></body></html>`);
                  printW.document.close();
                }}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-surface-container text-on-surface text-sm font-bold hover:bg-surface-container-high transition-colors"
              >
                <span className="material-symbols-outlined text-lg">print</span>
                Print for Display
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
