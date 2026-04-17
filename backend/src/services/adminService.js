const fs = require('fs').promises;
const path = require('path');
const { Admin, AdminLog, AbuseReport, SystemMetrics, AttendanceRecord, WebinarSession } = require('../db/schema');

// ──────────────────────────────────────────────────────────────────────────────
// Admin Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get or create admin by wallet address
 */
async function getOrCreateAdmin(walletAddress, role = 'SUPPORT') {
  let admin = await Admin.findOne({ walletAddress: walletAddress.toLowerCase() });
  
  if (!admin) {
    admin = new Admin({
      walletAddress: walletAddress.toLowerCase(),
      role,
    });
    await admin.save();
  }
  
  // Update last login
  admin.lastLogin = new Date();
  await admin.save();
  
  return admin;
}

/**
 * Check if address is admin
 */
async function isAdmin(walletAddress) {
  const admin = await Admin.findOne({ 
    walletAddress: walletAddress.toLowerCase(),
    isActive: true,
  });
  return !!admin;
}

/**
 * Check if admin has specific permission
 */
async function hasPermission(walletAddress, permission) {
  const admin = await Admin.findOne({ 
    walletAddress: walletAddress.toLowerCase(),
    isActive: true,
  });
  
  if (!admin) return false;
  return admin.permissions[permission] === true;
}

/**
 * List all admins
 */
async function listAdmins() {
  return await Admin.find().sort({ createdAt: -1 });
}

// ──────────────────────────────────────────────────────────────────────────────
// Event Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get all events with filters
 */
async function getAllEvents(filters = {}) {
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let events = [];
  
  try {
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const deployedData = await fs.readFile(deployedPath, 'utf8');
    
    const pendingEvents = JSON.parse(eventsData);
    const deployedEvents = JSON.parse(deployedData);
    
    events = [...pendingEvents, ...deployedEvents];
  } catch (error) {
    console.error('Error reading events:', error);
  }
  
  // Apply filters
  if (filters.type) {
    events = events.filter(e => e.eventType === filters.type);
  }
  if (filters.status) {
    events = events.filter(e => e.status === filters.status);
  }
  if (filters.organizer) {
    events = events.filter(e => e.organizer?.toLowerCase() === filters.organizer.toLowerCase());
  }
  if (filters.search) {
    const search = filters.search.toLowerCase();
    events = events.filter(e => 
      e.name?.toLowerCase().includes(search) ||
      e.description?.toLowerCase().includes(search)
    );
  }
  
  // Add attendance counts
  for (const event of events) {
    if (event.id) {
      const attendanceCount = await AttendanceRecord.countDocuments({ eventId: event.id });
      event.attendanceCount = attendanceCount;
    }
  }
  
  return events;
}

/**
 * Suspend an event
 */
async function suspendEvent(eventId, adminAddress, reason) {
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let updated = false;
  
  // Try pending events
  try {
    const data = await fs.readFile(eventsPath, 'utf8');
    const events = JSON.parse(data);
    const eventIndex = events.findIndex(e => e.id === eventId);
    
    if (eventIndex !== -1) {
      events[eventIndex].status = 'SUSPENDED';
      events[eventIndex].suspendedAt = new Date().toISOString();
      events[eventIndex].suspendedBy = adminAddress;
      events[eventIndex].suspensionReason = reason;
      
      await fs.writeFile(eventsPath, JSON.stringify(events, null, 2));
      updated = true;
    }
  } catch (error) {
    console.error('Error updating pending events:', error);
  }
  
  // Try deployed events
  if (!updated) {
    try {
      const data = await fs.readFile(deployedPath, 'utf8');
      const events = JSON.parse(data);
      const eventIndex = events.findIndex(e => e.id === eventId);
      
      if (eventIndex !== -1) {
        events[eventIndex].status = 'SUSPENDED';
        events[eventIndex].suspendedAt = new Date().toISOString();
        events[eventIndex].suspendedBy = adminAddress;
        events[eventIndex].suspensionReason = reason;
        
        await fs.writeFile(deployedPath, JSON.stringify(events, null, 2));
        updated = true;
      }
    } catch (error) {
      console.error('Error updating deployed events:', error);
    }
  }
  
  if (updated) {
    await logAdminAction(adminAddress, 'SUSPEND_EVENT', 'EVENT', eventId, { reason });
  }
  
  return updated;
}

/**
 * Restore a suspended event
 */
