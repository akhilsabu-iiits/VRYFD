const { ethers } = require('ethers');
const adminService = require('../services/adminService');

/**
 * Legacy adminAuth middleware for organizer routes
 * Protects organizer/admin routes by requiring a shared secret in the
 * x-admin-secret request header. Set ADMIN_SECRET in the backend .env.
 *
 * NOTE: This is a defence-in-depth measure for a testnet project.
 *       For production use, replace with JWT / OAuth or move these
 *       endpoints behind a Next.js server-side API route so the secret
 *       never leaves the server.
 */
function adminAuth(req, res, next) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    console.error("[adminAuth] ADMIN_SECRET env var is not set — refusing request");
    return res.status(500).json({ error: "Server misconfiguration: ADMIN_SECRET not set" });
  }
  const provided = req.headers["x-admin-secret"];
  if (!provided || provided !== secret) {
    return res.status(401).json({ error: "Unauthorized — missing or invalid x-admin-secret header" });
  }
  next();
}

/**
 * Verify admin authentication using wallet signature
 * Expects headers:
 * - x-admin-address: The admin's wallet address
 * - x-admin-signature: Signature of a message
 * - x-admin-message: The message that was signed (timestamp-based)
 */
async function verifyAdminAuth(req, res, next) {
  try {
    const address = req.headers['x-admin-address'];
    const signature = req.headers['x-admin-signature'];
    const message = req.headers['x-admin-message'];
    
    // Check if using legacy admin secret (for backward compatibility)
    const adminSecret = process.env.ADMIN_SECRET;
    const providedSecret = req.headers['x-admin-secret'];
    
    if (adminSecret && providedSecret === adminSecret) {
      // Legacy auth - check if address is in ADMIN_WALLETS
      const adminWallets = (process.env.ADMIN_WALLETS || '').split(',').map(w => w.trim().toLowerCase());
      
      if (address && adminWallets.includes(address.toLowerCase())) {
        req.adminAddress = address.toLowerCase();
        return next();
      }
    }
    
    // Wallet signature verification
    if (!address || !signature || !message) {
      return res.status(401).json({
        success: false,
        error: 'Missing authentication headers (x-admin-address, x-admin-signature, x-admin-message)',
      });
    }
    
    // Verify message is recent (within 5 minutes)
    const messageTimestamp = parseInt(message.split(':')[1]);
    const now = Date.now();
    if (Math.abs(now - messageTimestamp) > 5 * 60 * 1000) {
      return res.status(401).json({
        success: false,
        error: 'Authentication message expired',
      });
    }
    
    // Verify signature
    const recoveredAddress = ethers.verifyMessage(message, signature);
    
    if (recoveredAddress.toLowerCase() !== address.toLowerCase()) {
      return res.status(401).json({
        success: false,
        error: 'Invalid signature',
      });
    }
    
    // Check if address is an admin
    const isAdmin = await adminService.isAdmin(address);
    
    if (!isAdmin) {
      // Check if address is in ADMIN_WALLETS env var
      const adminWallets = (process.env.ADMIN_WALLETS || '').split(',').map(w => w.trim().toLowerCase());
      
      if (!adminWallets.includes(address.toLowerCase())) {
        return res.status(403).json({
          success: false,
          error: 'Address is not authorized as admin',
        });
      }
      
      // Auto-create admin if in ADMIN_WALLETS
      await adminService.getOrCreateAdmin(address, 'SUPPORT');
    }
    
    // Attach admin address to request
    req.adminAddress = address.toLowerCase();
    
    next();
  } catch (error) {
    console.error('Admin auth error:', error);
    res.status(500).json({
      success: false,
      error: 'Authentication failed',
    });
  }
}

/**
 * Require specific permission
 */
function requirePermission(permission) {
  return async (req, res, next) => {
    try {
      if (!req.adminAddress) {
        return res.status(401).json({
          success: false,
          error: 'Not authenticated',
        });
      }
      
      const hasPermission = await adminService.hasPermission(req.adminAddress, permission);
      
      if (!hasPermission) {
        return res.status(403).json({
          success: false,
          error: `Insufficient permissions: ${permission} required`,
        });
      }
      
      next();
    } catch (error) {
      console.error('Permission check error:', error);
      res.status(500).json({
        success: false,
        error: 'Permission check failed',
      });
    }
  };
}

/**
 * Rate limiting for admin endpoints
 */
const adminRateLimits = new Map();

function adminRateLimit(maxRequests = 100, windowMs = 60000) {
  return (req, res, next) => {
    const key = req.adminAddress || req.ip;
    const now = Date.now();
    
    if (!adminRateLimits.has(key)) {
      adminRateLimits.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    
    const limit = adminRateLimits.get(key);
    
    if (now > limit.resetTime) {
      // Reset window
      limit.count = 1;
      limit.resetTime = now + windowMs;
      return next();
    }
    
    if (limit.count >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests',
        retryAfter: Math.ceil((limit.resetTime - now) / 1000),
      });
    }
    
    limit.count++;
    next();
  };
}

// Clean up old rate limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, limit] of adminRateLimits.entries()) {
    if (now > limit.resetTime + 60000) {
      adminRateLimits.delete(key);
    }
  }
}, 5 * 60 * 1000);

module.exports = adminAuth;
module.exports.verifyAdminAuth = verifyAdminAuth;
module.exports.requirePermission = requirePermission;
module.exports.adminRateLimit = adminRateLimit;
