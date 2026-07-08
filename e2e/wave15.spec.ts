import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { execSync } from "node:child_process";
import { LAB_USERS } from "./helpers";

// Vague 15 — Phase 3 NÉGATIFS dédiés (browser + assertion PostgreSQL réelle). Ferme les réserves du rapport.
// Chaque test crée ses propres liens (tokens uniques par run/projet) → sûr sur chromium ET mobile, aucun
// résidu (liens created_by lab-% purgés par le teardown). Assertions PostgreSQL via `docker exec psql`.

function sql(q: string): string {
  return execSync("docker exec -i supabase_db_club-one-lab psql -U postgres -d postgres -tA", { input: q, encoding: "utf8" }).trim();
}
// Crée un lien de parrainage (créé par lab-promoter-01, soirée active) avec un état donné.
function mkLink(token: string, maxUses: number, used: number, expExpr: string) {
  sql(`insert into public.invite_links (token, created_by, event_id, exploitation_date, univers, kind, max_uses, uses_count, expires_at)
       select '${token}','lab-promoter-01', rs.active_event_id, e.event_date,'eden','guest_list',${maxUses},${used},${expExpr}
       from public.club_runtime_state rs join public.events e on e.id=rs.active_event_id;`);
}
let seq = 0;
function ph(): string { return "0699" + ((Date.now() + seq++) % 1000000).toString().padStart(6, "0"); }
function e164(p: string): string { return "+33" + p.slice(1); }
function tag(ti: TestInfo): string { return `${ti.project.name}-${Date.now().toString().slice(-6)}-${seq++}`; }

async function loginOn(page: Page, path: string, who: keyof typeof LAB_USERS) {
  const { user, pass } = LAB_USERS[who];
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
}
async function onboard(page: Page, token: string, name: string, phone: string, party = "3") {
  await page.goto(`/i/${token}`, { waitUntil: "domcontentloaded" });
  await page.getByTestId("onboard-firstname").fill(name);
  await page.getByTestId("onboard-phone").fill(phone);
  await page.getByTestId("onboard-birthday").fill("1995-06-15");
  await page.getByTestId("onboard-party").fill(party);
  await page.getByTestId("onboard-submit").click();
}

