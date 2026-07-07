import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

test.describe.configure({ mode: "serial" });

test("boards : Leads se charge (saisie direction, aucune donnée fictive)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "relation", "leads");
  await expect(page.getByPlaceholder(/Dépense pub/i).first()).toBeVisible({ timeout: 10000 });
});

test("boards : Réputation se charge (connecteur externe NON ACTIVÉ)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "relation", "reputation");
  await expect(page.getByText(/NON ACTIVÉ/i).first()).toBeVisible({ timeout: 10000 });
});

test("boards : Inbox — création réelle d'une demande (write LABO)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "relation", "inbox");
  const subject = `E2E-${Date.now()}`;
  await page.getByPlaceholder(/Sujet/i).fill(subject);
  await page.getByPlaceholder(/Téléphone/i).first().fill("+33600000099");
  // Bouton d'enregistrement de la demande (create).
  await page.getByRole("button", { name: /Enregistrer|Créer|Ajouter/i }).first().click();
  // La demande créée réapparaît (rechargée depuis la DB LABO).
  await expect(page.getByText(subject, { exact: false }).first()).toBeVisible({ timeout: 10000 });
});
