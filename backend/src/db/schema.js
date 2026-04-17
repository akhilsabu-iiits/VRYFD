const mongoose = require("mongoose");

// ──────────────────────────────────────────────────────────────────────────────
// WebinarSession Schema
// Tracks individual join/leave events for webinar participants
// ──────────────────────────────────────────────────────────────────────────────
const webinarSessionSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    index: true,
  },
  participantAddress: {
    type: String,
    required: true,
    lowercase: true,
    index: true,
  },
  joinTime: {
    type: Date,
    required: true,
  },
  leaveTime: {
    type: Date,
    default: null,
  },
  duration: {
    type: Number, // Duration in minutes
    default: 0,
  },
  sessionId: {
    type: String, // Unique session identifier (for tracking multiple join/leave cycles)
    required: true,
  },
}, {
  timestamps: true, // Adds createdAt and updatedAt
});

// Compound index for efficient queries
webinarSessionSchema.index({ eventId: 1, participantAddress: 1 });
webinarSessionSchema.index({ eventId: 1, joinTime: 1 });

// ──────────────────────────────────────────────────────────────────────────────
// AttendanceRecord Schema
// Aggregated attendance data for each participant per event
// ──────────────────────────────────────────────────────────────────────────────
const attendanceRecordSchema = new mongoose.Schema({
  eventId: {
    type: String,
    required: true,
    index: true,
  },
  address: {
    type: String,
    required: true,
    lowercase: true,
    index: true,
  },
  totalMinutes: {
    type: Number,
    required: true,
    default: 0,
  },
  percentage: {
    type: Number, // 0-100
    required: true,
    default: 0,
  },
  eligible: {
    type: Boolean,
    default: false,
  },
  submittedToBlockchain: {
    type: Boolean,
    default: false,
  },
  blockchainTxHash: {
    type: String,
    default: null,
  },
  blockchainSubmittedAt: {
    type: Date,
    default: null,
  },
  eventDurationMinutes: {
    type: Number, // Store event duration for reference
    required: true,
  },
  attendanceThreshold: {
    type: Number, // Store threshold at time of calculation
    default: 75,
  },
  sessions: [{
    sessionId: String,
    joinTime: Date,
    leaveTime: Date,
    duration: Number,
  }],
}, {
  timestamps: true,
});

// Unique constraint: one record per event per address
attendanceRecordSchema.index({ eventId: 1, address: 1 }, { unique: true });
attendanceRecordSchema.index({ eligible: 1, submittedToBlockchain: 1 });

// ──────────────────────────────────────────────────────────────────────────────
// Virtual fields and methods
// ──────────────────────────────────────────────────────────────────────────────

// Calculate if eligible based on percentage and threshold
attendanceRecordSchema.methods.checkEligibility = function() {
  this.eligible = this.percentage >= this.attendanceThreshold;
  return this.eligible;
};

// Add a session to the record
attendanceRecordSchema.methods.addSession = function(sessionId, joinTime, leaveTime, duration) {
  this.sessions.push({ sessionId, joinTime, leaveTime, duration });
  this.recalculateTotals();
};

// Recalculate total minutes and percentage
attendanceRecordSchema.methods.recalculateTotals = function() {
  this.totalMinutes = this.sessions.reduce((sum, session) => sum + (session.duration || 0), 0);
  if (this.eventDurationMinutes > 0) {
    this.percentage = Math.min(100, Math.round((this.totalMinutes / this.eventDurationMinutes) * 100));
  }
  this.checkEligibility();
};

