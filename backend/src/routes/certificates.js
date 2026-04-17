const express = require("express");
const { ethers } = require("ethers");
const { createFullCertificate } = require("../services/certificateService");
const certificateService = require("../services/certificateService");

const router = express.Router();

// ── Per-address rate limiter for certificate generation ───────────────────────
// Prevents a single address from spamming IPFS uploads (Pinata cost + CPU load).
// Uses a simple in-memory map: address → timestamp of last allowed request.
const certGenLastRequest = new Map();
const CERT_GEN_COOLDOWN_MS = 30_000; // 30 seconds between generations per address

function certGenRateLimit(req, res, next) {
  const { attendeeAddress } = req.body;
  if (!attendeeAddress) return next(); // validation handled below
  const key = attendeeAddress.toLowerCase();
  const last = certGenLastRequest.get(key) ?? 0;
  const now = Date.now();
  if (now - last < CERT_GEN_COOLDOWN_MS) {
    const retryAfter = Math.ceil((CERT_GEN_COOLDOWN_MS - (now - last)) / 1000);
    return res.status(429).json({ error: `Rate limited — retry in ${retryAfter}s` });
  }
  certGenLastRequest.set(key, now);
  next();
}

/**
 * GET /api/certificates/mine/:address
 * Returns all valid on-chain certificates issued to a wallet address.
 * Reads directly from Sepolia — source of truth.
 */
router.get("/mine/:address", async (req, res) => {
  try {
    const address = decodeURIComponent(req.params.address);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.json({ success: true, certificates: [], note: "Wallet required" });
    }

    const rpcUrl = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    if (!contractAddress) return res.status(500).json({ error: "Contract not configured" });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, provider);

    const total = Number(await contract.nextCertificateId());
    const certificates = [];
    const fetches = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1).map((i) =>
      contract
        .certificates(BigInt(i))
        .then(async (cert) => {
          if (Number(cert.timestamp) === 0) return null;
          if (cert.attendee.toLowerCase() !== address.toLowerCase()) return null;
          const ev = await contract.events(cert.eventId);
          return {
            certId: i,
            eventId: Number(cert.eventId),
            eventName: ev.name,
            attendee: cert.attendee,
            timestamp: Number(cert.timestamp),
            metadataURI: cert.metadataURI,
            isValid: cert.isValid,
            onChain: true,
          };
        })
        .catch(() => null)
    );
    const results = await Promise.all(fetches);
    results.forEach((c) => { if (c) certificates.push(c); });

    res.json({ success: true, certificates });
  } catch (error) {
    console.error("certificates/mine error:", error.message);
    res.status(500).json({ error: "Failed to fetch certificates" });
  }
});

/**
 * POST /api/certificates/generate
 * Generate a full certificate (image + QR + IPFS pin).
 * Verifies on-chain that the certificate exists and belongs to the attendee before generating.
 * Body: { certificateId, attendeeAddress, attendeeENS? }
 */
router.post("/generate", certGenRateLimit, async (req, res) => {
  try {
    const { certificateId, attendeeAddress, attendeeENS } = req.body;

    if (certificateId === undefined || !attendeeAddress) {
      return res.status(400).json({ error: "Missing required fields: certificateId, attendeeAddress" });
    }
    if (!/^\d+$/.test(String(certificateId)) || Number(certificateId) < 1) {
      return res.status(400).json({ error: "Invalid certificateId — must be a positive integer" });
    }
    if (!/^0x[0-9a-fA-F]{40}$/.test(attendeeAddress)) {
      return res.status(400).json({ error: "Invalid attendee address" });
    }
    if (attendeeENS !== undefined && attendeeENS !== null && attendeeENS !== "") {
      if (typeof attendeeENS !== "string" || attendeeENS.length > 100 || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(attendeeENS)) {
        return res.status(400).json({ error: "Invalid ENS name format" });
      }
    }

    // Verify on-chain: certificate must exist and belong to this attendee
    const rpcUrl = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    if (!contractAddress) return res.status(500).json({ error: "Contract not configured" });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, provider);

    const cert = await contract.certificates(BigInt(certificateId));
    if (Number(cert.timestamp) === 0) {
      return res.status(404).json({ error: "Certificate not found on-chain" });
    }
    if (cert.attendee.toLowerCase() !== attendeeAddress.toLowerCase()) {
      return res.status(403).json({ error: "Certificate does not belong to this address" });
    }
    if (!cert.isValid) {
      return res.status(400).json({ error: "Certificate has been revoked" });
    }

    const ev = await contract.events(cert.eventId);

    const result = await createFullCertificate({
      eventName: ev.name,
      eventId: Number(cert.eventId),
      attendeeAddress,
      attendeeENS: attendeeENS || null,
      timestamp: Number(cert.timestamp),
      certificateId,
    });

    res.json({ success: true, ...result });
  } catch (error) {
    console.error("Certificate generation error:", error);
    res.status(500).json({ error: "Failed to generate certificate" });
  }
});

