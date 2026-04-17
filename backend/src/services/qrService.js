const { ethers } = require('ethers');
const QRCode = require('qrcode');
const { v4: uuidv4 } = require('uuid');

class QRService {
  constructor() {
    // Store used nonces to prevent replay attacks
    // In production, use Redis or database
    this.usedNonces = new Set();
    
    // QR code expiry time (5 minutes)
    this.QR_EXPIRY_MS = 5 * 60 * 1000;
    
    // EIP-712 domain for signing
    this.EIP712_DOMAIN = {
      name: 'VRYFD Physical Check-In',
      version: '1',
      chainId: 100, // Gnosis Chain
    };
    
    // EIP-712 types for check-in
    this.CHECKIN_TYPES = {
      CheckIn: [
        { name: 'eventId', type: 'uint256' },
        { name: 'attendee', type: 'address' },
        { name: 'timestamp', type: 'uint256' },
        { name: 'nonce', type: 'string' },
        { name: 'checkpoint', type: 'string' }
      ]
    };
  }

  /**
   * Generate QR code data for an event
   * @param {string} eventId - Event ID
   * @param {string} attendeeAddress - Attendee wallet address
   * @param {string} checkpoint - Checkpoint name (entry, exit, session1, etc.)
   * @param {number} chainId - Chain ID
   * @returns {Object} QR code data with signature
   */
  async generateQRData(eventId, attendeeAddress, checkpoint = 'entry', chainId = 100) {
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = uuidv4();
    
    const qrData = {
      eventId: eventId.toString(),
      attendee: attendeeAddress,
      timestamp,
      nonce,
      checkpoint,
      chainId,
      expiresAt: timestamp + Math.floor(this.QR_EXPIRY_MS / 1000)
    };
    
    return qrData;
  }

  /**
   * Generate QR code image
   * @param {Object} qrData - QR code data
   * @returns {Promise<string>} Base64 encoded QR code image
   */
  async generateQRImage(qrData) {
    try {
      const dataString = JSON.stringify(qrData);
      const qrCodeDataURL = await QRCode.toDataURL(dataString, {
        errorCorrectionLevel: 'H',
        type: 'image/png',
        width: 400,
        margin: 2,
        color: {
          dark: '#000000',
          light: '#FFFFFF'
        }
      });
      
      return qrCodeDataURL;
    } catch (error) {
      console.error('Error generating QR code:', error);
      throw new Error('Failed to generate QR code image');
    }
  }

  /**
   * Validate QR code data
   * @param {Object} qrData - Scanned QR code data
   * @returns {Object} Validation result
   */
  validateQRData(qrData) {
    const now = Math.floor(Date.now() / 1000);
    
    // Check required fields (attendee can be wallet or email)
    if (!qrData.eventId || !qrData.attendee || !qrData.timestamp || !qrData.nonce) {
      return {
        valid: false,
        error: 'Missing required fields in QR code data'
      };
    }
    
    // Check if QR code has expired
    if (qrData.expiresAt && now > qrData.expiresAt) {
      return {
        valid: false,
        error: 'QR code has expired'
      };
    }
    
    // Check if nonce has been used (replay attack prevention)
    if (this.usedNonces.has(qrData.nonce)) {
      return {
        valid: false,
        error: 'QR code has already been used'
      };
    }
    
    return {
      valid: true,
      data: qrData
    };
  }

  /**
   * Mark nonce as used
   * @param {string} nonce - Nonce to mark as used
   */
  markNonceAsUsed(nonce) {
    this.usedNonces.add(nonce);
    
    // Clean up old nonces after 1 hour to prevent memory leak
    setTimeout(() => {
      this.usedNonces.delete(nonce);
    }, 60 * 60 * 1000);
  }

