"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ETHERSCAN = "https://sepolia.etherscan.io";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayerInfo {
  address: string;
  balanceEth: string;
  chain: string;
  chainId: number;
  contractAddress: string | null;
  blockNumber?: number;
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

type StatusFilter = "all" | "live" | "upcoming" | "ended";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function shortAddr(addr: string, chars = 6) {
  return addr ? `${addr.slice(0, chars)}…${addr.slice(-4)}` : "—";
}

function fmtDate(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function fmtBlock(n?: number) {
  if (!n) return "—";
  return "#" + n.toLocaleString();
}

// ─── Copy Hook ────────────────────────────────────────────────────────────────

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 1500);
  }

  return { copy, copied };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const C = {
  bg: "#070711",
  surface: "#0d0d1f",
  card: "#111127",
  cardHover: "#14142e",
  border: "#1c1c38",
  borderBright: "#2a2a50",
  purple: "#7c6cf0",
  purpleDim: "#4a3fa0",
  green: "#22c55e",
  greenDim: "#15803d",
  amber: "#f59e0b",
  amberDim: "#92400e",
  red: "#ef4444",
  redDim: "#991b1b",
  text: "#e2e8f0",
  muted: "#64748b",
  faint: "#334155",
};

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onAuth }: { onAuth: (s: string) => Promise<boolean> }) {
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
      setError("Invalid secret — check ADMIN_SECRET in Railway env vars");
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "var(--font-space-mono, monospace)",
    }}>
      <div style={{
        width: 380, background: C.card,
        border: `1px solid ${C.border}`,
        borderRadius: 16, overflow: "hidden",
        boxShadow: `0 0 60px #7c6cf015, 0 20px 60px #00000060`,
      }}>
        {/* Header gradient bar */}
        <div style={{
          background: "linear-gradient(135deg, #7c6cf0 0%, #a855f7 100%)",
          padding: "28px 32px 24px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>🛡</div>
          <div style={{ color: "#fff", fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px" }}>
            VRYFD Admin
          </div>
          <div style={{ color: "#c4b5fd", fontSize: 12, marginTop: 4 }}>
            Operational Dashboard
          </div>
        </div>

        <div style={{ padding: "28px 32px 32px" }}>
          <form onSubmit={submit}>
            <label style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Admin Secret
            </label>
            <input
              type="password"
              placeholder="Enter your ADMIN_SECRET"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              autoFocus
              style={{
                display: "block", width: "100%", marginTop: 8, marginBottom: 16,
                background: C.surface, border: `1px solid ${C.borderBright}`,
                borderRadius: 8, color: C.text, padding: "11px 14px",
                fontSize: 14, outline: "none", boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
            {error && (
              <div style={{
                background: "#1f0f0f", border: `1px solid ${C.red}44`,
                color: C.red, fontSize: 12, padding: "10px 14px",
                borderRadius: 8, marginBottom: 16,
              }}>
                ⚠ {error}
              </div>
            )}
            <button
              type="submit"
              disabled={loading || !secret.trim()}
              style={{
                width: "100%",
                background: loading ? C.faint : "linear-gradient(135deg, #7c6cf0, #a855f7)",
                color: "#fff", border: "none", borderRadius: 8,
                padding: "12px 0", fontSize: 14, fontWeight: 600,
                cursor: loading ? "not-allowed" : "pointer",
                fontFamily: "inherit", letterSpacing: "0.02em",
                transition: "opacity 0.2s",
              }}
            >
              {loading ? "Authenticating…" : "Enter Dashboard →"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

// ─── Relayer Card ─────────────────────────────────────────────────────────────

function RelayerCard({ relayer, copy, copied }: {
  relayer: RelayerInfo;
  copy: (text: string, key: string) => void;
  copied: string | null;
}) {
  const bal = parseFloat(relayer.balanceEth);
  const balColor = bal < 0.05 ? C.red : bal < 0.15 ? C.amber : C.green;
  const balLabel = bal < 0.05 ? "Critical" : bal < 0.15 ? "Low" : "Healthy";

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderBright}`,
      borderRadius: 14, padding: "20px 24px", marginBottom: 20,
      boxShadow: `0 0 30px #7c6cf008`,
    }}>
      <div style={{
        display: "flex", flexWrap: "wrap", gap: 24,
        alignItems: "flex-start",
      }}>
        {/* Wallet address */}
        <div style={{ flex: "1 1 220px" }}>
          <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
            Relayer Wallet
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%",
              background: C.green, display: "inline-block",
              boxShadow: `0 0 6px ${C.green}`,
            }} />
            <a
              href={`${ETHERSCAN}/address/${relayer.address}`}
              target="_blank" rel="noreferrer"
              style={{ color: C.purple, fontSize: 13, fontFamily: "monospace", textDecoration: "none" }}
            >
              {shortAddr(relayer.address, 10)}
            </a>
            <button onClick={() => copy(relayer.address, "wallet")} style={copyBtnStyle}>
              {copied === "wallet" ? "✓" : "⎘"}
            </button>
          </div>
          <div style={{ color: C.faint, fontSize: 11, marginTop: 4, fontFamily: "monospace" }}>
            {relayer.address}
          </div>
        </div>

        {/* ETH balance */}
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
            ETH Balance
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
            <span style={{ color: balColor, fontSize: 28, fontWeight: 700, fontFamily: "monospace" }}>
              {relayer.balanceEth}
            </span>
            <span style={{ color: balColor, fontSize: 11 }}>ETH</span>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4,
            background: `${balColor}18`, border: `1px solid ${balColor}40`,
            color: balColor, fontSize: 10, padding: "2px 8px",
            borderRadius: 20, marginTop: 4,
          }}>
            <span style={{
              width: 5, height: 5, borderRadius: "50%",
              background: balColor, display: "inline-block",
            }} />
            {balLabel}
          </div>
        </div>

        {/* Contract */}
        {relayer.contractAddress && (
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Contract
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <a
                href={`${ETHERSCAN}/address/${relayer.contractAddress}`}
                target="_blank" rel="noreferrer"
                style={{ color: C.purple, fontSize: 13, fontFamily: "monospace", textDecoration: "none" }}
              >
                {shortAddr(relayer.contractAddress, 10)}
              </a>
              <button onClick={() => copy(relayer.contractAddress!, "contract")} style={copyBtnStyle}>
                {copied === "contract" ? "✓" : "⎘"}
              </button>
              <a href={`${ETHERSCAN}/address/${relayer.contractAddress}`} target="_blank" rel="noreferrer"
                style={{ color: C.muted, fontSize: 11, textDecoration: "none" }}>↗</a>
            </div>
            <div style={{ color: C.faint, fontSize: 11, marginTop: 4 }}>
              Sepolia · Chain {relayer.chainId}
            </div>
          </div>
        )}

        {/* Block number */}
        {relayer.blockNumber && (
          <div style={{ flex: "0 0 auto" }}>
            <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: 6 }}>
              Latest Block
            </div>
            <div style={{ color: C.text, fontSize: 20, fontWeight: 600, fontFamily: "monospace" }}>
              {fmtBlock(relayer.blockNumber)}
            </div>
            <div style={{ color: C.faint, fontSize: 11, marginTop: 4 }}>
              Sepolia Testnet
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const copyBtnStyle: React.CSSProperties = {
  background: "none", border: "none", color: "#64748b",
  cursor: "pointer", padding: "2px 5px", fontSize: 12,
  borderRadius: 4, fontFamily: "monospace",
  transition: "color 0.15s",
};

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({ label, value, icon, accent, sub }: {
  label: string; value: number; icon: string;
  accent: string; sub?: string;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 12, padding: "18px 22px", flex: 1, minWidth: 130,
      borderTop: `3px solid ${accent}`,
      transition: "border-color 0.2s",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            {label}
          </div>
          <div style={{ color: C.text, fontSize: 30, fontWeight: 700, lineHeight: 1 }}>
            {value}
          </div>
          {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>{sub}</div>}
        </div>
        <div style={{
          fontSize: 22, background: `${accent}18`,
          width: 42, height: 42, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ─── Status Badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { color: string; bg: string; dot: string }> = {
    live:     { color: C.green,   bg: `${C.green}18`,   dot: C.green },
    upcoming: { color: C.amber,   bg: `${C.amber}18`,   dot: C.amber },
    ended:    { color: C.muted,   bg: `${C.faint}18`,   dot: C.muted },
    unknown:  { color: C.muted,   bg: `${C.faint}18`,   dot: C.muted },
  };
  const s = map[status] || map.unknown;

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      background: s.bg, color: s.color,
      border: `1px solid ${s.dot}30`,
      fontSize: 10, fontWeight: 700,
      padding: "3px 10px", borderRadius: 20,
      textTransform: "uppercase", letterSpacing: "0.06em",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%",
        background: s.dot, display: "inline-block",
        boxShadow: status === "live" ? `0 0 5px ${s.dot}` : "none",
      }} />
      {status}
    </span>
  );
}

// ─── Attendee Drawer ──────────────────────────────────────────────────────────

function AttendeeDrawer({ onChainId, secret, copy, copied }: {
  onChainId: string | number;
  secret: string;
  copy: (text: string, key: string) => void;
  copied: string | null;
}) {
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    fetch(`${API}/api/admin/events/${onChainId}/attendees`, {
      headers: { "x-admin-secret": secret }, signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => { setAttendees(d.attendees || []); setLoading(false); })
      .catch((e) => { setError(e.message); setLoading(false); })
      .finally(() => clearTimeout(t));
  }, [onChainId, secret]);

  if (loading) return (
    <div style={{ padding: "16px 24px", color: C.muted, fontSize: 12 }}>
      Loading attendees…
    </div>
  );
  if (error) return (
    <div style={{ padding: "16px 24px", color: C.red, fontSize: 12 }}>
      {error}
    </div>
  );
  if (!attendees?.length) return (
    <div style={{ padding: "16px 24px", color: C.muted, fontSize: 12 }}>
      No confirmed attendees yet.
    </div>
  );

  return (
    <div style={{ padding: "12px 24px 20px" }}>
      <div style={{
        display: "grid",
        gridTemplateColumns: "1fr 140px 100px",
        gap: 8, fontSize: 10, color: C.muted,
        textTransform: "uppercase", letterSpacing: "0.06em",
        paddingBottom: 8, borderBottom: `1px solid ${C.border}`,
        marginBottom: 4,
      }}>
        <span>Address</span><span>Tx Hash</span><span>Checked In</span>
      </div>
      {attendees.map((a, i) => {
        const addr = a.address || a.addr || "";
        const tx = a.txHash || "";
        const key = `att-${i}`;
        return (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 140px 100px",
            gap: 8, fontSize: 12, color: C.text,
            padding: "7px 0", borderBottom: `1px solid ${C.border}15`,
            alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              {addr ? (
                <>
                  <a href={`${ETHERSCAN}/address/${addr}`} target="_blank" rel="noreferrer"
                    style={{ color: C.purple, fontFamily: "monospace", textDecoration: "none" }}>
                    {shortAddr(addr)}
                  </a>
                  <button onClick={() => copy(addr, key + addr)} style={copyBtnStyle}>
                    {copied === key + addr ? "✓" : "⎘"}
                  </button>
                </>
              ) : "—"}
            </div>
            <div>
              {tx ? (
                <a href={`${ETHERSCAN}/tx/${tx}`} target="_blank" rel="noreferrer"
                  style={{ color: C.purple, fontFamily: "monospace", textDecoration: "none", fontSize: 11 }}>
                  {shortAddr(tx)} ↗
                </a>
              ) : "—"}
            </div>
            <div style={{ color: C.muted, fontSize: 11 }}>
              {a.timestamp ? fmtDate(a.timestamp) : "—"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({ ev, secret, copy, copied }: {
  ev: EventStat;
  secret: string;
  copy: (text: string, key: string) => void;
  copied: string | null;
}) {
  const [open, setOpen] = useState(false);
  const total = ev.confirmedAttendees + ev.pendingAttendees;

  return (
    <div style={{
      background: C.card, borderRadius: 12,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${ev.color || C.purple}`,
      overflow: "hidden",
      transition: "border-color 0.2s, box-shadow 0.2s",
      boxShadow: open ? `0 0 20px ${ev.color || C.purple}12` : "none",
    }}>
      {/* Card header */}
      <div style={{ padding: "16px 20px" }}>
        <div style={{
          display: "flex", alignItems: "flex-start",
          justifyContent: "space-between", gap: 12, flexWrap: "wrap",
        }}>
          {/* Left: name + dates */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <span style={{ fontSize: 22 }}>{ev.emoji}</span>
              <div>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
                  {ev.name}
                </div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                  {fmtDate(ev.startTime)}
                  {ev.endTime && ev.endTime !== ev.startTime ? ` → ${fmtDate(ev.endTime)}` : ""}
                  {" · "}
                  <span style={{ color: C.faint, fontFamily: "monospace" }}>
                    onChain #{ev.onChainId}
                  </span>
                </div>
              </div>
            </div>

            {/* Metrics row */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
              {/* Join code */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: C.surface, border: `1px solid ${C.borderBright}`,
                borderRadius: 7, padding: "5px 10px",
              }}>
                <span style={{ color: C.muted, fontSize: 10, textTransform: "uppercase" }}>Code</span>
                <span style={{ color: C.text, fontFamily: "monospace", fontSize: 13, letterSpacing: "0.12em", fontWeight: 600 }}>
                  {ev.joinCode || "—"}
                </span>
                {ev.joinCode && (
                  <button onClick={() => copy(ev.joinCode, `code-${ev.onChainId}`)} style={copyBtnStyle}>
                    {copied === `code-${ev.onChainId}` ? "✓" : "⎘"}
                  </button>
                )}
              </div>

              {/* Confirmed */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: `${C.green}12`, border: `1px solid ${C.green}30`,
                borderRadius: 7, padding: "5px 10px",
              }}>
                <span style={{ color: C.green, fontSize: 16, fontWeight: 700 }}>
                  {ev.confirmedAttendees}
                </span>
                <span style={{ color: C.greenDim, fontSize: 10 }}>confirmed</span>
              </div>

              {/* Pending */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: ev.pendingAttendees > 0 ? `${C.amber}12` : `${C.faint}12`,
                border: `1px solid ${ev.pendingAttendees > 0 ? C.amber : C.faint}30`,
                borderRadius: 7, padding: "5px 10px",
              }}>
                <span style={{ color: ev.pendingAttendees > 0 ? C.amber : C.muted, fontSize: 16, fontWeight: 700 }}>
                  {ev.pendingAttendees}
                </span>
                <span style={{ color: ev.pendingAttendees > 0 ? C.amberDim : C.faint, fontSize: 10 }}>pending</span>
              </div>
            </div>

            {/* Progress bar */}
            {total > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{
                  height: 4, background: C.border, borderRadius: 4, overflow: "hidden",
                }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    width: `${(ev.confirmedAttendees / total) * 100}%`,
                    background: `linear-gradient(90deg, ${ev.color || C.purple}, ${C.green})`,
                    transition: "width 0.5s ease",
                  }} />
                </div>
                <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>
                  {ev.confirmedAttendees} of {total} confirmed
                </div>
              </div>
            )}
          </div>

          {/* Right: status + links */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <StatusBadge status={ev.status} />
            <div style={{ display: "flex", gap: 6 }}>
              {ev.txHash && (
                <a
                  href={`${ETHERSCAN}/tx/${ev.txHash}`}
                  target="_blank" rel="noreferrer"
                  style={{
                    background: C.surface, border: `1px solid ${C.borderBright}`,
                    color: C.muted, fontSize: 10, padding: "4px 8px",
                    borderRadius: 6, textDecoration: "none",
                    textTransform: "uppercase", letterSpacing: "0.06em",
                  }}
                >
                  Deploy Tx ↗
                </a>
              )}
            </div>
          </div>
        </div>

        {/* Expand button */}
        <button
          onClick={() => setOpen((o) => !o)}
          style={{
            marginTop: 12, background: "none", border: `1px solid ${C.borderBright}`,
            color: C.muted, borderRadius: 7, padding: "6px 14px",
            fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
            fontFamily: "inherit", transition: "color 0.15s, border-color 0.15s",
          }}
        >
          <span>{open ? "▴" : "▾"}</span>
          {open ? "Hide" : "View"} attendees
          {ev.confirmedAttendees > 0 && (
            <span style={{
              background: `${C.purple}30`, color: C.purple,
              borderRadius: 10, padding: "1px 7px", fontSize: 10,
            }}>
              {ev.confirmedAttendees}
            </span>
          )}
        </button>
      </div>

      {/* Attendee drawer */}
      {open && (
        <div style={{ borderTop: `1px solid ${C.border}`, background: C.surface }}>
          <AttendeeDrawer onChainId={ev.onChainId} secret={secret} copy={copy} copied={copied} />
        </div>
      )}
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ secret, onLogout }: { secret: string; onLogout: () => void }) {
  const [relayer, setRelayer] = useState<RelayerInfo | null>(null);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const { copy, copied } = useCopy();

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
        onLogout(); return;
      }

      const [rd, sd] = await Promise.all([relayerRes.json(), statsRes.json()]);
      if (rd.error) throw new Error(rd.error);
      if (sd.error) throw new Error(sd.error);

      setRelayer(rd);
      setStats(sd);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg.includes("abort") ? "Request timed out — try refreshing" : msg);
    } finally {
      clearTimeout(timer);
      setLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  // Filtered events
  const filteredEvents = (stats?.events || []).filter((ev) => {
    const matchStatus = filter === "all" || ev.status === filter;
    const matchSearch = !search || ev.name.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  // Tab counts
  const counts = {
    all: stats?.events.length ?? 0,
    live: stats?.events.filter((e) => e.status === "live").length ?? 0,
    upcoming: stats?.events.filter((e) => e.status === "upcoming").length ?? 0,
    ended: stats?.events.filter((e) => e.status === "ended").length ?? 0,
  };

  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      fontFamily: "var(--font-space-mono, monospace)", color: C.text,
    }}>
      {/* Header */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        padding: "0 28px",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{
          maxWidth: 1100, margin: "0 auto",
          display: "flex", alignItems: "center",
          justifyContent: "space-between", height: 54,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 18 }}>🛡</span>
            <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>VRYFD</span>
            <span style={{ color: C.border, fontSize: 14 }}>/</span>
            <span style={{ color: C.muted, fontSize: 13 }}>Admin</span>
            <span style={{
              background: `${C.purple}20`, color: C.purple,
              fontSize: 9, padding: "2px 8px", borderRadius: 20,
              border: `1px solid ${C.purple}40`, letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}>
              Sepolia
            </span>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {lastRefresh && (
              <span style={{ color: C.faint, fontSize: 10 }}>
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button onClick={refresh} disabled={loading} style={{
              background: C.card, border: `1px solid ${C.borderBright}`,
              color: C.muted, borderRadius: 7, padding: "5px 12px",
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>
              ↺ Refresh
            </button>
            <button onClick={onLogout} style={{
              background: "transparent", border: `1px solid ${C.border}`,
              color: C.muted, borderRadius: 7, padding: "5px 12px",
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>
              Logout
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 24px 60px" }}>
        {/* Error */}
        {error && (
          <div style={{
            background: "#1a0a0a", border: `1px solid ${C.red}44`,
            color: C.red, borderRadius: 10, padding: "12px 16px",
            fontSize: 12, marginBottom: 20, display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⚠</span> {error}
            <button onClick={refresh} style={{
              marginLeft: "auto", background: "none", border: `1px solid ${C.red}60`,
              color: C.red, borderRadius: 5, padding: "3px 10px",
              fontSize: 11, cursor: "pointer", fontFamily: "inherit",
            }}>
              Retry
            </button>
          </div>
        )}

        {loading && !stats ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 300, gap: 12, color: C.muted, fontSize: 13,
          }}>
            <span style={{
              width: 18, height: 18, border: `2px solid ${C.purple}`,
              borderTopColor: "transparent", borderRadius: "50%",
              display: "inline-block",
              animation: "spin 0.8s linear infinite",
            }} />
            Loading dashboard…
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : (
          <>
            {/* Relayer */}
            {relayer && <RelayerCard relayer={relayer} copy={copy} copied={copied} />}

            {/* Stats */}
            {stats && (
              <div style={{ display: "flex", gap: 12, marginBottom: 28, flexWrap: "wrap" }}>
                <StatCard label="Total Events" value={stats.totalEvents} icon="📅" accent={C.purple}
                  sub={`${counts.live} live`} />
                <StatCard label="Confirmed" value={stats.totalConfirmed} icon="✅" accent={C.green}
                  sub="on-chain attendees" />
                <StatCard label="Pending" value={stats.totalPending} icon="⏳" accent={C.amber}
                  sub="awaiting confirmation" />
              </div>
            )}

            {/* Events section */}
            {stats && (
              <div>
                {/* Section header + search */}
                <div style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", flexWrap: "wrap",
                  gap: 12, marginBottom: 14,
                }}>
                  <div style={{ color: C.text, fontSize: 15, fontWeight: 600 }}>
                    Deployed Events
                  </div>
                  <input
                    type="text"
                    placeholder="Search events…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    style={{
                      background: C.card, border: `1px solid ${C.borderBright}`,
                      borderRadius: 8, color: C.text, padding: "7px 12px",
                      fontSize: 12, outline: "none", fontFamily: "inherit", width: 200,
                    }}
                  />
                </div>

                {/* Filter tabs */}
                <div style={{ display: "flex", gap: 6, marginBottom: 16, flexWrap: "wrap" }}>
                  {(["all", "live", "upcoming", "ended"] as StatusFilter[]).map((tab) => (
                    <button
                      key={tab}
                      onClick={() => setFilter(tab)}
                      style={{
                        background: filter === tab ? C.purple : C.card,
                        border: `1px solid ${filter === tab ? C.purple : C.borderBright}`,
                        color: filter === tab ? "#fff" : C.muted,
                        borderRadius: 8, padding: "6px 14px",
                        fontSize: 11, cursor: "pointer", fontFamily: "inherit",
                        textTransform: "capitalize", fontWeight: filter === tab ? 600 : 400,
                        transition: "all 0.15s",
                      }}
                    >
                      {tab}{" "}
                      <span style={{
                        background: filter === tab ? "#ffffff30" : C.border,
                        borderRadius: 10, padding: "1px 6px", fontSize: 10,
                      }}>
                        {counts[tab]}
                      </span>
                    </button>
                  ))}
                </div>

                {/* Event cards */}
                {filteredEvents.length === 0 ? (
                  <div style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 12, padding: "40px 24px", textAlign: "center",
                    color: C.muted, fontSize: 13,
                  }}>
                    {search ? `No events matching "${search}"` : `No ${filter} events`}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {filteredEvents.map((ev) => (
                      <EventCard key={ev.onChainId} ev={ev} secret={secret} copy={copy} copied={copied} />
                    ))}
                  </div>
                )}
              </div>
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
