const express = require("express");
const router = express.Router();
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const adminAuth = require("../middleware/adminAuth");
const {
  getContract, getProvider, getEventAttendees, getPendingAttendees,
  queryFilterPaginated,
} = require("../services/relayerService");

const DATA_DIR = path.join(__dirname, "../../data");
const VRYFTokenABI = require("../abis/VRYFToken.json");

// ─── Helpers ──────────────────────────────────────────────────────────────────

function readJSON(file) {
  try {
    const fp = path.join(DATA_DIR, file);
    return fs.existsSync(fp) ? JSON.parse(fs.readFileSync(fp, "utf8")) : null;
  } catch {
    return null;
  }
}

function vryfAddress() {
  return (
    process.env.NEXT_PUBLIC_VRYF_TOKEN_ADDRESS ||
    readJSON("contractState.json")?.vryfTokenAddress ||
    null
  );
}

// All admin routes require x-admin-secret header
router.use(adminAuth);

// ─── GET /api/admin/relayer ───────────────────────────────────────────────────
// Relayer wallet address, ETH balance, latest block
router.get("/relayer", async (req, res) => {
  try {
    const rpcUrl = process.env.ALCHEMY_URL || "https://ethereum-sepolia-rpc.publicnode.com";
    const provider = new ethers.JsonRpcProvider(rpcUrl);
    const rawKey = (process.env.PRIVATE_KEY || "").trim();
    const normalizedKey = rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`;
    const wallet = new ethers.Wallet(normalizedKey, provider);
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

// ─── GET /api/admin/stats ─────────────────────────────────────────────────────
// System-wide counts from persisted JSON — no chain queries
router.get("/stats", async (req, res) => {
  try {
    const deployedEvents = readJSON("deployedEvents.json") || {};
    const allEvents = readJSON("events.json") || [];
    const pending = readJSON("pending.json") || {};

    let totalConfirmed = 0;
    let totalPending = 0;

    const eventList = Object.entries(deployedEvents).map(([localId, data]) => {
      const onChainId = data.onChainId;
      const meta = allEvents.find((e) => String(e.onChainId) === String(onChainId)) || {};

      const confirmed =
        typeof data.confirmedCount === "number"
          ? data.confirmedCount
          : Array.isArray(data.confirmedAttendees)
          ? data.confirmedAttendees.length
          : 0;

      const pendingCount = Object.keys(pending[String(onChainId)] || {}).length;

      totalConfirmed += confirmed;
      totalPending += pendingCount;

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

    res.json({ totalEvents: eventList.length, totalConfirmed, totalPending, events: eventList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/contract-stats ───────────────────────────────────────────
// On-chain view function reads: certificate count, VRYF supply, contract age
router.get("/contract-stats", async (req, res) => {
  try {
    const contract = getContract();
    const provider = getProvider();

    const results = await Promise.allSettled([
      contract.nextCertificateId(),
      contract.nextEventId(),
    ]);

    // nextCertificateId() and nextEventId() are 1-indexed (slot 0 unused).
    // Subtract 1 to get the actual issued/created count.
    const rawNextCertId = results[0].status === "fulfilled" ? Number(results[0].value) : null;
    const totalCerts = rawNextCertId !== null ? Math.max(0, rawNextCertId - 1) : null;
    const nextEventId = results[1].status === "fulfilled" ? Number(results[1].value) : null;

    // VRYF total supply
    let vryfDistributed = null;
    const vryfAddr = vryfAddress();
    if (vryfAddr) {
      try {
        const vryf = new ethers.Contract(vryfAddr, VRYFTokenABI.abi, provider);
        const supply = await vryf.totalSupply();
        vryfDistributed = Math.floor(parseFloat(ethers.formatEther(supply))).toLocaleString();
      } catch {}
    }

    const contractState = readJSON("contractState.json");
    const deployedAt = contractState?.deployedAt || null;

    res.json({
      totalCertificatesIssued: totalCerts,
      totalEventsCreatedOnChain: nextEventId,
      vryfDistributed,
      contractDeployedAt: deployedAt,
      vryfTokenAddress: vryfAddr,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/system ────────────────────────────────────────────────────
// Process health: uptime, memory, environment flags
router.get("/system", async (req, res) => {
  try {
    const mem = process.memoryUsage();
    const uptime = Math.floor(process.uptime());

    res.json({
      uptime,
      nodeVersion: process.version,
      memoryMB: {
        rss:       (mem.rss       / 1024 / 1024).toFixed(1),
        heapUsed:  (mem.heapUsed  / 1024 / 1024).toFixed(1),
        heapTotal: (mem.heapTotal / 1024 / 1024).toFixed(1),
      },
      env: {
        nodeEnv:      process.env.NODE_ENV || "development",
        hasPrivateKey: !!process.env.PRIVATE_KEY,
        hasAlchemyUrl: !!process.env.ALCHEMY_URL,
        hasMongoUri:   !!process.env.MONGODB_URI,
        port:          process.env.PORT || 3001,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/activity ──────────────────────────────────────────────────
// Timeline of all confirmed attendees across all events, newest first
router.get("/activity", async (req, res) => {
  try {
    const deployedEvents = readJSON("deployedEvents.json") || {};
    const allEvents      = readJSON("events.json") || [];

    const entries = [];

    for (const [, data] of Object.entries(deployedEvents)) {
      const meta    = allEvents.find((e) => String(e.onChainId) === String(data.onChainId)) || {};
      const details = Array.isArray(data.confirmedAttendeesDetail) ? data.confirmedAttendeesDetail : [];

      for (const d of details) {
        entries.push({
          type:       "confirmation",
          eventName:  meta.name  || `Event #${data.onChainId}`,
          eventEmoji: meta.emoji || "📅",
          eventColor: meta.color || "#7c6cf0",
          onChainId:  data.onChainId,
          attendee:   d.attendee  || null,
          txHash:     d.txHash    || null,
          timestamp:  d.timestamp || null,
        });
      }

      // Also record the event creation itself as an activity entry
      if (data.txHash) {
        entries.push({
          type:       "event_created",
          eventName:  meta.name  || `Event #${data.onChainId}`,
          eventEmoji: meta.emoji || "📅",
          eventColor: meta.color || "#7c6cf0",
          onChainId:  data.onChainId,
          attendee:   null,
          txHash:     data.txHash,
          timestamp:  meta.startTime || null,
        });
      }
    }

    // Sort newest first; entries with no timestamp go to the bottom
    entries.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));

    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    res.json({ activity: entries.slice(0, limit), total: entries.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── In-memory cache for gas breakdown (expensive log scan) ──────────────────
let _gasBreakdownCache = null;
let _gasBreakdownCachedAt = 0;
let _gasBreakdownContractAddr = null;
const GAS_BREAKDOWN_TTL = 120_000; // 2 minutes

// ─── GET /api/admin/gas ───────────────────────────────────────────────────────
// Gas analysis: actual total gas from log scan + per-operation breakdown + estimates
router.get("/gas", async (req, res) => {
  try {
    const contract = getContract();
    const provider = getProvider();
    const deployedEvents = readJSON("deployedEvents.json") || {};
    const allEvents = readJSON("events.json") || [];

    // Current network gas price
    let currentGasPrice = 1_000_000_000n; // 1 gwei fallback
    try {
      const feeData = await provider.getFeeData();
      currentGasPrice = feeData.gasPrice ?? feeData.maxFeePerGas ?? currentGasPrice;
    } catch {}
    const gasPriceGwei = (Number(currentGasPrice) / 1e9).toFixed(3);

    // Known gas costs per operation (empirical contract analysis)
    const GAS_COSTS = {
      createEvent:     { gas: 280000, label: "Create Event",       icon: "📅" },
      checkInFor:      { gas: 85000,  label: "Confirm Check-in",   icon: "✅" },
      claimBadge:      { gas: 135000, label: "Mint POAP Badge",    icon: "🏅" },
      issueCertificate:{ gas: 160000, label: "Issue Certificate",  icon: "📜" },
      milestoneReward: { gas: 210000, label: "Milestone Reward",   icon: "🏆" },
    };

    function estimateCost(gasUnits) {
      const wei = BigInt(gasUnits) * currentGasPrice;
      return parseFloat(ethers.formatEther(wei));
    }

    // Fetch event creation tx receipts (real data)
    const eventEntries = Object.entries(deployedEvents);
    const receiptResults = await Promise.allSettled(
      eventEntries.map(async ([localId, data]) => {
        if (!data.txHash) return null;
        const [receipt, tx] = await Promise.all([
          provider.getTransactionReceipt(data.txHash),
          provider.getTransaction(data.txHash),
        ]);
        if (!receipt) return null;

        const gasPrice = receipt.gasPrice ?? tx?.gasPrice ?? currentGasPrice;
        const gasUsed  = Number(receipt.gasUsed);
        const ethCost  = parseFloat(ethers.formatEther(receipt.gasUsed * gasPrice));
        const meta     = allEvents.find((e) => String(e.onChainId) === String(data.onChainId)) || {};

        const confirmed =
          typeof data.confirmedCount === "number"
            ? data.confirmedCount
            : Array.isArray(data.confirmedAttendees)
            ? data.confirmedAttendees.length
            : 0;

        return {
          localId,
          onChainId:            data.onChainId,
          eventName:            meta.name || `Event #${data.onChainId}`,
          txHash:               data.txHash,
          blockNumber:          receipt.blockNumber,
          gasUsed,
          gasPriceGwei:         (Number(gasPrice) / 1e9).toFixed(3),
          ethCost:              ethCost.toFixed(8),
          confirmedAttendees:   confirmed,
          estimatedCheckInCost: estimateCost(GAS_COSTS.checkInFor.gas * confirmed).toFixed(8),
        };
      })
    );

    const eventCosts = receiptResults
      .filter((r) => r.status === "fulfilled" && r.value !== null)
      .map((r) => r.value);

    const totalConfirmed = eventEntries.reduce((sum, [, data]) => {
      return sum + (typeof data.confirmedCount === "number"
        ? data.confirmedCount
        : Array.isArray(data.confirmedAttendees) ? data.confirmedAttendees.length : 0);
    }, 0);

    const actualCreationCost   = eventCosts.reduce((s, e) => s + parseFloat(e.ethCost), 0);
    const estimatedConfirmCost = estimateCost(GAS_COSTS.checkInFor.gas * totalConfirmed);

    // ── Actual total gas breakdown via contract log scan (cached 2 min) ────────
    const now = Date.now();
    const contractAddr = contract.target;
    let gasBreakdown = null;

    if (
      _gasBreakdownCache &&
      now - _gasBreakdownCachedAt < GAS_BREAKDOWN_TTL &&
      _gasBreakdownContractAddr === contractAddr
    ) {
      gasBreakdown = _gasBreakdownCache;
    } else {
      try {
        const latest = await provider.getBlockNumber();
        const fromBlock = Math.max(0, latest - 500_000);

        // Scan all relevant event logs in parallel
        const [createdLogs, confirmedLogs, badgeLogs, certLogs, milestoneLogs] = await Promise.all([
          queryFilterPaginated(contract, contract.filters.EventCreated(),        fromBlock, latest).catch(() => []),
          queryFilterPaginated(contract, contract.filters.AttendanceConfirmed(), fromBlock, latest).catch(() => []),
          queryFilterPaginated(contract, contract.filters.BadgeMinted(),         fromBlock, latest).catch(() => []),
          queryFilterPaginated(contract, contract.filters.CertificateIssued(),   fromBlock, latest).catch(() => []),
          queryFilterPaginated(contract, contract.filters.MilestoneReached(),    fromBlock, latest).catch(() => []),
        ]);

        // Collect unique tx hashes per category
        const categories = [
          { key: "createEvent",     label: "Create Event",           icon: "📅", logs: createdLogs },
          { key: "checkInFor",      label: "Confirm Check-in",       icon: "✅", logs: confirmedLogs },
          { key: "claimBadge",      label: "Mint POAP Badge",        icon: "🏅", logs: badgeLogs },
          { key: "issueCertificate",label: "Issue Certificate",      icon: "📜", logs: certLogs },
          { key: "milestoneReward", label: "Milestone Reward",       icon: "🏆", logs: milestoneLogs },
        ];

        // Batch-fetch all unique receipts across all categories
        const allTxHashes = new Set(categories.flatMap(c => c.logs.map(l => l.transactionHash)));
        const receiptMap = new Map();
        await Promise.allSettled([...allTxHashes].map(async (h) => {
          try {
            const r = await provider.getTransactionReceipt(h);
            if (r) receiptMap.set(h, r);
          } catch {}
        }));

        // Aggregate gas per category
        const breakdown = categories.map(({ key, label, icon, logs }) => {
          const uniqueTxs = [...new Set(logs.map(l => l.transactionHash))];
          const totalGasUsed = uniqueTxs.reduce((sum, h) => {
            const r = receiptMap.get(h);
            return sum + (r ? Number(r.gasUsed) : 0);
          }, 0);
          const totalEthCost = uniqueTxs.reduce((sum, h) => {
            const r = receiptMap.get(h);
            if (!r) return sum;
            const gp = r.gasPrice ?? currentGasPrice;
            return sum + parseFloat(ethers.formatEther(r.gasUsed * gp));
          }, 0);
          return {
            key, label, icon,
            txCount:      uniqueTxs.length,
            opCount:      logs.length,
            totalGasUsed,
            ethCost:      totalEthCost.toFixed(8),
          };
        });

        const totalGasUsed = breakdown.reduce((s, b) => s + b.totalGasUsed, 0);
        const totalEthCost = breakdown.reduce((s, b) => s + parseFloat(b.ethCost), 0);

        gasBreakdown = { breakdown, totalGasUsed, totalEthCost: totalEthCost.toFixed(8) };
        _gasBreakdownCache = gasBreakdown;
        _gasBreakdownCachedAt = now;
        _gasBreakdownContractAddr = contractAddr;
      } catch (e) {
        console.warn("[gas] breakdown scan failed:", e.message);
      }
    }

    res.json({
      gasPriceGwei,
      operationCosts: Object.entries(GAS_COSTS).map(([key, { gas, label, icon }]) => ({
        key, label, icon,
        estimatedGas:     gas,
        estimatedCostEth:  estimateCost(gas).toFixed(8),
        estimatedCostGwei: (gas * Number(currentGasPrice) / 1e9).toFixed(0),
      })),
      eventCosts,
      gasBreakdown,
      summary: {
        actualCreationCost:       actualCreationCost.toFixed(8),
        estimatedConfirmCost:     estimatedConfirmCost.toFixed(8),
        estimatedTotalSpent:      (actualCreationCost + estimatedConfirmCost).toFixed(8),
        totalConfirmedAttendees:  totalConfirmed,
        eventsWithReceipts:       eventCosts.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/events/:onChainId/attendees ───────────────────────────────
router.get("/events/:onChainId/attendees", async (req, res) => {
  try {
    const attendees = await getEventAttendees(req.params.onChainId);
    res.json({ attendees: attendees || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/admin/events/:onChainId/pending ─────────────────────────────────
// Pending attendees (entered join code, not yet confirmed on-chain)
router.get("/events/:onChainId/pending", async (req, res) => {
  try {
    const pending = getPendingAttendees(req.params.onChainId);
    res.json({ pending: pending || [] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
