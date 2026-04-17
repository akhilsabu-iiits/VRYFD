import { defineConfig, devices } from "@playwright/test";

/**
 * VRYFD End-to-End Test Suite
 *
 * Run modes:
 *   npx playwright test                  → all tests, headless
 *   npx playwright test --headed         → visible browser
 *   npx playwright test --ui             → interactive watch mode
 *   npx playwright test ui/              → only UI tests
 *   npx playwright test api/             → only API tests
 *   npx playwright show-report           → open last report
 */
export default defineConfig({
  testDir: ".",
  fullyParallel: false, // contract calls share nonce; serial avoids race conditions
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "report", open: "never" }]],
  timeout: 120_000, // long because some tests wait for Sepolia block confirmations
  expect: { timeout: 15_000 },
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "api",
      testMatch: /api\/.*\.spec\.ts/,
      use: {
        baseURL: "http://localhost:3001",
      },
    },
    {
      name: "ui-chromium",
      testMatch: /ui\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
        launchOptions: {
          slowMo: Number(process.env.SLOW_MO ?? 800),
        },
      },
    },
    {
      name: "diagnostics",
      testMatch: /diagnostics\/.*\.spec\.ts/,
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
});
