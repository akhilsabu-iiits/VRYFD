/**
 * /api/badge/*  — ERC-721 POAP badge endpoints.
 *
 * Flow:
 *   1. Organizer → POST /set-metadata  (save the badge URI for an event on-chain)
 *   2. Attendee  → GET  /claim-domain  (grab EIP-712 domain so wallet can sign)
 *   3. Attendee  → GET  /claim-nonce/:addr
 *   4. Attendee  → POST /claim-gasless (signature + eventId → relayer pays gas, mints NFT)
 *   5. Anyone    → GET  /event/:id    (inspect a registered badge URI)
 *   6. Attendee  → GET  /mine/:addr   (list their badges)
 */
const express = require("express");
const { authMiddleware, requireRole } = require("../services/authService");
const {
  getBadgeAddress,
  getClaimDomain,
  setEventBadge,
  getEventBadge,
  hasClaimedBadge,
  getClaimNonce,
  gaslessClaimBadge,
  getMyBadges,
  isEligible,
} = require("../services/badgeService");

const router = express.Router();

function isValidAddress(s) {
  return typeof s === "string" && /^0x[a-fA-F0-9]{40}$/.test(s);
}

function isValidEventId(s) {
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && String(n) === String(s).replace(/^0+(?=\d)/, "");
}

// ── Public configuration ──────────────────────────────────────────────

router.get("/config", async (_req, res) => {
  try {
    res.json({
      contract: getBadgeAddress(),
      domain: await getClaimDomain(),
      types: {
        ClaimBadge: [
          { name: "attendee", type: "address" },
          { name: "eventId",  type: "uint256" },
          { name: "nonce",    type: "uint256" },
        ],
      },
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/claim-domain", async (_req, res) => {
  try {
    res.json({ domain: await getClaimDomain() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/claim-nonce/:address", async (req, res) => {
  try {
    if (!isValidAddress(req.params.address)) return res.status(400).json({ error: "Invalid address" });
    res.json({ nonce: await getClaimNonce(req.params.address) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Organizer-only: set the per-event badge metadata URI ───────────────

router.post("/set-metadata", authMiddleware, requireRole("organizer", "admin"), async (req, res) => {
  try {
    const { eventId, metadataURI } = req.body || {};
    if (!isValidEventId(eventId)) return res.status(400).json({ error: "Invalid eventId" });
    if (!metadataURI || typeof metadataURI !== "string") {
      return res.status(400).json({ error: "metadataURI required" });
    }
    const result = await setEventBadge(eventId, metadataURI);
    res.json({ success: true, ...result });
  } catch (e) {
    const msg = e?.reason || e?.shortMessage || e?.message || String(e);
    if (msg.includes("NotEventOrganizer")) return res.status(403).json({ error: "You are not the event organizer" });
    if (msg.includes("EventNotFound"))     return res.status(404).json({ error: "Event not found" });
    console.error("[badge.set-metadata]", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Public read: event badge status ────────────────────────────────────

router.get("/event/:eventId", async (req, res) => {
  try {
    if (!isValidEventId(req.params.eventId)) return res.status(400).json({ error: "Invalid eventId" });
    const uri = await getEventBadge(req.params.eventId);
    res.json({ eventId: req.params.eventId, metadataURI: uri, configured: Boolean(uri) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/claim-status", async (req, res) => {
  try {
    const { eventId, address } = req.query;
    if (!isValidEventId(eventId)) return res.status(400).json({ error: "Invalid eventId" });
    if (!isValidAddress(address)) return res.status(400).json({ error: "Invalid address" });
    const [claimed, eligible] = await Promise.all([
      hasClaimedBadge(eventId, address),
      isEligible(eventId, address),
    ]);
    res.json({ claimed, eligible });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Attendee: gasless claim (requires signed EIP-712) ──────────────────

router.post("/claim-gasless", async (req, res) => {
  try {
    const { attendee, eventId, signature } = req.body || {};
    if (!isValidAddress(attendee)) return res.status(400).json({ error: "Invalid attendee address" });
    if (!isValidEventId(eventId))  return res.status(400).json({ error: "Invalid eventId" });
    if (!signature || typeof signature !== "string" || !signature.startsWith("0x")) {
      return res.status(400).json({ error: "signature required (0x-prefixed hex)" });
    }
    const result = await gaslessClaimBadge(attendee, eventId, signature);
    res.json({ success: true, ...result });
  } catch (e) {
    const msg = e?.message || "Badge claim failed";
    if (msg === "Badge already claimed") return res.status(409).json({ error: msg });
    if (msg.includes("not configured a badge")) return res.status(409).json({ error: msg });
    if (msg.includes("threshold"))          return res.status(409).json({ error: msg });
    if (msg.includes("Signature"))          return res.status(400).json({ error: msg });
    console.error("[badge.claim-gasless]", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Attendee: list my badges ───────────────────────────────────────────

router.get("/mine/:address", async (req, res) => {
  try {
    if (!isValidAddress(req.params.address)) return res.status(400).json({ error: "Invalid address" });
    const badges = await getMyBadges(req.params.address);
    res.json({ badges });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