async function restoreEvent(eventId, adminAddress) {
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let updated = false;
  
  // Try pending events
  try {
    const data = await fs.readFile(eventsPath, 'utf8');
    const events = JSON.parse(data);
    const eventIndex = events.findIndex(e => e.id === eventId);
    
    if (eventIndex !== -1) {
      events[eventIndex].status = 'ACTIVE';
      delete events[eventIndex].suspendedAt;
      delete events[eventIndex].suspendedBy;
      delete events[eventIndex].suspensionReason;
      
      await fs.writeFile(eventsPath, JSON.stringify(events, null, 2));
      updated = true;
    }
  } catch (error) {
    console.error('Error updating pending events:', error);
  }
  
  // Try deployed events
  if (!updated) {
    try {
      const data = await fs.readFile(deployedPath, 'utf8');
      const events = JSON.parse(data);
      const eventIndex = events.findIndex(e => e.id === eventId);
      
      if (eventIndex !== -1) {
        events[eventIndex].status = 'ACTIVE';
        delete events[eventIndex].suspendedAt;
        delete events[eventIndex].suspendedBy;
        delete events[eventIndex].suspensionReason;
        
        await fs.writeFile(deployedPath, JSON.stringify(events, null, 2));
        updated = true;
      }
    } catch (error) {
      console.error('Error updating deployed events:', error);
    }
  }
  
  if (updated) {
    await logAdminAction(adminAddress, 'RESTORE_EVENT', 'EVENT', eventId, {});
  }
  
  return updated;
}

/**
 * Delete an event (SUPER_ADMIN only)
 */
async function deleteEvent(eventId, adminAddress) {
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let deleted = false;
  
  // Try pending events
  try {
    const data = await fs.readFile(eventsPath, 'utf8');
    let events = JSON.parse(data);
    const originalLength = events.length;
    events = events.filter(e => e.id !== eventId);
    
    if (events.length < originalLength) {
      await fs.writeFile(eventsPath, JSON.stringify(events, null, 2));
      deleted = true;
    }
  } catch (error) {
    console.error('Error deleting from pending events:', error);
  }
  
  // Try deployed events
  if (!deleted) {
    try {
      const data = await fs.readFile(deployedPath, 'utf8');
      let events = JSON.parse(data);
      const originalLength = events.length;
      events = events.filter(e => e.id !== eventId);
      
      if (events.length < originalLength) {
        await fs.writeFile(deployedPath, JSON.stringify(events, null, 2));
        deleted = true;
      }
    } catch (error) {
      console.error('Error deleting from deployed events:', error);
    }
  }
  
  if (deleted) {
    // Also delete attendance records
    await AttendanceRecord.deleteMany({ eventId });
    await WebinarSession.deleteMany({ eventId });
    
    await logAdminAction(adminAddress, 'DELETE_EVENT', 'EVENT', eventId, {});
  }
  
  return deleted;
}

// ──────────────────────────────────────────────────────────────────────────────
// User Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get all users with statistics
 */
async function getAllUsers(filters = {}) {
  // Get unique users from attendance records
  const attendanceRecords = await AttendanceRecord.find();
  const userMap = new Map();
  
  for (const record of attendanceRecords) {
    if (!userMap.has(record.address)) {
      userMap.set(record.address, {
        address: record.address,
        eventsAttended: 0,
        totalMinutes: 0,
        badgesEarned: 0,
        suspended: false,
      });
    }
    
    const user = userMap.get(record.address);
    user.eventsAttended++;
    user.totalMinutes += record.totalMinutes;
    if (record.eligible && record.submittedToBlockchain) {
      user.badgesEarned++;
    }
  }
  
  let users = Array.from(userMap.values());
  
  // Apply filters
  if (filters.search) {
    const search = filters.search.toLowerCase();
    users = users.filter(u => u.address.toLowerCase().includes(search));
  }
  
  return users;
}

/**
 * Get user statistics
 */
