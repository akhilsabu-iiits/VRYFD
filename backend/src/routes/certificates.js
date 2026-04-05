const express = require("express");
const { createFullCertificate } = require("../services/certificateService");

const router = express.Router();

/**
 * POST /api/certificates/generate
 * Generate a full certificate (image + QR + IPFS pin)
 * Body: { eventName, eventId, attendeeAddress, attendeeENS, timestamp, certificateId }
 */
router.post("/generate", async (req, res) => {
  try {
    const { eventName, eventId, attendeeAddress, attendeeENS, timestamp, certificateId } = req.body;

    if (!eventName || !attendeeAddress || !timestamp || certificateId === undefined) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const result = await createFullCertificate({
      eventName,
      eventId,
      attendeeAddress,
      attendeeENS: attendeeENS || null,
      timestamp,
      certificateId,
    });

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error("Certificate generation error:", error);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

module.exports = router;
