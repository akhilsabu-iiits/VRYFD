# Webinar Attendance Tracking Service

## Overview

This service provides comprehensive webinar attendance tracking with blockchain integration for the VRYFD platform. It tracks participant join/leave events, calculates attendance percentages, and submits verified attendance data to the smart contract.

## Architecture

### Components

1. **Database Schema** ([`src/db/schema.js`](src/db/schema.js))
   - `WebinarSession`: Tracks individual join/leave events
   - `AttendanceRecord`: Aggregated attendance data per participant

2. **Attendance Service** ([`src/services/attendanceService.js`](src/services/attendanceService.js))
   - Core business logic for attendance tracking
   - Blockchain submission via `recordWebinarAttendance()`

3. **API Routes** ([`src/routes/attendance.js`](src/routes/attendance.js))
   - RESTful endpoints for webinar integration

## Setup

### 1. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# MongoDB connection
MONGODB_URI=mongodb://localhost:27017/vryfd

# Backend relayer wallet (must be authorized via addBackendRelayer())
BACKEND_RELAYER_PRIVATE_KEY=0x...

# Webinar platform integration
WEBINAR_WEBHOOK_SECRET=your-secret
WEBINAR_ORIGINS=https://zoom.us,https://meet.google.com
```

### 2. Install Dependencies

```bash
cd backend
npm install
```

### 3. Authorize Backend Relayer

The backend relayer wallet must be authorized on-chain:

```javascript
// Using ethers.js or Hardhat console
const contract = await ethers.getContractAt("VryfdAttendance", CONTRACT_ADDRESS);
await contract.addBackendRelayer(BACKEND_RELAYER_ADDRESS);
```

### 4. Start the Server

```bash
npm run dev  # Development with auto-reload
npm start    # Production
```

## API Endpoints

### Record Join Event

```http
POST /api/attendance/webinar/join
Content-Type: application/json

{
  "eventId": "15",
  "participantAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "sessionId": "uuid-or-timestamp"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "eventId": "15",
    "participantAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
    "joinTime": "2026-04-15T06:30:00.000Z",
    "sessionId": "session-123"
  }
}
```

### Record Leave Event

```http
POST /api/attendance/webinar/leave
Content-Type: application/json

{
  "eventId": "15",
  "participantAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "sessionId": "session-123"
}
```

**Response:**
```json
{
  "success": true,
  "session": {
    "eventId": "15",
    "participantAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
    "joinTime": "2026-04-15T06:30:00.000Z",
    "leaveTime": "2026-04-15T07:15:00.000Z",
    "duration": 45,
    "sessionId": "session-123"
  }
}
```

### Aggregate Attendance

```http
POST /api/attendance/webinar/aggregate
Authorization: Bearer <ADMIN_SECRET>
Content-Type: application/json

{
  "eventId": "15",
  "eventDurationMinutes": 60,
  "attendanceThreshold": 75
}
```

**Response:**
```json
{
  "success": true,
  "recordCount": 25,
  "records": [
    {
      "address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
      "totalMinutes": 45,
      "percentage": 75,
      "eligible": true,
      "sessionCount": 1
    }
  ]
}
```

### Submit to Blockchain

```http
POST /api/attendance/webinar/record
Authorization: Bearer <ADMIN_SECRET>
Content-Type: application/json

{
  "eventId": "15",
  "attendeeAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
  "minutesPresent": 45
}
```

**Response:**
```json
{
  "success": true,
  "txHash": "0xabc123...",
  "eventId": "15",
  "attendeeAddress": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
  "minutesPresent": 45
}
```

### Batch Submit All Eligible

```http
POST /api/attendance/webinar/batch-submit
Authorization: Bearer <ADMIN_SECRET>
Content-Type: application/json

