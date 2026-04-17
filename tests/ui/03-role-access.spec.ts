import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { loginUI, expectSidebarLink } from "../fixtures/page-helpers";

test.describe("UI: Role-based access control", () => {
  let organizerEmail: string;
  let attendeeEmail: string;
  const PASSWORD = "TestPass123!";

  test.beforeAll(async ({ request }) => {
    const adminLogin = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    const { token } = await adminLogin.json();
    const headers = { Authorization: `Bearer ${token}` };

    organizerEmail = `org-rbac-${Date.now()}@vryfd.test`;
    attendeeEmail = `att-rbac-${Date.now()}@vryfd.test`;

    const inv = await request.post(`${CONFIG.BACKEND_URL}/api/auth/invite`, {
      headers,
      data: { email: organizerEmail },
    });
    const link = (await inv.json()).link;
    const inviteToken = new URL(link).searchParams.get("invite");
    await request.post(`${CONFIG.BACKEND_URL}/api/auth/register`, {
      data: { inviteToken, email: organizerEmail, password: PASSWORD, name: "Org RBAC" },
    });
    await request.post(`${CONFIG.BACKEND_URL}/api/auth/register`, {
      data: { email: attendeeEmail, password: PASSWORD, name: "Attendee RBAC" },
    });
  });

  test("organizer sees Organizer link, NOT Admin link", async ({ page }) => {
    await loginUI(page, organizerEmail, PASSWORD);
    await expectSidebarLink(page, "Organizer", true);
    await expectSidebarLink(page, "Admin", false);
  });

  test("attendee sees neither Organizer nor Admin links", async ({ page }) => {
    await loginUI(page, attendeeEmail, PASSWORD);
    await expectSidebarLink(page, "Organizer", false);
    await expectSidebarLink(page, "Admin", false);
    await expectSidebarLink(page, "Dashboard", true);
    await expectSidebarLink(page, "Marketplace", true);
    await expectSidebarLink(page, "Verify", true);
  });

  test("attendee directly visiting /organizer is redirected away", async ({ page }) => {
    await loginUI(page, attendeeEmail, PASSWORD);
    await page.goto("/organizer");
    await page.waitForURL(/dashboard|login/, { timeout: 5000 });
  });
});
