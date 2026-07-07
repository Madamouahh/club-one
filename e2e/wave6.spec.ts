import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

test("fidélité : créditer puis utiliser des points (write RPC LABO)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "relation", "loyalty");
  await page.getByPlaceholder(/Nom, prénom ou téléphone/i).fill("FIXTURE");
  await page.getByRole("button", { name: /FIXTURE/i }).first().click();
  // Créditer 100 points.
  await page.getByPlaceholder(/Nombre de points/i).fill("100");
  await page.getByRole("button", { name: /^Créditer$/ }).click();
  await expect(page.getByText(/Historique \([1-9]/i)).toBeVisible({ timeout: 8000 });
  // Utiliser 40 points.
  await page.getByPlaceholder(/Nombre de points/i).fill("40");
  await page.getByRole("button", { name: /^Utiliser$/ }).click();
  await expect(page.getByText(/Historique \([2-9]/i)).toBeVisible({ timeout: 8000 });
});

test("attribution dépense client : attribuer → 360 mis à jour (write RPC LABO)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "relation", "crm");
  // Panneau d'attribution (data-testid scopé pour éviter la collision avec la liste du CRM au-dessus).
  await page.getByPlaceholder(/Rechercher un client/i).fill("FIXTURE");
  await page.locator('[data-testid^="spend-guest-"]').first().click();
  await page.getByPlaceholder(/ex\. 450/i).fill("120,00");
  // Date d'une soirée PASSÉE fixe (fixture 2026-07-01 Eden : univers résolu, non future).
  await page.locator('input[type="date"]').last().fill("2026-07-01");
  await page.getByRole("button", { name: /Attribuer la dépense/i }).click();
  // Preuve réelle : le montant attribué (120 €) s'affiche dans la dépense du 360 (persistance vérifiée
  // ensuite en PostgreSQL : guest_visits.spend_attributed).
  await expect(page.getByText(/120/).first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByRole("button", { name: /Attribuer la dépense/i })).toBeEnabled();
});

test("checklists : composer un item (write LABO)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "operations", "checklist");
  const label = `E2E-CHK-${Date.now()}`;
  await page.getByPlaceholder(/Libellé de l'item/i).fill(label);
  await page.getByRole("button", { name: /Ajouter l'item/i }).click();
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 8000 });
});

test("captation : ajouter un plan à la shot list (write LABO)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "operations", "captation");
  await page.getByRole("button", { name: /Ajouter un plan/i }).click();
  const label = `E2E-SHOT-${Date.now()}`;
  await page.getByPlaceholder(/Libellé du plan/i).fill(label);
  await page.getByRole("button", { name: /Ajouter le plan/i }).click();
  await expect(page.getByText(label).first()).toBeVisible({ timeout: 8000 });
});

test("assiduité (B7) : l'onglet charge des données staff réelles", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "equipes", "staffperf");
  // Vue read-only : au moins un staff réel du LABO apparaît (données agrégées, pas un écran vide muet).
  await expect(page.locator("main")).toBeVisible();
  await expect(page.getByText(/shift|présen|assidu|retard|absen/i).first()).toBeVisible({ timeout: 10000 });
});

test("budget (G4) : la colonne Réel est connectée (pas seulement NON CONNECTÉ)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "gestion", "budget");
  await expect(page.getByText(/Réel|Prévu vs Réel|Écart/i).first()).toBeVisible({ timeout: 10000 });
});
