require("dotenv").config({ path: "../.env" });
const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const ipfsRoutes = require("./routes/ipfs");
const relayerRoutes = require("./routes/relayer");
const certificateRoutes = require("./routes/certificates");
const verifyRoutes = require("./routes/verify");

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json({ limit: "10mb" }));

// Routes
app.use("/api/ipfs", ipfsRoutes);
app.use("/api/relay", relayerRoutes);
app.use("/api/certificates", certificateRoutes);
app.use("/api/verify", verifyRoutes);

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

    app.listen(PORT, () => {
      console.log(`🚀 VRYFD Backend running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();
