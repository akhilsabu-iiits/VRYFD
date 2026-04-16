"use strict";
/**
 * HTTP route tests for the VRYFD backend API.
 * Runs against a minimal Express app that mounts the real routes
 * WITHOUT calling initRelayer — no blockchain connection needed.
 *
 * Covers:
 *  - Validation (400/401/409) paths for every mutating route
 *  - In-memory routes (deployedEvents, events, pending-attendees, join-code)
 *  - Full joinCheckin flow: wrong code, bad sig, duplicate, success
 *  - confirmAllAttendees short-circuit (empty pending queue → no chain call)
 *  - deploy-status idle state
 *
 * Run: node --test test/routes.test.js
 */

const { test, describe } = require("node:test");
const assert = require("node:assert/strict");
const supertest = require("supertest");
const express = require("express");
const { ethers } = require("ethers");

// Must be set before routes are required so adminAuth middleware can read it
process.env.ADMIN_SECRET = "test-secret";

const { setCustomCode, setEventMeta } = require("../src/services/relayerService");
const relayerRoutes = require("../src/routes/relayer");

// ── Minimal app (no MongoDB, no initRelayer) ─────────────────────────────────
const app = express();
app.use(express.json());
app.use("/api/relay", relayerRoutes);
app.get("/api/health", (_, res) => res.json({ status: "ok" }));

const api = supertest(app);

// ── Helper ────────────────────────────────────────────────────────────────────
async function signCheckin(wallet, onChainEventId) {
  return wallet.signMessage(
    `VRYFD check-in\nEvent: ${onChainEventId}\nAttendee: ${wallet.address}`
  );
}

// ── Health ────────────────────────────────────────────────────────────────────

describe("GET /api/health", () => {
  test("200 with status ok", async () => {
    const res = await api.get("/api/health");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "ok");
  });
});

// ── deployedEvents ────────────────────────────────────────────────────────────

describe("GET /api/relay/deployedEvents", () => {
  test("200 returns an object", async () => {
    const res = await api.get("/api/relay/deployedEvents");
    assert.equal(res.status, 200);
    assert.equal(typeof res.body, "object");
    assert.ok(!Array.isArray(res.body), "expected plain object, got array");
  });
});

// ── Events persistence ────────────────────────────────────────────────────────

describe("POST /api/relay/events — validation", () => {
  test("400 when events is missing", async () => {
    const res = await api.post("/api/relay/events")
      .set("x-admin-secret", "test-secret").send({});
    assert.equal(res.status, 400);
  });

  test("400 when events is a string, not an array", async () => {
    const res = await api.post("/api/relay/events")
      .set("x-admin-secret", "test-secret").send({ events: "bad" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /must be an array/);
  });

  test("400 when events is an object, not an array", async () => {
    const res = await api.post("/api/relay/events")
      .set("x-admin-secret", "test-secret").send({ events: { id: 1 } });
    assert.equal(res.status, 400);
  });

  test("401 without admin secret", async () => {
    const res = await api.post("/api/relay/events").send({ events: [] });
    assert.equal(res.status, 401);
  });
});

describe("POST + GET /api/relay/events — roundtrip", () => {
  const SAMPLE = [{ id: 99, name: "Test Event", status: "upcoming" }];

  test("saves events and retrieves them", async () => {
    const postRes = await api.post("/api/relay/events")
      .set("x-admin-secret", "test-secret").send({ events: SAMPLE });
    assert.equal(postRes.status, 200);
    assert.equal(postRes.body.success, true);

    const getRes = await api.get("/api/relay/events");
    assert.equal(getRes.status, 200);
    assert.deepEqual(getRes.body.events, SAMPLE);
  });
});

// ── Deploy status ─────────────────────────────────────────────────────────────

describe("GET /api/relay/deploy-status", () => {
  test("returns idle status when no deploy in progress", async () => {
    const res = await api.get("/api/relay/deploy-status");
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "idle");
  });
});

