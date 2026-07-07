import { defineConfig, devices } from "@playwright/test";

// E2E Playwright contre le LABO local (jamais la production). Le serveur dev Next lit .env.local
// (LABO http://127.0.0.1:54321). Lancer : voir e2e/README.md (installe @playwright/test + navigateurs).
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile", use: { ...devices["iPhone 13"] } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
