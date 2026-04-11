// Load .env from project root in local dev; Railway/production injects vars directly
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");

const ipfsRoutes = require("./routes/ipfs");
const relayerRoutes = require("./routes/relayer");
const certificateRoutes = require("./routes/certificates");
const verifyRoutes = require("./routes/verify");
const metadataRoutes = require("./routes/metadata");
const { initRelayer, setMilestoneURIs } = require("./services/relayerService");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_ORIGIN || "http://localhost:3000",
  methods: ["GET", "POST"],
}));
app.use(express.json({ limit: "100kb" }));
app.use(morgan("[:date[clf]] :method :url :status :res[content-length]B :response-time ms"));

const isProd = process.env.NODE_ENV === "production";

// Rate limiters only active in production — dev polling + blockchain calls exceed any sane limit.
const globalLimiter = isProd ? rateLimit({
  windowMs: 60_000, max: 300,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests — please slow down" },
}) : null;

const rpcReadLimiter = isProd ? rateLimit({
  windowMs: 60_000, max: 60,
  standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests on this endpoint — retry in a minute" },
}) : null;

if (globalLimiter) app.use("/api/", globalLimiter);

// Apply stricter rate limit BEFORE route mounts — Express matches middleware in order,
// so these must come first or they never fire once a route handler sends the response.
if (rpcReadLimiter) {
  app.use("/api/relay/attendees", rpcReadLimiter);
  app.use("/api/relay/certificates", rpcReadLimiter);
  app.use("/api/certificates/mine", rpcReadLimiter);
  app.use("/api/verify", rpcReadLimiter);
}

// Routes
app.use("/api/ipfs", ipfsRoutes);
app.use("/api/relay", relayerRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/verify", verifyRoutes);
app.use("/api/metadata", metadataRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Connect to MongoDB & start server
async function start() {
  try {
    if (process.env.MONGODB_URI) {
      await mongoose.connect(process.env.MONGODB_URI);
      console.log("Connected to MongoDB");
    } else {
      console.log("⚠️  No MONGODB_URI set — running without database");
    }

    initRelayer();

    // Auto-setup milestone URIs on startup (non-blocking — runs in background)
    (async () => {
      try {
        const baseURL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
        // Small delay so the provider/contract are fully ready
        await new Promise((r) => setTimeout(r, 3000));
        await setMilestoneURIs(baseURL);
        console.log("[startup] Milestone URIs set on-chain");
      } catch (e) {
        // Non-fatal — URIs may already be set or contract not yet ready
        console.warn("[startup] setMilestoneURIs skipped:", e.message);
      }
    })();

    app.listen(PORT, () => {
      console.log(`🚀 VRYFD Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

// Prevent unhandled promise rejections from crashing the server (e.g. RPC rate limits)
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection (non-fatal):", reason?.message ?? reason);
  console.error("Stack:", reason?.stack ?? "(no stack)");
  console.error("Promise:", promise);
});

start();
