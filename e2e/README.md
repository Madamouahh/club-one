# E2E Playwright — Club One (LABO uniquement)

Tests navigateur contre le **LABO local** (`.env.local` → `http://127.0.0.1:54321`). **Jamais la
production.**

## Installer (une fois)
```bash
npm i -D @playwright/test
npx playwright install chromium
```
(Non ajouté à package.json/package-lock pour ne pas alourdir `npm ci`/build : installation à la demande.)

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
