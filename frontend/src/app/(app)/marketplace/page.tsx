"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const CATEGORIES = ["All", "Virtual", "In-Person", "Hybrid", "Workshop", "Conference"];

export default function MarketplacePage() {
  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    fetch(`${BACKEND_URL}/api/relay/events`)
      .then((r) => r.json())
      .then((data) => setEvents(data.events || []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = events.filter((ev) => {
    const matchesSearch =
      !search ||
      (ev.name || "").toLowerCase().includes(search.toLowerCase());
    const matchesCategory = activeCategory === "All" || true;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="space-y-8">
      {/* Hero */}
      <div className="relative rounded-2xl overflow-hidden prism-gradient p-10 md:p-14">
        <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
        <div className="absolute -bottom-20 -right-20 w-72 h-72 rounded-full bg-white/5" />
        <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-white/5" />
        <div className="relative z-10">
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 text-white/80 text-xs font-label uppercase tracking-wider mb-4">
            <span className="material-symbols-outlined text-sm">explore</span>
            Event Marketplace
          </span>
          <h1 className="text-3xl md:text-4xl font-extrabold font-headline text-white mb-3">
            Discover Events
          </h1>
          <p className="text-white/70 max-w-lg text-sm leading-relaxed">
            Explore curated blockchain and tech events. Attend, earn soulbound certificates, and build your on-chain reputation.
          </p>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="relative flex-1 w-full sm:max-w-md">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-xl">search</span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search events..."
            className="w-full pl-10 pr-4 py-2.5 rounded-xl bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={`px-4 py-2 rounded-full text-xs font-bold font-label uppercase tracking-wider transition-all ${
                activeCategory === cat
                  ? "prism-gradient text-white"
                  : "bg-surface-container text-on-surface-variant hover:bg-surface-container-high"
              }`}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Stats strip */}
      <div className="flex items-center gap-8 px-6 py-4 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
        <div>
          <p className="text-xl font-bold font-headline text-on-surface">{events.length}</p>
          <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Total Events</p>
        </div>
        <div className="w-px h-8 bg-outline-variant/20" />
        <div>
          <p className="text-xl font-bold font-headline text-emerald-600">{events.filter((e) => e.active).length}</p>
          <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Active Now</p>
        </div>
        <div className="w-px h-8 bg-outline-variant/20" />
        <div>
          <p className="text-xl font-bold font-headline text-primary">{events.filter((e) => !e.active).length}</p>
          <p className="text-xs text-on-surface-variant font-label uppercase tracking-wider">Completed</p>
        </div>
      </div>

      {/* Events grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="spinner text-primary" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10">
          <span className="material-symbols-outlined text-5xl text-outline mb-4 block">event_busy</span>
          <p className="text-on-surface-variant">No events found. Try adjusting your search.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filtered.map((ev, i) => (
            <Link
              key={ev.onChainId || ev.id || ev.eventId || i}
              href={`/events/${ev.onChainId || ev.id || ev.eventId || i}`}
              className="bg-surface-container-lowest rounded-xl overflow-hidden shadow-ambient border border-outline-variant/10 hover:shadow-ambient-lg hover:-translate-y-1 transition-all duration-200 group"
            >
              {/* Card header */}
              <div className="h-36 prism-gradient relative">
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent" />
                <div className="absolute top-4 left-4">
                  <span
                    className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold ${
                      ev.active
                        ? "bg-emerald-500 text-white"
                        : "bg-white/20 text-white"
                    }`}
                  >
                    {ev.active && <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />}
                    {ev.active ? "Active" : "Ended"}
                  </span>
                </div>
                <div className="absolute bottom-4 left-4 right-4">
                  <h3 className="text-white font-bold font-headline text-lg truncate">
                    {ev.name || `Event #${ev.eventId}`}
                  </h3>
                </div>
              </div>

              {/* Card body */}
              <div className="p-5">
                <div className="flex items-center gap-4 text-xs text-on-surface-variant mb-4">
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">schedule</span>
                    {ev.startTime
                      ? new Date(Number(ev.startTime) * 1000).toLocaleDateString()
                      : "TBD"}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="material-symbols-outlined text-sm">group</span>
                    {ev.attendeeCount || 0}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-tertiary-fixed text-on-tertiary-fixed text-xs font-bold">
                      <span className="material-symbols-outlined text-sm">verified</span>
                      On-Chain
                    </span>
                  </div>
                  <span className="text-primary text-sm font-bold opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    View
                    <span className="material-symbols-outlined text-sm">arrow_forward</span>
                  </span>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* FAB for mobile */}
      <Link
        href="/organizer"
        className="lg:hidden fixed bottom-20 right-6 w-14 h-14 rounded-full prism-gradient shadow-ambient-lg flex items-center justify-center text-white z-40 active:scale-95 transition-transform"
      >
        <span className="material-symbols-outlined text-2xl">add</span>
      </Link>
    </div>
  );
}
