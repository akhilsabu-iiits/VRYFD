"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "../../../contexts/AuthContext";

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

interface Invite {
  email: string;
  role: string;
  createdAt: string;
  used: boolean;
  usedAt: string | null;
}

export default function AdminPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [events, setEvents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [health, setHealth] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "events" | "organizers">("overview");

  // Invite state
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteSending, setInviteSending] = useState(false);
  const [inviteMsg, setInviteMsg] = useState<{ type: "success" | "error"; text: string } | null>(null);

  // Role guard
  useEffect(() => {
    if (user && user.role !== "admin") {
      router.replace("/dashboard");
    }
  }, [user, router]);

  const fetchInvites = useCallback(() => {
    const token = typeof window !== "undefined" ? localStorage.getItem("vryfd_token") : null;
    if (!token) return;
    fetch(`${BACKEND_URL}/api/auth/invites`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((data) => setInvites(data.invites || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${BACKEND_URL}/api/relay/events`).then((r) => r.json()).catch(() => ({ events: [] })),
      fetch(`${BACKEND_URL}/api/health`).then((r) => r.json()).catch(() => null),
    ]).then(([evData, healthData]) => {
      setEvents(evData.events || []);
      setHealth(healthData);
      setLoading(false);
    });
    fetchInvites();
  }, [fetchInvites]);

  const handleSendInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    setInviteMsg(null);
    if (!inviteEmail.trim()) return;
    setInviteSending(true);
    try {
      const token = localStorage.getItem("vryfd_token");
      const res = await fetch(`${BACKEND_URL}/api/auth/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ email: inviteEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to send invite");
      setInviteMsg({ type: "success", text: `Invite sent to ${data.email}` });
      setInviteEmail("");
      fetchInvites();
    } catch (err: any) {
      setInviteMsg({ type: "error", text: err.message || "Failed to send invite" });
    } finally {
      setInviteSending(false);
    }
  };

  if (!user || user.role !== "admin") return null;

  const tabs = [
    { id: "overview" as const, label: "Overview", icon: "dashboard" },
    { id: "events" as const, label: "Events", icon: "event" },
    { id: "organizers" as const, label: "Organizers", icon: "people" },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold font-headline text-on-surface">Admin Management</h1>
        <p className="text-on-surface-variant text-sm mt-1">Platform-wide monitoring and configuration</p>
      </div>

      {/* Executive stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { icon: "event", label: "Total Events", value: events.length, accent: "text-primary", bg: "bg-primary-fixed/30", border: "border-l-[3px] border-primary" },
          { icon: "people", label: "Total Attendees", value: events.reduce((a: number, e: any) => a + (e.attendeeCount || 0), 0), accent: "text-emerald-600", bg: "bg-emerald-50", border: "border-l-[3px] border-emerald-500" },
          { icon: "mail", label: "Invites Sent", value: invites.length, accent: "text-violet-600", bg: "bg-violet-50", border: "border-l-[3px] border-violet-500" },
          { icon: "dns", label: "System Status", value: health ? "Online" : "—", accent: "text-emerald-600", bg: "bg-emerald-50", border: "border-l-[3px] border-emerald-500" },
        ].map((stat) => (
          <div key={stat.label} className={`bg-surface-container-lowest rounded-xl p-5 shadow-ambient border border-outline-variant/10 ${stat.border}`}>
            <div className={`w-10 h-10 rounded-lg ${stat.bg} flex items-center justify-center mb-3`}>
              <span className={`material-symbols-outlined ${stat.accent}`}>{stat.icon}</span>
            </div>
            <p className="text-2xl font-bold font-headline text-on-surface">{stat.value}</p>
            <p className="text-xs font-label text-on-surface-variant uppercase tracking-wider mt-1">{stat.label}</p>
          </div>
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
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <div className="space-y-6">
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">monitoring</span>
              System Health
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-surface-container-low">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Backend API</span>
                </div>
                <p className="text-sm font-bold text-on-surface">{health ? "Operational" : "Unknown"}</p>
              </div>
              <div className="p-4 rounded-lg bg-surface-container-low">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  <span className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Blockchain Node</span>
                </div>
                <p className="text-sm font-bold text-on-surface">Hardhat Local</p>
              </div>
              <div className="p-4 rounded-lg bg-surface-container-low">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  <span className="text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Relayer</span>
                </div>
                <p className="text-sm font-bold text-on-surface">Active</p>
              </div>
            </div>
          </div>

          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">history</span>
              Recent Activity
            </h2>
            {events.length === 0 ? (
              <p className="text-on-surface-variant text-sm py-4">No recent activity.</p>
            ) : (
              <div className="space-y-3">
                {events.slice(0, 5).map((ev: any, i: number) => (
                  <div key={ev.eventId || i} className="flex items-center gap-4 p-3 rounded-lg hover:bg-surface-container-low transition-colors">
                    <div className="w-8 h-8 rounded-lg prism-gradient flex items-center justify-center text-white text-xs font-bold">
                      {(ev.name || "E").charAt(0)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-on-surface truncate">{ev.name || `Event #${ev.eventId}`}</p>
                      <p className="text-xs text-on-surface-variant">{ev.attendeeCount || 0} attendees</p>
                    </div>
                    <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold ${
                      ev.active ? "bg-emerald-50 text-emerald-700" : "bg-surface-container text-on-surface-variant"
                    }`}>
                      {ev.active ? "Active" : "Ended"}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === "events" && (
        <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-8"><div className="spinner text-primary" /></div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-surface-container-low">
                    <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">ID</th>
                    <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Event</th>
                    <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                    <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Attendees</th>
                    <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Organizer</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((ev: any, i: number) => (
                    <tr key={ev.eventId || i} className="border-t border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                      <td className="px-6 py-4 font-mono text-xs text-on-surface-variant">{ev.eventId}</td>
                      <td className="px-6 py-4 font-medium text-on-surface">{ev.name || `Event #${ev.eventId}`}</td>
                      <td className="px-6 py-4">
                        <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                          ev.active ? "bg-emerald-50 text-emerald-700" : "bg-surface-container text-on-surface-variant"
                        }`}>
                          {ev.active ? "Active" : "Ended"}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-on-surface-variant">{ev.attendeeCount || 0}</td>
                      <td className="px-6 py-4 font-mono text-xs text-on-surface-variant truncate max-w-[120px]">{ev.organizer || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === "organizers" && (
        <div className="space-y-6">
          {/* Invite Organizer Form */}
          <div className="bg-surface-container-lowest rounded-xl p-6 shadow-ambient border border-outline-variant/10">
            <h2 className="text-lg font-bold font-headline text-on-surface mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">person_add</span>
              Invite Organizer
            </h2>
            <p className="text-on-surface-variant text-sm mb-5">
              Send an email invitation to onboard a new organizer. They will receive a unique signup link.
            </p>
            <form onSubmit={handleSendInvite} className="flex gap-3 items-end">
              <div className="flex-1">
                <label className="block text-xs font-label font-medium text-on-surface-variant uppercase tracking-wider mb-2">
                  Email Address
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  placeholder="organizer@example.com"
                  required
                  className="w-full px-4 py-3 rounded-lg bg-surface-container-lowest border border-outline-variant/30 text-on-surface text-sm focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/20 transition-all placeholder:text-outline"
                />
              </div>
              <button
                type="submit"
                disabled={inviteSending}
                className="px-6 py-3 rounded-xl prism-gradient text-white font-headline font-bold text-sm active:scale-[0.98] transition-all duration-150 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 whitespace-nowrap"
              >
                {inviteSending ? (
                  <div className="spinner text-white" />
                ) : (
                  <>
                    <span className="material-symbols-outlined text-lg">send</span>
                    Send Invite
                  </>
                )}
              </button>
            </form>

            {inviteMsg && (
              <div className={`mt-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm ${
                inviteMsg.type === "success"
                  ? "bg-emerald-50 border border-emerald-200 text-emerald-700"
                  : "bg-error-container/30 border border-error/20 text-error"
              }`}>
                <span className="material-symbols-outlined text-lg">
                  {inviteMsg.type === "success" ? "check_circle" : "error"}
                </span>
                {inviteMsg.text}
              </div>
            )}

          </div>

          {/* Invites List */}
          <div className="bg-surface-container-lowest rounded-xl shadow-ambient border border-outline-variant/10 overflow-hidden">
            <div className="px-6 py-4 border-b border-outline-variant/10 flex items-center justify-between">
              <h2 className="text-lg font-bold font-headline text-on-surface flex items-center gap-2">
                <span className="material-symbols-outlined text-primary">mail</span>
                Sent Invitations
              </h2>
              <span className="text-xs font-label font-bold text-on-surface-variant bg-surface-container-low px-3 py-1 rounded-full">
                {invites.length} total
              </span>
            </div>
            {invites.length === 0 ? (
              <div className="text-center py-12 px-6">
                <span className="material-symbols-outlined text-4xl text-outline mb-3 block">mail_outline</span>
                <p className="text-on-surface-variant text-sm">No invitations sent yet</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-surface-container-low">
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Email</th>
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Role</th>
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Sent</th>
                      <th className="text-left px-6 py-3 text-xs font-label font-bold text-on-surface-variant uppercase tracking-wider">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invites.map((inv, i) => (
                      <tr key={i} className="border-t border-outline-variant/10 hover:bg-surface-container-low/50 transition-colors">
                        <td className="px-6 py-4 font-medium text-on-surface">{inv.email}</td>
                        <td className="px-6 py-4 capitalize text-on-surface-variant">{inv.role}</td>
                        <td className="px-6 py-4 text-xs text-on-surface-variant">
                          {new Date(inv.createdAt).toLocaleDateString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold ${
                            inv.used
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${inv.used ? "bg-emerald-500" : "bg-amber-500"}`}></span>
                            {inv.used ? "Accepted" : "Pending"}
                          </span>
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
    </div>
  );
}
