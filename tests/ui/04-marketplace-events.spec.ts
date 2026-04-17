import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { loginUI } from "../fixtures/page-helpers";

test.describe("UI: Marketplace & event detail pages", () => {
  test.beforeEach(async ({ page }) => {
    await loginUI(page, CONFIG.ADMIN.email, CONFIG.ADMIN.password);
  });

  test("marketplace renders event list (or empty state)", async ({ page }) => {
    await page.goto("/marketplace");
    await expect(page.locator("body")).toContainText(/event|no events|marketplace/i);
  });

  test("dashboard shows stat cards", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.getByText(/active events|check-?ins|certificates|tokens/i).first()).toBeVisible();
  });

  test("profile page shows tab navigation", async ({ page }) => {
    await page.goto("/profile");
    await expect(page.getByRole("button", { name: /badges|certificates|tokens|activity/i }).first()).toBeVisible();
  });

  test("claim center shows claimable events or empty state", async ({ page }) => {
    await page.goto("/claim");
    await expect(page.locator("body")).toContainText(/claim|certificate|no events|attended/i);
  });
});
