import { test, expect } from "@playwright/test";
import { loginStaff, gotoTab } from "./helpers";

test.describe("parcours staff LABO", () => {
  test("connexion admin + agenda : calendrier mensuel s'affiche", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "direction", "agenda");
    await expect(page.getByText("Lun", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Dim", { exact: true }).first()).toBeVisible();
  });

  test("connexion admin + tâches : kanban 4 statuts", async ({ page }) => {
    await loginStaff(page, "admin");
    await gotoTab(page, "operations", "tasks");
    await expect(page.getByText("À faire", { exact: false }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("En cours", { exact: false }).first()).toBeVisible();
  });

  test("permissions : le promoteur ne voit pas le groupe Ops (ni Tâches)", async ({ page }) => {
    await loginStaff(page, "promoter");
    await expect(page.getByTestId("navgroup-operations")).toHaveCount(0);
  });
});
