import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

// Parcours COMPLET attribution serveur, prouvé en navigateur contre le LABO (données réelles).
test("attribution serveur : créer → rapport live → doublon interdit → retirer", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "gestion", "serverattribution");

  // Le formulaire d'attribution est présent (soirée active + serveur au roster).
  await expect(page.getByText("Attribuer une table")).toBeVisible({ timeout: 10000 });

  const tableSelect = page.locator("select").first();
  const serverSelect = page.locator("select").nth(1);
  // Choisir la première vraie table (index 1 saute le placeholder) et le serveur 'server' (rôle réel).
  await tableSelect.selectOption({ index: 1 });
  await serverSelect.selectOption("server");
  await page.getByRole("button", { name: /^Attribuer$/ }).click();

  // Rapport par serveur affiche IMMÉDIATEMENT 'server' avec un décompte de tables (données live).
  const report = page.locator("div", { hasText: /^Rapport par serveur$/ }).locator("..");
  await expect(page.getByText("Aucune attribution pour le moment").first()).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator("li", { hasText: "server" }).filter({ hasText: /table/ }).first()).toBeVisible({ timeout: 8000 });

  // Doublon interdit : re-sélectionner la même table+serveur → bouton "Déjà attribué" (désactivé).
  await tableSelect.selectOption({ index: 1 });
  await serverSelect.selectOption("server");
  await expect(page.getByRole("button", { name: /Déjà attribué/ })).toBeVisible({ timeout: 5000 });

  // Retirer : la première table attribuée redevient non attribuée (nettoyage in-test).
  await page.getByRole("button", { name: /^Retirer$/ }).first().click();
  await expect(page.getByText("non attribué").first()).toBeVisible({ timeout: 8000 });
});