  /**
   * Create EIP-712 signature for check-in
   * @param {Object} checkInData - Check-in data
   * @param {Object} signer - Ethers signer
   * @returns {Promise<string>} Signature
   */
  async signCheckIn(checkInData, signer) {
    const domain = {
      ...this.EIP712_DOMAIN,
      chainId: checkInData.chainId || 100
    };
    
    const value = {
      eventId: checkInData.eventId,
      attendee: checkInData.attendee,
      timestamp: checkInData.timestamp,
      nonce: checkInData.nonce,
      checkpoint: checkInData.checkpoint || 'entry'
    };
    
    try {
      const signature = await signer.signTypedData(
        domain,
        this.CHECKIN_TYPES,
        value
      );
      
      return signature;
    } catch (error) {
      console.error('Error signing check-in:', error);
      throw new Error('Failed to sign check-in data');
    }
  }

  /**
   * Verify EIP-712 signature
   * @param {Object} checkInData - Check-in data
   * @param {string} signature - Signature to verify
   * @returns {string} Recovered signer address
   */
  verifyCheckInSignature(checkInData, signature) {
    const domain = {
      ...this.EIP712_DOMAIN,
      chainId: checkInData.chainId || 100
    };
    
    const value = {
      eventId: checkInData.eventId,
      attendee: checkInData.attendee,
      timestamp: checkInData.timestamp,
      nonce: checkInData.nonce,
      checkpoint: checkInData.checkpoint || 'entry'
    };
    
    try {
      const recoveredAddress = ethers.verifyTypedData(
        domain,
        this.CHECKIN_TYPES,
        value,
        signature
      );
      
      return recoveredAddress;
    } catch (error) {
      console.error('Error verifying signature:', error);
      throw new Error('Invalid signature');
    }
  }

  /**
   * Generate organizer QR code for event
   * This QR code contains event info for attendees to scan
   * @param {string} eventId - Event ID
   * @param {number} chainId - Chain ID
   * @returns {Promise<Object>} QR code data and image
   */
  async generateOrganizerQR(eventId, chainId = 100) {
    const qrData = {
      type: 'event',
      eventId: eventId.toString(),
      chainId,
      timestamp: Math.floor(Date.now() / 1000)
    };
    
    const qrImage = await this.generateQRImage(qrData);
    
    return {
      data: qrData,
      image: qrImage
    };
  }

  /**
   * Parse scanned QR code
   * @param {string} qrString - Scanned QR code string
   * @returns {Object} Parsed QR data
   */
  parseQRCode(qrString) {
    try {
      const qrData = JSON.parse(qrString);
      return qrData;
    } catch (error) {
      throw new Error('Invalid QR code format');
    }
  }

  /**
   * Get check-in statistics for an event
   * @param {Array} checkIns - Array of check-in records
   * @returns {Object} Statistics
   */
  getCheckInStats(checkIns) {
    const stats = {
      total: checkIns.length,
      byCheckpoint: {},
      byHour: {},
      recent: checkIns.slice(-10).reverse()
    };
    
    checkIns.forEach(checkIn => {
      // Count by checkpoint
      const checkpoint = checkIn.checkpoint || 'entry';
      stats.byCheckpoint[checkpoint] = (stats.byCheckpoint[checkpoint] || 0) + 1;
      
      // Count by hour
      const hour = new Date(checkIn.timestamp * 1000).getHours();
      stats.byHour[hour] = (stats.byHour[hour] || 0) + 1;
    });
    
    return stats;
  }

  /**
   * Export check-in data to CSV format
   * @param {Array} checkIns - Array of check-in records
   * @returns {string} CSV string
   */
  exportToCSV(checkIns) {
    const headers = ['Event ID', 'Attendee', 'Checkpoint', 'Timestamp', 'Transaction Hash'];
    const rows = checkIns.map(checkIn => [
      checkIn.eventId,
      checkIn.attendee,
      checkIn.checkpoint || 'entry',
      new Date(checkIn.timestamp * 1000).toISOString(),
      checkIn.transactionHash || ''
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    return csvContent;
  }
}

module.exports = new QRService();
