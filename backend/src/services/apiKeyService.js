const crypto = require('crypto');
const { ApiKey } = require('../db/schema');

/**
 * API Key Service
 * Handles API key generation, validation, and management
 */

class ApiKeyService {
  /**
   * Generate a new API key
   * @param {string} name - Name/description of the API key
   * @param {string[]} scopes - Array of permission scopes
   * @param {string} createdBy - Wallet address of creator
   * @param {string} environment - 'live' or 'test'
   * @param {number} rateLimit - Requests per minute (default: 100)
   * @param {Date} expiresAt - Optional expiration date
   * @returns {Promise<Object>} Created API key with plaintext key
   */
  async generateApiKey(name, scopes, createdBy, environment = 'live', rateLimit = 100, expiresAt = null) {
    try {
      // Generate random key
      const randomBytes = crypto.randomBytes(32);
      const keyHash = randomBytes.toString('hex');
      
      // Format with prefix
      const prefix = environment === 'live' ? 'vryfd_live_' : 'vryfd_test_';
      const apiKey = `${prefix}${keyHash}`;

      // Create API key record
      const newApiKey = new ApiKey({
        key: apiKey,
        name,
        scopes,
        rateLimit,
        createdBy: createdBy.toLowerCase(),
        active: true,
        environment,
        expiresAt,
      });

      await newApiKey.save();

      return {
        id: newApiKey._id,
        key: apiKey, // Return plaintext key only once
        name: newApiKey.name,
        scopes: newApiKey.scopes,
        rateLimit: newApiKey.rateLimit,
        environment: newApiKey.environment,
        createdAt: newApiKey.createdAt,
        expiresAt: newApiKey.expiresAt,
      };
    } catch (error) {
      console.error('Error generating API key:', error);
      throw new Error('Failed to generate API key');
    }
  }

  /**
   * Validate an API key
   * @param {string} key - API key to validate
   * @returns {Promise<Object|null>} API key object if valid, null otherwise
   */
  async validateApiKey(key) {
    try {
      if (!key || typeof key !== 'string') {
        return null;
      }

      // Check format
      if (!key.startsWith('vryfd_live_') && !key.startsWith('vryfd_test_')) {
        return null;
      }

      const apiKey = await ApiKey.findOne({ key, active: true });
      
      if (!apiKey) {
        return null;
      }

      // Check if expired
      if (!apiKey.isValid()) {
        return null;
      }

      // Update last used timestamp and usage count
      apiKey.lastUsed = new Date();
      apiKey.usageCount += 1;
      await apiKey.save();

      return apiKey;
    } catch (error) {
      console.error('Error validating API key:', error);
      return null;
    }
  }

  /**
   * Check if API key has required scope
   * @param {Object} apiKey - API key object
   * @param {string} requiredScope - Required scope
   * @returns {boolean} True if key has scope
   */
  hasScope(apiKey, requiredScope) {
    if (!apiKey || !apiKey.scopes) {
      return false;
    }
    return apiKey.hasScope(requiredScope);
  }

  /**
   * List API keys for a user
   * @param {string} walletAddress - Wallet address
   * @param {boolean} includeInactive - Include inactive keys
   * @returns {Promise<Array>} List of API keys (without plaintext keys)
   */
  async listApiKeys(walletAddress, includeInactive = false) {
    try {
      const query = { createdBy: walletAddress.toLowerCase() };
      if (!includeInactive) {
        query.active = true;
      }

      const apiKeys = await ApiKey.find(query)
        .select('-key') // Don't return the actual key
        .sort({ createdAt: -1 });

      return apiKeys.map(key => ({
        id: key._id,
        name: key.name,
        scopes: key.scopes,
        rateLimit: key.rateLimit,
        environment: key.environment,
        active: key.active,
        lastUsed: key.lastUsed,
        usageCount: key.usageCount,
        createdAt: key.createdAt,
        expiresAt: key.expiresAt,
        keyPreview: this.maskApiKey(key.key),
      }));
    } catch (error) {
      console.error('Error listing API keys:', error);
      throw new Error('Failed to list API keys');
    }
  }

