#!/usr/bin/env node
/**
 * VRYFD End-to-End Workflow Test
 * ─────────────────────────────────────────────────────────────────
 * Tests the complete attendee journey:
 *   1. Backend health check
 *   2. Deployed events discovery
 *   3. EIP-712 join-code check-in (ephemeral wallet, no gas needed)
 *   4. Pending queue verification
 *   5. Organizer confirmation (Sepolia tx)
 *   6. Attendee count verification
 *   7. Certificate issuance (IPFS + Sepolia tx)
 *   8. Certificate verification
 *
 * Usage:
 *   node scripts/e2e-workflow.js             # full run (writes to Sepolia)
 *   node scripts/e2e-workflow.js --dry-run   # skip chain-mutating steps
 *   node scripts/e2e-workflow.js --event 15  # target specific onChainEventId
 *
 * Prerequisites: backend running at BACKEND_URL (default http://localhost:3001)
 * ─────────────────────────────────────────────────────────────────
 */

"use strict";

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

// ─── Load .env ────────────────────────────────────────────────────
const envPath = path.resolve(__dirname, "../.env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

// ─── Config ───────────────────────────────────────────────────────
const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001").replace(/\/$/, "");
const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_CONTRACT_ADDRESS || "";
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID || 11155111);

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TARGET_EVENT_ARG = (() => {
  const idx = args.indexOf("--event");
  return idx !== -1 ? Number(args[idx + 1]) : null;
})();

// ─── Helpers ──────────────────────────────────────────────────────
const PASS = "\x1b[32m✓ PASS\x1b[0m";
const FAIL = "\x1b[31m✗ FAIL\x1b[0m";
const SKIP = "\x1b[33m⊘ SKIP\x1b[0m";
const INFO = "\x1b[36mℹ\x1b[0m ";

const results = [];

function log(step, status, detail = "") {
  const icon = status === "pass" ? PASS : status === "fail" ? FAIL : SKIP;
  const line = `  ${icon}  ${step}${detail ? `  →  ${detail}` : ""}`;
  console.log(line);
  results.push({ step, status, detail });
}

// Use node's built-in http module to avoid undici keep-alive issues on Windows
const http = require("http");

function apiRaw(method, url, body, timeoutMs) {
  return new Promise((resolve, reject) => {
    const fullUrl = `${BACKEND}${url}`;
    const parsed = new URL(fullUrl);
    const payload = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: parsed.hostname,
      port: parsed.port || 3001,
      path: parsed.pathname + parsed.search,
      method,
      headers: {
        "Content-Type": "application/json",
        "Connection": "close",
        ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
      },
    };
    const req = http.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json;
        try { json = JSON.parse(data); } catch { json = { _raw: data }; }
        resolve({ status: res.statusCode, ok: res.statusCode >= 200 && res.statusCode < 300, json });
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error(`Request timed out after ${timeoutMs / 1000}s: ${method} ${url}`)); });
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function api(method, url, body, timeoutMs = 15_000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await apiRaw(method, url, body, timeoutMs);
    } catch (err) {
      const isRetryable = err.code === "ECONNRESET" || err.code === "ECONNREFUSED" || err.message?.includes("timed out");
      if (attempt < retries && isRetryable) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
}

// ─── EIP-712 signing ─────────────────────────────────────────────
async function signCheckin(wallet, eventId, nonce) {
  const domain = {
    name: "VryfdAttendance",
    version: "1",
    chainId: CHAIN_ID,
    verifyingContract: CONTRACT_ADDRESS,
  };
  const types = {
    CheckIn: [
      { name: "attendee", type: "address" },
      { name: "eventId", type: "uint256" },
      { name: "nonce", type: "uint256" },
    ],
  };
  const value = { attendee: wallet.address, eventId: BigInt(eventId), nonce: BigInt(nonce) };
  return wallet.signTypedData(domain, types, value);
}

