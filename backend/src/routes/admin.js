const express = require('express');
const router = express.Router();
const adminService = require('../services/adminService');
const { verifyAdminAuth, requirePermission } = require('../middleware/adminAuth');

// ──────────────────────────────────────────────────────────────────────────────
// All admin routes require authentication
// ──────────────────────────────────────────────────────────────────────────────
router.use(verifyAdminAuth);

// ──────────────────────────────────────────────────────────────────────────────
// Dashboard & Metrics
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/dashboard
 * Get system overview with KPIs
 */
router.get('/dashboard', async (req, res) => {
  try {
    const metrics = await adminService.getDashboardMetrics();
    
    await adminService.logAdminAction(
      req.adminAddress,
      'VIEW_METRICS',
      'SYSTEM',
      'dashboard',
      {},
      req
    );
    
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/metrics
 * Get time-series metrics for charts
 */
router.get('/metrics', async (req, res) => {
  try {
    const { period = 'DAILY', startDate, endDate } = req.query;
    
    const metrics = await adminService.getTimeSeriesMetrics(
      period,
      startDate ? new Date(startDate) : undefined,
      endDate ? new Date(endDate) : undefined
    );
    
    res.json({
      success: true,
      data: metrics,
    });
  } catch (error) {
    console.error('Error fetching metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/metrics/aggregate
 * Manually trigger metrics aggregation (SUPER_ADMIN only)
 */
router.post('/metrics/aggregate', requirePermission('canManageAdmins'), async (req, res) => {
  try {
    const { period = 'DAILY' } = req.body;
    
    const metric = await adminService.aggregateMetrics(period);
    
    res.json({
      success: true,
      data: metric,
    });
  } catch (error) {
    console.error('Error aggregating metrics:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Event Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/events
 * List all events with filters
 */
router.get('/events', async (req, res) => {
  try {
    const { type, status, organizer, search } = req.query;
    
    const events = await adminService.getAllEvents({
      type,
      status,
      organizer,
      search,
    });
    
    res.json({
      success: true,
      data: events,
      count: events.length,
    });
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/events/:id/suspend
 * Suspend an event
 */
router.put('/events/:id/suspend', requirePermission('canSuspendEvents'), async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Suspension reason is required',
      });
    }
    
    const updated = await adminService.suspendEvent(id, req.adminAddress, reason);
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Event suspended successfully',
    });
  } catch (error) {
    console.error('Error suspending event:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/events/:id/restore
 * Restore a suspended event
 */
router.put('/events/:id/restore', requirePermission('canSuspendEvents'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const updated = await adminService.restoreEvent(id, req.adminAddress);
    
    if (!updated) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Event restored successfully',
    });
  } catch (error) {
    console.error('Error restoring event:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * DELETE /api/admin/events/:id
 * Delete an event (SUPER_ADMIN only)
 */
router.delete('/events/:id', requirePermission('canDeleteEvents'), async (req, res) => {
  try {
    const { id } = req.params;
    
    const deleted = await adminService.deleteEvent(id, req.adminAddress);
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Event not found',
      });
    }
    
    res.json({
      success: true,
      message: 'Event deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting event:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// User Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/users
 * List all users with statistics
 */
router.get('/users', async (req, res) => {
  try {
    const { search } = req.query;
    
    const users = await adminService.getAllUsers({ search });
    
    res.json({
      success: true,
      data: users,
      count: users.length,
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/users/:address
 * Get detailed user statistics
 */
router.get('/users/:address', async (req, res) => {
  try {
    const { address } = req.params;
    
    const stats = await adminService.getUserStats(address);
    
    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error fetching user stats:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/users/:address/suspend
 * Suspend a user (placeholder - would need user suspension schema)
 */
router.put('/users/:address/suspend', requirePermission('canSuspendUsers'), async (req, res) => {
  try {
    const { address } = req.params;
    const { reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Suspension reason is required',
      });
    }
    
    // Log the action
    await adminService.logAdminAction(
      req.adminAddress,
      'SUSPEND_USER',
      'USER',
      address,
      { reason },
      req
    );
    
    res.json({
      success: true,
      message: 'User suspension logged (implementation pending)',
    });
  } catch (error) {
    console.error('Error suspending user:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Organizer Management
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/organizers
 * List all organizers with statistics
 */
router.get('/organizers', async (req, res) => {
  try {
    const organizers = await adminService.getAllOrganizers();
    
    res.json({
      success: true,
      data: organizers,
      count: organizers.length,
    });
  } catch (error) {
    console.error('Error fetching organizers:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Abuse Monitoring
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/abuse
 * Get abuse reports with filters
 */
router.get('/abuse', async (req, res) => {
  try {
    const { status, severity, reportType } = req.query;
    
    const reports = await adminService.getAbuseReports({
      status,
      severity,
      reportType,
    });
    
    res.json({
      success: true,
      data: reports,
      count: reports.length,
    });
  } catch (error) {
    console.error('Error fetching abuse reports:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * POST /api/admin/abuse/flag
 * Create a new abuse report
 */
router.post('/abuse/flag', async (req, res) => {
  try {
    const { reportType, targetId, targetAddress, reason, description, severity } = req.body;
    
    if (!reportType || !targetId || !reason) {
      return res.status(400).json({
        success: false,
        error: 'reportType, targetId, and reason are required',
      });
    }
    
    const report = await adminService.createAbuseReport({
      reportType,
      targetId,
      targetAddress,
      reason,
      description: description || '',
      severity: severity || 'MEDIUM',
      reportedBy: req.adminAddress,
      autoDetected: false,
    });
    
    res.json({
      success: true,
      data: report,
      message: 'Abuse report created successfully',
    });
  } catch (error) {
    console.error('Error creating abuse report:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * PUT /api/admin/abuse/:id/resolve
 * Resolve an abuse report
 */
router.put('/abuse/:id/resolve', requirePermission('canSuspendEvents'), async (req, res) => {
  try {
    const { id } = req.params;
    const { action, notes } = req.body;
    
    if (!action) {
      return res.status(400).json({
        success: false,
        error: 'Resolution action is required',
      });
    }
    
    const report = await adminService.resolveAbuseReport(
      id,
      req.adminAddress,
      action,
      notes || ''
    );
    
    res.json({
      success: true,
      data: report,
      message: 'Abuse report resolved successfully',
    });
  } catch (error) {
    console.error('Error resolving abuse report:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/abuse/detect
 * Run suspicious pattern detection
 */
router.get('/abuse/detect', requirePermission('canSuspendEvents'), async (req, res) => {
  try {
    const patterns = await adminService.detectSuspiciousPatterns();
    
    // Auto-create reports for detected patterns
    for (const pattern of patterns) {
      await adminService.createAbuseReport(pattern);
    }
    
    res.json({
      success: true,
      data: patterns,
      count: patterns.length,
      message: `Detected ${patterns.length} suspicious patterns`,
    });
  } catch (error) {
    console.error('Error detecting patterns:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Audit Logs
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/logs
 * Get admin action logs
 */
router.get('/logs', async (req, res) => {
  try {
    const { adminAddress, action, targetType, startDate, endDate, limit } = req.query;
    
    const logs = await adminService.getAdminLogs({
      adminAddress,
      action,
      targetType,
      startDate,
      endDate,
      limit: limit ? parseInt(limit) : 100,
    });
    
    res.json({
      success: true,
      data: logs,
      count: logs.length,
    });
  } catch (error) {
    console.error('Error fetching logs:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Admin Management (SUPER_ADMIN only)
// ──────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/admin/admins
 * List all admins
 */
router.get('/admins', requirePermission('canManageAdmins'), async (req, res) => {
  try {
    const admins = await adminService.listAdmins();
    
    res.json({
      success: true,
      data: admins,
      count: admins.length,
    });
  } catch (error) {
    console.error('Error fetching admins:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * GET /api/admin/me
 * Get current admin info
 */
router.get('/me', async (req, res) => {
  try {
    const admin = await adminService.getOrCreateAdmin(req.adminAddress);
    
    res.json({
      success: true,
      data: admin,
    });
  } catch (error) {
    console.error('Error fetching admin info:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;