// ──────────────────────────────────────────────────────────────────────────────
// Admin Schema
// Platform administrators with role-based access control
// ──────────────────────────────────────────────────────────────────────────────
const adminSchema = new mongoose.Schema({
  walletAddress: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    index: true,
  },
  role: {
    type: String,
    enum: ['SUPER_ADMIN', 'MODERATOR', 'SUPPORT'],
    required: true,
    default: 'SUPPORT',
  },
  name: {
    type: String,
    default: '',
  },
  email: {
    type: String,
    default: '',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  lastLogin: {
    type: Date,
    default: null,
  },
  permissions: {
    canSuspendEvents: { type: Boolean, default: false },
    canSuspendUsers: { type: Boolean, default: false },
    canDeleteEvents: { type: Boolean, default: false },
    canManageAdmins: { type: Boolean, default: false },
    canViewMetrics: { type: Boolean, default: true },
    canViewLogs: { type: Boolean, default: true },
  },
}, {
  timestamps: true,
});

// Set permissions based on role
adminSchema.pre('save', function(next) {
  if (this.role === 'SUPER_ADMIN') {
    this.permissions = {
      canSuspendEvents: true,
      canSuspendUsers: true,
      canDeleteEvents: true,
      canManageAdmins: true,
      canViewMetrics: true,
      canViewLogs: true,
    };
  } else if (this.role === 'MODERATOR') {
    this.permissions = {
      canSuspendEvents: true,
      canSuspendUsers: true,
      canDeleteEvents: false,
      canManageAdmins: false,
      canViewMetrics: true,
      canViewLogs: true,
    };
  } else if (this.role === 'SUPPORT') {
    this.permissions = {
      canSuspendEvents: false,
      canSuspendUsers: false,
      canDeleteEvents: false,
      canManageAdmins: false,
      canViewMetrics: true,
      canViewLogs: true,
    };
  }
  next();
});

