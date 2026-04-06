const express = require("express");
const {
  verifySignature,
  addToQueue,
  flushQueue,
  getQueueLength,
  createEvent,
  issueCertificate,
  revokeCertificate,
} = require("../services/relayerService");

const router = express.Router();

/**
 * POST /api/relay/createEvent
 * Organizer creates event — backend pays gas (has ORGANIZER_ROLE)
 * Body: { name, metadataURI, startTime, endTime }
 */
router.post("/createEvent", async (req, res) => {
  try {
    const { name, metadataURI, startTime, endTime } = req.body;
    if (!name || !startTime || !endTime) {
      return res.status(400).json({ error: "Missing required fields: name, startTime, endTime" });
    }
    const result = await createEvent(name, metadataURI || "", startTime, endTime);
    res.json({ success: true, ...result });
  } catch (error) {
    console.error("createEvent error:", error.message);
    res.status(500).json({ error: error.message });
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
 * POST /api/relay/checkin
 * Gasless check-in via EIP-712 signature
 */
router.post("/checkin", async (req, res) => {
  try {
    const { attendee, eventId, nonce, v, r, s, contractAddress, chainId } = req.body;
    if (!attendee || eventId === undefined || !v || !r || !s) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const isValid = verifySignature(attendee, eventId, nonce, { v, r, s }, contractAddress, chainId);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid signature" });
    }
    addToQueue(attendee, eventId, v, r, s);
    res.json({ success: true, message: "Check-in queued", queuePosition: getQueueLength() });
  } catch (error) {
    console.error("Relay error:", error);
    res.status(500).json({ error: "Failed to process check-in" });
  }
});

/**
 * POST /api/relay/flush — force flush the queue
 */
router.post("/flush", async (req, res) => {
  try {
    const receipt = await flushQueue();
    res.json({ success: true, txHash: receipt?.hash || null });
  } catch (error) {
    res.status(500).json({ error: "Failed to flush queue" });
  }
});

/**
 * GET /api/relay/status
 */
router.get("/status", (req, res) => {
  res.json({ queueLength: getQueueLength() });
});

module.exports = router;
