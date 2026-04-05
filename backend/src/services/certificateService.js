const QRCode = require("qrcode");
const sharp = require("sharp");
const { pinFile, pinJSON, buildCertificateMetadata } = require("./ipfsService");

/**
 * Generate a QR code image buffer linking to the verification portal
 */
async function generateQRCode(certificateId) {
  const verifyURL = `https://vryfd.xyz/verify/${certificateId}`;
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
 * Generate a certificate image with event details and QR code
 * Uses sharp to compose a simple certificate layout
 */
async function generateCertificateImage({
  eventName,
  attendeeName,
  date,
  certificateId,
}) {
  const qrBuffer = await generateQRCode(certificateId);

  // Create a simple certificate using SVG overlay on a white background
  const width = 1200;
  const height = 800;

  const svgOverlay = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <style>
        .title { font: bold 48px sans-serif; fill: #1a1a2e; }
        .subtitle { font: 24px sans-serif; fill: #6366f1; }
        .name { font: bold 36px sans-serif; fill: #1a1a2e; }
        .detail { font: 20px sans-serif; fill: #64748b; }
        .footer { font: 14px sans-serif; fill: #94a3b8; }
        .border { fill: none; stroke: #6366f1; stroke-width: 3; }
        .accent { fill: none; stroke: #e0e7ff; stroke-width: 1; }
      </style>
      
      <!-- Border -->
      <rect class="border" x="20" y="20" width="${width - 40}" height="${height - 40}" rx="16"/>
      <rect class="accent" x="32" y="32" width="${width - 64}" height="${height - 64}" rx="12"/>
      
      <!-- Header -->
      <text class="subtitle" x="${width / 2}" y="100" text-anchor="middle">CERTIFICATE OF ATTENDANCE</text>
      <text class="title" x="${width / 2}" y="160" text-anchor="middle">VRYFD</text>
      
      <!-- Divider -->
      <line x1="200" y1="190" x2="${width - 200}" y2="190" stroke="#e0e7ff" stroke-width="2"/>
      
      <!-- Content -->
      <text class="detail" x="${width / 2}" y="260" text-anchor="middle">This certifies that</text>
      <text class="name" x="${width / 2}" y="310" text-anchor="middle">${escapeXml(attendeeName)}</text>
      <text class="detail" x="${width / 2}" y="370" text-anchor="middle">attended</text>
      <text class="name" x="${width / 2}" y="420" text-anchor="middle">${escapeXml(eventName)}</text>
      <text class="detail" x="${width / 2}" y="480" text-anchor="middle">on ${escapeXml(date)}</text>
      
      <!-- Footer -->
      <text class="footer" x="${width / 2}" y="720" text-anchor="middle">Certificate ID: ${certificateId} — Verified on Polygon blockchain</text>
      <text class="footer" x="${width / 2}" y="745" text-anchor="middle">Scan QR code to verify at vryfd.xyz/verify/${certificateId}</text>
    </svg>
  `;

  // Compose: white background + SVG text + QR code
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
        input: await sharp(qrBuffer).resize(200, 200).toBuffer(),
        top: 530,
        left: width / 2 - 100,
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
  timestamp,
  certificateId,
}) {
  const date = new Date(timestamp * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  const attendeeName = attendeeENS || attendeeAddress;

  // 1. Generate certificate image
  const imageBuffer = await generateCertificateImage({
    eventName,
    attendeeName,
    date,
    certificateId,
  });

  // 2. Pin image to IPFS
  const imageCID = await pinFile(
    imageBuffer,
    `vryfd-cert-${certificateId}.png`,
    "image/png"
  );

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

  const metadataCID = await pinJSON(metadata, `vryfd-cert-meta-${certificateId}`);

  return {
    imageCID,
    metadataCID,
    metadataURI: `ipfs://${metadataCID}`,
    imageURL: `https://gateway.pinata.cloud/ipfs/${imageCID}`,
  };
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
