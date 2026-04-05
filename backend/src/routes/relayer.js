const express = require("express");
const { verifySignature, addToQueue, flushQueue, getQueueLength } = require("../services/relayerService");

const router = express.Router();

/**
 * POST /api/relay/checkin
 * Submit a gasless check-in signature for batching
 * Body: { attendee, eventId, nonce, v, r, s, contractAddress, chainId }
 */
router.post("/checkin", async (req, res) => {
  try {
    const { attendee, eventId, nonce, v, r, s, contractAddress, chainId } = req.body;

    // Validate required fields
    if (!attendee || eventId === undefined || !v || !r || !s) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Verify signature before queueing
    const isValid = verifySignature(attendee, eventId, nonce, { v, r, s }, contractAddress, chainId);
    if (!isValid) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // Add to batch queue
    addToQueue(attendee, eventId, v, r, s);

    res.json({
      success: true,
      message: "Check-in queued for batch submission",
      queuePosition: getQueueLength(),
    });
  } catch (error) {
    console.error("Relay error:", error);
    res.status(500).json({ error: "Failed to process check-in" });
  }
});

/**
 * POST /api/relay/flush
 * Force-flush the signature queue (admin only in production)
 */
router.post("/flush", async (req, res) => {
  try {
    const receipt = await flushQueue();
    res.json({
      success: true,
      txHash: receipt?.hash || null,
      message: receipt ? "Batch submitted" : "Queue was empty",
    });
  } catch (error) {
    console.error("Flush error:", error);
    res.status(500).json({ error: "Failed to flush queue" });
  }
});

/**
 * GET /api/relay/status
 * Check the queue status
 */
router.get("/status", (req, res) => {
  res.json({ queueLength: getQueueLength() });
});

module.exports = router;
