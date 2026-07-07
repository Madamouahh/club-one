# E2E Playwright — Club One (LABO uniquement)

Tests navigateur contre le **LABO local** (`.env.local` → `http://127.0.0.1:54321`). **Jamais la
production.**

## Pré-requis LABO (Kong non publié sur l'hôte)
Le stack Supabase local (`club-one-lab`) n'expose PAS ses ports à l'hôte (port 54321 réservé par
Windows). L'E2E passe donc par un **port-forward** vers Kong, et un build de PRODUCTION (l'hydratation
du dev Turbopack ne se faisait pas ici) pointé vers ce port :
```bash
# 1) forward host:8321 -> kong:8000 (conteneur socat sur le réseau du LABO, réversible)
docker run -d --name labfwd54321 --network supabase_network_club-one-lab -p 127.0.0.1:8321:8000 \
  alpine/socat:latest TCP-LISTEN:8000,fork,reuseaddr TCP:supabase_kong_club-one-lab:8000
# 2) comptes de TEST LABO (mot de passe connu, JAMAIS des vrais secrets) — via docker exec psql :
#    update auth.users set encrypted_password=extensions.crypt('E2ELabPass!23', extensions.gen_salt('bf'))
#    where email in ('lab-admin-01@clubone.local', ... );
# 3) build prod pointé vers le forward (inliné) — la config webServer lance `next start -p 3100`
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8321 npm run build
```

## Installer les navigateurs (une fois)
```bash
npx playwright install chromium
```
(`@playwright/test` est en devDependency ; le projet `mobile` utilise Pixel 5 = Chromium, pas WebKit.)

## Lancer
```bash
# le serveur dev est démarré automatiquement (webServer) sur :3000
npx playwright test -c e2e/playwright.config.ts
```

## Portée actuelle
- **Smoke actif, sans login** : l'app se charge, `/manifest.webmanifest` est servi (PWA).
- **Parcours staff (agenda create/cancel, tâches kanban)** : `test.skip` par défaut. Les activer en
  fournissant un compte de test LABO :
  ```bash
  E2E_STAFF_USER=... E2E_STAFF_PASS=... npx playwright test -c e2e/playwright.config.ts
  ```
  (Les mots de passe staff réels — `scripts/staff-passwords.local.json` — sont hors de portée par
  gouvernance ; utiliser un compte de test dédié au LABO.)

## Niveau de preuve
Ce scaffold porte le smoke au **niveau 5 (intégré navigateur)** une fois exécuté. Non exécuté ici
(binaires navigateurs non installés dans cette session) — étape documentée, à jouer par l'intégrateur
ou le fondateur.
