"use client";

import React, { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useAccount, useDisconnect, useChainId, useEnsName, useWriteContract, usePublicClient, useReadContract, useSignTypedData, useWalletClient } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { CONTRACT_ADDRESSES, VRYF_TOKEN_ADDRESS } from "../../utils/wagmiConfig";
import Dashboard from "../../components/Dashboard";
import EventsPage from "../../components/EventsPage";
import BadgesPage from "../../components/BadgesPage";
import LeaderboardPage from "../../components/LeaderboardPage";
import CertificatePage from "../../components/CertificatePage";
import OrganizerPage from "../../components/OrganizerPage";
import VRYFPage from "../../components/VRYFPage";
import { type VEvent, type LBEntry, type ToastState, INITIAL_EVENTS, LEADERBOARD_DATA } from "../../lib/vryfd";
import { getENSOverride, getAddressOverride } from "../../lib/ensOverrides";
import VryfdABI from "../../abis/VryfdAttendance.json";
import VRYFTokenABI from "../../abis/VRYFToken.json";

// ─── Helper ───────────────────────────────────────────────────────────────────

function getTier(checkins: number): string {
  if (checkins >= 20) return "Gold Legend";
  if (checkins >= 10) return "Silver Pioneer";
  if (checkins >= 5) return "Bronze Explorer";
  return "Newcomer";
}

const MILESTONES = [
  { threshold: 5,  bonus: 100, label: "Bronze Explorer", icon: "🏆" },
  { threshold: 10, bonus: 250, label: "Silver Pioneer",  icon: "🌟" },
  { threshold: 20, bonus: 500, label: "Gold Legend",     icon: "👑" },
] as const;

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

const DATA_VERSION = "v32"; // bumped: events 1&2 now same as 3&4 (no pre-deployed onChainId)

// ─── Per-wallet localStorage helpers (outside component) ─────────────────────

export interface VRYFEntry {
  type: "checkin" | "badge" | "milestone";
  amount: number;
  label: string;
  timestamp: number; // unix seconds
  txHash?: string;
}

function loadWalletData(addr: string): {
  checkins: number; badges: number[]; vryfBalance: number;
  claimedMilestones: number[];
  badgeBlockNums: Record<number, number>;
  badgeMintTimes: Record<number, string>;
  pendingIds: number[];
  vryfHistory: VRYFEntry[];
  badgeTokenIds: Record<number, string>;
  milestoneNftIds: Record<number, string>;
} {
  try {
    const raw = localStorage.getItem(`vryfd_wallet_${addr}`);
    if (raw) return { vryfBalance: 0, claimedMilestones: [], badgeBlockNums: {}, badgeMintTimes: {}, pendingIds: [], vryfHistory: [], badgeTokenIds: {}, milestoneNftIds: {}, ...JSON.parse(raw) };
  } catch {}
  return { checkins: 0, badges: [], vryfBalance: 0, claimedMilestones: [], badgeBlockNums: {}, badgeMintTimes: {}, pendingIds: [], vryfHistory: [], badgeTokenIds: {}, milestoneNftIds: {} };
}

