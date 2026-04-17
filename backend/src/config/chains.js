/**
 * Multi-Chain Configuration for VRYFD Backend
 * 
 * This module provides chain-specific RPC URLs, contract addresses,
 * and helper functions for multi-chain support.
 */

// Chain configurations
const CHAINS = {
  100: {
    name: "Gnosis Chain",
    rpcUrl: process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com",
    contractAddress: process.env.GNOSIS_ATTENDANCE_ADDRESS,
    vryfTokenAddress: process.env.GNOSIS_VRYF_TOKEN_ADDRESS,
    privateKey: process.env.GNOSIS_PRIVATE_KEY,
    explorer: "https://gnosisscan.io",
    isPrimary: true,
  },
  137: {
    name: "Polygon PoS",
    rpcUrl: process.env.POLYGON_RPC_URL || "https://polygon-rpc.com",
    contractAddress: process.env.POLYGON_ATTENDANCE_ADDRESS,
    vryfTokenAddress: process.env.POLYGON_VRYF_TOKEN_ADDRESS,
    privateKey: process.env.POLYGON_PRIVATE_KEY,
    explorer: "https://polygonscan.com",
    isPrimary: false,
  },
  11155111: {
    name: "Sepolia Testnet",
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
    contractAddress: process.env.SEPOLIA_ATTENDANCE_ADDRESS || process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
    vryfTokenAddress: process.env.SEPOLIA_VRYF_TOKEN_ADDRESS || process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS,
    privateKey: process.env.PRIVATE_KEY,
    explorer: "https://sepolia.etherscan.io",
    isPrimary: false,
  },
  10200: {
    name: "Gnosis Chiado Testnet",
    rpcUrl: process.env.CHIADO_RPC_URL || "https://rpc.chiadochain.net",
    contractAddress: process.env.CHIADO_ATTENDANCE_ADDRESS,
    vryfTokenAddress: process.env.CHIADO_VRYF_TOKEN_ADDRESS,
    privateKey: process.env.PRIVATE_KEY,
    explorer: "https://gnosis-chiado.blockscout.com",
    isPrimary: false,
  },
};

/**
 * Get chain configuration by chain ID
 * @param {number} chainId - The chain ID
 * @returns {object|null} Chain configuration or null if not found
 */
function getChainConfig(chainId) {
  return CHAINS[chainId] || null;
}

/**
 * Get all supported chain IDs
 * @returns {number[]} Array of supported chain IDs
 */
function getSupportedChainIds() {
  return Object.keys(CHAINS).map(Number);
}

/**
 * Check if a chain is supported
 * @param {number} chainId - The chain ID to check
 * @returns {boolean} True if the chain is supported
 */
function isChainSupported(chainId) {
  return chainId in CHAINS;
}

/**
 * Get the default/primary chain ID
 * @returns {number} The primary chain ID (Gnosis Chain)
 */
function getDefaultChainId() {
  // Find the primary chain
  for (const [chainId, config] of Object.entries(CHAINS)) {
    if (config.isPrimary) return Number(chainId);
  }
  // Fallback to Gnosis Chain
  return 100;
}

/**
 * Validate that a chain has all required configuration
 * @param {number} chainId - The chain ID to validate
 * @returns {object} Validation result with isValid and missing fields
 */
function validateChainConfig(chainId) {
  const config = getChainConfig(chainId);
  if (!config) {
    return { isValid: false, missing: ["chain not found"] };
  }

  const missing = [];
  if (!config.rpcUrl) missing.push("rpcUrl");
  if (!config.contractAddress) missing.push("contractAddress");
  if (!config.vryfTokenAddress) missing.push("vryfTokenAddress");
  if (!config.privateKey) missing.push("privateKey");

  return {
    isValid: missing.length === 0,
    missing,
  };
}

/**
 * Get all chains with valid configuration
 * @returns {number[]} Array of chain IDs with complete configuration
 */
function getConfiguredChains() {
  return getSupportedChainIds().filter((chainId) => {
    const validation = validateChainConfig(chainId);
    return validation.isValid;
  });
}

/**
 * Get chain ID from request (query param or body)
 * Falls back to default chain if not specified or invalid
 * @param {object} req - Express request object
 * @returns {number} The chain ID to use
 */
function getChainIdFromRequest(req) {
  const chainIdParam = req.query.chainId || req.body.chainId;
  if (chainIdParam) {
    const chainId = Number(chainIdParam);
    if (isChainSupported(chainId)) {
      return chainId;
    }
  }
  return getDefaultChainId();
}

/**
 * Get block explorer URL for an address
 * @param {number} chainId - The chain ID
 * @param {string} address - The address
 * @returns {string} Block explorer URL
 */
function getExplorerAddressUrl(chainId, address) {
  const config = getChainConfig(chainId);
  if (!config) return "";
  return `${config.explorer}/address/${address}`;
}

/**
 * Get block explorer URL for a transaction
 * @param {number} chainId - The chain ID
 * @param {string} txHash - The transaction hash
 * @returns {string} Block explorer URL
 */
function getExplorerTxUrl(chainId, txHash) {
  const config = getChainConfig(chainId);
  if (!config) return "";
  return `${config.explorer}/tx/${txHash}`;
}

/**
 * Log chain configuration status on startup
 */
function logChainStatus() {
  console.log("\n═══════════════════════════════════════════");
  console.log("  Multi-Chain Configuration Status");
  console.log("═══════════════════════════════════════════");
  
  const supportedChains = getSupportedChainIds();
  const configuredChains = getConfiguredChains();
  
  for (const chainId of supportedChains) {
    const config = getChainConfig(chainId);
    const validation = validateChainConfig(chainId);
    const status = validation.isValid ? "✓" : "✗";
    const primary = config.isPrimary ? " (PRIMARY)" : "";
    
    console.log(`${status} ${config.name} (${chainId})${primary}`);
    
    if (!validation.isValid) {
      console.log(`   Missing: ${validation.missing.join(", ")}`);
    } else {
      console.log(`   Contract: ${config.contractAddress}`);
      console.log(`   Token: ${config.vryfTokenAddress}`);
    }
  }
  
  console.log("═══════════════════════════════════════════");
  console.log(`Configured chains: ${configuredChains.length}/${supportedChains.length}`);
  console.log(`Default chain: ${getChainConfig(getDefaultChainId()).name} (${getDefaultChainId()})`);
  console.log("═══════════════════════════════════════════\n");
}

module.exports = {
  CHAINS,
  getChainConfig,
  getSupportedChainIds,
  isChainSupported,
  getDefaultChainId,
  validateChainConfig,
  getConfiguredChains,
  getChainIdFromRequest,
  getExplorerAddressUrl,
  getExplorerTxUrl,
  logChainStatus,
};
