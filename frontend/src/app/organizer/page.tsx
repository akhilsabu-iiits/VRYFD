"use client";

import React, { useState, useCallback, useEffect, useMemo, useRef } from "react";
import OrganizerPage from "../../components/OrganizerPage";
import OrganizerLogin from "../../components/OrganizerLogin";
import { type VEvent, INITIAL_EVENTS } from "../../lib/vryfd";

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const STORAGE_KEY = "vryfd_all_events";

// ── Toast ────────────────────────────────────────────────────────────────────

type ToastType = "success" | "error" | "";

function useToast() {
  const [toast, setToast] = useState<{ message: string; type: ToastType; visible: boolean }>({
    message: "", type: "", visible: false,
  });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string, type: ToastType) => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setToast({ message: msg, type, visible: true });
    timerRef.current = setTimeout(() => setToast((t) => ({ ...t, visible: false })), 3500);
  }, []);

  return { toast, showToast };
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OrganizerDashboard() {
  const [isAuthed, setIsAuthed] = useState<boolean>(
    () => typeof window !== "undefined" && sessionStorage.getItem("vryfd_org_authed") === "1"
  );
  const { toast, showToast } = useToast();

  // ── Events state ─────────────────────────────────────────────────────────────
  const [events, setEvents] = useState<VEvent[]>(() => {
    if (typeof window === "undefined") return INITIAL_EVENTS;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return JSON.parse(raw) as VEvent[];
    } catch { /* ignore */ }
    return INITIAL_EVENTS;
  });

  // Persist events to localStorage + backend whenever they change
  const persistEventsRef = useRef(false);
  useEffect(() => {
    if (!persistEventsRef.current) { persistEventsRef.current = true; return; }
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(events)); } catch { /* ignore */ }
    const secret = sessionStorage.getItem("vryfd_org_secret");
    fetch(`${BACKEND}/api/relay/events`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-admin-secret": secret } : {}),
      },
      body: JSON.stringify({ events }),
    }).catch(() => {});
  }, [events]);

  // Load events from backend on mount (backend is source of truth after a reset)
  useEffect(() => {
    fetch(`${BACKEND}/api/relay/events`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.events) && d.events.length > 0) {
          setEvents(d.events as VEvent[]);
        }
      })
      .catch(() => {});
  }, []);

  // ── Derived deployment maps ───────────────────────────────────────────────────
  const deployedEventIds = useMemo(() =>
    events.filter((e) => e.onChainId !== undefined)
      .reduce((acc, e) => ({ ...acc, [e.id]: e.id }), {} as Record<number, number>),
  [events]);

  const onChainEventIds = useMemo(() =>
    events.filter((e) => e.onChainId !== undefined)
      .reduce((acc, e) => ({ ...acc, [e.id]: e.onChainId! }), {} as Record<number, number>),
  [events]);

  const onChainDeployedIds = useMemo(() =>
    new Set(events.filter((e) => e.onChainId !== undefined).map((e) => e.id)),
  [events]);

  // Derive live/upcoming status same way as main app
  const displayEvents = events.map((ev) => {
    if (!onChainDeployedIds.has(ev.id)) return ev;
    if (ev.status === "ended") return ev;
    const now = Math.floor(Date.now() / 1000);
    const start = ev.startTime ?? 0;
    const end = ev.endTime ?? Infinity;
    return { ...ev, status: now >= start && now <= end ? "live" as const : "upcoming" as const };
  });

  // ── Event callbacks ───────────────────────────────────────────────────────────
  const handleEventDeployed = useCallback((demoId: number, onChainId: number, txHash: string) => {
    setEvents((prev) => prev.map((ev) =>
      ev.id === demoId ? { ...ev, onChainId, deployTxHash: txHash } : ev
    ));
  }, []);

  const handleEventCreated = useCallback((eventData: Omit<VEvent, "id">) => {
    setEvents((prev) => {
      const id = prev.length > 0 ? Math.max(...prev.map((e) => e.id)) + 1 : 1;
      return [...prev, { id, ...eventData }];
    });
  }, []);

  const handleEventUpdated = useCallback((id: number, patch: Partial<Pick<VEvent, "name" | "emoji" | "color" | "date">>) => {
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, ...patch } : ev));
  }, []);

  const handleEventEnded = useCallback((id: number) => {
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, status: "ended" as const } : ev));
  }, []);

  const handleEventResumed = useCallback((id: number) => {
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, status: "upcoming" as const } : ev));
  }, []);

  const handleEventDeleted = useCallback((id: number) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id));
  }, []);

  const handleLock = useCallback(() => {
    sessionStorage.removeItem("vryfd_org_authed");
    sessionStorage.removeItem("vryfd_org_secret");
    setIsAuthed(false);
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <>
      {/* Minimal navbar */}
      <nav className="nav">
        <div className="nav-left">
          <a href="/app" className="nav-brand org-console-brand">VRYFD</a>
        </div>
        <div className="org-console-right">
          <span className="org-console-label">ORGANIZER CONSOLE</span>
          {isAuthed && (
            <button type="button" className="btn btn-outline btn-sm" onClick={handleLock}>
              🔒 Lock
            </button>
          )}
        </div>
      </nav>

      <div className="container">
        {isAuthed ? (
          <OrganizerPage
            events={displayEvents}
            deployedEventIds={deployedEventIds}
            onChainDeployedIds={onChainDeployedIds}
            onChainEventIds={onChainEventIds}
            onEventDeployed={handleEventDeployed}
            onEventCreated={handleEventCreated}
            onEventUpdated={handleEventUpdated}
            onEventEnded={handleEventEnded}
            onEventResumed={handleEventResumed}
            onEventDeleted={handleEventDeleted}
            onToast={showToast}
          />
        ) : (
          <OrganizerLogin onSuccess={() => setIsAuthed(true)} />
        )}
      </div>

      {/* Toast */}
      <div className={`toast${toast.visible ? " show" : ""}${toast.type ? " " + toast.type : ""}`}>
        {toast.type === "success" ? "✓ " : toast.type === "error" ? "✗ " : "● "}
        {toast.message}
      </div>
    </>
  );
}
