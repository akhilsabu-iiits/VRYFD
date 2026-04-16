const express = require("express");
const { ethers } = require("ethers");
const { createFullCertificate } = require("../services/certificateService");
const { getContract, getProvider } = require("../services/relayerService");

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
// Returns the currently-deployed contract address — prefers the live relayer contract
// (updated on every Reset) over the static env var (stale after redeployment).
function liveContractAddress() {
  try { return getContract().target; } catch {}
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || null;
}

router.get("/mine/:address", async (req, res) => {
  try {
    const { address } = req.params;
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
      return res.status(400).json({ error: "Invalid wallet address" });
    }

    const contractAddress = liveContractAddress();
    if (!contractAddress) return res.status(500).json({ error: "Contract not configured" });

    // Prefer the relayer's already-warmed provider (same Alchemy key, no extra RPC setup).
    // Fall back to a fresh provider only if the relayer hasn't initialised yet.
    let readProvider;
    try { readProvider = getProvider(); } catch {
      readProvider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.sepolia.org");
    }
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, readProvider);

    const total = Number(await contract.nextCertificateId());
    const certificates = [];

    // Fetch all certs in parallel — start at 1 (slot 0 is unused, certs are 1-indexed)
    const fetches = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1).map((i) =>
      contract.certificates(BigInt(i)).then(async (cert) => {
        if (Number(cert.timestamp) === 0) return null;  // skip empty slots
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
        };
      }).catch(() => null)
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
    const contractAddress = liveContractAddress();
    if (!contractAddress) return res.status(500).json({ error: "Contract not configured" });

    let readProvider;
    try { readProvider = getProvider(); } catch {
      readProvider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC || "https://rpc.sepolia.org");
    }
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, readProvider);

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

module.exports = router;
