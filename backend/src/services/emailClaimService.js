const crypto = require("crypto");
const nodemailer = require("nodemailer");

// In-memory claim token store (swap for MongoDB in production)
const claimTokens = new Map();

const FRONTEND_URL = process.env.FRONTEND_ORIGIN || "http://localhost:3000";
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

let transporter = null;

function initEmailService() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || "587", 10);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) {
    console.warn("[email] Missing SMTP config — email claims disabled (set SMTP_HOST, SMTP_USER, SMTP_PASS)");
    return;
  }

  transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
  });

  console.log(`[email] Service initialized with ${host}:${port}`);
}

/**
 * Generate a claim token and send email to the attendee
 * @param {string} email - Recipient email
 * @param {number} eventId - On-chain event ID
 * @param {string} eventName - Human-readable event name
 * @param {string} organizerAddress - Organizer's wallet address
 * @returns {Promise<{token: string, expires: Date}>}
 */
async function sendClaimEmail(email, eventId, eventName, organizerAddress) {
  const token = crypto.randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + TOKEN_EXPIRY_MS);

  claimTokens.set(token, {
    email: email.toLowerCase().trim(),
    eventId,
    eventName,
    organizerAddress,
    createdAt: new Date(),
    expires,
    claimed: false,
    claimedBy: null,
  });

  const claimUrl = `${FRONTEND_URL}/app?claim=${token}`;

  if (!transporter) {
    console.log(`[email] SMTP not configured. Claim URL for ${email}: ${claimUrl}`);
    return { token, expires, claimUrl };
  }

  const fromName = process.env.SMTP_FROM_NAME || "VRYFD";
  const fromEmail = process.env.SMTP_FROM || process.env.SMTP_USER;

  await transporter.sendMail({
    from: `"${fromName}" <${fromEmail}>`,
    to: email,
    subject: `Claim Your Attendance: ${eventName}`,
    html: `
      <div style="font-family: -apple-system, sans-serif; max-width: 520px; margin: 0 auto; padding: 32px; background: #0a0a12; color: #e8e6f0; border-radius: 16px;">
        <h1 style="font-size: 24px; margin-bottom: 8px;">You're invited to claim your attendance!</h1>
        <p style="color: #a09cb5; font-size: 15px; margin-bottom: 24px;">
          The organizer has recorded your attendance for <strong>${eventName}</strong> and sent you
          a link to claim your on-chain proof.
        </p>
        <div style="background: #12121f; border: 1px solid rgba(124,108,240,0.2); border-radius: 12px; padding: 20px; margin-bottom: 24px;">
          <p style="margin: 0 0 4px; font-size: 12px; color: #6b6780; text-transform: uppercase; letter-spacing: 1px;">Event</p>
          <p style="margin: 0; font-size: 18px; font-weight: 600;">${eventName}</p>
        </div>
        <a href="${claimUrl}" style="display: block; text-align: center; padding: 14px 24px; background: #7c6cf0; color: #fff; text-decoration: none; border-radius: 10px; font-weight: 600; font-size: 15px;">
          Claim Attendance
        </a>
        <p style="color: #6b6780; font-size: 12px; margin-top: 20px; text-align: center;">
          This link expires in 7 days. You'll need an Ethereum wallet (e.g. MetaMask) to complete the claim.
        </p>
      </div>
    `,
    text: `You're invited to claim your attendance for ${eventName}.\n\nClaim link: ${claimUrl}\n\nThis link expires in 7 days. You'll need an Ethereum wallet to complete the claim.`,
  });

  console.log(`[email] Claim email sent to ${email} for event ${eventId}`);
  return { token, expires, claimUrl };
}

/**
 * Verify and consume a claim token
 * @param {string} token - Claim token
 * @param {string} walletAddress - Wallet address claiming the attendance
 * @returns {{eventId: number, eventName: string} | null}
 */
function redeemClaimToken(token, walletAddress) {
  const claim = claimTokens.get(token);
  if (!claim) return null;
  if (claim.claimed) return null;
  if (new Date() > claim.expires) {
    claimTokens.delete(token);
    return null;
  }

  claim.claimed = true;
  claim.claimedBy = walletAddress.toLowerCase();
  claim.claimedAt = new Date();

  return {
    eventId: claim.eventId,
    eventName: claim.eventName,
    email: claim.email,
    organizerAddress: claim.organizerAddress,
  };
}

/**
 * Get claim info without consuming
 */
function getClaimInfo(token) {
  const claim = claimTokens.get(token);
  if (!claim) return null;
  if (claim.claimed) return { ...claim, status: "already_claimed" };
  if (new Date() > claim.expires) return { ...claim, status: "expired" };
  return { ...claim, status: "valid" };
}

/**
 * Batch send claim emails for all attendees of an event
 */
async function sendBulkClaimEmails(emails, eventId, eventName, organizerAddress) {
  const results = [];
  for (const email of emails) {
    try {
      const result = await sendClaimEmail(email, eventId, eventName, organizerAddress);
      results.push({ email, status: "sent", ...result });
    } catch (err) {
      results.push({ email, status: "failed", error: err.message });
    }
  }
  return results;
}

module.exports = {
  initEmailService,
  sendClaimEmail,
  sendBulkClaimEmails,
  redeemClaimToken,
  getClaimInfo,
};
