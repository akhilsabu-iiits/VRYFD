const rateLimit = require('express-rate-limit');
const apiKeyService = require('../services/apiKeyService');

/**
 * API Authentication Middleware
 * Validates API keys and enforces rate limiting
 */

// Store for tracking API key usage
const usageStore = new Map();

/**
 * Extract API key from request
 * Supports both Authorization header and query parameter
 */
function extractApiKey(req) {
  // Check Authorization header (preferred)
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7);
  }

  // Check query parameter (fallback)
  if (req.query.api_key) {
    return req.query.api_key;
  }

  return null;
}

/**
 * Middleware to authenticate API requests
 */
async function authenticateApiKey(req, res, next) {
  try {
    const apiKey = extractApiKey(req);

    if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'API key required',
        message: 'Please provide an API key in the Authorization header as "Bearer YOUR_API_KEY"',
      });
    }

    // Validate API key
    const validatedKey = await apiKeyService.validateApiKey(apiKey);

    if (!validatedKey) {
      return res.status(401).json({
        success: false,
        error: 'Invalid API key',
        message: 'The provided API key is invalid, expired, or has been revoked',
      });
    }

    // Attach API key info to request
    req.apiKey = validatedKey;
    req.apiKeyId = validatedKey._id.toString();

    next();
  } catch (error) {
    console.error('Error authenticating API key:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

/**
 * Middleware to check if API key has required scope
 */
function requireScope(scope) {
  return (req, res, next) => {
    if (!req.apiKey) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required',
      });
    }

    if (!apiKeyService.hasScope(req.apiKey, scope)) {
      return res.status(403).json({
        success: false,
        error: 'Insufficient permissions',
        message: `This endpoint requires the '${scope}' scope`,
        requiredScope: scope,
        availableScopes: req.apiKey.scopes,
      });
    }

    next();
  };
}

/**
 * Create rate limiter for API key
 */
function createApiKeyRateLimiter() {
  return rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: async (req) => {
      // Use API key's rate limit if available
      if (req.apiKey && req.apiKey.rateLimit) {
        return req.apiKey.rateLimit;
      }
      // Default rate limit
      return parseInt(process.env.API_RATE_LIMIT || '100');
    },
    keyGenerator: (req) => {
      return req.apiKeyId || "anonymous";
    },
    validate: { xForwardedForHeader: false },
    handler: (req, res) => {
      const limit = req.apiKey?.rateLimit || 100;
      res.status(429).json({
        success: false,
        error: 'Rate limit exceeded',
        message: `You have exceeded the rate limit of ${limit} requests per minute`,
        retryAfter: 60,
      });
    },
    standardHeaders: true, // Return rate limit info in headers
    legacyHeaders: false,
  });
}

/**
 * Middleware to log API usage
 */
function logApiUsage(req, res, next) {
  // Log request details
  const logEntry = {
    timestamp: new Date().toISOString(),
    apiKeyId: req.apiKeyId,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userAgent: req.get('user-agent'),
  };

  // Log to console (in production, send to logging service)
  console.log('[API Usage]', JSON.stringify(logEntry));

  // Track response time
  const startTime = Date.now();

  // Capture response
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    console.log('[API Response]', {
      ...logEntry,
      status: res.statusCode,
      duration: `${duration}ms`,
    });
  });

  next();
}

/**
 * Combined middleware for public API endpoints
 * Authenticates, rate limits, and logs requests
 */
function publicApiAuth(requiredScope = null) {
  const middlewares = [
    authenticateApiKey,
    createApiKeyRateLimiter(),
    logApiUsage,
  ];

  if (requiredScope) {
    middlewares.push(requireScope(requiredScope));
  }

  return middlewares;
}

/**
 * Middleware to add CORS headers for API endpoints
 */
function apiCors(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  next();
}

/**
 * Error handler for API routes
 */
function apiErrorHandler(err, req, res, next) {
  console.error('[API Error]', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    apiKeyId: req.apiKeyId,
  });

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';

  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal server error',
    ...(isDevelopment && { stack: err.stack }),
  });
}

module.exports = {
  authenticateApiKey,
  requireScope,
  createApiKeyRateLimiter,
  logApiUsage,
  publicApiAuth,
  apiCors,
  apiErrorHandler,
  extractApiKey,
};
