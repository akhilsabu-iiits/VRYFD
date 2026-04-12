import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia, mainnet } from "wagmi/chains";
import { http } from "wagmi";

// NOTE: NEXT_PUBLIC_ALCHEMY_API_KEY is intentionally NOT used here.
// Embedding an Alchemy key in the browser bundle exposes it to anyone who
// inspects the page source. All ENS lookups go through the backend proxy
// (/api/relay/ens/:address) where the key stays server-side.
// For Sepolia RPC we use the public endpoint — adequate for a testnet dApp.
// If you need a private Sepolia RPC, add a Next.js API route that proxies
// calls to Alchemy using a server-only env var (no NEXT_PUBLIC_ prefix).

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
if (!walletConnectProjectId) {
  throw new Error("NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is not set. Add it to your .env file.");
}

export const config = getDefaultConfig({
  appName: "VRYFD Attendance",
  projectId: walletConnectProjectId,
  // mainnet is included for ENS name display inside RainbowKit — actual ENS
  // resolution for the app goes through the backend proxy, not the client.
  chains: [sepolia, mainnet],
  transports: {
    [sepolia.id]: http("https://rpc.sepolia.org"),
    [mainnet.id]: http("https://eth.llamarpc.com"),
  },
  ssr: true,
});

/**
 * Contract addresses (Sepolia)
 * Reads from localStorage first (updated after reset/redeploy), falls back to env var.
 */
function getStoredAddress(key: string, envVal: string | undefined): `0x${string}` {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem(key);
    if (stored && stored.startsWith("0x")) return stored as `0x${string}`;
  }
  return (envVal as `0x${string}`) || "0x0000000000000000000000000000000000000000";
}

export const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: getStoredAddress("vryfd_contract_address", process.env.NEXT_PUBLIC_CONTRACT_ADDRESS),
};

export const VRYF_TOKEN_ADDRESS: `0x${string}` = getStoredAddress(
  "vryfd_vryf_token_address",
  process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS,
);
