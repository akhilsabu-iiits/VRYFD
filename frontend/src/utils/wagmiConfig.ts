import { connectorsForWallets } from "@rainbow-me/rainbowkit";
import {
  metaMaskWallet,
  injectedWallet,
  rainbowWallet,
  walletConnectWallet,
  coinbaseWallet,
} from "@rainbow-me/rainbowkit/wallets";
import { sepolia, mainnet, gnosis, polygon, hardhat } from "wagmi/chains";
import { http, createConfig } from "wagmi";
import { defineChain } from "viem";

export {
  CONTRACT_ADDRESSES,
  getContractAddresses,
  hasValidAddresses,
  getBlockExplorerUrl,
  getTxExplorerUrl,
} from "../config/contracts";

export const VRYF_TOKEN_ADDRESS: `0x${string}` = (
  typeof window !== "undefined" && localStorage.getItem("vryfd_vryf_token_address")?.startsWith("0x")
    ? localStorage.getItem("vryfd_vryf_token_address")
    : process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS ||
      process.env.NEXT_PUBLIC_SEPOLIA_VRYF_TOKEN_ADDRESS ||
      "0x0000000000000000000000000000000000000000"
) as `0x${string}`;

// Gnosis Chiado testnet (not in wagmi/chains by default)
export const gnosisChiado = defineChain({
  id: 10200,
  name: "Gnosis Chiado Testnet",
  nativeCurrency: { decimals: 18, name: "Chiado xDAI", symbol: "xDAI" },
  rpcUrls: {
    default: { http: ["https://rpc.chiadochain.net"] },
    public: { http: ["https://rpc.chiadochain.net"] },
  },
  blockExplorers: { default: { name: "Blockscout", url: "https://gnosis-chiado.blockscout.com" } },
  testnet: true,
});

// WalletConnect project ID is OPTIONAL.
// Without it: MetaMask + browser-injected wallets still work (PRD attendee flow).
// With it: WalletConnect mobile wallets, Rainbow, Coinbase Wallet also work.
// Get a free one at https://cloud.reown.com/
const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;

const supportsWalletConnect = !!walletConnectProjectId && walletConnectProjectId !== "development_placeholder";

if (!supportsWalletConnect && typeof window !== "undefined") {
  // eslint-disable-next-line no-console
  console.info(
    "[wagmi] WalletConnect disabled (no NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID). MetaMask + injected wallets still work."
  );
}

// Build connector list dynamically — only include WalletConnect-based wallets
// when we have a real project ID to avoid the 403 / 'invalid key' crash.
const connectors = connectorsForWallets(
  [
    {
      groupName: "Recommended",
      wallets: supportsWalletConnect
        ? [metaMaskWallet, rainbowWallet, walletConnectWallet, coinbaseWallet, injectedWallet]
        : [metaMaskWallet, injectedWallet],
    },
  ],
  {
    appName: "VRYFD Attendance",
    // Project ID must be a string; we pass a placeholder when WC is disabled
    // (the connectors list above won't include any WC wallet so the value is unused).
    projectId: walletConnectProjectId || "vryfd-no-wc",
  }
);

export const config = createConfig({
  connectors,
  chains: [sepolia, gnosis, polygon, gnosisChiado, hardhat, mainnet],
  transports: {
    [sepolia.id]: http(process.env.NEXT_PUBLIC_RPC_URL || "https://rpc.sepolia.org"),
    [gnosis.id]: http(process.env.NEXT_PUBLIC_GNOSIS_RPC_URL || "https://rpc.gnosischain.com"),
    [polygon.id]: http(process.env.NEXT_PUBLIC_POLYGON_RPC_URL || "https://polygon-rpc.com"),
    [gnosisChiado.id]: http(process.env.NEXT_PUBLIC_CHIADO_RPC_URL || "https://rpc.chiadochain.net"),
    [hardhat.id]: http("http://127.0.0.1:8545"),
    [mainnet.id]: http("https://eth.llamarpc.com"),
  },
  ssr: true,
});

export const SUPPORTED_CHAIN_IDS = [sepolia.id, gnosis.id, polygon.id, gnosisChiado.id, hardhat.id];

export const DEFAULT_CHAIN_ID = sepolia.id;

export const CHAIN_METADATA = {
  [sepolia.id]: { name: "Sepolia Testnet", shortName: "Sepolia", icon: "🔵", color: "#627EEA", isPrimary: true },
  [gnosis.id]: { name: "Gnosis Chain", shortName: "Gnosis", icon: "🟢", color: "#04795B", isPrimary: false },
  [polygon.id]: { name: "Polygon PoS", shortName: "Polygon", icon: "🟣", color: "#8247E5", isPrimary: false },
  [gnosisChiado.id]: { name: "Gnosis Chiado", shortName: "Chiado", icon: "🟢", color: "#04795B", isPrimary: false },
};
