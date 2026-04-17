const express = require("express");
const router = express.Router();
const {
  createUser,
  authenticateUser,
  linkWallet,
  getUserByEmail,
  getUserByWallet,
  signJWT,
  authMiddleware,
  requireRole,
  createInvite,
  consumeInvite,
  getInviteByToken,
  listInvites,
  sendInviteEmail,
} = require("../services/authService");

/**
 * Check if a wallet address is listed as an admin in ADMIN_WALLETS env var.
 * ADMIN_WALLETS is a comma-separated list of lowercase addresses.
 */
function isAdminWallet(address) {
  if (!address) return false;
  const list = (process.env.ADMIN_WALLETS || "")
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(String(address).toLowerCase());
}

// ── Register (supports invite tokens) ────────────────────────

router.post("/register", (req, res) => {
  try {
    const { email, password, name, inviteToken } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    let role = "attendee";
    if (inviteToken) {
      try {
        const invite = consumeInvite(inviteToken);
        role = invite.role;
      } catch (e) {
        return res.status(400).json({ error: `Invalid invite: ${e.message}` });
      }
    }

    const user = createUser(email, password, role, name || "");
    const token = signJWT({ id: user.id, email: user.email, name: user.name, role: user.role });
    res.status(201).json({ user, token });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Login ────────────────────────────────────────────────────

router.post("/login", (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: "Email and password are required" });
    }
    const user = authenticateUser(email, password);
    const token = signJWT({ id: user.id, email: user.email, name: user.name, role: user.role });
    res.json({ user, token });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

/**
 * POST /api/auth/wallet-login
 * Login flow for users connecting a MetaMask wallet.
 * Role resolution order:
 *   1. Wallet is in ADMIN_WALLETS env → role=admin
 *   2. Wallet is already bound to a registered user → use that user's role
 *   3. Otherwise → create a lightweight attendee record with the given name
 *
 * Body: { walletAddress, name?, ensName? }
 * Returns: { user, token }
 */
router.post("/wallet-login", (req, res) => {
  try {
    const { walletAddress, name, ensName } = req.body;
    if (!walletAddress || !/^0x[0-9a-fA-F]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: "Valid wallet address required" });
    }
    const lower = walletAddress.toLowerCase();

    // 1. Admin wallet check
    if (isAdminWallet(walletAddress)) {
      // Find or create an admin user record bound to this wallet
      let user = getUserByWallet(walletAddress);
      if (!user) {
        // Auto-provision an admin account with a synthetic email key
        const syntheticEmail = `admin+${lower.slice(2, 10)}@vryfd.local`;
        const displayName = name || ensName || `Admin ${walletAddress.slice(0, 6)}`;
        const random =
          "adm_" + Math.random().toString(36).slice(2) + Date.now().toString(36);
        user = createUser(syntheticEmail, random, "admin", displayName);
        linkWallet(syntheticEmail, walletAddress, ensName || null);
        console.log(`[auth] Auto-provisioned admin account for wallet ${walletAddress}`);
      }
      const token = signJWT({
        id: user.id,
        email: user.email,
        name: user.name,
        role: "admin",
      });
      return res.json({
        user: { ...user, role: "admin", walletAddress, ensName: ensName || null },
        token,
      });
    }

    // 2. Existing user bound to this wallet?
    const existing = getUserByWallet(walletAddress);
    if (existing) {
      const token = signJWT({
        id: existing.id,
        email: existing.email,
        name: existing.name,
        role: existing.role,
      });
      return res.json({
        user: { ...existing, walletAddress, ensName: ensName || existing.ensName || null },
        token,
      });
    }

    // 3. Fall through: no server-side account — return a wallet-only session
    //    (the frontend continues to treat this as an attendee, as before).
    return res.json({
      user: null,
      walletOnly: true,
      walletAddress,
      name: name || null,
      ensName: ensName || null,
    });
  } catch (e) {
    console.error("[auth/wallet-login] error:", e);
    res.status(500).json({ error: e.message });
  }
});

// ── Link Wallet ──────────────────────────────────────────────

router.post("/link-wallet", authMiddleware, (req, res) => {
  try {
    const { walletAddress, ensName } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: "Wallet address is required" });
    }
    const user = linkWallet(req.user.email, walletAddress, ensName);
    res.json({ user });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Current User ─────────────────────────────────────────────

router.get("/me", authMiddleware, (req, res) => {
  const user = getUserByEmail(req.user.email);
  if (!user) return res.status(404).json({ error: "User not found" });
  res.json({ user });
});

// ── Invite Organizer (admin-only) ────────────────────────────

router.post("/invite", authMiddleware, requireRole("admin"), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ error: "Email is required" });
    }

    const existing = getUserByEmail(email);
    if (existing) {
      return res.status(400).json({ error: "User with this email already exists" });
    }

    const invite = createInvite(email, "organizer");

    // Build the link synchronously so we can return it immediately
    const FRONTEND_URL = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
    const inviteLink = `${FRONTEND_URL}/login?invite=${invite.token}`;

    // Fire-and-forget: send email in background so the API responds instantly
    sendInviteEmail(email, invite.token).catch((err) => {
      console.error(`[auth] Failed to send invite email to ${email}:`, err.message);
    });

    res.status(201).json({
      success: true,
      email: invite.email,
      link: inviteLink,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── List Invites (admin-only) ────────────────────────────────

router.get("/invites", authMiddleware, requireRole("admin"), (req, res) => {
  res.json({ invites: listInvites() });
});

// ── Validate Invite Token (public — used by frontend) ────────

router.get("/invite/:token", (req, res) => {
  const invite = getInviteByToken(req.params.token);
  if (!invite) return res.status(404).json({ error: "Invalid invite token" });
  if (invite.used) return res.status(400).json({ error: "Invite already used" });
  res.json({ email: invite.email, role: invite.role });
});

module.exports = router;
