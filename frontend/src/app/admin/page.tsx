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
interface ContractStats {
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
interface Attendee {
  address?: string; addr?: string; txHash?: string; timestamp?: number;
}
type StatusFilter = "all" | "live" | "upcoming" | "ended";

// ─── Design tokens ────────────────────────────────────────────────────────────

const C = {
  bg: "#070711", surface: "#0d0d1f", card: "#111127",
  border: "#1c1c38", borderBright: "#28285a",
  purple: "#7c6cf0", purpleLight: "#a78bfa",
  green: "#22c55e", greenDim: "#166534",
  amber: "#f59e0b", amberDim: "#92400e",
  red: "#ef4444", redDim: "#7f1d1d",
  blue: "#38bdf8", blueDim: "#0c4a6e",
  text: "#e2e8f0", muted: "#64748b", faint: "#2d3748",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mono: React.CSSProperties = { fontFamily: "var(--font-space-mono, monospace)" };

function short(addr: string, n = 6) {
  return addr ? `${addr.slice(0, n)}…${addr.slice(-4)}` : "—";
}
function fmtDate(ts: number | null) {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}
function fmtAge(ts: number | null) {
  if (!ts) return null;
  const d = Math.floor((Date.now() - ts) / 86400000);
  return d === 0 ? "today" : `${d}d ago`;
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

// ─── Shared UI pieces ─────────────────────────────────────────────────────────

function CopyBtn({ text, id, copy, copied }: {
  text: string; id: string;
  copy: (t: string, k: string) => void; copied: string | null;
}) {
  return (
    <button onClick={() => copy(text, id)} title="Copy" style={{
      background: "none", border: "none", color: copied === id ? C.green : C.muted,
      cursor: "pointer", padding: "1px 5px", fontSize: 12, borderRadius: 4,
      transition: "color 0.2s",
    }}>
      {copied === id ? "✓" : "⎘"}
    </button>
  );
}

function EtherscanLink({ href, label }: { href: string; label: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" style={{
      color: C.purple, fontSize: 11, textDecoration: "none",
      border: `1px solid ${C.purple}40`, borderRadius: 5,
      padding: "2px 7px", whiteSpace: "nowrap",
    }}>
      {label} ↗
    </a>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    live: [C.green, C.green + "20"],
    upcoming: [C.amber, C.amber + "20"],
    ended: [C.muted, C.faint],
    unknown: [C.muted, C.faint],
  };
  const [col, bg] = map[status] ?? map.unknown;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      background: bg, color: col, border: `1px solid ${col}35`,
      fontSize: 9, fontWeight: 700, padding: "3px 9px",
      borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.07em",
    }}>
      <span style={{
        width: 5, height: 5, borderRadius: "50%", background: col,
        boxShadow: status === "live" ? `0 0 6px ${col}` : "none",
      }} />
      {status}
    </span>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      color: C.muted, fontSize: 10, textTransform: "uppercase",
      letterSpacing: "0.09em", marginBottom: 5,
    }}>
      {children}
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
    if (!ok) { setError("Invalid secret — check ADMIN_SECRET in Railway"); setLoading(false); }
  }

  return (
    <div style={{
      minHeight: "100vh", background: C.bg,
      display: "flex", alignItems: "center", justifyContent: "center",
      ...mono,
    }}>
      <div style={{
        width: 390, background: C.card, borderRadius: 18,
        border: `1px solid ${C.border}`,
        boxShadow: `0 0 80px #7c6cf018, 0 24px 64px #00000070`,
        overflow: "hidden",
      }}>
        <div style={{
          background: "linear-gradient(135deg, #7c6cf0 0%, #a855f7 50%, #6366f1 100%)",
          padding: "32px 36px 28px", textAlign: "center",
        }}>
          <div style={{ fontSize: 40, marginBottom: 10 }}>🛡</div>
          <div style={{ color: "#fff", fontSize: 22, fontWeight: 700, letterSpacing: "-0.5px" }}>
            VRYFD Admin
          </div>
          <div style={{ color: "#c4b5fd", fontSize: 12, marginTop: 5, opacity: 0.9 }}>
            Operational Monitoring Dashboard
          </div>
        </div>
        <div style={{ padding: "28px 32px 32px" }}>
          <form onSubmit={submit}>
            <Label>Admin Secret</Label>
            <input
              type="password" placeholder="ADMIN_SECRET value"
              value={secret} onChange={(e) => setSecret(e.target.value)}
              autoFocus
              style={{
                display: "block", width: "100%", marginBottom: 14,
                background: C.surface, border: `1px solid ${C.borderBright}`,
                borderRadius: 9, color: C.text, padding: "11px 14px",
                fontSize: 14, outline: "none", boxSizing: "border-box", ...mono,
              }}
            />
            {error && (
              <div style={{
                background: "#1c0a0a", border: `1px solid ${C.red}44`,
                color: C.red, fontSize: 12, padding: "10px 14px",
                borderRadius: 8, marginBottom: 14,
              }}>⚠ {error}</div>
            )}
            <button type="submit" disabled={loading || !secret.trim()} style={{
              width: "100%", border: "none", borderRadius: 9, padding: "12px 0",
              background: loading ? C.faint : "linear-gradient(135deg,#7c6cf0,#a855f7)",
              color: "#fff", fontSize: 14, fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer", ...mono,
            }}>
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
  relayer: RelayerInfo; copy: (t: string, k: string) => void; copied: string | null;
}) {
  const bal = parseFloat(relayer.balanceEth);
  const [balColor, balLabel] =
    bal < 0.05 ? [C.red, "Critical — top up now"] :
    bal < 0.15 ? [C.amber, "Low balance"] : [C.green, "Healthy"];

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.borderBright}`,
      borderRadius: 14, padding: "20px 24px", marginBottom: 16,
    }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 28, alignItems: "flex-start" }}>

        {/* Wallet */}
        <div style={{ flex: "1 1 220px" }}>
          <Label>Relayer Wallet</Label>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
            <span style={{
              width: 8, height: 8, borderRadius: "50%", background: C.green,
              boxShadow: `0 0 7px ${C.green}`, flexShrink: 0,
            }} />
            <a href={`${ETHERSCAN}/address/${relayer.address}`} target="_blank" rel="noreferrer"
              style={{ color: C.purple, fontSize: 13, textDecoration: "none", ...mono }}>
              {short(relayer.address, 12)}
            </a>
            <CopyBtn text={relayer.address} id="wallet" copy={copy} copied={copied} />
          </div>
          <div style={{ color: C.faint, fontSize: 10, ...mono }}>{relayer.address}</div>
        </div>

        {/* Balance */}
        <div style={{ flex: "0 0 auto" }}>
          <Label>ETH Balance</Label>
          <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ color: balColor, fontSize: 28, fontWeight: 700, ...mono }}>
              {relayer.balanceEth}
            </span>
            <span style={{ color: balColor, fontSize: 12 }}>ETH</span>
          </div>
          <div style={{
            display: "inline-flex", alignItems: "center", gap: 4, marginTop: 5,
            background: `${balColor}18`, border: `1px solid ${balColor}40`,
            color: balColor, fontSize: 10, padding: "3px 9px", borderRadius: 20,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: balColor }} />
            {balLabel}
          </div>
        </div>

        {/* Contract */}
        {relayer.contractAddress && (
          <div style={{ flex: "1 1 200px" }}>
            <Label>Contract</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
              <span style={{ color: C.text, fontSize: 13, ...mono }}>
                {short(relayer.contractAddress, 10)}
              </span>
              <CopyBtn text={relayer.contractAddress} id="contract" copy={copy} copied={copied} />
              <EtherscanLink href={`${ETHERSCAN}/address/${relayer.contractAddress}`} label="View" />
            </div>
            <div style={{ color: C.muted, fontSize: 11 }}>Sepolia · Chain {relayer.chainId}</div>
          </div>
        )}

        {/* Block */}
        {relayer.blockNumber && (
          <div style={{ flex: "0 0 auto" }}>
            <Label>Latest Block</Label>
            <div style={{ color: C.text, fontSize: 20, fontWeight: 600, ...mono }}>
              #{numFmt(relayer.blockNumber)}
            </div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 4 }}>Sepolia Testnet</div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Stats Grid ───────────────────────────────────────────────────────────────

function StatCard({ label, value, sub, icon, accent }: {
  label: string; value: string | number; sub?: string; icon: string; accent: string;
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderTop: `3px solid ${accent}`, borderRadius: 12,
      padding: "16px 20px", flex: 1, minWidth: 130,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 8 }}>
            {label}
          </div>
          <div style={{ color: C.text, fontSize: 26, fontWeight: 700, lineHeight: 1 }}>{value}</div>
          {sub && <div style={{ color: C.muted, fontSize: 11, marginTop: 5 }}>{sub}</div>}
        </div>
        <div style={{
          background: `${accent}18`, width: 40, height: 40, borderRadius: 10,
          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20,
        }}>
          {icon}
        </div>
      </div>
    </div>
  );
}

// ─── Gas Section ──────────────────────────────────────────────────────────────

function GasSection({ secret }: { secret: string }) {
  const [data, setData] = useState<GasData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);

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
      setData(d);
      setOpen(true);
    } catch (e: unknown) {
      const m = e instanceof Error ? e.message : String(e);
      setError(m.includes("abort") ? "Timed out — try again" : m);
    } finally {
      clearTimeout(t); setLoading(false);
    }
  }

  const SummaryItem = ({ label, value, accent }: { label: string; value: string; accent: string }) => (
    <div style={{
      background: C.surface, border: `1px solid ${C.border}`,
      borderRadius: 10, padding: "14px 18px", flex: 1, minWidth: 120,
    }}>
      <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
        {label}
      </div>
      <div style={{ color: accent, fontSize: 16, fontWeight: 700, ...mono }}>{value}</div>
    </div>
  );

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, overflow: "hidden", marginBottom: 20,
    }}>
      {/* Header row */}
      <div style={{
        padding: "14px 20px", display: "flex",
        alignItems: "center", justifyContent: "space-between",
        borderBottom: open ? `1px solid ${C.border}` : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            background: `${C.amber}20`, color: C.amber,
            width: 32, height: 32, borderRadius: 8, fontSize: 16,
            display: "flex", alignItems: "center", justifyContent: "center",
          }}>⛽</span>
          <div>
            <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>Gas & Cost Analysis</div>
            <div style={{ color: C.muted, fontSize: 11, marginTop: 1 }}>
              {data
                ? `${data.gasPriceGwei} Gwei · Est. total ${data.summary.estimatedTotalSpent} ETH`
                : "Event creation receipts + operation cost estimates"}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {data && (
            <button onClick={() => setOpen(o => !o)} style={{
              background: C.surface, border: `1px solid ${C.borderBright}`,
              color: C.muted, borderRadius: 7, padding: "5px 12px",
              fontSize: 11, cursor: "pointer", ...mono,
            }}>
              {open ? "▴ Hide" : "▾ Show"}
            </button>
          )}
          <button onClick={load} disabled={loading} style={{
            background: loading ? C.faint : `${C.amber}20`,
            border: `1px solid ${C.amber}50`,
            color: loading ? C.muted : C.amber,
            borderRadius: 7, padding: "5px 14px",
            fontSize: 11, cursor: loading ? "not-allowed" : "pointer", fontWeight: 600, ...mono,
          }}>
            {loading ? "Loading…" : data ? "↺ Refresh" : "Load Gas Data"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: "12px 20px", color: C.red, fontSize: 12 }}>⚠ {error}</div>
      )}

      {open && data && (
        <div style={{ padding: "20px" }}>
          {/* Summary */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            <SummaryItem label="Network Gas Price" value={`${data.gasPriceGwei} Gwei`} accent={C.blue} />
            <SummaryItem label="Event Creations (actual)" value={`${data.summary.actualCreationCost} ETH`} accent={C.purple} />
            <SummaryItem label="Confirmations (est.)" value={`${data.summary.estimatedConfirmCost} ETH`} accent={C.amber} />
            <SummaryItem label="Total Est. Spent" value={`${data.summary.estimatedTotalSpent} ETH`} accent={C.green} />
          </div>

          {/* Per-operation cost table */}
          <div style={{ marginBottom: 20 }}>
            <div style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
              Operation Cost Estimates @ {data.gasPriceGwei} Gwei
            </div>
            <div style={{
              border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden",
            }}>
              <div style={{
                display: "grid", gridTemplateColumns: "28px 1fr 110px 110px 110px",
                padding: "8px 14px", background: C.surface,
                color: C.muted, fontSize: 10, textTransform: "uppercase",
                letterSpacing: "0.06em", gap: 8,
              }}>
                <span></span><span>Operation</span>
                <span style={{ textAlign: "right" }}>Est. Gas</span>
                <span style={{ textAlign: "right" }}>Cost (Gwei)</span>
                <span style={{ textAlign: "right" }}>Cost (ETH)</span>
              </div>
              {data.operationCosts.map((op, i) => (
                <div key={op.key} style={{
                  display: "grid", gridTemplateColumns: "28px 1fr 110px 110px 110px",
                  padding: "10px 14px", gap: 8, alignItems: "center",
                  borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                  background: i % 2 === 0 ? "transparent" : `${C.surface}80`,
                }}>
                  <span style={{ fontSize: 16 }}>{op.icon}</span>
                  <span style={{ color: C.text, fontSize: 12 }}>{op.label}</span>
                  <span style={{ color: C.muted, fontSize: 12, textAlign: "right", ...mono }}>
                    {numFmt(op.estimatedGas)}
                  </span>
                  <span style={{ color: C.muted, fontSize: 12, textAlign: "right", ...mono }}>
                    {numFmt(parseInt(op.estimatedCostGwei))}
                  </span>
                  <span style={{ color: C.amber, fontSize: 12, textAlign: "right", ...mono }}>
                    {op.estimatedCostEth}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Event creation receipts */}
          {data.eventCosts.length > 0 && (
            <div>
              <div style={{ color: C.muted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 10 }}>
                Event Creation Receipts (actual on-chain data)
              </div>
              <div style={{ border: `1px solid ${C.border}`, borderRadius: 10, overflow: "hidden" }}>
                <div style={{
                  display: "grid", gridTemplateColumns: "1fr 80px 90px 90px 90px",
                  padding: "8px 14px", background: C.surface,
                  color: C.muted, fontSize: 10, textTransform: "uppercase",
                  letterSpacing: "0.06em", gap: 8,
                }}>
                  <span>Event</span><span>Block</span>
                  <span style={{ textAlign: "right" }}>Gas Used</span>
                  <span style={{ textAlign: "right" }}>Gas Price</span>
                  <span style={{ textAlign: "right" }}>ETH Cost</span>
                </div>
                {data.eventCosts.map((ev, i) => (
                  <div key={ev.onChainId} style={{
                    display: "grid", gridTemplateColumns: "1fr 80px 90px 90px 90px",
                    padding: "10px 14px", gap: 8, alignItems: "center",
                    borderTop: i > 0 ? `1px solid ${C.border}` : "none",
                  }}>
                    <div>
                      <div style={{ color: C.text, fontSize: 12 }}>{ev.eventName}</div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 3 }}>
                        <a href={`${ETHERSCAN}/tx/${ev.txHash}`} target="_blank" rel="noreferrer"
                          style={{ color: C.purple, fontSize: 10, textDecoration: "none", ...mono }}>
                          {short(ev.txHash)} ↗
                        </a>
                        {ev.confirmedAttendees > 0 && (
                          <span style={{ color: C.muted, fontSize: 10 }}>
                            · {ev.confirmedAttendees} attendees (~{ev.estimatedCheckInCost} ETH extra)
                          </span>
                        )}
                      </div>
                    </div>
                    <a href={`${ETHERSCAN}/block/${ev.blockNumber}`} target="_blank" rel="noreferrer"
                      style={{ color: C.purple, fontSize: 11, textDecoration: "none", ...mono }}>
                      #{numFmt(ev.blockNumber)}
                    </a>
                    <span style={{ color: C.muted, fontSize: 11, textAlign: "right", ...mono }}>
                      {numFmt(ev.gasUsed)}
                    </span>
                    <span style={{ color: C.muted, fontSize: 11, textAlign: "right", ...mono }}>
                      {ev.gasPriceGwei} Gwei
                    </span>
                    <span style={{ color: C.green, fontSize: 12, textAlign: "right", fontWeight: 600, ...mono }}>
                      {ev.ethCost}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Contract Stats ───────────────────────────────────────────────────────────

function ContractStats({ secret, copy, copied }: {
  secret: string; copy: (t: string, k: string) => void; copied: string | null;
}) {
  const [data, setData] = useState<ContractStats | null>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12000);
    fetch(`${API}/api/admin/contract-stats`, {
      headers: { "x-admin-secret": secret }, signal: ctrl.signal,
    })
      .then((r) => r.json())
      .then((d) => { if (!d.error) setData(d); })
      .catch(() => {})
      .finally(() => clearTimeout(t));
  }, [secret]);

  if (!data) return null;

  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`,
      borderRadius: 14, padding: "16px 20px", marginBottom: 16,
    }}>
      <div style={{ color: C.muted, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.09em", marginBottom: 14 }}>
        On-Chain Contract State
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>

        {data.totalCertificatesIssued !== null && (
          <div>
            <Label>Certificates Issued</Label>
            <div style={{ color: C.green, fontSize: 22, fontWeight: 700 }}>
              {numFmt(data.totalCertificatesIssued)}
            </div>
          </div>
        )}

        {data.totalEventsCreatedOnChain !== null && (
          <div>
            <Label>Events On-Chain (total)</Label>
            <div style={{ color: C.purple, fontSize: 22, fontWeight: 700 }}>
              {numFmt(data.totalEventsCreatedOnChain)}
            </div>
            <div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>incl. past deployments</div>
          </div>
        )}

        {data.vryfDistributed !== null && (
          <div>
            <Label>VRYF Distributed</Label>
            <div style={{ color: C.amber, fontSize: 22, fontWeight: 700 }}>
              {data.vryfDistributed}
            </div>
            <div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>total supply minted</div>
          </div>
        )}

        {data.contractDeployedAt && (
          <div>
            <Label>Last Deployed</Label>
            <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
              {fmtDate(data.contractDeployedAt / 1000)}
            </div>
            <div style={{ color: C.muted, fontSize: 10, marginTop: 3 }}>
              {fmtAge(data.contractDeployedAt)}
            </div>
          </div>
        )}

        {data.vryfTokenAddress && (
          <div>
            <Label>VRYF Token</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ color: C.text, fontSize: 12, ...mono }}>
                {short(data.vryfTokenAddress, 10)}
              </span>
              <CopyBtn text={data.vryfTokenAddress} id="vryf" copy={copy} copied={copied} />
              <EtherscanLink href={`${ETHERSCAN}/token/${data.vryfTokenAddress}`} label="Token" />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Attendee Drawer ──────────────────────────────────────────────────────────

function AttendeeDrawer({ onChainId, secret, copy, copied }: {
  onChainId: string | number; secret: string;
  copy: (t: string, k: string) => void; copied: string | null;
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

  if (loading) return <div style={{ padding: "14px 22px", color: C.muted, fontSize: 12 }}>Loading attendees…</div>;
  if (error)   return <div style={{ padding: "14px 22px", color: C.red, fontSize: 12 }}>⚠ {error}</div>;
  if (!attendees?.length) return <div style={{ padding: "14px 22px", color: C.muted, fontSize: 12 }}>No confirmed attendees yet.</div>;

  return (
    <div style={{ padding: "12px 22px 18px" }}>
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 130px 100px",
        gap: 8, fontSize: 9, color: C.muted,
        textTransform: "uppercase", letterSpacing: "0.07em",
        paddingBottom: 7, borderBottom: `1px solid ${C.border}`, marginBottom: 4,
      }}>
        <span>Address</span><span>Tx Hash</span><span>Date</span>
      </div>
      {attendees.map((a, i) => {
        const addr = a.address || a.addr || "";
        const tx = a.txHash || "";
        return (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 130px 100px",
            gap: 8, fontSize: 12, color: C.text,
            padding: "6px 0", borderBottom: `1px solid ${C.border}18`, alignItems: "center",
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              {addr ? (
                <>
                  <a href={`${ETHERSCAN}/address/${addr}`} target="_blank" rel="noreferrer"
                    style={{ color: C.purple, textDecoration: "none", ...mono }}>{short(addr)}</a>
                  <CopyBtn text={addr} id={`a-${i}`} copy={copy} copied={copied} />
                </>
              ) : "—"}
            </div>
            <div>
              {tx ? (
                <a href={`${ETHERSCAN}/tx/${tx}`} target="_blank" rel="noreferrer"
                  style={{ color: C.purple, fontSize: 11, textDecoration: "none", ...mono }}>
                  {short(tx)} ↗
                </a>
              ) : "—"}
            </div>
            <div style={{ color: C.muted, fontSize: 11 }}>{a.timestamp ? fmtDate(a.timestamp) : "—"}</div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Event Card ───────────────────────────────────────────────────────────────

function EventCard({ ev, secret, copy, copied }: {
  ev: EventStat; secret: string;
  copy: (t: string, k: string) => void; copied: string | null;
}) {
  const [open, setOpen] = useState(false);
  const total = ev.confirmedAttendees + ev.pendingAttendees;

  return (
    <div style={{
      background: C.card, borderRadius: 12,
      border: `1px solid ${C.border}`,
      borderLeft: `3px solid ${ev.color || C.purple}`,
      boxShadow: open ? `0 0 18px ${ev.color || C.purple}14` : "none",
      overflow: "hidden",
    }}>
      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          {/* Left */}
          <div style={{ flex: 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{ev.emoji}</span>
              <div>
                <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>{ev.name}</div>
                <div style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>
                  {fmtDate(ev.startTime)}{ev.endTime && ev.endTime !== ev.startTime ? ` → ${fmtDate(ev.endTime)}` : ""}
                  {" · "}
                  <span style={{ color: C.faint, ...mono }}>#{ev.onChainId}</span>
                </div>
              </div>
            </div>

            {/* Metrics chips */}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
              {/* Join code */}
              <div style={{
                display: "flex", alignItems: "center", gap: 6,
                background: C.surface, border: `1px solid ${C.borderBright}`,
                borderRadius: 8, padding: "5px 10px",
              }}>
                <span style={{ color: C.muted, fontSize: 10 }}>CODE</span>
                <span style={{ color: C.text, fontSize: 13, letterSpacing: "0.12em", fontWeight: 700, ...mono }}>
                  {ev.joinCode || "—"}
                </span>
                {ev.joinCode && <CopyBtn text={ev.joinCode} id={`code-${ev.onChainId}`} copy={copy} copied={copied} />}
              </div>

              {/* Confirmed */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: `${C.green}12`, border: `1px solid ${C.green}30`,
                borderRadius: 8, padding: "5px 11px",
              }}>
                <span style={{ color: C.green, fontSize: 17, fontWeight: 700 }}>{ev.confirmedAttendees}</span>
                <span style={{ color: C.greenDim, fontSize: 10 }}>confirmed</span>
              </div>

              {/* Pending */}
              <div style={{
                display: "flex", alignItems: "center", gap: 5,
                background: ev.pendingAttendees > 0 ? `${C.amber}12` : `${C.faint}18`,
                border: `1px solid ${ev.pendingAttendees > 0 ? C.amber : C.faint}30`,
                borderRadius: 8, padding: "5px 11px",
              }}>
                <span style={{ color: ev.pendingAttendees > 0 ? C.amber : C.muted, fontSize: 17, fontWeight: 700 }}>
                  {ev.pendingAttendees}
                </span>
                <span style={{ color: ev.pendingAttendees > 0 ? C.amberDim : C.faint, fontSize: 10 }}>pending</span>
              </div>
            </div>

            {/* Progress */}
            {total > 0 && (
              <div>
                <div style={{ height: 3, background: C.border, borderRadius: 3, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 3,
                    width: `${(ev.confirmedAttendees / total) * 100}%`,
                    background: `linear-gradient(90deg, ${ev.color || C.purple}, ${C.green})`,
                  }} />
                </div>
                <div style={{ color: C.muted, fontSize: 10, marginTop: 4 }}>
                  {ev.confirmedAttendees}/{total} confirmed
                  {ev.pendingAttendees > 0 && ` · ${ev.pendingAttendees} awaiting organizer`}
                </div>
              </div>
            )}
          </div>

          {/* Right */}
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
            <StatusBadge status={ev.status} />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
              {ev.txHash && (
                <EtherscanLink href={`${ETHERSCAN}/tx/${ev.txHash}`} label="Deploy Tx" />
              )}
              {ev.txHash && (
                <EtherscanLink
                  href={`${ETHERSCAN}/address/${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || ""}#events`}
                  label="Events"
                />
              )}
            </div>
          </div>
        </div>

        {/* Expand button */}
        <button onClick={() => setOpen(o => !o)} style={{
          marginTop: 10, background: "none",
          border: `1px solid ${C.borderBright}`,
          color: C.muted, borderRadius: 7, padding: "5px 14px",
          fontSize: 11, cursor: "pointer", display: "inline-flex",
          alignItems: "center", gap: 6, ...mono,
        }}>
          {open ? "▴ Hide" : "▾ View"} attendees
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
      const [rr, sr] = await Promise.all([
        fetch(`${API}/api/admin/relayer`, { headers, signal: ctrl.signal }),
        fetch(`${API}/api/admin/stats`,   { headers, signal: ctrl.signal }),
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
    } finally {
      clearTimeout(timer); setLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 30_000);
    return () => clearInterval(t);
  }, [refresh]);

  const filteredEvents = (stats?.events || []).filter((ev) =>
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
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, ...mono }}>
      {/* Sticky header */}
      <div style={{
        background: C.surface, borderBottom: `1px solid ${C.border}`,
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{
          maxWidth: 1120, margin: "0 auto", padding: "0 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between", height: 52,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 16 }}>🛡</span>
            <span style={{ fontWeight: 700, fontSize: 14 }}>VRYFD</span>
            <span style={{ color: C.faint }}>/ Admin</span>
            <span style={{
              background: `${C.purple}22`, color: C.purple, fontSize: 9,
              padding: "2px 8px", borderRadius: 20, border: `1px solid ${C.purple}40`,
              textTransform: "uppercase", letterSpacing: "0.08em",
            }}>Sepolia</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            {lastRefresh && (
              <span style={{ color: C.faint, fontSize: 10 }}>
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}
            <button onClick={refresh} disabled={loading} style={{
              background: C.card, border: `1px solid ${C.borderBright}`,
              color: C.muted, borderRadius: 7, padding: "4px 11px",
              fontSize: 11, cursor: "pointer", ...mono,
            }}>↺ Refresh</button>
            <button onClick={onLogout} style={{
              background: "none", border: `1px solid ${C.border}`,
              color: C.muted, borderRadius: 7, padding: "4px 11px",
              fontSize: 11, cursor: "pointer", ...mono,
            }}>Logout</button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div style={{ maxWidth: 1120, margin: "0 auto", padding: "22px 24px 60px" }}>
        {/* Error */}
        {error && (
          <div style={{
            background: "#160808", border: `1px solid ${C.red}40`,
            color: C.red, borderRadius: 10, padding: "11px 16px",
            fontSize: 12, marginBottom: 18, display: "flex", alignItems: "center", gap: 8,
          }}>
            <span>⚠</span> {error}
            <button onClick={refresh} style={{
              marginLeft: "auto", background: "none", border: `1px solid ${C.red}60`,
              color: C.red, borderRadius: 5, padding: "3px 10px",
              fontSize: 11, cursor: "pointer", ...mono,
            }}>Retry</button>
          </div>
        )}

        {loading && !stats ? (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 280, gap: 12, color: C.muted, fontSize: 13 }}>
            <span style={{
              width: 18, height: 18, border: `2px solid ${C.purple}`,
              borderTopColor: "transparent", borderRadius: "50%",
              display: "inline-block", animation: "spin 0.8s linear infinite",
            }} />
            Loading dashboard…
            <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          </div>
        ) : (
          <>
            {/* Relayer */}
            {relayer && <RelayerCard relayer={relayer} copy={copy} copied={copied} />}

            {/* Contract Stats (lazy loads from chain) */}
            <ContractStats secret={secret} copy={copy} copied={copied} />

            {/* System stats */}
            {stats && (
              <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
                <StatCard label="Deployed Events" value={stats.totalEvents}
                  icon="📅" accent={C.purple} sub={`${counts.live} live`} />
                <StatCard label="Confirmed On-Chain" value={stats.totalConfirmed}
                  icon="✅" accent={C.green} sub="total check-ins" />
                <StatCard label="Pending Confirmation" value={stats.totalPending}
                  icon="⏳" accent={C.amber} sub="need organizer action" />
              </div>
            )}

            {/* Gas Analysis */}
            <GasSection secret={secret} />

            {/* Events */}
            {stats && (
              <div>
                <div style={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between", flexWrap: "wrap", gap: 10, marginBottom: 12,
                }}>
                  <div style={{ color: C.text, fontSize: 14, fontWeight: 600 }}>
                    Deployed Events
                  </div>
                  <input
                    type="text" placeholder="Search events…"
                    value={search} onChange={(e) => setSearch(e.target.value)}
                    style={{
                      background: C.card, border: `1px solid ${C.borderBright}`,
                      borderRadius: 8, color: C.text, padding: "7px 12px",
                      fontSize: 12, outline: "none", width: 200, ...mono,
                    }}
                  />
                </div>

                {/* Filter tabs */}
                <div style={{ display: "flex", gap: 6, marginBottom: 14, flexWrap: "wrap" }}>
                  {(["all", "live", "upcoming", "ended"] as StatusFilter[]).map((tab) => (
                    <button key={tab} onClick={() => setFilter(tab)} style={{
                      background: filter === tab ? C.purple : C.card,
                      border: `1px solid ${filter === tab ? C.purple : C.borderBright}`,
                      color: filter === tab ? "#fff" : C.muted,
                      borderRadius: 8, padding: "5px 14px",
                      fontSize: 11, cursor: "pointer", textTransform: "capitalize",
                      fontWeight: filter === tab ? 600 : 400, ...mono,
                    }}>
                      {tab}{" "}
                      <span style={{
                        background: filter === tab ? "#ffffff25" : C.faint,
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
                    borderRadius: 12, padding: "36px 24px", textAlign: "center",
                    color: C.muted, fontSize: 13,
                  }}>
                    {search ? `No events matching "${search}"` : `No ${filter} events`}
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
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
