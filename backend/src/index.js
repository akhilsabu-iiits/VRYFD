// Load .env from project root in local dev; Railway/production injects vars directly
require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const compression = require("compression");
const morgan = require("morgan");
const mongoose = require("mongoose");
const rateLimit = require("express-rate-limit");

const ipfsRoutes = require("./routes/ipfs");
const relayerRoutes = require("./routes/relayer");
const certificateRoutes = require("./routes/certificates");
const verifyRoutes = require("./routes/verify");
const metadataRoutes = require("./routes/metadata");
const { initRelayer, setMilestoneURIs, getContract } = require("./services/relayerService");

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === "production";

if (!isProd) {
  console.log(`[startup] NODE_ENV=${process.env.NODE_ENV} PORT=${PORT}`);
  console.log(`[startup] PRIVATE_KEY set=${!!process.env.PRIVATE_KEY} CONTRACT=${process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "MISSING"}`);
  console.log(`[startup] MONGODB_URI set=${!!process.env.MONGODB_URI}`);
}

// Security headers — applied before everything else.
// contentSecurityPolicy disabled: API server returns JSON, no HTML.
// crossOriginEmbedderPolicy disabled: needed for cross-origin asset loading.
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));

// Gzip / Brotli compression — reduces payload size for JSON responses.
app.use(compression());

// Middleware
const allowedOrigins = [
  (process.env.FRONTEND_ORIGIN || "").trim(),
  "http://localhost:3000",
  "https://vryfd.online",
  "https://www.vryfd.online",
].filter(Boolean);
if (!isProd) console.log(`[startup] CORS origins: ${allowedOrigins.join(", ")}`);
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  methods: ["GET", "POST"],
}));
app.use(express.json({ limit: "100kb" }));
app.use(morgan("[:date[clf]] :method :url :status :res[content-length]B :response-time ms"));

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

// Health check — reports relayer + MongoDB state so load balancers can detect degraded service
app.get("/api/health", (req, res) => {
  let relayerStatus = "ok";
  try { getContract(); } catch { relayerStatus = "not_initialized"; }
  const mongoState = mongoose.connection.readyState; // 0=disconnected 1=connected 2=connecting
  const mongoStatus = mongoState === 1 ? "ok" : mongoState === 2 ? "connecting" : "disconnected";
  const healthy = relayerStatus === "ok";
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    services: { relayer: relayerStatus, mongo: mongoStatus },
  });
});

// Connect to MongoDB & start server
async function start() {
  // MongoDB connects in background — don't block server startup
  const mongoUri = (process.env.MONGODB_URI || "").trim();
  if (mongoUri) {
    mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 10000 })
      .then(() => console.log("Connected to MongoDB"))
      .catch((e) => console.error("MongoDB connection failed (non-fatal):", e.message));
  } else {
    console.log("⚠️  No MONGODB_URI set — running without database");
  }

  try {
    initRelayer();
  } catch (relayerErr) {
    console.error("[startup] initRelayer failed (continuing without relayer):", relayerErr.message);
  }

  // Auto-setup milestone URIs on startup (non-blocking)
  (async () => {
    try {
      const baseURL = process.env.BACKEND_URL || `http://localhost:${PORT}`;
      await new Promise((r) => setTimeout(r, 3000));
      await setMilestoneURIs(baseURL);
      if (!isProd) console.log("[startup] Milestone URIs set on-chain");
    } catch (e) {
      if (!isProd) console.warn("[startup] setMilestoneURIs skipped:", e.message);
    }
  })();

  const server = app.listen(PORT, () => {
    console.log(`🚀 VRYFD Backend running on http://localhost:${PORT}`);
  });
  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${PORT} is already in use. Kill the existing process and restart.`);
    } else {
      console.error("Server error:", err.message);
    }
    process.exit(1);
  });
}

// Prevent unhandled promise rejections from crashing the server (e.g. RPC rate limits)
process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled rejection (non-fatal):", reason?.message ?? reason);
  console.error("Stack:", reason?.stack ?? "(no stack)");
  console.error("Promise:", promise);
});

start();
