import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

// Vague 8 — espace personnel salarié /staff + workflow RH, prouvés en NAVIGATEUR contre le LABO.
// Écritures réelles (RPC 0072 sous RLS). Fixtures : membre 'server' + shift publié + shift du jour
// confirmé (en service) + notification critique (arrivée anticipée). Voir scripts/labo_e2e_setup.sh §3d.

// —————————————————————————————————————————————————————————————————
// SALARIÉ (mobile) : planning, confirmation, notification critique à action, handoff /staff → /ops.
// —————————————————————————————————————————————————————————————————
test("V8 /staff salarié : planning + confirmation + notif critique + handoff mode soirée", async ({ page }) => {
  await loginStaff(page, "server");
  await page.goto("/staff", { waitUntil: "networkidle" });
  await expect(page.getByTestId("staff-space")).toBeVisible({ timeout: 15000 });

  // AUJOURD'HUI : un créneau + bouton MODE SOIRÉE (salarié « en service » = shift du jour confirmé).
  await expect(page.getByTestId("staff-today-shift")).toBeVisible();
  await expect(page.getByTestId("staff-open-ops")).toBeVisible();

  // PLANNING : le créneau à venir 'planifié' est confirmable → confirmer (write confirm_my_shift_v1).
  await page.getByTestId("staff-nav-planning").click();
  await expect(page.getByTestId("staff-planning")).toBeVisible();
  const confirmable = page.getByTestId("staff-shift-confirm").first();
  await expect(confirmable).toBeVisible({ timeout: 8000 });
  await confirmable.click();
  await expect(page.getByText(/1 à confirmer/i)).toHaveCount(0, { timeout: 8000 });

  // NOTIFICATIONS : notif CRITIQUE à action → ACCEPTER (write respond_staff_notification_v1).
  await page.getByTestId("staff-nav-notifs").click();
  await expect(page.getByTestId("staff-notif-row").first()).toBeVisible();
  await page.getByTestId("staff-notif-accept").first().click();
  await expect(page.getByText(/Confirmée/i).first()).toBeVisible({ timeout: 8000 });

  // HANDOFF /staff → /ops : le bouton ouvre le monolithe sur l'onglet Mode Soirée.
  await page.getByTestId("staff-nav-today").click();
  await page.getByTestId("staff-open-ops").click();
  await expect(page.getByTestId("modesoiree")).toBeVisible({ timeout: 15000 });
});

// —————————————————————————————————————————————————————————————————
// MANAGER (desktop) : créer un créneau brouillon → publier (notifie le salarié) → arrivée anticipée.
// —————————————————————————————————————————————————————————————————
test("V8 manager desktop : brouillon → publication → arrivée anticipée (write RPC 0072)", async ({ page }) => {
  await loginStaff(page, "manager");
  await gotoTab(page, "equipes", "rh");
  await expect(page.getByTestId("mgr-shift-panel")).toBeVisible();

  // Créer un créneau BROUILLON pour 'Serveur Test' à une date UNIQUE par run (les 2 projets partagent
  // le même LABO ; l'unicité (membre, date) interdirait un doublon). Fenêtre 2027, jour dérivé de l'horloge.
  const dd = new Date(2027, 0, 1 + (Date.now() % 300));
  const uniqueDate = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}-${String(dd.getDate()).padStart(2, "0")}`;
  await page.getByTestId("mgr-member-select").selectOption({ label: "Serveur Test" });
  await page.getByTestId("mgr-date-input").fill(uniqueDate);
  await page.getByTestId("mgr-poste-input").fill("Runner");
  await page.getByTestId("mgr-create-btn").click();
  await expect(page.getByTestId("mgr-feedback")).toContainText(/brouillon/i, { timeout: 8000 });

  // PUBLIER le brouillon (1re ligne = date la plus récente = 2026-12-30) → salarié notifié.
  await page.getByTestId("mgr-publish-btn").first().click();
  await expect(page.getByTestId("mgr-feedback")).toContainText(/publié|notifié/i, { timeout: 8000 });

  // ARRIVÉE ANTICIPÉE sur ce créneau publié (versioning + notif critique côté salarié).
  await page.getByTestId("mgr-early-time").first().fill("21:30");
  await page.getByTestId("mgr-early-reason").first().fill("briefing");
  await page.getByTestId("mgr-early-btn").first().click();
  await expect(page.getByTestId("mgr-feedback")).toContainText(/anticipée|notifié|salarié/i, { timeout: 8000 });
});
