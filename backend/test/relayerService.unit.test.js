"use strict";
/**
 * Unit tests for relayerService.js — pure in-memory functions only.
 * No blockchain connection required. All state lives in module-level Maps/Sets.
 *
 * Run: node --test test/relayerService.unit.test.js
 */

const { test, describe, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { ethers } = require("ethers");
const path = require("path");
const fs = require("fs");

const {
  setCustomCode,
  getJoinCode,
  setEventMeta,
  joinCodeCheckin,
  addPending,
  getPendingAttendees,
  getConfirmedCount,
  getConfirmedAttendees,
  saveDeployedEvent,
  getDeployedEvents,
  getAllEvents,
  saveAllEvents,
} = require("../src/services/relayerService");

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Generate a valid personal_sign for joinCodeCheckin
async function signCheckin(wallet, onChainEventId) {
  return wallet.signMessage(
    `VRYFD check-in\nEvent: ${onChainEventId}\nAttendee: ${wallet.address}`
  );
}

// Unique event IDs per suite to avoid cross-test state pollution
const EVENTS = {
  joinCode: "8001",
  timeWindow: "8002",
  checkin: "8003",
  demo: "8004",
  pending: "8005",
  deployedStore: "test_unit_8006",
};

// ─── Join Code Store ──────────────────────────────────────────────────────────

describe("Join Code Store", () => {
  test("setCustomCode + getJoinCode roundtrip", () => {
    setCustomCode(EVENTS.joinCode, "HELLO1");
    assert.equal(getJoinCode(EVENTS.joinCode), "HELLO1");
  });

  test("code is stored uppercase and trimmed", () => {
    setCustomCode(EVENTS.joinCode, "  abc123  ");
    assert.equal(getJoinCode(EVENTS.joinCode), "ABC123");
  });

  test("getJoinCode throws for unknown event", () => {
    assert.throws(
      () => getJoinCode("99999"),
      { message: /No join code registered/ }
    );
  });
});

// ─── Event Meta Cache — time window checks ───────────────────────────────────

describe("Event time window (setEventMeta + joinCodeCheckin)", () => {
  const ID = EVENTS.timeWindow;

  before(() => {
    setCustomCode(ID, "WINDOW");
  });

  test("throws 'not started' when event is in the future", async () => {
    const now = Math.floor(Date.now() / 1000);
    setEventMeta(ID, now + 3600, now + 7200); // starts 1h from now
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    // joinCodeCheckin is synchronous — use assert.throws, not assert.rejects
    assert.throws(
      () => joinCodeCheckin(ID, wallet.address, "WINDOW", sig),
      { message: /not started/ }
    );
  });

  test("throws 'ended' when event is in the past", async () => {
    const now = Math.floor(Date.now() / 1000);
    setEventMeta(ID, now - 7200, now - 3600); // ended 1h ago
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    assert.throws(
      () => joinCodeCheckin(ID, wallet.address, "WINDOW", sig),
      { message: /ended/ }
    );
  });
});

// ─── joinCodeCheckin — main flow ─────────────────────────────────────────────

describe("joinCodeCheckin", () => {
  const ID = EVENTS.checkin;

  before(() => {
    const now = Math.floor(Date.now() / 1000);
    setCustomCode(ID, "VALID1");
    setEventMeta(ID, now - 3600, now + 3600); // active window
  });

  test("correct code + valid signature returns { pending: true }", async () => {
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    const result = await joinCodeCheckin(ID, wallet.address, "VALID1", sig);
    assert.deepEqual(result, { pending: true });
  });

  test("wrong code throws 'Incorrect join code'", async () => {
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    assert.throws(
      () => joinCodeCheckin(ID, wallet.address, "BADCOD", sig),
      { message: /Incorrect join code/ }
    );
  });

  test("no code registered and no demoId throws 'No join code registered'", async () => {
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, "77777");
    assert.throws(
      () => joinCodeCheckin("77777", wallet.address, "ANYCD1", sig),
      { message: /No join code registered/ }
    );
  });

  test("signature from wrong wallet is rejected", async () => {
    const wallet = ethers.Wallet.createRandom();
    const imposter = ethers.Wallet.createRandom();
    const sig = await signCheckin(imposter, ID); // signed by imposter, not wallet
    assert.throws(
      () => joinCodeCheckin(ID, wallet.address, "VALID1", sig),
      { message: /Signature does not match/ }
    );
  });

  test("duplicate registration throws 'Already registered'", async () => {
    const wallet = ethers.Wallet.createRandom();
    const sig1 = await signCheckin(wallet, ID);
    joinCodeCheckin(ID, wallet.address, "VALID1", sig1);

    const sig2 = await signCheckin(wallet, ID);
    assert.throws(
      () => joinCodeCheckin(ID, wallet.address, "VALID1", sig2),
      { message: /Already registered/ }
    );
  });
});

// ─── DEMO_JOIN_CODES fallback ────────────────────────────────────────────────

