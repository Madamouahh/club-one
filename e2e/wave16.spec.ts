import { test, expect, type Page, type TestInfo } from "@playwright/test";
import { execSync } from "node:child_process";
import { LAB_USERS } from "./helpers";

// Vague 16 — RÉVOCATION EXPLICITE des liens (0074), prouvée browser + PostgreSQL réel.
// Distingue expiration (wave15) de révocation. Liens créés par le test (tokens uniques par run/projet).

function sql(q: string): string {
  return execSync("docker exec -i supabase_db_club-one-lab psql -U postgres -d postgres -tA", { input: q, encoding: "utf8" }).trim();
}
function mkLink(token: string, maxUses: number, used: number, expExpr: string) {
  sql(`insert into public.invite_links (token, created_by, event_id, exploitation_date, univers, kind, max_uses, uses_count, expires_at)
       select '${token}','lab-promoter-01', rs.active_event_id, e.event_date,'eden','guest_list',${maxUses},${used},${expExpr}
       from public.club_runtime_state rs join public.events e on e.id=rs.active_event_id;`);
}
let seq = 0;
function tag(ti: TestInfo): string { return `${ti.project.name}-${Date.now().toString().slice(-6)}-${seq++}`; }
async function loginOn(page: Page, path: string, who: keyof typeof LAB_USERS) {
  const { user, pass } = LAB_USERS[who];
  await page.goto(path, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("auth-login")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("auth-user").fill(user);
  await page.getByTestId("auth-pass").fill(pass);
  await page.getByTestId("auth-submit").click();
}
async function openFunnel(page: Page) {
  await expect(page.getByTestId("ops-surface")).toBeVisible({ timeout: 15000 });
  await page.getByTestId("ops-nav-plus").click();
  await page.getByTestId("ops-plus-funnel").click();
  await expect(page.getByTestId("funnel-grid")).toBeVisible({ timeout: 10000 });
}

// 1. Le promoteur révoque SON lien → état Révoqué, puis le client voit « lien révoqué », zéro écriture.
test("révocation par le promoteur → lien révoqué côté client, zéro donnée", async ({ page }, ti) => {
  const tk = "rev-own-" + tag(ti);
  mkLink(tk, 50, 0, "null");
  await loginOn(page, "/ops", "promoter");
  await openFunnel(page);
  const row = page.getByTestId("funnel-link-row").filter({ hasText: tk });
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.getByTestId("funnel-revoke-btn").click();
  await row.getByTestId("funnel-revoke-confirm").click();
  await expect(row.getByTestId("funnel-link-revoked")).toBeVisible({ timeout: 8000 });
  expect(sql(`select (revoked_at is not null) from public.invite_links where token='${tk}'`)).toBe("t");
  expect(sql(`select revoked_by from public.invite_links where token='${tk}'`)).toBe("lab-promoter-01");
  // Le client ouvre le token → « lien révoqué », aucun formulaire, aucune écriture.
  await page.goto(`/i/${tk}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByTestId("onboard-revoked")).toBeVisible({ timeout: 10000 });
  await expect(page.getByTestId("onboard-submit")).toHaveCount(0);
  expect(sql(`select uses_count from public.invite_links where token='${tk}'`)).toBe("0");
});

// 2. Un autre promoteur ne peut pas révoquer : il ne voit même pas le lien (RLS own-scope).
test("cross-promoteur → promoteur-02 ne peut pas révoquer le lien de promoteur-01", async ({ page }, ti) => {
  const tk = "rev-cross-" + tag(ti);
  mkLink(tk, 50, 0, "null");
  await loginOn(page, "/ops", "promoter2");
  await openFunnel(page);
  await expect(page.getByTestId("funnel-link-row").filter({ hasText: tk })).toHaveCount(0);
  expect(sql(`select (revoked_at is null) from public.invite_links where token='${tk}'`)).toBe("t");
});

// 3. La direction peut révoquer le lien d'un promoteur.
test("direction → révoque le lien d'un promoteur", async ({ page }, ti) => {
  const tk = "rev-dir-" + tag(ti);
  mkLink(tk, 50, 0, "null");
  await loginOn(page, "/ops", "admin");
  await openFunnel(page);
  const row = page.getByTestId("funnel-link-row").filter({ hasText: tk });
  await expect(row).toBeVisible({ timeout: 8000 });
  await row.getByTestId("funnel-revoke-btn").click();
  await row.getByTestId("funnel-revoke-confirm").click();
  await expect(row.getByTestId("funnel-link-revoked")).toBeVisible({ timeout: 8000 });
  expect(sql(`select revoked_by from public.invite_links where token='${tk}'`)).toBe("lab-admin-01");
});
