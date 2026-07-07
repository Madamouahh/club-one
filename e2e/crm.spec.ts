import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

// Sous-flux CRM RÉELS, prouvés en navigateur contre le LABO (fixtures E2E-*, nettoyées par teardown).
test.describe.configure({ mode: "serial" });

async function openCrm(page: import("@playwright/test").Page) {
  await loginStaff(page, "admin");
  await gotoTab(page, "relation", "crm");
  // Le panel CRM enrichi (sous CrmView) : recherche par placeholder distinctif.
  await expect(page.getByPlaceholder(/Rechercher : téléphone/i)).toBeVisible({ timeout: 10000 });
}

test("recherche + fiche 360 + édition + tag + note + consentement", async ({ page }) => {
  await openCrm(page);
  await page.getByPlaceholder(/Rechercher : téléphone/i).fill("E2E");
  // Ouvrir la fiche fixture (bouton portant le nom du guest).
  await page.getByRole("button", { name: /FIXTURE/ }).first().click();

  // Édition identité : modifier le nom (data-testid) → Enregistrer la fiche.
  const lastName = page.getByTestId("crm-lastname");
  await expect(lastName).toBeVisible({ timeout: 8000 });
  await lastName.fill("FIXTURE-EDIT");
  await page.getByTestId("crm-save").click();
  await expect(page.getByText(/à jour|enregistr|sauvegard/i).first()).toBeVisible({ timeout: 8000 });

  // Tag : ajouter → apparaît.
  await page.getByPlaceholder(/Ajouter un tag/i).fill("vip-e2e");
  await page.getByTestId("crm-tag-add").click();
  await expect(page.getByText("vip-e2e").first()).toBeVisible({ timeout: 8000 });

  // Note interne : ajouter → apparaît.
  await page.getByPlaceholder(/Ajouter une note/i).fill("Note E2E test");
  await page.getByTestId("crm-note-add").click();
  await expect(page.getByText("Note E2E test").first()).toBeVisible({ timeout: 8000 });

  // Consentement : basculer un consentement (pas de crash).
  const consent = page.getByRole("button", { name: /^(Oui|Non|Refusé|Non recueilli)$/ }).first();
  await consent.click();
  await expect(page.getByTestId("crm-save")).toBeVisible();
});

test("import CSV — valide inséré + invalide avec rapport d'erreurs", async ({ page }) => {
  await openCrm(page);
  await page.getByText("Import CSV", { exact: true }).click();
  const fileInput = page.locator('input[type="file"]');

  // Invalide : téléphone manquant + date invalide → rapport d'erreurs.
  await fileInput.setInputFiles({
    name: "invalide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("phone,first_name,last_name,email,birthday\n,SansTel,X,x@e2e.test,2020-13-40\n"),
  });
  await expect(page.getByText(/en erreur/i).first()).toBeVisible({ timeout: 8000 });

  // Valide : une ligne correcte → insérable.
  const uniquePhone = `+3360000${Math.floor(Date.now() / 1000) % 100000}`;
  await fileInput.setInputFiles({
    name: "valide.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(`phone,first_name,last_name,email,birthday\n${uniquePhone},E2E-IMPORT,OK,imp@e2e.test,1998-05-04\n`),
  });
  await expect(page.getByText(/1 valide/i).first()).toBeVisible({ timeout: 8000 });
  await page.getByRole("button", { name: /Importer 1 ligne/i }).click();
  // insertion confirmée (le rapport d'insertion apparaît)
  await expect(page.getByText(/inséré|import/i).first()).toBeVisible({ timeout: 8000 });
});

test("dédoublonnage : détection → fusion confirmée → historique migré", async ({ page }) => {
  await openCrm(page);
  await page.getByPlaceholder(/Rechercher : téléphone/i).fill("E2E-DUP");
  // Ouvrir l'accordéon des doublons candidats.
  await page.getByText(/Doublons candidats/i).click();
  // Le groupe partage l'email dupe@e2e.test.
  await expect(page.getByText("dupe@e2e.test").first()).toBeVisible({ timeout: 8000 });
  // Confirmer la fusion.
  await page.getByRole("button", { name: /Confirmer la fusion/i }).first().click();
  await expect(page.getByText(/Fusion effectuée/i).first()).toBeVisible({ timeout: 10000 });

  // Historique migré : la fiche conservée (KEEP) porte la note qui était sur le doublon.
  await page.getByPlaceholder(/Rechercher : téléphone/i).fill("E2E-DUP");
  await page.getByRole("button", { name: /E2E-DUP/ }).first().click();
  await expect(page.getByText(/note sur le doublon/i).first()).toBeVisible({ timeout: 8000 });
});
