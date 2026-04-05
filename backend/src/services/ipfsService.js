const axios = require("axios");
const FormData = require("form-data");

const PINATA_BASE = "https://api.pinata.cloud";
const JWT = process.env.PINATA_JWT;

/**
 * Pin a JSON metadata object to IPFS via Pinata
 * Returns the IPFS CID (content hash)
 */
async function pinJSON(metadata, name = "vryfd-metadata") {
  const res = await axios.post(
    `${PINATA_BASE}/pinning/pinJSONToIPFS`,
    {
      pinataContent: metadata,
      pinataMetadata: { name },
    },
    {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${JWT}`,
      },
    }
  );
  return res.data.IpfsHash;
}

/**
 * Pin a file (image buffer) to IPFS via Pinata
 * Returns the IPFS CID
 */
async function pinFile(fileBuffer, fileName, mimeType = "image/png") {
  const formData = new FormData();
  formData.append("file", fileBuffer, {
    filename: fileName,
    contentType: mimeType,
  });
  formData.append("pinataMetadata", JSON.stringify({ name: fileName }));

  const res = await axios.post(
    `${PINATA_BASE}/pinning/pinFileToIPFS`,
    formData,
    {
      maxBodyLength: Infinity,
      headers: {
        ...formData.getHeaders(),
        Authorization: `Bearer ${JWT}`,
      },
    }
  );
  return res.data.IpfsHash;
}

/**
 * Build a standard POAP badge metadata object (ERC-1155 compatible)
 */
function buildBadgeMetadata({ eventName, eventId, description, imageCID, eventDate, organizer }) {
  return {
    name: `VRYFD: ${eventName}`,
    description: description || `Proof of Attendance for ${eventName}`,
    image: `ipfs://${imageCID}`,
    external_url: `https://vryfd.xyz/event/${eventId}`,
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
    external_url: `https://vryfd.xyz/milestone/${tierName.toLowerCase().replace(/\s/g, "-")}`,
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
    external_url: `https://vryfd.xyz/verify/${certificateId}`,
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