// ── Pending attendees ─────────────────────────────────────────────────────────

describe("GET /api/relay/pending-attendees/:id", () => {
  test("200 with empty array for event with no pending registrations", async () => {
    const res = await api.get("/api/relay/pending-attendees/99999");
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.deepEqual(res.body.attendees, []);
  });
});

// ── Join code ─────────────────────────────────────────────────────────────────

describe("GET /api/relay/join-code/:id", () => {
  test("500 for event with no code registered", async () => {
    const res = await api.get("/api/relay/join-code/11111");
    assert.equal(res.status, 500);
    assert.match(res.body.error, /No join code registered/);
  });

  test("200 returns code for event that has one", async () => {
    setCustomCode("22222", "ROUTE1");
    const res = await api.get("/api/relay/join-code/22222");
    assert.equal(res.status, 200);
    assert.equal(res.body.code, "ROUTE1");
  });
});

// ── POST /joinCheckin — field validation ──────────────────────────────────────

describe("POST /api/relay/joinCheckin — field validation", () => {
  test("400 when onChainEventId is missing", async () => {
    const res = await api.post("/api/relay/joinCheckin")
      .send({ attendee: "0x1234567890123456789012345678901234567890", code: "ABC123" });
    assert.equal(res.status, 400);
  });

  test("400 when attendee is missing", async () => {
    const res = await api.post("/api/relay/joinCheckin")
      .send({ onChainEventId: 1, code: "ABC123" });
    assert.equal(res.status, 400);
  });

  test("400 when code is missing", async () => {
    const res = await api.post("/api/relay/joinCheckin")
      .send({ onChainEventId: 1, attendee: "0x1234567890123456789012345678901234567890" });
    assert.equal(res.status, 400);
  });

  test("400 when signature is missing", async () => {
    const res = await api.post("/api/relay/joinCheckin")
      .send({ onChainEventId: 1, attendee: "0x1234567890123456789012345678901234567890", code: "ABC123" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /signature/i);
  });

  test("400 when attendee address format is invalid", async () => {
    const res = await api.post("/api/relay/joinCheckin")
      .send({ onChainEventId: 1, attendee: "not-an-address", code: "ABC123", signature: "0x00" });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid wallet address/);
  });

  test("400 when ENS name format is invalid", async () => {
    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: 1,
      attendee: "0x1234567890123456789012345678901234567890",
      code: "ABC123",
      signature: "0x00",
      ens: "BAD_ENS!!",
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ENS/);
  });
});

// ── POST /joinCheckin — logic flow ────────────────────────────────────────────

