import { test } from "@playwright/test";

/**
 * Diagnostic: open the login page, click "Connect Wallet", click MetaMask,
 * and dump every console message + network error to stdout.
 *
 * Run:  npx playwright test diagnostics/wallet-debug.spec.ts --headed --workers=1 --reporter=list
 */
test("debug wallet connect flow", async ({ page }) => {
  test.setTimeout(60_000);

  page.on("console", (msg) => {
    console.log(`[browser:${msg.type()}] ${msg.text()}`);
  });
  page.on("pageerror", (err) => {
    console.log(`[pageerror] ${err.message}\n${err.stack}`);
  });
  page.on("requestfailed", (req) => {
    console.log(`[requestfailed] ${req.method()} ${req.url()} → ${req.failure()?.errorText}`);
  });

  await page.goto("http://localhost:3000/login");
  await page.waitForTimeout(2000);

  console.log("\n──── Clicking Connect Wallet ────");
  await page.getByRole("button", { name: /connect wallet/i }).click();
  await page.waitForTimeout(2000);

  console.log("\n──── Clicking MetaMask ────");
  const metamask = page.getByRole("button", { name: /metamask/i });
  if (await metamask.isVisible().catch(() => false)) {
    await metamask.click();
    await page.waitForTimeout(3000);
  } else {
    console.log("MetaMask button not found in modal");
  }

  // Final dump of any state
  console.log("\n──── Final URL:", page.url());
  await page.waitForTimeout(2000);
});
