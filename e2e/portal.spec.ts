import { test, expect } from "@playwright/test";

const TOKEN = "11111111-1111-1111-1111-111111111111"; // fixture guest (labo_e2e_setup)
const PIN = "1234";

test.describe.configure({ mode: "serial" });

test("portail : ouverture token valide + agenda mensuel + filtre salle + préférences", async ({ page }) => {
  await page.goto(`/espace/${TOKEN}`, { waitUntil: "networkidle" });

  // Token valide → pas d'écran expiré/introuvable ; l'agenda public s'affiche.
  await expect(page.getByText(/Lien expiré|Espace introuvable/i)).toHaveCount(0);
  await expect(page.getByRole("heading", { name: /Agenda des soirées/i })).toBeVisible({ timeout: 10000 });

  // Une soirée publiée de fixture est visible (agenda mensuel, mois courant).
  await expect(page.getByText(/E2E-FIXTURE/).first()).toBeVisible({ timeout: 8000 });

  // Filtre salle : cliquer « Cercle » → l'événement Cercle reste, événement détail cliquable.
  await page.getByRole("button", { name: /Cercle/i }).first().click();
  await expect(page.getByText(/E2E-FIXTURE Cercle/i).first()).toBeVisible({ timeout: 8000 });

  // Préférences self-service : renseigner l'ambiance musicale → enregistrer.
  await page.getByPlaceholder(/house, hip-hop/i).fill("house");
  await page.getByPlaceholder(/près du DJ/i).fill("près du DJ");
  await page.getByRole("button", { name: /Enregistrer.*préférences|Enregistrer mes préférences|Enregistrer/i }).first().click();
  await expect(page.getByText(/Préférences enregistrées/i)).toBeVisible({ timeout: 8000 });
});

test("portail : récupération d'accès SANS email (téléphone + PIN → nouveau lien)", async ({ page }) => {
  // Écran d'un lien inconnu → formulaire « Récupérer mon accès » (aucune auth permanente par token).
  await page.goto("/espace/00000000-0000-0000-0000-000000000001", { waitUntil: "networkidle" });
  // Le formulaire de récupération est replié derrière un bouton — le déplier d'abord.
  await page.getByRole("button", { name: /perdu mon lien/i }).first().click();
  await page.getByPlaceholder(/Téléphone/i).first().fill("+33600000061");
  await page.getByPlaceholder(/Code à 4/i).first().fill(PIN);
  await page.getByRole("button", { name: /Récupérer mon accès/i }).first().click();
  // Récupération réussie → un ESPACE réel se charge (nouveau lien émis, pas l'écran d'erreur).
  await expect(page.getByRole("heading", { name: /Mes préférences|Agenda des soirées/i }).first()).toBeVisible({ timeout: 12000 });
});

test("portail : token inconnu → aucune donnée, pas de fuite", async ({ page }) => {
  await page.goto("/espace/00000000-0000-0000-0000-000000000000", { waitUntil: "networkidle" });
  await expect(page.getByText(/Connexion staff/i)).toHaveCount(0);
  await expect(page.getByText(/E2E-FIXTURE|Mes passages/i)).toHaveCount(0);
});
