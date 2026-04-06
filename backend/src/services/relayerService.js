const { ethers } = require("ethers");
const VryfdABI = require("../../artifacts/VryfdAttendance.json");

let provider;
let relayerWallet;
let contract;

/**
 * Initialize the relayer with the deployer wallet (has ORGANIZER_ROLE + RELAYER_ROLE)
 */
function initRelayer() {
  const rpcUrl = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";
  provider = new ethers.JsonRpcProvider(rpcUrl);
  relayerWallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
  contract = new ethers.Contract(
    process.env.NEXT_PUBLIC_CONTRACT_ADDRESS,
    VryfdABI.abi,
    relayerWallet
  );
  console.log(`Relayer wallet: ${relayerWallet.address}`);
}

function getContract() {
  if (!contract) throw new Error("Relayer not initialized");
  return contract;
}

// ─── EIP-712 ───────────────────────────────────────────────────────────────

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

function verifySignature(attendee, eventId, nonce, signature, contractAddress, chainId) {
  const domain = getEIP712Domain(contractAddress, chainId);
  const value = { attendee, eventId, nonce };
  const recovered = ethers.verifyTypedData(domain, CHECKIN_TYPES, value, signature);
  return recovered.toLowerCase() === attendee.toLowerCase();
}

// ─── Organizer Actions (relayer pays gas) ─────────────────────────────────

/**
 * Create an event on-chain — relayer wallet pays gas (has ORGANIZER_ROLE)
 */
async function createEvent(name, metadataURI, startTime, endTime) {
  const c = getContract();
  const tx = await c.createEvent(name, metadataURI, BigInt(startTime), BigInt(endTime));
  const receipt = await tx.wait();

  // Extract EventCreated log to get the on-chain event ID
  const iface = new ethers.Interface(VryfdABI.abi);
  let eventId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog(log);
      if (parsed?.name === "EventCreated") {
        eventId = parsed.args[0].toString();
        break;
      }
    } catch {}
  }

  return { txHash: receipt.hash, eventId };
}

/**
 * Issue a certificate on-chain — relayer wallet pays gas (has ORGANIZER_ROLE)
 */
async function issueCertificate(eventId, attendee, metadataURI) {
  const c = getContract();
  const tx = await c.issueCertificate(BigInt(eventId), attendee, metadataURI);
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

/**
 * Revoke a certificate on-chain — relayer wallet pays gas (has ORGANIZER_ROLE)
 */
async function revokeCertificate(certificateId) {
  const c = getContract();
  const tx = await c.revokeCertificate(BigInt(certificateId));
  const receipt = await tx.wait();
  return { txHash: receipt.hash };
}

// ─── Gasless Check-in Queue ───────────────────────────────────────────────

const signatureQueue = [];
const BATCH_SIZE = 10;
const BATCH_INTERVAL_MS = 30_000;

function addToQueue(attendee, eventId, v, r, s) {
  signatureQueue.push({ attendee, eventId, v, r, s });
  if (signatureQueue.length >= BATCH_SIZE) flushQueue();
}

async function flushQueue() {
  if (signatureQueue.length === 0) return;
  const c = getContract();
  const batch = signatureQueue.splice(0, BATCH_SIZE);
  console.log(`Submitting batch of ${batch.length} check-ins...`);
  try {
    const tx = await c.batchConfirmAttendance(
      batch.map((s) => s.attendee),
      batch.map((s) => s.eventId),
      batch.map((s) => s.v),
      batch.map((s) => s.r),
      batch.map((s) => s.s)
    );
    const receipt = await tx.wait();
    console.log(`Batch submitted: ${receipt.hash}`);
    return receipt;
  } catch (error) {
    console.error("Batch failed:", error.message);
    signatureQueue.unshift(...batch);
    throw error;
  }
}

setInterval(() => {
  if (signatureQueue.length > 0) flushQueue().catch(console.error);
}, BATCH_INTERVAL_MS);

module.exports = {
  initRelayer,
  getEIP712Domain,
  CHECKIN_TYPES,
  verifySignature,
  createEvent,
  issueCertificate,
  revokeCertificate,
  addToQueue,
  flushQueue,
  getQueueLength: () => signatureQueue.length,
};
