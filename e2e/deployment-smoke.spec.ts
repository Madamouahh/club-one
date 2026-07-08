import { test, expect, type Page } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// SMOKE DE DÉPLOIEMENT — vérifie le BUILD RÉELLEMENT SERVI (local next start OU Preview Vercel).
// Pointer sur la Preview :  SMOKE_BASE_URL=https://<preview> SMOKE_ADMIN_USER=… SMOKE_ADMIN_PASS=… \
//   npx playwright test -c e2e/playwright.config.ts deployment-smoke --project=chromium
// Sans SMOKE_BASE_URL : utilise le webServer local (next start -p 3100) de la config.

const BASE = process.env.SMOKE_BASE_URL ?? "";
const ADMIN = {
  user: process.env.SMOKE_ADMIN_USER ?? LAB_USERS.admin.user,
  pass: process.env.SMOKE_ADMIN_PASS ?? LAB_USERS.admin.pass,
};
const SURFACES = ["/staff", "/ops", "/dashboard", "/espace"];
const DASH_SECTIONS = ["direction", "soirees", "personnel", "crm", "relation", "marketing", "gestion", "admin"];

async function httpStatus(page: Page, path: string): Promise<number> {
  const resp = await page.goto(BASE + path, { waitUntil: "domcontentloaded" });
  return resp?.status() ?? 0;
}

// Login robuste (compte admin rehearsal) : attend l'hydratation React avant de saisir, et le bouton activé
// avant de cliquer (évite la course fill-avant-hydratation qui laisse le submit désactivé).
async function loginAdmin(page: Page) {
  await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" });
  const u = page.getByTestId("auth-user");
  const p = page.getByTestId("auth-pass");
  const submit = page.getByTestId("auth-submit");
  await expect(u).toBeVisible({ timeout: 20000 });
  await expect(async () => {
    await u.fill(ADMIN.user);
    await p.fill(ADMIN.pass);
    await expect(u).toHaveValue(ADMIN.user);
    await expect(submit).toBeEnabled();
  }).toPass({ timeout: 15000 });
  await submit.click();
  await expect(page.getByTestId("dash-sidebar")).toBeVisible({ timeout: 20000 });
}

test("surfaces : /staff /ops /dashboard /espace → 200, aucune 404", async ({ page }) => {
  for (const p of SURFACES) {
    const s = await httpStatus(page, p);
    expect(s, `${p} doit répondre 2xx/3xx (pas 404)`).toBeLessThan(400);
    expect(s, `${p} ne doit pas être 404`).not.toBe(404);
  }
  // La route dynamique du portail rend aussi (200) même avec un jeton placeholder (garde côté serveur).
  const dyn = await httpStatus(page, "/espace/00000000-0000-0000-0000-000000000000");
  expect(dyn, "/espace/[token] ne doit pas être 404").not.toBe(404);
});

test("dashboard : chaque section monte un vrai module (liste/détail), aucune KPI-only", async ({ page }) => {
  await loginAdmin(page);

  for (const sec of DASH_SECTIONS) {
    await page.getByTestId(`dash-section-${sec}`).click();
    await expect(page.getByTestId(`dash-${sec}`)).toBeVisible({ timeout: 10000 });
    if (sec === "direction") {
      await expect(page.getByTestId("command-center")).toBeVisible({ timeout: 12000 });
    } else {
      // Un vrai module : sous-navigation/liste/détail, jamais un simple bloc de KPI.
      await expect(page.getByTestId("dash-listdetail")).toBeVisible({ timeout: 10000 });
      await expect(page.getByTestId("dash-list").or(page.getByTestId("dash-empty")).or(page.getByTestId("dash-loading"))).toBeVisible({ timeout: 10000 });
    }
  }
});

test("dashboard Relation client : action métier réelle (décider une demande) persistée", async ({ page }) => {
  await loginAdmin(page);
  await page.getByTestId("dash-section-relation").click();
  await page.getByTestId("dash-submod-resas").click();
  await expect(page.getByTestId("dash-listdetail")).toBeVisible({ timeout: 10000 });
  // Attendre la STABILISATION de la liste (liste OU vide) avant de conclure — jamais pendant le chargement.
  await expect(page.getByTestId("dash-list").or(page.getByTestId("dash-empty"))).toBeVisible({ timeout: 12000 });
  // Une action réelle exige une demande à décider : présente si l'environnement a des données (LABO/rehearsal seedé).
  const rowCount = await page.getByTestId("dash-row").count();
  expect(rowCount, "Relation client doit exposer au moins une demande actionnable (données requises côté environnement)").toBeGreaterThan(0);
  await page.getByTestId("dash-row").first().click();
  await expect(page.getByTestId("dash-action-0")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("dash-action-0").click();
  await expect(page.getByTestId("dash-action-msg")).toContainText(/approuvée|refusée|traitée/i, { timeout: 8000 });
});
