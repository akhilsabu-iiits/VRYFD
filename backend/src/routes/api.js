const express = require('express');
const router = express.Router();
const apiKeyService = require('../services/apiKeyService');
const webhookService = require('../services/webhookService');
const { verifyAdminAuth } = require('../middleware/adminAuth');

/**
 * API Routes
 * Manages API keys and webhooks
 * Requires admin authentication
 */

// ──────────────────────────────────────────────────────────────────────────────
// API Key Management Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/keys
 * Generate a new API key
 * Admin only
 */
router.post('/keys', verifyAdminAuth, async (req, res) => {
  try {
    const { name, scopes, environment, rateLimit, expiresAt } = req.body;
    const walletAddress = req.admin.walletAddress;

    // Validate required fields
    if (!name || !scopes) {
      return res.status(400).json({
        success: false,
        error: 'Name and scopes are required',
      });
    }

    // Validate scopes
    if (!apiKeyService.validateScopes(scopes)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid scopes provided',
      });
    }

    // Generate API key
    const apiKey = await apiKeyService.generateApiKey(
      name,
      scopes,
      walletAddress,
      environment || 'live',
      rateLimit || 100,
      expiresAt ? new Date(expiresAt) : null
    );

    res.json({
      success: true,
      data: apiKey,
      message: 'API key generated successfully. Save this key securely - it will not be shown again.',
    });
  } catch (error) {
    console.error('Error generating API key:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to generate API key',
    });
  }
});

/**
 * GET /api/v1/keys
 * List API keys for the authenticated user
 */
router.get('/keys', verifyAdminAuth, async (req, res) => {
  try {
    const walletAddress = req.admin.walletAddress;
    const includeInactive = req.query.includeInactive === 'true';

    const apiKeys = await apiKeyService.listApiKeys(walletAddress, includeInactive);

    res.json({
      success: true,
      data: apiKeys,
      count: apiKeys.length,
    });
  } catch (error) {
    console.error('Error listing API keys:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list API keys',
    });
  }
});

/**
 * GET /api/v1/keys/:id
 * Get API key statistics
 */
router.get('/keys/:id', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;

    const stats = await apiKeyService.getApiKeyStats(id, walletAddress);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Error getting API key stats:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get API key statistics',
    });
  }
});

/**
 * DELETE /api/v1/keys/:id
 * Revoke an API key
 */
router.delete('/keys/:id', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;

    await apiKeyService.revokeApiKey(id, walletAddress);

    res.json({
      success: true,
      message: 'API key revoked successfully',
    });
  } catch (error) {
    console.error('Error revoking API key:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to revoke API key',
    });
  }
});

/**
 * POST /api/v1/keys/:id/rotate
 * Rotate an API key (create new, revoke old)
 */
router.post('/keys/:id/rotate', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;

    const newKey = await apiKeyService.rotateApiKey(id, walletAddress);

    res.json({
      success: true,
      data: newKey,
      message: 'API key rotated successfully. Save the new key securely.',
    });
  } catch (error) {
    console.error('Error rotating API key:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to rotate API key',
    });
  }
});

// ──────────────────────────────────────────────────────────────────────────────
// Webhook Management Routes
// ──────────────────────────────────────────────────────────────────────────────

/**
 * POST /api/v1/webhooks
 * Register a new webhook endpoint
 */
router.post('/webhooks', verifyAdminAuth, async (req, res) => {
  try {
    const { url, events, description } = req.body;
    const walletAddress = req.admin.walletAddress;

    // Validate required fields
    if (!url || !events) {
      return res.status(400).json({
        success: false,
        error: 'URL and events are required',
      });
    }

    const webhook = await webhookService.registerWebhook(
      url,
      events,
      walletAddress,
      description || ''
    );

    res.json({
      success: true,
      data: webhook,
      message: 'Webhook registered successfully. Save the secret securely for signature verification.',
    });
  } catch (error) {
    console.error('Error registering webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to register webhook',
    });
  }
});

/**
 * GET /api/v1/webhooks
 * List webhooks for the authenticated user
 */
router.get('/webhooks', verifyAdminAuth, async (req, res) => {
  try {
    const walletAddress = req.admin.walletAddress;

    const webhooks = await webhookService.listWebhooks(walletAddress);

    res.json({
      success: true,
      data: webhooks,
      count: webhooks.length,
    });
  } catch (error) {
    console.error('Error listing webhooks:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to list webhooks',
    });
  }
});

/**
 * PUT /api/v1/webhooks/:id
 * Update a webhook endpoint
 */
router.put('/webhooks/:id', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;
    const updates = req.body;

    const webhook = await webhookService.updateWebhook(id, updates, walletAddress);

    res.json({
      success: true,
      data: webhook,
      message: 'Webhook updated successfully',
    });
  } catch (error) {
    console.error('Error updating webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to update webhook',
    });
  }
});

/**
 * DELETE /api/v1/webhooks/:id
 * Delete a webhook endpoint
 */
router.delete('/webhooks/:id', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;

    await webhookService.deleteWebhook(id, walletAddress);

    res.json({
      success: true,
      message: 'Webhook deleted successfully',
    });
  } catch (error) {
    console.error('Error deleting webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to delete webhook',
    });
  }
});

/**
 * GET /api/v1/webhooks/:id/deliveries
 * Get delivery history for a webhook
 */
router.get('/webhooks/:id/deliveries', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;
    const limit = parseInt(req.query.limit) || 50;
    const skip = parseInt(req.query.skip) || 0;

    const history = await webhookService.getDeliveryHistory(
      id,
      walletAddress,
      limit,
      skip
    );

    res.json({
      success: true,
      data: history,
    });
  } catch (error) {
    console.error('Error getting delivery history:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to get delivery history',
    });
  }
});

/**
 * POST /api/v1/webhooks/:id/test
 * Test a webhook endpoint
 */
router.post('/webhooks/:id/test', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;

    const result = await webhookService.testWebhook(id, walletAddress);

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Error testing webhook:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to test webhook',
    });
  }
});

/**
 * POST /api/v1/webhooks/deliveries/:id/retry
 * Retry a failed webhook delivery
 */
router.post('/webhooks/deliveries/:id/retry', verifyAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const walletAddress = req.admin.walletAddress;

    await webhookService.retryDelivery(id, walletAddress);

    res.json({
      success: true,
      message: 'Delivery retry initiated',
    });
  } catch (error) {
    console.error('Error retrying delivery:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to retry delivery',
    });
  }
});

module.exports = router;
