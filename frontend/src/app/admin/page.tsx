"use client";

import { useState, useCallback, useEffect } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ETHERSCAN = "https://sepolia.etherscan.io";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayerInfo {
  address: string;
  balanceEth: string;
  chain: string;
  chainId: number;
  contractAddress: string | null;
}

interface EventStat {
  localId: string;
  onChainId: string | number;
  name: string;
  emoji: string;
  color: string;
  status: string;
  startTime: number | null;
  endTime: number | null;
  joinCode: string;
  txHash: string;
  confirmedAttendees: number;
  pendingAttendees: number;
}

interface AdminStats {
  totalEvents: number;
  totalConfirmed: number;
  totalPending: number;
  events: EventStat[];
}

interface Attendee {
  address?: string;
  addr?: string;
  txHash?: string;
  timestamp?: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string) {
  return addr ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : "—";
}

function fmt(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function statusColor(status: string) {
  if (status === "live") return "#34d399";
  if (status === "upcoming") return "#fbbf24";
  return "#9ca3af";
}

// ─── Login Screen ─────────────────────────────────────────────────────────────

function LoginScreen({
  onAuth,
}: {
  onAuth: (secret: string) => Promise<boolean>;
}) {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true);
    setError("");
    const ok = await onAuth(secret.trim());
    if (!ok) {
      setError("Invalid secret. Check ADMIN_SECRET in your backend env.");
      setLoading(false);
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a14",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "monospace",
      }}
    >
      <div
        style={{
          background: "#13131f",
          border: "1px solid #2a2a40",
          borderRadius: 12,
          padding: "40px 36px",
          width: 360,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>🔐</div>
          <div style={{ color: "#fff", fontSize: 20, fontWeight: 700 }}>
            VRYFD Admin
          </div>
          <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
            Operational Monitoring
          </div>
        </div>

        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="Admin secret"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            autoFocus
            style={{
              width: "100%",
              background: "#1e1e30",
              border: "1px solid #3a3a55",
              borderRadius: 8,
              color: "#fff",
              padding: "10px 14px",
              fontSize: 14,
              outline: "none",
              boxSizing: "border-box",
              marginBottom: 12,
            }}
          />
          {error && (
            <div
              style={{
                color: "#f87171",
                fontSize: 12,
                marginBottom: 12,
                textAlign: "center",
              }}
            >
              {error}
            </div>
          )}
          <button
            type="submit"
            disabled={loading || !secret.trim()}
            style={{
              width: "100%",
              background: loading ? "#3a3a55" : "#7c6cf0",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              padding: "11px 0",
              fontSize: 14,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontFamily: "monospace",
            }}
          >
            {loading ? "Verifying…" : "Enter Dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent: string;
}) {
  return (
    <div
      style={{
        background: "#13131f",
        border: `1px solid ${accent}33`,
        borderRadius: 10,
        padding: "18px 22px",
        flex: 1,
        minWidth: 140,
      }}
    >
      <div style={{ color: accent, fontSize: 26, fontWeight: 700 }}>
        {value}
      </div>
      <div style={{ color: "#9ca3af", fontSize: 12, marginTop: 4 }}>
        {label}
      </div>
    </div>
  );
}

// ─── Attendee Drawer ──────────────────────────────────────────────────────────

function AttendeeDrawer({
  onChainId,
  secret,
}: {
  onChainId: string | number;
  secret: string;
}) {
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`${API}/api/admin/events/${onChainId}/attendees`, {
      headers: { "x-admin-secret": secret },
    })
      .then((r) => r.json())
      .then((d) => {
        setAttendees(d.attendees || []);
        setLoading(false);
      })
      .catch((e) => {
        setError(e.message);
        setLoading(false);
      });
  }, [onChainId, secret]);

  if (loading)
    return (
      <div style={{ color: "#9ca3af", fontSize: 12, padding: "10px 16px" }}>
        Loading attendees…
      </div>
    );
  if (error)
    return (
      <div style={{ color: "#f87171", fontSize: 12, padding: "10px 16px" }}>
        {error}
      </div>
    );
  if (!attendees || attendees.length === 0)
    return (
      <div style={{ color: "#9ca3af", fontSize: 12, padding: "10px 16px" }}>
        No confirmed attendees yet.
      </div>
    );

  return (
    <div style={{ padding: "10px 16px 16px" }}>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr auto",
          gap: 8,
          fontSize: 11,
          color: "#6b7280",
          marginBottom: 6,
          paddingBottom: 6,
          borderBottom: "1px solid #2a2a40",
        }}
      >
        <span>Address</span>
        <span>Tx Hash</span>
        <span>Time</span>
      </div>
      {attendees.map((a, i) => {
        const addr = a.address || a.addr || "";
        const tx = a.txHash || "";
        return (
          <div
            key={i}
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr auto",
              gap: 8,
              fontSize: 12,
              color: "#d1d5db",
              padding: "5px 0",
              borderBottom: "1px solid #1e1e30",
              alignItems: "center",
            }}
          >
            <span style={{ fontFamily: "monospace" }}>
              {addr ? (
                <a
                  href={`${ETHERSCAN}/address/${addr}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#7c6cf0", textDecoration: "none" }}
                >
                  {shortAddr(addr)}
                </a>
              ) : (
                "—"
              )}
            </span>
            <span style={{ fontFamily: "monospace" }}>
              {tx ? (
                <a
                  href={`${ETHERSCAN}/tx/${tx}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{ color: "#7c6cf0", textDecoration: "none" }}
                >
                  {shortAddr(tx)}
                </a>
              ) : (
                "—"
              )}
            </span>
            <span style={{ color: "#6b7280", whiteSpace: "nowrap" }}>
              {a.timestamp ? fmt(a.timestamp) : "—"}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Events Table ─────────────────────────────────────────────────────────────

function EventsTable({
  events,
  secret,
}: {
  events: EventStat[];
  secret: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);

  function toggle(onChainId: string | number) {
    const key = String(onChainId);
    setExpanded((prev) => (prev === key ? null : key));
  }

  if (events.length === 0)
    return (
      <div style={{ color: "#9ca3af", fontSize: 13, padding: "20px 0" }}>
        No deployed events found.
      </div>
    );

  return (
    <div
      style={{
        border: "1px solid #2a2a40",
        borderRadius: 10,
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "36px 1fr 80px 90px 90px 80px 80px 36px",
          padding: "10px 16px",
          background: "#1a1a2e",
          color: "#6b7280",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: "0.05em",
          textTransform: "uppercase",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span>#</span>
        <span>Event</span>
        <span>Status</span>
        <span>Join Code</span>
        <span style={{ textAlign: "right" }}>Confirmed</span>
        <span style={{ textAlign: "right" }}>Pending</span>
        <span>Tx</span>
        <span></span>
      </div>

      {/* Rows */}
      {events.map((ev, i) => {
        const key = String(ev.onChainId);
        const isExpanded = expanded === key;
        return (
          <div
            key={key}
            style={{ borderTop: i > 0 ? "1px solid #1e1e30" : "none" }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "36px 1fr 80px 90px 90px 80px 80px 36px",
                padding: "12px 16px",
                gap: 8,
                alignItems: "center",
                background: isExpanded ? "#17172a" : "transparent",
                transition: "background 0.15s",
              }}
            >
              {/* Chain ID badge */}
              <span
                style={{
                  background: "#2a2a40",
                  color: "#9ca3af",
                  borderRadius: 4,
                  padding: "2px 5px",
                  fontSize: 10,
                  fontFamily: "monospace",
                  textAlign: "center",
                }}
              >
                {ev.onChainId}
              </span>

              {/* Name */}
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{ev.emoji}</span>
                <div>
                  <div style={{ color: "#fff", fontSize: 13, fontWeight: 500 }}>
                    {ev.name}
                  </div>
                  <div style={{ color: "#6b7280", fontSize: 11, marginTop: 1 }}>
                    {ev.startTime ? fmt(ev.startTime) : "—"}
                    {ev.endTime ? ` → ${fmt(ev.endTime)}` : ""}
                  </div>
                </div>
              </div>

              {/* Status */}
              <span
                style={{
                  color: statusColor(ev.status),
                  fontSize: 11,
                  fontWeight: 600,
                  textTransform: "capitalize",
                }}
              >
                ● {ev.status}
              </span>

              {/* Join code */}
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: 13,
                  color: "#e5e7eb",
                  letterSpacing: "0.1em",
                  background: "#1e1e30",
                  padding: "3px 8px",
                  borderRadius: 5,
                  display: "inline-block",
                }}
              >
                {ev.joinCode || "—"}
              </span>

              {/* Confirmed */}
              <span
                style={{
                  color: "#34d399",
                  fontSize: 14,
                  fontWeight: 700,
                  textAlign: "right",
                }}
              >
                {ev.confirmedAttendees}
              </span>

              {/* Pending */}
              <span
                style={{
                  color: ev.pendingAttendees > 0 ? "#fbbf24" : "#4b5563",
                  fontSize: 14,
                  fontWeight: 600,
                  textAlign: "right",
                }}
              >
                {ev.pendingAttendees}
              </span>

              {/* Tx link */}
              <span>
                {ev.txHash ? (
                  <a
                    href={`${ETHERSCAN}/tx/${ev.txHash}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "#7c6cf0",
                      fontSize: 12,
                      textDecoration: "none",
                    }}
                    title={ev.txHash}
                  >
                    ↗
                  </a>
                ) : (
                  <span style={{ color: "#4b5563" }}>—</span>
                )}
              </span>

              {/* Expand toggle */}
              <button
                onClick={() => toggle(ev.onChainId)}
                style={{
                  background: "none",
                  border: "none",
                  color: "#6b7280",
                  cursor: "pointer",
                  fontSize: 14,
                  padding: 0,
                  lineHeight: 1,
                  transition: "transform 0.15s",
                  transform: isExpanded ? "rotate(180deg)" : "rotate(0deg)",
                }}
                title={isExpanded ? "Collapse" : "View attendees"}
              >
                ▾
              </button>
            </div>

            {/* Expandable attendees */}
            {isExpanded && (
              <div
                style={{
                  background: "#0f0f1e",
                  borderTop: "1px solid #2a2a40",
                }}
              >
                <AttendeeDrawer
                  onChainId={ev.onChainId}
                  secret={secret}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({
  secret,
  onLogout,
}: {
  secret: string;
  onLogout: () => void;
}) {
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);

  const headers = { "x-admin-secret": secret };

  const refresh = useCallback(async () => {
    setError("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const [relayerRes, statsRes] = await Promise.all([
        fetch(`${API}/api/admin/relayer`, { headers, signal: ctrl.signal }),
        fetch(`${API}/api/admin/stats`, { headers, signal: ctrl.signal }),
      ]);

      if (relayerRes.status === 401 || statsRes.status === 401) {
        onLogout();
        return;
      }

      const [relayerData, statsData] = await Promise.all([
        relayerRes.json(),
        statsRes.json(),
      ]);

      if (relayerData.error) throw new Error(relayerData.error);
      if (statsData.error) throw new Error(statsData.error);

      setRelayer(relayerData);
      setStats(statsData);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("abort") ? "Request timed out — backend is slow, try again" : msg);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [secret]);

  // Initial load + 30s auto-refresh
  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const balLow =
    relayer && parseFloat(relayer.balanceEth) < 0.05;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#0a0a14",
        fontFamily: "monospace",
        color: "#e5e7eb",
      }}
    >
      {/* Top bar */}
      <div
        style={{
          background: "#13131f",
          borderBottom: "1px solid #2a2a40",
          padding: "14px 32px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 20 }}>🛡</span>
          <span style={{ fontWeight: 700, fontSize: 16, color: "#fff" }}>
            VRYFD Admin
          </span>
          <span
            style={{
              background: "#1e1e30",
              color: "#9ca3af",
              fontSize: 10,
              padding: "2px 8px",
              borderRadius: 20,
              marginLeft: 4,
            }}
          >
            Sepolia
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {lastRefresh && (
            <span style={{ color: "#6b7280", fontSize: 11 }}>
              Refreshed {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={refresh}
            disabled={loading}
            style={{
              background: "#1e1e30",
              border: "1px solid #3a3a55",
              color: "#9ca3af",
              borderRadius: 6,
              padding: "5px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            ↺ Refresh
          </button>
          <button
            onClick={onLogout}
            style={{
              background: "transparent",
              border: "1px solid #3a3a55",
              color: "#9ca3af",
              borderRadius: 6,
              padding: "5px 12px",
              fontSize: 12,
              cursor: "pointer",
              fontFamily: "monospace",
            }}
          >
            Logout
          </button>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "28px 24px" }}>
        {error && (
          <div
            style={{
              background: "#2a1515",
              border: "1px solid #7f1d1d",
              color: "#f87171",
              borderRadius: 8,
              padding: "12px 16px",
              marginBottom: 20,
              fontSize: 13,
            }}
          >
            ⚠ {error}
          </div>
        )}

        {loading && !stats ? (
          <div
            style={{ color: "#9ca3af", textAlign: "center", paddingTop: 80 }}
          >
            Loading dashboard…
          </div>
        ) : (
          <>
            {/* Relayer Card */}
            {relayer && (
              <div
                style={{
                  background: "#13131f",
                  border: `1px solid ${balLow ? "#78350f" : "#2a2a40"}`,
                  borderRadius: 10,
                  padding: "18px 22px",
                  marginBottom: 20,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: 20,
                  alignItems: "center",
                }}
              >
                <div>
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 4,
                    }}
                  >
                    Relayer Wallet
                  </div>
                  <a
                    href={`${ETHERSCAN}/address/${relayer.address}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{
                      color: "#7c6cf0",
                      fontSize: 13,
                      fontFamily: "monospace",
                      textDecoration: "none",
                    }}
                  >
                    {relayer.address}
                  </a>
                </div>

                <div
                  style={{ borderLeft: "1px solid #2a2a40", paddingLeft: 20 }}
                >
                  <div
                    style={{
                      color: "#6b7280",
                      fontSize: 10,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 4,
                    }}
                  >
                    ETH Balance
                  </div>
                  <span
                    style={{
                      color: balLow ? "#fbbf24" : "#34d399",
                      fontSize: 20,
                      fontWeight: 700,
                    }}
                  >
                    {relayer.balanceEth} ETH
                  </span>
                  {balLow && (
                    <span
                      style={{
                        color: "#fbbf24",
                        fontSize: 11,
                        marginLeft: 8,
                      }}
                    >
                      ⚠ Low — top up soon
                    </span>
                  )}
                </div>

                {relayer.contractAddress && (
                  <div
                    style={{
                      borderLeft: "1px solid #2a2a40",
                      paddingLeft: 20,
                    }}
                  >
                    <div
                      style={{
                        color: "#6b7280",
                        fontSize: 10,
                        textTransform: "uppercase",
                        letterSpacing: "0.08em",
                        marginBottom: 4,
                      }}
                    >
                      Contract
                    </div>
                    <a
                      href={`${ETHERSCAN}/address/${relayer.contractAddress}`}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        color: "#7c6cf0",
                        fontSize: 12,
                        fontFamily: "monospace",
                        textDecoration: "none",
                      }}
                    >
                      {shortAddr(relayer.contractAddress)} ↗
                    </a>
                  </div>
                )}
              </div>
            )}

            {/* Stats Row */}
            {stats && (
              <>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginBottom: 24,
                    flexWrap: "wrap",
                  }}
                >
                  <StatCard
                    label="Total Events"
                    value={stats.totalEvents}
                    accent="#7c6cf0"
                  />
                  <StatCard
                    label="Confirmed Attendees"
                    value={stats.totalConfirmed}
                    accent="#34d399"
                  />
                  <StatCard
                    label="Pending Confirmation"
                    value={stats.totalPending}
                    accent="#fbbf24"
                  />
                </div>

                {/* Events Table */}
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      color: "#9ca3af",
                      fontSize: 11,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      marginBottom: 12,
                    }}
                  >
                    Deployed Events
                  </div>
                  <EventsTable events={stats.events} secret={secret} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem("vryfd_admin_secret");
    if (saved) setSecret(saved);
  }, []);

  async function handleAuth(s: string): Promise<boolean> {
    try {
      const res = await fetch(`${API}/api/admin/relayer`, {
        headers: { "x-admin-secret": s },
      });
      if (res.status === 200) {
        sessionStorage.setItem("vryfd_admin_secret", s);
        setSecret(s);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  function handleLogout() {
    sessionStorage.removeItem("vryfd_admin_secret");
    setSecret(null);
  }

  if (!secret) return <LoginScreen onAuth={handleAuth} />;
  return <Dashboard secret={secret} onLogout={handleLogout} />;
}
