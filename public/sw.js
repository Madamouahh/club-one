/* public/sw.js — Service worker Club One (PWA).
 * Offline + reconnexion + mise à jour versionnée. Aucune dépendance externe (self-hosted).
 * Stratégies :
 *   - Navigations (HTML) : network-first → fallback cache runtime → shell "/" → page offline.
 *   - Assets statiques Next (/_next/static/) + icônes : stale-while-revalidate.
 *   - Autres GET same-origin (données /api…) : network-first → fallback cache.
 *   - Cross-origin (ex. Supabase) : réseau seul, jamais mis en cache.
 * La constante VERSION DOIT rester synchronisée avec PWA_SHELL_VERSION dans lib/pwa.ts.
 * Voir docs/PWA_NOTES.md.
 */

const VERSION = "1.0.0";
const CACHE_PREFIX = "club-one";
const SHELL_CACHE = CACHE_PREFIX + "-shell-v" + VERSION;
const RUNTIME_CACHE = CACHE_PREFIX + "-runtime-v" + VERSION;

// Ressources du shell stables et self-hosted. cache.add() tolère les échecs individuels
// (Promise.allSettled) pour ne jamais faire échouer l'install si une ressource manque.
const SHELL_ASSETS = [
  "/",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

const OFFLINE_HTML =
  '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">' +
  "<title>Hors ligne — Club One</title><style>" +
  "html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;" +
  "background:#0a0a0a;color:#ededed;font-family:Arial,Helvetica,sans-serif;text-align:center;padding:24px}" +
  ".c{max-width:360px}h1{font-size:20px;margin:0 0 8px}p{opacity:.7;font-size:14px;line-height:1.5;margin:0}" +
  "</style></head><body><div class=c><h1>Hors ligne</h1>" +
  "<p>La connexion est indisponible. La reconnexion sera automatique dès le retour du réseau.</p>" +
  "</div></body></html>";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) =>
        Promise.allSettled(SHELL_ASSETS.map((url) => cache.add(url))),
      ),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) =>
                k.startsWith(CACHE_PREFIX) &&
                k !== SHELL_CACHE &&
                k !== RUNTIME_CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

// Le client (PwaRegister) demande l'activation immédiate d'un SW en attente.
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }

  // Cross-origin (Supabase, providers…) : on laisse passer, jamais de cache.
  if (url.origin !== self.location.origin) return;

  // Navigations (documents HTML).
  if (req.mode === "navigate") {
    event.respondWith(networkFirstNavigation(req));
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    SHELL_ASSETS.indexOf(url.pathname) !== -1;

  if (isStaticAsset) {
    event.respondWith(staleWhileRevalidate(req));
    return;
  }

  // Autres GET same-origin (données) : network-first avec fallback cache.
  event.respondWith(networkFirstData(req));
});

async function networkFirstNavigation(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached =
      (await caches.match(req)) || (await caches.match("/"));
    if (cached) return cached;
    return new Response(OFFLINE_HTML, {
      status: 503,
      statusText: "Offline",
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
}

async function networkFirstData(req) {
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      const cache = await caches.open(RUNTIME_CACHE);
      cache.put(req, res.clone()).catch(() => {});
    }
    return res;
  } catch {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response(
      JSON.stringify({ offline: true, error: "network-unavailable" }),
      {
        status: 503,
        statusText: "Offline",
        headers: { "Content-Type": "application/json; charset=utf-8" },
      },
    );
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(RUNTIME_CACHE);
  const cached = await cache.match(req);
  const network = fetch(req)
    .then((res) => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    })
    .catch(() => null);
  return cached || (await network) || Response.error();
}
