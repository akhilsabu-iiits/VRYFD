const express = require("express");
const router = express.Router();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const adminAuth = require("../middleware/adminAuth");
const {
  getEventAttendees,
} = require("../services/relayerService");

const DATA_DIR = path.join(__dirname, "../../data");

function readJSON(file) {
  try {
    const fp = path.join(DATA_DIR, file);
    return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null;
  } catch {
    return null;
  }
}

// All admin routes require x-admin-secret header
router.use(adminAuth);

// GET /api/admin/relayer — relayer wallet address + live ETH balance
router.get("/relayer", async (req, res) => {
  try {
    const rpcUrl =
      process.env.ALCHEMY_URL ||
      "https://ethereum-sepolia-rpc.publicnode.com";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    const [balWei, blockNumber] = await Promise.all([
      provider.getBalance(wallet.address),
      provider.getBlockNumber(),
    ]);
    res.json({
      address: wallet.address,
      balanceEth: parseFloat(ethers.formatEther(balWei)).toFixed(6),
      balanceWei: balWei.toString(),
      chain: "Sepolia",
      chainId: 11155111,
      contractAddress: process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || null,
      blockNumber,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/stats — system-wide stats + per-event breakdown
router.get("/stats", async (req, res) => {
  try {
    const deployedEvents = readJSON("deployedEvents.json") || {};
    const allEvents = readJSON("events.json") || [];
    const pending = readJSON("pending.json") || {};

    let totalConfirmed = 0;
    let totalPending = 0;

    // Build event list from persisted JSON — no chain queries, instant response
    const eventList = Object.entries(deployedEvents).map(([localId, data]) => {
      const onChainId = data.onChainId;
      const meta =
        allEvents.find(
          (e) => String(e.onChainId) === String(onChainId)
        ) || {};

      // confirmedCount is persisted to deployedEvents.json by syncMissingAttendeeCounts on startup
      const confirmed =
        typeof data.confirmedCount === "number"
          ? data.confirmedCount
          : Array.isArray(data.confirmedAttendees)
          ? data.confirmedAttendees.length
          : 0;

      const pendingCount = Object.keys(
        pending[String(onChainId)] || {}
      ).length;

      return {
        localId,
        onChainId,
        name: meta.name || `Event #${onChainId}`,
        emoji: meta.emoji || "📅",
        color: meta.color || "#7c6cf0",
        status: meta.status || "unknown",
        startTime: meta.startTime || null,
        endTime: meta.endTime || null,
        joinCode: data.joinCode || "",
        txHash: data.txHash || "",
        confirmedAttendees: confirmed,
        pendingAttendees: pendingCount,
      };
    });

    eventList.forEach((e) => {
      totalConfirmed += e.confirmedAttendees;
      totalPending += e.pendingAttendees;
    });

    res.json({
      totalEvents: eventList.length,
      totalConfirmed,
      totalPending,
      events: eventList,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/admin/events/:onChainId/attendees — confirmed attendee list for an event
router.get("/events/:onChainId/attendees", async (req, res) => {
  try {
    const attendees = await getEventAttendees(req.params.onChainId);
    res.json({ attendees: attendees || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
