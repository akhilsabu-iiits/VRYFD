const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { publicApiAuth, apiCors } = require('../middleware/apiAuth');
const { AttendanceRecord } = require('../db/schema');
const relayerService = require('../services/relayerService');
const certificateService = require('../services/certificateService');

/**
 * Public API Routes
 * External integrations use these endpoints with API keys
 */

// Apply CORS to all public API routes
router.use(apiCors);

// ──────────────────────────────────────────────────────────────────────────────
// Event Endpoints
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/events
 * List all events with pagination and filtering
 * Requires: events:read scope
 */
router.get('/events', publicApiAuth('events:read'), async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      status,
      chainId,
      sortBy = 'date',
      order = 'desc',
    } = req.query;

    // Read events from file
    const eventsPath = path.join(__dirname, '../../data/events.json');
    const deployedEventsPath = path.join(__dirname, '../../data/deployedEvents.json');

    let events = [];
    let deployedEvents = [];

    if (fs.existsSync(eventsPath)) {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    }

    if (fs.existsSync(deployedEventsPath)) {
      deployedEvents = JSON.parse(fs.readFileSync(deployedEventsPath, 'utf8'));
    }

    // Merge events with deployed data
    const mergedEvents = events.map(event => {
      const deployed = deployedEvents.find(d => d.id === event.id);
      return {
        ...event,
        ...(deployed && {
          onChainEventId: deployed.onChainEventId,
          chainId: deployed.chainId,
          contractAddress: deployed.contractAddress,
          txHash: deployed.txHash,
          deployed: true,
        }),
      };
    });

    // Apply filters
    let filteredEvents = mergedEvents;

    if (status) {
      filteredEvents = filteredEvents.filter(e => e.status === status);
    }

    if (chainId) {
      filteredEvents = filteredEvents.filter(e => e.chainId === parseInt(chainId));
    }

    // Sort events
    filteredEvents.sort((a, b) => {
      const aVal = a[sortBy] || '';
      const bVal = b[sortBy] || '';
      const comparison = aVal > bVal ? 1 : -1;
      return order === 'asc' ? comparison : -comparison;
    });

    // Paginate
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedEvents = filteredEvents.slice(startIndex, endIndex);

    res.json({
      success: true,
      data: paginatedEvents,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredEvents.length,
        totalPages: Math.ceil(filteredEvents.length / limit),
      },
    });
  } catch (error) {
    console.error('Error listing events:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list events',
    });
  }
});

/**
 * GET /api/v1/events/:id
 * Get event details by ID
 * Requires: events:read scope
 */
router.get('/events/:id', publicApiAuth('events:read'), async (req, res) => {
  try {
    const { id } = req.params;

    const eventsPath = path.join(__dirname, '../../data/events.json');
    const deployedEventsPath = path.join(__dirname, '../../data/deployedEvents.json');

    let events = [];
    let deployedEvents = [];

    if (fs.existsSync(eventsPath)) {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    }

    if (fs.existsSync(deployedEventsPath)) {
      deployedEvents = JSON.parse(fs.readFileSync(deployedEventsPath, 'utf8'));
    }

    const event = events.find(e => e.id === parseInt(id));

    if (!event) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }

    const deployed = deployedEvents.find(d => d.id === parseInt(id));

    const eventData = {
      ...event,
      ...(deployed && {
        onChainEventId: deployed.onChainEventId,
        chainId: deployed.chainId,
        contractAddress: deployed.contractAddress,
        txHash: deployed.txHash,
        deployed: true,
      }),
    };

    res.json({
      success: true,
      data: eventData,
    });
  } catch (error) {
    console.error('Error getting event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get event',
    });
  }
});

/**
 * GET /api/v1/events/:id/attendees
 * Get attendees for an event
 * Requires: attendance:read scope
 */