async function getUserStats(address) {
  const records = await AttendanceRecord.find({ address: address.toLowerCase() });
  
  return {
    address: address.toLowerCase(),
    eventsAttended: records.length,
    totalMinutes: records.reduce((sum, r) => sum + r.totalMinutes, 0),
    badgesEarned: records.filter(r => r.eligible && r.submittedToBlockchain).length,
    averageAttendance: records.length > 0 
      ? records.reduce((sum, r) => sum + r.percentage, 0) / records.length 
      : 0,
    recentEvents: records.slice(-5).map(r => ({
      eventId: r.eventId,
      percentage: r.percentage,
      eligible: r.eligible,
      date: r.createdAt,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Organizer Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get all organizers with statistics
 */
async function getAllOrganizers() {
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let events = [];
  
  try {
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const deployedData = await fs.readFile(deployedPath, 'utf8');
    
    events = [...JSON.parse(eventsData), ...JSON.parse(deployedData)];
  } catch (error) {
    console.error('Error reading events:', error);
  }
  
  const organizerMap = new Map();
  
  for (const event of events) {
    if (!event.organizer) continue;
    
    const organizer = event.organizer.toLowerCase();
    if (!organizerMap.has(organizer)) {
      organizerMap.set(organizer, {
        address: organizer,
        totalEvents: 0,
        activeEvents: 0,
        completedEvents: 0,
        suspendedEvents: 0,
        totalAttendees: 0,
      });
    }
    
    const org = organizerMap.get(organizer);
    org.totalEvents++;
    
    if (event.status === 'ACTIVE') org.activeEvents++;
    if (event.status === 'COMPLETED') org.completedEvents++;
    if (event.status === 'SUSPENDED') org.suspendedEvents++;
    
    // Get attendance count
    if (event.id) {
      const count = await AttendanceRecord.countDocuments({ eventId: event.id });
      org.totalAttendees += count;
    }
  }
  
  return Array.from(organizerMap.values());
}

// ──────────────────────────────────────────────────────────────────────────────
// System Metrics
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Get system-wide dashboard metrics
 */
async function getDashboardMetrics() {
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let events = [];
  
  try {
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const deployedData = await fs.readFile(deployedPath, 'utf8');
    
    events = [...JSON.parse(eventsData), ...JSON.parse(deployedData)];
  } catch (error) {
    console.error('Error reading events:', error);
  }
  
  const totalAttendance = await AttendanceRecord.countDocuments();
  const uniqueUsers = await AttendanceRecord.distinct('address');
  const uniqueOrganizers = events.map(e => e.organizer).filter(Boolean);
  
  const chainUsage = {};
  events.forEach(e => {
    if (e.chain) {
      chainUsage[e.chain] = (chainUsage[e.chain] || 0) + 1;
    }
  });
  
  return {
    totalEvents: events.length,
    virtualEvents: events.filter(e => e.eventType === 'VIRTUAL').length,
    physicalEvents: events.filter(e => e.eventType === 'PHYSICAL').length,
    hybridEvents: events.filter(e => e.eventType === 'HYBRID').length,
    activeEvents: events.filter(e => e.status === 'ACTIVE').length,
    completedEvents: events.filter(e => e.status === 'COMPLETED').length,
    suspendedEvents: events.filter(e => e.status === 'SUSPENDED').length,
    totalUsers: uniqueUsers.length,
    totalOrganizers: new Set(uniqueOrganizers).size,
    totalAttendance,
    chainUsage,
    recentEvents: events.slice(-10).reverse(),
  };
}

/**
 * Get time-series metrics for charts
 */
async function getTimeSeriesMetrics(period = 'DAILY', startDate, endDate) {
  const metrics = await SystemMetrics.find({
    period,
    date: {
      $gte: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      $lte: endDate || new Date(),
    },
  }).sort({ date: 1 });
  
  return metrics;
}

/**
 * Aggregate and store system metrics
 */
async function aggregateMetrics(period = 'DAILY') {
  const metrics = await getDashboardMetrics();
  
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  
  const systemMetric = await SystemMetrics.findOneAndUpdate(
    { date, period },
    {
      date,
      period,
      metrics: {
        totalEvents: metrics.totalEvents,
        virtualEvents: metrics.virtualEvents,
        physicalEvents: metrics.physicalEvents,
        hybridEvents: metrics.hybridEvents,
        activeEvents: metrics.activeEvents,
        completedEvents: metrics.completedEvents,
        totalUsers: metrics.totalUsers,
        totalOrganizers: metrics.totalOrganizers,
        totalAttendanceRecords: metrics.totalAttendance,
        chainUsage: metrics.chainUsage,
        suspendedEvents: metrics.suspendedEvents,
      },
    },
    { upsert: true, new: true }
  );
  
  return systemMetric;
}

// ──────────────────────────────────────────────────────────────────────────────
// Abuse Detection & Monitoring
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Detect suspicious patterns
 */
async function detectSuspiciousPatterns() {
  const reports = [];
  
  // Detect rapid event creation
  const eventsPath = path.join(__dirname, '../../data/events.json');
  const deployedPath = path.join(__dirname, '../../data/deployedEvents.json');
  
  let events = [];
  try {
    const eventsData = await fs.readFile(eventsPath, 'utf8');
    const deployedData = await fs.readFile(deployedPath, 'utf8');
    events = [...JSON.parse(eventsData), ...JSON.parse(deployedData)];
  } catch (error) {
    console.error('Error reading events:', error);
  }
  
  // Group events by organizer
  const organizerEvents = {};
  events.forEach(event => {
    if (event.organizer) {
      const org = event.organizer.toLowerCase();
      if (!organizerEvents[org]) organizerEvents[org] = [];
      organizerEvents[org].push(event);
    }
  });
  
  // Check for rapid creation (more than 10 events in 24 hours)
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  for (const [organizer, orgEvents] of Object.entries(organizerEvents)) {
    const recentEvents = orgEvents.filter(e => 
      e.createdAt && new Date(e.createdAt) > oneDayAgo
    );
    
    if (recentEvents.length > 10) {
      reports.push({
        reportType: 'ORGANIZER',
        targetId: organizer,
        targetAddress: organizer,
        reason: 'RAPID_EVENT_CREATION',
        description: `Created ${recentEvents.length} events in the last 24 hours`,
        reportedBy: 'SYSTEM',
        severity: 'HIGH',
        autoDetected: true,
        evidence: {
          eventCount: recentEvents.length,
          timeframe: '24h',
          eventIds: recentEvents.map(e => e.id),
        },
      });
    }
  }
  
  // Detect unusual attendance patterns (100% attendance on multiple events)
  const attendanceRecords = await AttendanceRecord.find({ percentage: 100 });
  const userPerfectAttendance = {};
  
  attendanceRecords.forEach(record => {
    const addr = record.address.toLowerCase();
    if (!userPerfectAttendance[addr]) userPerfectAttendance[addr] = 0;
    userPerfectAttendance[addr]++;
  });
  
  for (const [address, count] of Object.entries(userPerfectAttendance)) {
    if (count > 5) {
      reports.push({
        reportType: 'USER',
        targetId: address,
        targetAddress: address,
        reason: 'UNUSUAL_ATTENDANCE',
        description: `100% attendance on ${count} events`,
        reportedBy: 'SYSTEM',
        severity: 'MEDIUM',
        autoDetected: true,
        evidence: {
          perfectAttendanceCount: count,
        },
      });
    }
  }
  
  return reports;
}

/**
 * Create abuse report
 */
async function createAbuseReport(reportData) {
  const report = new AbuseReport(reportData);
  await report.save();
  
  await logAdminAction(
    reportData.reportedBy,
    'FLAG_ABUSE',
    reportData.reportType,
    reportData.targetId,
    { reason: reportData.reason }
  );
  
  return report;
}

/**
 * Get abuse reports
 */
async function getAbuseReports(filters = {}) {
  const query = {};
  
  if (filters.status) query.status = filters.status;
  if (filters.severity) query.severity = filters.severity;
  if (filters.reportType) query.reportType = filters.reportType;
  
  return await AbuseReport.find(query).sort({ severity: -1, createdAt: -1 });
}

/**
 * Resolve abuse report
 */
async function resolveAbuseReport(reportId, adminAddress, action, notes) {
  const report = await AbuseReport.findById(reportId);
  if (!report) throw new Error('Report not found');
  
  report.status = 'RESOLVED';
  report.resolution = {
    action,
    resolvedBy: adminAddress,
    resolvedAt: new Date(),
    notes,
  };
  
  await report.save();
  
  await logAdminAction(
    adminAddress,
    'RESOLVE_ABUSE',
    report.reportType,
    report.targetId,
    { action, notes }
  );
  
  return report;
}

// ──────────────────────────────────────────────────────────────────────────────
// Audit Logging
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Log admin action
 */
async function logAdminAction(adminAddress, action, targetType, targetId, details = {}, req = null) {
  const log = new AdminLog({
    adminAddress: adminAddress.toLowerCase(),
    action,
    targetType,
    targetId,
    details,
    ipAddress: req?.ip || req?.headers?.['x-forwarded-for'] || null,
    userAgent: req?.headers?.['user-agent'] || null,
    success: true,
  });
  
  await log.save();
  return log;
}

/**
 * Get admin logs
 */
async function getAdminLogs(filters = {}) {
  const query = {};
  
  if (filters.adminAddress) {
    query.adminAddress = filters.adminAddress.toLowerCase();
  }
  if (filters.action) {
    query.action = filters.action;
  }
  if (filters.targetType) {
    query.targetType = filters.targetType;
  }
  if (filters.startDate || filters.endDate) {
    query.createdAt = {};
    if (filters.startDate) query.createdAt.$gte = new Date(filters.startDate);
    if (filters.endDate) query.createdAt.$lte = new Date(filters.endDate);
  }
  
  return await AdminLog.find(query)
    .sort({ createdAt: -1 })
    .limit(filters.limit || 100);
}

// ──────────────────────────────────────────────────────────────────────────────
// Exports
// ──────────────────────────────────────────────────────────────────────────────

module.exports = {
  // Admin management
  getOrCreateAdmin,
  isAdmin,
  hasPermission,
  listAdmins,
  
  // Event management
  getAllEvents,
  suspendEvent,
  restoreEvent,
  deleteEvent,
  
  // User management
  getAllUsers,
  getUserStats,
  
  // Organizer management
  getAllOrganizers,
  
  // Metrics
  getDashboardMetrics,
  getTimeSeriesMetrics,
  aggregateMetrics,
  
  // Abuse detection
  detectSuspiciousPatterns,
  createAbuseReport,
  getAbuseReports,
  resolveAbuseReport,
  
  // Audit logging
  logAdminAction,
  getAdminLogs,
};
