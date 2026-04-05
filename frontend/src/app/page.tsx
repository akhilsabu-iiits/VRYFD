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

// ─── Component ────────────────────────────────────────────────────────────────

export default function Home() {
  const { address, isConnected } = useAccount();
  const { data: ensName } = useEnsName({ address, chainId: 1 });
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);

  const [currentPage, setCurrentPage] = useState<string>("dashboard");
  const [events, setEvents] = useState<VEvent[]>(INITIAL_EVENTS);
  const [userCheckins, setUserCheckins] = useState(0);
  const [userBadges, setUserBadges] = useState<number[]>([]);
  const [currentEventId, setCurrentEventId] = useState<number | null>(null);
  const [checkinStep, setCheckinStep] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LBEntry[]>(LEADERBOARD_DATA);
  const [toast, setToast] = useState<ToastState>({ message: "", type: "", visible: false });
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    if (!walletMenuOpen) return;
    const close = () => setWalletMenuOpen(false);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [walletMenuOpen]);

  // ─── Render ─────────────────────────────────────────────────────────────────

  const pages = ["dashboard", "events", "badges", "leaderboard", "certificate"];
  const pageLabels = ["Dashboard", "Events", "Badges", "Leaderboard", "Certificates"];

  return (
    <>
      {/* Navbar */}
      <nav className="nav">
        <div className="nav-brand">VRYFD</div>
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
        <div style={{ position: "relative" }}>
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
            <div style={{
              position: "absolute", right: 0, top: "calc(100% + 8px)",
              background: "var(--bg2)", border: "1px solid var(--border2)",
              borderRadius: "var(--radius-sm)", minWidth: "160px",
              zIndex: 200, overflow: "hidden",
            }}>
              <button
                type="button"
                onClick={handleDisconnect}
                style={{
                  width: "100%", padding: "10px 16px", background: "none",
                  border: "none", color: "var(--coral)", fontSize: "13px",
                  fontWeight: 500, cursor: "pointer", textAlign: "left",
                  fontFamily: "inherit",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg3)")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "none")}
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
            events={events}
            userCheckins={userCheckins}
            userBadges={userBadges}
            onOpenEvent={openEvent}
          />
        </div>

        <div className={`page${currentPage === "events" ? " active" : ""}`}>
          <EventsPage
            events={events}
            currentEventId={currentEventId}
            checkinStep={checkinStep}
            isConnected={isConnected}
            userBadges={userBadges}
            userAddress={userAddress}
            userENS={userENS}
            onCheckin={doCheckin}
          />
        </div>

        <div className={`page${currentPage === "badges" ? " active" : ""}`}>
          <BadgesPage
            events={events}
            userCheckins={userCheckins}
            userBadges={userBadges}
          />
        </div>

        <div className={`page${currentPage === "leaderboard" ? " active" : ""}`}>
          <LeaderboardPage leaderboard={leaderboard} userENS={userENS} />
        </div>

        <div className={`page${currentPage === "certificate" ? " active" : ""}`}>
          <CertificatePage
            events={events}
            userBadges={userBadges}
            userENS={userENS}
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
