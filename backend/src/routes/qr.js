const express = require('express');
const router = express.Router();
const qrService = require('../services/qrService');
const { ethers } = require('ethers');
const VryfdAttendanceABI = require('../abis/VryfdAttendance.json');
const chains = require('../config/chains');

/**
 * GET /api/qr/generate/:eventId
 * Generate QR code for attendee check-in
 * Query params: attendee (wallet address or email), checkpoint (optional), chainId (optional)
 */
router.get('/generate/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { attendee, checkpoint = 'entry', chainId = '100' } = req.query;
    
    if (!attendee) {
      return res.status(400).json({ error: 'Attendee identifier is required' });
    }
    
    const qrData = await qrService.generateQRData(
      eventId,
      attendee,
      checkpoint,
      parseInt(chainId)
    );
    
    const qrImage = await qrService.generateQRImage(qrData);
    
    res.json({
      success: true,
      qrData,
      qrImage
    });
  } catch (error) {
    console.error('Error generating QR code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/qr/event-checkin/:eventId
 * Generate a QR code that encodes a check-in URL for in-person events.
 * Attendees scan this with their phone camera to open the check-in page.
 */
router.get('/event-checkin/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const frontendUrl = process.env.NEXT_PUBLIC_FRONTEND_URL || 'http://localhost:3000';
    const checkinUrl = `${frontendUrl}/live/${eventId}?checkin=true`;

    const qrImage = await qrService.generateQRImage({ url: checkinUrl, eventId, type: 'event-checkin' });

    res.json({
      success: true,
      checkinUrl,
      qrImage,
      eventId
    });
  } catch (error) {
    console.error('Error generating event check-in QR:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/qr/organizer/:eventId
 * Generate organizer QR code for event (for display/printing)
 * Query params: chainId (optional)
 */
router.get('/organizer/:eventId', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { chainId = '100' } = req.query;
    
    const result = await qrService.generateOrganizerQR(
      eventId,
      parseInt(chainId)
    );
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('Error generating organizer QR code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/qr/validate
 * Validate scanned QR code
 * Body: { qrData: string (JSON) }
 */
router.post('/validate', async (req, res) => {
  try {
    const { qrData } = req.body;
    
    if (!qrData) {
      return res.status(400).json({ error: 'QR data is required' });
    }
    
    // Parse QR code if it's a string
    let parsedData;
    if (typeof qrData === 'string') {
      parsedData = qrService.parseQRCode(qrData);
    } else {
      parsedData = qrData;
    }
    
    // Validate QR code
    const validation = qrService.validateQRData(parsedData);
    
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }
    
    res.json({
      success: true,
      data: validation.data
    });
  } catch (error) {
    console.error('Error validating QR code:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/qr/checkin
 * Process physical check-in with QR code
 * Body: { qrData, signature, chainId }
 */
router.post('/checkin', async (req, res) => {
  try {
    const { qrData, signature, chainId = 100 } = req.body;
    
    if (!qrData || !signature) {
      return res.status(400).json({ error: 'QR data and signature are required' });
    }
    
    // Validate QR code
    const validation = qrService.validateQRData(qrData);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error
      });
    }
    
    // Verify signature
    try {
      const recoveredAddress = qrService.verifyCheckInSignature(qrData, signature);
      
      // Check if recovered address matches attendee or is authorized
      if (recoveredAddress.toLowerCase() !== qrData.attendee.toLowerCase()) {
        return res.status(401).json({
          success: false,
          error: 'Signature verification failed'
        });
      }
    } catch (error) {
      return res.status(401).json({
        success: false,
        error: 'Invalid signature'
      });
    }
    
    // Mark nonce as used
    qrService.markNonceAsUsed(qrData.nonce);
    
    // Get chain configuration
    const chainConfig = chains.SUPPORTED_CHAINS.find(c => c.id === parseInt(chainId));
    if (!chainConfig) {
      return res.status(400).json({ error: 'Unsupported chain' });
    }
    
    // Prepare contract interaction data
    const contractData = {
      eventId: qrData.eventId,
      attendee: qrData.attendee,
      checkpoint: qrData.checkpoint || 'entry',
      timestamp: qrData.timestamp,
      nonce: qrData.nonce,
      signature,
      chainId: parseInt(chainId)
    };
    
    res.json({
      success: true,
      message: 'Check-in validated successfully',
      data: contractData
    });
  } catch (error) {
    console.error('Error processing check-in:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/qr/:eventId/stats
 * Get check-in statistics for an event
 * Query params: chainId (optional)
 */
router.get('/:eventId/stats', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { chainId = '100' } = req.query;
    
    // Get chain configuration
    const chainConfig = chains.SUPPORTED_CHAINS.find(c => c.id === parseInt(chainId));
    if (!chainConfig) {
      return res.status(400).json({ error: 'Unsupported chain' });
    }
    
    // Connect to contract
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const contract = new ethers.Contract(
      chainConfig.contractAddress,
      VryfdAttendanceABI,
      provider
    );
    
    // Get event details
    const event = await contract.events(eventId);
    
    // Get check-ins from contract events
    // Note: In production, you'd want to index these events in a database
    const filter = contract.filters.PhysicalCheckIn(eventId);
    const checkInEvents = await contract.queryFilter(filter);
    
    const checkIns = checkInEvents.map(event => ({
      eventId: event.args.eventId.toString(),
      attendee: event.args.attendee,
      checkpoint: event.args.checkpoint || 'entry',
      timestamp: Number(event.args.timestamp),
      transactionHash: event.transactionHash,
      blockNumber: event.blockNumber
    }));
    
    // Calculate statistics
    const stats = qrService.getCheckInStats(checkIns);
    
    res.json({
      success: true,
      eventId,
      eventName: event.name,
      stats
    });
  } catch (error) {
    console.error('Error fetching check-in stats:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/qr/:eventId/export
 * Export check-in data as CSV
 * Query params: chainId (optional)
 */
router.get('/:eventId/export', async (req, res) => {
  try {
    const { eventId } = req.params;
    const { chainId = '100' } = req.query;
    
    // Get chain configuration
    const chainConfig = chains.SUPPORTED_CHAINS.find(c => c.id === parseInt(chainId));
    if (!chainConfig) {
      return res.status(400).json({ error: 'Unsupported chain' });
    }
    
    // Connect to contract
    const provider = new ethers.JsonRpcProvider(chainConfig.rpcUrl);
    const contract = new ethers.Contract(
      chainConfig.contractAddress,
      VryfdAttendanceABI,
      provider
    );
    
    // Get check-ins from contract events
    const filter = contract.filters.PhysicalCheckIn(eventId);
    const checkInEvents = await contract.queryFilter(filter);
    
    const checkIns = checkInEvents.map(event => ({
      eventId: event.args.eventId.toString(),
      attendee: event.args.attendee,
      checkpoint: event.args.checkpoint || 'entry',
      timestamp: Number(event.args.timestamp),
      transactionHash: event.transactionHash
    }));
    
    // Generate CSV
    const csv = qrService.exportToCSV(checkIns);
    
    // Set headers for file download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=event-${eventId}-checkins.csv`);
    res.send(csv);
  } catch (error) {
    console.error('Error exporting check-in data:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/qr/parse
 * Parse scanned QR code string
 * Body: { qrString }
 */
router.post('/parse', async (req, res) => {
  try {
    const { qrString } = req.body;
    
    if (!qrString) {
      return res.status(400).json({ error: 'QR string is required' });
    }
    
    const parsedData = qrService.parseQRCode(qrString);
    
    res.json({
      success: true,
      data: parsedData
    });
  } catch (error) {
    console.error('Error parsing QR code:', error);
    res.status(400).json({ error: 'Invalid QR code format' });
  }
});

module.exports = router;
