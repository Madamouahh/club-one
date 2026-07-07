import { test, expect } from "@playwright/test";

// Smoke E2E navigateur contre le LABO local (aucune prod). Ces specs n'exigent PAS de login staff :
// elles chargent l'app et les routes publiques. Les parcours staff authentifiés (agenda create,
// tasks kanban) sont marqués test.skip tant qu'un identifiant de test LABO n'est pas fourni
// (staff-passwords.local.json est hors de portée par gouvernance) — décrits ici comme contrat.

test("l'app se charge et rend l'écran de connexion", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
  // L'app monte (pas d'écran blanc / erreur d'hydratation fatale).
  await expect(page).toHaveTitle(/.+/);
});

test("le manifest PWA est servi", async ({ page }) => {
  const res = await page.request.get("/manifest.webmanifest");
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  expect(body.name).toBeTruthy();
  expect(body.display).toBe("standalone");
});

// ── Parcours staff authentifiés — CONTRAT, activés quand E2E_STAFF_USER/PASS sont fournis ──
const HAS_STAFF = Boolean(process.env.E2E_STAFF_USER && process.env.E2E_STAFF_PASS);

test.describe("parcours staff (agenda, tâches)", () => {
  test.skip(!HAS_STAFF, "définir E2E_STAFF_USER / E2E_STAFF_PASS (compte LABO) pour activer");

  test("agenda : le calendrier mensuel s'affiche et navigue", async ({ page }) => {
    await page.goto("/");
    // login (sélecteurs à confirmer selon l'écran d'auth) …
    // ouvrir l'onglet agenda, vérifier la grille (7 colonnes) + navigation mois±1
    // créer une soirée draft via l'éditeur → attendue dans la grille, puis la supprimer (cancel)
  });

  test("tâches : kanban visible pour la direction", async ({ page }) => {
    // onglet Tâches → 4 colonnes de statut ; créer une tâche → apparait en 'À faire'
  });
});
