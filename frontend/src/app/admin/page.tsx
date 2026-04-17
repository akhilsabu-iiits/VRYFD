"use client";

import { useState, useCallback, useEffect, useRef } from "react";

const API = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";
const ETHERSCAN = "https://sepolia.etherscan.io";

// ─── Types ────────────────────────────────────────────────────────────────────

interface RelayerInfo {
  address: string; balanceEth: string; chain: string;
  chainId: number; contractAddress: string | null; blockNumber?: number;
}
interface EventStat {
  localId: string; onChainId: string | number; name: string;
  emoji: string; color: string; status: string;
  startTime: number | null; endTime: number | null;
  joinCode: string; txHash: string;
  confirmedAttendees: number; pendingAttendees: number;
}
interface AdminStats {
  totalEvents: number; totalConfirmed: number;
  totalPending: number; events: EventStat[];
}
interface ContractStatsData {
  totalCertificatesIssued: number | null;
  totalEventsCreatedOnChain: number | null;
  vryfDistributed: string | null;
  contractDeployedAt: number | null;
  vryfTokenAddress: string | null;
}
interface OperationCost {
  key: string; label: string; icon: string;
  estimatedGas: number; estimatedCostEth: string; estimatedCostGwei: string;
}
interface EventCost {
  localId: string; onChainId: string | number; eventName: string;
  txHash: string; blockNumber: number; gasUsed: number;
  gasPriceGwei: string; ethCost: string;
  confirmedAttendees: number; estimatedCheckInCost: string;
}
interface GasData {
  gasPriceGwei: string;
  operationCosts: OperationCost[];
  eventCosts: EventCost[];
  summary: {
    actualCreationCost: string; estimatedConfirmCost: string;
    estimatedTotalSpent: string; totalConfirmedAttendees: number;
    eventsWithReceipts: number;
  };
}
interface ActivityEntry {
  type: "confirmation" | "event_created";
  eventName: string; eventEmoji: string; eventColor: string;
  onChainId: string | number;
  attendee: string | null; txHash: string | null; timestamp: number | null;
}
interface ActivityData {
  activity: ActivityEntry[]; total: number;
}
interface SystemData {
  uptime: number;
  nodeVersion: string;
  memoryMB: { rss: string; heapUsed: string; heapTotal: string };
  env: {
    nodeEnv: string; hasPrivateKey: boolean;
    hasAlchemyUrl: boolean; hasMongoUri: boolean; port: number | string;
  };
}
interface Attendee {
  address?: string; addr?: string; txHash?: string; timestamp?: number;
}
interface PendingAttendee {
  attendee: string; ens: string | null;
}
type StatusFilter = "all" | "live" | "upcoming" | "ended";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function short(addr: string, n = 6) {
  return addr ? `${addr.slice(0, n)}…${addr.slice(-4)}` : "—";
}
function fmtDate(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}
function fmtAge(ts: number | null) {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d === 0 ? "today" : `${d}d ago`;
}
function fmtUptime(seconds: number) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${seconds % 60}s`;
}
function fmtTimeAgo(ts: number | null) {
  if (!ts) return "—";
  const diff = Math.floor((Date.now() / 1000) - ts);
  if (diff < 60)  return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
function numFmt(n: number) { return n.toLocaleString(); }

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  function copy(text: string, key: string) {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    if (t.current) clearTimeout(t.current);
    t.current = setTimeout(() => setCopied(null), 1500);
  }
  return { copy, copied };
}

// ─── Small reusable pieces ────────────────────────────────────────────────────

function CopyBtn({ text, id, copy, copied }: {
  text: string; id: string;
  copy: (t: string, k: string) => void; copied: string | null;
}) {
  return (
    <button
      onClick={() => copy(text, id)}
      className="btn btn-sm"
      style={{
        padding: "2px 8px", fontSize: 11,
        color: copied === id ? "var(--green)" : "var(--text3)",
        background: "none", border: "none",
      }}
    >
      {copied === id ? "✓" : "⎘"}
    </button>
  );
}

function ELink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer"
      style={{
        color: "var(--accent2)", fontSize: 11, textDecoration: "none",
        border: "1px solid var(--border2)", borderRadius: 6,
        padding: "2px 8px", whiteSpace: "nowrap",
      }}
    >
      {label} ↗
    </a>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 style={{
      fontSize: 13, fontWeight: 600, color: "var(--text3)",
      textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 14,
    }}>
      {children}
    </h3>
  );
}

function EnvBadge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 6,
      padding: "5px 12px",
      background: ok ? "rgba(52,211,153,0.08)" : "rgba(248,113,113,0.08)",
      border: `1px solid ${ok ? "rgba(52,211,153,0.2)" : "rgba(248,113,113,0.2)"}`,
      borderRadius: "var(--radius-sm)", fontSize: 12,
      color: ok ? "var(--green)" : "var(--coral)",
    }}>
      <span style={{
        width: 6, height: 6, borderRadius: "50%",
        background: ok ? "var(--green)" : "var(--coral)",
        flexShrink: 0,
      }} />
      {label}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

function LoginScreen({ onAuth }: { onAuth: (s: string) => Promise<boolean> }) {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!secret.trim()) return;
    setLoading(true); setError("");
    const ok = await onAuth(secret.trim());
    if (!ok) { setError("Invalid secret — check ADMIN_SECRET in Railway env vars"); setLoading(false); }
  }

  return (
    <div className="wallet-gate">
      <div className="wallet-gate-icon">🛡</div>
      <h1 className="wallet-gate-title">VRYFD Admin</h1>
      <p className="wallet-gate-sub">Enter your admin secret to access the operational dashboard.</p>

      <form onSubmit={submit} style={{ width: "100%", maxWidth: 360 }}>
        <input
          type="password"
          placeholder="Admin secret (ADMIN_SECRET)"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          autoFocus
          className="org-input"
          style={{ marginBottom: 12, fontSize: 14 }}
        />
        {error && (
          <div style={{
            background: "rgba(248,113,113,0.1)", border: "1px solid rgba(248,113,113,0.3)",
            color: "var(--coral)", fontSize: 12, padding: "10px 14px",
            borderRadius: "var(--radius-sm)", marginBottom: 12,
          }}>
            ⚠ {error}
          </div>
        )}
        <button
          type="submit"
          disabled={loading || !secret.trim()}
          className="btn btn-primary btn-block"
          style={{ fontSize: 15, padding: "12px 24px" }}
        >
          {loading ? <><span className="spinner" /> Authenticating…</> : "Enter Dashboard →"}
        </button>
      </form>
      <p className="wallet-gate-hint">Session is cleared when you close this tab.</p>
    </div>
  );
}

// ─── Relayer Card ─────────────────────────────────────────────────────────────

function RelayerCard({ relayer, copy, copied }: {
  relayer: RelayerInfo; copy: (t: string, k: string) => void; copied: string | null;
}) {
  const bal = parseFloat(relayer.balanceEth);
  const [balColor, balLabel] =
    bal < 0.05 ? ["var(--coral)", "Critical"] :
    bal < 0.15 ? ["var(--amber)", "Low balance"] :
                 ["var(--green)", "Healthy"];

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SectionTitle>Relayer Wallet</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>

        {/* Address */}
        <div style={{ flex: "1 1 240px" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Address
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: "var(--green)",
              boxShadow: "0 0 8px rgba(52,211,153,0.5)", flexShrink: 0,
            }} />
            <a href={`${ETHERSCAN}/address/${relayer.address}`} target="_blank" rel="noreferrer"
              style={{ color: "var(--accent2)", fontSize: 13, fontFamily: "var(--font-space-mono),'Space Mono',monospace", textDecoration: "none" }}>
              {short(relayer.address, 12)}
            </a>
            <CopyBtn text={relayer.address} id="wallet" copy={copy} copied={copied} />
          </div>
          <div style={{ color: "var(--text3)", fontSize: 10, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
            {relayer.address}
          </div>
        </div>

        {/* Balance */}
        <div>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            ETH Balance
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ color: balColor, fontSize: 30, fontWeight: 700, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
              {relayer.balanceEth}
            </span>
            <span style={{ color: balColor, fontSize: 13 }}>ETH</span>
          </div>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 4, marginTop: 6,
            background: `${balColor === "var(--green)" ? "rgba(52,211,153" : balColor === "var(--amber)" ? "rgba(251,191,36" : "rgba(248,113,113"},0.12)`,
            border: `1px solid ${balColor === "var(--green)" ? "rgba(52,211,153" : balColor === "var(--amber)" ? "rgba(251,191,36" : "rgba(248,113,113"},0.3)`,
            color: balColor, fontSize: 11, padding: "2px 10px", borderRadius: 20,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: balColor }} />
            {balLabel}
          </span>
        </div>

        {/* Contract */}
        {relayer.contractAddress && (
          <div style={{ flex: "1 1 220px" }}>
            <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Contract
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
              <span style={{ color: "var(--text)", fontSize: 13, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                {short(relayer.contractAddress, 10)}
              </span>
              <CopyBtn text={relayer.contractAddress} id="contract" copy={copy} copied={copied} />
              <ELink href={`${ETHERSCAN}/address/${relayer.contractAddress}`} label="Etherscan" />
            </div>
            <div style={{ color: "var(--text3)", fontSize: 11 }}>Sepolia · Chain {relayer.chainId}</div>
          </div>
        )}

        {/* Block */}
        {relayer.blockNumber && (
          <div>
            <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Latest Block
            </div>
            <div style={{ color: "var(--text)", fontSize: 22, fontWeight: 700, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
              #{numFmt(relayer.blockNumber)}
            </div>
            <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 4 }}>Sepolia Testnet</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── System Health ────────────────────────────────────────────────────────────

function SystemHealth({ secret }: { secret: string }) {
  const [data, setData] = useState<SystemData | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    fetch(`${API}/api/admin/system`, {
      headers: { "x-admin-secret": secret }, signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => clearTimeout(t));
  }, [secret]);

  // Increment local uptime counter every second once we have data
  useEffect(() => {
    if (!data) return;
    const t = setInterval(() => setTick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, [data]);

  if (!data) return null;

  const liveUptime = data.uptime + tick;
  const memPct = Math.round((parseFloat(data.memoryMB.heapUsed) / parseFloat(data.memoryMB.heapTotal)) * 100);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SectionTitle>System Health</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24, alignItems: "flex-start" }}>

        {/* Uptime */}
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Server Uptime
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, color: "var(--green)", fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
            {fmtUptime(liveUptime)}
          </div>
          <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>
            Node {data.nodeVersion} · {data.env.nodeEnv}
          </div>
        </div>

        {/* Memory */}
        <div style={{ flex: "0 0 auto" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
            Heap Memory
          </div>
          <div style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
            <span style={{ fontSize: 22, fontWeight: 700, color: "var(--accent2)", fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
              {data.memoryMB.heapUsed}
            </span>
            <span style={{ fontSize: 13, color: "var(--text3)" }}>/ {data.memoryMB.heapTotal} MB</span>
          </div>
          {/* Progress bar */}
          <div style={{ marginTop: 8, width: 160, height: 4, background: "var(--bg4)", borderRadius: 4, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 4,
              width: `${memPct}%`,
              background: memPct > 80 ? "var(--coral)" : memPct > 60 ? "var(--amber)" : "var(--accent)",
              transition: "width 0.5s",
            }} />
          </div>
          <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 3 }}>
            {memPct}% heap · RSS {data.memoryMB.rss} MB
          </div>
        </div>

        {/* Env flags */}
        <div style={{ flex: "1 1 260px" }}>
          <div style={{ fontSize: 11, color: "var(--text3)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            Environment
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            <EnvBadge ok={data.env.hasPrivateKey} label="Private Key" />
            <EnvBadge ok={data.env.hasAlchemyUrl} label="Alchemy RPC" />
            <EnvBadge ok={data.env.hasMongoUri}   label="MongoDB" />
            <EnvBadge ok={data.env.nodeEnv === "production"} label="Production" />
          </div>
        </div>

      </div>
    </div>
  );
}

// ─── Contract Stats ───────────────────────────────────────────────────────────

function ContractStats({ secret, copy, copied }: {
  secret: string; copy: (t: string, k: string) => void; copied: string | null;
}) {
  const [data, setData] = useState<ContractStatsData | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    fetch(`${API}/api/admin/contract-stats`, {
      headers: { "x-admin-secret": secret }, signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => clearTimeout(t));
  }, [secret]);

  if (!data) return null;

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <SectionTitle>On-Chain Contract State</SectionTitle>
      <div className="org-manage-stats" style={{ flexWrap: "wrap", gap: 24 }}>
        {data.totalCertificatesIssued !== null && (
          <div className="org-manage-stat">
            <span className="org-manage-stat-val" style={{ color: "var(--green)" }}>
              {numFmt(data.totalCertificatesIssued)}
            </span>
            <span className="org-manage-stat-label">Certificates Issued</span>
          </div>
        )}
        {data.totalEventsCreatedOnChain !== null && (
          <div className="org-manage-stat">
            <span className="org-manage-stat-val">{numFmt(data.totalEventsCreatedOnChain)}</span>
            <span className="org-manage-stat-label">Events On-Chain</span>
          </div>
        )}
        {data.vryfDistributed !== null && (
          <div className="org-manage-stat">
            <span className="org-manage-stat-val" style={{ color: "var(--amber)" }}>
              {data.vryfDistributed}
            </span>
            <span className="org-manage-stat-label">VRYF Distributed</span>
          </div>
        )}
        {data.contractDeployedAt && (
          <div className="org-manage-stat">
            <span className="org-manage-stat-val" style={{ fontSize: 15 }}>
              {fmtDate(data.contractDeployedAt / 1000)}
            </span>
            <span className="org-manage-stat-label">Last Deployed · {fmtAge(data.contractDeployedAt)}</span>
          </div>
        )}
        {data.vryfTokenAddress && (
          <div className="org-manage-stat" style={{ alignItems: "flex-start" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--accent2)", fontSize: 13, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                {short(data.vryfTokenAddress, 10)}
              </span>
              <CopyBtn text={data.vryfTokenAddress} id="vryf" copy={copy} copied={copied} />
              <ELink href={`${ETHERSCAN}/token/${data.vryfTokenAddress}`} label="Token" />
            </div>
            <span className="org-manage-stat-label" style={{ marginTop: 4 }}>VRYF Token</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Activity Feed ────────────────────────────────────────────────────────────

function ActivityFeed({ secret, autoLoad }: { secret: string; autoLoad?: boolean }) {
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { if (autoLoad) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setError("");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    try {
      const res = await fetch(`${API}/api/admin/activity?limit=50`, {
        headers: { "x-admin-secret": secret }, signal: ctrl.signal,
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d); setOpen(true);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes("abort") ? "Timed out — try again" : m);
    } finally { clearTimeout(t); setLoading(false); }
  }

  const typeLabel: Record<string, { icon: string; label: string; color: string }> = {
    confirmation:  { icon: "✅", label: "Attendance confirmed", color: "var(--green)" },
    event_created: { icon: "📅", label: "Event deployed",       color: "var(--accent2)" },
  };

  return (
    <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between",
        borderBottom: open ? "1px solid var(--border)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "var(--radius-sm)",
            background: "rgba(124,108,240,0.12)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>📋</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>Operation History</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {data
                ? `${data.total} total operations · showing latest ${data.activity.length}`
                : "Confirmations, event deployments — newest first"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {data && (
            <button onClick={() => setOpen(o => !o)} className="btn btn-outline btn-sm">
              {open ? "▴ Hide" : "▾ Show"}
            </button>
          )}
          <button onClick={load} disabled={loading} className="btn btn-sm" style={{
            background: loading ? "var(--bg3)" : "rgba(124,108,240,0.12)",
            border: "1px solid var(--border2)",
            color: loading ? "var(--text3)" : "var(--accent2)",
          }}>
            {loading
              ? <><span className="spinner" style={{ borderTopColor: "var(--accent2)" }} /> Loading…</>
              : data ? "↺ Refresh" : "Load History"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 24px", color: "var(--coral)", fontSize: 12 }}>⚠ {error}</div>
      )}

      {open && data && (
        <div style={{ maxHeight: 480, overflowY: "auto" }}>
          {data.activity.length === 0 ? (
            <div style={{ padding: "40px 24px", textAlign: "center", color: "var(--text3)", fontSize: 13 }}>
              No operations recorded yet.
            </div>
          ) : (
            <div style={{ padding: "4px 0" }}>
              {data.activity.map((entry, i) => {
                const meta = typeLabel[entry.type] ?? { icon: "•", label: entry.type, color: "var(--text3)" };
                return (
                  <div key={i} style={{
                    display: "flex", alignItems: "flex-start", gap: 14,
                    padding: "10px 24px",
                    borderBottom: i < data.activity.length - 1 ? "1px solid var(--border)" : "none",
                    transition: "background 0.15s",
                  }}
                    onMouseEnter={e => (e.currentTarget.style.background = "var(--bg3)")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >
                    {/* Timeline dot */}
                    <div style={{
                      marginTop: 4, width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                      background: `${meta.color === "var(--green)" ? "rgba(52,211,153" : "rgba(124,108,240"},0.12)`,
                      border: `1px solid ${meta.color === "var(--green)" ? "rgba(52,211,153" : "rgba(124,108,240"},0.25)`,
                      display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13,
                    }}>
                      {meta.icon}
                    </div>

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 12, color: meta.color, fontWeight: 600 }}>
                          {meta.label}
                        </span>
                        <span style={{
                          fontSize: 11, color: "var(--text3)",
                          background: "var(--bg3)", border: "1px solid var(--border)",
                          borderRadius: 10, padding: "1px 7px",
                        }}>
                          {entry.eventEmoji} {entry.eventName}
                        </span>
                      </div>
                      <div style={{ marginTop: 4, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                        {entry.attendee && (
                          <a href={`${ETHERSCAN}/address/${entry.attendee}`} target="_blank" rel="noreferrer"
                            style={{ color: "var(--accent2)", fontSize: 11, textDecoration: "none", fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                            {short(entry.attendee)}
                          </a>
                        )}
                        {entry.txHash && (
                          <a href={`${ETHERSCAN}/tx/${entry.txHash}`} target="_blank" rel="noreferrer"
                            className="tx-link" style={{ fontSize: 11 }}>
                            {short(entry.txHash)} ↗
                          </a>
                        )}
                      </div>
                    </div>

                    {/* Timestamp */}
                    <div style={{ flexShrink: 0, textAlign: "right" }}>
                      <div style={{ fontSize: 11, color: "var(--text3)" }}>
                        {fmtTimeAgo(entry.timestamp)}
                      </div>
                      {entry.timestamp && (
                        <div style={{ fontSize: 10, color: "var(--text3)", marginTop: 2 }}>
                          {fmtDate(entry.timestamp)}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Gas Section ──────────────────────────────────────────────────────────────

function GasSection({ secret, autoLoad }: { secret: string; autoLoad?: boolean }) {
  const [data, setData] = useState<GasData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => { if (autoLoad) load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function load() {
    setLoading(true); setError("");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 30000);
    try {
      const res = await fetch(`${API}/api/admin/gas`, {
        headers: { "x-admin-secret": secret }, signal: ctrl.signal,
      });
      const d = await res.json();
      if (d.error) throw new Error(d.error);
      setData(d); setOpen(true);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes("abort") ? "Timed out — try again" : m);
    } finally { clearTimeout(t); setLoading(false); }
  }

  return (
    <div className="card" style={{ marginBottom: 16, padding: 0, overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "16px 24px", display: "flex", alignItems: "center",
        justifyContent: "space-between",
        borderBottom: open ? "1px solid var(--border)" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "var(--radius-sm)",
            background: "rgba(251,191,36,0.12)", display: "flex",
            alignItems: "center", justifyContent: "center", fontSize: 18,
          }}>⛽</div>
          <div>
            <div style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>Gas & Cost Analysis</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 2 }}>
              {data
                ? `${data.gasPriceGwei} Gwei · Est. total ${data.summary.estimatedTotalSpent} ETH`
                : "Event creation receipts + per-operation cost estimates"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {data && (
            <button onClick={() => setOpen(o => !o)} className="btn btn-outline btn-sm">
              {open ? "▴ Hide" : "▾ Show"}
            </button>
          )}
          <button onClick={load} disabled={loading} className="btn btn-sm" style={{
            background: loading ? "var(--bg3)" : "rgba(251,191,36,0.12)",
            border: "1px solid rgba(251,191,36,0.3)",
            color: loading ? "var(--text3)" : "var(--amber)",
          }}>
            {loading ? <><span className="spinner" style={{ borderTopColor: "var(--amber)" }} /> Loading…</> : data ? "↺ Refresh" : "Load Gas Data"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "10px 24px", color: "var(--coral)", fontSize: 12 }}>⚠ {error}</div>
      )}

      {open && data && (
        <div style={{ padding: "20px 24px" }}>
          {/* Summary stats */}
          <div className="grid grid-4" style={{ marginBottom: 20, marginTop: 0 }}>
            {[
              { label: "Gas Price",              value: `${data.gasPriceGwei} Gwei`,              color: "var(--accent2)" },
              { label: "Creation Cost (actual)", value: `${data.summary.actualCreationCost} ETH`, color: "var(--text)" },
              { label: "Confirmations (est.)",   value: `${data.summary.estimatedConfirmCost} ETH`, color: "var(--amber)" },
              { label: "Total Est. Spent",       value: `${data.summary.estimatedTotalSpent} ETH`, color: "var(--green)" },
            ].map(s => (
              <div key={s.label} className="card stat-card" style={{ margin: 0, padding: "14px 16px" }}>
                <div className="stat-label" style={{ marginBottom: 6 }}>{s.label}</div>
                <div className="stat-value" style={{ fontSize: 16, color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          {/* Per-operation cost table */}
          <SectionTitle>Operation Cost @ {data.gasPriceGwei} Gwei</SectionTitle>
          <div className="card" style={{ padding: 0, overflow: "hidden", marginBottom: 20 }}>
            <table className="cert-history-table" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ paddingLeft: 20 }}>Operation</th>
                  <th style={{ textAlign: "right" }}>Est. Gas</th>
                  <th style={{ textAlign: "right" }}>Gas Cost (Gwei)</th>
                  <th style={{ textAlign: "right", paddingRight: 20 }}>ETH Cost</th>
                </tr>
              </thead>
              <tbody>
                {data.operationCosts.map(op => (
                  <tr key={op.key}>
                    <td style={{ paddingLeft: 20 }}>
                      <span style={{ marginRight: 8 }}>{op.icon}</span>
                      <span style={{ color: "var(--text)" }}>{op.label}</span>
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--text3)" }}>
                      {numFmt(op.estimatedGas)}
                    </td>
                    <td style={{ textAlign: "right", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--text3)" }}>
                      {numFmt(parseInt(op.estimatedCostGwei))}
                    </td>
                    <td style={{ textAlign: "right", paddingRight: 20, fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--amber)", fontWeight: 600 }}>
                      {op.estimatedCostEth}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Event creation receipts */}
          {data.eventCosts.length > 0 && (
            <>
              <SectionTitle>Event Creation Receipts (actual on-chain data)</SectionTitle>
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <table className="cert-history-table" style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th style={{ paddingLeft: 20 }}>Event</th>
                      <th>Block</th>
                      <th style={{ textAlign: "right" }}>Gas Used</th>
                      <th style={{ textAlign: "right" }}>Gas Price</th>
                      <th style={{ textAlign: "right", paddingRight: 20 }}>ETH Cost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.eventCosts.map(ev => (
                      <tr key={ev.onChainId}>
                        <td style={{ paddingLeft: 20 }}>
                          <div style={{ color: "var(--text)", fontWeight: 500, fontSize: 13 }}>{ev.eventName}</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 3 }}>
                            <a href={`${ETHERSCAN}/tx/${ev.txHash}`} target="_blank" rel="noreferrer"
                              className="tx-link" style={{ fontSize: 11 }}>
                              {short(ev.txHash)} ↗
                            </a>
                            {ev.confirmedAttendees > 0 && (
                              <span style={{ color: "var(--text3)", fontSize: 10 }}>
                                · {ev.confirmedAttendees} attendees (~{ev.estimatedCheckInCost} ETH extra)
                              </span>
                            )}
                          </div>
                        </td>
                        <td>
                          <a href={`${ETHERSCAN}/block/${ev.blockNumber}`} target="_blank" rel="noreferrer"
                            style={{ color: "var(--accent2)", fontSize: 12, textDecoration: "none", fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                            #{numFmt(ev.blockNumber)}
                          </a>
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--text3)", fontSize: 12 }}>
                          {numFmt(ev.gasUsed)}
                        </td>
                        <td style={{ textAlign: "right", fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--text3)", fontSize: 12 }}>
                          {ev.gasPriceGwei} Gwei
                        </td>
                        <td style={{ textAlign: "right", paddingRight: 20, fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--green)", fontWeight: 600 }}>
                          {ev.ethCost}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Attendee Drawer (confirmed) ──────────────────────────────────────────────

function ConfirmedDrawer({ onChainId, secret, copy, copied }: {
  onChainId: string | number; secret: string;
  copy: (t: string, k: string) => void; copied: string | null;
}) {
  const [attendees, setAttendees] = useState<Attendee[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    fetch(`${API}/api/admin/events/${onChainId}/attendees`, {
      headers: { "x-admin-secret": secret }, signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { setAttendees(d.attendees || []); })
      .catch(() => setAttendees([]))
      .finally(() => { clearTimeout(t); setLoading(false); });
  }, [onChainId, secret]);

  if (loading) return (
    <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 8, color: "var(--text3)", fontSize: 13 }}>
      <span className="spinner" /> Loading attendees…
    </div>
  );
  if (!attendees?.length) return (
    <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>
      No confirmed attendees yet.
    </div>
  );

  return (
    <table className="cert-history-table" style={{ width: "100%" }}>
      <thead>
        <tr>
          <th style={{ paddingLeft: 20 }}>Address</th>
          <th>Tx Hash</th>
          <th>Date</th>
        </tr>
      </thead>
      <tbody>
        {attendees.map((a, i) => {
          const addr = a.address || a.addr || "";
          const tx   = a.txHash || "";
          return (
            <tr key={i}>
              <td style={{ paddingLeft: 20 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {addr ? (
                    <>
                      <a href={`${ETHERSCAN}/address/${addr}`} target="_blank" rel="noreferrer"
                        className="tx-link" style={{ fontSize: 12 }}>
                        {short(addr)}
                      </a>
                      <CopyBtn text={addr} id={`a-${i}`} copy={copy} copied={copied} />
                    </>
                  ) : "—"}
                </div>
              </td>
              <td>
                {tx ? (
                  <a href={`${ETHERSCAN}/tx/${tx}`} target="_blank" rel="noreferrer"
                    className="tx-link" style={{ fontSize: 11 }}>
                    {short(tx)} ↗
                  </a>
                ) : "—"}
              </td>
              <td style={{ color: "var(--text3)", fontSize: 12 }}>
                {a.timestamp ? fmtDate(a.timestamp) : "—"}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Pending Drawer ───────────────────────────────────────────────────────────

function PendingDrawer({ onChainId, secret, copy, copied }: {
  onChainId: string | number; secret: string;
  copy: (t: string, k: string) => void; copied: string | null;
}) {
  const [pending, setPending] = useState<PendingAttendee[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    fetch(`${API}/api/admin/events/${onChainId}/pending`, {
      headers: { "x-admin-secret": secret }, signal: ctrl.signal,
    })
      .then(r => r.json())
      .then(d => { setPending(d.pending || []); })
      .catch(() => setPending([]))
      .finally(() => { clearTimeout(t); setLoading(false); });
  }, [onChainId, secret]);

  if (loading) return (
    <div style={{ padding: "14px 20px", display: "flex", alignItems: "center", gap: 8, color: "var(--text3)", fontSize: 13 }}>
      <span className="spinner" /> Loading pending…
    </div>
  );
  if (!pending?.length) return (
    <div style={{ padding: "14px 20px", color: "var(--text3)", fontSize: 13 }}>
      No pending attendees — queue is clear.
    </div>
  );

  return (
    <div>
      <div style={{
        padding: "10px 20px",
        background: "rgba(251,191,36,0.06)",
        borderBottom: "1px solid rgba(251,191,36,0.15)",
        fontSize: 12, color: "var(--amber)",
      }}>
        ⚠ {pending.length} attendee{pending.length !== 1 ? "s" : ""} entered the join code and are awaiting on-chain confirmation by the organizer.
      </div>
      <table className="cert-history-table" style={{ width: "100%" }}>
        <thead>
          <tr>
            <th style={{ paddingLeft: 20 }}>#</th>
            <th>Address</th>
            <th>ENS</th>
          </tr>
        </thead>
        <tbody>
          {pending.map((p, i) => (
            <tr key={i}>
              <td style={{ paddingLeft: 20, color: "var(--text3)", fontSize: 12 }}>{i + 1}</td>
              <td>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <a href={`${ETHERSCAN}/address/${p.attendee}`} target="_blank" rel="noreferrer"
                    className="tx-link" style={{ fontSize: 12 }}>
                    {short(p.attendee)}
                  </a>
                  <CopyBtn text={p.attendee} id={`p-${i}`} copy={copy} copied={copied} />
                </div>
                <div style={{ fontSize: 10, color: "var(--text3)", fontFamily: "var(--font-space-mono),'Space Mono',monospace", marginTop: 2 }}>
                  {p.attendee}
                </div>
              </td>
              <td style={{ color: "var(--text2)", fontSize: 12 }}>
                {p.ens || <span style={{ color: "var(--text3)" }}>—</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({ ev, secret, copy, copied }: {
  ev: EventStat; secret: string;
  copy: (t: string, k: string) => void; copied: string | null;
}) {
  const [showConfirmed, setShowConfirmed] = useState(false);
  const [showPending,   setShowPending]   = useState(false);
  const total = ev.confirmedAttendees + ev.pendingAttendees;

  return (
    <div className="card" style={{
      padding: 0, overflow: "hidden",
      borderLeft: `3px solid ${ev.color || "var(--accent)"}`,
      boxShadow: (showConfirmed || showPending) ? `0 0 24px ${ev.color || "var(--accent)"}18` : undefined,
    }}>
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>

          {/* Left side */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <span style={{ fontSize: 24 }}>{ev.emoji}</span>
              <div>
                <div className="event-name" style={{ fontSize: 15 }}>{ev.name}</div>
                <div className="event-meta" style={{ fontSize: 12, marginBottom: 0 }}>
                  {fmtDate(ev.startTime)}{ev.endTime && ev.endTime !== ev.startTime ? ` → ${fmtDate(ev.endTime)}` : ""}
                  {" · "}
                  <span style={{ fontFamily: "var(--font-space-mono),'Space Mono',monospace", color: "var(--text3)" }}>
                    onChain #{ev.onChainId}
                  </span>
                </div>
              </div>
            </div>

            {/* Chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {/* Join code */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "var(--bg3)", border: "1px solid var(--border2)",
                borderRadius: "var(--radius-sm)", padding: "5px 10px",
              }}>
                <span style={{ color: "var(--text3)", fontSize: 10, textTransform: "uppercase" }}>Code</span>
                <span style={{
                  color: "var(--text)", fontSize: 14, letterSpacing: "0.14em",
                  fontWeight: 700, fontFamily: "var(--font-space-mono),'Space Mono',monospace",
                }}>
                  {ev.joinCode || "—"}
                </span>
                {ev.joinCode && <CopyBtn text={ev.joinCode} id={`code-${ev.onChainId}`} copy={copy} copied={copied} />}
              </div>

              {/* Confirmed */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: "rgba(52,211,153,0.1)", border: "1px solid rgba(52,211,153,0.25)",
                borderRadius: "var(--radius-sm)", padding: "5px 12px",
              }}>
                <span style={{ color: "var(--green)", fontSize: 17, fontWeight: 700, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                  {ev.confirmedAttendees}
                </span>
                <span style={{ color: "var(--green)", fontSize: 10 }}>confirmed</span>
              </div>

              {/* Pending */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: ev.pendingAttendees > 0 ? "rgba(251,191,36,0.1)" : "rgba(107,103,128,0.08)",
                border: `1px solid ${ev.pendingAttendees > 0 ? "rgba(251,191,36,0.25)" : "var(--border)"}`,
                borderRadius: "var(--radius-sm)", padding: "5px 12px",
              }}>
                <span style={{ color: ev.pendingAttendees > 0 ? "var(--amber)" : "var(--text3)", fontSize: 17, fontWeight: 700, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                  {ev.pendingAttendees}
                </span>
                <span style={{ color: ev.pendingAttendees > 0 ? "var(--amber)" : "var(--text3)", fontSize: 10 }}>pending</span>
              </div>
            </div>

            {/* Progress bar */}
            {total > 0 && (
              <div>
                <div style={{ height: 3, background: "var(--bg4)", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${(ev.confirmedAttendees / total) * 100}%`,
                    background: `linear-gradient(90deg, ${ev.color || "var(--accent)"}, var(--green))`,
                    transition: "width 0.5s ease",
                  }} />
                </div>
                <div style={{ color: "var(--text3)", fontSize: 11, marginTop: 4 }}>
                  {ev.confirmedAttendees}/{total} confirmed
                  {ev.pendingAttendees > 0 && ` · ${ev.pendingAttendees} awaiting organizer`}
                </div>
              </div>
            )}
          </div>

          {/* Right side */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <span className={`event-status ${ev.status}`}>{ev.status}</span>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {ev.txHash && <ELink href={`${ETHERSCAN}/tx/${ev.txHash}`} label="Deploy Tx" />}
            </div>
          </div>
        </div>

        {/* Expand buttons */}
        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <button
            onClick={() => setShowConfirmed(v => !v)}
            className="btn btn-outline btn-sm"
          >
            {showConfirmed ? "▴ Hide" : "▾ Confirmed"}
            {ev.confirmedAttendees > 0 && (
              <span style={{
                background: "rgba(52,211,153,0.15)", color: "var(--green)",
                borderRadius: 10, padding: "1px 7px", fontSize: 10, marginLeft: 4,
              }}>
                {ev.confirmedAttendees}
              </span>
            )}
          </button>
          <button
            onClick={() => setShowPending(v => !v)}
            className="btn btn-outline btn-sm"
          >
            {showPending ? "▴ Hide" : "▾ Pending"}
            {ev.pendingAttendees > 0 && (
              <span style={{
                background: "rgba(251,191,36,0.15)", color: "var(--amber)",
                borderRadius: 10, padding: "1px 7px", fontSize: 10, marginLeft: 4,
              }}>
                {ev.pendingAttendees}
              </span>
            )}
          </button>
        </div>
      </div>

      {showConfirmed && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg3)" }}>
          <div style={{ padding: "8px 20px 0", fontSize: 11, fontWeight: 600, color: "var(--green)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            ✅ Confirmed Attendees
          </div>
          <ConfirmedDrawer onChainId={ev.onChainId} secret={secret} copy={copy} copied={copied} />
        </div>
      )}
      {showPending && (
        <div style={{ borderTop: "1px solid var(--border)", background: "var(--bg3)" }}>
          <div style={{ padding: "8px 20px 0", fontSize: 11, fontWeight: 600, color: "var(--amber)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            ⏳ Pending Queue
          </div>
          <PendingDrawer onChainId={ev.onChainId} secret={secret} copy={copy} copied={copied} />
        </div>
      )}
    </div>
  );
}

// ─── Tab Bar ──────────────────────────────────────────────────────────────────

type AdminTab = "overview" | "events" | "history" | "gas";

const TABS: { id: AdminTab; label: string; icon: string }[] = [
  { id: "overview", label: "Overview",          icon: "◈" },
  { id: "events",   label: "Deployed Events",   icon: "📅" },
  { id: "history",  label: "Operation History", icon: "📋" },
  { id: "gas",      label: "Gas & Cost",        icon: "⛽" },
];

function TabBar({ active, onChange, counts }: {
  active: AdminTab;
  onChange: (t: AdminTab) => void;
  counts: Partial<Record<AdminTab, number>>;
}) {
  return (
    <div style={{
      borderBottom: "1px solid var(--border)",
      background: "var(--bg2)",
      position: "sticky", top: 60, zIndex: 10,
    }}>
      <div className="container" style={{ paddingTop: 0, paddingBottom: 0 }}>
        <div style={{ display: "flex", gap: 0, overflowX: "auto" }}>
          {TABS.map(tab => {
            const isActive = active === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => onChange(tab.id)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "14px 20px",
                  background: "none", border: "none", cursor: "pointer",
                  borderBottom: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  color: isActive ? "var(--text)" : "var(--text3)",
                  fontSize: 13, fontWeight: isActive ? 600 : 400,
                  whiteSpace: "nowrap",
                  transition: "color 0.15s, border-color 0.15s",
                  marginBottom: -1,
                }}
              >
                <span style={{ fontSize: 15 }}>{tab.icon}</span>
                {tab.label}
                {counts[tab.id] !== undefined && (
                  <span style={{
                    background: isActive ? "rgba(124,108,240,0.2)" : "var(--bg3)",
                    border: `1px solid ${isActive ? "var(--border2)" : "var(--border)"}`,
                    color: isActive ? "var(--accent2)" : "var(--text3)",
                    borderRadius: 10, padding: "1px 7px", fontSize: 10,
                  }}>
                    {counts[tab.id]}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
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
  const [activeTab, setActiveTab] = useState<AdminTab>("overview");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const { copy, copied } = useCopy();

  const refresh = useCallback(async () => {
    setError("");
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    try {
      const hdrs = { "x-admin-secret": secret };
      const [rr, sr] = await Promise.all([
        fetch(`${API}/api/admin/relayer`, { headers: hdrs, signal: ctrl.signal }),
        fetch(`${API}/api/admin/stats`,   { headers: hdrs, signal: ctrl.signal }),
      ]);
      if (rr.status === 401 || sr.status === 401) { onLogout(); return; }
      const [rd, sd] = await Promise.all([rr.json(), sr.json()]);
      if (rd.error) throw new Error(rd.error);
      if (sd.error) throw new Error(sd.error);
      setRelayer(rd); setStats(sd);
      setLastRefresh(new Date());
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes("abort") ? "Request timed out — try refreshing" : m);
    } finally { clearTimeout(timer); setLoading(false); }
  }, [secret, onLogout]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const filteredEvents = (stats?.events || []).filter(ev =>
    (filter === "all" || ev.status === filter) &&
    (!search || ev.name.toLowerCase().includes(search.toLowerCase()))
  );

  const counts = {
    all:      stats?.events.length ?? 0,
    live:     stats?.events.filter(e => e.status === "live").length ?? 0,
    upcoming: stats?.events.filter(e => e.status === "upcoming").length ?? 0,
    ended:    stats?.events.filter(e => e.status === "ended").length ?? 0,
  };

  return (
    <div style={{ minHeight: "100vh" }}>
      {/* Navbar */}
      <nav className="nav">
        <div className="nav-left">
          <span className="nav-brand">VRYFD</span>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 6,
            padding: "4px 14px", borderRadius: 50, fontSize: 12,
            background: "rgba(124,108,240,0.1)", border: "1px solid var(--border2)",
            color: "var(--accent2)",
          }}>
            🛡 Admin
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {lastRefresh && (
            <span style={{ color: "var(--text3)", fontSize: 11 }}>
              {lastRefresh.toLocaleTimeString()}
            </span>
          )}
          <button onClick={refresh} disabled={loading} className="btn btn-outline btn-sm">
            ↺ Refresh
          </button>
          <button onClick={onLogout} className="wallet-btn" style={{ padding: "6px 16px", fontSize: 12 }}>
            <span className="wallet-dot" /> Logout
          </button>
        </div>
      </nav>

      {/* Tab bar — sticky below navbar */}
      <TabBar
        active={activeTab}
        onChange={setActiveTab}
        counts={{
          events:  stats?.totalEvents,
          history: undefined,
          gas:     undefined,
        }}
      />

      <div className="container">
        {error && (
          <div className="toast show error" style={{
            position: "relative", transform: "none", bottom: "auto", right: "auto",
            marginBottom: 20, opacity: 1,
          }}>
            <span>⚠</span> {error}
            <button onClick={refresh} className="btn btn-sm" style={{
              marginLeft: "auto", color: "var(--coral)", background: "none",
              border: "1px solid rgba(248,113,113,0.4)", padding: "2px 10px",
            }}>Retry</button>
          </div>
        )}

        {loading && !stats ? (
          <div style={{
            display: "flex", alignItems: "center", justifyContent: "center",
            height: 300, gap: 12, color: "var(--text3)", fontSize: 14,
          }}>
            <span className="spinner" /> Loading dashboard…
          </div>
        ) : (
          <div className="fade-up">

            {/* ── Overview ─────────────────────────────────────────────────── */}
            {activeTab === "overview" && (
              <>
                <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 340px" }}>
                    {relayer && <RelayerCard relayer={relayer} copy={copy} copied={copied} />}
                  </div>
                  <div style={{ flex: "1 1 300px" }}>
                    <SystemHealth secret={secret} />
                  </div>
                </div>

                <ContractStats secret={secret} copy={copy} copied={copied} />

                {stats && (
                  <div className="grid grid-3" style={{ marginTop: 0, marginBottom: 16 }}>
                    {[
                      { label: "Deployed Events",     value: stats.totalEvents,    icon: "📅", sub: `${counts.live} live`,         iconBg: "rgba(124,108,240,0.12)", color: "var(--accent2)", tab: "events"  as AdminTab },
                      { label: "Confirmed On-Chain",  value: stats.totalConfirmed, icon: "✅", sub: "total attendees",             iconBg: "rgba(52,211,153,0.12)",  color: "var(--green)",   tab: "events"  as AdminTab },
                      { label: "Pending Confirmation",value: stats.totalPending,   icon: "⏳", sub: "need organizer action",       iconBg: "rgba(251,191,36,0.12)",  color: "var(--amber)",   tab: "events"  as AdminTab },
                    ].map(s => (
                      <div
                        key={s.label}
                        className="card stat-card"
                        onClick={() => setActiveTab(s.tab)}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="stat-icon" style={{ background: s.iconBg }}>{s.icon}</div>
                        <div className="stat-value" style={{ color: s.color }}>{s.value}</div>
                        <div className="stat-label">{s.label}</div>
                        {s.sub && <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 4 }}>{s.sub}</div>}
                      </div>
                    ))}
                  </div>
                )}

                {/* Quick-link cards to the other tabs */}
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 16 }}>
                  {[
                    { tab: "events"  as AdminTab, icon: "📅", title: "Deployed Events",   desc: "View all events, join codes, attendees and pending queue", color: "var(--accent2)", bg: "rgba(124,108,240,0.08)" },
                    { tab: "history" as AdminTab, icon: "📋", title: "Operation History", desc: "Full timeline of confirmations and event deployments",      color: "var(--green)",   bg: "rgba(52,211,153,0.08)"  },
                    { tab: "gas"     as AdminTab, icon: "⛽", title: "Gas & Cost",        desc: "Per-operation gas estimates and real creation receipts",    color: "var(--amber)",   bg: "rgba(251,191,36,0.08)"  },
                  ].map(q => (
                    <div
                      key={q.tab}
                      onClick={() => setActiveTab(q.tab)}
                      className="card"
                      style={{
                        flex: "1 1 200px", cursor: "pointer", padding: "18px 20px",
                        background: q.bg, borderTop: `2px solid ${q.color}`,
                        transition: "transform 0.15s, box-shadow 0.15s",
                      }}
                      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)"; (e.currentTarget as HTMLElement).style.boxShadow = `0 8px 24px ${q.color}22`; }}
                      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.transform = "none"; (e.currentTarget as HTMLElement).style.boxShadow = "none"; }}
                    >
                      <div style={{ fontSize: 22, marginBottom: 8 }}>{q.icon}</div>
                      <div style={{ fontWeight: 600, fontSize: 14, color: q.color, marginBottom: 6 }}>{q.title}</div>
                      <div style={{ fontSize: 12, color: "var(--text3)", lineHeight: 1.5 }}>{q.desc}</div>
                      <div style={{ marginTop: 12, fontSize: 11, color: q.color }}>Open →</div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* ── Deployed Events ───────────────────────────────────────────── */}
            {activeTab === "events" && stats && (
              <>
                <div className="section-header" style={{ marginBottom: 12 }}>
                  <h2 className="section-title">Deployed Events</h2>
                  <input
                    type="text" placeholder="Search events…"
                    value={search} onChange={e => setSearch(e.target.value)}
                    className="org-input" style={{ width: 200, padding: "7px 12px", fontSize: 12 }}
                  />
                </div>

                {/* Summary strip */}
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
                  {[
                    { label: "Total",   value: counts.all,      color: "var(--text2)" },
                    { label: "Live",    value: counts.live,     color: "var(--green)"  },
                    { label: "Upcoming",value: counts.upcoming, color: "var(--accent2)"},
                    { label: "Ended",   value: counts.ended,    color: "var(--text3)"  },
                    { label: "Confirmed",value: stats.totalConfirmed, color: "var(--green)"  },
                    { label: "Pending", value: stats.totalPending,    color: "var(--amber)"  },
                  ].map(s => (
                    <div key={s.label} style={{
                      background: "var(--bg2)", border: "1px solid var(--border)",
                      borderRadius: "var(--radius-sm)", padding: "8px 14px",
                      display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                    }}>
                      <span style={{ color: s.color, fontSize: 18, fontWeight: 700, fontFamily: "var(--font-space-mono),'Space Mono',monospace" }}>
                        {s.value}
                      </span>
                      <span style={{ color: "var(--text3)", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {s.label}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Status filter */}
                <div className="org-tabs" style={{ marginBottom: 14 }}>
                  {(["all", "live", "upcoming", "ended"] as StatusFilter[]).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setFilter(tab)}
                      className={`btn btn-sm ${filter === tab ? "btn-primary" : "btn-outline"}`}
                      style={{ textTransform: "capitalize" }}
                    >
                      {tab}
                      <span style={{
                        background: filter === tab ? "rgba(255,255,255,0.2)" : "var(--bg3)",
                        borderRadius: 10, padding: "1px 6px", fontSize: 10, marginLeft: 4,
                      }}>
                        {counts[tab]}
                      </span>
                    </button>
                  ))}
                </div>

                {filteredEvents.length === 0 ? (
                  <div className="card" style={{ textAlign: "center", padding: "40px 24px", color: "var(--text3)" }}>
                    {search ? `No events matching "${search}"` : `No ${filter} events`}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {filteredEvents.map(ev => (
                      <EventCard key={ev.onChainId} ev={ev} secret={secret} copy={copy} copied={copied} />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* ── Operation History ─────────────────────────────────────────── */}
            {activeTab === "history" && (
              <ActivityFeed secret={secret} autoLoad />
            )}

            {/* ── Gas & Cost Analysis ───────────────────────────────────────── */}
            {activeTab === "gas" && (
              <GasSection secret={secret} autoLoad />
            )}

          </div>
        )}
      </div>
    </div>
  );
}

// ─── Page Root ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [secret, setSecret] = useState<string | null>(null);

  useEffect(() => {
    const s = sessionStorage.getItem("vryfd_admin_secret");
    if (s) setSecret(s);
  }, []);

  async function handleAuth(s: string): Promise<boolean> {
    try {
      const r = await fetch(`${API}/api/admin/relayer`, { headers: { "x-admin-secret": s } });
      if (r.status === 200) {
        sessionStorage.setItem("vryfd_admin_secret", s);
        setSecret(s); return true;
      }
      return false;
    } catch { return false; }
  }

  function handleLogout() {
    sessionStorage.removeItem("vryfd_admin_secret");
    setSecret(null);
  }

  if (!secret) return <LoginScreen onAuth={handleAuth} />;
  return <Dashboard secret={secret} onLogout={handleLogout} />;
}
