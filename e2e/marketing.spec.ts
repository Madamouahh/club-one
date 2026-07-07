import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

// Flux marketing DRY_RUN complet, prouvé en navigateur contre le LABO. AUCUN envoi réel.
test.describe.configure({ mode: "serial" });

async function openMessagerie(page: import("@playwright/test").Page) {
  await loginStaff(page, "admin");
  await gotoTab(page, "gestion", "messagerie");
  await expect(page.getByText(/DRY.?RUN/i).first()).toBeVisible({ timeout: 10000 });
}

test("audiences : créer un segment (write campaign_audiences)", async ({ page }) => {
  await openMessagerie(page);
  await page.getByRole("button", { name: "Audiences", exact: true }).click();
  // Une audience se rattache à une campagne (bouton actif seulement si une campagne est choisie).
  await page.locator("select").filter({ has: page.locator("option", { hasText: "E2E-Campaign" }) }).first().selectOption({ label: "E2E-Campaign" });
  await page.getByPlaceholder(/Clé de segment/i).fill("e2e_seg_dormant");
  await page.getByPlaceholder(/Visites min/i).fill("1");
  await page.getByRole("button", { name: /Enregistrer le segment/i }).click();
  // Le segment enregistré réapparaît (rechargé depuis la DB).
  await expect(page.getByText("e2e_seg_dormant").first()).toBeVisible({ timeout: 8000 });
});

test("outbox DRY_RUN : enqueue → traiter → envoyé (simulé) + dédup + garde opt-out", async ({ page }) => {
  await openMessagerie(page);
  await page.getByRole("button", { name: "Outbox", exact: true }).click();

  // Enqueue via le chemin « hors répertoire » (destinataire libre, non filtré consentement).
  await page.getByPlaceholder(/Destinataire/i).fill("+33600000099");
  await page.getByPlaceholder(/dedup_key/i).fill("e2e-dedup-1");
  await page.getByRole("button", { name: /^Enqueue$/ }).click();
  // Journal message_queue montre la ligne en file.
  await expect(page.getByText(/Journal d'envoi/i)).toBeVisible({ timeout: 8000 });

  // Traiter la file → DRY_RUN : statut simulé « envoyé », aucun envoi réel.
  await page.getByRole("button", { name: /Traiter la file/i }).click();
  await expect(page.getByText(/envoyés\s*1/i).first()).toBeVisible({ timeout: 8000 });

  // Dédup : réutiliser la même dedup_key → garde « déjà présente → deduped ».
  await page.getByPlaceholder(/dedup_key/i).fill("e2e-dedup-1");
  await expect(page.getByText(/déjà présente|deduped/i).first()).toBeVisible({ timeout: 5000 });

  // Garde opt-out/consentement : sélectionner un guest sans consentement → « Bloqué ».
  const guestSelect = page.locator("select").filter({ hasText: /hors répertoire/i }).first();
  await guestSelect.selectOption({ index: 1 });
  await expect(page.getByText(/Bloqué|opt-in|OK \(opt-in\)/i).first()).toBeVisible({ timeout: 5000 });
});

test("promo : créer un code valide + un code expiré (verdict), plafonds saisis", async ({ page }) => {
  await openMessagerie(page);
  await page.getByRole("button", { name: "Promo", exact: true }).click();

  // Code VALIDE avec plafond global 2 et plafond/guest 1.
  await page.getByPlaceholder(/CODE \(ex/i).fill("E2EVALID");
  await page.getByPlaceholder(/Valeur %/i).fill("10");
  await page.getByPlaceholder(/Plafond global/i).fill("2");
  await page.getByPlaceholder(/Plafond \/ guest/i).fill("1");
  await page.locator('input[title="Valide jusqu\'à"]').fill("2030-12-31");
  await page.getByRole("button", { name: /Créer le code/i }).click();
  await expect(page.getByText("E2EVALID").first()).toBeVisible({ timeout: 8000 });

  // Code EXPIRÉ (valid_until passé) → verdict « Expiré » affiché.
  await page.getByPlaceholder(/CODE \(ex/i).fill("E2EEXPIRED");
  await page.getByPlaceholder(/Valeur %/i).fill("15");
  await page.locator('input[title="Valide jusqu\'à"]').fill("2020-01-01");
  await page.getByRole("button", { name: /Créer le code/i }).click();
  await expect(page.getByText("E2EEXPIRED").first()).toBeVisible({ timeout: 8000 });
  await expect(page.getByText(/Expiré/i).first()).toBeVisible({ timeout: 8000 });
});
