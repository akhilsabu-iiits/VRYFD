const express = require("express");
const multer = require("multer");
const { pinFile, pinJSON, buildBadgeMetadata, buildMilestoneMetadata } = require("../services/ipfsService");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/**
 * POST /api/ipfs/upload-image
 * Upload a badge/milestone image to IPFS
 */
router.post("/upload-image", upload.single("image"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No image provided" });

    const cid = await pinFile(req.file.buffer, req.file.originalname, req.file.mimetype);
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
    const metadata = buildBadgeMetadata(req.body);
    const cid = await pinJSON(metadata, `badge-${req.body.eventId}`);
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
    const metadata = buildMilestoneMetadata(req.body);
    const cid = await pinJSON(metadata, `milestone-${req.body.tierName}`);
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
