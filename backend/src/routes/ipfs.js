const express = require("express");
const multer = require("multer");
const { pinFile, pinJSON, buildBadgeMetadata, buildMilestoneMetadata } = require("../services/ipfsService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
]);

/**
 * POST /api/ipfs/upload-image
 * Upload a badge/milestone image to IPFS
 */
router.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image provided" });
    if (!ALLOWED_MIME_TYPES.has(req.file.mimetype)) {
      return res.status(400).json({ error: "Unsupported file type — allowed: png, jpg, gif, webp, svg" });
    }

    // Use a sanitised server-side filename instead of the user-supplied originalname
    const ext = req.file.mimetype.split("/")[1].replace("svg+xml", "svg");
    const filename = `vryfd-upload-${Date.now()}.${ext}`;
    const cid = await pinFile(req.file.buffer, filename, req.file.mimetype);
    res.json({
      success: true,
      cid,
      url: `ipfs://${cid}`,
      gateway: `https://gateway.pinata.cloud/ipfs/${cid}`,
    });
  } catch (error) {
    console.error("IPFS upload error:", error);
    res.status(500).json({ error: "Failed to upload to IPFS" });
  }
});

/**
 * POST /api/ipfs/badge-metadata
 * Create and pin POAP badge metadata
 * Body: { eventName, eventId, description, imageCID, eventDate, organizer }
 */
router.post("/badge-metadata", async (req, res) => {
  try {
    const { eventName, eventId, description, imageCID, eventDate, organizer } = req.body;
    if (!eventName || eventId === undefined) {
      return res.status(400).json({ error: "Missing required fields: eventName, eventId" });
    }
    if (typeof eventName !== "string" || eventName.length > 200) {
      return res.status(400).json({ error: "eventName must be a string ≤ 200 chars" });
    }
    const metadata = buildBadgeMetadata({ eventName, eventId, description, imageCID, eventDate, organizer });
    const cid = await pinJSON(metadata, `badge-${eventId}`);
    res.json({
      success: true,
      cid,
      uri: `ipfs://${cid}`,
      metadata,
    });
  } catch (error) {
    console.error("Badge metadata error:", error);
    res.status(500).json({ error: "Failed to create badge metadata" });
  }
});

/**
 * POST /api/ipfs/milestone-metadata
 * Create and pin milestone reward NFT metadata
 * Body: { tierName, threshold, imageCID, attendeeENS }
 */
router.post("/milestone-metadata", async (req, res) => {
  try {
    const { tierName, threshold, imageCID, attendeeENS } = req.body;
    if (!tierName || threshold === undefined) {
      return res.status(400).json({ error: "Missing required fields: tierName, threshold" });
    }
    if (typeof tierName !== "string" || tierName.length > 100) {
      return res.status(400).json({ error: "tierName must be a string ≤ 100 chars" });
    }
    const metadata = buildMilestoneMetadata({ tierName, threshold, imageCID, attendeeENS });
    const cid = await pinJSON(metadata, `milestone-${tierName}`);
    res.json({
      success: true,
      cid,
      uri: `ipfs://${cid}`,
      metadata,
    });
  } catch (error) {
    console.error("Milestone metadata error:", error);
    res.status(500).json({ error: "Failed to create milestone metadata" });
  }
});

module.exports = router;
