const QRCode = require("qrcode");
let sharp;
try { sharp = require("sharp"); } catch (e) { console.warn("[certificateService] sharp not available:", e.message); }
const { pinFile, pinJSON, buildCertificateMetadata } = require("./ipfsService");
const webhookService = require("./webhookService");

// Configurable IPFS gateway — set IPFS_GATEWAY in .env to use a different provider
const IPFS_GATEWAY = (process.env.IPFS_GATEWAY || "https://gateway.pinata.cloud/ipfs").replace(/\/$/, "");

// Maximum characters for displayed text fields on the certificate image.
// Long ENS names or event titles are truncated with an ellipsis to prevent layout overflow.
const MAX_NAME_LEN = 32;
const MAX_EVENT_LEN = 42;
const MAX_ORG_LEN = 36;

function truncate(str, maxLen) {
  if (!str) return "";
  return str.length > maxLen ? str.slice(0, maxLen - 1) + "…" : str;
}

/**
 * Generate a QR code image buffer linking to the public verification page.
 * QR resolves to the user-facing /verify?id= URL so anyone scanning it
 * with their phone camera lands directly on the verify result.
 */
async function generateQRCode(certificateId) {
  const frontendBase =
    process.env.NEXT_PUBLIC_FRONTEND_URL ||
    process.env.FRONTEND_ORIGIN ||
    "http://localhost:3000";
  const verifyURL = `${frontendBase}/verify?id=${certificateId}`;
  const qrBuffer = await QRCode.toBuffer(verifyURL, {
    errorCorrectionLevel: "H",
    type: "png",
    width: 300,
    margin: 2,
    color: {
      dark: "#1a1a2e",
      light: "#ffffff",
    },
  });
  return qrBuffer;
}

/**
 * Generate a certificate image with event details and QR code.
 *
 * Layout (1200 × 800):
 *   ┌────────────────────────────────────────────────────────────────────┐
 *   │       CERTIFICATE OF ATTENDANCE                                    │
 *   │             VRYFD                                                  │
 *   │ ───────────────────────────────────────                            │
 *   │                                                                    │
 *   │   This certifies that                                              │
 *   │   ATTENDEE NAME (large)                                            │
 *   │                                                                    │
 *   │   attended                                                         │
 *   │   EVENT NAME (large)                                               │
 *   │                                                  ┌─────────┐       │
 *   │   organized by                                   │         │       │
 *   │   ORGANIZER NAME                                 │   QR    │       │
 *   │                                                  │         │       │
 *   │   on April 17, 2026                              └─────────┘       │
 *   │                                                  Scan to verify    │
 *   │                                                                    │
 *   │   Certificate #N  ·  Verified on Sepolia Testnet  ·  Visit VRYFD   │
 *   └────────────────────────────────────────────────────────────────────┘
 */
