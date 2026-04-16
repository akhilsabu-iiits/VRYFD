const express = require("express");
const router = express.Router();

// XML-safe symbols and names — no raw <, >, & in SVG text
// IDs match the frontend demo event IDs (1-based: 1, 2, 3, 4).
// fetchBadgeDataURI(ev.id) in OrganizerPage calls /api/metadata/badge/:eventId with the demo ID.
const EVENTS = [
  { id: 1, name: "IIIT Sricity Hackathon 2026",  shortName: "IIIT Sricity Hackathon",  date: "Apr 12, 2026", color: "#7c6cf0", accent: "#a89cf7", symbol: "{ }" },
  { id: 2, name: "Web3 Workshop: Smart Contracts", shortName: "Web3 Workshop",           date: "Apr 15, 2026", color: "#34d399", accent: "#6ee7b7", symbol: "//" },
  { id: 3, name: "Blockchain and Beyond Seminar",  shortName: "Blockchain and Beyond",    date: "Apr 20, 2026", color: "#fbbf24", accent: "#fcd34d", symbol: "[]" },
  { id: 4, name: "DeFi Deep Dive Night",           shortName: "DeFi Deep Dive",           date: "Apr 28, 2026", color: "#f87171", accent: "#fca5a5", symbol: "()" },
];

const MILESTONES = [
  { threshold: 5,  tier: "Bronze Explorer", color: "#cd7f32", accent: "#e8a87c", label: "5 Events" },
  { threshold: 10, tier: "Silver Pioneer",  color: "#c0c0c0", accent: "#e8e8e8", label: "10 Events" },
  { threshold: 20, tier: "Gold Legend",     color: "#ffd700", accent: "#ffe066", label: "20 Events" },
];

