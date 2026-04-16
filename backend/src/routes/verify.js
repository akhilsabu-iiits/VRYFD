const express = require("express");
const { ethers } = require("ethers");
const { getENSOverride } = require("../services/ensOverrides");
const { getContract } = require("../services/relayerService");

function liveContractAddress() {
  try { return getContract().target; } catch {}
  return process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || null;
}

const router = express.Router();

/**
 * GET /api/verify/:certificateId
 * Public endpoint for certificate verification
 * Called by QR code scan or verification portal
 */
router.get("/:certificateId", async (req, res) => {
  try {
    const { certificateId } = req.params;
    if (!/^\d+$/.test(certificateId) || Number(certificateId) < 1) {
      return res.status(400).json({ verified: false, error: "Invalid certificate ID" });
    }
    const contractAddress = liveContractAddress();
    const rpcUrl = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";

    if (!contractAddress) {
      return res.status(500).json({ error: "Contract not configured" });
    }

    // Read directly from blockchain (no database needed)
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, provider);

    const [eventId, attendee, timestamp, metadataURI, isValid] =
      await contract.verifyCertificate(certificateId);

    // Fetch event details
    const event = await contract.events(eventId);

    // ENS reverse lookup — check project override first, then mainnet
    let ensName = getENSOverride(attendee);
    if (!ensName) {
      try {
        const mainnetProvider = new ethers.JsonRpcProvider(
          `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
        );
        ensName = await mainnetProvider.lookupAddress(attendee);
      } catch {
        // ENS lookup failed — not critical
      }
    }

    res.json({
      verified: true,
      certificateId: Number(certificateId),
      eventName: event.name,
      eventId: Number(eventId),
      attendee,
      attendeeENS: ensName,
      timestamp: Number(timestamp),
      issuedAt: new Date(Number(timestamp) * 1000).toISOString(),
      metadataURI,
      isValid,
      contractAddress,
      chain: "Sepolia",
      explorerURL: `https://sepolia.etherscan.io/address/${contractAddress}#events`,
    });
  } catch (error) {
    if (error.message?.includes("Certificate not found")) {
      return res.status(404).json({ verified: false, error: "Certificate not found" });
    }
    console.error("Verification error:", error);
    res.status(500).json({ error: "Verification failed" });
  }
});

module.exports = router;