describe("POST /api/relay/joinCheckin — logic", () => {
  // Unique event IDs per test to avoid state bleed
  const makeEvent = (suffix, code) => {
    const id = `9${suffix}`;
    const now = Math.floor(Date.now() / 1000);
    setCustomCode(id, code);
    setEventMeta(id, now - 3600, now + 3600);
    return id;
  };

  test("400 wrong join code", async () => {
    const id = makeEvent("01", "RIGHTC");
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, id);

    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: Number(id), attendee: wallet.address,
      code: "WRONGC", signature: sig,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Incorrect join code/);
  });

  test("401 valid code but signature from wrong wallet", async () => {
    const id = makeEvent("02", "SIGCHK");
    const wallet = ethers.Wallet.createRandom();
    const imposter = ethers.Wallet.createRandom();
    const sig = await signCheckin(imposter, id); // imposter signs wallet's message

    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: Number(id), attendee: wallet.address,
      code: "SIGCHK", signature: sig,
    });
    assert.equal(res.status, 401);
  });

  test("400 event time: not started yet", async () => {
    const id = "9time1";
    const now = Math.floor(Date.now() / 1000);
    setCustomCode(id, "TSTART");
    setEventMeta(id, now + 3600, now + 7200); // starts in 1h

    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, id);

    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: id, attendee: wallet.address,
      code: "TSTART", signature: sig,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /not started/i);
  });

  test("400 event time: already ended", async () => {
    const id = "9time2";
    const now = Math.floor(Date.now() / 1000);
    setCustomCode(id, "TENDED");
    setEventMeta(id, now - 7200, now - 3600); // ended 1h ago

    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, id);

    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: id, attendee: wallet.address,
      code: "TENDED", signature: sig,
    });
    assert.equal(res.status, 400);
    assert.match(res.body.error, /ended/i);
  });

  test("200 valid code + valid signature → { pending: true }", async () => {
    const id = makeEvent("03", "GOCHEK");
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, id);

    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: Number(id), attendee: wallet.address,
      code: "GOCHEK", signature: sig,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.pending, true);
  });

  test("409 alreadyPending when same wallet registers twice", async () => {
    const id = makeEvent("04", "DUPCHK");
    const wallet = ethers.Wallet.createRandom();

    const sig1 = await signCheckin(wallet, id);
    await api.post("/api/relay/joinCheckin").send({
      onChainEventId: Number(id), attendee: wallet.address,
      code: "DUPCHK", signature: sig1,
    });

    const sig2 = await signCheckin(wallet, id);
    const res = await api.post("/api/relay/joinCheckin").send({
      onChainEventId: Number(id), attendee: wallet.address,
      code: "DUPCHK", signature: sig2,
    });
    assert.equal(res.status, 409);
    assert.equal(res.body.alreadyPending, true);
  });

  test("pending registrations appear in GET /pending-attendees", async () => {
    const id = makeEvent("05", "PENDLS");
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, id);
    await api.post("/api/relay/joinCheckin").send({
      onChainEventId: Number(id), attendee: wallet.address,
      code: "PENDLS", signature: sig,
    });

    const res = await api.get(`/api/relay/pending-attendees/${id}`);
    assert.equal(res.status, 200);
    const found = res.body.attendees.some(
      (a) => a.attendee === wallet.address.toLowerCase()
    );
    assert.ok(found, "registered attendee not in pending list");
  });
});

// ── confirmAllAttendees ───────────────────────────────────────────────────────

describe("POST /api/relay/confirmAllAttendees", () => {
  test("401 without admin secret", async () => {
    const res = await api.post("/api/relay/confirmAllAttendees").send({ onChainEventId: 1 });
    assert.equal(res.status, 401);
  });

  test("400 when onChainEventId is missing", async () => {
    const res = await api.post("/api/relay/confirmAllAttendees")
      .set("x-admin-secret", "test-secret").send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Missing onChainEventId/);
  });

  test("200 + empty results when no pending attendees (no blockchain needed)", async () => {
    // Event 77770 has zero pending attendees → confirmAllAttendees returns [] immediately
    const res = await api.post("/api/relay/confirmAllAttendees")
      .set("x-admin-secret", "test-secret").send({ onChainEventId: 77770 });
    assert.equal(res.status, 200);
    assert.equal(res.body.confirmed, 0);
    assert.equal(res.body.failed, 0);
    assert.deepEqual(res.body.results, []);
  });
});

// ── issueCertificatesBulk ─────────────────────────────────────────────────────

describe("POST /api/relay/issueCertificatesBulk", () => {
  test("401 without admin secret", async () => {
    const res = await api.post("/api/relay/issueCertificatesBulk").send({ onChainEventId: 1 });
    assert.equal(res.status, 401);
  });

  test("400 when onChainEventId is missing", async () => {
    const res = await api.post("/api/relay/issueCertificatesBulk")
      .set("x-admin-secret", "test-secret").send({});
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Missing onChainEventId/);
  });
});

// ── gaslessClaimBadge ─────────────────────────────────────────────────────────