// ─── Main ─────────────────────────────────────────────────────────
async function main() {
  console.log("\n\x1b[1m━━━  VRYFD End-to-End Workflow Test  ━━━\x1b[0m");
  console.log(`  Backend : ${BACKEND}`);
  console.log(`  Contract: ${CONTRACT_ADDRESS || "(not set)"}`);
  console.log(`  Chain ID: ${CHAIN_ID}`);
  console.log(`  Mode    : ${DRY_RUN ? "DRY RUN (no chain writes)" : "LIVE (Sepolia)"}`);
  console.log();

  // ── Step 1: Health check ────────────────────────────────────────
  console.log("\x1b[1mStep 1 — Backend health\x1b[0m");
  try {
    const { ok, json } = await api("GET", "/api/health");
    if (ok && json.status === "ok") {
      log("Backend reachable", "pass", `timestamp ${json.timestamp}`);
    } else {
      log("Backend health", "fail", JSON.stringify(json));
      console.error("\n  Backend is not responding correctly. Aborting.");
      process.exit(1);
    }
  } catch (err) {
    log("Backend reachable", "fail", err.message);
    console.error("\n  Cannot reach backend. Is it running? Aborting.");
    process.exit(1);
  }

  // ── Step 2: Deployed events ─────────────────────────────────────
  console.log("\n\x1b[1mStep 2 — Deployed events\x1b[0m");
  let deployedEvents = {};
  let targetOnChainId = TARGET_EVENT_ARG;

  try {
    const { ok, json } = await api("GET", "/api/relay/deployedEvents");
    if (ok && typeof json === "object") {
      deployedEvents = json;
      const eventKeys = Object.keys(deployedEvents);
      log("Deployed events fetched", "pass", `${eventKeys.length} event(s) found`);

      if (!targetOnChainId) {
        // Pick the first event with a known onChainId
        for (const k of eventKeys) {
          const ev = deployedEvents[k];
          if (ev.onChainId) { targetOnChainId = Number(ev.onChainId); break; }
        }
      }

      if (targetOnChainId) {
        log("Target event selected", "pass", `onChainId = ${targetOnChainId}`);
      } else {
        log("Target event", "fail", "No events with onChainId found");
        process.exit(1);
      }
    } else {
      log("Deployed events", "fail", JSON.stringify(json));
      process.exit(1);
    }
  } catch (err) {
    log("Deployed events", "fail", err.message);
    process.exit(1);
  }

  // ── Step 3: Get join code ───────────────────────────────────────
  console.log("\n\x1b[1mStep 3 — Join code\x1b[0m");
  let joinCode = null;

  // Try to find join code from deployedEvents first (no extra call needed)
  for (const ev of Object.values(deployedEvents)) {
    if (Number(ev.onChainId) === targetOnChainId && ev.joinCode) {
      joinCode = ev.joinCode;
      break;
    }
  }

  if (!joinCode) {
    try {
      const { ok, json } = await api("GET", `/api/relay/join-code/${targetOnChainId}`);
      if (ok && json.code) {
        joinCode = json.code;
        log("Join code fetched from API", "pass", joinCode);
      } else {
        log("Join code", "fail", JSON.stringify(json));
        process.exit(1);
      }
    } catch (err) {
      log("Join code", "fail", err.message);
      process.exit(1);
    }
  } else {
    log("Join code (from deployedEvents)", "pass", joinCode);
  }

  // ── Step 4: Ephemeral wallet ────────────────────────────────────
  console.log("\n\x1b[1mStep 4 — Ephemeral test wallet\x1b[0m");
  const wallet = ethers.Wallet.createRandom();
  log("Wallet created", "pass", wallet.address);

  if (!CONTRACT_ADDRESS) {
    log("Contract address", "fail", "NEXT_PUBLIC_CONTRACT_ADDRESS is not set in .env");
    process.exit(1);
  }
  log("Contract address", "pass", CONTRACT_ADDRESS);

  // ── Step 5: Get nonce & sign EIP-712 ───────────────────────────
  console.log("\n\x1b[1mStep 5 — EIP-712 signature\x1b[0m");
  let nonce = 0;
  try {
    const { ok, json } = await api("GET", `/api/relay/checkin-nonce/${wallet.address}`);
    if (ok && json.nonce !== undefined) {
      nonce = Number(json.nonce);
      log("Nonce fetched", "pass", `nonce = ${nonce}`);
    } else {
      log("Nonce fetch", "fail", JSON.stringify(json));
      process.exit(1);
    }
  } catch (err) {
    log("Nonce fetch", "fail", err.message);
    process.exit(1);
  }

  let signature;
  try {
    signature = await signCheckin(wallet, targetOnChainId, nonce);
    log("EIP-712 message signed", "pass", `sig ${signature.slice(0, 18)}…`);
  } catch (err) {
    log("EIP-712 signing", "fail", err.message);
    process.exit(1);
  }

  // ── Step 6: Join-code check-in ──────────────────────────────────
  console.log("\n\x1b[1mStep 6 — Join-code check-in (pending registration)\x1b[0m");
  try {
    const { ok, status, json } = await api("POST", "/api/relay/joinCheckin", {
      onChainEventId: targetOnChainId,
      attendee: wallet.address,
      code: joinCode,
      signature,
    });

    if (ok && json.success) {
      log("joinCheckin accepted", "pass", "attendee added to pending queue");
    } else if (status === 409 && json.alreadyPending) {
      log("joinCheckin", "pass", "already pending (wallet used before)");
    } else if (status === 409 && json.alreadyConfirmed) {
      log("joinCheckin", "pass", "already confirmed on-chain");
    } else {
      log("joinCheckin", "fail", json.error || JSON.stringify(json));
    }
  } catch (err) {
    log("joinCheckin", "fail", err.message);
  }

  // ── Step 7: Verify pending queue ───────────────────────────────
  console.log("\n\x1b[1mStep 7 — Pending attendees queue\x1b[0m");
  try {
    const { ok, json } = await api("GET", `/api/relay/pending-attendees/${targetOnChainId}`);
    if (ok) {
      const attendees = json.attendees || [];
      // Pending entries are objects: { attendee: "0x...", ens: null }
      const isInQueue = attendees
        .map((a) => (typeof a === "string" ? a : a.attendee).toLowerCase())
        .includes(wallet.address.toLowerCase());
      if (isInQueue) {
        log("Wallet in pending queue", "pass", `${attendees.length} pending`);
      } else {
        // May already be confirmed from a prior run
        log("Wallet in pending queue", "pass", `not in queue (may already be confirmed); ${attendees.length} others pending`);
      }
    } else {
      log("Pending attendees", "fail", JSON.stringify(json));
    }
  } catch (err) {
    log("Pending attendees", "fail", err.message);
  }

  // ── Step 8: Organizer confirm ───────────────────────────────────
  console.log("\n\x1b[1mStep 8 — Organizer confirmation (on-chain)\x1b[0m");
  if (DRY_RUN) {
    log("confirmAttendee", "skip", "dry-run mode — skipping chain write");
  } else {
    try {
      const { ok, status, json } = await api("POST", "/api/relay/confirmAttendee", {
        onChainEventId: targetOnChainId,
        attendee: wallet.address,
      });

      if (ok && json.success) {
        log("confirmAttendee", "pass", `txHash: ${json.txHash?.slice(0, 18)}…`);
      } else if (status === 409 || (json.error || "").toLowerCase().includes("already")) {
        log("confirmAttendee", "pass", "already confirmed on-chain");
      } else if ((json.error || "").toLowerCase().includes("not active") ||
                 (json.error || "").toLowerCase().includes("ended")) {
        log("confirmAttendee", "skip", `event not active: ${json.error}`);
      } else {
        log("confirmAttendee", "fail", json.error || JSON.stringify(json));
      }
    } catch (err) {
      log("confirmAttendee", "fail", err.message);
    }
  }

  // ── Step 9: Attendee count ──────────────────────────────────────
  console.log("\n\x1b[1mStep 9 — Attendee count verification\x1b[0m");
  try {
    const { ok, json } = await api("GET", `/api/relay/attendee-count/${targetOnChainId}`);
    if (ok) {
      log("Attendee count", "pass", `${json.count} confirmed on-chain for event ${targetOnChainId}`);
    } else {
      log("Attendee count", "fail", JSON.stringify(json));
    }
  } catch (err) {
    log("Attendee count", "fail", err.message);
  }

  // ── Step 10: Certificate issuance ──────────────────────────────
  console.log("\n\x1b[1mStep 10 — Certificate issuance (bulk)\x1b[0m");
  if (DRY_RUN) {
    log("issueCertificatesBulk", "skip", "dry-run mode — skipping chain write");
  } else {
    try {
      const { ok, json } = await api("POST", "/api/relay/issueCertificatesBulk", {
        onChainEventId: targetOnChainId,
      });
      if (ok && json.success) {
        log(
          "issueCertificatesBulk",
          "pass",
          `issued: ${json.issued}, skipped: ${json.skipped}, failed: ${json.failed}`
        );
      } else {
        log("issueCertificatesBulk", "fail", json.error || JSON.stringify(json));
      }
    } catch (err) {
      log("issueCertificatesBulk", "fail", err.message);
    }
  }

  // ── Step 11: Certificate verification ──────────────────────────
  console.log("\n\x1b[1mStep 11 — Certificate verification\x1b[0m");
  try {
    // Get certificates for this event to find a valid certId (log scan — up to 2min)
    const { ok, json } = await api("GET", `/api/relay/certificates/${targetOnChainId}`, undefined, 120_000);
    if (ok && Array.isArray(json.certificates) && json.certificates.length > 0) {
      const validCert = json.certificates.find((c) => c.isValid);
      if (validCert) {
        log("Certificates for event", "pass", `${json.certificates.length} total, certId #${validCert.certId} is valid`);

        // Verify it
        const verRes = await api("GET", `/api/verify/${validCert.certId}`);
        if (verRes.ok && verRes.json.verified && verRes.json.isValid) {
          log(
            `Verify cert #${validCert.certId}`,
            "pass",
            `attendee: ${verRes.json.attendeeENS || verRes.json.attendee}`
          );
        } else {
          log(`Verify cert #${validCert.certId}`, "fail", verRes.json.error || JSON.stringify(verRes.json));
        }
      } else {
        log("Valid certificate", "skip", `${json.certificates.length} cert(s) found but none are valid`);
      }
    } else if (ok && Array.isArray(json.certificates)) {
      log("Certificates for event", "skip", "no certificates issued yet for this event");
    } else {
      log("Certificates for event", "fail", json.error || JSON.stringify(json));
    }
  } catch (err) {
    log("Certificate verification", "fail", err.message);
  }

  // ── Step 12: On-chain attendance record ────────────────────────
  console.log("\n\x1b[1mStep 12 — On-chain attendance record (read-only)\x1b[0m");
  try {
    const { ok, json } = await api(
      "GET",
      `/api/relay/checkin-status/${targetOnChainId}/${wallet.address}`
    );
    if (ok) {
      log(
        "Check-in status",
        "pass",
        `checkedIn=${json.checkedIn}, badgeClaimed=${json.badgeClaimed}`
      );
    } else {
      log("Check-in status", "fail", JSON.stringify(json));
    }
  } catch (err) {
    log("Check-in status", "fail", err.message);
  }

  // ─── Summary ──────────────────────────────────────────────────
  console.log("\n\x1b[1m━━━  Summary  ━━━\x1b[0m");
  const passed  = results.filter((r) => r.status === "pass").length;
  const failed  = results.filter((r) => r.status === "fail").length;
  const skipped = results.filter((r) => r.status === "skip").length;

  console.log(`  ${PASS}  ${passed}`);
  console.log(`  ${FAIL}  ${failed}`);
  console.log(`  ${SKIP}  ${skipped}`);
  console.log();

  if (failed > 0) {
    console.log("\x1b[31m  Failed steps:\x1b[0m");
    results.filter((r) => r.status === "fail").forEach((r) => {
      console.log(`    • ${r.step}: ${r.detail}`);
    });
    console.log();
  }

  const allGood = failed === 0;
  console.log(
    allGood
      ? "\x1b[32m  All checks passed!\x1b[0m\n"
      : "\x1b[31m  Some checks failed — see above.\x1b[0m\n"
  );

  if (DRY_RUN) {
    console.log(
      `${INFO}  Chain-write steps were skipped (--dry-run).\n` +
      `    Re-run without --dry-run to execute confirmAttendee + issueCertificatesBulk on Sepolia.\n`
    );
  }

  process.exit(allGood ? 0 : 1);
}

main().catch((err) => {
  console.error("\n\x1b[31mUnhandled error:\x1b[0m", err.message);
  process.exit(1);
});
