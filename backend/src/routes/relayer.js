const express = require("express");
const { getENSOverride, getAddressOverride } = require("../services/ensOverrides");
const {
  createEvent,
  createEventsBatch,
  getConfirmedCount,
  getOnChainAttendeeCount,
  generateJoinCode,
  getJoinCode,
  setCustomCode,
  setEventMeta,
  joinCodeCheckin,
  addPending,
  getPendingAttendees,
  confirmAttendee,
  confirmAllAttendees,
  getEventAttendees,
  issueCertificatesBulk,
  markAttendance,
  gaslessCheckin,
  issueCertificate,
  revokeCertificate,
  getAttendanceRecord,
  saveDeployedEvent,
  getDeployedEvents,
  resetDeployedEvents,
  getAllEvents,
  saveAllEvents,
  setMilestoneURIs,
  fixBadgeTokenURI,
  getEventCertificates,
  getCheckinNonce,
  getContract,
  gaslessClaimBadge,
  gaslessMilestoneReward,
  deployContracts,
  deployContractsAsync,
  getDeployState,
  clearAllDeployedEvents,
  getVryfTokenAddress,
} = require("../services/relayerService");

const router = express.Router();

/**
 * POST /api/relay/createEvent
 * Organizer creates event — backend pays gas (has ORGANIZER_ROLE)
 * Body: { name, metadataURI, startTime, endTime }
 */
