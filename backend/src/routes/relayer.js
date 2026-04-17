const express = require("express");
const { getENSOverride, getAddressOverride } = require("../services/ensOverrides");
const {
  createEvent,
  getConfirmedCount,
  getOnChainAttendeeCount,
  generateJoinCode,
  getJoinCode,
  setCustomCode,
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
  gaslessClaimBadge,
  gaslessMilestoneReward,
  deployContracts,
  clearAllDeployedEvents,
} = require("../services/relayerService");

const { authMiddleware } = require("../services/authService");
const { ethers } = require("ethers");

const router = express.Router();

// ── On-chain VRYF Token reader (Sepolia) ─────────────────────────────────────
// All token balances and transaction history come directly from the deployed
// VRYFToken contract. No off-chain ledger.
const VRYF_TOKEN_ADDRESS = process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS;
const SEPOLIA_RPC = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "event Transfer(address indexed from, address indexed to, uint256 value)",
];

function getTokenContract() {
  if (!VRYF_TOKEN_ADDRESS) throw new Error("VRYF token address not configured");
  const provider = new ethers.JsonRpcProvider(SEPOLIA_RPC);
  return new ethers.Contract(VRYF_TOKEN_ADDRESS, ERC20_ABI, provider);
}

async function getOnChainBalance(account) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return 0;
  try {
    const c = getTokenContract();
    const [bal, decimals] = await Promise.all([c.balanceOf(account), c.decimals()]);
    return Number(ethers.formatUnits(bal, decimals));
  } catch (e) {
    console.error("[tokens] balance read failed:", e.message);
    return 0;
  }
}

async function getOnChainTransactions(account) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) return [];
  try {
    const c = getTokenContract();
    const decimals = Number(await c.decimals());
    // Query both incoming and outgoing transfers
    const [incoming, outgoing] = await Promise.all([
      c.queryFilter(c.filters.Transfer(null, account)),
      c.queryFilter(c.filters.Transfer(account, null)),
    ]);
    const txs = [];
    for (const ev of incoming) {
      const block = await ev.getBlock();
      txs.push({
        id: `${ev.transactionHash}-${ev.logIndex}`,
        account: account.toLowerCase(),
        amount: Number(ethers.formatUnits(ev.args.value, decimals)),
        reason: ev.args.from === ethers.ZeroAddress ? "Mint reward" : `From ${ev.args.from.slice(0, 10)}…`,
        timestamp: Number(block.timestamp) * 1000,
        txHash: ev.transactionHash,
        type: "in",
      });
    }
    for (const ev of outgoing) {
      const block = await ev.getBlock();
      txs.push({
        id: `${ev.transactionHash}-${ev.logIndex}`,
        account: account.toLowerCase(),
        amount: -Number(ethers.formatUnits(ev.args.value, decimals)),
        reason: `To ${ev.args.to.slice(0, 10)}…`,
        timestamp: Number(block.timestamp) * 1000,
        txHash: ev.transactionHash,
        type: "out",
      });
    }
    return txs.sort((a, b) => b.timestamp - a.timestamp);
  } catch (e) {
    console.error("[tokens] history read failed:", e.message);
    return [];
  }
}

/**
 * POST /api/relay/createEvent
 * Organizer creates event — backend pays gas (has ORGANIZER_ROLE)
 * Body: { name, metadataURI, startTime, endTime }
 */
