import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { sepolia, mainnet } from "wagmi/chains";

/**
 * Wagmi config with RainbowKit
 * - mainnet is included for ENS resolution (ENS lives on L1)
 * - sepolia for contract interactions and $VRYF token
 */
export const config = getDefaultConfig({
  appName: "VRYFD Attendance",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "YOUR_PROJECT_ID",
  chains: [sepolia, mainnet],
  ssr: true,
});

/**
 * Contract addresses (Sepolia)
 */
const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export const CONTRACT_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`) || ZERO,
};

export const VRYF_TOKEN_ADDRESSES: Record<number, `0x${string}`> = {
  11155111: (process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS as `0x${string}`) || ZERO,
};
