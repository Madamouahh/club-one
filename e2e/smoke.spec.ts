import { test, expect } from "@playwright/test";

// Smoke sans login (reproductible, aucun skip). Les parcours staff authentifiés sont couverts par des
// specs dédiées (flows / wave3 / crm / boards / attribution) avec les comptes de TEST du LABO.
test("l'app se charge et rend l'écran de connexion", async ({ page }) => {
  await page.goto("/", { waitUntil: "networkidle" });
  await expect(page.locator("body")).toBeVisible();
  await expect(page).toHaveTitle(/.+/);
  await expect(page.getByText(/Connexion staff/i)).toBeVisible();
});

test("le manifest PWA est servi", async ({ page }) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.name).toBeTruthy();
  expect(body.display).toBe("standalone");
});