router.get('/events/:id/attendees', publicApiAuth('attendance:read'), async (req, res) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 50 } = req.query;

    // Get deployed event info
    const deployedEventsPath = path.join(__dirname, '../../data/deployedEvents.json');
    let deployedEvents = [];

    if (fs.existsSync(deployedEventsPath)) {
      deployedEvents = JSON.parse(fs.readFileSync(deployedEventsPath, 'utf8'));
    }

    const deployed = deployedEvents.find(d => d.id === parseInt(id));

    if (!deployed) {
      return res.status(404).json({
        success: false,
        error: 'Event not deployed on-chain',
      });
    }

    // Get attendance records
    const records = await AttendanceRecord.find({
      eventId: deployed.onChainEventId.toString(),
    })
      .sort({ createdAt: -1 })
      .limit(parseInt(limit))
      .skip((page - 1) * limit);

    const total = await AttendanceRecord.countDocuments({
      eventId: deployed.onChainEventId.toString(),
    });

    res.json({
      success: true,
      data: records.map(r => ({
        address: r.address,
        totalMinutes: r.totalMinutes,
        percentage: r.percentage,
        eligible: r.eligible,
        submittedToBlockchain: r.submittedToBlockchain,
        blockchainTxHash: r.blockchainTxHash,
        sessions: r.sessions,
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('Error getting attendees:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get attendees',
    });
  }
});

/**
 * POST /api/v1/events
 * Create a new event
 * Requires: events:create scope
 */
router.post('/events', publicApiAuth('events:create'), async (req, res) => {
  try {
    const {
      name,
      date,
      emoji = '📅',
      color = '#7c6cf0',
      joinCode,
      chainId = 11155111, // Default to Sepolia
    } = req.body;

    if (!name || !date) {
      return res.status(400).json({
        success: false,
        error: 'Name and date are required',
      });
    }

    const eventsPath = path.join(__dirname, '../../data/events.json');
    let events = [];

    if (fs.existsSync(eventsPath)) {
      events = JSON.parse(fs.readFileSync(eventsPath, 'utf8'));
    }

    // Generate new event ID
    const newId = events.length > 0 ? Math.max(...events.map(e => e.id)) + 1 : 1;

    const newEvent = {
      id: newId,
      name,
      date,
      status: 'upcoming',
      attendees: 0,
      emoji,
      color,
      joinCode: joinCode || this.generateRandomCode(),
      createdViaApi: true,
      apiKeyId: req.apiKeyId,
    };

    events.push(newEvent);

    // Save to file
    fs.writeFileSync(eventsPath, JSON.stringify(events, null, 2));

    res.status(201).json({
      success: true,
      data: newEvent,
      message: 'Event created successfully',
    });
  } catch (error) {
    console.error('Error creating event:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create event',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Attendance Endpoints
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/attendance/:eventId/:address
 * Get attendance record for a specific address at an event
 * Requires: attendance:read scope
 */
router.get('/attendance/:eventId/:address', publicApiAuth('attendance:read'), async (req, res) => {
  try {
    const { eventId, address } = req.params;

    const record = await AttendanceRecord.findOne({
      eventId: eventId.toString(),
      address: address.toLowerCase(),
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found',
      });
    }

    res.json({
      success: true,
      data: {
        eventId: record.eventId,
        address: record.address,
        totalMinutes: record.totalMinutes,
        percentage: record.percentage,
        eligible: record.eligible,
        submittedToBlockchain: record.submittedToBlockchain,
        blockchainTxHash: record.blockchainTxHash,
        blockchainSubmittedAt: record.blockchainSubmittedAt,
        sessions: record.sessions,
      },
    });
  } catch (error) {
    console.error('Error getting attendance:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get attendance record',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Certificate Endpoints
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/certificates/:eventId/:address
 * Get certificate for a specific address at an event
 * Requires: certificates:read scope
 */
router.get('/certificates/:eventId/:address', publicApiAuth('certificates:read'), async (req, res) => {
  try {
    const { eventId, address } = req.params;

    // Check if attendance record exists and is eligible
    const record = await AttendanceRecord.findOne({
      eventId: eventId.toString(),
      address: address.toLowerCase(),
    });

    if (!record) {
      return res.status(404).json({
        success: false,
        error: 'Attendance record not found',
      });
    }

    if (!record.eligible) {
      return res.status(403).json({
        success: false,
        error: 'Not eligible for certificate',
        message: 'Attendance threshold not met',
      });
    }

    // Generate certificate (this would typically call certificateService)
    const certificate = {
      eventId: record.eventId,
      address: record.address,
      attendancePercentage: record.percentage,
      totalMinutes: record.totalMinutes,
      eligible: record.eligible,
      blockchainTxHash: record.blockchainTxHash,
      issuedAt: record.blockchainSubmittedAt,
    };

    res.json({
      success: true,
      data: certificate,
    });
  } catch (error) {
    console.error('Error getting certificate:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get certificate',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Leaderboard Endpoint
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/v1/leaderboard
 * Get global leaderboard
 * Requires: leaderboard:read scope
 */
router.get('/leaderboard', publicApiAuth('leaderboard:read'), async (req, res) => {
  try {
    const { limit = 100, chainId } = req.query;

    // Aggregate attendance records to calculate leaderboard
    const pipeline = [
      {
        $match: {
          submittedToBlockchain: true,
        },
      },
      {
        $group: {
          _id: '$address',
          totalEvents: { $sum: 1 },
          totalMinutes: { $sum: '$totalMinutes' },
          averagePercentage: { $avg: '$percentage' },
        },
      },
      {
        $sort: { totalEvents: -1, totalMinutes: -1 },
      },
      {
        $limit: parseInt(limit),
      },
    ];

    const leaderboard = await AttendanceRecord.aggregate(pipeline);

    res.json({
      success: true,
      data: leaderboard.map((entry, index) => ({
        rank: index + 1,
        address: entry._id,
        totalEvents: entry.totalEvents,
        totalMinutes: entry.totalMinutes,
        averageAttendance: Math.round(entry.averagePercentage),
      })),
      count: leaderboard.length,
    });
  } catch (error) {
    console.error('Error getting leaderboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get leaderboard',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ──────────────────────────────────────────────────────────────────────────────

function generateRandomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

module.exports = router;