// ──────────────────────────────────────────────────────────────────────────────
// AdminLog Schema
// Audit trail for all admin actions
// ──────────────────────────────────────────────────────────────────────────────
const adminLogSchema = new mongoose.Schema({
  adminAddress: {
    type: String,
    required: true,
    lowercase: true,
    index: true,
  },
  action: {
    type: String,
    required: true,
    enum: [
      'SUSPEND_EVENT',
      'RESTORE_EVENT',
      'DELETE_EVENT',
      'SUSPEND_USER',
      'RESTORE_USER',
      'FLAG_ABUSE',
      'RESOLVE_ABUSE',
      'APPROVE_ORGANIZER',
      'SUSPEND_ORGANIZER',
      'VIEW_METRICS',
      'EXPORT_DATA',
      'LOGIN',
      'LOGOUT',
    ],
  },
  targetType: {
    type: String,
    enum: ['EVENT', 'USER', 'ORGANIZER', 'ABUSE_REPORT', 'SYSTEM'],
    required: true,
  },
  targetId: {
    type: String,
    default: null,
  },
  details: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  ipAddress: {
    type: String,
    default: null,
  },
  userAgent: {
    type: String,
    default: null,
  },
  success: {
    type: Boolean,
    default: true,
  },
  errorMessage: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes for efficient log queries
adminLogSchema.index({ adminAddress: 1, createdAt: -1 });
adminLogSchema.index({ action: 1, createdAt: -1 });
adminLogSchema.index({ targetType: 1, targetId: 1 });

// ──────────────────────────────────────────────────────────────────────────────
// AbuseReport Schema
// Tracks flagged events, users, and suspicious activities
// ──────────────────────────────────────────────────────────────────────────────
const abuseReportSchema = new mongoose.Schema({
  reportType: {
    type: String,
    enum: ['EVENT', 'USER', 'ORGANIZER', 'SUSPICIOUS_PATTERN'],
    required: true,
  },
  targetId: {
    type: String,
    required: true,
    index: true,
  },
  targetAddress: {
    type: String,
    lowercase: true,
    default: null,
  },
  reason: {
    type: String,
    required: true,
    enum: [
      'SPAM',
      'FAKE_EVENT',
      'INAPPROPRIATE_CONTENT',
      'DUPLICATE_ACCOUNTS',
      'RAPID_EVENT_CREATION',
      'UNUSUAL_ATTENDANCE',
      'SUSPICIOUS_IP',
      'OTHER',
    ],
  },
  description: {
    type: String,
    default: '',
  },
  reportedBy: {
    type: String, // Admin address or 'SYSTEM' for automated detection
    required: true,
  },
  status: {
    type: String,
    enum: ['PENDING', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'],
    default: 'PENDING',
  },
  severity: {
    type: String,
    enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
    default: 'MEDIUM',
  },
  evidence: {
    type: mongoose.Schema.Types.Mixed,
    default: {},
  },
  resolution: {
    action: {
      type: String,
      enum: ['NONE', 'WARNING', 'SUSPENSION', 'BAN', 'DELETION'],
      default: 'NONE',
    },
    resolvedBy: String,
    resolvedAt: Date,
    notes: String,
  },
  autoDetected: {
    type: Boolean,
    default: false,
  },
}, {
  timestamps: true,
});

// Indexes for abuse report queries
abuseReportSchema.index({ status: 1, severity: -1, createdAt: -1 });
abuseReportSchema.index({ reportType: 1, targetId: 1 });
abuseReportSchema.index({ reportedBy: 1, createdAt: -1 });

// ──────────────────────────────────────────────────────────────────────────────
// SystemMetrics Schema
// Stores aggregated system-wide KPIs and metrics
// ──────────────────────────────────────────────────────────────────────────────
const systemMetricsSchema = new mongoose.Schema({
  date: {
    type: Date,
    required: true,
    index: true,
  },
  period: {
    type: String,
    enum: ['HOURLY', 'DAILY', 'WEEKLY', 'MONTHLY'],
    required: true,
  },
  metrics: {
    totalEvents: { type: Number, default: 0 },
    virtualEvents: { type: Number, default: 0 },
    physicalEvents: { type: Number, default: 0 },
    hybridEvents: { type: Number, default: 0 },
    activeEvents: { type: Number, default: 0 },
    completedEvents: { type: Number, default: 0 },
    totalUsers: { type: Number, default: 0 },
    activeUsers: { type: Number, default: 0 },
    totalOrganizers: { type: Number, default: 0 },
    totalAttendanceRecords: { type: Number, default: 0 },
    totalGasCosts: { type: String, default: '0' }, // Wei as string
    totalVRYFDistributed: { type: String, default: '0' },
    chainUsage: {
      type: Map,
      of: Number,
      default: {},
    },
    averageAttendanceRate: { type: Number, default: 0 },
    suspendedEvents: { type: Number, default: 0 },
    suspendedUsers: { type: Number, default: 0 },
    abuseReports: { type: Number, default: 0 },
  },
}, {
  timestamps: true,
});

// Unique constraint: one record per period per date
systemMetricsSchema.index({ date: 1, period: 1 }, { unique: true });
systemMetricsSchema.index({ period: 1, createdAt: -1 });

// ──────────────────────────────────────────────────────────────────────────────
// ApiKey Schema
// API keys for external integrations with scoped permissions
// ──────────────────────────────────────────────────────────────────────────────
const apiKeySchema = new mongoose.Schema({
  key: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  name: {
    type: String,
    required: true,
  },
  scopes: [{
    type: String,
    enum: [
      'events:read',
      'events:create',
      'attendance:read',
      'certificates:read',
      'webhooks:manage',
      'leaderboard:read',
    ],
  }],
  rateLimit: {
    type: Number,
    default: 100, // requests per minute
  },
  createdBy: {
    type: String,
    required: true,
    lowercase: true,
  },
  active: {
    type: Boolean,
    default: true,
  },
  lastUsed: {
    type: Date,
    default: null,
  },
  usageCount: {
    type: Number,
    default: 0,
  },
  environment: {
    type: String,
    enum: ['live', 'test'],
    default: 'live',
  },
  expiresAt: {
    type: Date,
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes for API key queries
apiKeySchema.index({ createdBy: 1, active: 1 });
apiKeySchema.index({ active: 1, expiresAt: 1 });

// Method to check if key is valid
apiKeySchema.methods.isValid = function() {
  if (!this.active) return false;
  if (this.expiresAt && this.expiresAt < new Date()) return false;
  return true;
};

// Method to check if key has scope
apiKeySchema.methods.hasScope = function(scope) {
  return this.scopes.includes(scope);
};

// ──────────────────────────────────────────────────────────────────────────────
// WebhookEndpoint Schema
// Registered webhook endpoints for event notifications
// ──────────────────────────────────────────────────────────────────────────────
const webhookEndpointSchema = new mongoose.Schema({
  url: {
    type: String,
    required: true,
  },
  events: [{
    type: String,
    enum: [
      'event.created',
      'event.updated',
      'attendance.recorded',
      'certificate.issued',
      'badge.claimed',
      'milestone.achieved',
    ],
  }],
  secret: {
    type: String,
    required: true, // HMAC secret for signature verification
  },
  active: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: String,
    required: true,
    lowercase: true,
  },
  description: {
    type: String,
    default: '',
  },
  retryCount: {
    type: Number,
    default: 3,
  },
  lastDeliveryAt: {
    type: Date,
    default: null,
  },
  lastDeliveryStatus: {
    type: String,
    enum: ['success', 'failed', 'pending'],
    default: null,
  },
  failureCount: {
    type: Number,
    default: 0,
  },
  successCount: {
    type: Number,
    default: 0,
  },
}, {
  timestamps: true,
});

// Indexes for webhook queries
webhookEndpointSchema.index({ createdBy: 1, active: 1 });
webhookEndpointSchema.index({ active: 1, events: 1 });

// ──────────────────────────────────────────────────────────────────────────────
// WebhookDelivery Schema
// Tracks individual webhook delivery attempts
// ──────────────────────────────────────────────────────────────────────────────
const webhookDeliverySchema = new mongoose.Schema({
  webhookId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'WebhookEndpoint',
    required: true,
    index: true,
  },
  event: {
    type: String,
    required: true,
  },
  payload: {
    type: mongoose.Schema.Types.Mixed,
    required: true,
  },
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'retrying'],
    default: 'pending',
  },
  attempts: {
    type: Number,
    default: 0,
  },
  maxAttempts: {
    type: Number,
    default: 3,
  },
  lastAttemptAt: {
    type: Date,
    default: null,
  },
  nextRetryAt: {
    type: Date,
    default: null,
  },
  responseStatus: {
    type: Number,
    default: null,
  },
  responseBody: {
    type: String,
    default: null,
  },
  errorMessage: {
    type: String,
    default: null,
  },
  deliveredAt: {
    type: Date,
    default: null,
  },
  signature: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

// Indexes for delivery tracking
webhookDeliverySchema.index({ webhookId: 1, createdAt: -1 });
webhookDeliverySchema.index({ status: 1, nextRetryAt: 1 });
webhookDeliverySchema.index({ event: 1, createdAt: -1 });

// ──────────────────────────────────────────────────────────────────────────────
// Models
// ──────────────────────────────────────────────────────────────────────────────
const WebinarSession = mongoose.model("WebinarSession", webinarSessionSchema);
const AttendanceRecord = mongoose.model("AttendanceRecord", attendanceRecordSchema);
const Admin = mongoose.model("Admin", adminSchema);
const AdminLog = mongoose.model("AdminLog", adminLogSchema);
const AbuseReport = mongoose.model("AbuseReport", abuseReportSchema);
const SystemMetrics = mongoose.model("SystemMetrics", systemMetricsSchema);
const ApiKey = mongoose.model("ApiKey", apiKeySchema);
const WebhookEndpoint = mongoose.model("WebhookEndpoint", webhookEndpointSchema);
const WebhookDelivery = mongoose.model("WebhookDelivery", webhookDeliverySchema);

module.exports = {
  WebinarSession,
  AttendanceRecord,
  Admin,
  AdminLog,
  AbuseReport,
  SystemMetrics,
  ApiKey,
  WebhookEndpoint,
  WebhookDelivery,
};
