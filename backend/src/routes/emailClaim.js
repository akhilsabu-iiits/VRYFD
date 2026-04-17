const express = require("express");
const router = express.Router();
const {
  sendClaimEmail,
  sendBulkClaimEmails,
  redeemClaimToken,
  getClaimInfo,
} = require("../services/emailClaimService");
const { confirmAttendee, addPending } = require("../services/relayerService");

/**
 * POST /api/email-claim/send
 * Organizer sends a claim email to an attendee
 * Body: { email, eventId, eventName, organizerAddress }
 */
router.post("/send", async (req, res) => {
  try {
    const { email, eventId, eventName, organizerAddress } = req.body;
    if (!email || eventId === undefined || !eventName) {
      return res.status(400).json({ error: "Missing required fields: email, eventId, eventName" });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ error: "Invalid email format" });
    }

    const result = await sendClaimEmail(email, eventId, eventName, organizerAddress || "");
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("sendClaimEmail error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/email-claim/send-bulk
 * Organizer sends claim emails to multiple attendees
 * Body: { emails: string[], eventId, eventName, organizerAddress }
 */
router.post("/send-bulk", async (req, res) => {
  try {
    const { emails, eventId, eventName, organizerAddress } = req.body;
    if (!Array.isArray(emails) || emails.length === 0 || eventId === undefined || !eventName) {
      return res.status(400).json({ error: "Missing required fields: emails[], eventId, eventName" });
    }

    if (emails.length > 100) {
      return res.status(400).json({ error: "Maximum 100 emails per batch" });
    }

    const results = await sendBulkClaimEmails(emails, eventId, eventName, organizerAddress || "");
    const sent = results.filter(r => r.status === "sent").length;
    const failed = results.filter(r => r.status === "failed").length;

    res.json({ success: true, sent, failed, results });
  } catch (error) {
    console.error("sendBulkClaimEmails error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/email-claim/info/:token
 * Get claim token information (without consuming it)
 */
router.get("/info/:token", (req, res) => {
  const info = getClaimInfo(req.params.token);
  if (!info) {
    return res.status(404).json({ error: "Claim token not found or expired" });
  }
  res.json({
    success: true,
    eventId: info.eventId,
    eventName: info.eventName,
    status: info.status,
    expires: info.expires,
  });
});

/**
 * POST /api/email-claim/redeem
 * Redeem a claim token with a wallet address — triggers on-chain check-in
 * Body: { token, walletAddress }
 */
router.post("/redeem", async (req, res) => {
  try {
    const { token, walletAddress } = req.body;
    if (!token || !walletAddress) {
      return res.status(400).json({ error: "Missing required fields: token, walletAddress" });
    }

    if (!/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const claim = redeemClaimToken(token, walletAddress);
    if (!claim) {
      return res.status(400).json({ error: "Invalid, expired, or already-claimed token" });
    }

    let txResult = null;
    try {
      addPending(claim.eventId, walletAddress, "0x00");
      txResult = await confirmAttendee(claim.eventId, walletAddress);
    } catch (chainErr) {
      const msg = chainErr.message || "";
      if (msg.toLowerCase().includes("already")) {
        txResult = { alreadyConfirmed: true };
      } else {
        console.error("[email-claim] On-chain confirmation failed:", msg);
      }
    }

    res.json({
      success: true,
      eventId: claim.eventId,
      eventName: claim.eventName,
      walletAddress,
      onChainResult: txResult,
    });
  } catch (error) {
    console.error("redeemClaimToken error:", error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
