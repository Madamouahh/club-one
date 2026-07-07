import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

test.describe("Club One — parcours LABO (browser-proven)", () => {
  test("tâches : création réelle → apparaît dans le kanban (write LABO)", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "operations", "tasks");
    const title = `E2E-${Date.now()}`;
    await page.getByPlaceholder(/Titre/i).fill(title);
    await page.getByRole("button", { name: /Créer la tâche/i }).click();
    await expect(page.getByText(title, { exact: false })).toBeVisible({ timeout: 10000 });
  });

  test("agenda : grille mensuelle + navigation mois", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "direction", "agenda");
    await expect(page.getByText("Lun", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    const label = page.locator("text=/\\b(janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|novembre|décembre)\\b/i").first();
    const before = await label.textContent();
    await page.getByRole("button", { name: "Mois suivant" }).click();
    await expect(label).not.toHaveText(before ?? "", { timeout: 5000 });
  });

  test("marketing : onglet Messagerie affiche la bannière DRY_RUN", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "gestion", "messagerie");
    await expect(page.getByText(/DRY.?RUN/i).first()).toBeVisible({ timeout: 10000 });
  });

  test("attribution serveur : l'onglet Serveurs se charge (direction)", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "gestion", "serverattribution");
    await expect(page.locator("main")).toBeVisible();
  });

  test("CRM : l'onglet CRM se charge (fiche 360 direction)", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "relation", "crm");
    await expect(page.locator("main")).toBeVisible();
  });

  test("permissions : le promoteur ne voit ni Gestion ni Direction", async ({ page }) => {
    await loginStaff(page, "promoter");
    await expect(page.getByTestId("navgroup-gestion")).toHaveCount(0);
    await expect(page.getByTestId("navgroup-direction")).toHaveCount(0);
  });

  test("portail client : token inconnu → pas de crash, pas de données staff", async ({ page }) => {
    await page.goto("/espace/00000000-0000-0000-0000-000000000000", { waitUntil: "networkidle" });
    await expect(page.locator("body")).toBeVisible();
    await expect(page.getByText(/Connexion staff/i)).toHaveCount(0);
  });
});
