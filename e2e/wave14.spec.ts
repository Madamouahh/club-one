import { test, expect, type Page, type Browser, type BrowserContextOptions } from "@playwright/test";
import { LAB_USERS } from "./helpers";

// Vague 14 — Phase 3 PARRAINAGE bout-en-bout dans les interfaces réelles (LABO). Un seul scénario complet :
// promoteur crée un lien → client onboarde + résa préremplie → staff approuve → sécurité scanne →
// promoteur voit la conversion. + négatif (lien inconnu). Écritures réelles, RLS.
//
// DÉTERMINISME (pas de retry) : chaque étape s'exécute dans SON PROPRE contexte, fermé AVANT d'ouvrir le
// suivant → un seul contexte vivant à la fois (aucune contention de concurrence / ressources non libérées).
// Les étapes ne partagent QUE des identifiants persistés explicitement (shareUrl, qrToken, clientName).

async function loginOn(page: Page, path: string, who: keyof typeof LAB_USERS) {
  const { user, pass } = LAB_USERS[who];
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
}
// Exécute fn dans un contexte isolé, garanti fermé même en cas d'échec (aucune ressource laissée vivante).
async function inContext<T>(browser: Browser, opts: BrowserContextOptions, fn: (page: Page) => Promise<T>): Promise<T> {
  const ctx = await browser.newContext(opts);
  try {
    return await fn(await ctx.newPage());
  } finally {
    await ctx.close();
  }
}

test("Phase 3 bout-en-bout : promoteur → client → staff → sécurité → conversion", async ({ browser }) => {
  test.setTimeout(120000);
  const uniq = Date.now().toString().slice(-6);
  const clientName = "Ref" + uniq;
  const phone = "0699" + uniq; // FR → +33699… (normalisé par /i, purgé par le teardown)

  // 1. PROMOTEUR crée un lien lié à la soirée et récupère l'URL de partage. (contexte fermé ensuite)
  const shareUrl = await inContext(browser, {}, async (promo) => {
    await loginOn(promo, "/ops", "promoter");
    await expect(promo.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
    await promo.getByTestId("ops-share-link").click();
    await expect(promo.getByTestId("share-link")).toBeVisible({ timeout: 12000 });
    const url = ((await promo.getByTestId("share-link").textContent()) || "").trim();
    expect(url).toContain("/i/");
    return url;
  });

  // 2. CLIENT ouvre le lien, complète son profil + résa préremplie → QR perso. (contexte isolé)
  const qrToken = await inContext(browser, {}, async (client) => {
    await client.goto(shareUrl, { waitUntil: "domcontentloaded" });
    await client.getByTestId("onboard-firstname").fill(clientName);
    await client.getByTestId("onboard-phone").fill(phone);
    await client.getByTestId("onboard-birthday").fill("1995-06-15");
    await client.getByTestId("onboard-party").fill("4");
    await client.getByTestId("onboard-slot").fill("23h30");
    await client.getByTestId("onboard-submit").click();
    await expect(client.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
    const qr = ((await client.getByTestId("onboard-qr-token").textContent()) || "").trim();
    expect(qr.length).toBeGreaterThan(20);
    return qr;
  });

  // 3. STAFF (desktop) voit la demande (source promoteur) et l'approuve. (contexte isolé)
  await inContext(browser, { viewport: { width: 1280, height: 800 } }, async (staff) => {
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
  });

  // 4. SÉCURITÉ scanne le QR → arrivée validée ; double scan refusé. (contexte isolé)
  await inContext(browser, {}, async (sec) => {
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
  });

  // 5. PROMOTEUR rouvre son funnel : conversion visible (données réelles). (contexte isolé)
  await inContext(browser, {}, async (promo) => {
    await loginOn(promo, "/ops", "promoter");
    await expect(promo.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
    await promo.getByTestId("ops-nav-plus").click();
    await promo.getByTestId("ops-plus-funnel").click();
    await expect(promo.getByTestId("funnel-grid")).toBeVisible({ timeout: 10000 });
    await expect(promo.getByTestId("ops-plus-view-funnel")).toContainText(/Arrivées scannées/i);
  });
});

test("Phase 3 négatif : lien inconnu → aucun onboarding possible", async ({ page }) => {
  await page.goto("/i/00000000-0000-0000-0000-000000000000", { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
});
