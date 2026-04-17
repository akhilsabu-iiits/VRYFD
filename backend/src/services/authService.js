const crypto = require("crypto");
const nodemailer = require("nodemailer");

const JWT_SECRET = process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex");
const FRONTEND_URL = process.env.FRONTEND_ORIGIN || "http://localhost:3000";

// In-memory stores (swap for MongoDB in production)
const users = new Map();
const invites = new Map();

// ── Helpers ──────────────────────────────────────────────────

function hashPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, 100000, 64, "sha512").toString("hex");
}

// ── User CRUD ────────────────────────────────────────────────

function createUser(email, password, role = "attendee", name = "") {
  const normalizedEmail = email.toLowerCase().trim();
  if (users.has(normalizedEmail)) {
    throw new Error("User already exists");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = hashPassword(password, salt);
  const user = {
    id: crypto.randomUUID(),
    email: normalizedEmail,
    name: name || normalizedEmail.split("@")[0],
    salt,
    hash,
    walletAddress: null,
    ensName: null,
    role,
    createdAt: new Date().toISOString(),
  };
  users.set(normalizedEmail, user);
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

function authenticateUser(email, password) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = users.get(normalizedEmail);
  if (!user) throw new Error("Invalid credentials");
  const hash = hashPassword(password, user.salt);
  if (hash !== user.hash) throw new Error("Invalid credentials");
  return { id: user.id, email: user.email, name: user.name, role: user.role, walletAddress: user.walletAddress, ensName: user.ensName };
}

function linkWallet(email, walletAddress, ensName) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = users.get(normalizedEmail);
  if (!user) throw new Error("User not found");
  user.walletAddress = walletAddress;
  user.ensName = ensName || null;
  return { id: user.id, email: user.email, walletAddress: user.walletAddress, ensName: user.ensName };
}

function getUserByEmail(email) {
  const normalizedEmail = email.toLowerCase().trim();
  const user = users.get(normalizedEmail);
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name, role: user.role, walletAddress: user.walletAddress, ensName: user.ensName };
}

/**
 * Look up a registered user by their bound wallet address.
 * Used by the certificate renderer to print a human-readable name.
 */
function getUserByWallet(address) {
  if (!address) return null;
  const target = address.toLowerCase();
  for (const u of users.values()) {
    if ((u.walletAddress || "").toLowerCase() === target) {
      return { id: u.id, email: u.email, name: u.name, role: u.role, walletAddress: u.walletAddress, ensName: u.ensName };
    }
  }
  return null;
}

// ── Admin Seeding ────────────────────────────────────────────

function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) {
    console.warn("[auth] ADMIN_EMAIL / ADMIN_PASSWORD not set — no admin account seeded");
    return null;
  }
  const normalizedEmail = email.toLowerCase().trim();
  if (users.has(normalizedEmail)) {
    console.log(`[auth] Admin account already exists: ${normalizedEmail}`);
    return getUserByEmail(normalizedEmail);
  }
  const admin = createUser(normalizedEmail, password, "admin", "Admin");
  console.log(`[auth] Admin account seeded: ${admin.email}`);
  return admin;
}

// ── Invite System ────────────────────────────────────────────

function createInvite(email, role = "organizer") {
  const token = crypto.randomBytes(32).toString("hex");
  const invite = {
    token,
    email: email.toLowerCase().trim(),
    role,
    createdAt: new Date().toISOString(),
    used: false,
  };
  invites.set(token, invite);
  return invite;
}

function consumeInvite(token) {
  const invite = invites.get(token);
  if (!invite) throw new Error("Invalid invite token");
  if (invite.used) throw new Error("Invite token already used");
  invite.used = true;
  invite.usedAt = new Date().toISOString();
  return { email: invite.email, role: invite.role };
}

function getInviteByToken(token) {
  return invites.get(token) || null;
}

function listInvites() {
  return Array.from(invites.values()).map((inv) => ({
    email: inv.email,
    role: inv.role,
    createdAt: inv.createdAt,
    used: inv.used,
    usedAt: inv.usedAt || null,
  }));
}

async function sendInviteEmail(email, token) {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  const inviteLink = `${FRONTEND_URL}/login?invite=${token}`;

  if (!host || !user || !pass) {
    console.log(`[auth] SMTP not configured — invite link for ${email}:`);
    console.log(`       ${inviteLink}`);
    return { sent: false, link: inviteLink };
  }

  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  await transporter.sendMail({
    from: `"VRYFD Platform" <${user}>`,
    to: email,
    subject: "You've been invited as an Organizer on VRYFD",
    html: `
      <div style="font-family: 'Inter', sans-serif; max-width: 560px; margin: 0 auto; padding: 40px 24px;">
        <h1 style="font-family: 'Manrope', sans-serif; color: #2a14b4; font-size: 28px;">VRYFD</h1>
        <p style="color: #191c1e; font-size: 16px; margin-top: 24px;">
          You've been invited to join <strong>VRYFD</strong> as an <strong>Event Organizer</strong>.
        </p>
        <p style="color: #464554; font-size: 14px;">
          As an organizer, you can create and manage on-chain events, track attendance, and issue soulbound certificates.
        </p>
        <a href="${inviteLink}" style="display: inline-block; margin-top: 24px; padding: 14px 32px; background: linear-gradient(135deg, #2a14b4, #4338ca); color: #fff; text-decoration: none; border-radius: 12px; font-weight: 700; font-size: 14px;">
          Accept Invitation
        </a>
        <p style="color: #777586; font-size: 12px; margin-top: 32px;">
          Or copy this link: <br/>
          <a href="${inviteLink}" style="color: #2a14b4;">${inviteLink}</a>
        </p>
      </div>
    `,
  });

  console.log(`[auth] Invite email sent to ${email}`);
  return { sent: true, link: inviteLink };
}

// ── JWT ──────────────────────────────────────────────────────

function signJWT(payload) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 7 * 24 * 3600 })
  ).toString("base64url");
  const signature = crypto
    .createHmac("sha256", JWT_SECRET)
    .update(`${header}.${body}`)
    .digest("base64url");
  return `${header}.${body}.${signature}`;
}

function verifyJWT(token) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) throw new Error("Invalid token");
    const [header, body, signature] = parts;
    const expectedSig = crypto
      .createHmac("sha256", JWT_SECRET)
      .update(`${header}.${body}`)
      .digest("base64url");
    if (signature !== expectedSig) throw new Error("Invalid signature");
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
    return payload;
  } catch (e) {
    throw new Error("Invalid or expired token");
  }
}

// ── Middleware ────────────────────────────────────────────────

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    const payload = verifyJWT(authHeader.slice(7));
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: e.message });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

module.exports = {
  createUser,
  authenticateUser,
  linkWallet,
  getUserByEmail,
  getUserByWallet,
  seedAdmin,
  createInvite,
  consumeInvite,
  getInviteByToken,
  listInvites,
  sendInviteEmail,
  signJWT,
  verifyJWT,
  authMiddleware,
  requireRole,
};
