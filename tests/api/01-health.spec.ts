import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";

test.describe("API: Health & infrastructure", () => {
  test("backend reachable on port 3001", async ({ request }) => {
    const res = await request.get(`${CONFIG.BACKEND_URL}/api/relay/events`);
    expect(res.status()).toBe(200);
  });

  test("frontend reachable on port 3000", async ({ request }) => {
    const res = await request.get(CONFIG.FRONTEND_URL);
    expect([200, 307, 308]).toContain(res.status());
  });

  test("Sepolia contract address is configured", () => {
    expect(CONFIG.CONTRACT_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
    expect(CONFIG.TOKEN_ADDRESS).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  test("CORS responds for the frontend origin", async ({ request }) => {
    const res = await request.fetch(`${CONFIG.BACKEND_URL}/api/relay/events`, {
      method: "GET",
      headers: { Origin: CONFIG.FRONTEND_URL },
    });
    expect(res.status()).toBe(200);
  });
});
