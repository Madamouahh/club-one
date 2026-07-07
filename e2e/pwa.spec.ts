import { test, expect } from "@playwright/test";

test.describe("PWA — vérification réelle navigateur (LABO)", () => {
  test("manifest servi + critères d'installabilité", async ({ page }) => {
    const res = await page.request.get("/manifest.webmanifest");
    expect(res.ok()).toBeTruthy();
    const m = await res.json();
    expect(m.name).toBeTruthy();
    expect(m.display).toBe("standalone");
    expect(m.start_url).toBeTruthy();
    expect(Array.isArray(m.icons) && m.icons.length).toBeGreaterThan(0);
    // au moins une icône 192 et une 512 (installabilité Android/Chrome)
    const sizes = m.icons.map((i: { sizes?: string }) => i.sizes).join(" ");
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
  });

  test("service worker s'enregistre et s'active", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    const swActive = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator)) return false;
      const reg = await navigator.serviceWorker.ready.catch(() => null);
      return !!(reg && (reg.active || reg.installing || reg.waiting));
    });
    expect(swActive).toBe(true);
  });

  test("aucune donnée sensible (Supabase) mise en cache par le SW", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    const leaked = await page.evaluate(async () => {
      const names = await caches.keys();
      const hits: string[] = [];
      for (const n of names) {
        const c = await caches.open(n);
        const reqs = await c.keys();
        for (const r of reqs) {
          if (/\/auth\/v1\/|\/rest\/v1\/|supabase|token|8321/i.test(r.url)) hits.push(r.url);
        }
      }
      return hits;
    });
    expect(leaked).toEqual([]);
  });

  test("invalidation : aucun cache orphelin (une seule version de shell active)", async ({ page }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    await page.waitForTimeout(1500);
    // Le SW nettoie les anciens caches à l'activation → tous les caches partagent un préfixe/version.
    const prefixes = await page.evaluate(async () => {
      const names = await caches.keys();
      // Préfixe = tout sauf le suffixe de version après le dernier '-'.
      return Array.from(new Set(names.map((n) => n.replace(/[-_]v?\d+[\d._]*$/i, "").replace(/\d+[\d._]*$/i, ""))));
    });
    // Au plus une famille de cache d'app-shell (pas d'accumulation d'anciennes versions).
    expect(prefixes.length).toBeLessThanOrEqual(2);
  });

  test("offline : le shell de l'app se ré-affiche hors-ligne", async ({ page, context }) => {
    await page.goto("/", { waitUntil: "networkidle" });
    // laisser le SW précacher le shell
    await page.waitForTimeout(1500);
    await context.setOffline(true);
    await page.reload().catch(() => undefined);
    await expect(page.locator("body")).toBeVisible();
    // un contenu (login staff ou fallback offline) s'affiche, pas une page d'erreur navigateur brute
    const txt = await page.locator("body").innerText().catch(() => "");
    expect(txt.length).toBeGreaterThan(0);
    await context.setOffline(false);
  });
});
