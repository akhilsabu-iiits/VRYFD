"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "../../../contexts/AuthContext";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface StatCard {
  icon: string;
  label: string;
  value: string | number;
  accent: string;
  bgAccent: string;
  href?: string;
  description?: string;
}

function getTierLabel(checkins: number): string {
  if (checkins >= 20) return "Gold";
  if (checkins >= 10) return "Silver";
  if (checkins >= 5) return "Bronze";
  return "Newcomer";
}

export default function DashboardPage() {
  const { user } = useAuth();
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [checkinCount, setCheckinCount] = useState(0);
  const [certCount, setCertCount] = useState(0);
  const [tokenBalance, setTokenBalance] = useState(0);

  const fetchAll = useCallback(() => {
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));

    if (user?.address) {
      fetch(`${BACKEND_URL}/api/attendance/my-checkins?wallet=${encodeURIComponent(user.address)}`)
        .then((r) => r.json())
        .then((data) => { if (data.total !== undefined) setCheckinCount(data.total); })
        .catch(() => {});

      fetch(`${BACKEND_URL}/api/certificates/mine/${encodeURIComponent(user.address)}`)
        .then((r) => r.json())
        .then((data) => { if (data.certificates) setCertCount(data.certificates.length); })
        .catch(() => {});

      fetch(`${BACKEND_URL}/api/relay/token-balance/${encodeURIComponent(user.address)}`)
        .then((r) => r.json())
        .then((data) => { if (data.balance !== undefined) setTokenBalance(data.balance); })
        .catch(() => {});
    }
  }, [user?.address]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const activeCount = events.filter((e: any) => e.active).length;

  const stats: StatCard[] = [
    { icon: "event_available", label: "Active Events", value: activeCount, accent: "text-primary", bgAccent: "bg-primary-fixed/30", href: "/marketplace", description: "Browse events" },
    { icon: "check_circle", label: "Your Check-ins", value: checkinCount, accent: "text-emerald-600", bgAccent: "bg-emerald-50", href: "/profile?tab=activity", description: "View history" },
    { icon: "military_tech", label: "Badges Earned", value: certCount, accent: "text-amber-600", bgAccent: "bg-amber-50", href: "/profile?tab=badges", description: "View badges" },
    { icon: "workspace_premium", label: "Your Tier", value: getTierLabel(checkinCount), accent: "text-primary", bgAccent: "bg-primary-fixed/20", href: "/profile", description: "View profile" },
    { icon: "token", label: "VRYF Tokens", value: tokenBalance, accent: "text-indigo-600", bgAccent: "bg-indigo-50", href: "/profile?tab=tokens", description: "View balance" },
  ];

  return (
    <div className="space-y-8">
      {/* Welcome section */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold font-headline text-on-surface">
            Welcome back{user?.name ? `, ${user.name}` : user?.ensName ? `, ${user.ensName}` : ""}
          </h1>
          <p className="text-on-surface-variant text-sm mt-1">
            Here&apos;s what&apos;s happening with your events
          </p>
        </div>
        <Link
          href="/marketplace"
          className="hidden sm:flex items-center gap-2 prism-gradient text-white px-5 py-2.5 rounded-xl font-headline font-bold text-sm active:scale-95 transition-all duration-150"
        >
          <span className="material-symbols-outlined text-lg">explore</span>
          Explore Events
        </Link>
      </div>

      {/* Stat cards grid — each card is a link to the relevant module */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {stats.map((stat) =>
          stat.href ? (
            <Link
              key={stat.label}
              href={stat.href}
              className="group bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all cursor-pointer relative"
            >
              <div className={`w-10 h-10 rounded-lg ${stat.bgAccent} flex items-center justify-center mb-3`}>
                <span className={`material-symbols-outlined ${stat.accent}`}>{stat.icon}</span>
              </div>
              <p className="text-2xl font-bold font-headline text-on-surface">{stat.value}</p>
              <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider mt-1">{stat.label}</p>
              <span className="absolute top-3 right-3 material-symbols-outlined text-sm text-outline group-hover:text-primary transition-colors">
                arrow_outward
              </span>
              {stat.description && (
                <p className="text-[10px] text-primary mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {stat.description} →
                </p>
              )}
            </Link>
          ) : (
            <div
              key={stat.label}
              className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10"
            >
              <div className={`w-10 h-10 rounded-lg ${stat.bgAccent} flex items-center justify-center mb-3`}>
                <span className={`material-symbols-outlined ${stat.accent}`}>{stat.icon}</span>
              </div>
              <p className="text-2xl font-bold font-headline text-on-surface">{stat.value}</p>
              <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider mt-1">{stat.label}</p>
            </div>
          )
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Link
          href="/claim"
          className="flex items-center gap-4 p-5 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-emerald-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-emerald-600 text-2xl">redeem</span>
          </div>
          <div>
            <p className="font-bold font-headline text-on-surface group-hover:text-primary transition-colors">Claim Center</p>
            <p className="text-xs text-on-surface-variant mt-0.5">Claim your pending rewards</p>
          </div>
        </Link>
        <Link
          href="/profile"
          className="flex items-center gap-4 p-5 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-primary-fixed/30 flex items-center justify-center">
            <span className="material-symbols-outlined text-primary text-2xl">badge</span>
          </div>
          <div>
            <p className="font-bold font-headline text-on-surface group-hover:text-primary transition-colors">Trophy Room</p>
            <p className="text-xs text-on-surface-variant mt-0.5">View your badges & certificates</p>
          </div>
        </Link>
        <Link
          href="/organizer"
          className="flex items-center gap-4 p-5 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all group"
        >
          <div className="w-12 h-12 rounded-xl bg-amber-50 flex items-center justify-center">
            <span className="material-symbols-outlined text-amber-600 text-2xl">event_note</span>
          </div>
          <div>
            <p className="font-bold font-headline text-on-surface group-hover:text-primary transition-colors">Organize</p>
            <p className="text-xs text-on-surface-variant mt-0.5">Create and manage events</p>
          </div>
        </Link>
      </div>

      {/* Recent Events */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold font-headline text-on-surface">Recent Events</h2>
          <Link href="/marketplace" className="text-sm text-primary font-bold hover:underline">
            View All
          </Link>
        </div>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="spinner text-primary" />
          </div>
        ) : events.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl p-12 text-center shadow-ambient border border-outline-variant/10">
            <span className="material-symbols-outlined text-4xl text-outline mb-3 block">calendar_today</span>
            <p className="text-on-surface-variant text-sm">No events yet. Explore the marketplace to find events!</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {events.slice(0, 4).map((ev: any, i: number) => (
              <Link
                key={ev.onChainId || ev.eventId || i}
                href={`/events/${ev.onChainId || ev.eventId || ev.id}`}
                className="bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-0.5 transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg prism-gradient flex items-center justify-center text-white font-bold text-sm">
                      {(ev.name || "E").charAt(0)}
                    </div>
                    <div>
                      <h3 className="font-bold text-sm text-on-surface group-hover:text-primary transition-colors">
                        {ev.name || `Event #${ev.eventId}`}
                      </h3>
                      <p className="text-xs text-on-surface-variant mt-0.5">
                        ID: {ev.eventId}
                      </p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                      ev.active
                        ? "bg-emerald-50 text-emerald-700"
                        : "bg-surface-container text-on-surface-variant"
                    }`}
                  >
                    {ev.active && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />}
                    {ev.active ? "Active" : "Ended"}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-on-surface-variant">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">group</span>
                    {ev.attendeeCount || 0} attendees
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">schedule</span>
                    {ev.startTime ? new Date(Number(ev.startTime) * 1000).toLocaleDateString() : "TBD"}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