async function generateCertificateImage({
  eventName,
  attendeeName,
  organizerName,
  date,
  certificateId,
}) {
  const qrBuffer = await generateQRCode(certificateId);

  const width = 1200;
  const height = 800;
  const qrSize = 200;
  const qrRight = 140;        // right margin for QR
  const qrTop = 380;          // vertical position of QR
  const leftAlign = 120;      // left padding for body copy
  const bodyRight = width - qrRight - qrSize - 60; // right edge of body text

  const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: bold 52px 'Helvetica', sans-serif; fill: #1a1a2e; letter-spacing: 2px; }
        .subtitle { font: bold 22px 'Helvetica', sans-serif; fill: #6366f1; letter-spacing: 6px; }
        .name { font: bold 40px 'Helvetica', sans-serif; fill: #1a1a2e; }
        .event-name { font: bold 34px 'Helvetica', sans-serif; fill: #4338ca; }
        .org-name { font: italic bold 22px 'Helvetica', sans-serif; fill: #1a1a2e; }
        .detail { font: 20px 'Helvetica', sans-serif; fill: #64748b; }
        .qr-caption { font: 13px 'Helvetica', sans-serif; fill: #6366f1; }
        .footer { font: 14px 'Helvetica', sans-serif; fill: #94a3b8; }
        .border { fill: none; stroke: #6366f1; stroke-width: 3; }
        .accent { fill: none; stroke: #e0e7ff; stroke-width: 1; }
      </style>

      <!-- Border -->
      <rect class="border" x="20" y="20" width="${width - 40}" height="${height - 40}" rx="16"/>
      <rect class="accent" x="32" y="32" width="${width - 64}" height="${height - 64}" rx="12"/>

      <!-- Header -->
      <text class="subtitle" x="${width / 2}" y="90" text-anchor="middle">CERTIFICATE OF ATTENDANCE</text>
      <text class="title" x="${width / 2}" y="150" text-anchor="middle">VRYFD</text>
      <line x1="220" y1="180" x2="${width - 220}" y2="180" stroke="#e0e7ff" stroke-width="2"/>

      <!-- Body (left-aligned, so the QR on the right has breathing room) -->
      <text class="detail" x="${leftAlign}" y="250">This certifies that</text>
      <text class="name" x="${leftAlign}" y="300">${escapeXml(truncate(attendeeName, MAX_NAME_LEN))}</text>

      <text class="detail" x="${leftAlign}" y="360">attended</text>
      <text class="event-name" x="${leftAlign}" y="405">${escapeXml(truncate(eventName, MAX_EVENT_LEN))}</text>

      ${organizerName ? `
      <text class="detail" x="${leftAlign}" y="465">organized by</text>
      <text class="org-name" x="${leftAlign}" y="500">${escapeXml(truncate(organizerName, MAX_ORG_LEN))}</text>
      ` : ""}

      <text class="detail" x="${leftAlign}" y="${organizerName ? 560 : 465}">on ${escapeXml(date)}</text>

      <!-- QR caption (under the composited QR image) -->
      <text class="qr-caption" x="${width - qrRight - qrSize / 2}" y="${qrTop + qrSize + 30}" text-anchor="middle">
        Scan to verify
      </text>

      <!-- Footer -->
      <text class="footer" x="${width / 2}" y="720" text-anchor="middle">
        Certificate #${certificateId}  ·  Verified on Sepolia Testnet  ·  Visit VRYFD site
      </text>
    </svg>
  `;

  if (!sharp) throw new Error("sharp image library is not available on this server");

  const certificate = await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite([
      { input: Buffer.from(svgOverlay), top: 0, left: 0 },
      {
        input: await sharp(qrBuffer).resize(qrSize, qrSize).toBuffer(),
        top: qrTop,
        left: width - qrRight - qrSize,
      },
    ])
    .png()
    .toBuffer();

  return certificate;
}

/**
 * Full certificate pipeline:
 * 1. Generate image with QR code
 * 2. Pin image to IPFS
 * 3. Build metadata JSON
 * 4. Pin metadata to IPFS
 * Returns { imageCID, metadataCID, metadataURI }
 */
async function createFullCertificate({
  eventName,
  eventId,
  attendeeAddress,
  attendeeENS,
  attendeeName: attendeeNameOverride,
  organizerName,
  timestamp,
  certificateId,
}) {
  const date = new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  // Prefer explicit name → ENS → shortened address (never the full 0x... string)
  const attendeeName =
    attendeeNameOverride ||
    attendeeENS ||
    (attendeeAddress
      ? `${attendeeAddress.slice(0, 6)}…${attendeeAddress.slice(-4)}`
      : "Attendee");

  const imageBuffer = await generateCertificateImage({
    eventName,
    attendeeName,
    organizerName,
    date,
    certificateId,
  });

  // 2. Pin image (IPFS if Pinata configured, else local fallback)
  const pinnedImage = await pinFile(
    imageBuffer,
    `vryfd-cert-${certificateId}.png`,
    "image/png"
  );
  const imageCID = pinnedImage.cid;

  // 3. Build & pin metadata
  const metadata = buildCertificateMetadata({
    eventName,
    eventId,
    attendeeAddress,
    attendeeENS,
    timestamp,
    imageCID,
    certificateId,
  });

  const pinnedMetadata = await pinJSON(metadata, `vryfd-cert-meta-${certificateId}`);
  const metadataCID = pinnedMetadata.cid;

  const result = {
    imageCID,
    metadataCID,
    metadataURI: pinnedMetadata.uri,
    imageURL: pinnedImage.local ? pinnedImage.uri : `${IPFS_GATEWAY}/${imageCID}`,
  };

  // Trigger webhook for certificate issued
  webhookService.triggerEvent('certificate.issued', {
    eventId,
    eventName,
    attendeeAddress,
    attendeeENS,
    certificateId,
    imageCID,
    metadataCID,
    metadataURI: result.metadataURI,
    imageURL: result.imageURL,
    timestamp: new Date().toISOString(),
  }).catch(err => console.error('[certificate] Webhook trigger failed:', err));

  return result;
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = {
  generateQRCode,
  generateCertificateImage,
  createFullCertificate,
};
