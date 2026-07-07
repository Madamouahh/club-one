# PWA / Mobile — notes (Squad H)

Couche PWA de Club One : manifest, service worker (offline + reconnexion + mise à jour
versionnée), enregistrement client. Next.js 16 App Router, aucune dépendance externe,
assets self-hosted uniquement.

## Fichiers livrés

| Fichier | Rôle |
| --- | --- |
| `app/manifest.ts` | Web App Manifest idiomatique Next 16. Sert `/manifest.webmanifest` et injecte automatiquement `<link rel="manifest">`. Couleurs alignées sur le thème sombre (`#0a0a0a`). |
| `public/sw.js` | Service worker : cache du shell, network-first pour navigations/données, fallback offline, mise à jour via `SKIP_WAITING`. |
| `app/_components/PwaRegister.tsx` | `"use client"` — enregistre le SW, affiche le prompt « mise à jour disponible » et l'indicateur hors-ligne / reconnexion. |
| `lib/pwa.ts` | Helpers PURS : `compareVersions`, `isUpdateAvailable`, machine à états connexion, éligibilité install. |
| `tests/pwa.test.mts` | 11 tests Node sur `lib/pwa.ts`. |

## Câblage à faire par l'intégrateur (dans `app/layout.tsx`)

Deux modifications minimales — un import et un élément :

```tsx
// 1) import (en haut du fichier)
import PwaRegister from "@/app/_components/PwaRegister";

// 2) élément : dernier enfant de <body>, après {children}
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}
```

### Manifest — action recommandée (non bloquante)

`app/layout.tsx` déclare actuellement `metadata.manifest = "/manifest.json"` (fichier
statique `public/manifest.json`). Avec `app/manifest.ts`, Next injecte déjà
`<link rel="manifest" href="/manifest.webmanifest">`.

- **Recommandé** : retirer la ligne `manifest: "/manifest.json"` de `metadata` dans
  `app/layout.tsx` pour éviter un double `<link rel="manifest">`, et supprimer
  `public/manifest.json` (devenu redondant — source unique = `app/manifest.ts`).
- Si la ligne est conservée : ce n'est **pas bloquant** (deux liens manifest cohérents,
  `public/manifest.json` a été aligné sur les mêmes couleurs), simplement redondant.

Je n'ai pas touché `app/layout.tsx` (hors périmètre).

## Fonctionnement

### Manifest
`name`/`short_name` « Club One », `display: standalone`, `start_url`/`scope` `/`,
`background_color`/`theme_color` `#0a0a0a` (= `--background` sombre de `app/globals.css`),
icônes 192 et 512 depuis `public/`.

### Service worker (`public/sw.js`)
- **install** : précache best-effort du shell (`/`, `/manifest.webmanifest`, icônes) via
  `Promise.allSettled` (une ressource manquante ne casse jamais l'install).
- **activate** : purge des anciens caches `club-one-*` d'une version précédente, `clients.claim()`.
- **fetch** (GET uniquement) :
  - navigations HTML → **network-first**, fallback cache runtime → shell `/` → page offline sombre ;
  - `/_next/static/*` + icônes → **stale-while-revalidate** ;
  - autres GET same-origin (données) → **network-first**, fallback cache, sinon `503 {offline:true}` ;
  - **cross-origin (Supabase, etc.) → réseau seul, jamais mis en cache** (pas de données sensibles/opaques en cache).
- **mise à jour** : le client poste `{type:"SKIP_WAITING"}` → le SW appelle `skipWaiting()` →
  `controllerchange` déclenche un reload unique.

### Enregistrement client (`PwaRegister.tsx`)
- Enregistre `/sw.js` (`scope:"/"`, `updateViaCache:"none"`).
- Détecte un SW `waiting`/nouvellement installé → bannière « Mettre à jour ».
- Écoute `online`/`offline` ; sur retour `online`, **vérifie** la connectivité réelle par un
  `HEAD /manifest.webmanifest` (car `navigator.onLine` peut mentir) avant de repasser « online ».
- Toute la logique d'état est déléguée à `lib/pwa.ts` (testée).

### Versionnage
`public/sw.js` (`VERSION`) et `lib/pwa.ts` (`PWA_SHELL_VERSION`) doivent rester synchronisés
(actuellement `1.0.0`). Bump les deux ensemble à chaque changement du shell/SW pour forcer
le renouvellement des caches.

## Manques d'assets connus (à corriger avant store/install soignée)

- **Icônes disponibles uniquement** : `icon-180.png` (Apple touch), `icon-192.png`, `icon-512.png`.
  Non fabriquées (pas d'invention de binaire).
- **Pas d'icône `maskable`** : sur Android l'icône n'aura pas de forme adaptative (letterboxing possible).
  → ajouter un `icon-512-maskable.png` avec safe-zone puis une entrée `purpose:"maskable"`.
- **Tailles manquantes** couramment recommandées : 144, 256, 384. Non critiques (192 + 512 suffisent à l'installabilité).
- **Pas de `screenshots`** ni d'icône `badge.png` (utile pour d'éventuelles notifications push — hors périmètre V1).
- **Push notifications** : non implémentées (pas de VAPID). Le SW ne gère volontairement que offline/reconnexion/update.

## Validation (niveau : validé localement)

- `node --test tests/pwa.test.mts` → **11 pass / 0 fail**.
- `npx tsc --noEmit` → aucune erreur.
- Non vérifié : comportement runtime réel du SW (install/offline/update) en navigateur et
  `npm run build` complet — à confirmer par l'intégrateur (niveau validation intégrée non atteint).
