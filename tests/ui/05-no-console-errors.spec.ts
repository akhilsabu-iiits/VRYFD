import { test, expect } from "@playwright/test";
import { CONFIG } from "../fixtures/config";
import { loginUI } from "../fixtures/page-helpers";

test.describe("UI: No console errors on any page", () => {
  const routes = ["/dashboard", "/marketplace", "/profile", "/claim", "/verify", "/organizer", "/admin"];

  for (const route of routes) {
    test(`no console errors on ${route}`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error") {
          const text = msg.text();
          if (
            text.includes("Failed to load resource") ||
            text.includes("favicon") ||
            text.includes("WalletConnect") ||
            text.includes("websocket") ||
            text.includes("Warning") ||
            text.includes("Cross-Origin-Opener-Policy") ||
            text.includes("Failed to fetch") ||  // benign network noise from Wagmi in test env
            text.includes("walletconnect")
          )
            return;
          errors.push(text);
        }
      });

      await loginUI(page, CONFIG.ADMIN.email, CONFIG.ADMIN.password);
      await page.goto(route);
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      await page.waitForTimeout(1000);

      expect(errors, `Errors on ${route}:\n${errors.join("\n")}`).toHaveLength(0);
    });
  }
});