router.post("/createEvent", authMiddleware, async (req, res) => {
  try {
    const { name, metadataURI, startTime, endTime, demoId, joinCode, attendanceThreshold, claimPeriodDays, durationMinutes, eventType } = req.body;
    if (!name || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields: name, startTime, endTime" });
    }
    const result = await createEvent(name, metadataURI || "", startTime, endTime, attendanceThreshold, claimPeriodDays, durationMinutes, eventType);
    if (demoId !== undefined && demoId !== null) {
      try { saveDeployedEvent(demoId, result.txHash, result.eventId, joinCode || null); } catch (e) {
        console.error("saveDeployedEvent failed (non-fatal):", e.message);
      }
    }
    // Register custom join code so attendees can check in with it
    const generatedCode = joinCode || generateJoinCode(result.eventId);
    if (joinCode) {
      try { setCustomCode(result.eventId, joinCode); } catch (e) {
        console.error("setCustomCode failed (non-fatal):", e.message);
      }
    }

    // Append new event to the events list so it shows up in the UI
    try {
      const existing = getAllEvents() || [];
      const startDate = new Date(startTime * 1000);
      const now = new Date();
      const endDate = new Date(endTime * 1000);
      let status = "upcoming";
      if (now >= startDate && now <= endDate) status = "live";
      else if (now > endDate) status = "ended";
      existing.push({
        id: existing.length + 1,
        onChainId: result.eventId,
        name,
        date: startDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
        startTime,
        endTime,
        status,
        active: status !== "ended",
        attendees: 0,
        attendeeCount: 0,
        createdBy: req.user.email,
        organizer: req.user.email,
        emoji: "🎪",
        color: "#7c6cf0",
        joinCode: generatedCode,
        txHash: result.txHash,
        metadataURI: metadataURI || "",
        // EventType enum on-chain: 0 = VIRTUAL (Virtual / online), 1 = PHYSICAL,
        // 2 = HYBRID. The UI gates QR-code features on physical/hybrid events.
        eventType: typeof eventType === "number" ? eventType : 0,
        attendanceThreshold: typeof attendanceThreshold === "number" ? attendanceThreshold : 75,
        durationMinutes: typeof durationMinutes === "number" ? durationMinutes : undefined,
        claimPeriodDays: typeof claimPeriodDays === "number" ? claimPeriodDays : undefined,
        // The createEvent service now returns immediately without waiting for
        // block confirmation — UIs can show a "pending on-chain" hint while
        // the tx is still being mined.
        onChainPending: !!result.pending,
      });
      saveAllEvents(existing);

      // Background watcher: wait for the tx to confirm, then clear the
      // onChainPending flag in events.json so the UI badge disappears.
      if (result.pending && result.txHash) {
        (async () => {
          try {
            const { ethers } = require("ethers");
            const rpc = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";
            const provider = new ethers.JsonRpcProvider(rpc);
            await provider.waitForTransaction(result.txHash, 1, 180_000);
            const fresh = getAllEvents() || [];
            const target = fresh.find(
              (e) => String(e.onChainId) === String(result.eventId) && e.txHash === result.txHash
            );
            if (target) {
              target.onChainPending = false;
              target.onChainConfirmedAt = Date.now();
              saveAllEvents(fresh);
              console.log(`[createEvent] ✓ cleared onChainPending for event ${result.eventId}`);
            }
          } catch (err) {
            console.warn(`[createEvent] pending watcher failed for ${result.txHash}:`, err.message);
          }
        })();
      }
    } catch (e) {
      console.error("saveAllEvents after create failed (non-fatal):", e.message);
    }

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("createEvent error:", error.message);
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
 * Returns the current EIP-712 nonce for an attendee — frontend uses this to sign CheckIn message
 */
router.get("/checkin-nonce/:attendee", async (req, res) => {
  try {
    if (!/^0x[0-9a-fA-F]{40}$/.test(req.params.attendee)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }
    const nonce = await getCheckinNonce(req.params.attendee);
    res.json({ success: true, nonce: nonce.toString() });
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
    const { onChainEventId, attendee, code, signature, ens } = req.body;
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
    const result = await joinCodeCheckin(onChainEventId, attendee, code, signature, safeEns);
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
router.post("/issueCertificate", authMiddleware, async (req, res) => {
  try {
    const { eventId, attendee, metadataURI } = req.body;
    if (eventId === undefined || !attendee) {
      return res.status(400).json({ error: "Missing required fields: eventId, attendee" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee)) {
      return res.status(400).json({ error: "Wallet address required (per PRD §11)" });
    }

    // Authorize: only the event's organizer or an admin may issue
    const events = getAllEvents() || [];
    const ev = findEvent(events, eventId);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    if (!canManageEvent(req.user, ev)) {
      return res.status(403).json({
        error: "Only the event organizer or an admin can issue certificates for this event",
      });
    }
    const onChainId = ev.onChainId || ev.eventId || ev.id;

    // The service (relayerService.issueCertificate) now auto-records attendance
    // if missing, and validates the event window. We just wrap the result and
    // translate common revert reasons into friendly HTTP errors.
    const result = await issueCertificate(Number(onChainId), attendee, metadataURI || "");
    res.json({ success: true, ...result });
  } catch (error) {
    const msg = error.message || "";
    const lower = msg.toLowerCase();
    if (lower.includes("already issued") || lower.includes("certificate already")) {
      return res.status(409).json({ success: false, error: msg });
    }
    if (lower.includes("not eligible") || lower.includes("below the event threshold")) {
      return res.status(403).json({
        success: false,
        error: "Not eligible — attendee's on-chain attendance percentage is below the event threshold",
      });
    }
    if (lower.includes("event window has ended") || lower.includes("event ended")) {
      return res.status(400).json({
        success: false,
        error:
          "On-chain event window has ended. Click Start Event again to extend the window, then try issuing the certificate.",
      });
    }
    if (lower.includes("event has not started")) {
      return res.status(400).json({ success: false, error: msg });
    }
    console.error("[issueCertificate] unexpected error:", msg);
    res.status(500).json({ error: msg || "Failed to issue certificate" });
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
    const result = await gaslessClaimBadge(attendee, onChainEventId, signature);
    res.json(result);
  } catch (error) {
    const msg = error.message || "";
    if (msg.includes("Badge already claimed")) return res.status(409).json({ error: "Badge already claimed" });
    if (msg.includes("Not attended"))          return res.status(403).json({ error: "Attendance not confirmed on-chain" });
    if (msg.includes("Invalid signature"))     return res.status(400).json({ error: "Invalid signature" });
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
/**
 * Compute live status & active flag from start/end times.
 * The `active` flag stored in events.json is only the value at creation time —
 * it never updates as time passes. We re-derive it on every read so the UI
 * always shows accurate state.
 */
/**
 * Lifecycle status precedence (highest first):
 *   1. lifecycleStatus === "ended"     → ended (organizer manually closed)
 *   2. lifecycleStatus === "live"      → live (organizer manually started)
 *   3. lifecycleStatus === "not_started" → upcoming (explicit hold)
 *   4. otherwise: derived from startTime/endTime
 *
 * Check-ins/checkouts are only allowed when status === "live".
 */
function withLiveStatus(events) {
  const now = Math.floor(Date.now() / 1000);
  return (events || []).map((ev) => {
    const start = Number(ev.startTime || 0);
    const end = Number(ev.endTime || 0);
    let status;
    if (ev.lifecycleStatus === "ended") {
      status = "ended";
    } else if (ev.lifecycleStatus === "live") {
      status = "live";
    } else if (ev.lifecycleStatus === "not_started") {
      status = "upcoming";
    } else if (end > 0 && now > end) {
      status = "ended";
    } else if (start > 0 && now >= start && now <= end) {
      status = "live";
    } else {
      status = "upcoming";
    }
    return {
      ...ev,
      status,
      active: status === "live",
      canCheckIn: status === "live",
      canCheckOut: status === "live",
    };
  });
}

/**
 * Look up an event by id/onChainId/eventId. Returns null if not found.
 */
function findEvent(events, idOrOnChain) {
  return (events || []).find(
    (e) =>
      String(e.id) === String(idOrOnChain) ||
      String(e.eventId) === String(idOrOnChain) ||
      String(e.onChainId) === String(idOrOnChain)
  );
}

/**
 * Returns true if the caller (req.user) is allowed to manage this event.
 * Admins manage all events; organizers only manage their own.
 */
function canManageEvent(user, event) {
  if (!user || !event) return false;
  if (user.role === "admin") return true;
  if (user.role !== "organizer") return false;
  const email = (user.email || "").toLowerCase();
  return (
    email === (event.createdBy || "").toLowerCase() ||
    email === (event.organizer || "").toLowerCase()
  );
}

router.get("/events", (req, res) => {
  try {
    const events = withLiveStatus(getAllEvents());
    res.json({ events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/startEvent
 * Organizer/admin manually opens the event for check-ins.
 * Body: { eventId }
 */
router.post("/startEvent", authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.body;
    if (eventId === undefined || eventId === null) {
      return res.status(400).json({ error: "Missing eventId" });
    }
    const events = getAllEvents() || [];
    const ev = findEvent(events, eventId);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    if (!canManageEvent(req.user, ev)) {
      return res.status(403).json({ error: "Only the event organizer or an admin can start this event" });
    }
    if (ev.lifecycleStatus === "ended") {
      return res.status(400).json({ error: "Event has already ended and cannot be reopened" });
    }
    ev.lifecycleStatus = "live";
    ev.startedAt = Date.now();

    // IMPORTANT: extend the on-chain endTime so that check-ins work for the
    // entire duration the organizer keeps the event open. The contract gates
    // checkInFor() by `block.timestamp <= evt.endTime`, so we push endTime
    // out to now+24h (or keep the existing endTime if it's already further).
    try {
      const { editEvent: editOnChain } = require("../services/relayerService");
      const onChainId = ev.onChainId || ev.eventId || ev.id;
      const nowSec = Math.floor(Date.now() / 1000);
      const desiredEnd = nowSec + 24 * 60 * 60; // 24h from now
      if (Number(ev.endTime) < desiredEnd) {
        await editOnChain(
          Number(onChainId),
          ev.name,
          ev.metadataURI || "",
          Number(ev.startTime),
          desiredEnd,
          Number(ev.attendanceThreshold || 75),
          Number(ev.durationMinutes || 60)
        );
        ev.endTime = desiredEnd;
        ev.onChainEndExtended = true;
        console.log(`[lifecycle] extended on-chain endTime to ${new Date(desiredEnd * 1000).toISOString()}`);
      }
    } catch (extErr) {
      console.warn(`[lifecycle] on-chain endTime extension failed (non-fatal): ${extErr.message}`);
      // Continue anyway — attendees may still be able to check in via existing window
    }

    saveAllEvents(events);
    console.log(`[lifecycle] ${req.user.email} STARTED event ${eventId}`);
    return res.json({
      success: true,
      message: "Event is now live — attendees can check in",
      event: withLiveStatus([ev])[0],
    });
  } catch (error) {
    console.error("[startEvent] error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/endEvent
 * Organizer/admin manually closes the event. After this no further
 * check-ins or checkouts are permitted.
 * Body: { eventId }
 */
router.post("/endEvent", authMiddleware, (req, res) => {
  try {
    const { eventId } = req.body;
    if (eventId === undefined || eventId === null) {
      return res.status(400).json({ error: "Missing eventId" });
    }
    const events = getAllEvents() || [];
    const ev = findEvent(events, eventId);
    if (!ev) return res.status(404).json({ error: "Event not found" });
    if (!canManageEvent(req.user, ev)) {
      return res.status(403).json({ error: "Only the event organizer or an admin can end this event" });
    }
    ev.lifecycleStatus = "ended";
    ev.endedAt = Date.now();
    saveAllEvents(events);
    console.log(`[lifecycle] ${req.user.email} ENDED event ${eventId}`);

    // Broadcast to any active attendees in the live meeting room so
    // their client-side sessions auto-checkout and disconnect.
    try {
      const io = req.app.get("io");
      if (io) {
        const roomId = `vryfd-live-${ev.onChainId || ev.id || eventId}`;
        io.to(roomId).emit("event-ended", {
          eventId: ev.onChainId || ev.id || eventId,
          endedBy: req.user.email,
          reason: "organizer_closed",
        });
        // Also emit the existing channel so older live-page handlers still react
        io.to(roomId).emit("meeting-ended", { endedBy: req.user.email });
        console.log(`[lifecycle] broadcast event-ended to room ${roomId}`);
      }
    } catch (e) {
      console.warn("[endEvent] broadcast failed:", e.message);
    }

    return res.json({
      success: true,
      message: "Event ended — check-ins are now closed",
      event: withLiveStatus([ev])[0],
    });
  } catch (error) {
    console.error("[endEvent] error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/relay/my-events
 * Returns events owned by the authenticated user (organizer isolation)
 * Admin role bypasses the filter and sees all events.
 */
router.get("/my-events", authMiddleware, (req, res) => {
  try {
    const all = withLiveStatus(getAllEvents() || []);
    if (req.user.role === "admin") {
      return res.json({ events: all });
    }
    const mine = all.filter((e) => e.createdBy === req.user.email);
    res.json({ events: mine });
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
 * Resets deployedEvents.json to the default state (events 1 & 2 only)
 * and clears in-memory pending registrations and custom codes.
 */
router.post("/reset", async (req, res) => {
  try {
    const { attendanceAddress, vryfAddress } = await deployContracts();
    // Clear ALL event state AFTER new contracts are deployed so stale
    // join codes / on-chain IDs from the old contract don't persist.
    clearAllDeployedEvents();
    res.json({ success: true, contractAddress: attendanceAddress, vryfTokenAddress: vryfAddress });
  } catch (error) {
    console.error("reset error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/editEvent
 * Organizer edits an existing event on-chain
 * Body: { eventId, name, metadataURI, startTime, endTime, attendanceThreshold, durationMinutes }
 */
router.post("/editEvent", async (req, res) => {
  try {
    const { eventId, name, metadataURI, startTime, endTime, attendanceThreshold, durationMinutes } = req.body;
    if (eventId === undefined || !name || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields: eventId, name, startTime, endTime" });
    }
    const { editEvent } = require("../services/relayerService");
    const result = await editEvent(eventId, name, metadataURI || "", startTime, endTime, attendanceThreshold || 75, durationMinutes || 60);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("editEvent error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/endMeeting
 * Admin/organizer ends a live meeting — marks event as ended in events.json
 * Body: { eventId }
 */
router.post("/endMeeting", authMiddleware, async (req, res) => {
  try {
    const { eventId } = req.body;
    if (eventId === undefined) {
      return res.status(400).json({ error: "Missing eventId" });
    }
    if (req.user.role !== "admin" && req.user.role !== "organizer") {
      return res.status(403).json({ error: "Only admin or organizer can end a meeting" });
    }
    const events = getAllEvents();
    if (!events) return res.status(404).json({ error: "No events found" });

    const ev = events.find(
      (e) =>
        String(e.onChainId) === String(eventId) ||
        String(e.id) === String(eventId) ||
        String(e.eventId) === String(eventId)
    );
    if (!ev) return res.status(404).json({ error: "Event not found" });

    // Check ownership for organizers
    if (req.user.role === "organizer" && ev.createdBy !== req.user.email) {
      return res.status(403).json({ error: "You can only end your own events" });
    }

    ev.status = "ended";
    ev.active = false;
    ev.endedAt = Date.now();
    saveAllEvents(events);

    console.log(`[endMeeting] Event ${eventId} ended by ${req.user.email}`);
    res.json({ success: true, message: "Meeting ended" });
  } catch (error) {
    console.error("endMeeting error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/cancelEvent
 * Organizer cancels an event on-chain
 * Body: { eventId }
 */
router.post("/cancelEvent", async (req, res) => {
  try {
    const { eventId } = req.body;
    if (eventId === undefined) {
      return res.status(400).json({ error: "Missing eventId" });
    }
    const { cancelEvent } = require("../services/relayerService");
    const result = await cancelEvent(eventId);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("cancelEvent error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/setCheckpoints
 * Configure multi-checkpoint for a physical/hybrid event
 * Body: { eventId, totalCheckpoints }
 */
router.post("/setCheckpoints", async (req, res) => {
  try {
    const { eventId, totalCheckpoints } = req.body;
    if (eventId === undefined || !totalCheckpoints) {
      return res.status(400).json({ error: "Missing required fields: eventId, totalCheckpoints" });
    }
    const { setEventCheckpoints } = require("../services/relayerService");
    const result = await setEventCheckpoints(eventId, totalCheckpoints);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("setCheckpoints error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/relay/addRewardTier
 * Add a reward tier to an event
 * Body: { eventId, name, minPercentage, metadataURI }
 */
router.post("/addRewardTier", async (req, res) => {
  try {
    const { eventId, name, minPercentage, metadataURI } = req.body;
    if (eventId === undefined || !name || !minPercentage) {
      return res.status(400).json({ error: "Missing required fields: eventId, name, minPercentage" });
    }
    const { addRewardTier } = require("../services/relayerService");
    const result = await addRewardTier(eventId, name, minPercentage, metadataURI || "");
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("addRewardTier error:", error.message);
    res.status(500).json({ error: error.message });
  }
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

// ── VRYF Token Balance & Transactions ────────────────────────────────────────

/**
 * GET /api/relay/token-balance/:account
 * Returns the VRYF token balance from the on-chain VRYFToken contract.
 * Wallet address required (no email — per PRD §11).
 */
router.get("/token-balance/:account", async (req, res) => {
  const account = decodeURIComponent(req.params.account);
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return res.json({ success: true, account, balance: 0, note: "Wallet required" });
  }
  const balance = await getOnChainBalance(account);
  res.json({ success: true, account, balance });
});

/**
 * GET /api/relay/token-history/:account
 * Returns the VRYF token transaction history from on-chain Transfer events.
 */
router.get("/token-history/:account", async (req, res) => {
  const account = decodeURIComponent(req.params.account);
  if (!/^0x[0-9a-fA-F]{40}$/.test(account)) {
    return res.json({ success: true, account, balance: 0, transactions: [], note: "Wallet required" });
  }
  const [balance, transactions] = await Promise.all([
    getOnChainBalance(account),
    getOnChainTransactions(account),
  ]);
  res.json({ success: true, account, balance, transactions });
});

// Export helpers for use by other routes (attendance.js, etc.)
module.exports = router;
module.exports.withLiveStatus = withLiveStatus;
module.exports.findEvent = findEvent;
module.exports.canManageEvent = canManageEvent;
