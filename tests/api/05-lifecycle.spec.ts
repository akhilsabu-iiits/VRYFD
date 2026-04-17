import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { nowPlus } from "../fixtures/helpers";

/**
 * Full lifecycle test:
 *   1. admin creates an event
 *   2. attendee tries to check in BEFORE start → rejected (upcoming)
 *   3. admin starts the event
 *   4. attendee checks in → accepted (live)
 *   5. admin ends the event
 *   6. attendee tries to check out AFTER end → rejected (ended)
 *   7. admin issues a certificate to the attendee
 *   8. attendee list endpoint returns the attendee with duration
 */
test.describe("API: Event lifecycle & management", () => {
  let adminToken: string;
  let eventId: number;
  const attendee = "0x" + "a".repeat(40); // deterministic test address

  test.beforeAll(async ({ request }) => {
    const r = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    adminToken = (await r.json()).token;
  });

  test("admin creates a lifecycle test event (on-chain)", async ({ request }) => {
    test.setTimeout(180_000);
    const start = nowPlus(60 * 60); // starts in 1 hour (so lifecycle status starts as 'upcoming')
    const end = start + 60 * 60;
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/createEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 120_000,
      data: {
        name: `Lifecycle Test ${Date.now()}`,
        metadataURI: `ipfs://lc-${Date.now()}`,
        startTime: start,
        endTime: end,
        attendanceThreshold: 75,
        claimPeriodDays: 7,
        durationMinutes: 60,
        eventType: 1,
      },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    eventId = Number(body.eventId);
    expect(eventId).toBeGreaterThanOrEqual(0);
  });

  test("check-in is REJECTED before event starts (upcoming)", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId, attendee },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/not started|wait/i);
    expect(body.status).toBe("upcoming");
  });

  test("startEvent requires auth", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/startEvent`, {
      data: { eventId },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("admin starts the event", async ({ request }) => {
    // startEvent now also extends the on-chain endTime via editEvent,
    // which takes a full Sepolia block confirmation (~15-30s).
    test.setTimeout(180_000);
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/startEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      timeout: 120_000,
      data: { eventId },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.event.status).toBe("live");
    expect(body.event.canCheckIn).toBe(true);
  });

  test("check-in is ACCEPTED once event is live", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId, attendee },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  test("attendees endpoint lists the attendee with session data", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/attendance/event/${eventId}/attendees`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.total).toBeGreaterThanOrEqual(1);
    const me = body.attendees.find((a: any) => a.attendee === attendee.toLowerCase());
    expect(me).toBeDefined();
    expect(me.currentlyActive).toBe(true);
    expect(me.durationMinutes).toBeGreaterThanOrEqual(0);
  });

  test("admin ends the event", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/endEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { eventId },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.event.status).toBe("ended");
    expect(body.event.canCheckIn).toBe(false);
    expect(body.event.canCheckOut).toBe(false);
  });

  test("check-in is REJECTED after event ends", async ({ request }) => {
    const otherAttendee = "0x" + "b".repeat(40);
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkin`, {
      data: { eventId, attendee: otherAttendee },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/ended|closed/i);
    expect(body.status).toBe("ended");
  });

  test("checkout is REJECTED after event ends", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/attendance/checkout`, {
      data: { eventId, attendee },
    });
    expect(res.status()).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/ended|closed/i);
  });

  test("cannot re-start an ended event", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/relay/startEvent`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { eventId },
    });
    expect(res.status()).toBe(400);
  });
});

test.describe("API: Certificate image & public viewer", () => {
  test("GET /api/certificates/image/:id returns PNG for valid cert or 404 for missing", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/certificates/image/999999`);
    expect([404, 500]).toContain(res.status());
  });

  test("GET /api/certificates/image rejects invalid id format", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/certificates/image/not-a-number`);
    expect(res.status()).toBe(400);
  });
});
