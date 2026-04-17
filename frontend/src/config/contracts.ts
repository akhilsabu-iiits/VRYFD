/**
 * Multi-Chain Contract Addresses Configuration
 * 
 * This file stores contract addresses for each supported chain.
 * Update these addresses after deploying contracts to each network.
 */

export interface ChainContracts {
  VryfdAttendance: `0x${string}`;
  VRYFToken: `0x${string}`;
}

/**
 * Contract addresses per chain ID
 * 
 * Chain IDs:
 * - 100: Gnosis Chain (Primary - lowest fees)
 * - 137: Polygon PoS (Secondary - wider adoption)
 * - 11155111: Sepolia Testnet (Development)
 * - 10200: Gnosis Chiado Testnet (Development)
 */
export const CONTRACT_ADDRESSES: Record<number, ChainContracts> = {
  // Gnosis Chain (Primary)
  100: {
    VryfdAttendance: (process.env.NEXT_PUBLIC_GNOSIS_ATTENDANCE_ADDRESS as `0x${string}`) || 
                     "0x0000000000000000000000000000000000000000",
    VRYFToken: (process.env.NEXT_PUBLIC_GNOSIS_VRYF_TOKEN_ADDRESS as `0x${string}`) || 
               "0x0000000000000000000000000000000000000000",
  },
  // Polygon PoS (Secondary)
  137: {
    VryfdAttendance: (process.env.NEXT_PUBLIC_POLYGON_ATTENDANCE_ADDRESS as `0x${string}`) || 
                     "0x0000000000000000000000000000000000000000",
    VRYFToken: (process.env.NEXT_PUBLIC_POLYGON_VRYF_TOKEN_ADDRESS as `0x${string}`) || 
               "0x0000000000000000000000000000000000000000",
  },
  // Sepolia Testnet
  11155111: {
    VryfdAttendance: (process.env.NEXT_PUBLIC_SEPOLIA_ATTENDANCE_ADDRESS as `0x${string}`) || 
                     (process.env.NEXT_PUBLIC_CONTRACT_ADDRESS as `0x${string}`) || // Backward compatibility
                     "0x0000000000000000000000000000000000000000",
    VRYFToken: (process.env.NEXT_PUBLIC_SEPOLIA_VRYF_TOKEN_ADDRESS as `0x${string}`) || 
               (process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS as `0x${string}`) || // Backward compatibility
               "0x0000000000000000000000000000000000000000",
  },
  // Gnosis Chiado Testnet
  10200: {
    VryfdAttendance: (process.env.NEXT_PUBLIC_CHIADO_ATTENDANCE_ADDRESS as `0x${string}`) || 
                     "0x0000000000000000000000000000000000000000",
    VRYFToken: (process.env.NEXT_PUBLIC_CHIADO_VRYF_TOKEN_ADDRESS as `0x${string}`) || 
               "0x0000000000000000000000000000000000000000",
  },
};

/**
 * Get contract addresses for a specific chain
 * @param chainId - The chain ID to get addresses for
 * @returns Contract addresses for the chain, or undefined if not supported
 */
export function getContractAddresses(chainId: number): ChainContracts | undefined {
  return CONTRACT_ADDRESSES[chainId];
}

/**
 * Get VryfdAttendance contract address for a specific chain
 * @param chainId - The chain ID
 * @returns The VryfdAttendance contract address
 */
export function getAttendanceAddress(chainId: number): `0x${string}` {
  const addresses = getContractAddresses(chainId);
  if (!addresses) {
    console.warn(`No contract addresses configured for chain ID ${chainId}`);
    return "0x0000000000000000000000000000000000000000";
  }
  return addresses.VryfdAttendance;
}

/**
 * Get VRYFToken contract address for a specific chain
 * @param chainId - The chain ID
 * @returns The VRYFToken contract address
 */
export function getVRYFTokenAddress(chainId: number): `0x${string}` {
  const addresses = getContractAddresses(chainId);
  if (!addresses) {
    console.warn(`No contract addresses configured for chain ID ${chainId}`);
    return "0x0000000000000000000000000000000000000000";
  }
  return addresses.VRYFToken;
}

/**
 * Check if a chain is supported
 * @param chainId - The chain ID to check
 * @returns True if the chain is supported
 */
export function isChainSupported(chainId: number): boolean {
  return chainId in CONTRACT_ADDRESSES;
}

/**
 * Get all supported chain IDs
 * @returns Array of supported chain IDs
 */
export function getSupportedChainIds(): number[] {
  return Object.keys(CONTRACT_ADDRESSES).map(Number);
}

/**
 * Validate that contract addresses are configured for a chain
 * @param chainId - The chain ID to validate
 * @returns True if valid addresses are configured
 */
export function hasValidAddresses(chainId: number): boolean {
  const addresses = getContractAddresses(chainId);
  if (!addresses) return false;
  
  const isValidAddress = (addr: string) => 
    addr !== "0x0000000000000000000000000000000000000000" && addr.startsWith("0x");
  
  return isValidAddress(addresses.VryfdAttendance) && isValidAddress(addresses.VRYFToken);
}

/**
 * Get block explorer URL for a chain
 * @param chainId - The chain ID
 * @returns Block explorer base URL
 */
export function getBlockExplorerUrl(chainId: number): string {
  const explorers: Record<number, string> = {
    100: "https://gnosisscan.io",
    137: "https://polygonscan.com",
    11155111: "https://sepolia.etherscan.io",
    10200: "https://gnosis-chiado.blockscout.com",
  };
  return explorers[chainId] || "";
}

/**
 * Get block explorer URL for a specific address
 * @param chainId - The chain ID
 * @param address - The contract address
 * @returns Full block explorer URL for the address
 */
export function getAddressExplorerUrl(chainId: number, address: string): string {
  const baseUrl = getBlockExplorerUrl(chainId);
  return baseUrl ? `${baseUrl}/address/${address}` : "";
}

/**
 * Get block explorer URL for a specific transaction
 * @param chainId - The chain ID
 * @param txHash - The transaction hash
 * @returns Full block explorer URL for the transaction
 */
export function getTxExplorerUrl(chainId: number, txHash: string): string {
  const baseUrl = getBlockExplorerUrl(chainId);
  return baseUrl ? `${baseUrl}/tx/${txHash}` : "";
}
