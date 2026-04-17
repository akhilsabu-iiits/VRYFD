import { Page, expect } from "@playwright/test";

/**
 * Robust login helper using stable type-based selectors.
 * Works regardless of placeholder text changes.
 */
export async function loginUI(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.locator('input[type="email"]').waitFor({ state: "visible", timeout: 15000 });
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').first().fill(password);
  // Use button[type=submit] inside the email form — robust to icon/text changes
  await page.locator('button[type="submit"]').filter({ hasText: /sign in/i }).first().click();
  await page.waitForURL(/dashboard$/, { timeout: 15000 });
}

export async function logoutUI(page: Page) {
  // Navigate to the app first so localStorage is accessible
  await page.goto("/login");
  await page.evaluate(() => {
    try {
      localStorage.removeItem("vryfd_token");
      localStorage.removeItem("vryfd_user");
    } catch {}
  });
  await page.goto("/login");
}

export async function expectSidebarLink(page: Page, label: string, visible = true) {
  // Scope to the sidebar to avoid ambiguity with TopNav / dropdown links
  const link = page.locator("aside").getByRole("link", { name: new RegExp(label, "i") });
  if (visible) await expect(link).toBeVisible();
  else await expect(link).not.toBeVisible();
}

/**
 * Click a sidebar nav link by visible label text.
 * Material icons render as text glyphs that bleed into the accessible name,
 * so we use `hasText` (substring match) instead of strict role+name.
 */
export async function clickSidebarLink(page: Page, label: string) {
  await page
    .locator("aside")
    .getByRole("link")
    .filter({ hasText: label })
    .first()
    .click();
}
