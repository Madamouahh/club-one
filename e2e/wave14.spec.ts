import { test, expect, type Page } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 14 — Phase 3 PARRAINAGE bout-en-bout dans les interfaces réelles (LABO). Un seul scénario complet :
// promoteur crée un lien → client onboarde + résa préremplie → staff approuve → sécurité scanne →
// promoteur voit la conversion. + négatifs (double scan, lien inconnu). Écritures réelles, RLS.

async function loginOn(page: Page, path: string, who: keyof typeof LAB_USERS) {
  const { user, pass } = LAB_USERS[who];
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
}

test("Phase 3 bout-en-bout : promoteur → client → staff → sécurité → conversion", async ({ browser }) => {
  test.setTimeout(180000);
  const uniq = Date.now().toString().slice(-6);
  const clientName = "Ref" + uniq;
  const phone = "0699" + uniq; // FR → +33699… (normalisé par /i, purgé par le teardown)

  // 1. PROMOTEUR (mobile) crée un lien lié à la soirée et récupère l'URL de partage.
  const promoCtx = await browser.newContext();
  const promo = await promoCtx.newPage();
  await loginOn(promo, "/ops", "promoter");
  await expect(promo.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
  await promo.getByTestId("ops-share-link").click();
  await expect(promo.getByTestId("share-link")).toBeVisible({ timeout: 12000 });
  const shareUrl = ((await promo.getByTestId("share-link").textContent()) || "").trim();
  expect(shareUrl).toContain("/i/");
  // Referme la feuille de partage (sinon elle recouvre la bottom-nav à l'étape funnel).
  await promo.getByTestId("share-modal").click({ position: { x: 8, y: 8 } });
  await expect(promo.getByTestId("share-modal")).toHaveCount(0);

  // 2. CLIENT (mobile, aucune session) ouvre le lien, complète son profil + résa préremplie → QR perso.
  const clientCtx = await browser.newContext();
  const client = await clientCtx.newPage();
  await client.goto(shareUrl, { waitUntil: "domcontentloaded" });
  await client.getByTestId("onboard-firstname").fill(clientName);
  await client.getByTestId("onboard-phone").fill(phone);
  await client.getByTestId("onboard-birthday").fill("1995-06-15");
  await client.getByTestId("onboard-party").fill("4");
  await client.getByTestId("onboard-slot").fill("23h30");
  await client.getByTestId("onboard-submit").click();
  await expect(client.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  const qrToken = ((await client.getByTestId("onboard-qr-token").textContent()) || "").trim();
  expect(qrToken.length).toBeGreaterThan(20);

  // 3. STAFF (dashboard desktop) : voit la demande (source promoteur) et l'approuve.
  const staffCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const staff = await staffCtx.newPage();
  await loginOn(staff, "/dashboard", "admin");
  await expect(staff.getByTestId("dash-sidebar")).toBeVisible({ timeout: 15000 });
  await staff.getByTestId("dash-section-relation").click();
  await staff.getByTestId("dash-submod-resas").click();
  await staff.getByTestId("dash-filter").fill(clientName);
  await expect(staff.getByTestId("dash-row").first()).toBeVisible({ timeout: 10000 });
  await staff.getByTestId("dash-row").first().click();
  await expect(staff.getByTestId("dash-action-0")).toBeVisible({ timeout: 8000 });
  await staff.getByTestId("dash-action-0").click(); // Accepter
  await expect(staff.getByTestId("dash-action-msg")).toContainText(/approuvée/i, { timeout: 8000 });

  // 4. SÉCURITÉ (mobile) scanne le QR → arrivée validée ; double scan refusé (idempotent).
  const secCtx = await browser.newContext();
  const sec = await secCtx.newPage();
  await loginOn(sec, "/ops", "security");
  await expect(sec.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
  await sec.getByTestId("ops-nav-plus").click();
  await sec.getByTestId("ops-plus-scan").click();
  await sec.getByTestId("scan-input").fill(qrToken);
  await sec.getByTestId("scan-btn").click();
  await expect(sec.getByTestId("scan-result")).toContainText(/✓/, { timeout: 8000 });
  await sec.getByTestId("scan-input").fill(qrToken);
  await sec.getByTestId("scan-btn").click();
  await expect(sec.getByTestId("scan-result")).toContainText(/Déjà|already/i, { timeout: 8000 });

  // 5. PROMOTEUR ouvre son funnel : conversion visible (données réelles).
  await promo.getByTestId("ops-nav-plus").click();
  await promo.getByTestId("ops-plus-funnel").click();
  await expect(promo.getByTestId("funnel-grid")).toBeVisible({ timeout: 10000 });
  await expect(promo.getByTestId("ops-plus-view-funnel")).toContainText(/Arrivées scannées/i);

  await Promise.all([promoCtx.close(), clientCtx.close(), staffCtx.close(), secCtx.close()]);
});

test("Phase 3 négatif : lien inconnu → aucun onboarding possible", async ({ page }) => {
  await page.goto("/i/00000000-0000-0000-0000-000000000000", { waitUntil: "domcontentloaded" });
  // Pas de formulaire d'inscription pour un lien invalide (aucun parcours créé).
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
});