function saveWalletData(
  addr: string, checkins: number, badges: number[], vryfBalance: number,
  claimedMilestones: number[], badgeBlockNums: Record<number, number>, badgeMintTimes: Record<number, string>,
  pendingIds: number[], vryfHistory: VRYFEntry[],
  badgeTokenIds: Record<number, string>, milestoneNftIds: Record<number, string>,
) {
  localStorage.setItem(`vryfd_wallet_${addr}`, JSON.stringify({ checkins, badges, vryfBalance, claimedMilestones, badgeBlockNums, badgeMintTimes, pendingIds, vryfHistory, badgeTokenIds, milestoneNftIds }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  // Resolve ENS name on mainnet — ENS registry lives on mainnet regardless of active chain
  const { data: ensName } = useEnsName({ address, chainId: 1 });
  // For on-chain badge minting — user's wallet signs and pays gas
  const { writeContractAsync } = useWriteContract();
  // For gasless check-in — EIP-712 signature only, no gas
  const { signTypedDataAsync } = useSignTypedData();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  // Refs so callbacks always see the latest values without needing them in every dep array
  const walletClientRef = useRef(walletClient);
  useEffect(() => { walletClientRef.current = walletClient; }, [walletClient]);
  const showToastRef = useRef<(msg: string, type: "success" | "error" | "") => void>(() => {});

  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState<string>("dashboard");
  const [mountedPages, setMountedPages] = useState<Set<string>>(() => new Set(["dashboard"]));
  const [currentEventId, setCurrentEventId] = useState<number | null>(null);
  const [checkinStep, setCheckinStep] = useState(0);
  const [isMinting, setIsMinting] = useState(false);
  const [lastCheckinTxHash, setLastCheckinTxHash] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<ToastState>({ message: "", type: "", visible: false });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userCheckins, setUserCheckins] = useState(0);
  const [userBadges, setUserBadges] = useState<number[]>([]);
  const [userVryfBalance, setUserVryfBalance] = useState(0);
  const [claimedMilestones, setClaimedMilestones] = useState<number[]>([]);
  const [vryfHistory, setVryfHistory] = useState<VRYFEntry[]>([]);

  const addVryfEntry = useCallback((entry: VRYFEntry) => {
    setVryfHistory((prev) => [entry, ...prev].slice(0, 100));
  }, []);

  // Prompt the connected wallet to display a newly minted ERC-1155 NFT.
  // Strategy: try ERC1155 first (MetaMask v11.7+), fall back to ERC721 (broader support).
  // A 900ms delay lets MetaMask fully process the preceding transaction before handling this request.
  const promptAddNft = useCallback((contractAddr: string, tokenId: string) => {
    const provider: { request: (a: unknown) => Promise<unknown> } | null =
      (typeof window !== "undefined" && (window as any).ethereum)
        ? (window as any).ethereum
        : (walletClientRef.current as any) ?? null;

    // wallet_watchAsset requires tokenId as a 0x-prefixed hex string for both ERC-1155 and ERC-721
    const hexTokenId = tokenId.startsWith("0x")
      ? tokenId
      : `0x${BigInt(tokenId).toString(16)}`;

    const showFallbackToast = () => showToastRef.current(
      `NFT minted ✓  To add: MetaMask → NFTs tab → Import NFT → Contract: ${contractAddr.slice(0, 8)}… Token ID: ${tokenId}`,
      ""
    );

    if (!provider) { showFallbackToast(); return; }

    const tryWatch = (type: string): Promise<boolean> =>
      provider.request({ method: "wallet_watchAsset", params: { type, options: { address: contractAddr, tokenId: hexTokenId } } }) as Promise<boolean>;

    // Wait for MetaMask to settle after the minting transaction, then try both NFT types
    setTimeout(async () => {
      try {
        // Primary: ERC1155 (MetaMask v11.7+)
        const added1155 = await tryWatch("ERC1155");
        if (added1155) { showToastRef.current("NFT added to MetaMask — check your NFTs tab", "success"); return; }
      } catch { /* ERC1155 not supported by this wallet/version */ }

      try {
        // Fallback: ERC721 — MetaMask handles ERC-1155 tokens with this type on older versions
        const added721 = await tryWatch("ERC721");
        if (added721) { showToastRef.current("NFT added to MetaMask — check your NFTs tab", "success"); return; }
      } catch { /* ERC721 also failed */ }

      // Neither worked — show actionable manual-import instructions
      showFallbackToast();
    }, 900);
  }, []);
  const [isMilestoneLoading, setIsMilestoneLoading] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [isJoinCodeLoading, setIsJoinCodeLoading] = useState(false);
  // demoIds where user entered join code — pending organizer confirmation (session only)
  const [pendingRegistrationIds, setPendingRegistrationIds] = useState<number[]>([]);
  // ENS manual entry — for wallets without an auto-resolved ENS name. Persisted per-wallet.
  const [manualEns, setManualEns] = useState("");
  const [manualEnsStatus, setManualEnsStatus] = useState<"idle" | "resolving" | "verified" | "mismatch" | "not_found">("idle");
  // When true, suppress auto-resolved ENS (user chose to unlink). Persisted per-wallet in localStorage.
  const [ensUnlinked, setEnsUnlinked] = useState(false);

  // Simple localStorage helpers — called inline wherever state changes
  const ensKey = address ? `vryfd_ens_unlinked_${address.toLowerCase()}` : null;
  const manualEnsKey = address ? `vryfd_manual_ens_${address.toLowerCase()}` : null;

  // Real on-chain certificates for the connected wallet (fetched from chain on connect)
  const [userCertificates, setUserCertificates] = useState<{
    certId: number; eventId: number; eventName: string;
    timestamp: number; metadataURI: string; isValid: boolean;
  }[]>([]);
  // demoEventIds where user has confirmed attendance on-chain (may be wider than userBadges)
  const [checkedInIds, setCheckedInIds] = useState<number[]>([]);


  // Read VRYF token address at render time from localStorage (updated on reset),
  // falling back to the module constant (env var). Reading localStorage here avoids
  // the SSR stale-constant problem where VRYF_TOKEN_ADDRESS is set before the page
  // reloads with the new address after a fresh contract deployment.
  const vryfTokenAddress = useMemo((): `0x${string}` | undefined => {
    const stored = typeof window !== "undefined" ? localStorage.getItem("vryfd_vryf_token_address") : null;
    const addr = (stored && stored.startsWith("0x") ? stored : null)
      ?? (VRYF_TOKEN_ADDRESS !== "0x0000000000000000000000000000000000000000" ? VRYF_TOKEN_ADDRESS : null)
      ?? process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS;
    return addr && addr !== "0x0000000000000000000000000000000000000000" ? addr as `0x${string}` : undefined;
  }, []);
  const { data: vryfOnChain, refetch: refetchVryf } = useReadContract({
    address: vryfTokenAddress,
    abi: VRYFTokenABI.abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!vryfTokenAddress },
  });
  // Maps demoEventId → real block number from badge mint TX receipt
  const [badgeBlockNums, setBadgeBlockNums] = useState<Record<number, number>>({});
  // Maps demoEventId → ISO timestamp of badge mint (for certificate display)
  const [badgeMintTimes, setBadgeMintTimes] = useState<Record<number, string>>({});
  // Maps demoEventId → on-chain ERC-1155 tokenId (stored at claim time for "Add to MetaMask" button)
  const [badgeTokenIds, setBadgeTokenIds] = useState<Record<number, string>>({});
  // Maps milestone threshold (5/10/20) → on-chain ERC-1155 tokenId
  const [milestoneNftIds, setMilestoneNftIds] = useState<Record<number, string>>({});

  // Use a ref to hold current address for the save effect (avoids stale closure)
  const addressRef = useRef<string | undefined>(undefined);
  // Skip saving immediately after loading (prevents overwriting stored data with stale zeros)
  const skipNextSaveRef = useRef(false);
  // Prevents save effects from firing before localStorage has been hydrated
  const hydratedRef = useRef(false);
  // Skip persist effect on the very first render (hydration hasn't applied setEvents yet)
  const firstRenderRef = useRef(true);
  // Tracks which address has been synced from chain (avoids double-sync)
  const syncedAddressRef = useRef<string | undefined>(undefined);
  // Set to true after reset — suppresses chain re-fetch until wallet reconnects
  const postResetRef = useRef(false);
  // Start with defaults to avoid SSR/client hydration mismatch; load persisted counts after mount
  // Status is NOT stored — it is derived from deployedEventIds (deployed = live)
  const [events, setEvents] = useState<VEvent[]>(INITIAL_EVENTS);

  const [leaderboard, setLeaderboard] = useState<LBEntry[]>(LEADERBOARD_DATA);

  // ─── Deployment state derived entirely from events (single source of truth) ──
  // Storing onChainId/deployTxHash on the VEvent itself means vryfd_all_events
  // is the only localStorage key needed — no drift between separate keys.
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

  // No loadBackendDeployedEvents needed — onChainId/deployTxHash live on the VEvent itself.

  // ─── Sync attendance + certificates from chain (runs once per wallet) ───────
  const syncChainData = useCallback(async (addr: string, chainEventIds: Record<number, number>, eventsArr: VEvent[]) => {
    // Sync badge + attendance state from chain to fix "badge already claimed" on new sessions.
    // We read getAttendanceRecord for each deployed event and restore:
    //   - checkedInIds      (timestamp > 0 means confirmed)
    //   - userBadges        (badgeClaimed = true means already minted)
    //   - userCheckins      (totalAttendance on-chain — source of truth)
    //   - claimedMilestones (derived from highestMilestoneClaimed on-chain)
    // This does NOT run the check-in flow — it only reconciles persistent on-chain state.
    postResetRef.current = false; // allow future in-flight abort checks to work correctly
    try {
      const deployedEntries = Object.entries(chainEventIds) as [string, number][];
      if (deployedEntries.length > 0 && publicClient) {
        const contractAddress = CONTRACT_ADDRESSES[11155111];
        if (contractAddress && contractAddress !== "0x0000000000000000000000000000000000000000") {
          const newCheckedIn: number[] = [];
          const newBadges: number[] = [];

          // Read per-event records + wallet-level counters in parallel
          const [, , totalAttendanceRaw, highestMilestoneRaw] = await Promise.all([
            Promise.all(
              deployedEntries.map(async ([demoIdStr, onChainId]) => {
                try {
                  const record = await publicClient.readContract({
                    address: contractAddress,
                    abi: VryfdABI.abi,
                    functionName: "getAttendanceRecord",
                    args: [BigInt(onChainId), addr as `0x${string}`],
                  }) as { timestamp: bigint; badgeClaimed: boolean };
                  const demoId = Number(demoIdStr);
                  if (Number(record.timestamp) > 0) newCheckedIn.push(demoId);
                  if (record.badgeClaimed) newBadges.push(demoId);
                } catch { /* single event read failed — skip */ }
              })
            ),
            Promise.resolve(), // placeholder to keep index alignment
            publicClient.readContract({
              address: contractAddress,
              abi: VryfdABI.abi,
              functionName: "totalAttendance",
              args: [addr as `0x${string}`],
            }).catch(() => null),
            publicClient.readContract({
              address: contractAddress,
              abi: VryfdABI.abi,
              functionName: "highestMilestoneClaimed",
              args: [addr as `0x${string}`],
            }).catch(() => null),
          ]);

          // Abort if reset happened while awaiting chain reads
          if (postResetRef.current) return;
          if (newCheckedIn.length > 0) {
            setCheckedInIds((prev) => {
              const merged = [...new Set([...prev, ...newCheckedIn])];
              return merged.length === prev.length ? prev : merged;
            });
          }
          if (newBadges.length > 0) {
            setUserBadges((prev) => {
              const merged = [...new Set([...prev, ...newBadges])];
              return merged.length === prev.length ? prev : merged;
            });
          }
          // Sync on-chain total attendance — on-chain is authoritative.
          // Use exact on-chain value (not Math.max) so a redeployed contract resets the counter.
          if (totalAttendanceRaw !== null && totalAttendanceRaw !== undefined) {
            const onChainCount = Number(totalAttendanceRaw as bigint);
            setUserCheckins(Math.max(onChainCount, newCheckedIn.length));
          }
          // Derive claimed milestones from highestMilestoneClaimed — on-chain is authoritative.
          // If on-chain highest is 0 (e.g. after contract redeployment), clear local claimed list.
          if (highestMilestoneRaw !== null && highestMilestoneRaw !== undefined) {
            const highest = Number(highestMilestoneRaw as bigint);
            const claimed = MILESTONES.filter((m) => m.threshold <= highest).map((m) => m.threshold);
            setClaimedMilestones(claimed);
          }

          // Populate vryfHistory with historical check-in tx data for all confirmed events.
          // Fetch attendee records from backend so we get the real txHash for each check-in.
          // Uses functional setVryfHistory update so deduplication sees latest stored history.
          if (newCheckedIn.length > 0 && !postResetRef.current) {
            const historicEntries: VRYFEntry[] = [];
            await Promise.all(newCheckedIn.map(async (demoId) => {
              const onChainId = chainEventIds[demoId];
              if (onChainId === undefined) return;
              const ev = eventsArr.find((e) => e.id === demoId);
              const label = `Check-in: ${ev ? ev.name : `Event #${demoId}`}`;
              try {
                const res = await fetch(`${BACKEND}/api/relay/attendees/${onChainId}`);
                if (!res.ok) return;
                const data = await res.json();
                const attendees: { attendee: string; timestamp: number; txHash?: string }[] = data.attendees ?? [];
                const mine = attendees.find((a) => a.attendee.toLowerCase() === addr.toLowerCase());
                if (!mine) return;
                historicEntries.push({ type: "checkin", amount: 10, label, timestamp: mine.timestamp, txHash: mine.txHash });
              } catch { /* skip — backend unreachable or event not found */ }
            }));

            if (historicEntries.length > 0 && !postResetRef.current) {
              setVryfHistory((prev) => {
                // Pass 1: backfill txHash on existing checkin entries that are missing it
                let anyUpdated = false;
                const patched = prev.map((existing) => {
                  if (existing.type !== "checkin" || existing.txHash) return existing;
                  const match = historicEntries.find((h) => h.label === existing.label && h.txHash);
                  if (!match) return existing;
                  anyUpdated = true;
                  return { ...existing, txHash: match.txHash, timestamp: match.timestamp };
                });
                // Pass 2: add entries that don't exist at all yet
                const existingLabels = new Set(patched.filter((e) => e.type === "checkin").map((e) => e.label));
                const novel = historicEntries.filter((e) => !existingLabels.has(e.label));
                if (!anyUpdated && novel.length === 0) return prev;
                return [...patched, ...novel].sort((a, b) => b.timestamp - a.timestamp).slice(0, 100);
              });
            }
          }
        }
      }
    } catch { /* chain read failed — keep existing state */ }

    // Fetch real on-chain certificates issued to this wallet.
    // Filter by vryfd_reset_at so pre-reset certs don't reappear after a reset.
    try {
      if (postResetRef.current) return; // skip if reset happened while awaiting
      const res = await fetch(`${BACKEND}/api/certificates/mine/${addr}`);
      if (res.ok && !postResetRef.current) {
        const data = await res.json();
        const resetAt = parseInt(localStorage.getItem("vryfd_reset_at") || "0", 10);
        const certs = (data.certificates ?? []).filter((c: { timestamp: number }) => c.timestamp > resetAt);
        setUserCertificates(certs);
      }
    } catch { /* backend unreachable — keep existing state */ }
  }, [publicClient]);

  // Trigger chain sync (badge/attendance reconciliation + certificates) once per wallet per session
  useEffect(() => {
    if (!address) return;
    if (syncedAddressRef.current === address) return;
    syncedAddressRef.current = address;
    syncChainData(address, onChainEventIds, events);
  }, [address, onChainEventIds, syncChainData, events]);

  // Note: userCheckins is set authoritatively by syncChainData (on-chain totalAttendance).
  // Local increments (on checkin) are optimistic until the next sync.
  // No separate "bump up" effect needed — syncChainData takes Math.max(onChain, local events).

  // Hydrate localStorage-backed state after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    // Version guard — wipe stale data from before this data format
    if (localStorage.getItem("vryfd_data_version") !== DATA_VERSION) {
      Object.keys(localStorage).forEach((k) => {
        if (k.startsWith("vryfd_") && k !== "vryfd_data_version") localStorage.removeItem(k);
      });
      localStorage.setItem("vryfd_data_version", DATA_VERSION);
    }

    // Try to restore full VEvent array from localStorage (fast path — survives normal reloads)
    // loadedFromSource tracks whether events came from localStorage OR backend events.json.
    // The deployedEvents overlay only ADDS onChainIds when no source was found (first-ever visit).
    // When loaded from any source it only UPDATES existing onChainIds — never adds new ones —
    // so a reset (which saves events with no onChainId) is never overridden on reload.
    let loadedFromSource = false;
    try {
      const saved = localStorage.getItem("vryfd_all_events");
      if (saved) {
        const parsed: VEvent[] = JSON.parse(saved);
        if (parsed.length > 0) {
          setEvents(parsed);
          loadedFromSource = true;
        }
      }
    } catch {}

    (async () => {
      if (!loadedFromSource) {
        // No localStorage — try backend events store (has full event data incl. created events)
        try {
          const r = await fetch(`${BACKEND}/api/relay/events`);
          const d = await r.json() as { events: VEvent[] | null };
          if (d.events && d.events.length > 0) {
            setEvents(d.events);
            loadedFromSource = true;
          }
        } catch {}
      }

      // No events found in any source — INITIAL_EVENTS is already the current state.
      // Treat this as "loaded from source" so the deployedEvents overlay doesn't add
      // onChainIds. This prevents a flash of "2 active events" when localStorage is
      // wiped (version change) and events.json is empty/missing (e.g., after reset).
      if (!loadedFromSource) {
        loadedFromSource = true;
      }

      // deployedEvents overlay — keeps onChainId/txHash current after redeployments.
      // Rule: only UPDATE events that already have an onChainId; never add a new one.
      // This ensures a reset (which strips onChainId) is never overridden on reload.
      try {
        const r = await fetch(`${BACKEND}/api/relay/deployedEvents`);
        const d = await r.json() as Record<string, { txHash: string; onChainId: string }>;
        setEvents((prev) => prev.map((ev) => {
          const info = d[String(ev.id)];
          if (!info) return ev;
          if (loadedFromSource && ev.onChainId === undefined) return ev;
          return { ...ev, onChainId: Number(info.onChainId), deployTxHash: info.txHash };
        }));
      } catch {}
    })();

    hydratedRef.current = true;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Load wallet-specific data when address changes
  useEffect(() => {
    addressRef.current = address;
    if (address) {
      // Wallet (re)connected or switched — clear post-reset suppression so chain sync runs fresh
      postResetRef.current = false;
      skipNextSaveRef.current = true;
      // Restore persisted ENS preferences for this wallet
      const k = address.toLowerCase();
      const wasUnlinked = localStorage.getItem(`vryfd_ens_unlinked_${k}`) === "1";
      const savedManualEns = localStorage.getItem(`vryfd_manual_ens_${k}`) || "";
      setEnsUnlinked(wasUnlinked);
      setManualEns(savedManualEns);
      setManualEnsStatus(savedManualEns ? "verified" : "idle");
      const data = loadWalletData(address);
      setUserCheckins(data.checkins);
      setUserBadges(data.badges);
      setUserVryfBalance(data.vryfBalance);
      setClaimedMilestones(data.claimedMilestones);
      setBadgeBlockNums(data.badgeBlockNums);
      setBadgeMintTimes(data.badgeMintTimes);
      setBadgeTokenIds(data.badgeTokenIds ?? {});
      setMilestoneNftIds(data.milestoneNftIds ?? {});
      if (data.pendingIds.length > 0) setPendingRegistrationIds(data.pendingIds);
      setVryfHistory(data.vryfHistory ?? []);
      setCheckinStep(0);
      setCurrentEventId(null);
      setLastCheckinTxHash(undefined);
    } else {
      // Wallet disconnected — clear all user state
      skipNextSaveRef.current = false;
      syncedAddressRef.current = undefined;
      postResetRef.current = false;
      setUserCheckins(0);
      setUserBadges([]);
      setUserVryfBalance(0);
      setClaimedMilestones([]);
      setBadgeBlockNums({});
      setVryfHistory([]);
      setBadgeMintTimes({});
      setUserCertificates([]);
      setCheckedInIds([]);
      setPendingRegistrationIds([]);
      setCheckinStep(0);
      setCurrentEventId(null);
      setLastCheckinTxHash(undefined);
      setLeaderboard(LEADERBOARD_DATA);
      setManualEns("");
      setManualEnsStatus("idle");
      setEnsUnlinked(false);
    }
  }, [address]);

  // Save wallet-specific data whenever any wallet state changes
  // Does NOT depend on address to avoid firing with stale values on connect
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (!addressRef.current) return;
    saveWalletData(addressRef.current, userCheckins, userBadges, userVryfBalance, claimedMilestones, badgeBlockNums, badgeMintTimes, pendingRegistrationIds, vryfHistory, badgeTokenIds, milestoneNftIds);
  }, [userCheckins, userBadges, userVryfBalance, claimedMilestones, badgeBlockNums, badgeMintTimes, pendingRegistrationIds, vryfHistory, badgeTokenIds, milestoneNftIds]);

  // Persist full VEvent array to localStorage and backend on every change.
  // Skip the very first render — hydration's setEvents hasn't run yet, so events
  // is still INITIAL_EVENTS and would overwrite correctly stored localStorage data.
  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false;
      return;
    }
    if (!hydratedRef.current) return;
    localStorage.setItem("vryfd_all_events", JSON.stringify(events));
    fetch(`${BACKEND}/api/relay/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
    }).catch(() => {});
  }, [events]);

  const handleEventDeployed = useCallback((demoId: number, onChainId: number, txHash: string) => {
    // Store deployment data directly on the event — single source of truth
    setEvents((prev) => prev.map((ev) =>
      ev.id === demoId ? { ...ev, onChainId, deployTxHash: txHash } : ev
    ));
  }, []);

  const handleEventCreated = useCallback((eventData: Omit<VEvent, "id">) => {
    setEvents((prev) => {
      const newId = prev.length > 0 ? Math.max(...prev.map((e) => e.id)) + 1 : 1;
      return [...prev, { id: newId, ...eventData }];
    });
  }, []);

  const handleEventUpdated = useCallback((id: number, patch: Partial<Pick<VEvent, "name" | "emoji" | "color" | "date">>) => {
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, ...patch } : ev));
  }, []);

  const handleEventEnded = useCallback((id: number) => {
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, status: "ended" as const } : ev));
  }, []);

  const handleEventResumed = useCallback((id: number) => {
    // Reset to "upcoming" — displayEvents will re-derive it as "live" since it's deployed on-chain
    setEvents((prev) => prev.map((ev) => ev.id === id ? { ...ev, status: "upcoming" as const } : ev));
  }, []);

  const handleEventDeleted = useCallback((id: number) => {
    setEvents((prev) => prev.filter((ev) => ev.id !== id));
  }, []);

  // Derive event status: deployed on-chain = live (unless explicitly ended).
  // "upcoming after reset" works because reset strips onChainId → event leaves onChainDeployedIds.
  const displayEvents = events
    .map((ev) => {
      if (!onChainDeployedIds.has(ev.id)) return ev; // not on-chain → keep original status (upcoming)
      if (ev.status === "ended") return ev;           // organizer explicitly ended
      const now = Math.floor(Date.now() / 1000);
      const isEnded = ev.endTime !== undefined && now > ev.endTime;
      return { ...ev, status: isEnded ? ("ended" as const) : ("live" as const) };
    })
    .sort((a, b) => a.id - b.id);

  // Real ENS from mainnet; fall back to project-level override, then empty string.
  // Use || so any falsy ensName (including "") defers to the override map.
  const rawUserENS = (ensName || (address ? getENSOverride(address) : null)) ?? "";
  const userENS = ensUnlinked ? "" : rawUserENS;
  // Effective ENS: auto-resolved OR manually linked — used for display everywhere outside EventsPage
  const effectiveENS = userENS || (manualEnsStatus === "verified" ? manualEns : "");
  const userAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  // Keep the connected wallet's leaderboard entry in sync with real state
  const liveLeaderboard = React.useMemo(() => {
    if (!address) return leaderboard;
    const shortAddr = `${address.slice(0, 6)}...${address.slice(-4)}`;
    const newTier = getTier(userCheckins);
    const exists = leaderboard.some(
      (e) => (effectiveENS && e.ens === effectiveENS) || e.addr === shortAddr
    );
    const updated = leaderboard.map((e) =>
      (effectiveENS && e.ens === effectiveENS) || e.addr === shortAddr
        ? { ...e, ens: effectiveENS || e.ens || shortAddr, addr: shortAddr, count: userCheckins, tier: newTier }
        : e
    );
    if (!exists) {
      return [...updated, { ens: effectiveENS || shortAddr, addr: shortAddr, count: userCheckins, tier: newTier }];
    }
    return updated;
  }, [leaderboard, address, effectiveENS, userCheckins]);

  // ─── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: "success" | "error" | "") => {
    setToast({ message, type, visible: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3500);
  }, []);
  // Keep showToastRef current so promptAddNft (declared earlier) can use it
  showToastRef.current = showToast;

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const refreshCertificates = useCallback(async () => {
    if (!address || postResetRef.current) return;
    try {
      const res = await fetch(`${BACKEND}/api/certificates/mine/${address}`);
      if (res.ok) {
        const data = await res.json();
        const resetAt = parseInt(localStorage.getItem("vryfd_reset_at") || "0", 10);
        const certs = (data.certificates ?? []).filter((c: { timestamp: number }) => c.timestamp > resetAt);
        setUserCertificates(certs);
      }
    } catch { /* backend unreachable */ }
  }, [address]);

  const showPage = useCallback((name: string) => {
    setCurrentPage(name);
    setMountedPages((prev) => prev.has(name) ? prev : new Set([...prev, name]));
    if (name === "certificate") refreshCertificates();
  }, [refreshCertificates]);

  // ─── Open event ─────────────────────────────────────────────────────────────

  const openEvent = useCallback(
    (id: number) => {
      setCurrentEventId(id);
      setJoinCode(""); // clear stale join code from previous event
      setCurrentPage("events");
      setMountedPages((prev) => prev.has("events") ? prev : new Set([...prev, "events"]));
      setLastCheckinTxHash(undefined);

      // Set step from cached state immediately (fast path)
      if (userBadges.includes(id)) {
        setCheckinStep(4);
      } else if (checkedInIds.includes(id)) {
        setCheckinStep(3);
      } else {
        setCheckinStep(isConnected ? 1 : 0);
      }

      // Permanent fix: always verify on-chain state for this specific event when opening.
      // This ensures badge/attendance state is correct regardless of when syncChainData ran.
      // Runs silently in the background — updates step if chain disagrees with cache.
      if (address && publicClient) {
        const onChainId = onChainEventIds[id];
        if (onChainId !== undefined) {
          const contractAddress = CONTRACT_ADDRESSES[11155111];
          if (contractAddress && contractAddress !== "0x0000000000000000000000000000000000000000") {
            publicClient.readContract({
              address: contractAddress,
              abi: VryfdABI.abi,
              functionName: "getAttendanceRecord",
              args: [BigInt(onChainId), address as `0x${string}`],
            }).then((result) => {
              const record = result as { timestamp: bigint; badgeClaimed: boolean };
              if (record.badgeClaimed) {
                setUserBadges((prev) => prev.includes(id) ? prev : [...prev, id]);
                setCheckedInIds((prev) => prev.includes(id) ? prev : [...prev, id]);
                setCheckinStep(4);
              } else if (Number(record.timestamp) > 0) {
                setCheckedInIds((prev) => prev.includes(id) ? prev : [...prev, id]);
                setCheckinStep((prev) => prev < 3 ? 3 : prev);
              }
            }).catch(() => { /* chain read failed — keep cached state */ });
          }
        }
      }
    },
    [isConnected, userBadges, checkedInIds, address, publicClient, onChainEventIds]
  );

  // Sync checkinStep whenever the selected event changes or chain state updates.
  // Always recomputes from scratch so switching events never carries over stale step.
  useEffect(() => {
    if (currentEventId === null) { setCheckinStep(0); return; }
    if (userBadges.includes(currentEventId)) {
      setCheckinStep(4);
    } else if (checkedInIds.includes(currentEventId)) {
      setCheckinStep(3);
    } else {
      // Not checked in on this event — reset to beginning
      setCheckinStep(0);
    }
  }, [currentEventId, checkedInIds, userBadges]);

  // ─── Check-in flow ──────────────────────────────────────────────────────────

  const doCheckin = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (checkinStep <= 1) {
      const contractAddress = CONTRACT_ADDRESSES[chainId];
      const onChainEventId = onChainEventIds[currentEventId ?? -1];

      if (chainId !== 11155111) {
        showToast("Please switch your wallet to the Sepolia network", "error");
        return;
      }
      if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
        showToast("Contract address not configured for this network", "error");
        return;
      }
      if (!publicClient) {
        showToast("Wallet client not ready — please try again", "error");
        return;
      }
      if (onChainEventId === undefined) {
        showToast("Event not deployed on-chain yet", "error");
        return;
      }

      setCheckinStep(2);
      showToast("Confirm check-in in MetaMask...", "");

      try {
        // Pre-flight simulation: surfaces exact revert reason before MetaMask prompt — no gas spent
        await publicClient.simulateContract({
          address: contractAddress as `0x${string}`,
          abi: VryfdABI.abi,
          functionName: "checkIn",
          args: [BigInt(onChainEventId)],
          account: address,
        });

        const txHash = await writeContractAsync({
          address: contractAddress as `0x${string}`,
          abi: VryfdABI.abi,
          functionName: "checkIn",
          args: [BigInt(onChainEventId)],
          gas: BigInt(500_000),
        });

        // Tx submitted — update optimistically so UI isn't blocked by Alchemy receipt polling
        setLastCheckinTxHash(txHash as string);
        const newCheckins = userCheckins + 1;
        setUserCheckins(newCheckins);
        if (currentEventId !== null) {
          setCheckedInIds((prev) => prev.includes(currentEventId) ? prev : [...prev, currentEventId]);
        }

        let vryfEarned = 10;
        const milestone = MILESTONES.find((m) => m.threshold === newCheckins);
        if (milestone) vryfEarned += milestone.bonus;
        setUserVryfBalance((prev) => prev + vryfEarned);
        const eventName = events.find((e) => e.id === currentEventId)?.name ?? "Event";
        addVryfEntry({ type: "checkin", amount: 10, label: `Check-in: ${eventName}`, timestamp: Math.floor(Date.now() / 1000), txHash: txHash as string });
        if (milestone) addVryfEntry({ type: "milestone", amount: milestone.bonus, label: `${milestone.icon} ${milestone.label} Milestone`, timestamp: Math.floor(Date.now() / 1000), txHash: txHash as string });
        setCheckinStep(3);

        const newTier = getTier(newCheckins);
        setLeaderboard((prev) =>
          prev.map((entry) =>
            (effectiveENS && entry.ens === effectiveENS) || (!effectiveENS && entry.addr === userAddress)
              ? { ...entry, count: newCheckins, tier: newTier }
              : entry
          )
        );

        showToast(`Attendance confirmed on Sepolia! Tx: ${(txHash as string).slice(0, 10)}...`, "success");
        // Background: wait for receipt then sync chain balance (non-blocking)
        publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}`, pollingInterval: 8000, timeout: 120_000 })
          .then(() => refetchVryf().catch(() => {}))
          .catch(() => refetchVryf().catch(() => {}));

        if (milestone) {
          setTimeout(() => {
            showToast(`${milestone.icon} ${milestone.label} unlocked! +${milestone.bonus} VRYF bonus!`, "success");
          }, 2000);
        }
      } catch (err: unknown) {
        setCheckinStep(1);
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("User rejected") || msg.includes("denied")) {
          showToast("Check-in cancelled", "error");
        } else if (msg.toLowerCase().includes("already")) {
          // Already checked in on-chain — just advance to badge step.
          // Do NOT increment userCheckins or VRYF here — this is a no-op tx,
          // not a new check-in. syncChainData / openEvent already restored the count.
          setCheckinStep(3);
          showToast("Already checked in — now claim your POAP badge!", "success");
        } else if (msg.toLowerCase().includes("event ended") || msg.toLowerCase().includes("event has ended")) {
          showToast("This event has ended — check-in is no longer available", "error");
        } else if (msg.toLowerCase().includes("event not active") || msg.toLowerCase().includes("not active")) {
          showToast("This event is not active on-chain yet", "error");
        } else if (msg.toLowerCase().includes("event not started") || msg.toLowerCase().includes("not started")) {
          showToast("This event has not started yet", "error");
        } else {
          showToast(`Check-in failed: ${msg}`, "error");
        }
      }

    } else if (checkinStep === 3) {
      // Gasless badge mint — attendee signs EIP-712, relayer submits tx (no gas for attendee)
      const onChainEventId = onChainEventIds[currentEventId ?? -1];
      const contractAddress = CONTRACT_ADDRESSES[chainId];
      if (chainId !== 11155111) {
        showToast("Please switch your wallet to the Sepolia network", "error");
        return;
      }
      if (!contractAddress || contractAddress === "0x0000000000000000000000000000000000000000") {
        showToast("Contract address not configured for this network", "error");
        return;
      }
      if (!address) {
        showToast("Wallet not connected", "error");
        return;
      }
      if (onChainEventId === undefined) {
        showToast("Event not found on-chain", "error");
        return;
      }
      setIsMinting(true);
      try {
        // Step 1: fetch current nonce
        const nonceRes = await fetch(`${BACKEND}/api/relay/checkin-nonce/${address}`);
        const nonceData = await nonceRes.json();
        if (!nonceRes.ok) throw new Error(nonceData.error || "Could not fetch nonce");
        const nonce = BigInt(nonceData.nonce);

        // Step 2: sign EIP-712 ClaimBadge — MetaMask sign prompt, zero gas
        showToast("Sign in MetaMask to claim badge (no gas)...", "");
        const signature = await signTypedDataAsync({
          domain: { name: "VryfdAttendance", version: "1", chainId: 11155111, verifyingContract: contractAddress as `0x${string}` },
          types: { ClaimBadge: [{ name: "attendee", type: "address" }, { name: "eventId", type: "uint256" }, { name: "nonce", type: "uint256" }] },
          primaryType: "ClaimBadge",
          message: { attendee: address, eventId: BigInt(onChainEventId), nonce },
        });

        // Step 3: relayer submits tx
        showToast("Minting badge on-chain (relayer paying gas)...", "");
        const res = await fetch(`${BACKEND}/api/relay/gaslessClaimBadge`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attendee: address, onChainEventId, signature }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Badge claim failed");

        // Optimistic state update
        setCheckinStep(4);
        setUserVryfBalance((prev) => prev + 25);
        const badgeEventName = events.find((e) => e.id === currentEventId)?.name ?? "Event";
        addVryfEntry({ type: "badge", amount: 25, label: `POAP Badge: ${badgeEventName}`, timestamp: Math.floor(Date.now() / 1000), txHash: data.txHash ?? undefined });
        const capturedBadgeEventId = currentEventId;
        if (capturedBadgeEventId !== null) {
          setUserBadges((prev) =>
            prev.includes(capturedBadgeEventId) ? prev : [...prev, capturedBadgeEventId]
          );
          setBadgeMintTimes((prev) => ({ ...prev, [capturedBadgeEventId]: new Date().toISOString() }));
          // Store token ID so the Badges page can show a persistent "Add to MetaMask" button
          if (data.tokenId && data.tokenId !== "0") setBadgeTokenIds((prev) => ({ ...prev, [capturedBadgeEventId]: String(data.tokenId) }));
        }
        showToast("Soulbound POAP Badge minted! It's in your wallet.", "success");
        // Prompt wallet to display the newly minted NFT — ERC-1155 tokens aren't auto-detected
        if (data.tokenId && data.tokenId !== "0") promptAddNft(contractAddress, String(data.tokenId));
        refetchVryf().catch(() => {});
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        if (msg.includes("User rejected") || msg.includes("denied")) {
          showToast("Badge mint cancelled", "error");
        } else if (msg.includes("Badge already claimed") || msg.toLowerCase().includes("already claimed")) {
          setCheckinStep(4);
          if (currentEventId !== null) {
            setUserBadges((prev) => {
              if (prev.includes(currentEventId)) return prev;
              setUserVryfBalance((v) => v + 25);
              return [...prev, currentEventId];
            });
          }
          showToast("POAP badge already in your wallet from a previous session!", "success");
        } else if (msg.startsWith("Attendance not confirmed") || msg.toLowerCase().includes("not attended")) {
          // Remove stale checkedInIds entry so step resets to 0 (join code flow)
          if (currentEventId !== null) {
            setCheckedInIds((prev) => prev.filter((id) => id !== currentEventId));
          }
          showToast("Attendance not confirmed on-chain yet. Ask the organizer to confirm your attendance.", "error");
        } else if (msg.startsWith("Badge mint would fail:")) {
          showToast(msg, "error");
        } else {
          showToast(`Badge mint failed: ${msg}`, "error");
        }
      } finally {
        setIsMinting(false);
      }
    }
  }, [
    isConnected,
    openConnectModal,
    checkinStep,
    userCheckins,
    userBadges,
    currentEventId,
    onChainEventIds,
    effectiveENS,
    userAddress,
    showToast,
    address,
    chainId,
    signTypedDataAsync,
    publicClient,
    refetchVryf,
  ]);

  // ─── ENS manual verification ─────────────────────────────────────────────────

  const handleVerifyEns = useCallback(async () => {
    if (!manualEns.trim() || !address) return;
    setManualEnsStatus("resolving");
    const name = manualEns.trim();
    // Check project-level override first (no network call needed)
    const overrideAddr = getAddressOverride(name);
    if (overrideAddr) {
      const matched = overrideAddr.toLowerCase() === address.toLowerCase();
      setManualEnsStatus(matched ? "verified" : "mismatch");
      if (matched && manualEnsKey) localStorage.setItem(manualEnsKey, name);
      return;
    }
    try {
      const res = await fetch(`${BACKEND}/api/relay/ens-resolve/${encodeURIComponent(name)}`);
      const data = await res.json();
      if (!data.address) {
        setManualEnsStatus("not_found");
      } else if (data.address.toLowerCase() === address.toLowerCase()) {
        setManualEnsStatus("verified");
        if (manualEnsKey) localStorage.setItem(manualEnsKey, name);
      } else {
        setManualEnsStatus("mismatch");
      }
    } catch {
      setManualEnsStatus("not_found");
    }
  }, [manualEns, address, manualEnsKey]);

  // ─── Join code check-in ─────────────────────────────────────────────────────

  const doJoinCodeCheckin = useCallback(async () => {
    if (!isConnected) { openConnectModal?.(); return; }
    if (!address) { showToast("Wallet address unavailable — please reconnect", "error"); return; }
    if (!joinCode.trim()) { showToast("Enter the join code displayed at the event", "error"); return; }

    const onChainEventId = onChainEventIds[currentEventId ?? -1];
    if (onChainEventId === undefined) { showToast("Event not deployed on-chain yet", "error"); return; }

    const contractAddress = CONTRACT_ADDRESSES[chainId] as `0x${string}`;
    if (!contractAddress) { showToast("Switch your wallet to Sepolia", "error"); return; }

    setIsJoinCodeLoading(true);
    // Step 1: Get nonce from backend (avoids frontend chain read)
    let nonce: bigint;
    try {
      const nonceRes = await fetch(`${BACKEND}/api/relay/checkin-nonce/${address}`);
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceData.error || "Could not fetch nonce");
      nonce = BigInt(nonceData.nonce);
    } catch {
      showToast("Could not reach backend — is the server running?", "error");
      setIsJoinCodeLoading(false);
      return;
    }

    // Step 2: Sign EIP-712 CheckIn — free, no gas (just a MetaMask signature)
    let signature: string;
    try {
      showToast("Sign in MetaMask to register (no gas)...", "");
      signature = await signTypedDataAsync({
        domain: {
          name: "VryfdAttendance",
          version: "1",
          chainId: 11155111,
          verifyingContract: contractAddress,
        },
        types: {
          CheckIn: [
            { name: "attendee", type: "address" },
            { name: "eventId", type: "uint256" },
            { name: "nonce", type: "uint256" },
          ],
        },
        primaryType: "CheckIn",
        message: { attendee: address, eventId: BigInt(onChainEventId), nonce },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        showToast("Signature cancelled", "error");
      } else {
        showToast("Could not sign — please try again", "error");
      }
      setIsJoinCodeLoading(false);
      return;
    }

    // Step 3: Submit join code + signature to backend
    showToast("Verifying join code...", "");
    try {
      const res = await fetch(`${BACKEND}/api/relay/joinCheckin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          onChainEventId, attendee: address, code: joinCode.trim(), signature,
          ens: effectiveENS || null,
        }),
      });
      const data = await res.json();

      // 409 — already pending or already confirmed
      if (res.status === 409) {
        if (data.alreadyPending) {
          if (currentEventId !== null) {
            setPendingRegistrationIds((prev) => prev.includes(currentEventId) ? prev : [...prev, currentEventId]);
          }
          showToast("Already registered — waiting for organizer confirmation", "");
        } else if (data.alreadyConfirmed) {
          setCheckinStep(3);
          showToast("Already confirmed on-chain — claim your POAP badge!", "success");
        } else {
          showToast(data.error || "Already processed", "error");
        }
        return;
      }

      if (!res.ok) throw new Error(data.error || "Join code check-in failed");

      // New flow: join code accepted → pending (no chain write yet)
      if (data.pending) {
        if (currentEventId !== null) {
          setPendingRegistrationIds((prev) => prev.includes(currentEventId) ? prev : [...prev, currentEventId]);
        }
        setJoinCode("");
        showToast("Registered! Waiting for organizer to confirm your attendance.", "success");
        return;
      }

      // Fallback: direct on-chain confirmation (backwards compat)
      const txHash: string = data.txHash;
      setLastCheckinTxHash(txHash);
      const newCheckins = userCheckins + 1;
      setUserCheckins(newCheckins);
      if (currentEventId !== null) {
        setCheckedInIds((prev) => prev.includes(currentEventId) ? prev : [...prev, currentEventId]);
      }

      let vryfEarned = 10;
      const milestone = MILESTONES.find((m) => m.threshold === newCheckins);
      if (milestone) vryfEarned += milestone.bonus;
      setUserVryfBalance((prev) => prev + vryfEarned);
      setCheckinStep(3);
      setJoinCode("");

      if (currentEventId !== null) {
        setEvents((prev) =>
          prev.map((ev) => ev.id === currentEventId ? { ...ev, attendees: ev.attendees + 1 } : ev)
        );
      }
      const newTier = getTier(newCheckins);
      setLeaderboard((prev) =>
        prev.map((entry) =>
          (effectiveENS && entry.ens === effectiveENS) || (!effectiveENS && entry.addr === userAddress)
            ? { ...entry, count: newCheckins, tier: newTier }
            : entry
        )
      );
      await refetchVryf();
      showToast(`Attendance confirmed! Tx: ${txHash.slice(0, 10)}...`, "success");
      if (milestone) {
        setTimeout(() => {
          showToast(`${milestone.icon} ${milestone.label} unlocked! +${milestone.bonus} VRYF bonus!`, "success");
        }, 2000);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("Incorrect join code")) {
        showToast("Incorrect join code — check with the organizer", "error");
      } else if (msg.includes("No join code set")) {
        showToast("No join code set for this event yet", "error");
      } else if (msg.toLowerCase().includes("not started")) {
        showToast("This event has not started yet", "error");
      } else if (msg.toLowerCase().includes("ended")) {
        showToast("This event has ended", "error");
      } else {
        showToast(`Join code check-in failed: ${msg}`, "error");
      }
    } finally {
      setIsJoinCodeLoading(false);
    }
  }, [
    isConnected, openConnectModal, address, joinCode, currentEventId,
    onChainEventIds, userCheckins, effectiveENS, userAddress,
    showToast, refetchVryf, chainId, signTypedDataAsync,
  ]);

  // ─── Check if organizer has confirmed a pending registration ──────────────
  const checkPendingStatus = useCallback(async () => {
    if (!address || currentEventId === null) return;
    const onChainEventId = onChainEventIds[currentEventId];
    if (onChainEventId === undefined) return;
    try {
      const res = await fetch(`${BACKEND}/api/relay/checkin-status/${onChainEventId}/${address}`);
      const data = await res.json();
      if (data.checkedIn) {
        // Organizer confirmed — update shared state
        setPendingRegistrationIds((prev) => prev.filter((id) => id !== currentEventId));
        if (data.txHash) setLastCheckinTxHash(data.txHash);
        // Check alreadyCounted from closure BEFORE updating checkedInIds to avoid double-counting
        // if this callback is invoked twice before React state propagates.
        const alreadyCounted = currentEventId !== null && checkedInIds.includes(currentEventId);
        if (currentEventId !== null) {
          setCheckedInIds((prev) => prev.includes(currentEventId) ? prev : [...prev, currentEventId]);
        }
        if (!alreadyCounted) {
          const newCheckins = userCheckins + 1;
          setUserCheckins(newCheckins);
          let vryfEarned = 10;
          const milestone = MILESTONES.find((m) => m.threshold === newCheckins);
          if (milestone) vryfEarned += milestone.bonus;
          setUserVryfBalance((prev) => prev + vryfEarned);
          const evName = events.find((e) => e.id === currentEventId)?.name ?? "Event";
          addVryfEntry({ type: "checkin", amount: 10, label: `Check-in: ${evName}`, timestamp: Math.floor(Date.now() / 1000), txHash: data.txHash });
          if (milestone) addVryfEntry({ type: "milestone", amount: milestone.bonus, label: `${milestone.icon} ${milestone.label} Milestone`, timestamp: Math.floor(Date.now() / 1000), txHash: data.txHash });
        }
        setCheckinStep(3);
        showToast("Attendance confirmed! Claim your POAP badge.", "success");
        refetchVryf().catch(() => {});
      } else {
        showToast("Not confirmed yet — check back after the organizer reviews registrations.", "");
      }
    } catch {
      showToast("Could not check status — try again", "error");
    }
  }, [address, currentEventId, onChainEventIds, userCheckins, checkedInIds, events, showToast, refetchVryf, addVryfEntry]);

  // ─── Milestone NFT claim ────────────────────────────────────────────────────

  const handleClaimMilestone = useCallback(async (threshold: number) => {
    const contractAddress = CONTRACT_ADDRESSES[chainId];
    if (chainId !== 11155111) { showToast("Please switch to Sepolia", "error"); return; }
    if (!contractAddress) { showToast("Contract not configured", "error"); return; }
    if (!publicClient || !address) { showToast("Wallet not ready", "error"); return; }

    setIsMilestoneLoading(true);
    try {
      // Step 1: fetch nonce
      const nonceRes = await fetch(`${BACKEND}/api/relay/checkin-nonce/${address}`);
      const nonceData = await nonceRes.json();
      if (!nonceRes.ok) throw new Error(nonceData.error || "Could not fetch nonce");
      const nonce = BigInt(nonceData.nonce);

      // Step 2: sign EIP-712 ClaimMilestone — MetaMask sign prompt, zero gas
      showToast("Sign in MetaMask to claim milestone NFT (no gas)...", "");
      const signature = await signTypedDataAsync({
        domain: { name: "VryfdAttendance", version: "1", chainId: 11155111, verifyingContract: contractAddress as `0x${string}` },
        types: { ClaimMilestone: [{ name: "attendee", type: "address" }, { name: "nonce", type: "uint256" }] },
        primaryType: "ClaimMilestone",
        message: { attendee: address, nonce },
      });

      // Step 3: relayer submits tx
      showToast("Claiming milestone NFT (relayer paying gas)...", "");
      const res = await fetch(`${BACKEND}/api/relay/gaslessMilestoneReward`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendee: address, signature }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Milestone claim failed");

      // The contract mints ALL eligible unclaimed tiers in one call — update all of them
      const eligible = MILESTONES.filter(
        (x) => userCheckins >= x.threshold && !claimedMilestones.includes(x.threshold)
      );
      const totalBonus = eligible.reduce((sum, x) => sum + x.bonus, 0);
      const newThresholds = eligible.map((x) => x.threshold);
      setClaimedMilestones((prev) => {
        const next = [...prev];
        for (const t of newThresholds) if (!next.includes(t)) next.push(t);
        return next;
      });
      if (totalBonus > 0) setUserVryfBalance((prev) => prev + totalBonus);
      const now = Math.floor(Date.now() / 1000);
      eligible.forEach((m) => addVryfEntry({ type: "milestone", amount: m.bonus, label: `${m.icon} ${m.label} Milestone`, timestamp: now, txHash: data.txHash ?? undefined }));
      const label = eligible.length === 1
        ? `${eligible[0].icon} ${eligible[0].label} NFT claimed! +${eligible[0].bonus} VRYF`
        : `${eligible.length} milestone NFTs claimed! +${totalBonus} VRYF`;
      showToast(label, "success");
      // Store milestone token IDs for persistent "Add to MetaMask" buttons, then prompt wallet
      if (data.tokenIds?.length) {
        setMilestoneNftIds((prev) => {
          const next = { ...prev };
          eligible.forEach((m, i) => { if (data.tokenIds[i] != null) next[m.threshold] = String(data.tokenIds[i]); });
          return next;
        });
        for (const tid of data.tokenIds) promptAddNft(contractAddress, String(tid));
      }
      refetchVryf().catch(() => {});
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      if (msg.includes("User rejected") || msg.includes("denied")) {
        showToast("Milestone claim cancelled", "error");
      } else {
        showToast(`Claim failed: ${msg}`, "error");
      }
    } finally {
      setIsMilestoneLoading(false);
    }
  }, [chainId, address, signTypedDataAsync, showToast, refetchVryf, userCheckins, claimedMilestones]);

  // ─── Wallet button ──────────────────────────────────────────────────────────

  const handleWalletClick = useCallback(() => {
    if (!isConnected) {
      openConnectModal?.();
    } else {
      setWalletMenuOpen((prev) => !prev);
    }
  }, [isConnected, openConnectModal]);

  const handleDisconnect = useCallback(() => {
    disconnect();
    setWalletMenuOpen(false);
    showToast("Wallet disconnected", "");
  }, [disconnect, showToast]);

  // ─── Reset everything ────────────────────────────────────────────────────────

  const handleReset = useCallback(async () => {
    if (!window.confirm("Deploy new contracts on-chain? This will reset all data and cannot be undone.")) return;

    showToast("Deploying fresh contracts on-chain… please wait", "");

    // Deploy new contracts via backend, get new addresses
    let newContractAddress: string | null = null;
    let newVryfAddress: string | null = null;
    try {
      const res = await fetch(`${BACKEND}/api/relay/reset`, { method: "POST" });
      const data = await res.json();
      if (data.contractAddress) newContractAddress = data.contractAddress;
      if (data.vryfTokenAddress) newVryfAddress = data.vryfTokenAddress;
    } catch { /* backend unreachable — proceed with local reset only */ }

    // Clear all vryfd localStorage keys then restore version tag + reset timestamp.
    // vryfd_reset_at is used to filter out pre-reset certificates so they don't
    // reappear when the user navigates to the Certificates tab post-reset.
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("vryfd_")) localStorage.removeItem(key);
    });
    localStorage.setItem("vryfd_data_version", DATA_VERSION);
    localStorage.setItem("vryfd_reset_at", Math.floor(Date.now() / 1000).toString());
    // Store new contract addresses so wagmiConfig picks them up on reload
    if (newContractAddress) localStorage.setItem("vryfd_contract_address", newContractAddress);
    if (newVryfAddress) localStorage.setItem("vryfd_vryf_token_address", newVryfAddress);
    // Prompt MetaMask to add the new VRYF ERC-20 token — fire-and-forget so it never
    // blocks disconnect() or window.location.reload() below.
    if (newVryfAddress && typeof window !== "undefined" && (window as any).ethereum) {
      (window as any).ethereum.request({
        method: "wallet_watchAsset",
        params: { type: "ERC20", options: { address: newVryfAddress, symbol: "VRYF", decimals: 18 } },
      }).catch(() => {});
    }
    // Strip deployment info so all events appear undeployed/upcoming after reset.
    // onChainId/deployTxHash are omitted (undefined → stripped by JSON.stringify).
    const freshEvents: VEvent[] = INITIAL_EVENTS.map((ev) => ({
      ...ev, onChainId: undefined, deployTxHash: undefined, status: "upcoming" as const,
    }));
    localStorage.setItem("vryfd_all_events", JSON.stringify(freshEvents));

    hydratedRef.current = false;
    skipNextSaveRef.current = false;
    setUserCheckins(0);
    setUserBadges([]);
    setUserVryfBalance(0);
    setClaimedMilestones([]);
    setVryfHistory([]);
    setBadgeBlockNums({});
    setBadgeMintTimes({});
    setBadgeTokenIds({});
    setMilestoneNftIds({});
    setCheckinStep(0);
    setIsMinting(false);
    setLastCheckinTxHash(undefined);
    setCurrentEventId(null);
    setEvents(freshEvents);
    setLeaderboard(LEADERBOARD_DATA);
    setUserCertificates([]);
    setCheckedInIds([]);
    setPendingRegistrationIds([]);
    setManualEns("");
    setManualEnsStatus("idle");
    if (manualEnsKey) localStorage.removeItem(manualEnsKey);
    if (ensKey) localStorage.removeItem(ensKey);
    setEnsUnlinked(false);
    // Clear syncedAddressRef so syncChainData re-runs on next render (re-syncs chain state after reset).
    // postResetRef suppresses any in-flight refreshCertificates calls.
    postResetRef.current = true;
    syncedAddressRef.current = undefined;
    disconnect();
    // Reload so wagmiConfig picks up new contract addresses from localStorage
    window.location.reload();
  }, [showToast, disconnect]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const close = () => setWalletMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [walletMenuOpen]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const pages = ["dashboard", "events", "badges", "vryf", "leaderboard", "certificate", "organizer"];
  const pageLabels = ["Dashboard", "Events", "Badges", "VRYF Token", "Leaderboard", "Certificates", "⚙ Organizer"];
  const mobileNavIcons = ["🏠", "📅", "🎖️", "🪙", "🏆", "📜", "⚙️"];
  const mobileNavLabels = ["Home", "Events", "Badges", "VRYF", "Board", "Certs", "Org"];

  if (!isConnected) {
    return (
      <div className="wallet-gate">
        <div className="wallet-gate-icon">⬡</div>
        <h1 className="wallet-gate-title">Connect Your Wallet</h1>
        <p className="wallet-gate-sub">Sign in with your Web3 wallet to access VRYFD. Your wallet is your identity — no passwords needed.</p>
        <button type="button" className="wallet-gate-btn" onClick={() => openConnectModal?.()}>
          <span>Connect Wallet</span>
          <span>→</span>
        </button>
        <div className="wallet-gate-hint">Supports MetaMask, WalletConnect &amp; more</div>
        <a href="/" className="wallet-gate-back">← Back to Home</a>
      </div>
    );
  }

  return (
    <>
      {/* Navbar */}
      <nav className="nav">
        <div className="nav-left">
          <div className="nav-brand">VRYFD</div>
          <button type="button" className="btn-reset" onClick={handleReset} title="Deploy new contracts on-chain">
            ↺ Reset
          </button>
        </div>
        <div className="nav-links">
          {pages.map((p, i) => (
            <button
              key={p}
              type="button"
              className={`nav-link${currentPage === p ? " active" : ""}`}
              onClick={() => showPage(p)}
            >
              {pageLabels[i]}
            </button>
          ))}
        </div>
        <div className="wallet-menu-wrap">
          <button
            type="button"
            className={`wallet-btn${isConnected ? " connected" : ""}`}
            onClick={handleWalletClick}
          >
            <span className="wallet-dot" />
            {isConnected ? (
              <span>{effectiveENS || userAddress}</span>
            ) : (
              <span>Connect Wallet</span>
            )}
          </button>
          {walletMenuOpen && isConnected && (
            <div className="wallet-dropdown">
              <button
                type="button"
                className="wallet-disconnect-btn"
                onClick={handleDisconnect}
              >
                ⏻ Disconnect
              </button>
            </div>
          )}
        </div>
      </nav>

      {/* Main content */}
      <div className="container">
        <div className={`page${currentPage === "dashboard" ? " active" : ""}`}>
          <Dashboard
            events={displayEvents}
            userCheckins={userCheckins}
            userBadges={userBadges}
            deployedEventIds={deployedEventIds}
            isConnected={isConnected}
            vryfBalance={userVryfBalance}
            onOpenEvent={openEvent}
          />
        </div>

        <div className={`page${currentPage === "events" ? " active" : ""}`}>
          {mountedPages.has("events") && (
            <EventsPage
              events={displayEvents}
              currentEventId={currentEventId}
              checkinStep={checkinStep}
              isMinting={isMinting}
              isConnected={isConnected}
              userBadges={userBadges}
              userAddress={userAddress}
              userENS={userENS}
              deployedEventIds={deployedEventIds}
              onChainEventIds={onChainEventIds}
              lastTxHash={lastCheckinTxHash}
              joinCode={joinCode}
              isJoinCodeLoading={isJoinCodeLoading}
              pendingRegistrationIds={pendingRegistrationIds}
              onJoinCodeChange={setJoinCode}
              onJoinCodeCheckin={doJoinCodeCheckin}
              onCheckPendingStatus={checkPendingStatus}
              onCheckin={doCheckin}
              onSelectEvent={openEvent}
              manualEns={manualEns}
              manualEnsStatus={manualEnsStatus}
              onManualEnsChange={(val) => { setManualEns(val); setManualEnsStatus("idle"); }}
              onVerifyEns={handleVerifyEns}
              onUnlinkEns={() => {
                setManualEns(""); setManualEnsStatus("idle");
                if (manualEnsKey) localStorage.removeItem(manualEnsKey);
                setEnsUnlinked(true);
                if (ensKey) localStorage.setItem(ensKey, "1");
              }}
            />
          )}
        </div>

        <div className={`page${currentPage === "badges" ? " active" : ""}`}>
          {mountedPages.has("badges") && (
            <BadgesPage
              events={displayEvents}
              userCheckins={userCheckins}
              userBadges={userBadges}
              isConnected={isConnected}
              claimedMilestones={claimedMilestones}
              isMilestoneLoading={isMilestoneLoading}
              badgeTokenIds={badgeTokenIds}
              milestoneNftIds={milestoneNftIds}
              onClaimMilestone={handleClaimMilestone}
              onAddNftToWallet={(tokenId) => promptAddNft(CONTRACT_ADDRESSES[chainId] ?? CONTRACT_ADDRESSES[11155111], tokenId)}
            />
          )}
        </div>

        <div className={`page${currentPage === "vryf" ? " active" : ""}`}>
          {mountedPages.has("vryf") && (
            <VRYFPage
              balance={userVryfBalance}
              onChainBalance={vryfOnChain !== undefined ? Number(vryfOnChain) / 1e18 : null}
              history={vryfHistory}
              isConnected={isConnected}
              vryfTokenAddress={vryfTokenAddress}
            />
          )}
        </div>

        <div className={`page${currentPage === "leaderboard" ? " active" : ""}`}>
          {mountedPages.has("leaderboard") && (
            <LeaderboardPage leaderboard={liveLeaderboard} userENS={effectiveENS} isConnected={isConnected} />
          )}
        </div>

        <div className={`page${currentPage === "certificate" ? " active" : ""}`}>
          {mountedPages.has("certificate") && (
            <CertificatePage
              events={displayEvents}
              userBadges={userBadges}
              badgeBlockNums={badgeBlockNums}
              badgeMintTimes={badgeMintTimes}
              userENS={effectiveENS}
              isConnected={isConnected}
              onToast={showToast}
              userCertificates={userCertificates}
              checkedInIds={checkedInIds}
              onChainEventIds={onChainEventIds}
              walletAddress={address}
            />
          )}
        </div>

        <div className={`page${currentPage === "organizer" ? " active" : ""}`}>
          {mountedPages.has("organizer") && (
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
          )}
        </div>
      </div>

      {/* Mobile bottom navigation */}
      <nav className="mobile-nav">
        <div className="mobile-nav-inner">
          {pages.map((p, i) => (
            <button
              key={p}
              type="button"
              className={`mobile-nav-item${currentPage === p ? " active" : ""}`}
              onClick={() => showPage(p)}
            >
              <span className="mobile-nav-icon">{mobileNavIcons[i]}</span>
              <span>{mobileNavLabels[i]}</span>
            </button>
          ))}
        </div>
      </nav>

      {/* Toast */}
      <div className={`toast${toast.visible ? " show" : ""}${toast.type ? " " + toast.type : ""}`}>
        {toast.type === "success" ? "✓ " : toast.type === "error" ? "✗ " : "● "}
        {toast.message}
      </div>
    </>
  );
}
