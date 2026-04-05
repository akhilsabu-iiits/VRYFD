const { ethers } = require("ethers");

// Load contract ABI (copy from artifacts after compile)
const VryfdABI = require("../../artifacts/VryfdAttendance.json");

let provider;
let relayerWallet;
let contract;

/**
 * Initialize the relayer with a funded wallet
 * Called once at server startup
 */
function initRelayer() {
  const rpcUrl = process.env.POLYGON_AMOY_RPC || "https://rpc-amoy.polygon.technology";
  provider = new ethers.JsonRpcProvider(rpcUrl);
  relayerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  contract = new ethers.Contract(
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
    VryfdABI.abi,
    relayerWallet
  );
  console.log(`Relayer initialized: ${relayerWallet.address}`);
}

/**
 * EIP-712 domain for signature verification (must match contract)
 */
function getEIP712Domain(contractAddress, chainId) {
  return {
    name: "VryfdAttendance",
    version: "1",
    chainId,
    verifyingContract: contractAddress,
  };
}

const CHECKIN_TYPES = {
  CheckIn: [
    { name: "attendee", type: "address" },
    { name: "eventId", type: "uint256" },
    { name: "nonce", type: "uint256" },
  ],
};

/**
 * Verify an EIP-712 typed signature client-side before submitting
 */
function verifySignature(attendee, eventId, nonce, signature, contractAddress, chainId) {
  const domain = getEIP712Domain(contractAddress, chainId);
  const value = { attendee, eventId, nonce };
  const recovered = ethers.verifyTypedData(domain, CHECKIN_TYPES, value, signature);
  return recovered.toLowerCase() === attendee.toLowerCase();
}

// ─── Signature Queue ───────────────────────────────
// Collect signatures and batch-submit every N seconds or when queue is full

const signatureQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 30_000; // 30 seconds

function addToQueue(attendee, eventId, v, r, s) {
  signatureQueue.push({ attendee, eventId, v, r, s });

  if (signatureQueue.length >= BATCH_SIZE) {
    flushQueue();
  }
}

async function flushQueue() {
  if (signatureQueue.length === 0) return;

  const batch = signatureQueue.splice(0, BATCH_SIZE);
  console.log(`Submitting batch of ${batch.length} check-ins...`);

  try {
    const tx = await contract.batchConfirmAttendance(
      batch.map((s) => s.attendee),
      batch.map((s) => s.eventId),
      batch.map((s) => s.v),
      batch.map((s) => s.r),
      batch.map((s) => s.s)
    );

    const receipt = await tx.wait();
    console.log(`Batch submitted in tx: ${receipt.hash}`);
    return receipt;
  } catch (error) {
    console.error("Batch submission failed:", error.message);
    // Re-queue failed signatures
    signatureQueue.unshift(...batch);
    throw error;
  }
}

// Auto-flush on interval
setInterval(() => {
  if (signatureQueue.length > 0) {
    flushQueue().catch(console.error);
  }
}, BATCH_INTERVAL_MS);

module.exports = {
  initRelayer,
  getEIP712Domain,
  CHECKIN_TYPES,
  verifySignature,
  addToQueue,
  flushQueue,
  getQueueLength: () => signatureQueue.length,
};
