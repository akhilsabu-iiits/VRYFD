import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { loginUI, expectSidebarLink } from "../fixtures/page-helpers";

test.describe("UI: Admin login & navigation", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, CONFIG.ADMIN.email, CONFIG.ADMIN.password);
  });

  test("admin lands on dashboard after login", async ({ page }) => {
    await expect(page).toHaveURL(/dashboard/);
  });

  test("sidebar shows ALL items for admin role", async ({ page }) => {
    const expectedLinks = ["Dashboard", "Marketplace", "Profile", "Claim Center", "Verify", "Organizer", "Admin"];
    for (const label of expectedLinks) {
      await expectSidebarLink(page, label, true);
    }
  });

  test("sidebar role badge shows 'admin'", async ({ page }) => {
    await expect(page.locator("aside").getByText(/admin/i).first()).toBeVisible();
  });

  test("can navigate to all sidebar pages without errors", async ({ page }) => {
    const pages = [
      { href: "/dashboard", textRegex: /dashboard/i },
      { href: "/marketplace", textRegex: /marketplace|events/i },
      { href: "/profile", textRegex: /profile|user/i },
      { href: "/claim", textRegex: /claim/i },
      { href: "/verify", textRegex: /verify|certificate/i },
      { href: "/organizer", textRegex: /organizer|create event/i },
      { href: "/admin", textRegex: /admin|invite|user/i },
    ];
    for (const p of pages) {
      await page.goto(p.href);
      await expect(page.locator("body")).toContainText(p.textRegex, { timeout: 5000 });
    }
  });

  test("admin page shows invite organizer form", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByText(/invite/i).first()).toBeVisible();
  });

  test("organizer page shows event creation tabs", async ({ page }) => {
    await page.goto("/organizer");
    await expect(page.getByText(/overview|create event|manage/i).first()).toBeVisible();
  });

  test("verify page accepts certificate ID input", async ({ page }) => {
    await page.goto("/verify");
    await expect(page.locator('input[type="number"], input[type="text"]').first()).toBeVisible();
  });

  test("verify page auto-loads from ?id= query param", async ({ page }) => {
    await page.goto("/verify?id=999999");
    await expect(page.locator("body")).toContainText(/not found|failed|invalid|verification/i, { timeout: 10000 });
  });
});
