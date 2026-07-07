import { test, expect, type Page } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 13 — Phase 2 : /dashboard densifié. Chaque section monte un VRAI module (sous-nav + liste + filtre
// + détail + action réelle + états), plus de KPI-only. Preuves DESKTOP (dashboard = poste de travail).

async function loginDash(page: Page) {
  const { user, pass } = LAB_USERS.admin;
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("dash-sidebar")).toBeVisible({ timeout: 15000 });
}

test("dashboard : chaque section ouvre un vrai module (liste + détail), zéro nav monolithe", async ({ page }, ti) => {
  test.skip(ti.project.name === "mobile", "dashboard = surface desktop");
  await loginDash(page);
  await expect(page.locator('[data-testid^="navgroup-"]')).toHaveCount(0);
  for (const sec of ["relation", "crm", "personnel", "soirees", "gestion", "marketing", "admin"]) {
    await page.getByTestId(`dash-section-${sec}`).click();
    await expect(page.getByTestId(`dash-${sec}`)).toBeVisible({ timeout: 8000 });
    await expect(page.getByTestId("dash-listdetail")).toBeVisible();
    // Un vrai module (liste OU vide honnête), jamais un simple compteur.
    await expect(page.getByTestId("dash-list").or(page.getByTestId("dash-empty")).or(page.getByTestId("dash-loading"))).toBeVisible({ timeout: 8000 });
  }
});

test("dashboard Relation client : décider une demande de réservation (action réelle)", async ({ page }, ti) => {
  test.skip(ti.project.name === "mobile", "dashboard = surface desktop");
  await loginDash(page);
  await page.getByTestId("dash-section-relation").click();
  await page.getByTestId("dash-submod-resas").click();
  await expect(page.getByTestId("dash-row").first()).toBeVisible({ timeout: 10000 });
  await page.getByTestId("dash-row").first().click();
  await expect(page.getByTestId("dash-action-0")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("dash-action-0").click(); // Accepter
  await expect(page.getByTestId("dash-action-msg")).toContainText(/approuvée|refusée|traitée/i, { timeout: 8000 });
});

test("dashboard CRM : fiche 360 + ajouter une note (action réelle)", async ({ page }, ti) => {
  test.skip(ti.project.name === "mobile", "dashboard = surface desktop");
  await loginDash(page);
  await page.getByTestId("dash-section-crm").click();
  await page.getByTestId("dash-filter").fill("E2E");
  await expect(page.getByTestId("dash-row").first()).toBeVisible({ timeout: 10000 });
  await page.getByTestId("dash-row").first().click();
  await expect(page.getByTestId("dash-action-0")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("dash-action-0").click(); // Ajouter une note
  await expect(page.getByTestId("dash-action-msg")).toContainText(/note ajoutée/i, { timeout: 8000 });
});

test("dashboard Personnel : publier un créneau brouillon (action réelle)", async ({ page }, ti) => {
  test.skip(ti.project.name === "mobile", "dashboard = surface desktop");
  await loginDash(page);
  await page.getByTestId("dash-section-personnel").click();
  await page.getByTestId("dash-submod-planning").click();
  await expect(page.getByTestId("dash-row").first()).toBeVisible({ timeout: 10000 });
  await page.getByTestId("dash-row").first().click(); // 1re ligne = date la + lointaine = le brouillon
  await expect(page.getByTestId("dash-action-0")).toBeVisible({ timeout: 8000 });
  await page.getByTestId("dash-action-0").click(); // Publier
  await expect(page.getByTestId("dash-action-msg")).toContainText(/publié|notifié/i, { timeout: 8000 });
});
