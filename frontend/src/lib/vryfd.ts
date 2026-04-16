export interface VEvent {
  id: number;
  name: string;
  date: string;
  status: "live" | "upcoming" | "ended";
  attendees: number;
  emoji: string;
  color: string;
  startTime?: number;   // unix seconds — set for custom events created via organizer
  endTime?: number;     // unix seconds
  metadataURI?: string;
  joinCode?: string;    // generated at creation time, used for attendee check-in
  onChainId?: number;   // set when deployed — the Sepolia contract event ID
  deployTxHash?: string; // transaction hash of the deploy tx
}

export interface LBEntry {
  ens: string;
  addr: string;
  count: number;
  tier: string;
}

export interface ToastState {
  message: string;
  type: "success" | "error" | "";
  visible: boolean;
}

// All 4 events start as "upcoming" — the organizer deploys each one via the Organizer page.
export const INITIAL_EVENTS: VEvent[] = [
  { id: 1, name: "IIIT Sricity Hackathon 2026",    date: "Apr 12, 2026", status: "upcoming", attendees: 0, emoji: "💻", color: "#7c6cf0", joinCode: "HK7P2T" },
  { id: 2, name: "Web3 Workshop: Smart Contracts",  date: "Apr 15, 2026", status: "upcoming", attendees: 0, emoji: "⚡", color: "#34d399", joinCode: "W5NX4M" },
  { id: 3, name: "Blockchain & Beyond Seminar",     date: "Apr 20, 2026", status: "upcoming", attendees: 0, emoji: "🌐", color: "#fbbf24", joinCode: "B9ZR6Q" },
  { id: 4, name: "DeFi Deep Dive Night",            date: "Apr 28, 2026", status: "upcoming", attendees: 0, emoji: "🌙", color: "#f87171", joinCode: "Y3VJ8F" },
];

export const LEADERBOARD_DATA: LBEntry[] = [
  { ens: "mouni.eth", addr: "0xAb5...9eF1", count: 23, tier: "Gold Legend" },
  { ens: "akhil.eth", addr: "0x2bc1...42F6", count: 0, tier: "Newcomer" },
  { ens: "ganana.eth", addr: "0x3F2...7bC4", count: 17, tier: "Silver Pioneer" },
  { ens: "priya.eth", addr: "0xD81...2aE8", count: 14, tier: "Silver Pioneer" },
  { ens: "deepak.eth", addr: "0x92A...5cD3", count: 9, tier: "Bronze Explorer" },
  { ens: "ananya.eth", addr: "0xF47...8eA1", count: 7, tier: "Bronze Explorer" },
  { ens: "kiran.eth", addr: "0x6B3...1fF9", count: 6, tier: "Bronze Explorer" },
  { ens: "sneha.eth", addr: "0xC29...4dB7", count: 4, tier: "Newcomer" },
  { ens: "arjun.eth", addr: "0x8E1...6aC2", count: 3, tier: "Newcomer" },
  { ens: "meera.eth", addr: "0x5D4...0bE5", count: 1, tier: "Newcomer" },
];
