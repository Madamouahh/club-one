import { defineConfig, devices } from "@playwright/test";

// E2E Playwright contre le LABO local (jamais la production). Le serveur dev Next lit .env.local
// (LABO http://127.0.0.1:54321). Lancer : voir e2e/README.md (installe @playwright/test + navigateurs).
export default defineConfig({
  testDir: ".",
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1, // login staff partagé (même LABO) → sérialiser pour éviter les races de connexion
  retries: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    // Pixel 5 = viewport mobile sur moteur Chromium (déjà installé). iPhone 13 nécessiterait WebKit.
    { name: "mobile", use: { ...devices["Pixel 5"] } },
  ],
  webServer: {
    // Serveur dev dédié à l'E2E sur :3100, pointé vers le LABO local via le port-forward 8321
    // (Kong non publié → socat host:8321 -> kong:8000). Jamais la prod.
    // Build de PRODUCTION (hydratation fiable, pas de HMR) — le dev Turbopack n'hydratait pas ici.
    // NEXT_PUBLIC_SUPABASE_URL=8321 est inliné au build (voir docs), donc `next start` suffit.
    command: "npx next start -p 3100",
    cwd: process.cwd(),
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
