import { test, expect } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 17 — DÉTERMINISME UTC / heure locale. La « date du jour » d'exploitation de /staff (enService →
// bouton handoff MODE SOIRÉE) est ancrée au fuseau d'exploitation (Europe/Paris), JAMAIS au fuseau du
// navigateur. On le prouve en chargeant /staff sous des fuseaux navigateur EXTRÊMES (UTC-11 et UTC+14) :
// le bouton reste correct car le fixture (setup) et le front partagent la date parisienne. Avec l'ancien
// code (date locale du navigateur), ces fuseaux tomberaient un jour différent de Paris → test rouge.
// timezoneId ne change que l'affichage, pas l'instant epoch → l'auth JWT n'est pas affectée.

const TIMEZONES = [
  { id: "Pacific/Pago_Pago", label: "UTC-11" },
  { id: "Pacific/Kiritimati", label: "UTC+14" },
];

for (const tz of TIMEZONES) {
  test(`enService déterministe sous fuseau ${tz.label} (ancré Europe/Paris)`, async ({ browser }) => {
    const ctx = await browser.newContext({ timezoneId: tz.id });
    try {
      const page = await ctx.newPage();
      const { user, pass } = LAB_USERS.server;
      await page.goto("/staff", { waitUntil: "domcontentloaded" });
      await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
      await page.getByTestId("auth-user").fill(user);
      await page.getByTestId("auth-pass").fill(pass);
      await page.getByTestId("auth-submit").click();
      await expect(page.getByTestId("staff-space")).toBeVisible({ timeout: 15000 });
      // Le shift confirmé du jour (date parisienne) rend le handoff visible, quel que soit le fuseau client.
      await expect(page.getByTestId("staff-open-ops")).toBeVisible({ timeout: 8000 });
    } finally {
      await ctx.close();
    }
  });
}
