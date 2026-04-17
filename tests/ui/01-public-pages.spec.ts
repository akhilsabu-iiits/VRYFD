import { test, expect } from "@playwright/test";

test.describe("UI: Public unauthenticated pages", () => {
  test("root redirects to /login when not authenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/login$/);
  });

  test("login page renders with email + password fields", async ({ page }) => {
    await page.goto("/login");
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
    await expect(page.locator('button[type="submit"]').filter({ hasText: /sign in/i }).first()).toBeVisible();
  });

  test("login shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");
    await page.locator('input[type="email"]').fill("nobody@vryfd.test");
    // Password must be ≥6 chars to pass HTML5 minLength validation
    await page.locator('input[type="password"]').first().fill("wrongpw");
    await page.locator('button[type="submit"]').filter({ hasText: /sign in/i }).first().click();
    await expect(page.locator("body")).toContainText(/invalid|incorrect|not found|user|email/i, { timeout: 5000 });
  });

  test("legacy /app redirects to /dashboard or /login", async ({ page }) => {
    await page.goto("/app");
    await page.waitForURL(/(dashboard|login)$/, { timeout: 5000 });
  });

  test("legacy /events redirects to /marketplace or /login", async ({ page }) => {
    await page.goto("/events");
    await page.waitForURL(/(marketplace|login)$/, { timeout: 5000 });
  });
});
