import { test, expect, type Page } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 10 — BOOTSTRAP D'AUTHENTIFICATION FIABLE sur toutes les surfaces staff (/staff, /ops, /dashboard).
// Socle : AuthProvider partagé + client singleton + restauration via onAuthStateChange. On prouve :
// chargement direct, refresh, lien profond, expiration, déconnexion, rôle non autorisé, sans flash login.

// Connexion via la carte de login du socle (auth-*), sur une route gardée. La session (client singleton,
// storageKey partagé) est alors valide pour /staff, /ops et /dashboard.
async function loginProvider(page: Page, who: keyof typeof LAB_USERS, landing = "/staff") {
  const { user, pass } = LAB_USERS[who];
  await page.goto(landing, { waitUntil: "networkidle" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
}

test("auth : login → accès DIRECT /staff, /ops, /dashboard (direction), sans flash", async ({ page }) => {
  await loginProvider(page, "admin", "/dashboard");
  // Après login sur /dashboard (direction) : contenu authentifié, jamais l'écran de login.
  await expect(page.getByTestId("dashboard-surface")).toBeVisible({ timeout: 15000 });
  await expect(page.getByTestId("auth-login")).toHaveCount(0);

  // Accès DIRECT à /ops (session partagée) → authentifié immédiatement.
  await page.goto("/ops", { waitUntil: "networkidle" });
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 10000 });

  // Accès DIRECT à /staff → authentifié.
  await page.goto("/staff", { waitUntil: "networkidle" });
  await expect(page.getByTestId("staff-space")).toBeVisible({ timeout: 10000 });
});

test("auth : REFRESH préserve la session sur /ops (pas de retour login)", async ({ page }) => {
  await loginProvider(page, "admin", "/ops");
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
  await page.reload({ waitUntil: "networkidle" });
  // Après refresh : toujours authentifié, aucun flash de login.
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("auth-login")).toHaveCount(0);
});

test("auth : rôle NON autorisé (serveur) sur /dashboard → refus + redirection", async ({ page }) => {
  await loginProvider(page, "server", "/staff");
  await expect(page.getByTestId("staff-space")).toBeVisible({ timeout: 15000 });
  // /ops autorisé au serveur.
  await page.goto("/ops", { waitUntil: "networkidle" });
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 10000 });
  // /dashboard INTERDIT au serveur → écran de refus (garde de rôle).
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByTestId("auth-forbidden")).toBeVisible({ timeout: 10000 });
  // Redirection vers l'espace du rôle.
  await page.getByTestId("auth-goto-home").click();
  await expect(page.getByTestId("staff-space")).toBeVisible({ timeout: 10000 });
});

test("auth : DÉCONNEXION → login ; session absente sur lien profond → login (pas de crash)", async ({ page }) => {
  await loginProvider(page, "admin", "/dashboard");
  await expect(page.getByTestId("dashboard-surface")).toBeVisible({ timeout: 15000 });
  // Déconnexion → écran de login.
  await page.getByTestId("dash-logout").click();
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 10000 });
  // Session effacée (expiration simulée) + lien profond direct → login, jamais de contenu authentifié fuité.
  await page.evaluate(() => localStorage.clear());
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("dashboard-surface")).toHaveCount(0);
});
