const { ethers } = require("ethers");
const { WebinarSession, AttendanceRecord } = require("../db/schema");
const VryfdABI = require("../abis/VryfdAttendance.json");
const webhookService = require("./webhookService");

// ──────────────────────────────────────────────────────────────────────────────
// Webinar Attendance Service
// Handles webinar attendance tracking, aggregation, and blockchain submission
// ──────────────────────────────────────────────────────────────────────────────

let relayerWallet;
let contract;

/**
 * Initialize the attendance service with relayer credentials
 */
function initAttendanceService() {
  const privateKey = process.env.BACKEND_RELAYER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  const contractAddress = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS;
  const rpcUrl = process.env.SEPOLIA_RPC || "https://ethereum-sepolia-rpc.publicnode.com";

  if (!privateKey || !contractAddress) {
    console.warn("[attendance] Missing BACKEND_RELAYER_PRIVATE_KEY or CONTRACT_ADDRESS — service disabled");
    return;
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const normalizedKey = privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`;
  relayerWallet = new ethers.Wallet(normalizedKey, provider);
  contract = new ethers.Contract(contractAddress, VryfdABI.abi, relayerWallet);

  console.log(`[attendance] Service initialized with relayer: ${relayerWallet.address}`);
}

/**
 * Record a participant joining a webinar session
 * @param {string} eventId - On-chain event ID
 * @param {string} participantAddress - Ethereum address of participant
 * @param {string} sessionId - Unique session identifier
 * @returns {Promise<Object>} Created session document
 */
async function recordJoin(eventId, participantAddress, sessionId) {
  const session = new WebinarSession({
    eventId: String(eventId),
    participantAddress: participantAddress.toLowerCase(),
    joinTime: new Date(),
    sessionId,
  });

  await session.save();
  console.log(`[attendance] Join recorded: event=${eventId} participant=${participantAddress} session=${sessionId}`);
  return session;
}

/**
 * Record a participant leaving a webinar session
 * @param {string} eventId - On-chain event ID
 * @param {string} participantAddress - Ethereum address of participant
 * @param {string} sessionId - Unique session identifier
 * @returns {Promise<Object>} Updated session document with duration
 */
async function recordLeave(eventId, participantAddress, sessionId) {
  const session = await WebinarSession.findOne({
    eventId: String(eventId),
    participantAddress: participantAddress.toLowerCase(),
    sessionId,
    leaveTime: null, // Only update sessions that haven't been closed
  });

  if (!session) {
    throw new Error("Active session not found");
  }

  session.leaveTime = new Date();
  session.duration = Math.round((session.leaveTime - session.joinTime) / 1000 / 60); // Convert to minutes
  await session.save();

  console.log(`[attendance] Leave recorded: event=${eventId} participant=${participantAddress} duration=${session.duration}min`);
  return session;
}

/**
 * Calculate total attendance for a participant in an event
 * @param {string} eventId - On-chain event ID
 * @param {string} participantAddress - Ethereum address of participant
 * @returns {Promise<Object>} Attendance summary
 */
async function calculateAttendance(eventId, participantAddress) {
  const sessions = await WebinarSession.find({
    eventId: String(eventId),
    participantAddress: participantAddress.toLowerCase(),
  }).sort({ joinTime: 1 });

  const totalMinutes = sessions.reduce((sum, session) => {
    return sum + (session.duration || 0);
  }, 0);

  return {
    totalMinutes,
    sessionCount: sessions.length,
    sessions: sessions.map(s => ({
      sessionId: s.sessionId,
      joinTime: s.joinTime,
      leaveTime: s.leaveTime,
      duration: s.duration,
    })),
  };
}

/**
 * Aggregate attendance data for an event and update/create attendance records
 * @param {string} eventId - On-chain event ID
 * @param {number} eventDurationMinutes - Total event duration in minutes
 * @param {number} attendanceThreshold - Percentage required for eligibility (default 75)
 * @returns {Promise<Array>} Array of attendance records
 */
async function aggregateAttendance(eventId, eventDurationMinutes, attendanceThreshold = 75) {
  // Get all unique participants for this event
  const participants = await WebinarSession.distinct("participantAddress", { eventId: String(eventId) });

  const records = [];

  for (const address of participants) {
    const attendance = await calculateAttendance(eventId, address);
    
    // Calculate percentage
    const percentage = eventDurationMinutes > 0 
      ? Math.min(100, Math.round((attendance.totalMinutes / eventDurationMinutes) * 100))
      : 0;

    const eligible = percentage >= attendanceThreshold;

    // Update or create attendance record
    let record = await AttendanceRecord.findOne({
      eventId: String(eventId),
      address: address.toLowerCase(),
    });

    if (record) {
      record.totalMinutes = attendance.totalMinutes;
      record.percentage = percentage;
      record.eligible = eligible;
      record.eventDurationMinutes = eventDurationMinutes;
      record.attendanceThreshold = attendanceThreshold;
      record.sessions = attendance.sessions;
    } else {
      record = new AttendanceRecord({
        eventId: String(eventId),
        address: address.toLowerCase(),
        totalMinutes: attendance.totalMinutes,
        percentage,
        eligible,
        eventDurationMinutes,
        attendanceThreshold,
        sessions: attendance.sessions,
      });
    }

    await record.save();
    records.push(record);
  }

  console.log(`[attendance] Aggregated ${records.length} attendance records for event ${eventId}`);
  return records;
}

/**
 * Submit webinar attendance to blockchain
 * @param {string} eventId - On-chain event ID
 * @param {string} attendeeAddress - Ethereum address of attendee
 * @param {number} minutesPresent - Total minutes the attendee was present
 * @returns {Promise<Object>} Transaction result
 */
async function submitToBlockchain(eventId, attendeeAddress, minutesPresent) {
  if (!contract) {
    throw new Error("Attendance service not initialized");
  }

  try {
    // Call the smart contract's recordWebinarAttendance function
    const tx = await contract.recordWebinarAttendance(
      BigInt(eventId),
      attendeeAddress,
      BigInt(minutesPresent)
    );

    console.log(`[attendance] Blockchain submission tx: ${tx.hash}`);
    
    // Wait for confirmation (with timeout)
    const receipt = await tx.wait(1, 120_000);

    // Update the attendance record
    const record = await AttendanceRecord.findOne({
      eventId: String(eventId),
      address: attendeeAddress.toLowerCase(),
    });

    if (record) {
      record.submittedToBlockchain = true;
      record.blockchainTxHash = receipt.hash;
      record.blockchainSubmittedAt = new Date();
      await record.save();

      webhookService.triggerEvent('attendance.recorded', {
        eventId: String(eventId),
        address: attendeeAddress.toLowerCase(),
        totalMinutes: minutesPresent,
        percentage: record.percentage,
        eligible: record.eligible,
        txHash: receipt.hash,
        timestamp: new Date().toISOString(),
      }).catch(err => console.error('[attendance] Webhook trigger failed:', err));
    }

    console.log(`[attendance] Blockchain submission confirmed: ${receipt.hash}`);
    return { txHash: receipt.hash, success: true };
  } catch (error) {
    console.error(`[attendance] Blockchain submission failed:`, error.message);
    throw error;
  }
}

/**
 * Get all eligible attendees for an event
 * @param {string} eventId - On-chain event ID
 * @returns {Promise<Array>} Array of eligible attendee records
 */
async function getEligibleAttendees(eventId) {
  const records = await AttendanceRecord.find({
    eventId: String(eventId),
    eligible: true,
  }).sort({ percentage: -1, totalMinutes: -1 });

  return records.map(r => ({
    address: r.address,
    totalMinutes: r.totalMinutes,
    percentage: r.percentage,
    sessionCount: r.sessions.length,
    submittedToBlockchain: r.submittedToBlockchain,
    blockchainTxHash: r.blockchainTxHash,
  }));
}

/**
 * Get attendance details for a specific attendee
 * @param {string} eventId - On-chain event ID
 * @param {string} address - Ethereum address
 * @returns {Promise<Object|null>} Attendance record or null
 */
async function getAttendanceDetails(eventId, address) {
  const record = await AttendanceRecord.findOne({
    eventId: String(eventId),
    address: address.toLowerCase(),
  });

  if (!record) {
    return null;
  }

  return {
    address: record.address,
    totalMinutes: record.totalMinutes,
    percentage: record.percentage,
    eligible: record.eligible,
    sessionCount: record.sessions.length,
    sessions: record.sessions,
    submittedToBlockchain: record.submittedToBlockchain,
    blockchainTxHash: record.blockchainTxHash,
    blockchainSubmittedAt: record.blockchainSubmittedAt,
    eventDurationMinutes: record.eventDurationMinutes,
    attendanceThreshold: record.attendanceThreshold,
  };
}

/**
 * Batch submit all eligible attendees to blockchain
 * @param {string} eventId - On-chain event ID
 * @returns {Promise<Array>} Array of submission results
 */
async function batchSubmitToBlockchain(eventId) {
  const eligibleRecords = await AttendanceRecord.find({
    eventId: String(eventId),
    eligible: true,
    submittedToBlockchain: false,
  });

  const results = [];

  for (const record of eligibleRecords) {
    try {
      const result = await submitToBlockchain(eventId, record.address, record.totalMinutes);
      results.push({
        address: record.address,
        status: "success",
        txHash: result.txHash,
      });
    } catch (error) {
      results.push({
        address: record.address,
        status: "failed",
        error: error.message,
      });
    }
  }

  console.log(`[attendance] Batch submission complete: ${results.length} records processed`);
  return results;
}

/**
 * Get attendance statistics for an event
 * @param {string} eventId - On-chain event ID
 * @returns {Promise<Object>} Statistics summary
 */
async function getEventStatistics(eventId) {
  const records = await AttendanceRecord.find({ eventId: String(eventId) });
  
  const stats = {
    totalParticipants: records.length,
    eligibleCount: records.filter(r => r.eligible).length,
    submittedCount: records.filter(r => r.submittedToBlockchain).length,
    averagePercentage: records.length > 0 
      ? Math.round(records.reduce((sum, r) => sum + r.percentage, 0) / records.length)
      : 0,
    averageMinutes: records.length > 0
      ? Math.round(records.reduce((sum, r) => sum + r.totalMinutes, 0) / records.length)
      : 0,
  };

  return stats;
}

module.exports = {
  initAttendanceService,
  recordJoin,
  recordLeave,
  calculateAttendance,
  aggregateAttendance,
  submitToBlockchain,
  batchSubmitToBlockchain,
  getEligibleAttendees,
  getAttendanceDetails,
  getEventStatistics,
};
