const crypto = require('crypto');
const axios = require('axios');
const { WebhookEndpoint, WebhookDelivery } = require('../db/schema');

/**
 * Webhook Service
 * Handles webhook registration, delivery, and retry logic
 */

class WebhookService {
  constructor() {
    this.retryAttempts = parseInt(process.env.WEBHOOK_RETRY_ATTEMPTS || '3');
    this.timeout = parseInt(process.env.WEBHOOK_TIMEOUT || '5000');
    
    // Start retry processor
    this.startRetryProcessor();
  }

  /**
   * Register a new webhook endpoint
   * @param {string} url - Webhook URL
   * @param {string[]} events - Array of event types to subscribe to
   * @param {string} createdBy - Wallet address of creator
   * @param {string} description - Optional description
   * @returns {Promise<Object>} Created webhook endpoint with secret
   */
  async registerWebhook(url, events, createdBy, description = '') {
    try {
      // Validate URL
      if (!this.isValidUrl(url)) {
        throw new Error('Invalid webhook URL');
      }

      // Validate events
      if (!this.validateEvents(events)) {
        throw new Error('Invalid event types');
      }

      // Generate secret for HMAC signatures
      const secret = crypto.randomBytes(32).toString('hex');

      const webhook = new WebhookEndpoint({
        url,
        events,
        secret,
        createdBy: createdBy.toLowerCase(),
        description,
        active: true,
        retryCount: this.retryAttempts,
      });

      await webhook.save();

      return {
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        secret: secret, // Return secret only once
        description: webhook.description,
        active: webhook.active,
        createdAt: webhook.createdAt,
      };
    } catch (error) {
      console.error('Error registering webhook:', error);
      throw new Error('Failed to register webhook');
    }
  }