describe("DEMO_JOIN_CODES fallback", () => {
  // demoId=1 → code HK7P2T, onChainId=15 (matches INITIAL_DEPLOYED_EVENTS)
  test("demoId=1 code HK7P2T works for onChainId=15", async () => {
    const ID = "15";
    const now = Math.floor(Date.now() / 1000);
    setEventMeta(ID, now - 3600, now + 3600);
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    const result = await joinCodeCheckin(ID, wallet.address, "HK7P2T", sig, null, "1");
    assert.equal(result.pending, true);
  });

  test("demoId=2 code W5NX4M works for onChainId=16", async () => {
    const ID = "16";
    const now = Math.floor(Date.now() / 1000);
    setEventMeta(ID, now - 3600, now + 3600);
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    const result = await joinCodeCheckin(ID, wallet.address, "W5NX4M", sig, null, "2");
    assert.equal(result.pending, true);
  });

  test("wrong code for demoId fallback is rejected", async () => {
    const ID = "15";
    const wallet = ethers.Wallet.createRandom();
    const sig = await signCheckin(wallet, ID);
    assert.throws(
      () => joinCodeCheckin(ID, wallet.address, "BADCOD", sig, null, "1"),
      { message: /Incorrect join code/ }
    );
  });
});

// ─── Pending Queue ────────────────────────────────────────────────────────────

describe("Pending Queue", () => {
  const ID = EVENTS.pending;

  test("addPending then getPendingAttendees returns the attendee", () => {
    const addr = ethers.Wallet.createRandom().address.toLowerCase();
    addPending(ID, addr, "0xsig");
    const list = getPendingAttendees(ID);
    assert.ok(list.some((a) => a.attendee === addr), "attendee not in pending list");
  });

  test("getPendingAttendees returns [] for unknown event", () => {
    assert.deepEqual(getPendingAttendees("00000"), []);
  });

  test("addPending stores ENS when provided", () => {
    const addr = ethers.Wallet.createRandom().address.toLowerCase();
    addPending(ID, addr, "0xsig", "user.eth");
    const list = getPendingAttendees(ID);
    const entry = list.find((a) => a.attendee === addr);
    assert.ok(entry, "attendee not found");
    assert.equal(entry.ens, "user.eth");
  });

  test("addPending is idempotent — second add overwrites, not duplicates", () => {
    const addr = ethers.Wallet.createRandom().address.toLowerCase();
    addPending(ID, addr, "0xsig1");
    addPending(ID, addr, "0xsig2"); // same address, new sig
    const list = getPendingAttendees(ID);
    const entries = list.filter((a) => a.attendee === addr);
    assert.equal(entries.length, 1, "expected exactly 1 entry");
  });
});

// ─── Deployed Events Store ────────────────────────────────────────────────────

describe("Deployed Events Store", () => {
  const DEMO_ID = EVENTS.deployedStore;
  const DATA_PATH = path.join(__dirname, "../data/deployedEvents.json");

  after(() => {
    // Clean up test entry — don't leave junk in the real file
    try {
      const raw = JSON.parse(fs.readFileSync(DATA_PATH, "utf8"));
      delete raw[DEMO_ID];
      fs.writeFileSync(DATA_PATH, JSON.stringify(raw, null, 2));
    } catch { /* file may not exist in CI */ }
  });

  test("saveDeployedEvent persists and getDeployedEvents reads it back", () => {
    saveDeployedEvent(DEMO_ID, "0xtxhash", "42", "CDTEST", 1000, 2000);
    const store = getDeployedEvents();
    const entry = store[DEMO_ID];
    assert.ok(entry, "entry not found in store");
    assert.equal(entry.onChainId, "42");
    assert.equal(entry.joinCode, "CDTEST");
    assert.equal(entry.startTime, 1000);
    assert.equal(entry.endTime, 2000);
    assert.equal(entry.txHash, "0xtxhash");
  });
});

// ─── Events Store ─────────────────────────────────────────────────────────────

describe("Events Store (saveAllEvents / getAllEvents)", () => {
  const EVENTS_PATH = path.join(__dirname, "../data/events.json");
  let savedEvents = null;

  before(() => {
    try { savedEvents = JSON.parse(fs.readFileSync(EVENTS_PATH, "utf8")); } catch {}
  });

  after(() => {
    // Restore original file so production data isn't lost
    if (savedEvents !== null) {
      fs.writeFileSync(EVENTS_PATH, JSON.stringify(savedEvents, null, 2));
    } else {
      try { fs.unlinkSync(EVENTS_PATH); } catch {}
    }
  });

  const SAMPLE = [
    { id: 1, name: "Alpha", status: "upcoming" },
    { id: 2, name: "Beta",  status: "live" },
  ];

  test("saveAllEvents + getAllEvents roundtrip", () => {
    saveAllEvents(SAMPLE);
    const loaded = getAllEvents();
    assert.deepEqual(loaded, SAMPLE);
  });

  test("getAllEvents returns null when file missing", () => {
    try { fs.unlinkSync(EVENTS_PATH); } catch {}
    const result = getAllEvents();
    assert.equal(result, null);
  });
});
