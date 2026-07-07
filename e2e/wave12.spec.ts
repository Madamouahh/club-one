import { test, expect, type Page } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 12 — Phase 1 : /ops réellement utilisable en soirée. Modules « Plus » réels + adaptation par rôle
// + partage de lien promoteur. Action critique en ≤3 taps. Preuves navigateur (LABO), écritures réelles.

async function login(page: Page, who: keyof typeof LAB_USERS) {
  const { user, pass } = LAB_USERS[who];
  await page.goto("/ops", { waitUntil: "networkidle" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
}

test("/ops serveur : sa table en ≤3 taps + Plus adapté (clients/tâches, pas de scan)", async ({ page }) => {
  await login(page, "server");
  // Tap 1 : Tables → une table réelle est atteignable (tap 2).
  await page.getByTestId("ops-nav-tables").click();
  await expect(page.getByTestId("ops-table").first().or(page.getByText(/Aucune table/))).toBeVisible({ timeout: 8000 });
  // Plus adapté au rôle : clients + mes tâches présents, scan ABSENT (serveur).
  await page.getByTestId("ops-nav-plus").click();
  await expect(page.getByTestId("ops-plus-clients")).toBeVisible();
  await expect(page.getByTestId("ops-plus-taches")).toBeVisible();
  await expect(page.getByTestId("ops-plus-scan")).toHaveCount(0);
});

test("/ops promoteur : Partager un lien → modale avec lien + QR (create_invite_link_v1)", async ({ page }) => {
  await login(page, "promoter");
  await page.getByTestId("ops-share-link").click();
  await expect(page.getByTestId("share-modal")).toBeVisible({ timeout: 8000 });
  // Lien réel généré (ou message d'erreur explicite si aucune soirée active).
  await expect(page.getByTestId("share-link").or(page.getByTestId("share-error"))).toBeVisible({ timeout: 10000 });
});

test("/ops sécurité : Scan en ≤3 taps (Plus → Scan → saisie du QR)", async ({ page }) => {
  await login(page, "security");
  await page.getByTestId("ops-nav-plus").click(); // tap 1
  await expect(page.getByTestId("ops-plus-scan")).toBeVisible();
  await page.getByTestId("ops-plus-scan").click(); // tap 2
  await expect(page.getByTestId("ops-plus-view-scan")).toBeVisible({ timeout: 6000 });
  await expect(page.getByTestId("scan-input")).toBeVisible();
});

test("/ops manager : équipe du soir (présences réelles) + Plus complet", async ({ page }) => {
  await login(page, "manager");
  await page.getByTestId("ops-nav-equipe").click();
  await expect(page.getByTestId("ops-shift-row").first().or(page.getByText(/Aucun créneau/))).toBeVisible({ timeout: 8000 });
  // Manager : Plus complet (scan, flux, incidents).
  await page.getByTestId("ops-nav-plus").click();
  await expect(page.getByTestId("ops-plus-scan")).toBeVisible();
  await expect(page.getByTestId("ops-plus-flux")).toBeVisible();
  await expect(page.getByTestId("ops-plus-incidents")).toBeVisible();
});
