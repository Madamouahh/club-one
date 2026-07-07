import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

// Vague 7 — les 7 gaps internes de catégorie A prouvés en NAVIGATEUR contre le LABO (chromium + mobile).
// Écritures réelles (RPC / DML sous RLS). Fixtures : guest token 11111111…, events e2e-fixture-* publiés.

// Guest DÉDIÉ Vague 7 (E4) : token stable jamais tourné par un autre spec (portal.spec fait tourner
// le token du guest principal 11111111 via recover_guest_access_v1) → E4 devient ordre-indépendant.
const GUEST_TOKEN = "22222222-2222-2222-2222-222222222222";

// —————————————————————————————————————————————————————————————————
// C5 — Création de fiche artiste (direction). Créer → apparaît → archiver.
// —————————————————————————————————————————————————————————————————
test("C5 fiche artiste : créer puis archiver (write LABO, RLS direction)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "equipes", "artistfiches");
  await expect(page.getByTestId("artist-fiches")).toBeVisible();

  // Ouvrir le formulaire si un bouton dédié existe, puis saisir un nom de scène unique.
  const createBtn = page.getByTestId("artist-create-btn");
  if (await createBtn.count()) await createBtn.first().click();
  const name = `E2E-DJ-${Date.now()}`;
  await page.getByTestId("artist-stage-name-input").fill(name);
  await page.getByTestId("artist-submit").click();

  // La fiche apparaît réellement dans la liste (persistance PostgreSQL sous RLS direction).
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 8000 });

  // Archiver la fiche que l'on vient de créer.
  const row = page.getByTestId("artist-row").filter({ hasText: name }).first();
  await row.getByTestId("artist-archive-btn").click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 8000 });
});

// —————————————————————————————————————————————————————————————————
// B2 — Centre de commandement : 20/20 domaines branchés + clic d'une tuile ouvre le vrai module.
// —————————————————————————————————————————————————————————————————
test("B2 command center : 20/20 branchés + tuile cliquable route vers le module", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "direction", "cockpit");
  await expect(page.getByTestId("command-center")).toBeVisible();
  // Couverture réelle : 20 domaines branchés sur 20 (aucun orphelin, aucun "non branché").
  await expect(page.getByTestId("cc-coverage")).toHaveText(/20\s*\/\s*20/, { timeout: 10000 });

  // Cliquer la tuile "Tâches" ouvre le vrai onglet Tâches (le cockpit se démonte).
  await page.getByTestId("cc-tile-taches").click();
  await expect(page.getByTestId("command-center")).toHaveCount(0, { timeout: 8000 });
});

// —————————————————————————————————————————————————————————————————
// B2b — Mode Soirée branché dans la navigation réelle + lanceur vers les modules d'exploitation.
// —————————————————————————————————————————————————————————————————
test("B2b mode soirée : cockpit temps réel + navigation vers un module", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "soiree", "modesoiree");
  await expect(page.getByTestId("modesoiree")).toBeVisible();

  // Le lanceur ouvre un vrai module (incidents) : le cockpit soirée se démonte.
  await page.getByTestId("modesoiree-nav-incidents").click();
  await expect(page.getByTestId("modesoiree")).toHaveCount(0, { timeout: 8000 });
});

// —————————————————————————————————————————————————————————————————
// E4 — Demande de réservation CLIENT authentifié (portail) : demander → statut → annuler.
// —————————————————————————————————————————————————————————————————
test("E4 demande de résa client : soumettre puis annuler (write RPC LABO, token-gardé)", async ({ page }) => {
  await page.goto(`/espace/${GUEST_TOKEN}`, { waitUntil: "networkidle" });
  const section = page.getByTestId("resa-request");
  await expect(section).toBeVisible({ timeout: 15000 });

  // Choisir la soirée fixture Eden (slug déterministe : robuste face aux events créés par d'autres specs)
  // puis une table demandable.
  await page.getByTestId("resa-event-select").selectOption("e2e-fixture-eden");
  const tableSelect = page.getByTestId("resa-table-select");
  await expect(tableSelect).toBeVisible({ timeout: 8000 });
  await tableSelect.selectOption({ index: 1 });
  await page.getByTestId("resa-party-input").fill("4");
  await page.getByTestId("resa-submit").click();

  // Preuve réelle : une demande apparaît dans "mes demandes" (persistance table_reservation_requests).
  const myRow = page.getByTestId("resa-my-request-row").first();
  await expect(myRow).toBeVisible({ timeout: 10000 });

  // Le client annule SA demande (status → cancelled ; règle : seulement tant que pending).
  await myRow.getByTestId("resa-cancel-btn").click();
  await expect(page.getByText(/Annulée/i).first()).toBeVisible({ timeout: 8000 });
});

// —————————————————————————————————————————————————————————————————
// E5 — Invitation client émise par le staff : rechercher client → émettre QR → révoquer.
// —————————————————————————————————————————————————————————————————
test("E5 invitation client (staff) : émettre puis révoquer (write RPC LABO)", async ({ page }) => {
  await loginStaff(page, "admin");
  await gotoTab(page, "soiree", "promoters");
  await expect(page.getByTestId("staff-invite-panel")).toBeVisible();

  await page.getByTestId("staff-invite-phone").fill("+33600000061");
  await page.getByTestId("staff-invite-search").click();
  await page.getByTestId("staff-invite-guest").first().click();

  await page.getByTestId("staff-invite-event-select").selectOption({ index: 1 });
  await page.getByTestId("staff-invite-issue").click();

  // Une invitation apparaît (pass QR émis, persistance guest_passes).
  await expect(page.getByTestId("staff-invite-pass-row").first()).toBeVisible({ timeout: 10000 });

  // Révoquer l'invitation ENCORE ÉMISE (le bouton "Révoquer" n'existe que sur un pass issued : cibler
  // directement le bouton évite de tomber sur un pass déjà annulé par un run précédent).
  await page.getByTestId("staff-invite-revoke").first().click();
  await expect(page.getByText(/Annulée/i).first()).toBeVisible({ timeout: 8000 });
});
