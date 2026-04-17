const express = require("express");
const router = express.Router();

const {
  recordJoin,
  recordLeave,
  calculateAttendance,
  aggregateAttendance,
  submitToBlockchain,
  batchSubmitToBlockchain,
  getEligibleAttendees,
  getAttendanceDetails,
  getEventStatistics,
} = require("../services/attendanceService");
const { getAllEvents, saveAllEvents, gaslessCheckin, confirmAttendee, issueCertificate } = require("../services/relayerService");
const { withLiveStatus, findEvent } = require("./relayer");
const adminAuth = require("../middleware/adminAuth");

/**
 * Look up an event and apply live-status logic.
 * Returns { event, status } where status is "upcoming" | "live" | "ended".
 */
function getEventWithStatus(eventId) {
  const events = getAllEvents() || [];
  const raw = findEvent(events, eventId);
  if (!raw) return { event: null, status: null };
  const enriched = withLiveStatus([raw])[0];
  return { event: enriched, status: enriched.status };
}

// ── In-memory ephemeral session tracking (PRD §8.2 - off-chain logs allowed) ──
// emailCheckins: short-lived map of attendee sessions for live UI/leave-detection
// activeAttendees: who is currently in the live meeting (used for participant count)
// joinRequests: approval state per (eventId, attendee) before they can enter the meeting.
//   Status: "pending" | "approved" | "rejected"
//   Lifecycle:
//     1. Attendee submits joinCode + EIP-191 signature  →  status "pending"
//     2. Organizer reviews pending list and clicks approve/reject
//     3. "approved" → attendee can call POST /api/attendance/checkin
//     4. "rejected" → blocked; can retry
// All actual attendance proofs live on-chain via the contract.
const emailCheckins = new Map();
const activeAttendees = new Map();
const joinRequests = new Map(); // key = `${eventId}:${walletLower}`

function joinRequestKey(eventId, attendee) {
  return `${eventId}:${String(attendee).toLowerCase()}`;
}

function getJoinStatus(eventId, attendee) {
  const r = joinRequests.get(joinRequestKey(eventId, attendee));
  return r ? r.status : "none";
}

// ──────────────────────────────────────────────────────────────────────────────
// Get check-in history for a user
// ──────────────────────────────────────────────────────────────────────────────

router.get("/my-checkins", (req, res) => {
  const { wallet, email } = req.query;
  const identifier = wallet || email;
  if (!identifier) return res.status(400).json({ error: "Missing wallet query param" });
  const idLower = String(identifier).toLowerCase();

  const checkins = [];
  for (const [, val] of emailCheckins) {
    if (
      (val.attendee && val.attendee.toLowerCase() === idLower) ||
      (val.email && val.email.toLowerCase() === idLower)
    ) {
      checkins.push(val);
    }
  }

  const events = getAllEvents() || [];
  const attendedEvents = checkins.map((ci) => {
    const ev = events.find(
      (e) =>
        String(e.onChainId) === String(ci.eventId) ||
        String(e.id) === String(ci.eventId) ||
        String(e.eventId) === String(ci.eventId)
    );
    return {
      eventId: ci.eventId,
      attendee: ci.attendee,
      email: ci.email,
      timestamp: ci.timestamp,
      duration: ci.duration,
      eventName: ev?.name || `Event #${ci.eventId}`,
      eventStatus: ev?.status || "unknown",
    };
  });

  res.json({ success: true, checkins: attendedEvents, total: attendedEvents.length });
});

// ──────────────────────────────────────────────────────────────────────────────
// Check out — record that a user has left the session
// ──────────────────────────────────────────────────────────────────────────────

