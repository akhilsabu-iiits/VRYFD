/**
 * adminAuth middleware
 * Protects organizer/admin routes by requiring a shared secret in the
 * x-admin-secret request header. Set ADMIN_SECRET in the backend .env.
 *
 * NOTE: This is a defence-in-depth measure for a testnet project.
 *       For production use, replace with JWT / OAuth or move these
 *       endpoints behind a Next.js server-side API route so the secret
 *       never leaves the server.
 */
module.exports = function adminAuth(req, res, next) {
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
};
