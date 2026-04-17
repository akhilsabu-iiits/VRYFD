const express = require("express");
const { ethers } = require("ethers");
const { getENSOverride } = require("../services/ensOverrides");

const router = express.Router();

/**
 * GET /api/verify/:certificateId
 * Public endpoint for on-chain certificate verification.
 * Reads directly from the VryfdAttendance contract — single source of truth.
 */
router.get("/:certificateId", async (req, res) => {
  try {
    const { certificateId } = req.params;
    if (!/^\d+$/.test(certificateId) || Number(certificateId) < 1) {
      return res.status(400).json({ verified: false, error: "Invalid certificate ID" });
    }

    const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
    const rpcUrl = process.env.SEPOLIA_RPC || "https://rpc.sepolia.org";
    if (!contractAddress) {
      return res.status(500).json({ verified: false, error: "Contract not configured" });
    }

    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const VryfdABI = require("../abis/VryfdAttendance.json");
    const contract = new ethers.Contract(contractAddress, VryfdABI.abi, provider);

    let eventId, attendee, timestamp, metadataURI, isValid;
    try {
      [eventId, attendee, timestamp, metadataURI, isValid] =
        await contract.verifyCertificate(certificateId);
    } catch (e) {
      const msg = e.message || "";
      if (msg.includes("Certificate not found") || msg.includes("nonexistent")) {
        return res.status(404).json({ verified: false, error: "Certificate not found on-chain" });
      }
      throw e;
    }

    const event = await contract.events(eventId);

    let ensName = getENSOverride(attendee);
    if (!ensName && process.env.ALCHEMY_API_KEY) {
      try {
        const mainnetProvider = new ethers.JsonRpcProvider(
          `https://eth-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_API_KEY}`
        );
        ensName = await mainnetProvider.lookupAddress(attendee);
      } catch {}
    }

    return res.json({
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
      onChain: true,
      contractAddress,
      chain: "Sepolia",
      explorerURL: `https://sepolia.etherscan.io/address/${contractAddress}#events`,
    });
  } catch (error) {
    console.error("Verification error:", error);
    res.status(500).json({ verified: false, error: error.message || "Verification failed" });
  }
});

module.exports = router;
