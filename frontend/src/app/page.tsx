"use client";

import React, { useState, useCallback, useRef, useEffect } from "react";
import { useAccount, useDisconnect } from "wagmi";
import { useEnsName } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import Dashboard from "../components/Dashboard";
import EventsPage from "../components/EventsPage";
import BadgesPage from "../components/BadgesPage";
import LeaderboardPage from "../components/LeaderboardPage";
import CertificatePage from "../components/CertificatePage";
import OrganizerPage from "../components/OrganizerPage";
import { type VEvent, type LBEntry, type ToastState, INITIAL_EVENTS, LEADERBOARD_DATA } from "../lib/vryfd";

// ─── Helper ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function getTier(checkins: number): string {
  if (checkins >= 20) return "Gold Legend";
  if (checkins >= 10) return "Silver Pioneer";
  if (checkins >= 5) return "Bronze Explorer";
  return "Newcomer";
}

// Events that are live by default (pre-deployed) — always present, never reset
const DEFAULT_DEPLOYED: Record<number, number> = { 0: 1, 1: 2 };
const DEFAULT_TX_HASHES: Record<number, string> = {};

// ─── Per-wallet localStorage helpers (outside component) ─────────────────────

function loadWalletData(addr: string): { checkins: number; badges: number[] } {
  try {
    const raw = localStorage.getItem(`vryfd_wallet_${addr}`);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { checkins: 0, badges: [] };
}

function saveWalletData(addr: string, checkins: number, badges: number[]) {
  localStorage.setItem(`vryfd_wallet_${addr}`, JSON.stringify({ checkins, badges }));
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const { address, isConnected } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: 1 });
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState<string>("dashboard");
  const [currentEventId, setCurrentEventId] = useState<number | null>(null);
  const [checkinStep, setCheckinStep] = useState(0);
  const [toast, setToast] = useState<ToastState>({ message: "", type: "", visible: false });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [userCheckins, setUserCheckins] = useState(0);
  const [userBadges, setUserBadges] = useState<number[]>([]);

  // Use a ref to hold current address for the save effect (avoids stale closure)
  const addressRef = useRef<string | undefined>(undefined);
  // Skip saving immediately after loading (prevents overwriting stored data with stale zeros)
  const skipNextSaveRef = useRef(false);
  // Prevents save effects from firing before localStorage has been hydrated
  const hydratedRef = useRef(false);

  // Start with defaults to avoid SSR/client hydration mismatch; load persisted counts after mount
  // Status is NOT stored — it is derived from deployedEventIds (deployed = live)
  const [events, setEvents] = useState<VEvent[]>(INITIAL_EVENTS);

  const [leaderboard, setLeaderboard] = useState<LBEntry[]>(LEADERBOARD_DATA);

  const [deployedEventIds, setDeployedEventIds] = useState<Record<number, number>>({});
  const [txHashes, setTxHashes] = useState<Record<number, string>>({ ...DEFAULT_TX_HASHES });

  // Hydrate localStorage-backed state after mount (avoids SSR hydration mismatch)
  useEffect(() => {
    try {
      const saved = localStorage.getItem("vryfd_event_attendees");
      if (saved) {
        const data: Record<number, number> = JSON.parse(saved);
        setEvents(INITIAL_EVENTS.map((ev) =>
          data[ev.id] !== undefined ? { ...ev, attendees: data[ev.id] } : ev
        ));
      }
    } catch {}
    try {
      const saved = localStorage.getItem("vryfd_deployed_events");
      const stored: Record<number, number> = saved ? JSON.parse(saved) : {};
      setDeployedEventIds({ ...DEFAULT_DEPLOYED, ...stored });
    } catch {}
    try {
      const saved = localStorage.getItem("vryfd_tx_hashes");
      const stored: Record<number, string> = saved ? JSON.parse(saved) : {};
      setTxHashes({ ...DEFAULT_TX_HASHES, ...stored });
    } catch {}
    hydratedRef.current = true;
  }, []);

  // Load wallet-specific data when address changes
  useEffect(() => {
    addressRef.current = address;
    if (address) {
      skipNextSaveRef.current = true;
      const data = loadWalletData(address);
      setUserCheckins(data.checkins);
      setUserBadges(data.badges);
      setCheckinStep(0);
      setCurrentEventId(null);
    } else {
      // Wallet disconnected — clear all user state
      skipNextSaveRef.current = false;
      setUserCheckins(0);
      setUserBadges([]);
      setCheckinStep(0);
      setCurrentEventId(null);
      setLeaderboard(LEADERBOARD_DATA);
    }
  }, [address]);

  // Save wallet-specific data whenever checkins or badges change
  // Does NOT depend on address to avoid firing with stale values on connect
  useEffect(() => {
    if (skipNextSaveRef.current) {
      skipNextSaveRef.current = false;
      return;
    }
    if (!addressRef.current) return;
    saveWalletData(addressRef.current, userCheckins, userBadges);
  }, [userCheckins, userBadges]);

  // Persist attendee counts only (status is derived from deployedEventIds)
  useEffect(() => {
    if (!hydratedRef.current) return;
    const data: Record<number, number> = {};
    events.forEach((ev) => { data[ev.id] = ev.attendees; });
    localStorage.setItem("vryfd_event_attendees", JSON.stringify(data));
  }, [events]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    localStorage.setItem("vryfd_deployed_events", JSON.stringify(deployedEventIds));
  }, [deployedEventIds]);

  useEffect(() => {
    if (!hydratedRef.current) return;
    localStorage.setItem("vryfd_tx_hashes", JSON.stringify(txHashes));
  }, [txHashes]);

  const handleEventDeployed = useCallback((demoId: number, onChainId: number, txHash: string) => {
    setDeployedEventIds((prev) => {
      // If already has a display ID (e.g. DEFAULT_DEPLOYED), keep it — only assign new ID for new events
      if (demoId in prev) return prev;
      const existingDisplayIds = Object.values(prev);
      const nextDisplayId = existingDisplayIds.length > 0 ? Math.max(...existingDisplayIds) + 1 : 3;
      return { ...prev, [demoId]: nextDisplayId };
    });
    setTxHashes((prev) => ({ ...DEFAULT_TX_HASHES, ...prev, [demoId]: txHash }));
  }, []);

  // Derive event status from deployedEventIds — deployed = live, otherwise keep original
  const displayEvents = events.map((ev) =>
    ev.id in deployedEventIds ? { ...ev, status: "live" as const } : ev
  );

  const userENS = ensName ?? (isConnected ? "akhil.eth" : "");
  const userAddress = address
    ? `${address.slice(0, 6)}...${address.slice(-4)}`
    : "";

  // ─── Toast ──────────────────────────────────────────────────────────────────

  const showToast = useCallback((message: string, type: "success" | "error" | "") => {
    setToast({ message, type, visible: true });
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => {
      setToast((prev) => ({ ...prev, visible: false }));
    }, 3500);
  }, []);

  // ─── Navigation ─────────────────────────────────────────────────────────────

  const showPage = useCallback((name: string) => {
    setCurrentPage(name);
  }, []);

  // ─── Open event ─────────────────────────────────────────────────────────────

  const openEvent = useCallback(
    (id: number) => {
      setCurrentEventId(id);
      setCurrentPage("events");
      setCheckinStep(isConnected ? 1 : 0);
    },
    [isConnected]
  );

  // ─── Check-in flow ──────────────────────────────────────────────────────────

  const doCheckin = useCallback(async () => {
    if (!isConnected) {
      openConnectModal?.();
      return;
    }

    if (checkinStep <= 1) {
      setCheckinStep(2);
      showToast("Signing EIP-712 typed data...", "");

      await sleep(1500);

      const newCheckins = userCheckins + 1;
      setUserCheckins(newCheckins);
      setCheckinStep(3);

      // Update event attendees
      if (currentEventId !== null) {
        setEvents((prev) =>
          prev.map((ev) =>
            ev.id === currentEventId
              ? { ...ev, attendees: ev.attendees + 1 }
              : ev
          )
        );
      }

      // Update leaderboard entry for current user
      const newTier = getTier(newCheckins);
      setLeaderboard((prev) =>
        prev.map((entry) =>
          entry.ens === userENS
            ? { ...entry, count: newCheckins, tier: newTier }
            : entry
        )
      );

      const blockNum = 48291000 + Math.floor(Math.random() * 999);
      showToast(`Attendance confirmed on Sepolia! Block #${blockNum}`, "success");
    } else if (checkinStep === 3) {
      setCheckinStep(4);
      showToast("Minting soulbound POAP badge...", "");

      await sleep(1200);

      if (currentEventId !== null) {
        setUserBadges((prev) =>
          prev.includes(currentEventId) ? prev : [...prev, currentEventId]
        );
      }
      showToast("POAP Badge minted! It's now in your wallet.", "success");
    }
  }, [
    isConnected,
    openConnectModal,
    checkinStep,
    userCheckins,
    currentEventId,
    userENS,
    showToast,
  ]);

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

  const handleReset = useCallback(() => {
    if (!window.confirm("Reset all data to initial values? This cannot be undone.")) return;
    // Clear all vryfd localStorage keys
    Object.keys(localStorage).forEach((key) => {
      if (key.startsWith("vryfd_")) localStorage.removeItem(key);
    });
    // Reset all state
    hydratedRef.current = false;
    setUserCheckins(0);
    setUserBadges([]);
    setCheckinStep(0);
    setCurrentEventId(null);
    setEvents(INITIAL_EVENTS);
    setLeaderboard(LEADERBOARD_DATA);
    setDeployedEventIds({ ...DEFAULT_DEPLOYED });
    setTxHashes({ ...DEFAULT_TX_HASHES });
    setCurrentPage("dashboard");
    hydratedRef.current = true;
    showToast("All data reset to initial values", "");
  }, [showToast]);

  useEffect(() => {
    if (!walletMenuOpen) return;
    const close = () => setWalletMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [walletMenuOpen]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const pages = ["dashboard", "events", "badges", "leaderboard", "certificate", "organizer"];
  const pageLabels = ["Dashboard", "Events", "Badges", "Leaderboard", "Certificates", "⚙ Organizer"];

  return (
    <>
      {/* Navbar */}
      <nav className="nav">
        <div className="nav-left">
          <div className="nav-brand">VRYFD</div>
          <button type="button" className="btn-reset" onClick={handleReset} title="Reset all data">
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
              <span>{userENS || userAddress}</span>
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
            onOpenEvent={openEvent}
          />
        </div>

        <div className={`page${currentPage === "events" ? " active" : ""}`}>
          <EventsPage
            events={displayEvents}
            currentEventId={currentEventId}
            checkinStep={checkinStep}
            isConnected={isConnected}
            userBadges={userBadges}
            userAddress={userAddress}
            userENS={userENS}
            deployedEventIds={deployedEventIds}
            onCheckin={doCheckin}
          />
        </div>

        <div className={`page${currentPage === "badges" ? " active" : ""}`}>
          <BadgesPage
            events={displayEvents}
            userCheckins={userCheckins}
            userBadges={userBadges}
            isConnected={isConnected}
          />
        </div>

        <div className={`page${currentPage === "leaderboard" ? " active" : ""}`}>
          <LeaderboardPage leaderboard={leaderboard} userENS={userENS} />
        </div>

        <div className={`page${currentPage === "certificate" ? " active" : ""}`}>
          <CertificatePage
            events={displayEvents}
            userBadges={userBadges}
            userENS={userENS}
            isConnected={isConnected}
            onToast={showToast}
          />
        </div>

        <div className={`page${currentPage === "organizer" ? " active" : ""}`}>
          <OrganizerPage
            deployedEventIds={deployedEventIds}
            txHashes={txHashes}
            onEventDeployed={handleEventDeployed}
            onToast={showToast}
          />
        </div>
      </div>

      {/* Toast */}
      <div className={`toast${toast.visible ? " show" : ""}${toast.type ? " " + toast.type : ""}`}>
        {toast.type === "success" ? "✓ " : toast.type === "error" ? "✗ " : "● "}
        {toast.message}
      </div>
    </>
  );
}