  /**
   * Revoke an API key
   * @param {string} keyId - API key ID
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<boolean>} True if revoked successfully
   */
  async revokeApiKey(keyId, walletAddress) {
    try {
      const apiKey = await ApiKey.findOne({
        _id: keyId,
        createdBy: walletAddress.toLowerCase(),
      });

      if (!apiKey) {
        throw new Error('API key not found');
      }

      apiKey.active = false;
      await apiKey.save();

      return true;
    } catch (error) {
      console.error('Error revoking API key:', error);
      throw new Error('Failed to revoke API key');
    }
  }

  /**
   * Rotate an API key (create new, revoke old)
   * @param {string} keyId - API key ID to rotate
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<Object>} New API key
   */
  async rotateApiKey(keyId, walletAddress) {
    try {
      const oldKey = await ApiKey.findOne({
        _id: keyId,
        createdBy: walletAddress.toLowerCase(),
      });

      if (!oldKey) {
        throw new Error('API key not found');
      }

      // Create new key with same settings
      const newKey = await this.generateApiKey(
        oldKey.name,
        oldKey.scopes,
        walletAddress,
        oldKey.environment,
        oldKey.rateLimit,
        oldKey.expiresAt
      );

      // Revoke old key
      oldKey.active = false;
      await oldKey.save();

      return newKey;
    } catch (error) {
      console.error('Error rotating API key:', error);
      throw new Error('Failed to rotate API key');
    }
  }

  /**
   * Get API key usage statistics
   * @param {string} keyId - API key ID
   * @param {string} walletAddress - Wallet address of owner
   * @returns {Promise<Object>} Usage statistics
   */
  async getApiKeyStats(keyId, walletAddress) {
    try {
      const apiKey = await ApiKey.findOne({
        _id: keyId,
        createdBy: walletAddress.toLowerCase(),
      }).select('-key');

      if (!apiKey) {
        throw new Error('API key not found');
      }

      return {
        id: apiKey._id,
        name: apiKey.name,
        usageCount: apiKey.usageCount,
        lastUsed: apiKey.lastUsed,
        createdAt: apiKey.createdAt,
        active: apiKey.active,
        rateLimit: apiKey.rateLimit,
        environment: apiKey.environment,
      };
    } catch (error) {
      console.error('Error getting API key stats:', error);
      throw new Error('Failed to get API key statistics');
    }
  }

  /**
   * Mask API key for display
   * @param {string} key - Full API key
   * @returns {string} Masked key
   */
  maskApiKey(key) {
    if (!key || key.length < 20) {
      return '****';
    }
    const prefix = key.substring(0, 12); // vryfd_live_ or vryfd_test_
    const suffix = key.substring(key.length - 4);
    return `${prefix}${'*'.repeat(20)}${suffix}`;
  }

  /**
   * Validate scopes
   * @param {string[]} scopes - Array of scopes to validate
   * @returns {boolean} True if all scopes are valid
   */
  validateScopes(scopes) {
    const validScopes = [
      'events:read',
      'events:create',
      'attendance:read',
      'certificates:read',
      'webhooks:manage',
      'leaderboard:read',
    ];

    if (!Array.isArray(scopes) || scopes.length === 0) {
      return false;
    }

    return scopes.every(scope => validScopes.includes(scope));
  }

  /**
   * Get all API keys (admin only)
   * @param {number} limit - Limit results
   * @param {number} skip - Skip results
   * @returns {Promise<Object>} Paginated API keys
   */
  async getAllApiKeys(limit = 50, skip = 0) {
    try {
      const total = await ApiKey.countDocuments();
      const apiKeys = await ApiKey.find()
        .select('-key')
        .sort({ createdAt: -1 })
        .limit(limit)
        .skip(skip);

      return {
        total,
        limit,
        skip,
        keys: apiKeys.map(key => ({
          id: key._id,
          name: key.name,
          scopes: key.scopes,
          rateLimit: key.rateLimit,
          environment: key.environment,
          active: key.active,
          createdBy: key.createdBy,
          lastUsed: key.lastUsed,
          usageCount: key.usageCount,
          createdAt: key.createdAt,
          expiresAt: key.expiresAt,
          keyPreview: this.maskApiKey(key.key),
        })),
      };
    } catch (error) {
      console.error('Error getting all API keys:', error);
      throw new Error('Failed to get API keys');
    }
  }
}

module.exports = new ApiKeyService();
