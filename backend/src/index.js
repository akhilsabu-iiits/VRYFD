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
const attendanceRoutes = require("./routes/attendance");
const qrRoutes = require("./routes/qr");
const adminRoutes = require("./routes/admin");
const apiRoutes = require("./routes/api");
const publicApiRoutes = require("./routes/publicApi");
const emailClaimRoutes = require("./routes/emailClaim");
const authRoutes = require("./routes/auth");
const badgeRoutes = require("./routes/badge");
const { seedAdmin } = require("./services/authService");
const { initRelayer, setMilestoneURIs } = require("./services/relayerService");
const { initAttendanceService } = require("./services/attendanceService");
const { initEmailService } = require("./services/emailClaimService");
const { logChainStatus, getConfiguredChains } = require("./config/chains");

const app = express();
const PORT = process.env.PORT || 3001;
const isProd = process.env.NODE_ENV === "production";

if (!isProd) {
  console.log(`[startup] NODE_ENV=${process.env.NODE_ENV} PORT=${PORT}`);
  console.log(`[startup] MONGODB_URI set=${!!process.env.MONGODB_URI}`);
}

// Log multi-chain configuration status
logChainStatus();

// Middleware
const allowedOrigins = [
  (process.env.FRONTEND_ORIGIN || "").trim(),
  "http://localhost:3000",
  "https://vryfd.online",
  "https://www.vryfd.online",
  // Add webinar platform origins (Zoom, Google Meet, etc.)
  ...(process.env.WEBINAR_ORIGINS || "").split(",").map(o => o.trim()).filter(Boolean),
].filter(Boolean);
if (!isProd) console.log(`[startup] CORS origins: ${allowedOrigins.join(", ")}`);
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    cb(null, false);
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH"],
  allowedHeaders: ["Content-Type", "Authorization", "X-API-Key"],
}));
app.use(express.json({ limit: "100kb" }));
app.use(morgan("[:date[clf]] :method :url :status :res[content-length]B :response-time ms"));

// Serve locally-pinned badge / metadata files when PINATA_JWT is not set.
// Files live in backend/uploads and are addressed at /uploads/<name>.
app.use("/uploads", express.static(require("path").resolve(__dirname, "../uploads"), {
  maxAge: "1d",
  setHeaders: (res, filePath) => {
    if (filePath.endsWith(".json")) res.setHeader("Content-Type", "application/json");
  },
}));

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
app.use("/api/attendance", attendanceRoutes);
app.use("/api/qr", qrRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/badge", badgeRoutes);

// Auth routes (email/password + wallet linking)
app.use("/api/auth", authRoutes);

// Email claim routes (no wallet needed for non-crypto users)
app.use("/api/email-claim", emailClaimRoutes);

// REST API routes (v1)
app.use("/api/v1", apiRoutes);        // API key & webhook management (admin)
app.use("/api/v1", publicApiRoutes);  // Public API endpoints (requires API key)

// Health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
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

  // Seed admin account from env vars
  try {
    seedAdmin();
  } catch (seedErr) {
    console.error("[startup] seedAdmin failed:", seedErr.message);
  }

  try {
    await initRelayer();
  } catch (relayerErr) {
    console.error("[startup] initRelayer failed (continuing without relayer):", relayerErr.message);
  }

  try {
    initAttendanceService();
  } catch (attendanceErr) {
    console.error("[startup] initAttendanceService failed (continuing without attendance service):", attendanceErr.message);
  }

  try {
    initEmailService();
  } catch (emailErr) {
    console.error("[startup] initEmailService failed (continuing without email claims):", emailErr.message);
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

  const http = require("http");
  const { Server: SocketIOServer } = require("socket.io");
  const httpServer = http.createServer(app);

  const io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigins, methods: ["GET", "POST"] },
  });

  // Make io accessible from route handlers (e.g. endEvent broadcasts)
  app.set("io", io);

  // WebRTC signaling for live sessions
  const rooms = new Map();

  io.on("connection", (socket) => {
    let currentRoom = null;

    socket.on("join-room", ({ roomId, userId, userName }) => {
      currentRoom = roomId;
      socket.join(roomId);

      if (!rooms.has(roomId)) rooms.set(roomId, new Map());
      rooms.get(roomId).set(socket.id, { userId, userName });

      // Notify existing peers so they send offers
      socket.to(roomId).emit("user-joined", { socketId: socket.id, userId, userName });

      // Tell the newcomer about everyone already in the room
      const peers = [];
      for (const [sid, info] of rooms.get(roomId)) {
        if (sid !== socket.id) peers.push({ socketId: sid, ...info });
      }
      socket.emit("existing-peers", peers);

      console.log(`[signaling] ${userName || socket.id} joined room ${roomId} (${rooms.get(roomId).size} users)`);
    });

    socket.on("offer", ({ to, offer }) => {
      io.to(to).emit("offer", { from: socket.id, offer });
    });

    socket.on("answer", ({ to, answer }) => {
      io.to(to).emit("answer", { from: socket.id, answer });
    });

    socket.on("ice-candidate", ({ to, candidate }) => {
      io.to(to).emit("ice-candidate", { from: socket.id, candidate });
    });

    socket.on("end-meeting", ({ roomId }) => {
      socket.to(roomId).emit("meeting-ended", { endedBy: socket.id });
      console.log(`[signaling] Meeting ended in room ${roomId}`);
      if (rooms.has(roomId)) rooms.delete(roomId);
    });

    socket.on("disconnect", () => {
      if (currentRoom && rooms.has(currentRoom)) {
        rooms.get(currentRoom).delete(socket.id);
        if (rooms.get(currentRoom).size === 0) rooms.delete(currentRoom);
        socket.to(currentRoom).emit("user-left", { socketId: socket.id });
        console.log(`[signaling] ${socket.id} left room ${currentRoom}`);
      }
    });
  });

  httpServer.listen(PORT, () => {
    console.log(`🚀 VRYFD Backend running on http://localhost:${PORT}`);
    console.log(`🔌 WebRTC signaling server ready`);
  });
  httpServer.on("error", (err) => {
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
