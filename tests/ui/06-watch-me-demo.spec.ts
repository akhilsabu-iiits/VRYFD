import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { loginUI, logoutUI, clickSidebarLink, expectSidebarLink } from "../fixtures/page-helpers";

/**
 * Demo-friendly suite that walks through Admin → Organizer → Attendee in a single
 * visible flow with deliberate pauses so a human can watch.
 *
 * Recommended:  npx playwright test ui/06-watch-me-demo.spec.ts --headed --workers=1
 *
 * Override pause length via env: WATCH_PAUSE=4000 (default 2500ms)
 */

const PAUSE_MS = Number(process.env.WATCH_PAUSE ?? 2500);
const pause = (page: any, ms: number = PAUSE_MS) => page.waitForTimeout(ms);

let organizerEmail: string;
let attendeeEmail: string;
const PASSWORD = "WatchMe123!";

test.describe.configure({ mode: "serial" });

test.describe("WATCH ME — Full role demo", () => {
  test.beforeAll(async ({ request }) => {
    // Pre-create organizer + attendee accounts so we can demo logging in as each
    const adminLogin = await request.post(`${CONFIG.BACKEND_URL}/api/auth/login`, {
      data: { email: CONFIG.ADMIN.email, password: CONFIG.ADMIN.password },
    });
    const { token } = await adminLogin.json();
    const headers = { Authorization: `Bearer ${token}` };

    organizerEmail = `watch-org-${Date.now()}@vryfd.test`;
    attendeeEmail = `watch-att-${Date.now()}@vryfd.test`;

    const inv = await request.post(`${CONFIG.BACKEND_URL}/api/auth/invite`, {
      headers,
      data: { email: organizerEmail },
    });
    const link = (await inv.json()).link;
    const inviteToken = new URL(link).searchParams.get("invite");
    await request.post(`${CONFIG.BACKEND_URL}/api/auth/register`, {
      data: { inviteToken, email: organizerEmail, password: PASSWORD, name: "Demo Organizer" },
    });
    await request.post(`${CONFIG.BACKEND_URL}/api/auth/register`, {
      data: { email: attendeeEmail, password: PASSWORD, name: "Demo Attendee" },
    });

    console.log(`\n══════════════════════════════════════════════════════════`);
    console.log(`  Demo accounts created (also usable in your own browser):`);
    console.log(`    Admin:     ${CONFIG.ADMIN.email}  /  ${CONFIG.ADMIN.password}`);
    console.log(`    Organizer: ${organizerEmail}  /  ${PASSWORD}`);
    console.log(`    Attendee:  ${attendeeEmail}  /  ${PASSWORD}`);
    console.log(`══════════════════════════════════════════════════════════\n`);
  });

  test("1️⃣  ADMIN — login and tour the admin sidebar", async ({ page }) => {
    await loginUI(page, CONFIG.ADMIN.email, CONFIG.ADMIN.password);
    await pause(page);

    for (const label of ["Dashboard", "Marketplace", "Profile", "Claim Center", "Verify", "Organizer", "Admin"]) {
      await clickSidebarLink(page, label);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await pause(page);
    }
  });

  test("2️⃣  ORGANIZER — login, see organizer dashboard (no Admin link)", async ({ page }) => {
    await logoutUI(page);
    await loginUI(page, organizerEmail, PASSWORD);
    await pause(page);

    await expectSidebarLink(page, "Admin", false);
    await expectSidebarLink(page, "Organizer", true);

    await clickSidebarLink(page, "Organizer");
    await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
    await pause(page);

    const createTab = page.getByRole("button", { name: /create event/i }).first();
    if (await createTab.isVisible().catch(() => false)) {
      await createTab.click();
      await pause(page);
    }
  });

  test("3️⃣  ATTENDEE — login, see attendee-only sidebar (no Organizer or Admin)", async ({ page }) => {
    await logoutUI(page);
    await loginUI(page, attendeeEmail, PASSWORD);
    await pause(page);

    await expectSidebarLink(page, "Admin", false);
    await expectSidebarLink(page, "Organizer", false);
    await expectSidebarLink(page, "Marketplace", true);
    await expectSidebarLink(page, "Verify", true);

    for (const label of ["Marketplace", "Profile", "Claim Center", "Verify", "Dashboard"]) {
      await clickSidebarLink(page, label);
      await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
      await pause(page);
    }
  });

  test("4️⃣  PUBLIC — verify a certificate by ID (no login required)", async ({ page, context }) => {
    // Wipe auth so we hit the page as an anonymous visitor
    await context.clearCookies();
    await page.goto("/login");
    await page.evaluate(() => {
      try {
        localStorage.removeItem("vryfd_token");
        localStorage.removeItem("vryfd_user");
      } catch {}
    });

    // Anonymous visitor lands directly on verify (PRD: certificate verification is public)
    await page.goto("/verify?id=999999");
    await pause(page, 4000);
    await expect(page).toHaveURL(/verify/);

    const input = page.locator("input").first();
    await input.fill("1");
    await pause(page);
    await page.getByRole("button", { name: /verify/i }).first().click();
    await pause(page, 4000);
  });
});
