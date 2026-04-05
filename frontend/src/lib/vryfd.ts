export interface VEvent {
  id: number;
  name: string;
  date: string;
  status: "live" | "upcoming" | "ended";
  attendees: number;
  emoji: string;
  color: string;
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

export const INITIAL_EVENTS: VEvent[] = [
  { id: 0, name: "IIIT Sricity Hackathon 2026", date: "Apr 12, 2026", status: "live", attendees: 47, emoji: "💻", color: "#7c6cf0" },
  { id: 1, name: "Web3 Workshop: Smart Contracts", date: "Apr 15, 2026", status: "live", attendees: 32, emoji: "⚡", color: "#34d399" },
  { id: 2, name: "Blockchain & Beyond Seminar", date: "Apr 20, 2026", status: "upcoming", attendees: 0, emoji: "🌐", color: "#fbbf24" },
  { id: 3, name: "DeFi Deep Dive Night", date: "Apr 28, 2026", status: "upcoming", attendees: 0, emoji: "🌙", color: "#f87171" },
];

export const LEADERBOARD_DATA: LBEntry[] = [
  { ens: "mouni.eth", addr: "0xAb5...9eF1", count: 23, tier: "Gold Legend" },
  { ens: "akhil.eth", addr: "0x71C...976F", count: 0, tier: "Newcomer" },
  { ens: "ravi.eth", addr: "0x3F2...7bC4", count: 17, tier: "Silver Pioneer" },
  { ens: "priya.eth", addr: "0xD81...2aE8", count: 14, tier: "Silver Pioneer" },
  { ens: "deepak.eth", addr: "0x92A...5cD3", count: 9, tier: "Bronze Explorer" },
  { ens: "ananya.eth", addr: "0xF47...8eA1", count: 7, tier: "Bronze Explorer" },
  { ens: "kiran.eth", addr: "0x6B3...1fF9", count: 6, tier: "Bronze Explorer" },
  { ens: "sneha.eth", addr: "0xC29...4dB7", count: 4, tier: "Newcomer" },
  { ens: "arjun.eth", addr: "0x8E1...6aC2", count: 3, tier: "Newcomer" },
  { ens: "meera.eth", addr: "0x5D4...0bE5", count: 1, tier: "Newcomer" },
];
