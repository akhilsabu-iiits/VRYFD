import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";

test.describe("API: Authentication & roles", () => {
  test("admin can login with seeded credentials", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body.token).toBeTruthy();
    expect(body.user.role).toBe("admin");
    expect(body.user.email).toBe(CONFIG.ADMIN.email);
  });

  test("login fails with wrong password", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: "wrong-password" },
    });
    expect(res.status()).toBe(401);
  });

  test("login fails for unknown email", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: "nobody@vryfd.test", password: "any" },
    });
    expect([401, 404]).toContain(res.status());
  });

  test("admin can list and create invites", async ({ request }) => {
    const login = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    const { token } = await login.json();
    const headers = { Authorization: `Bearer ${token}` };

    const list = await request.get(`${CONFIG.BACKEND_URL}/api/auth/invites`, { headers });
    expect(list.ok()).toBe(true);

    const invite = await request.post(`${CONFIG.BACKEND_URL}/api/auth/invite`, {
      headers,
      data: { email: `org-${Date.now()}@vryfd.test` },
    });
    expect([200, 201]).toContain(invite.status());
    const body = await invite.json();
    expect(body.success).toBe(true);
    expect(body.link).toMatch(/invite=/);
  });

  test("non-admin cannot create invites", async ({ request }) => {
    const res = await request.post(`${CONFIG.BACKEND_URL}/api/auth/invite`, {
      data: { email: "x@y.com" },
    });
    expect([401, 403]).toContain(res.status());
  });

  test("invite signup creates organizer account", async ({ request }) => {
    const adminLogin = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    const { token: adminToken } = await adminLogin.json();
    const orgEmail = `org-signup-${Date.now()}@vryfd.test`;

    const inviteRes = await request.post(`${CONFIG.BACKEND_URL}/api/auth/invite`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      data: { email: orgEmail },
    });
    const invite = await inviteRes.json();
    // Invite link is `${frontend}/login?invite=<token>` — extract the token
    const inviteToken = new URL(invite.link).searchParams.get("invite");
    expect(inviteToken).toBeTruthy();

    const signup = await request.post(`${CONFIG.BACKEND_URL}/api/auth/register`, {
      data: {
        inviteToken,
        email: orgEmail,
        password: "Organizer123!",
        name: "Test Org",
      },
    });
    expect(signup.ok()).toBe(true);
    const body = await signup.json();
    expect(body.user.role).toBe("organizer");
    expect(body.token).toBeTruthy();
  });
});
