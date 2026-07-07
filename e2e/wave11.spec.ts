import { test, expect, type Page } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 11 — /ops et /dashboard en SURFACES AUTONOMES (socle Auth), modules existants montés par
// composition. Preuve : navigation dédiée + modules réels affichés. Aucune nav monolithe.

async function login(page: Page, who: keyof typeof LAB_USERS, landing: string) {
  const { user, pass } = LAB_USERS[who];
  await page.goto(landing, { waitUntil: "networkidle" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
}

test("/ops autonome : bottom-nav ≤5 + Mode Soirée, Tables, Réservations, Équipe, Plus (modules réels)", async ({ page }) => {
  await login(page, "manager", "/ops");
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });

  // Navigation principale ≤ 5, aucune nav monolithe.
  expect(await page.locator('[data-testid^="ops-nav-"]').count()).toBeLessThanOrEqual(5);
  await expect(page.locator('[data-testid^="navgroup-"]')).toHaveCount(0);

  // Soirée : cockpit d'exploitation réel monté.
  await expect(page.getByTestId("ops-soiree")).toBeVisible();

  // Tables : plan réel (venue_tables).
  await page.getByTestId("ops-nav-tables").click();
  await expect(page.getByTestId("ops-tables")).toBeVisible({ timeout: 8000 });

  // Réservations : file du soir (module réel).
  await page.getByTestId("ops-nav-resas").click();
  await expect(page.getByTestId("ops-resas")).toBeVisible({ timeout: 8000 });

  // Équipe : présence du jour (staff_shifts réel).
  await page.getByTestId("ops-nav-equipe").click();
  await expect(page.getByTestId("ops-equipe")).toBeVisible({ timeout: 8000 });

  // Plus : incidents en cours (module réel).
  await page.getByTestId("ops-nav-plus").click();
  await expect(page.getByTestId("ops-plus")).toBeVisible({ timeout: 8000 });
});

test("/dashboard autonome : sidebar 8 sections + Command Center 20/20 + sections KPI réelles, zéro bottom-nav", async ({ page }) => {
  await login(page, "admin", "/dashboard");
  await expect(page.getByTestId("dash-sidebar")).toBeVisible({ timeout: 15000 });

  // Sidebar persistante à 8 sections ; jamais de bottom-nav sur desktop.
  expect(await page.locator('[data-testid^="dash-section-"]').count()).toBe(8);
  await expect(page.locator('[data-testid^="ops-nav-"]')).toHaveCount(0);
  await expect(page.locator('[data-testid^="navgroup-"]')).toHaveCount(0);

  // Direction : Command Center RÉEL, 20/20 domaines branchés.
  await page.getByTestId("dash-section-direction").click();
  await expect(page.getByTestId("command-center")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("cc-coverage")).toHaveText(/20\s*\/\s*20/, { timeout: 12000 });

  // Personnel : résumé réel (KPIs comptés).
  await page.getByTestId("dash-section-personnel").click();
  await expect(page.getByTestId("dash-personnel")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("dash-kpi").first()).toBeVisible({ timeout: 8000 });

  // CRM : résumé réel.
  await page.getByTestId("dash-section-crm").click();
  await expect(page.getByTestId("dash-crm")).toBeVisible({ timeout: 8000 });
  await expect(page.getByTestId("dash-kpi").first()).toBeVisible({ timeout: 8000 });
});
