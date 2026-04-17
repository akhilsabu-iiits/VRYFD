const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PINATA_BASE = "https://api.pinata.cloud";
const JWT = (process.env.PINATA_JWT || "").trim();
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";

// Local fallback — used when PINATA_JWT is not configured. Files are written
// to backend/uploads and served statically at BACKEND_URL/uploads/<name>.
// For NFT metadata this works for local demos; for production you still want
// real IPFS because MetaMask / OpenSea can't reach localhost.
const LOCAL_UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
const HAS_PINATA = Boolean(JWT);

if (!HAS_PINATA) {
  try { fs.mkdirSync(LOCAL_UPLOADS_DIR, { recursive: true }); } catch {}
  console.warn("[ipfs] PINATA_JWT not set — falling back to local file storage at", LOCAL_UPLOADS_DIR);
} else {
  console.log("[ipfs] Using Pinata IPFS (PINATA_JWT configured)");
}

/**
 * Each pinned object gets a short content-hashed identifier so the URL is stable.
 */
function contentHash(data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
  return crypto.createHash("sha256").update(buf).digest("hex").slice(0, 32);
}

function localFileUrl(filename) {
  return `${BACKEND_URL}/uploads/${filename}`;
}

/**
 * Pin a JSON metadata object. When Pinata is configured, returns an IPFS CID
 * (so the returned URI is ipfs://<cid>). Otherwise writes the JSON to the
 * local uploads dir and returns a pseudo-CID; the caller can tell the two
 * apart by the returned scheme (see `uriFromCid`).
 */
async function pinJSON(metadata, name = "vryfd-metadata") {
  if (!HAS_PINATA) {
    const body = Buffer.from(JSON.stringify(metadata, null, 2));
    const hash = contentHash(body);
    const filename = `${name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40)}-${hash}.json`;
    fs.writeFileSync(path.join(LOCAL_UPLOADS_DIR, filename), body);
    return { cid: hash, uri: localFileUrl(filename), local: true };
  }
  try {
    const res = await axios.post(
      `${PINATA_BASE}/pinning/pinJSONToIPFS`,
      { pinataContent: metadata, pinataMetadata: { name } },
      { headers: { "Content-Type": "application/json", Authorization: `Bearer ${JWT}` } }
    );
    return { cid: res.data.IpfsHash, uri: `ipfs://${res.data.IpfsHash}`, local: false };
  } catch (err) {
    const detail = err?.response?.data?.error?.details ?? err?.response?.data ?? err.message;
    throw new Error(`IPFS pinJSON failed: ${JSON.stringify(detail)}`);
  }
}

/**
 * Pin a file (image buffer). Same shape as pinJSON — returns {cid, uri, local}.
 */
async function pinFile(fileBuffer, fileName, mimeType = "image/png") {
  if (!HAS_PINATA) {
    const hash = contentHash(fileBuffer);
    const ext = (fileName.match(/\.[a-zA-Z0-9]+$/) || [".bin"])[0].toLowerCase();
    const safeBase = (fileName.replace(/\.[a-zA-Z0-9]+$/, "") || "file")
      .replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 40);
    const filename = `${safeBase}-${hash}${ext}`;
    fs.writeFileSync(path.join(LOCAL_UPLOADS_DIR, filename), fileBuffer);
    return { cid: hash, uri: localFileUrl(filename), local: true };
  }
  try {
    const formData = new FormData();
    formData.append("file", fileBuffer, { filename: fileName, contentType: mimeType });
    formData.append("pinataMetadata", JSON.stringify({ name: fileName }));
    const res = await axios.post(
      `${PINATA_BASE}/pinning/pinFileToIPFS`,
      formData,
      {
        maxBodyLength: Infinity,
        headers: { ...formData.getHeaders(), Authorization: `Bearer ${JWT}` },
      }
    );
    return { cid: res.data.IpfsHash, uri: `ipfs://${res.data.IpfsHash}`, local: false };
  } catch (err) {
    const detail = err?.response?.data?.error?.details ?? err?.response?.data ?? err.message;
    throw new Error(`IPFS pinFile failed: ${JSON.stringify(detail)}`);
  }
}

/**
 * Build a standard POAP badge metadata object (ERC-1155 compatible).
 * Accepts either `imageUrl` (full URL, e.g. http://… or ipfs://…) or the legacy
 * `imageCID` (assumed to be an IPFS CID and prefixed accordingly).
 */
function buildBadgeMetadata({ eventName, eventId, description, imageCID, imageUrl, eventDate, organizer }) {
  const image = imageUrl || (imageCID ? `ipfs://${imageCID}` : "");
  return {
    name: `VRYFD: ${eventName}`,
    description: description || `Proof of Attendance for ${eventName}`,
    image,
    external_url: `${BACKEND_URL}/api/verify/event/${eventId}`,
    attributes: [
      { trait_type: "Event", value: eventName },
      { trait_type: "Event ID", value: String(eventId) },
      { trait_type: "Date", value: eventDate },
      { trait_type: "Organizer", value: organizer },
      { trait_type: "Type", value: "POAP Badge" },
      { trait_type: "Soulbound", value: "true" },
    ],
  };
}

/**
 * Build a milestone reward NFT metadata object
 */
function buildMilestoneMetadata({ tierName, threshold, imageCID, attendeeENS }) {
  return {
    name: `VRYFD: ${tierName}`,
    description: `Achievement NFT awarded for attending ${threshold} events on VRYFD`,
    image: `ipfs://${imageCID}`,
    external_url: `${BACKEND_URL}/api/metadata/milestone/${encodeURIComponent(tierName)}`,
    attributes: [
      { trait_type: "Tier", value: tierName },
      { trait_type: "Threshold", value: String(threshold) },
      { trait_type: "Type", value: "Milestone Reward" },
      { trait_type: "Soulbound", value: "true" },
      ...(attendeeENS ? [{ trait_type: "Holder ENS", value: attendeeENS }] : []),
    ],
  };
}

/**
 * Build a certificate metadata object
 */
function buildCertificateMetadata({
  eventName,
  eventId,
  attendeeAddress,
  attendeeENS,
  timestamp,
  imageCID,
  certificateId,
}) {
  return {
    name: `VRYFD Certificate: ${eventName}`,
    description: `Time-stamped certificate of attendance for ${eventName}, verified on-chain by VRYFD`,
    image: `ipfs://${imageCID}`,
    external_url: `${BACKEND_URL}/api/verify/${certificateId}`,
    attributes: [
      { trait_type: "Event", value: eventName },
      { trait_type: "Event ID", value: String(eventId) },
      { trait_type: "Attendee", value: attendeeENS || attendeeAddress },
      { trait_type: "Timestamp", value: new Date(timestamp * 1000).toISOString() },
      { trait_type: "Certificate ID", value: String(certificateId) },
      { trait_type: "Verified", value: "true" },
    ],
  };
}

module.exports = {
  pinJSON,
  pinFile,
  buildBadgeMetadata,
  buildMilestoneMetadata,
  buildCertificateMetadata,
};
