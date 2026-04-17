import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { nowPlus } from "../fixtures/helpers";

test.describe("API: Events (on-chain Sepolia)", () => {
  let adminToken: string;

  test.beforeAll(async ({ request }) => {
    const r = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    adminToken = (await r.json()).token;
  });

  test("GET /api/relay/events returns array", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/relay/events`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
  });

  test("GET /api/relay/my-events requires auth", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/relay/my-events`);
    expect([401, 403]).toContain(res.status());
  });

  test("GET /api/relay/my-events works for admin", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/relay/my-events`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.events)).toBe(true);
  });

  // Sepolia block confirmations can take 12–60s. Long timeout + extended action timeout.
  test("POST /api/relay/createEvent creates a new event on Sepolia", async ({ request }) => {
    test.setTimeout(180_000);
    const start = nowPlus(60);
    const end = start + 30 * 60;
    const eventName = `E2E Test Event ${Date.now()}`;
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/createEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 120_000, // override per-call timeout for the on-chain tx
      data: {
        name: eventName,
        metadataURI: `ipfs://e2e-${Date.now()}`,
        startTime: start,
        endTime: end,
        attendanceThreshold: 75,
        claimPeriodDays: 7,
        durationMinutes: 30,
        eventType: 1,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.eventId).toBeDefined();
    expect(body.txHash).toMatch(/^0x[0-9a-f]{64}$/);
    // Stash event name on the test fixture so the next test can find it
    (test.info() as any).eventName = eventName;
    process.env.LAST_E2E_EVENT_NAME = eventName;
  });

  test("Event appears in events list after creation", async ({ request }) => {
    const expectedName = process.env.LAST_E2E_EVENT_NAME;
    test.skip(!expectedName, "previous test did not record event name");
    // Allow a brief delay for the events.json cache to flush
    await new Promise((r) => setTimeout(r, 1500));
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/relay/events`);
    const body = await res.json();
    const found = body.events.find((e: any) => e.name === expectedName);
    expect(found, `Could not find created event "${expectedName}" in events list`).toBeTruthy();
  });

  test("createEvent requires authentication", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/createEvent`, {
      data: {
        name: "Unauthorized event",
        startTime: nowPlus(60),
        endTime: nowPlus(3600),
      },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("createEvent rejects missing required fields", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/createEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { name: "Missing dates" },
    });
    expect(res.status()).toBe(400);
  });
});