router.post("/checkout", (req, res) => {
  try {
    const { eventId, attendee } = req.body;
    if (!eventId || !attendee) {
      return res.status(400).json({ error: "Missing eventId or wallet address" });
    }
    const addrLower = attendee.toLowerCase();

    // Lifecycle gating — once event is "ended", checkout is also frozen
    const { event, status } = getEventWithStatus(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (status === "ended") {
      return res.status(403).json({
        error: "Event has ended — checkout is closed",
        status,
      });
    }

    const eventKey = String(eventId);
    const set = activeAttendees.get(eventKey);
    if (set) {
      set.delete(addrLower);
      if (set.size === 0) activeAttendees.delete(eventKey);
    }

    const ciKey = `${eventId}:${addrLower}`;
    const ci = emailCheckins.get(ciKey);
    let durationMinutes = 0;
    if (ci) {
      ci.checkoutTime = Date.now();
      ci.duration = ci.checkoutTime - ci.timestamp;
      durationMinutes = Math.floor(ci.duration / 60000);
    }

    console.log(`[attendance/checkout] ${attendee} checked out of event ${eventId} (${durationMinutes}m)`);
    return res.json({
      success: true,
      message: "Checked out successfully",
      durationMinutes,
    });
  } catch (error) {
    console.error("[attendance/checkout] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Get active attendee count for an event
// ──────────────────────────────────────────────────────────────────────────────

router.get("/active/:eventId", (req, res) => {
  const { eventId } = req.params;
  const set = activeAttendees.get(String(eventId));
  const count = set ? set.size : 0;
  const list = set ? [...set] : [];
  res.json({ success: true, eventId, activeCount: count, activeAttendees: list });
});

// ─────────────────────────────────────────────────────────────────────────────
// Join-request flow — enter code → sign → organizer approves → check in
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the canonical message that attendees must sign when requesting to join.
 * Signing this proves wallet ownership (PRD §11) and binds the request to a
 * specific event + join code so a signature can't be replayed on other events.
 */
function buildJoinMessage(eventId, attendee, joinCode) {
  return (
    `VRYFD – Request to Join\n\n` +
    `Event: ${eventId}\n` +
    `Attendee: ${String(attendee).toLowerCase()}\n` +
    `Join Code: ${String(joinCode).toUpperCase()}`
  );
}

/**
 * POST /api/attendance/request-join
 * Body: { eventId, attendee, joinCode, signature, name?, email? }
 * Verifies:
 *   1. Event exists and is live (lifecycle === "live")
 *   2. Join code matches the event's code
 *   3. Signature recovers to the attendee's wallet
 * On success: creates a "pending" record for the organizer to approve.
 */
router.post("/request-join", async (req, res) => {
  try {
    const { eventId, attendee, joinCode, signature, name, email } = req.body;
    if (!eventId || !attendee || !joinCode || !signature) {
      return res.status(400).json({
        error: "Missing required fields: eventId, attendee, joinCode, signature",
      });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Lifecycle gate
    const { event, status } = getEventWithStatus(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (status !== "live") {
      return res.status(403).json({
        error:
          status === "upcoming"
            ? "Event has not started — check-ins are not open yet."
            : "Event has ended — check-ins are closed.",
        status,
      });
    }

    // Join code check (case-insensitive compare)
    const expectedCode = String(event.joinCode || "").toUpperCase().trim();
    const providedCode = String(joinCode).toUpperCase().trim();
    if (!expectedCode) {
      return res.status(500).json({ error: "Event does not have a join code configured" });
    }
    if (expectedCode !== providedCode) {
      return res.status(401).json({ error: "Invalid join code" });
    }

    // Signature check — recover address from EIP-191 personal_sign
    const { ethers } = require("ethers");
    const message = buildJoinMessage(eventId, attendee, expectedCode);
    let recovered;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch (e) {
      return res.status(401).json({ error: "Invalid signature format" });
    }
    if (recovered.toLowerCase() !== attendee.toLowerCase()) {
      return res.status(401).json({
        error: "Signature does not match wallet — did you sign with a different account?",
      });
    }

    // Reject if this attendee is already approved (no re-request needed)
    const existingStatus = getJoinStatus(eventId, attendee);
    if (existingStatus === "approved") {
      const existing = joinRequests.get(joinRequestKey(eventId, attendee));
      return res.json({
        success: true,
        status: "approved",
        message: "Already approved",
        checkedInOnChain: Boolean(existing?.checkinConfirmed),
        checkinTx: existing?.checkinTx || null,
      });
    }

    // Save / update the pending request — on-chain check-in happens later, when the
    // organizer clicks Approve (see POST /approve). The signature is kept so the
    // approval step can verify provenance if needed, but no gas is spent yet.
    const key = joinRequestKey(eventId, attendee);
    joinRequests.set(key, {
      eventId: String(eventId),
      attendee: attendee.toLowerCase(),
      name: name || null,
      email: email || null,
      joinCode: expectedCode,
      signature,
      status: "pending",
      requestedAt: Date.now(),
      approvedAt: null,
      approvedBy: null,
      checkinTx: null,
      checkinConfirmed: false,
      checkinError: null,
    });

    console.log(`[joinRequest] ${attendee} requested to join event ${eventId} — awaiting organizer approval`);

    // Broadcast to organizer dashboards watching this event (optional — polling works too)
    try {
      const io = req.app.get("io");
      if (io) {
        io.to(`vryfd-organizer-${eventId}`).emit("join-request", {
          eventId: String(eventId),
          attendee: attendee.toLowerCase(),
          name: name || null,
        });
      }
    } catch {}

    return res.json({
      success: true,
      status: "pending",
      message: "Request submitted — waiting for organizer approval. No gas charged.",
    });
  } catch (error) {
    console.error("[request-join] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attendance/join-status/:eventId/:attendee
 * Attendee polls this to know when the organizer has approved them.
 * Returns: { status, approvedAt, requestedAt, checkedInOnChain, checkinTx }
 */
router.get("/join-status/:eventId/:attendee", (req, res) => {
  const { eventId, attendee } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(attendee)) {
    return res.status(400).json({ error: "Invalid wallet address" });
  }
  const rec = joinRequests.get(joinRequestKey(eventId, attendee));
  res.json({
    success: true,
    status: rec ? rec.status : "none",
    approvedAt: rec?.approvedAt || null,
    requestedAt: rec?.requestedAt || null,
    checkedInOnChain: Boolean(rec?.checkinConfirmed),
    checkinTx: rec?.checkinTx || null,
  });
});

/**
 * GET /api/attendance/event/:eventId/pending
 * Organizer fetches the list of attendees waiting for approval.
 */
router.get("/event/:eventId/pending", async (req, res) => {
  const { authMiddleware } = require("../services/authService");
  // Lightweight auth: JWT required (admin / organizer)
  return authMiddleware(req, res, () => {
    const { eventId } = req.params;
    const { getAllEvents } = require("../services/relayerService");
    const events = getAllEvents() || [];
    const ev = events.find(
      (e) =>
        String(e.onChainId) === String(eventId) ||
        String(e.id) === String(eventId) ||
        String(e.eventId) === String(eventId)
    );
    if (!ev) return res.status(404).json({ error: "Event not found" });

    // Admins can view any event; organizers only their own
    if (req.user.role !== "admin") {
      const email = (req.user.email || "").toLowerCase();
      if (
        email !== (ev.createdBy || "").toLowerCase() &&
        email !== (ev.organizer || "").toLowerCase()
      ) {
        return res.status(403).json({ error: "You are not the organizer of this event" });
      }
    }

    const eventKey = String(eventId);
    const pending = [];
    for (const r of joinRequests.values()) {
      if (r.eventId === eventKey && r.status === "pending") {
        pending.push({
          attendee: r.attendee,
          name: r.name,
          email: r.email,
          requestedAt: r.requestedAt,
        });
      }
    }
    pending.sort((a, b) => b.requestedAt - a.requestedAt);
    res.json({ success: true, eventId: eventKey, pending });
  });
});

/**
 * POST /api/attendance/approve
 * Body: { eventId, attendee, approved: boolean }
 * Organizer approves or rejects a join request.
 */
router.post("/approve", async (req, res) => {
  const { authMiddleware } = require("../services/authService");
  return authMiddleware(req, res, async () => {
    try {
      const { eventId, attendee, approved } = req.body;
      if (!eventId || !attendee || typeof approved !== "boolean") {
        return res.status(400).json({ error: "Missing eventId, attendee, or approved flag" });
      }

      const { getAllEvents } = require("../services/relayerService");
      const events = getAllEvents() || [];
      const ev = events.find(
        (e) =>
          String(e.onChainId) === String(eventId) ||
          String(e.id) === String(eventId) ||
          String(e.eventId) === String(eventId)
      );
      if (!ev) return res.status(404).json({ error: "Event not found" });

      // Authorize: admin or the event's organizer
      if (req.user.role !== "admin") {
        const email = (req.user.email || "").toLowerCase();
        if (
          email !== (ev.createdBy || "").toLowerCase() &&
          email !== (ev.organizer || "").toLowerCase()
        ) {
          return res.status(403).json({ error: "You are not the organizer of this event" });
        }
      }

      const key = joinRequestKey(eventId, attendee);
      const rec = joinRequests.get(key);
      if (!rec) return res.status(404).json({ error: "No join request found for this attendee" });

      rec.status = approved ? "approved" : "rejected";
      rec.approvedAt = Date.now();
      rec.approvedBy = req.user.email;
      joinRequests.set(key, rec);

      console.log(
        `[joinRequest] ${req.user.email} ${approved ? "APPROVED" : "REJECTED"} ${attendee} for event ${eventId}`
      );

      // ── On-chain gasless check-in (only on approval) ─────────────────────
      // The organizer's approval is the trigger: the backend relayer (which
      // holds ORGANIZER_ROLE on the contract) calls checkInFor(attendee, eventId)
      // and pays the gas. The attendee spent nothing — they only signed a
      // message earlier to prove wallet ownership.
      if (approved) {
        try {
          const result = await confirmAttendee(eventId, attendee);
          rec.checkinTx = result?.txHash ?? null;
          rec.checkinConfirmed = true;
          rec.checkinError = null;
          if (result?.alreadyConfirmed) {
            console.log(`[joinRequest] ${attendee} was already checked in on-chain for event ${eventId}`);
          } else {
            console.log(`[joinRequest] ${attendee} checked in on-chain (tx: ${rec.checkinTx}) for event ${eventId}`);
          }
          joinRequests.set(key, rec);
        } catch (e) {
          const msg = e?.reason || e?.shortMessage || e?.message || "On-chain check-in failed";
          rec.checkinConfirmed = false;
          rec.checkinError = msg;
          joinRequests.set(key, rec);
          console.error(`[joinRequest] On-chain check-in failed after approval for ${attendee} / event ${eventId}:`, msg);
          // Approval status is still "approved" in memory — the attendee can enter
          // the meeting room — but the UI will surface that the on-chain record
          // didn't land, so the organizer can retry via a re-approval click.
        }
      }

      // Notify the attendee's browser to stop polling and enter the meeting
      try {
        const io = req.app.get("io");
        if (io) {
          io.to(`vryfd-attendee-${eventId}-${String(attendee).toLowerCase()}`).emit(
            "join-response",
            { eventId: String(eventId), attendee: attendee.toLowerCase(), status: rec.status }
          );
        }
      } catch {}

      return res.json({
        success: true,
        status: rec.status,
        checkedInOnChain: Boolean(rec.checkinConfirmed),
        checkinTx: rec.checkinTx || null,
        checkinError: rec.checkinError || null,
      });
    } catch (error) {
      console.error("[approve] Error:", error);
      res.status(500).json({ error: error.message });
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Signature-based, attendee-callable certificate claim (no JWT required)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Build the signed message an attendee puts their wallet signature on to prove
 * they authorised a certificate claim. The timestamp is embedded so the
 * backend can reject stale / replayed signatures (±10 min window).
 */
function buildCertClaimMessage(eventId, attendee, issuedAt) {
  return (
    `VRYFD – Claim Certificate\n\n` +
    `Event: ${eventId}\n` +
    `Attendee: ${String(attendee).toLowerCase()}\n` +
    `Issued At: ${issuedAt}`
  );
}

/**
 * POST /api/attendance/claim-certificate
 * Body: { eventId, attendee, issuedAt, signature }
 *
 * Attendee-initiated, gasless certificate claim. The attendee signs a message
 * containing {eventId, attendee, issuedAt} with MetaMask (personal_sign). The
 * backend verifies the signature, then the relayer (which holds ORGANIZER_ROLE)
 * mints the soulbound certificate NFT on-chain. Attendee pays zero gas.
 *
 * The contract's own eligibility checks (attendance recorded, threshold met,
 * claim-period not expired) are enforced inside issueCertificate() in the
 * relayer service — we surface their revert reasons cleanly.
 */
router.post("/claim-certificate", async (req, res) => {
  try {
    const { eventId, attendee, issuedAt, signature } = req.body;
    if (eventId === undefined || eventId === null || !attendee || !issuedAt || !signature) {
      return res.status(400).json({
        error: "Missing required fields: eventId, attendee, issuedAt, signature",
      });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Reject stale / future-dated signatures — 10-minute tolerance in either direction.
    const issuedAtMs = Number(issuedAt);
    const now = Date.now();
    if (!Number.isFinite(issuedAtMs) || Math.abs(now - issuedAtMs) > 10 * 60 * 1000) {
      return res.status(400).json({
        error: "Signature is stale or clock skewed. Please try again.",
      });
    }

    // Verify signature — the attendee must be the signer.
    const { ethers } = require("ethers");
    const message = buildCertClaimMessage(eventId, attendee, issuedAtMs);
    let recovered;
    try {
      recovered = ethers.verifyMessage(message, signature);
    } catch {
      return res.status(401).json({ error: "Invalid signature format" });
    }
    if (recovered.toLowerCase() !== attendee.toLowerCase()) {
      return res.status(401).json({
        error: "Signature does not match wallet — did you sign with a different account?",
      });
    }

    // Let the relayer mint the certificate — it enforces on-chain eligibility.
    // issueCertificate() auto-records attendance if missing, deduplicates
    // existing certs, and returns {txHash, certificateId}.
    let result;
    try {
      result = await issueCertificate(
        Number(eventId),
        attendee,
        `ipfs://cert-${eventId}-${Date.now()}`
      );
    } catch (chainErr) {
      const msg = chainErr?.reason || chainErr?.shortMessage || chainErr?.message || "On-chain certificate mint failed";
      if (/already issued/i.test(msg)) {
        return res.status(409).json({ error: "Certificate already issued for this event" });
      }
      if (/Not eligible/i.test(msg)) {
        return res.status(409).json({ error: "You haven't met the event's attendance threshold" });
      }
      if (/Attendee not recorded/i.test(msg)) {
        return res.status(409).json({ error: "No attendance record found — did you check in?" });
      }
      if (/Event.*ended|claim period/i.test(msg)) {
        return res.status(409).json({ error: msg });
      }
      console.error("[claim-certificate] unexpected error:", msg);
      return res.status(500).json({ error: msg });
    }

    return res.json({
      success: true,
      certificateId: result.certificateId,
      txHash: result.txHash,
      message: "Certificate minted on-chain. No gas charged to you.",
    });
  } catch (error) {
    console.error("[claim-certificate] fatal:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attendance/event/:eventId/attendees
 * Returns the full attendee list for an event with attendance data.
 * Used by the organizer dashboard to show participants + issue rewards.
 */
router.get("/event/:eventId/attendees", (req, res) => {
  const { eventId } = req.params;
  const eventKey = String(eventId);
  const activeSet = activeAttendees.get(eventKey) || new Set();

  const { getUserByWallet, getUserByEmail } = require("../services/authService");

  const attendees = [];
  for (const [, val] of emailCheckins) {
    if (String(val.eventId) !== eventKey) continue;
    const duration = val.checkoutTime
      ? val.checkoutTime - val.timestamp
      : Date.now() - val.timestamp;

    // Resolve a human-readable display name, in order:
    //   1. Name explicitly passed at check-in (wallet-only users from localStorage)
    //   2. Registered user record (via wallet binding)
    //   3. Registered user via email (if session stored an email)
    //   4. null  → UI falls back to email prefix or "Anonymous"
    let displayName = val.name || null;
    if (!displayName) {
      try {
        const byWallet = getUserByWallet(val.attendee);
        if (byWallet?.name) displayName = byWallet.name;
        else if (val.email) {
          const byEmail = getUserByEmail(val.email);
          if (byEmail?.name) displayName = byEmail.name;
        }
      } catch {}
    }

    attendees.push({
      attendee: val.attendee,
      email: val.email,
      name: displayName,
      checkInTime: val.timestamp,
      checkOutTime: val.checkoutTime || null,
      durationMs: duration,
      durationSeconds: Math.floor(duration / 1000),
      durationMinutes: Math.floor(duration / 60000),
      currentlyActive: activeSet.has(val.attendee),
    });
  }
  attendees.sort((a, b) => b.checkInTime - a.checkInTime);

  res.json({
    success: true,
    eventId: eventKey,
    total: attendees.length,
    activeCount: activeSet.size,
    attendees,
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Email-based check-in (for users without wallets)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/attendance/checkin
 * Opens the live meeting-room session for an already-checked-in attendee.
 * On-chain attendance was recorded at /request-join time (the moment the
 * signature was verified); this route just marks the attendee as "currently
 * in the room" for the live participant count + session timer, and enforces
 * the organizer approval gate before they can enter.
 *
 * Body: { eventId, attendee (wallet), email? (optional), name? }
 */
router.post("/checkin", async (req, res) => {
  try {
    const { eventId, attendee, email, name } = req.body;
    if (!eventId || !attendee) {
      return res.status(400).json({
        error: "Wallet address required. Please connect your wallet to check in.",
      });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendee)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    // Lifecycle gating — organizer must have started, and not yet ended
    const { event, status } = getEventWithStatus(eventId);
    if (!event) return res.status(404).json({ error: "Event not found" });
    if (status === "upcoming") {
      return res.status(403).json({
        error: "Event has not started yet. Please wait for the organizer to open check-ins.",
        status,
      });
    }
    if (status === "ended") {
      return res.status(403).json({
        error: "Event has ended. Check-ins are closed.",
        status,
      });
    }

    // Approval gate — attendee must have requested + been approved by the organizer
    const joinStatus = getJoinStatus(eventId, attendee);
    if (joinStatus !== "approved") {
      return res.status(403).json({
        error:
          joinStatus === "pending"
            ? "Your join request is awaiting organizer approval."
            : joinStatus === "rejected"
            ? "Your join request was rejected. Please request again."
            : "You must enter the join code and get organizer approval before joining.",
        joinStatus,
      });
    }

    const sessionKey = `${eventId}:${attendee.toLowerCase()}`;
    if (!emailCheckins.has(sessionKey)) {
      emailCheckins.set(sessionKey, {
        eventId,
        attendee: attendee.toLowerCase(),
        email: email || null,
        name: name || null,
        timestamp: Date.now(),
        checkoutTime: null,
      });
    } else {
      // Update name if it was passed (client may have it even on re-check-in)
      const existing = emailCheckins.get(sessionKey);
      if (name && !existing.name) existing.name = name;
      if (email && !existing.email) existing.email = email;
    }

    // Track as active attendee for live participant count
    const eventKey = String(eventId);
    if (!activeAttendees.has(eventKey)) activeAttendees.set(eventKey, new Set());
    activeAttendees.get(eventKey).add(attendee.toLowerCase());

    console.log(`[attendance/checkin] Wallet ${attendee} live session opened for event ${eventId}`);
    return res.json({
      success: true,
      message: "Entered meeting room. On-chain attendance was already recorded when you signed the join code.",
      attendee,
      eventId,
    });
  } catch (error) {
    console.error("[attendance/checkin] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Webinar Attendance Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/attendance/webinar/join
 * Record a participant joining a webinar
 * 
 * Body:
 * {
 *   "eventId": "15",
 *   "participantAddress": "0x123...",
 *   "sessionId": "uuid-or-timestamp"
 * }
 */
router.post("/webinar/join", async (req, res) => {
  try {
    const { eventId, participantAddress, sessionId } = req.body;

    if (!eventId || !participantAddress || !sessionId) {
      return res.status(400).json({ 
        error: "Missing required fields: eventId, participantAddress, sessionId" 
      });
    }

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(participantAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum address format" });
    }

    const session = await recordJoin(eventId, participantAddress, sessionId);

    res.json({
      success: true,
      session: {
        eventId: session.eventId,
        participantAddress: session.participantAddress,
        joinTime: session.joinTime,
        sessionId: session.sessionId,
      },
    });
  } catch (error) {
    console.error("[attendance/join] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/attendance/webinar/leave
 * Record a participant leaving a webinar
 * 
 * Body:
 * {
 *   "eventId": "15",
 *   "participantAddress": "0x123...",
 *   "sessionId": "uuid-or-timestamp"
 * }
 */
router.post("/webinar/leave", async (req, res) => {
  try {
    const { eventId, participantAddress, sessionId } = req.body;

    if (!eventId || !participantAddress || !sessionId) {
      return res.status(400).json({ 
        error: "Missing required fields: eventId, participantAddress, sessionId" 
      });
    }

    const session = await recordLeave(eventId, participantAddress, sessionId);

    res.json({
      success: true,
      session: {
        eventId: session.eventId,
        participantAddress: session.participantAddress,
        joinTime: session.joinTime,
        leaveTime: session.leaveTime,
        duration: session.duration,
        sessionId: session.sessionId,
      },
    });
  } catch (error) {
    console.error("[attendance/leave] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/attendance/webinar/aggregate
 * Aggregate attendance data for an event
 * 
 * Body:
 * {
 *   "eventId": "15",
 *   "eventDurationMinutes": 60,
 *   "attendanceThreshold": 75
 * }
 */
router.post("/webinar/aggregate", adminAuth, async (req, res) => {
  try {
    const { eventId, eventDurationMinutes, attendanceThreshold } = req.body;

    if (!eventId || !eventDurationMinutes) {
      return res.status(400).json({ 
        error: "Missing required fields: eventId, eventDurationMinutes" 
      });
    }

    const records = await aggregateAttendance(
      eventId, 
      eventDurationMinutes, 
      attendanceThreshold || 75
    );

    res.json({
      success: true,
      recordCount: records.length,
      records: records.map(r => ({
        address: r.address,
        totalMinutes: r.totalMinutes,
        percentage: r.percentage,
        eligible: r.eligible,
        sessionCount: r.sessions.length,
      })),
    });
  } catch (error) {
    console.error("[attendance/aggregate] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/attendance/webinar/record
 * Submit final attendance to blockchain for a single attendee
 * 
 * Body:
 * {
 *   "eventId": "15",
 *   "attendeeAddress": "0x123...",
 *   "minutesPresent": 45
 * }
 */
router.post("/webinar/record", adminAuth, async (req, res) => {
  try {
    const { eventId, attendeeAddress, minutesPresent } = req.body;

    if (!eventId || !attendeeAddress || minutesPresent === undefined) {
      return res.status(400).json({ 
        error: "Missing required fields: eventId, attendeeAddress, minutesPresent" 
      });
    }

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(attendeeAddress)) {
      return res.status(400).json({ error: "Invalid Ethereum address format" });
    }

    const result = await submitToBlockchain(eventId, attendeeAddress, minutesPresent);

    res.json({
      success: true,
      txHash: result.txHash,
      eventId,
      attendeeAddress,
      minutesPresent,
    });
  } catch (error) {
    console.error("[attendance/record] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/attendance/webinar/batch-submit
 * Submit all eligible attendees to blockchain
 * 
 * Body:
 * {
 *   "eventId": "15"
 * }
 */
router.post("/webinar/batch-submit", adminAuth, async (req, res) => {
  try {
    const { eventId } = req.body;

    if (!eventId) {
      return res.status(400).json({ error: "Missing required field: eventId" });
    }

    const results = await batchSubmitToBlockchain(eventId);

    const successCount = results.filter(r => r.status === "success").length;
    const failedCount = results.filter(r => r.status === "failed").length;

    res.json({
      success: true,
      totalProcessed: results.length,
      successCount,
      failedCount,
      results,
    });
  } catch (error) {
    console.error("[attendance/batch-submit] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attendance/:eventId/:address
 * Get attendance details for a specific attendee
 */
router.get("/:eventId/:address", async (req, res) => {
  try {
    const { eventId, address } = req.params;

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid Ethereum address format" });
    }

    const details = await getAttendanceDetails(eventId, address);

    if (!details) {
      return res.status(404).json({ 
        error: "Attendance record not found",
        eventId,
        address,
      });
    }

    res.json({
      success: true,
      attendance: details,
    });
  } catch (error) {
    console.error("[attendance/details] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attendance/:eventId/eligible
 * Get all eligible attendees for an event
 */
router.get("/:eventId/eligible", async (req, res) => {
  try {
    const { eventId } = req.params;

    const eligible = await getEligibleAttendees(eventId);

    res.json({
      success: true,
      eventId,
      count: eligible.length,
      attendees: eligible,
    });
  } catch (error) {
    console.error("[attendance/eligible] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attendance/:eventId/stats
 * Get attendance statistics for an event
 */
router.get("/:eventId/stats", async (req, res) => {
  try {
    const { eventId } = req.params;

    const stats = await getEventStatistics(eventId);

    res.json({
      success: true,
      eventId,
      statistics: stats,
    });
  } catch (error) {
    console.error("[attendance/stats] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/attendance/:eventId/:address/calculate
 * Calculate real-time attendance for a participant (without saving)
 */
router.get("/:eventId/:address/calculate", async (req, res) => {
  try {
    const { eventId, address } = req.params;

    // Validate Ethereum address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid Ethereum address format" });
    }

    const attendance = await calculateAttendance(eventId, address);

    res.json({
      success: true,
      eventId,
      address,
      attendance,
    });
  } catch (error) {
    console.error("[attendance/calculate] Error:", error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
// Expose the in-memory session map so other routes (e.g. certificate image
// renderer) can resolve display names for wallet-only sign-ups who don't
// have a registered user record.
module.exports.__getSessions = () => emailCheckins;