router.post("/createEvent", async (req, res) => {
  try {
    const { name, metadataURI, startTime, endTime, demoId, joinCode } = req.body;
    if (!name || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields: name, startTime, endTime" });
    }
    const result = await createEvent(name, metadataURI || "", startTime, endTime);
    if (demoId !== undefined && demoId !== null) {
      try { saveDeployedEvent(demoId, result.txHash, result.eventId, joinCode || null, startTime, endTime); } catch (e) {
        console.error("saveDeployedEvent failed (non-fatal):", e.message);
      }
    }
    // Cache event metadata so join code check-in skips RPC calls
    try { setEventMeta(result.eventId, startTime, endTime); } catch (e) {
      console.error("setEventMeta failed (non-fatal):", e.message);
    }
    // Register custom join code so attendees can check in with it
    if (joinCode) {
      try { setCustomCode(result.eventId, joinCode); } catch (e) {
        console.error("setCustomCode failed (non-fatal):", e.message);
      }
    }
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("createEvent error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/createEventsBatch
 * Create multiple events in one shot — single nonce + feeData fetch, all txs submitted in parallel.
 * Body: { events: [{ name, metadataURI, startTime, endTime, demoId, joinCode }] }
 * Returns: { results: [{ demoId, eventId, txHash, status }] }
 */
router.post("/createEventsBatch", async (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events) || events.length === 0) {
      return res.status(400).json({ error: "events must be a non-empty array" });
    }
    for (const ev of events) {
      if (!ev.name || !ev.startTime || !ev.endTime) {
        return res.status(400).json({ error: "Each event needs name, startTime, endTime" });
      }
    }
    const results = await createEventsBatch(events);
    res.json({ success: true, results });
  } catch (error) {
    console.error("createEventsBatch error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/deployedEvents
 * Returns persisted demo event TX hashes — survives frontend reset
 */
router.get("/deployedEvents", (req, res) => {
  res.json(getDeployedEvents());
});

/**
 * GET /api/relay/checkin-nonce/:attendee
 * Returns the current EIP-712 nonce + the live contract address for an attendee.
 * The frontend MUST use the returned contractAddress in the EIP-712 domain so that
 * the signing address always matches the backend's live contract (avoids mismatch
 * after a reset or when env vars on Railway/Vercel differ).
 */
router.get("/checkin-nonce/:attendee", async (req, res) => {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.attendee)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const nonce = await getCheckinNonce(req.params.attendee);
    const contractAddress = getContract().target;
    res.json({ success: true, nonce: nonce.toString(), contractAddress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/contract-address
 * Returns the live contract address from the backend relayer.
 * Used by the frontend on startup to sync CONTRACT_ADDRESSES without relying on
 * env vars or localStorage, which may be stale after a reset or redeployment.
 */
router.get("/contract-address", (req, res) => {
  try {
    const contractAddress = getContract().target;
    const vryfTokenAddress = getVryfTokenAddress();
    res.json({ contractAddress, vryfTokenAddress });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/joincode/:onChainEventId
 * Returns the deterministic 6-char join code for an event (organizer view)
 * Code is derived from the event ID — consistent across restarts, no storage needed
 */
router.get("/join-code/:onChainEventId", (req, res) => {
  try {
    const code = getJoinCode(req.params.onChainEventId);
    res.json({ success: true, code });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/joinCheckin
 * User checks in with a join code — backend verifies and calls checkInFor (backend pays gas)
 * Body: { onChainEventId, attendee, code }
 */
router.post("/joinCheckin", async (req, res) => {
  try {
    const { onChainEventId, attendee, code, signature, ens, demoId } = req.body;
    if (onChainEventId === undefined || !attendee || !code) {
      return res.status(400).json({ error: "Missing required fields: onChainEventId, attendee, code" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    if (!signature) {
      return res.status(400).json({ error: "Missing signature — please sign the check-in message in your wallet" });
    }
    // ens is optional but must be a well-formed name if provided
    let safeEns = null;
    if (ens) {
      if (typeof ens !== "string" || ens.length > 100 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(ens)) {
        return res.status(400).json({ error: "Invalid ENS name format" });
      }
      safeEns = ens;
    }
    const result = await joinCodeCheckin(onChainEventId, attendee, code, signature, safeEns, demoId ?? null);
    res.json({ success: true, ...result });
  } catch (error) {
    const msg = error.message || "";
    console.error("joinCheckin error:", msg);
    if (msg.includes("Incorrect join code") || msg.includes("No join code")) {
      return res.status(400).json({ error: msg });
    }
    if (msg.includes("Signature does not match")) {
      return res.status(401).json({ error: "Invalid signature — sign with the correct wallet" });
    }
    if (msg.includes("Already confirmed on-chain")) {
      return res.status(409).json({ error: "Already confirmed on-chain", alreadyConfirmed: true });
    }
    if (msg.includes("Already registered")) {
      return res.status(409).json({ error: "Already registered — awaiting organizer confirmation", alreadyPending: true });
    }
    if (msg.toLowerCase().includes("not active")) return res.status(400).json({ error: "Event is not active" });
    if (msg.toLowerCase().includes("not started")) return res.status(400).json({ error: "Event has not started yet" });
    if (msg.toLowerCase().includes("ended")) return res.status(400).json({ error: "Event has ended" });
    res.status(500).json({ error: msg || "Join code check-in failed" });
  }
});

/**
 * GET /api/relay/certificates/:onChainEventId
 * Returns all certificates (valid + revoked) issued for an event
 */
router.get("/certificates/:onChainEventId", async (req, res) => {
  try {
    const certs = await getEventCertificates(req.params.onChainEventId);
    res.json({ success: true, certificates: certs });
  } catch (error) {
    console.error("getEventCertificates error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/attendee-count/:onChainEventId
 * Returns the confirmed attendee count for an event by reading the AttendanceConfirmed log count
 */
router.get("/attendee-count/:onChainEventId", async (req, res) => {
  try {
    const { onChainEventId } = req.params;
    const count = await getOnChainAttendeeCount(onChainEventId);
    res.json({ success: true, count, onChainEventId });
  } catch (error) {
    console.error("[attendee-count route]", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/attendees/:onChainEventId
 * Returns all wallets that confirmed attendance for an event (reads chain logs)
 */
router.get("/attendees/:onChainEventId", async (req, res) => {
  try {
    const attendees = await getEventAttendees(req.params.onChainEventId);
    res.json({ success: true, attendees });
  } catch (error) {
    console.error("getAttendees error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/issueCertificatesBulk
 * Issue certificates to all confirmed attendees who don't have one yet
 * Body: { onChainEventId, metadataURI? }
 */
router.post("/issueCertificatesBulk", async (req, res) => {
  try {
    const { onChainEventId, metadataURI } = req.body;
    if (onChainEventId === undefined) {
      return res.status(400).json({ error: "Missing onChainEventId" });
    }
    const results = await issueCertificatesBulk(onChainEventId, metadataURI);
    const issued  = results.filter((r) => r.status === "issued").length;
    const skipped = results.filter((r) => r.status === "skipped").length;
    const failed  = results.filter((r) => r.status === "failed").length;
    res.json({ success: true, issued, skipped, failed, results });
  } catch (error) {
    console.error("issueCertificatesBulk error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/markAttendance
 * Organizer confirms physical presence for an attendee — backend pays gas (ORGANIZER_ROLE)
 * Body: { eventId, attendee }
 */
router.post("/markAttendance", async (req, res) => {
  try {
    const { eventId, attendee } = req.body;
    if (eventId === undefined || !attendee) {
      return res.status(400).json({ error: "Missing required fields: eventId, attendee" });
    }
    const result = await markAttendance(eventId, attendee);
    res.json({ success: true, ...result });
  } catch (error) {
    const msg = error.message || "";
    console.error("markAttendance error:", msg);
    if (msg.toLowerCase().includes("already checked in") || msg.toLowerCase().includes("already")) {
      return res.status(409).json({ error: "Attendee already checked in" });
    }
    if (msg.toLowerCase().includes("not active")) {
      return res.status(400).json({ error: "Event is not active" });
    }
    if (msg.toLowerCase().includes("not started")) {
      return res.status(400).json({ error: "Event has not started yet" });
    }
    if (msg.toLowerCase().includes("ended")) {
      return res.status(400).json({ error: "Event has ended" });
    }
    res.status(500).json({ error: msg || "Failed to mark attendance" });
  }
});

/**
 * POST /api/relay/checkin
 * Gasless attendance check-in — user signs EIP-712 message, relayer pays gas
 * Body: { attendee, eventId, signature }
 */
router.post("/checkin", async (req, res) => {
  try {
    const { attendee, eventId, signature } = req.body;
    if (!attendee || eventId === undefined || !signature) {
      return res.status(400).json({ error: "Missing required fields: attendee, eventId, signature" });
    }
    const result = await gaslessCheckin(attendee, eventId, signature);
    res.json({ success: true, ...result });
  } catch (error) {
    const msg = error.message || "";
    console.error("gaslessCheckin error:", msg);
    if (msg.includes("Invalid signature")) {
      return res.status(400).json({ error: "Invalid signature — could not verify attendee" });
    }
    if (msg.toLowerCase().includes("already checked in") || msg.toLowerCase().includes("already")) {
      return res.status(409).json({ error: "Already checked in" });
    }
    if (msg.toLowerCase().includes("event not active") || msg.toLowerCase().includes("not active")) {
      return res.status(400).json({ error: "Event is not active on-chain" });
    }
    if (msg.toLowerCase().includes("event not started") || msg.toLowerCase().includes("not started")) {
      return res.status(400).json({ error: "Event has not started yet" });
    }
    if (msg.toLowerCase().includes("event ended") || msg.toLowerCase().includes("ended")) {
      return res.status(400).json({ error: "Event has ended" });
    }
    res.status(500).json({ error: msg || "Gasless check-in failed" });
  }
});

/**
 * POST /api/relay/issueCertificate
 * Issue certificate — backend pays gas (has ORGANIZER_ROLE)
 * Body: { eventId, attendee, metadataURI }
 */
router.post("/issueCertificate", async (req, res) => {
  try {
    const { eventId, attendee, metadataURI } = req.body;
    if (eventId === undefined || !attendee) {
      return res.status(400).json({ error: "Missing required fields: eventId, attendee" });
    }
    const result = await issueCertificate(eventId, attendee, metadataURI || "");
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("issueCertificate error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/revokeCertificate
 * Revoke certificate — backend pays gas (has ORGANIZER_ROLE)
 * Body: { certificateId }
 */
router.post("/revokeCertificate", async (req, res) => {
  try {
    const { certificateId } = req.body;
    if (certificateId === undefined) {
      return res.status(400).json({ error: "Missing certificateId" });
    }
    const result = await revokeCertificate(certificateId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("revokeCertificate error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/gaslessClaimBadge
 * Attendee signed EIP-712 ClaimBadge — relayer submits tx and pays gas
 */
router.post("/gaslessClaimBadge", async (req, res) => {
  try {
    const { attendee, onChainEventId, signature } = req.body;
    if (!attendee || onChainEventId === undefined || onChainEventId === null || !signature)
      return res.status(400).json({ error: "Missing attendee, onChainEventId, or signature" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee))
      return res.status(400).json({ error: "Invalid wallet address" });
    const result = await gaslessClaimBadge(attendee, onChainEventId, signature);
    res.json(result);
  } catch (error) {
    const msg = error.message || "";
    if (msg.includes("Badge already claimed"))  return res.status(409).json({ error: "Badge already claimed" });
    if (msg.includes("Not attended"))           return res.status(403).json({ error: "Attendance not confirmed on-chain" });
    if (msg.includes("still pending"))          return res.status(202).json({ error: msg });
    if (msg.includes("Invalid signature"))      return res.status(400).json({ error: "Invalid signature" });
    console.error("gaslessClaimBadge error:", msg);
    res.status(500).json({ error: msg || "Badge claim failed" });
  }
});

/**
 * POST /api/relay/gaslessMilestoneReward
 * Attendee signed EIP-712 ClaimMilestone — relayer submits tx and pays gas
 */
router.post("/gaslessMilestoneReward", async (req, res) => {
  try {
    const { attendee, signature } = req.body;
    if (!attendee || !signature)
      return res.status(400).json({ error: "Missing attendee or signature" });
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee))
      return res.status(400).json({ error: "Invalid wallet address" });
    const result = await gaslessMilestoneReward(attendee, signature);
    res.json(result);
  } catch (error) {
    const msg = error.message || "";
    if (msg.includes("Invalid signature")) return res.status(400).json({ error: "Invalid signature" });
    console.error("gaslessMilestoneReward error:", msg);
    res.status(500).json({ error: msg || "Milestone claim failed" });
  }
});

/**
 * GET /api/relay/checkin-status/:onChainEventId/:attendee
 * Check if a wallet has confirmed attendance for an on-chain event
 */
router.get("/checkin-status/:onChainEventId/:attendee", async (req, res) => {
  try {
    const { onChainEventId: eventId, attendee } = req.params;
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee))
      return res.status(400).json({ error: "Invalid wallet address" });
    const record = await getAttendanceRecord(eventId, attendee);
    res.json(record);
  } catch (error) {
    res.status(500).json({ error: "Failed to check attendance" });
  }
});

/**
 * GET /api/relay/pending-attendees/:onChainEventId
 * Returns attendees who entered the join code and are awaiting organizer confirmation
 */
router.get("/pending-attendees/:onChainEventId", (req, res) => {
  try {
    const attendees = getPendingAttendees(req.params.onChainEventId);
    res.json({ success: true, attendees });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/confirmAttendee
 * Organizer confirms a single pending attendee — writes to chain (ORGANIZER_ROLE, backend pays gas)
 * Body: { onChainEventId, attendee }
 */
router.post("/confirmAttendee", async (req, res) => {
  try {
    const { onChainEventId, attendee } = req.body;
    if (onChainEventId === undefined || !attendee) {
      return res.status(400).json({ error: "Missing required fields: onChainEventId, attendee" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee))
      return res.status(400).json({ error: "Invalid wallet address" });
    const result = await confirmAttendee(onChainEventId, attendee);
    res.json({ success: true, ...result });
  } catch (error) {
    const msg = error.message || "";
    console.error("confirmAttendee error:", msg);
    if (msg.toLowerCase().includes("not active")) return res.status(400).json({ error: "Event is not active" });
    if (msg.toLowerCase().includes("ended")) return res.status(400).json({ error: "Event has ended" });
    res.status(500).json({ error: msg || "Failed to confirm attendee" });
  }
});

/**
 * POST /api/relay/confirmAllAttendees
 * Organizer confirms all pending attendees for an event at once
 * Body: { onChainEventId }
 */
router.post("/confirmAllAttendees", async (req, res) => {
  try {
    const { onChainEventId } = req.body;
    if (onChainEventId === undefined) {
      return res.status(400).json({ error: "Missing onChainEventId" });
    }
    const results = await confirmAllAttendees(onChainEventId);
    const confirmed = results.filter((r) => r.status === "confirmed").length;
    const alreadyConfirmed = results.filter((r) => r.status === "already_confirmed").length;
    const failed = results.filter((r) => r.status === "failed").length;
    res.json({ success: true, confirmed, alreadyConfirmed, failed, results });
  } catch (error) {
    console.error("confirmAllAttendees error:", error.message);
    res.status(400).json({ error: error.message });
  }
});

/**
 * POST /api/relay/fixBadgeURI
 * Update a badge token's on-chain URI after the off-by-one metadata bug.
 * Requires the contract to have been redeployed with the setTokenURI admin function.
 * Body: { onChainEventId, metaURI }
 */
router.post("/fixBadgeURI", async (req, res) => {
  try {
    const { onChainEventId, metaURI } = req.body;
    if (onChainEventId === undefined || !metaURI) {
      return res.status(400).json({ error: "Missing onChainEventId or metaURI" });
    }
    const result = await fixBadgeTokenURI(onChainEventId, metaURI);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("fixBadgeURI error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/setMilestoneURIs
 * Set on-chain metadata URIs for milestone NFT tiers (requires relayer ETH)
 * Body: { baseURL } — e.g. "http://localhost:3001"
 */
router.post("/setMilestoneURIs", async (req, res) => {
  try {
    const baseURL = req.body.baseURL || "http://localhost:3001";
    const results = await setMilestoneURIs(baseURL);
    res.json({ success: true, results });
  } catch (error) {
    console.error("setMilestoneURIs error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/ens-resolve/:ensName
 * Forward ENS lookup: resolves an ENS domain name to an Ethereum address.
 * Returns { address: string|null } — null if the ENS name is not registered.
 */
router.get("/ens-resolve/:ensName", async (req, res) => {
  const { ensName } = req.params;
  if (!ensName || !ensName.includes(".")) {
    return res.status(400).json({ error: "Invalid ENS name" });
  }
  // Check project-level override first
  const overrideAddr = getAddressOverride(ensName);
  if (overrideAddr) return res.json({ address: overrideAddr });
  try {
    const { ethers } = require("ethers");
    const mainnetProvider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    );
    const address = await mainnetProvider.resolveName(ensName.toLowerCase().trim());
    res.json({ address: address || null });
  } catch {
    res.json({ address: null });
  }
});

/**
 * GET /api/relay/ens/:address
 * Resolves an Ethereum address to its ENS name via mainnet reverse lookup.
 * Returns { ens: string|null } — null if no ENS name is registered.
 * Results are cached in-memory for the lifetime of the server process.
 */
const ensCache = new Map(); // address.lower → { ens: string|null, fetchedAt: number }
const ENS_CACHE_TTL = 10 * 60 * 1000; // 10 minutes
router.get("/ens/:address", async (req, res) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return res.status(400).json({ error: "Invalid address" });
  }
  // Check project-level override first (no RPC call needed)
  const overrideEns = getENSOverride(address);
  if (overrideEns) return res.json({ ens: overrideEns });
  const key = address.toLowerCase();
  const cached = ensCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < ENS_CACHE_TTL) {
    return res.json({ ens: cached.ens });
  }
  try {
    const { ethers } = require("ethers");
    const mainnetProvider = new ethers.JsonRpcProvider(
      `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
    );
    const ens = await mainnetProvider.lookupAddress(address);
    ensCache.set(key, { ens, fetchedAt: Date.now() });
    res.json({ ens });
  } catch {
    ensCache.set(key, { ens: null, fetchedAt: Date.now() });
    res.json({ ens: null });
  }
});

/**
 * GET /api/relay/events
 * Returns the full saved event list (source of truth for frontend state)
 */
router.get("/events", (req, res) => {
  try {
    const events = getAllEvents();
    res.json({ events }); // events is null when no file exists yet
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/events
 * Persists the full event list from the frontend so it survives localStorage wipes
 * Body: { events: VEvent[] }
 */
router.post("/events", (req, res) => {
  try {
    const { events } = req.body;
    if (!Array.isArray(events)) return res.status(400).json({ error: "events must be an array" });
    saveAllEvents(events);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/reset
 * Fires contract deployment in the background and returns immediately.
 * The frontend reloads at once and polls /api/relay/deploy-status for completion.
 */
router.post("/reset", (req, res) => {
  try {
    // Clear all event state right away — safe to do before deploy finishes
    // because the old contract is no longer valid the moment reset is called.
    clearAllDeployedEvents();
    // Start async deployment — do NOT await so the response returns in ms
    deployContractsAsync();
    res.json({ success: true, status: "deploying" });
  } catch (error) {
    console.error("reset error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/deploy-status
 * Returns the current async deployment state so the frontend can poll after reset.
 * { status: 'idle' | 'deploying' | 'ready' | 'error', contractAddress, vryfTokenAddress, error }
 */
router.get("/deploy-status", (req, res) => {
  res.json(getDeployState());
});

/**
 * POST /api/relay/testCheckIn
 * DEV/TEST ONLY — available only when NODE_ENV !== "production".
 * Directly calls checkInFor for a list of onChainEventIds bypassing the
 * join-code pending queue. Used to quickly reach milestone thresholds in dev.
 * Body: { attendee, onChainEventIds: number[] }
 */
if (process.env.NODE_ENV !== "production") router.post("/testCheckIn", async (req, res) => {
  try {
    const { attendee, onChainEventIds } = req.body;
    if (!attendee || !Array.isArray(onChainEventIds)) {
      return res.status(400).json({ error: "Missing attendee or onChainEventIds[]" });
    }
    const results = [];
    for (const eventId of onChainEventIds) {
      try {
        // Add to pending then confirm — reuses existing confirmed path
        addPending(eventId, attendee, "0x00");
        const result = await confirmAttendee(eventId, attendee);
        results.push({ eventId, status: result.alreadyConfirmed ? "already_confirmed" : "confirmed", txHash: result.txHash });
      } catch (err) {
        results.push({ eventId, status: "failed", reason: err.message });
      }
    }
    res.json({ success: true, results });
  } catch (error) {
    console.error("testCheckIn error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