// ---------- Liens invalides : /i ne présente AUCUN formulaire, rien n'est consommé ----------
test("token expiré → /i bloque, aucune consommation", async ({ page }, ti) => {
  const tk = "neg-exp-" + tag(ti); mkLink(tk, 10, 0, "now() - interval '1 day'");
  await page.goto(`/i/${tk}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
  expect(sql(`select uses_count from public.invite_links where token='${tk}'`)).toBe("0");
});

test("token révoqué (désactivé par expiration) → /i bloque", async ({ page }, ti) => {
  const tk = "neg-rev-" + tag(ti); mkLink(tk, 10, 0, "now() - interval '2 hours'");
  await page.goto(`/i/${tk}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
  expect(sql(`select uses_count from public.invite_links where token='${tk}'`)).toBe("0");
});

test("token inconnu → /i bloque", async ({ page }) => {
  await page.goto(`/i/inconnu-${Date.now()}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
});

test("max_uses atteint → /i bloque", async ({ page }, ti) => {
  const tk = "neg-max-" + tag(ti); mkLink(tk, 2, 2, "null");
  await page.goto(`/i/${tk}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
  expect(sql(`select uses_count from public.invite_links where token='${tk}'`)).toBe("2");
});

// ---------- Usage unique : 1re inscription OK, 2e refusée ----------
test("usage unique consommé deux fois → 2e refusé", async ({ page }, ti) => {
  const tk = "neg-single-" + tag(ti); const p = ph();
  mkLink(tk, 1, 0, "null");
  await onboard(page, tk, "SingleUse", p);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  await page.goto(`/i/${tk}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0, { timeout: 10000 });
  expect(sql(`select uses_count from public.invite_links where token='${tk}'`)).toBe("1");
  expect(sql(`select count(*) from public.guests where phone='${e164(p)}'`)).toBe("1");
});

// ---------- Déduplication : même téléphone → un seul guest ----------
test("client déjà existant → déduplication (aucun 2e guest)", async ({ page }, ti) => {
  const tk = "neg-dedup-" + tag(ti); const p = ph();
  mkLink(tk, 50, 0, "null");
  await onboard(page, tk, "DedupA", p);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  await onboard(page, tk, "DedupB", p);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  expect(sql(`select count(*) from public.guests where phone='${e164(p)}'`)).toBe("1");
});

// ---------- Lien transféré : attribution conservée au promoteur créateur ----------
test("lien transféré à une autre personne → attribution reste au créateur", async ({ page }, ti) => {
  const tk = "neg-transfer-" + tag(ti); const pA = ph(); const pB = ph();
  mkLink(tk, 50, 0, "null");
  await onboard(page, tk, "PersonneA", pA);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  await onboard(page, tk, "PersonneB", pB);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  expect(sql(`select string_agg(distinct owner_promoter,',') from public.guests where phone in ('${e164(pA)}','${e164(pB)}')`)).toBe("lab-promoter-01");
});

// ---------- Cross-promoteur : un promoteur ne voit que SON funnel ----------
test("cross-promoteur → promoteur-02 ne voit pas le funnel de promoteur-01", async ({ page }, ti) => {
  const tk = "neg-cross-" + tag(ti); const p = ph();
  mkLink(tk, 50, 0, "null");
  await onboard(page, tk, "CrossA", p); // active promoteur-01 (owner_promoter = lab-promoter-01)
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  // promoteur-01 a bien de l'activité en base…
  expect(Number(sql(`select count(*) from public.invite_links where created_by='lab-promoter-01'`))).toBeGreaterThan(0);
  // …mais promoteur-02 ouvre SON funnel : zéro (il n'a rien créé), aucune fuite de p-01.
  await loginOn(page, "/ops", "promoter2");
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("ops-nav-plus").click();
  await page.getByTestId("ops-plus-funnel").click();
  await expect(page.getByTestId("funnel-grid")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("funnel-stage").first()).toContainText(/^0/); // Liens créés = 0 pour p-02
  expect(sql(`select count(*) from public.invite_links where created_by='lab-promoter-02'`)).toBe("0");
});

// ---------- Réservation refusée par le staff ----------
test("réservation refusée par le staff → statut declined", async ({ page }, ti) => {
  test.skip(ti.project.name === "mobile", "décision staff = surface desktop");
  const tk = "neg-refuse-" + tag(ti); const p = ph(); const nm = "Refuse" + tag(ti).replace(/[^a-z0-9]/gi, "");
  mkLink(tk, 50, 0, "null");
  await onboard(page, tk, nm, p);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  await loginOn(page, "/dashboard", "admin");
  await page.getByTestId("dash-section-relation").click();
  await page.getByTestId("dash-submod-resas").click();
  await page.getByTestId("dash-filter").fill(nm);
  await expect(page.getByTestId("dash-row").first()).toBeVisible({ timeout: 10000 });
  await page.getByTestId("dash-row").first().click();
  await expect(page.getByTestId("dash-action-1")).toBeVisible({ timeout: 8000 }); // Refuser
  await page.getByTestId("dash-action-1").click();
  await expect(page.getByTestId("dash-action-msg")).toContainText(/refusée/i, { timeout: 8000 });
  expect(sql(`select status from public.table_reservation_requests where guest_id in (select id from public.guests where phone='${e164(p)}')`)).toBe("declined");
});

// ---------- Réservation annulée par le client (depuis /espace) ----------
test("réservation annulée par le client → statut cancelled", async ({ page }, ti) => {
  const tk = "neg-cancel-" + tag(ti); const p = ph();
  mkLink(tk, 50, 0, "null");
  await onboard(page, tk, "CancelMe", p);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  const space = sql(`select space_token from public.guests where phone='${e164(p)}'`);
  expect(space.length).toBeGreaterThan(20);
  await page.goto(`/espace/${space}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("resa-my-request-row").first()).toBeVisible({ timeout: 12000 });
  await page.getByTestId("resa-cancel-btn").first().click();
  await expect.poll(() => sql(`select status from public.table_reservation_requests where guest_id in (select id from public.guests where phone='${e164(p)}')`), { timeout: 10000 }).toBe("cancelled");
});

// ---------- Double scan refusé ----------
test("QR scanné deux fois → 2e refusé (idempotent)", async ({ page }, ti) => {
  const tk = "neg-scan-" + tag(ti); const p = ph();
  mkLink(tk, 50, 0, "null");
  await onboard(page, tk, "ScanMe", p);
  await expect(page.getByTestId("onboard-success")).toBeVisible({ timeout: 15000 });
  const qr = ((await page.getByTestId("onboard-qr-token").textContent()) || "").trim();
  expect(qr.length).toBeGreaterThan(20);
  await loginOn(page, "/ops", "security");
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("ops-nav-plus").click();
  await page.getByTestId("ops-plus-scan").click();
  await page.getByTestId("scan-input").fill(qr);
  await page.getByTestId("scan-btn").click();
  await expect(page.getByTestId("scan-result")).toContainText(/✓/, { timeout: 8000 });
  await page.getByTestId("scan-input").fill(qr);
  await page.getByTestId("scan-btn").click();
  await expect(page.getByTestId("scan-result")).toContainText(/Déjà|already/i, { timeout: 8000 });
  expect(sql(`select count(*) from public.guest_passes where qr_token='${qr}' and status='scanned'`)).toBe("1");
});
