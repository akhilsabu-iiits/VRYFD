"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useAuth } from "../../../../contexts/AuthContext";
import { QRCodeSVG } from "qrcode.react";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const FRONTEND_URL = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";

export default function EventDetailPage() {
  const params = useParams();
  const eventId = params?.id;
  const { user } = useAuth();
  const [event, setEvent] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!eventId) return;
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => {
        const events = data.events || [];
        const found = events.find(
          (e: any) =>
            String(e.id) === String(eventId) ||
            String(e.eventId) === String(eventId) ||
            String(e.onChainId) === String(eventId)
        );
        setEvent(found || null);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [eventId]);

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
        <h2 className="text-xl font-bold font-headline text-on-surface mb-2">Event Not Found</h2>
        <p className="text-on-surface-variant text-sm mb-6">The event you&apos;re looking for doesn&apos;t exist.</p>
        <Link href="/marketplace" className="text-primary font-bold hover:underline">Back to Marketplace</Link>
      </div>
    );
  }

  const startDate = event.startTime ? new Date(Number(event.startTime) * 1000) : null;
  const endDate = event.endTime ? new Date(Number(event.endTime) * 1000) : null;

  return (
    <div className="space-y-8">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-sm text-on-surface-variant">
        <Link href="/marketplace" className="hover:text-primary transition-colors">Marketplace</Link>
        <span className="material-symbols-outlined text-sm">chevron_right</span>
        <span className="text-on-surface font-medium">{event.name || `Event #${event.id || event.eventId}`}</span>
      </nav>

      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden prism-gradient">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
        <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-white/5" />
        <div className="relative z-10 p-10 md:p-14">
          <span
            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold mb-4 ${
              event.active
                ? "bg-emerald-500 text-white"
                : "bg-white/20 text-white"
            }`}
          >
            {event.active && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
            {event.active ? "Active" : "Ended"}
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold font-headline text-white mb-3">
            {event.name || `Event #${event.id || event.eventId}`}
          </h1>
          <div className="flex flex-wrap items-center gap-6 text-white/70 text-sm mt-4">
            {startDate && (
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-lg">calendar_today</span>
                {startDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}
              </span>
            )}
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">group</span>
              {event.attendeeCount || 0} attendees
            </span>
            <span className="flex items-center gap-2">
              <span className="material-symbols-outlined text-lg">verified</span>
              On-Chain Verified
            </span>
          </div>
        </div>
      </div>

      {/* Content grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          {/* About */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">info</span>
              About This Event
            </h2>
            <p className="text-on-surface-variant text-sm leading-relaxed">
              {event.metadataURI || "Blockchain-verified event with soulbound attendance certificates. Check in during the event to earn your proof of attendance badge and VRYF token rewards."}
            </p>
          </div>

          {/* Schedule */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">schedule</span>
              Event Schedule
            </h2>
            <div className="space-y-4">
              <div className="flex items-start gap-4 p-4 rounded-lg bg-surface-container-low">
                <div className="w-10 h-10 rounded-lg bg-primary-fixed/30 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-primary">login</span>
                </div>
                <div>
                  <p className="font-bold text-sm text-on-surface">Event Start</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {startDate ? startDate.toLocaleString() : "To be announced"}
                  </p>
                </div>
              </div>
              <div className="flex items-start gap-4 p-4 rounded-lg bg-surface-container-low">
                <div className="w-10 h-10 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <span className="material-symbols-outlined text-emerald-600">logout</span>
                </div>
                <div>
                  <p className="font-bold text-sm text-on-surface">Event End</p>
                  <p className="text-xs text-on-surface-variant mt-0.5">
                    {endDate ? endDate.toLocaleString() : "To be announced"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* On-chain info */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">token</span>
              On-Chain Details
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 rounded-lg bg-surface-container-low">
                <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Event ID</p>
                <p className="text-sm font-bold text-on-surface mt-1 font-mono">{event.onChainId || event.eventId || event.id}</p>
              </div>
              <div className="p-4 rounded-lg bg-surface-container-low">
                <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Threshold</p>
                <p className="text-sm font-bold text-on-surface mt-1">{event.attendanceThreshold || 75}%</p>
              </div>
              <div className="p-4 rounded-lg bg-surface-container-low col-span-2">
                <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Organizer</p>
                <p className="text-sm font-bold text-on-surface mt-1 font-mono truncate">{event.organizer || "—"}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar - Registration */}
        <div className="space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10 sticky top-24">
            <h3 className="text-lg font-bold font-headline text-on-surface mb-4">Registration</h3>
            {event.active ? (
              <>
                <div className="p-4 rounded-lg bg-emerald-50 border border-emerald-200 mb-4">
                  <p className="text-sm font-bold text-emerald-700 flex items-center gap-2">
                    <span className="material-symbols-outlined text-lg">check_circle</span>
                    Event is Active
                  </p>
                  <p className="text-xs text-emerald-600 mt-1">You can check in now to earn your certificate.</p>
                </div>
                <Link
                  href={`/live/${event.onChainId || event.eventId || event.id}`}
                  className="w-full flex items-center justify-center gap-2 prism-gradient text-white py-3.5 rounded-xl font-headline font-bold text-sm active:scale-[0.98] transition-all"
                >
                  <span className="material-symbols-outlined">play_arrow</span>
                  Join Event
                </Link>
              </>
            ) : (
              <div className="p-4 rounded-lg bg-surface-container border border-outline-variant/20">
                <p className="text-sm text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-lg">event_busy</span>
                  This event has ended
                </p>
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-outline-variant/15">
              <h4 className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider mb-3">Rewards</h4>
              <div className="space-y-3">
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-primary text-lg">badge</span>
                  <span className="text-sm text-on-surface">Soulbound POAP Badge</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-amber-600 text-lg">workspace_premium</span>
                  <span className="text-sm text-on-surface">Attendance Certificate</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="material-symbols-outlined text-indigo-600 text-lg">token</span>
                  <span className="text-sm text-on-surface">VRYF Token Reward</span>
                </div>
              </div>
            </div>
          </div>

          {/* QR Code for in-person / hybrid events */}
          {(event.eventType === 0 || event.eventType === 2) && event.active && (
            <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
              <h3 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">qr_code_2</span>
                In-Person Check-In
              </h3>
              <p className="text-xs text-on-surface-variant mb-4">Scan this QR code at the venue to check in.</p>
              <div className="flex justify-center bg-white p-4 rounded-xl border border-outline-variant/15">
                <QRCodeSVG
                  value={`${FRONTEND_URL}/live/${event.onChainId || event.eventId || event.id}?checkin=true`}
                  size={180}
                  level="H"
                  includeMargin
                />
              </div>
              <p className="text-[10px] text-center text-on-surface-variant mt-3">
                Event #{event.onChainId || event.eventId || event.id} &middot; {event.eventType === 0 ? "In-Person" : "Hybrid"}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