{
  "eventId": "15"
}
```

**Response:**
```json
{
  "success": true,
  "totalProcessed": 20,
  "successCount": 18,
  "failedCount": 2,
  "results": [
    {
      "address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
      "status": "success",
      "txHash": "0xabc123..."
    }
  ]
}
```

### Get Attendance Details

```http
GET /api/attendance/:eventId/:address
```

**Response:**
```json
{
  "success": true,
  "attendance": {
    "address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
    "totalMinutes": 45,
    "percentage": 75,
    "eligible": true,
    "sessionCount": 2,
    "sessions": [
      {
        "sessionId": "session-1",
        "joinTime": "2026-04-15T06:30:00.000Z",
        "leaveTime": "2026-04-15T06:50:00.000Z",
        "duration": 20
      }
    ],
    "submittedToBlockchain": true,
    "blockchainTxHash": "0xabc123...",
    "eventDurationMinutes": 60,
    "attendanceThreshold": 75
  }
}
```

### Get Eligible Attendees

```http
GET /api/attendance/:eventId/eligible
```

**Response:**
```json
{
  "success": true,
  "eventId": "15",
  "count": 18,
  "attendees": [
    {
      "address": "0x742d35cc6634c0532925a3b844bc9e7595f0beb",
      "totalMinutes": 55,
      "percentage": 92,
      "sessionCount": 1,
      "submittedToBlockchain": true,
      "blockchainTxHash": "0xabc123..."
    }
  ]
}
```

### Get Event Statistics

```http
GET /api/attendance/:eventId/stats
```

**Response:**
```json
{
  "success": true,
  "eventId": "15",
  "statistics": {
    "totalParticipants": 25,
    "eligibleCount": 18,
    "submittedCount": 18,
    "averagePercentage": 82,
    "averageMinutes": 49
  }
}
```

## Integration Examples

### Zoom Webhook Integration

```javascript
// Example webhook handler for Zoom
app.post('/webhook/zoom', (req, res) => {
  const { event, payload } = req.body;
  
  if (event === 'meeting.participant_joined') {
    await fetch('http://localhost:3001/api/attendance/webinar/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: payload.object.id,
        participantAddress: payload.participant.user_id, // Map to wallet
        sessionId: `${payload.participant.id}-${Date.now()}`
      })
    });
  }
  
  if (event === 'meeting.participant_left') {
    await fetch('http://localhost:3001/api/attendance/webinar/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventId: payload.object.id,
        participantAddress: payload.participant.user_id,
        sessionId: `${payload.participant.id}-${payload.participant.join_time}`
      })
    });
  }
  
  res.sendStatus(200);
});
```

### Google Meet Integration

```javascript
// Example polling-based tracking for Google Meet
async function trackMeetAttendance(meetingId, eventId) {
  const participants = await getMeetParticipants(meetingId);
  
  for (const participant of participants) {
    if (participant.status === 'joined' && !activeSessions.has(participant.id)) {
      const sessionId = `${participant.id}-${Date.now()}`;
      activeSessions.set(participant.id, sessionId);
      
      await fetch('http://localhost:3001/api/attendance/webinar/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          participantAddress: participant.walletAddress,
          sessionId
        })
      });
    }
    
    if (participant.status === 'left' && activeSessions.has(participant.id)) {
      const sessionId = activeSessions.get(participant.id);
      activeSessions.delete(participant.id);
      
      await fetch('http://localhost:3001/api/attendance/webinar/leave', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          eventId,
          participantAddress: participant.walletAddress,
          sessionId
        })
      });
    }
  }
}
```

## Workflow

1. **During Webinar**: Track join/leave events via webhooks or polling
2. **After Webinar**: Aggregate attendance data
3. **Calculate Eligibility**: Determine who meets the threshold
4. **Submit to Blockchain**: Record verified attendance on-chain
5. **Issue Certificates**: Use existing certificate issuance for eligible attendees

## Smart Contract Integration

The service calls [`recordWebinarAttendance()`](../../contracts/VryfdAttendance.sol#L300) on the smart contract:

```solidity
function recordWebinarAttendance(
    uint256 eventId,
    address attendee,
    uint256 minutesPresent
) external {
    require(backendRelayers[msg.sender], "Not authorized relayer");
    // ... records attendance with percentage calculation
}
```

## Security Considerations

1. **Admin Authentication**: Sensitive endpoints require `adminAuth` middleware
2. **Address Validation**: All Ethereum addresses are validated
3. **Relayer Authorization**: Backend relayer must be authorized on-chain
4. **Webhook Verification**: Use `WEBINAR_WEBHOOK_SECRET` to verify webhooks
5. **CORS Configuration**: Restrict origins via `WEBINAR_ORIGINS`

## Database Indexes

Optimized queries with compound indexes:

```javascript
// WebinarSession indexes
{ eventId: 1, participantAddress: 1 }
{ eventId: 1, joinTime: 1 }

// AttendanceRecord indexes
{ eventId: 1, address: 1 } // unique
{ eligible: 1, submittedToBlockchain: 1 }
```

## Error Handling

All endpoints return consistent error responses:

```json
{
  "error": "Error message description"
}
```

Common HTTP status codes:
- `200`: Success
- `400`: Bad request (validation error)
- `404`: Resource not found
- `500`: Internal server error

## Testing

```bash
# Run tests
npm test

# Test join endpoint
curl -X POST http://localhost:3001/api/attendance/webinar/join \
  -H "Content-Type: application/json" \
  -d '{
    "eventId": "15",
    "participantAddress": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb",
    "sessionId": "test-session-1"
  }'
```

## Monitoring

Monitor service health:

```bash
# Check service status
curl http://localhost:3001/api/health

# View logs
tail -f logs/attendance.log
```

## Future Enhancements

- [ ] WebSocket support for real-time attendance updates
- [ ] Automatic threshold adjustment based on event type
- [ ] Multi-platform aggregation (combine Zoom + Google Meet)
- [ ] Attendance analytics dashboard
- [ ] Fraud detection (multiple sessions from same IP)

## Support

For issues or questions, refer to:
- [Main Documentation](../docs/VRYFD_High_Level_Documentation.pdf)
- [Smart Contract](../../contracts/VryfdAttendance.sol)
- [GitHub Issues](https://github.com/your-repo/issues)