describe("POST /api/relay/gaslessClaimBadge", () => {
  test("400 when attendee is missing", async () => {
    const res = await api.post("/api/relay/gaslessClaimBadge")
      .send({ onChainEventId: 1, signature: "0x00" });
    assert.equal(res.status, 400);
  });

  test("400 when onChainEventId is missing", async () => {
    const res = await api.post("/api/relay/gaslessClaimBadge")
      .send({ attendee: "0x1234567890123456789012345678901234567890", signature: "0x00" });
    assert.equal(res.status, 400);
  });

  test("400 when signature is missing", async () => {
    const res = await api.post("/api/relay/gaslessClaimBadge")
      .send({ attendee: "0x1234567890123456789012345678901234567890", onChainEventId: 1 });
    assert.equal(res.status, 400);
  });
});

// ── gaslessMilestoneReward ────────────────────────────────────────────────────

describe("POST /api/relay/gaslessMilestoneReward", () => {
  test("400 when attendee is missing", async () => {
    const res = await api.post("/api/relay/gaslessMilestoneReward")
      .send({ signature: "0x00" });
    assert.equal(res.status, 400);
  });

  test("400 when signature is missing", async () => {
    const res = await api.post("/api/relay/gaslessMilestoneReward")
      .send({ attendee: "0x1234567890123456789012345678901234567890" });
    assert.equal(res.status, 400);
  });
});

// ── markAttendance validation ─────────────────────────────────────────────────

describe("POST /api/relay/markAttendance", () => {
  test("401 without admin secret", async () => {
    const res = await api.post("/api/relay/markAttendance")
      .send({ eventId: 1, attendee: "0x1234567890123456789012345678901234567890" });
    assert.equal(res.status, 401);
  });

  test("400 when eventId is missing", async () => {
    const res = await api.post("/api/relay/markAttendance")
      .set("x-admin-secret", "test-secret")
      .send({ attendee: "0x1234567890123456789012345678901234567890" });
    assert.equal(res.status, 400);
  });

  test("400 when attendee is missing", async () => {
    const res = await api.post("/api/relay/markAttendance")
      .set("x-admin-secret", "test-secret")
      .send({ eventId: 1 });
    assert.equal(res.status, 400);
  });
});

// ── confirmAttendee validation ────────────────────────────────────────────────

describe("POST /api/relay/confirmAttendee", () => {
  test("401 without admin secret", async () => {
    const res = await api.post("/api/relay/confirmAttendee")
      .send({ onChainEventId: 1, attendee: "0x1234567890123456789012345678901234567890" });
    assert.equal(res.status, 401);
  });

  test("400 when onChainEventId is missing", async () => {
    const res = await api.post("/api/relay/confirmAttendee")
      .set("x-admin-secret", "test-secret")
      .send({ attendee: "0x1234567890123456789012345678901234567890" });
    assert.equal(res.status, 400);
  });

  test("400 when attendee is missing", async () => {
    const res = await api.post("/api/relay/confirmAttendee")
      .set("x-admin-secret", "test-secret")
      .send({ onChainEventId: 1 });
    assert.equal(res.status, 400);
  });
});

// ── checkin-nonce validation ──────────────────────────────────────────────────

describe("GET /api/relay/checkin-nonce/:attendee", () => {
  test("400 when address is not valid hex", async () => {
    const res = await api.get("/api/relay/checkin-nonce/not-an-address");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid wallet address/);
  });

  test("500 Relayer not initialized for valid address (no blockchain in test)", async () => {
    const res = await api.get(
      "/api/relay/checkin-nonce/0x1234567890123456789012345678901234567890"
    );
    assert.equal(res.status, 500);
    // Relayer not initialized — blockchain not required for this assertion
    assert.match(res.body.error, /not initialized/i);
  });
});

// ── ENS resolve validation ────────────────────────────────────────────────────

describe("GET /api/relay/ens-resolve/:ensName", () => {
  test("400 when ENS name has no dot", async () => {
    const res = await api.get("/api/relay/ens-resolve/nodot");
    assert.equal(res.status, 400);
    assert.match(res.body.error, /Invalid ENS/);
  });
});