  /**
   * Update webhook endpoint
   * @param {string} webhookId - Webhook ID
   * @param {Object} updates - Updates to apply
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<Object>} Updated webhook
   */
  async updateWebhook(webhookId, updates, walletAddress) {
    try {
      const webhook = await WebhookEndpoint.findOne({
        _id: webhookId,
        createdBy: walletAddress.toLowerCase(),
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      // Validate updates
      if (updates.url && !this.isValidUrl(updates.url)) {
        throw new Error('Invalid webhook URL');
      }

      if (updates.events && !this.validateEvents(updates.events)) {
        throw new Error('Invalid event types');
      }

      // Apply updates
      if (updates.url) webhook.url = updates.url;
      if (updates.events) webhook.events = updates.events;
      if (updates.description !== undefined) webhook.description = updates.description;
      if (updates.active !== undefined) webhook.active = updates.active;

      await webhook.save();

      return {
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        description: webhook.description,
        active: webhook.active,
        updatedAt: webhook.updatedAt,
      };
    } catch (error) {
      console.error('Error updating webhook:', error);
      throw new Error('Failed to update webhook');
    }
  }

  /**
   * Delete webhook endpoint
   * @param {string} webhookId - Webhook ID
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<boolean>} True if deleted
   */
  async deleteWebhook(webhookId, walletAddress) {
    try {
      const result = await WebhookEndpoint.deleteOne({
        _id: webhookId,
        createdBy: walletAddress.toLowerCase(),
      });

      return result.deletedCount > 0;
    } catch (error) {
      console.error('Error deleting webhook:', error);
      throw new Error('Failed to delete webhook');
    }
  }

  /**
   * List webhooks for a user
   * @param {string} walletAddress - Wallet address
   * @returns {Promise<Array>} List of webhooks
   */
  async listWebhooks(walletAddress) {
    try {
      const webhooks = await WebhookEndpoint.find({
        createdBy: walletAddress.toLowerCase(),
      }).sort({ createdAt: -1 });

      return webhooks.map(webhook => ({
        id: webhook._id,
        url: webhook.url,
        events: webhook.events,
        description: webhook.description,
        active: webhook.active,
        lastDeliveryAt: webhook.lastDeliveryAt,
        lastDeliveryStatus: webhook.lastDeliveryStatus,
        successCount: webhook.successCount,
        failureCount: webhook.failureCount,
        createdAt: webhook.createdAt,
      }));
    } catch (error) {
      console.error('Error listing webhooks:', error);
      throw new Error('Failed to list webhooks');
    }
  }

  /**
   * Trigger webhook event
   * @param {string} eventType - Event type (e.g., 'event.created')
   * @param {Object} payload - Event payload
   * @returns {Promise<void>}
   */
  async triggerEvent(eventType, payload) {
    try {
      // Find all active webhooks subscribed to this event
      const webhooks = await WebhookEndpoint.find({
        active: true,
        events: eventType,
      });

      console.log(`Triggering ${eventType} for ${webhooks.length} webhooks`);

      // Create delivery records for each webhook
      const deliveryPromises = webhooks.map(webhook =>
        this.createDelivery(webhook, eventType, payload)
      );

      await Promise.all(deliveryPromises);
    } catch (error) {
      console.error('Error triggering webhook event:', error);
    }
  }

  /**
   * Create and attempt webhook delivery
   * @param {Object} webhook - Webhook endpoint
   * @param {string} eventType - Event type
   * @param {Object} payload - Event payload
   * @returns {Promise<void>}
   */
  async createDelivery(webhook, eventType, payload) {
    try {
      // Create delivery record
      const delivery = new WebhookDelivery({
        webhookId: webhook._id,
        event: eventType,
        payload,
        status: 'pending',
        attempts: 0,
        maxAttempts: webhook.retryCount,
      });

      await delivery.save();

      // Attempt immediate delivery
      await this.attemptDelivery(delivery, webhook);
    } catch (error) {
      console.error('Error creating webhook delivery:', error);
    }
  }

  /**
   * Attempt webhook delivery
   * @param {Object} delivery - Delivery record
   * @param {Object} webhook - Webhook endpoint (optional, will fetch if not provided)
   * @returns {Promise<void>}
   */
  async attemptDelivery(delivery, webhook = null) {
    try {
      // Fetch webhook if not provided
      if (!webhook) {
        webhook = await WebhookEndpoint.findById(delivery.webhookId);
        if (!webhook || !webhook.active) {
          delivery.status = 'failed';
          delivery.errorMessage = 'Webhook endpoint not found or inactive';
          await delivery.save();
          return;
        }
      }

      // Increment attempt count
      delivery.attempts += 1;
      delivery.lastAttemptAt = new Date();

      // Generate HMAC signature
      const signature = this.generateSignature(delivery.payload, webhook.secret);
      delivery.signature = signature;

      // Prepare webhook payload
      const webhookPayload = {
        id: delivery._id,
        event: delivery.event,
        created: delivery.createdAt,
        data: delivery.payload,
      };

      // Send webhook
      const response = await axios.post(webhook.url, webhookPayload, {
        headers: {
          'Content-Type': 'application/json',
          'X-VRYFD-Signature': signature,
          'X-VRYFD-Event': delivery.event,
          'X-VRYFD-Delivery': delivery._id.toString(),
        },
        timeout: this.timeout,
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Success
      delivery.status = 'success';
      delivery.responseStatus = response.status;
      delivery.responseBody = JSON.stringify(response.data).substring(0, 1000);
      delivery.deliveredAt = new Date();

      // Update webhook stats
      webhook.lastDeliveryAt = new Date();
      webhook.lastDeliveryStatus = 'success';
      webhook.successCount += 1;
      await webhook.save();

      console.log(`Webhook delivered successfully: ${webhook.url} - ${delivery.event}`);
    } catch (error) {
      // Failure
      delivery.status = delivery.attempts >= delivery.maxAttempts ? 'failed' : 'retrying';
      delivery.errorMessage = error.message;
      
      if (error.response) {
        delivery.responseStatus = error.response.status;
        delivery.responseBody = JSON.stringify(error.response.data).substring(0, 1000);
      }

      // Schedule retry if attempts remaining
      if (delivery.attempts < delivery.maxAttempts) {
        const retryDelay = this.calculateRetryDelay(delivery.attempts);
        delivery.nextRetryAt = new Date(Date.now() + retryDelay);
        console.log(`Webhook delivery failed, will retry in ${retryDelay}ms: ${webhook.url}`);
      } else {
        // Update webhook stats
        webhook.lastDeliveryAt = new Date();
        webhook.lastDeliveryStatus = 'failed';
        webhook.failureCount += 1;
        await webhook.save();
        
        console.error(`Webhook delivery failed after ${delivery.attempts} attempts: ${webhook.url}`);
      }
    } finally {
      await delivery.save();
    }
  }

  /**
   * Get delivery history for a webhook
   * @param {string} webhookId - Webhook ID
   * @param {string} walletAddress - Wallet address of owner
   * @param {number} limit - Limit results
   * @param {number} skip - Skip results
   * @returns {Promise<Object>} Paginated delivery history
   */
  async getDeliveryHistory(webhookId, walletAddress, limit = 50, skip = 0) {
    try {
      // Verify ownership
      const webhook = await WebhookEndpoint.findOne({
        _id: webhookId,
        createdBy: walletAddress.toLowerCase(),
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      const total = await WebhookDelivery.countDocuments({ webhookId });
      const deliveries = await WebhookDelivery.find({ webhookId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip)
        .select('-payload'); // Don't return full payload in list

      return {
        total,
        limit,
        skip,
        deliveries: deliveries.map(d => ({
          id: d._id,
          event: d.event,
          status: d.status,
          attempts: d.attempts,
          maxAttempts: d.maxAttempts,
          lastAttemptAt: d.lastAttemptAt,
          nextRetryAt: d.nextRetryAt,
          responseStatus: d.responseStatus,
          errorMessage: d.errorMessage,
          deliveredAt: d.deliveredAt,
          createdAt: d.createdAt,
        })),
      };
    } catch (error) {
      console.error('Error getting delivery history:', error);
      throw new Error('Failed to get delivery history');
    }
  }

  /**
   * Retry a failed delivery
   * @param {string} deliveryId - Delivery ID
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<void>}
   */
  async retryDelivery(deliveryId, walletAddress) {
    try {
      const delivery = await WebhookDelivery.findById(deliveryId);
      
      if (!delivery) {
        throw new Error('Delivery not found');
      }

      // Verify ownership
      const webhook = await WebhookEndpoint.findOne({
        _id: delivery.webhookId,
        createdBy: walletAddress.toLowerCase(),
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      // Reset delivery for retry
      delivery.status = 'retrying';
      delivery.nextRetryAt = new Date();
      await delivery.save();

      // Attempt delivery
      await this.attemptDelivery(delivery, webhook);
    } catch (error) {
      console.error('Error retrying delivery:', error);
      throw new Error('Failed to retry delivery');
    }
  }

  /**
   * Verify webhook signature
   * @param {Object} payload - Webhook payload
   * @param {string} signature - Received signature
   * @param {string} secret - Webhook secret
   * @returns {boolean} True if signature is valid
   */
  verifySignature(payload, signature, secret) {
    try {
      const expectedSignature = this.generateSignature(payload, secret);
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate HMAC signature for webhook payload
   * @param {Object} payload - Payload to sign
   * @param {string} secret - Secret key
   * @returns {string} HMAC signature
   */
  generateSignature(payload, secret) {
    const payloadString = JSON.stringify(payload);
    return crypto
      .createHmac('sha256', secret)
      .update(payloadString)
      .digest('hex');
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attemptNumber - Current attempt number
   * @returns {number} Delay in milliseconds
   */
  calculateRetryDelay(attemptNumber) {
    // Exponential backoff: 1s, 2s, 4s, 8s, etc.
    const baseDelay = 1000;
    const maxDelay = 60000; // Max 1 minute
    const delay = Math.min(baseDelay * Math.pow(2, attemptNumber - 1), maxDelay);
    
    // Add jitter to prevent thundering herd
    const jitter = Math.random() * 1000;
    return delay + jitter;
  }

  /**
   * Validate URL format
   * @param {string} url - URL to validate
   * @returns {boolean} True if valid
   */
  isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate event types
   * @param {string[]} events - Array of event types
   * @returns {boolean} True if all events are valid
   */
  validateEvents(events) {
    const validEvents = [
      'event.created',
      'event.updated',
      'attendance.recorded',
      'certificate.issued',
      'badge.claimed',
      'milestone.achieved',
    ];

    if (!Array.isArray(events) || events.length === 0) {
      return false;
    }

    return events.every(event => validEvents.includes(event));
  }

  /**
   * Start background processor for retrying failed deliveries
   */
  startRetryProcessor() {
    // Run every 30 seconds
    setInterval(async () => {
      try {
        const now = new Date();
        const pendingRetries = await WebhookDelivery.find({
          status: 'retrying',
          nextRetryAt: { $lte: now },
        }).limit(10);

        for (const delivery of pendingRetries) {
          await this.attemptDelivery(delivery);
        }
      } catch (error) {
        console.error('Error in retry processor:', error);
      }
    }, 30000);
  }

  /**
   * Test webhook endpoint
   * @param {string} webhookId - Webhook ID
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<Object>} Test result
   */
  async testWebhook(webhookId, walletAddress) {
    try {
      const webhook = await WebhookEndpoint.findOne({
        _id: webhookId,
        createdBy: walletAddress.toLowerCase(),
      });

      if (!webhook) {
        throw new Error('Webhook not found');
      }

      // Create test payload
      const testPayload = {
        test: true,
        message: 'This is a test webhook from VRYFD',
        timestamp: new Date().toISOString(),
      };

      // Create test delivery
      await this.createDelivery(webhook, 'test.webhook', testPayload);

      return {
        success: true,
        message: 'Test webhook sent',
      };
    } catch (error) {
      console.error('Error testing webhook:', error);
      throw new Error('Failed to test webhook');
    }
  }
}

module.exports = new WebhookService();
