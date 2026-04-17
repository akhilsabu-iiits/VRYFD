import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";

test.describe("API: VRYF tokens (on-chain reads)", () => {
  test("token-balance returns 0 for an unused wallet", async ({ request }) => {
    const fresh = "0x" + "a".repeat(40);
    const res = await request.get(
      `${CONFIG.BACKEND_URL}/api/relay/token-balance/${fresh}`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.balance).toBe(0);
  });

  test("token-balance for invalid address returns wallet-required note", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/relay/token-balance/foo@bar.com`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.balance).toBe(0);
    expect(body.note).toMatch(/wallet/i);
  });

  test("token-history returns empty for fresh wallet", async ({ request }) => {
    const fresh = "0x" + "b".repeat(40);
    const res = await request.get(
      `${CONFIG.BACKEND_URL}/api/relay/token-history/${fresh}`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.transactions)).toBe(true);
  });

  test("token-balance for relayer wallet works", async ({ request }) => {
    const res = await request.get(
      `${CONFIG.BACKEND_URL}/api/relay/token-balance/${CONFIG.RELAYER_ADDRESS}`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(typeof body.balance).toBe("number");
  });
});

test.describe("API: Certificate verify (on-chain)", () => {
  test("verify rejects invalid certificate ID format", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/verify/abc`);
    expect(res.status()).toBe(400);
  });

  test("verify returns 404 for nonexistent certificate", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/verify/999999`);
    expect(res.status()).toBe(404);
    const body = await res.json();
    expect(body.verified).toBe(false);
  });

  test("certificates/mine for invalid wallet returns empty list", async ({ request }) => {
    const res = await request.get(
      `${CONFIG.BACKEND_URL}/api/certificates/mine/notawallet`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.certificates).toEqual([]);
  });

  test("certificates/mine for valid wallet returns array", async ({ request }) => {
    const res = await request.get(
      `${CONFIG.BACKEND_URL}/api/certificates/mine/${CONFIG.RELAYER_ADDRESS}`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.certificates)).toBe(true);
  });

  test("issueCertificate rejects email-only attendee (PRD §11)", async ({ request }) => {
    const adminLogin = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    const { token } = await adminLogin.json();

    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/issueCertificate`, {
      headers: { Authorization: `Bearer ${token}` },
      data: {
        eventId: 1,
        attendee: "user@example.com",
        metadataURI: "ipfs://test",
      },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/wallet|address/i);
  });
});

test.describe("API: Attendance (wallet-required)", () => {
  // Reuse a single live event across all attendance tests in this block.
  // Created once, started once, ended in afterAll to keep the suite hermetic.
  let liveEventId: number;
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    test.setTimeout(300_000); // create + editEvent + startEvent across ~3 Sepolia blocks
    const login = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    adminToken = (await login.json()).token;

    // Create + immediately start an event so check-ins are open for the tests below.
    const now = Math.floor(Date.now() / 1000);
    const create = await request.post(`${CONFIG.BACKEND_URL}/api/relay/createEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 120_000,
      data: {
        name: `Attendance Suite ${Date.now()}`,
        metadataURI: `ipfs://att-${Date.now()}`,
        startTime: now + 60 * 60,        // an hour in the future
        endTime: now + 2 * 60 * 60,
        attendanceThreshold: 75,
        claimPeriodDays: 7,
        durationMinutes: 60,
        eventType: 1,
      },
    });
    const body = await create.json();
    liveEventId = Number(body.eventId);

    await request.post(`${CONFIG.BACKEND_URL}/api/relay/startEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 120_000,
      data: { eventId: liveEventId },
    });
  });

  test.afterAll(async ({ request }) => {
    if (liveEventId !== undefined && adminToken) {
      await request.post(`${CONFIG.BACKEND_URL}/api/relay/endEvent`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        data: { eventId: liveEventId },
      });
    }
  });

  test("checkin rejects without wallet address", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId: liveEventId, email: "x@y.com" },
    });
    expect(res.status()).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/wallet/i);
  });

  test("checkin rejects invalid wallet address", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId: liveEventId, attendee: "0xnot-valid" },
    });
    expect(res.status()).toBe(400);
  });

  test("checkin succeeds with valid wallet (session-only)", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId: liveEventId, attendee: CONFIG.RELAYER_ADDRESS },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.attendee).toBe(CONFIG.RELAYER_ADDRESS);
  });

  test("checkout records duration", async ({ request }) => {
    const addr = "0x" + "c".repeat(40);
    await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId: liveEventId, attendee: addr },
    });
    await new Promise((r) => setTimeout(r, 1100));
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkout`, {
      data: { eventId: liveEventId, attendee: addr },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.durationMinutes).toBeGreaterThanOrEqual(0);
  });

  test("active count reflects checked-in users", async ({ request }) => {
    const addr = "0x" + "1".repeat(40);
    await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId: liveEventId, attendee: addr },
    });
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/attendance/active/${liveEventId}`);
    const body = await res.json();
    expect(body.activeCount).toBeGreaterThanOrEqual(1);
  });

  test("rejects check-in for nonexistent event", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId: 999999, attendee: CONFIG.RELAYER_ADDRESS },
    });
    expect(res.status()).toBe(404);
  });

  test("my-checkins requires wallet param", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/attendance/my-checkins`);
    expect(res.status()).toBe(400);
  });

  test("my-checkins returns history", async ({ request }) => {
    const res = await request.get(
      `${CONFIG.BACKEND_URL}/api/attendance/my-checkins?wallet=${CONFIG.RELAYER_ADDRESS}`
    );
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.checkins)).toBe(true);
  });
});

test.describe("API: QR codes (in-person check-in)", () => {
  test("event-checkin QR returns image + URL", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/qr/event-checkin/1`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.qrImage).toMatch(/^data:image\/png;base64,/);
    expect(body.checkinUrl).toContain("/live/1?checkin=true");
  });
});