function x(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeSVG(ev) {
  const { name, date, color, accent, symbol } = ev;
  // Split long names at a space near the middle for two-line display
  const words = name.split(" ");
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(" ");
  const line2 = words.slice(mid).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="350" viewBox="0 0 350 350">
  <rect width="350" height="350" fill="#0d0d1a" rx="16"/>
  <!-- Outer dashed ring -->
  <circle cx="175" cy="175" r="162" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="7 5" opacity="0.3"/>
  <!-- Main solid ring -->
  <circle cx="175" cy="175" r="148" fill="none" stroke="${color}" stroke-width="4" opacity="0.9"/>
  <!-- Inner ring -->
  <circle cx="175" cy="175" r="135" fill="none" stroke="${color}" stroke-width="1" opacity="0.15"/>
  <!-- Top label -->
  <text x="175" y="52" font-family="Courier New,monospace" font-size="10" fill="${color}" text-anchor="middle" letter-spacing="4" opacity="0.85">VRYFD ATTENDANCE</text>
  <!-- Symbol circle -->
  <circle cx="175" cy="118" r="34" fill="${color}" opacity="0.1"/>
  <circle cx="175" cy="118" r="28" fill="none" stroke="${color}" stroke-width="2" opacity="0.5"/>
  <text x="175" y="128" font-family="Courier New,monospace" font-size="22" fill="${color}" text-anchor="middle" font-weight="bold">${x(symbol)}</text>
  <!-- Event name -->
  <text x="175" y="192" font-family="Arial,sans-serif" font-size="18" fill="#ffffff" text-anchor="middle" font-weight="bold">${x(line1)}</text>
  ${line2 ? `<text x="175" y="215" font-family="Arial,sans-serif" font-size="18" fill="#ffffff" text-anchor="middle" font-weight="bold">${x(line2)}</text>` : ""}
  <!-- Date -->
  <text x="175" y="${line2 ? "242" : "228"}" font-family="Courier New,monospace" font-size="11" fill="${accent}" text-anchor="middle" letter-spacing="2" opacity="0.85">${x(date)}</text>
  <!-- Divider -->
  <line x1="108" y1="${line2 ? "256" : "242"}" x2="242" y2="${line2 ? "256" : "242"}" stroke="${color}" stroke-width="1" opacity="0.25"/>
  <!-- Footer -->
  <text x="175" y="${line2 ? "275" : "261"}" font-family="Courier New,monospace" font-size="9" fill="${color}" text-anchor="middle" letter-spacing="3" opacity="0.55">PROOF OF ATTENDANCE</text>
  <!-- Corner dots -->
  <circle cx="42"  cy="42"  r="2.5" fill="${color}" opacity="0.3"/>
  <circle cx="308" cy="42"  r="2.5" fill="${color}" opacity="0.3"/>
  <circle cx="42"  cy="308" r="2.5" fill="${color}" opacity="0.3"/>
  <circle cx="308" cy="308" r="2.5" fill="${color}" opacity="0.3"/>
</svg>`;
}

function milestoneSVG(m) {
  const { tier, color, accent, label } = m;
  const [word1, word2] = tier.split(" ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="350" height="350" viewBox="0 0 350 350">
  <rect width="350" height="350" fill="#0d0d1a" rx="16"/>
  <circle cx="175" cy="175" r="162" fill="none" stroke="${color}" stroke-width="1" stroke-dasharray="7 5" opacity="0.3"/>
  <circle cx="175" cy="175" r="148" fill="none" stroke="${color}" stroke-width="4" opacity="0.9"/>
  <circle cx="175" cy="175" r="135" fill="none" stroke="${color}" stroke-width="1" opacity="0.15"/>
  <text x="175" y="52" font-family="Courier New,monospace" font-size="10" fill="${color}" text-anchor="middle" letter-spacing="4" opacity="0.85">VRYFD MILESTONE</text>
  <!-- Hexagon emblem -->
  <polygon points="175,84 211,104 211,144 175,164 139,144 139,104" fill="${color}" opacity="0.1"/>
  <polygon points="175,90 206,108 206,141 175,159 144,141 144,108" fill="none" stroke="${color}" stroke-width="2" opacity="0.55"/>
  <text x="175" y="138" font-family="Arial,sans-serif" font-size="34" fill="${color}" text-anchor="middle">&#9733;</text>
  <!-- Tier name -->
  <text x="175" y="198" font-family="Arial,sans-serif" font-size="22" fill="${accent}" text-anchor="middle" font-weight="bold">${word1}</text>
  <text x="175" y="224" font-family="Arial,sans-serif" font-size="22" fill="${accent}" text-anchor="middle" font-weight="bold">${word2}</text>
  <!-- Label -->
  <text x="175" y="252" font-family="Courier New,monospace" font-size="11" fill="${color}" text-anchor="middle" letter-spacing="2" opacity="0.8">${label} ATTENDED</text>
  <line x1="108" y1="264" x2="242" y2="264" stroke="${color}" stroke-width="1" opacity="0.25"/>
  <text x="175" y="283" font-family="Courier New,monospace" font-size="9" fill="${color}" text-anchor="middle" letter-spacing="3" opacity="0.55">NFT REWARD · SOULBOUND</text>
  <circle cx="42"  cy="42"  r="2.5" fill="${color}" opacity="0.3"/>
  <circle cx="308" cy="42"  r="2.5" fill="${color}" opacity="0.3"/>
  <circle cx="42"  cy="308" r="2.5" fill="${color}" opacity="0.3"/>
  <circle cx="308" cy="308" r="2.5" fill="${color}" opacity="0.3"/>
</svg>`;
}

function buildMetadata(name, description, svg, attributes) {
  const imageB64 = Buffer.from(svg).toString("base64");
  const image = `data:image/svg+xml;base64,${imageB64}`;
  return { name, description, image, attributes };
}

const { pinFile, pinJSON } = require("../services/ipfsService");

// In-memory store for custom events registered at deploy time (id >= 4)
const customEvents = {};

// Cache so we don't re-pin on every deploy request
const pinnedBadgeURIs     = {};
const pinnedMilestoneURIs = {};

async function pinBadgeMetadata(ev) {
  if (pinnedBadgeURIs[ev.id]) return pinnedBadgeURIs[ev.id];
  const imageCID = await pinFile(Buffer.from(badgeSVG(ev)), `vryfd-badge-${ev.id}.svg`, "image/svg+xml");
  const metadata = {
    name: `${ev.shortName} — POAP Badge`,
    description: `Soulbound Proof of Attendance badge for ${ev.shortName} on ${ev.date}. Issued by VRYFD on Sepolia.`,
    image: `https://gateway.pinata.cloud/ipfs/${imageCID}`,
    attributes: [
      { trait_type: "Event", value: ev.shortName },
      { trait_type: "Date",  value: ev.date },
      { trait_type: "Type",  value: "Attendance Badge" },
      { trait_type: "Chain", value: "Sepolia" },
    ],
  };
  const metaCID = await pinJSON(metadata, `vryfd-badge-meta-${ev.id}`);
  pinnedBadgeURIs[ev.id] = `https://gateway.pinata.cloud/ipfs/${metaCID}`;
  return pinnedBadgeURIs[ev.id];
}

async function pinMilestoneMetadata(m) {
  if (pinnedMilestoneURIs[m.threshold]) return pinnedMilestoneURIs[m.threshold];
  const imageCID = await pinFile(Buffer.from(milestoneSVG(m)), `vryfd-milestone-${m.threshold}.svg`, "image/svg+xml");
  const metadata = {
    name: `VRYFD ${m.tier}`,
    description: `Milestone reward for completing ${m.threshold} events, verified on-chain via VRYFD.`,
    image: `https://gateway.pinata.cloud/ipfs/${imageCID}`,
    attributes: [
      { trait_type: "Tier",      value: m.tier },
      { trait_type: "Threshold", value: m.label },
      { trait_type: "Type",      value: "Milestone Reward" },
      { trait_type: "Chain",     value: "Sepolia" },
    ],
  };
  const metaCID = await pinJSON(metadata, `vryfd-milestone-meta-${m.threshold}`);
  pinnedMilestoneURIs[m.threshold] = `https://gateway.pinata.cloud/ipfs/${metaCID}`;
  return pinnedMilestoneURIs[m.threshold];
}

// POST /api/metadata/badge/register  → register a custom event for badge generation
router.post("/badge/register", (req, res) => {
  const { id, name, date, color, emoji } = req.body;

  if (id === undefined || !name) return res.status(400).json({ error: "Missing id or name" });

  const numId = Number(id);
  if (!Number.isInteger(numId) || numId < 1 || numId > 100_000) {
    return res.status(400).json({ error: "id must be a positive integer ≤ 100000" });
  }
  if (typeof name !== "string" || name.length > 100) {
    return res.status(400).json({ error: "name must be a string ≤ 100 chars" });
  }
  if (date !== undefined && (typeof date !== "string" || date.length > 50)) {
    return res.status(400).json({ error: "date must be a string ≤ 50 chars" });
  }
  if (emoji !== undefined && (typeof emoji !== "string" || emoji.length > 10)) {
    return res.status(400).json({ error: "emoji must be a string ≤ 10 chars" });
  }
  // color must be a CSS hex color — reject anything that could escape an SVG attribute
  const safeColor = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(color) ? color : "#7c6cf0";

  customEvents[numId] = {
    id: numId,
    name,
    shortName: name,
    date: date || "",
    color: safeColor,
    accent: safeColor,
    symbol: emoji || "★",
  };

  // Pre-pin in the background so the /pin endpoint returns from cache when Deploy is clicked.
  // Fire-and-forget — errors are non-fatal, the /pin endpoint will retry on demand.
  pinBadgeMetadata(customEvents[numId]).catch(() => {});

  res.json({ success: true });
});

// GET /api/metadata/badge/:eventId  → JSON metadata
router.get("/badge/:eventId", (req, res) => {
  const ev = EVENTS.find((e) => e.id === Number(req.params.eventId))
          || customEvents[Number(req.params.eventId)];
  if (!ev) return res.status(404).json({ error: "Event not found" });
  res.setHeader("Cache-Control", "public, max-age=86400");
  const meta = buildMetadata(
    `${ev.shortName} — POAP Badge`,
    `Soulbound Proof of Attendance badge for ${ev.shortName} on ${ev.date}. Issued by VRYFD on Sepolia.`,
    badgeSVG(ev),
    [
      { trait_type: "Event", value: ev.shortName },
      { trait_type: "Date",  value: ev.date },
      { trait_type: "Type",  value: "Attendance Badge" },
      { trait_type: "Chain", value: "Sepolia" },
    ]
  );
  res.json(meta);
});

// GET /api/metadata/badge/:eventId/pin  → pins to Pinata, returns public IPFS gateway URL
router.get("/badge/:eventId/pin", async (req, res) => {
  const ev = EVENTS.find((e) => e.id === Number(req.params.eventId))
          || customEvents[Number(req.params.eventId)];
  if (!ev) return res.status(404).json({ error: "Event not found" });
  try {
    const metaURL = await pinBadgeMetadata(ev);
    res.json({ metaURL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/metadata/milestone/:threshold  → JSON metadata
router.get("/milestone/:threshold", (req, res) => {
  const m = MILESTONES.find((x) => x.threshold === Number(req.params.threshold));
  if (!m) return res.status(404).json({ error: "Milestone not found" });
  res.setHeader("Cache-Control", "public, max-age=86400");
  const meta = buildMetadata(
    `VRYFD ${m.tier}`,
    `Milestone reward for completing ${m.threshold} events, verified on-chain via VRYFD.`,
    milestoneSVG(m),
    [
      { trait_type: "Tier",      value: m.tier },
      { trait_type: "Threshold", value: m.label },
      { trait_type: "Type",      value: "Milestone Reward" },
      { trait_type: "Chain",     value: "Sepolia" },
    ]
  );
  res.json(meta);
});

// GET /api/metadata/milestone/:threshold/image  → raw SVG image
router.get("/milestone/:threshold/image", (req, res) => {
  const m = MILESTONES.find((x) => x.threshold === Number(req.params.threshold));
  if (!m) return res.status(404).send("Not found");
  res.setHeader("Content-Type", "image/svg+xml");
  res.send(milestoneSVG(m));
});

// GET /api/metadata/milestone/:threshold/pin
router.get("/milestone/:threshold/pin", async (req, res) => {
  const m = MILESTONES.find((x) => x.threshold === Number(req.params.threshold));
  if (!m) return res.status(404).json({ error: "Milestone not found" });
  try {
    const metaURL = await pinMilestoneMetadata(m);
    res.json({ metaURL });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