/**
 * GET /api/certificates/image/:certificateId
 * Returns a generated PNG of the certificate streamed inline.
 * No IPFS round-trip; ideal for instant preview / print / download in the UI.
 *
 * The certificate data is fetched from the on-chain contract so the rendered
 * image is always in sync with the source of truth.
 */
router.get("/image/:certificateId", async (req, res) => {
  try {
    const { certificateId } = req.params;
    if (!/^\d+$/.test(certificateId) || Number(certificateId) < 1) {
      return res.status(400).json({ error: "Invalid certificate ID" });
    }

    const rpcUrl = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";
    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    if (!contractAddress) return res.status(500).json({ error: "Contract not configured" });

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, provider);

    let cert;
    try {
      cert = await contract.certificates(BigInt(certificateId));
    } catch {
      return res.status(404).json({ error: "Certificate not found on-chain" });
    }
    if (Number(cert.timestamp) === 0) {
      return res.status(404).json({ error: "Certificate not found on-chain" });
    }

    const ev = await contract.events(cert.eventId);

    // --- Resolve attendee display name ---
    // Preference order (same as the organizer attendees endpoint):
    //   1. Name stored on the session at check-in (wallet-only sign-ups)
    //   2. Registered user record by wallet (email signups that linked a wallet)
    //   3. Registered user record by email (if any)
    //   4. Truncated wallet address (0x1234…abcd) — never the full 42-char hex
    let attendeeName = null;
    try {
      const { getUserByWallet } = require("../services/authService");
      const user = getUserByWallet?.(cert.attendee);
      if (user?.name) attendeeName = user.name;
    } catch {}
    // Sessions (in-memory) may know the name for wallet-only sign-ups.
    // attendanceSessions is exported by attendance.js; fall back silently if unavailable.
    if (!attendeeName) {
      try {
        const attendanceRoute = require("./attendance");
        const sessions = attendanceRoute.__getSessions?.();
        if (sessions) {
          for (const s of sessions.values()) {
            if (
              s.attendee?.toLowerCase() === cert.attendee.toLowerCase() &&
              s.name
            ) {
              attendeeName = s.name;
              break;
            }
          }
        }
      } catch {}
    }
    if (!attendeeName) {
      attendeeName = `${cert.attendee.slice(0, 6)}…${cert.attendee.slice(-4)}`;
    }

    // --- Resolve organizer display name ---
    // The event stored in events.json records organizer email (createdBy).
    // We look up their display name (and fall back to a short ETH address
    // or the word "VRYFD Organizer" if nothing matches).
    let organizerName = "VRYFD Organizer";
    try {
      const { getAllEvents } = require("../services/relayerService");
      const events = getAllEvents() || [];
      const onChainIdStr = String(cert.eventId);
      const evMeta = events.find(
        (e) =>
          String(e.onChainId) === onChainIdStr ||
          String(e.id) === onChainIdStr ||
          String(e.eventId) === onChainIdStr
      );
      if (evMeta) {
        const { getUserByEmail } = require("../services/authService");
        const orgEmail = evMeta.organizer || evMeta.createdBy;
        if (orgEmail) {
          const orgUser = getUserByEmail(orgEmail);
          if (orgUser?.name) {
            organizerName = orgUser.name;
          } else {
            // fall back to local-part of the email
            organizerName = String(orgEmail).split("@")[0];
          }
        }
      }
    } catch (e) {
      console.warn("[cert image] could not resolve organizer name:", e.message);
    }

    const date = new Date(Number(cert.timestamp) * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });

    const png = await certificateService.generateCertificateImage({
      eventName: ev.name,
      attendeeName,
      organizerName,
      date,
      certificateId: Number(certificateId),
    });

    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=300");
    res.send(png);
  } catch (error) {
    console.error("[certificates/image] error:", error);
    res.status(500).json({ error: error.message || "Failed to render certificate" });
  }
});

module.exports = router;
