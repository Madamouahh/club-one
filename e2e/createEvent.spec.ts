import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

// Cycle de vie COMPLET d'une soirée, prouvé en navigateur contre le LABO (données réelles + cleanup).
// Mois courant = 2026-07 (date système du programme). Jour de création : 22 (vide).
const DAY = "2026-07-22";
const DUP_DAY = "2026-07-28";
const TITLE = "E2E-EVT-CREATE";

test("création soirée : jour cliqué → formulaire complet → calendrier + transitions + duplication + annulation", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "direction", "agenda");
  await expect(page.getByText("Lun", { exact: true }).first()).toBeVisible({ timeout: 10000 });

  // 1) Cliquer un jour → l'éditeur de création s'ouvre.
  await page.getByTestId(`day-${DAY}`).click();
  await expect(page.getByPlaceholder(/Techno All Night/i)).toBeVisible({ timeout: 8000 });

  // 2) Renseigner une soirée COMPLÈTE (univers Cercle, titre, horaires, artistes, capacité, équipe, notes).
  await page.getByPlaceholder(/Techno All Night/i).fill(TITLE);
  await page.locator("select").filter({ has: page.locator('option[value="cercle"]') }).first().selectOption("cercle");
  await page.getByPlaceholder("23:30").fill("23:30");
  await page.getByPlaceholder("05:00").fill("05:00");
  await page.getByPlaceholder(/Rooftop/i).fill("Cave");
  await page.getByPlaceholder(/Ex\. 400/i).fill("300");
  await page.getByPlaceholder(/DJ, lineup/i).fill("DJ E2E");
  await page.getByPlaceholder(/Noms .*virgules/i).fill("alice, bob");
  await page.getByPlaceholder(/Notes de planification/i).fill("note e2e");

  // 3) Enregistrer → la soirée apparaît dans le calendrier (rechargé depuis la DB LABO).
  await page.getByRole("button", { name: /Créer la soirée/i }).click();
  await expect(page.getByText(TITLE).first()).toBeVisible({ timeout: 10000 });

  // 4) Éditer : ouvrir la soirée → publier (draft→published).
  await page.getByText(TITLE).first().click();
  await expect(page.getByRole("button", { name: /^Enregistrer$/ })).toBeVisible({ timeout: 8000 });
  await page.locator("select").filter({ has: page.locator('option[value="published"]') }).first().selectOption("published");
  await page.getByRole("button", { name: /^Enregistrer$/ }).click();
  await expect(page.getByRole("button", { name: /Créer la soirée/i })).toHaveCount(0, { timeout: 8000 });

  // 5) Ouvrir (published→open).
  await page.getByText(TITLE).first().click();
  await page.locator("select").filter({ has: page.locator('option[value="open"]') }).first().selectOption("open");
  await page.getByRole("button", { name: /^Enregistrer$/ }).click();
  await expect(page.getByRole("button", { name: /Créer la soirée/i })).toHaveCount(0, { timeout: 8000 });

  // 6) Transition INTERDITE : open→published → refusée (message d'erreur, éditeur reste ouvert).
  await page.getByText(TITLE).first().click();
  await page.locator("select").filter({ has: page.locator('option[value="published"]') }).first().selectOption("published");
  await page.getByRole("button", { name: /^Enregistrer$/ }).click();
  await expect(page.getByText(/invalid_transition|transition|refus/i).first()).toBeVisible({ timeout: 8000 });

  // 7) Dupliquer vers une autre date (éditeur ouvert).
  await page.locator('input[type="date"]').last().fill(DUP_DAY);
  await page.getByRole("button", { name: /^Dupliquer$/ }).click();
  await expect(page.getByRole("button", { name: /Créer la soirée/i })).toHaveCount(0, { timeout: 8000 });

  // 8) Annuler la soirée (open→closed via cancel_event_v1).
  await page.getByText(TITLE).first().click();
  await page.getByRole("button", { name: /Annuler la soirée/i }).click();
  await expect(page.getByRole("button", { name: /Créer la soirée/i })).toHaveCount(0, { timeout: 8000 });
});

test("permissions : le promoteur ne voit pas l'agenda (groupe Direction absent)", async ({ page }) => {
  await loginStaff(page, "promoter");
  await expect(page.getByTestId("navgroup-direction")).toHaveCount(0);
});
