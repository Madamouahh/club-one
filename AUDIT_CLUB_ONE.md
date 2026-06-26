# Audit Club One + Site L'Arche — Rapport d'étape

> Date : 2026-06-26 · Auteur : audit technique · Périmètre : dépôt `Madamouahh/club-one` (HEAD `c39c3eb`, branche `main`) cloné dans `C:\Users\maxou\club-one`, + site public `https://complexelarche.fr` (signaux externes uniquement).
> Statut : **aucune ligne de code modifiée.** Ce rapport est le premier livrable. Le code et la base restent la source de vérité ; ce qui n'a pas pu être vérifié est signalé comme tel.

---

## 0. 🔴 URGENCE SÉCURITÉ — à traiter avant tout le reste

**Des mots de passe réels du personnel sont écrits en clair dans le code, committés dans un dépôt GitHub, et envoyés au navigateur de tout visiteur.**

- Fichier : `app/page.tsx`, lignes 85–96 (`STAFF_FALLBACK`).
- Le fichier est un composant `"use client"` : ces identifiants partent dans le bundle JavaScript public. N'importe qui ouvrant les outils dev sur `club-one-bay.vercel.app` peut les lire.
- Ils sont aussi dans **l'historique git** (`git log -p`) : retirer le fichier ne suffit pas, l'historique garde la trace.
- Exemples présents : comptes `admin` (maxime, jerome, anthony), `manager`, `server`, `security`, `promoter`, chacun avec son mot de passe.

**Actions à faire par le propriétaire (je ne peux pas les faire à ta place) :**
1. **Changer immédiatement tous ces mots de passe** côté Supabase / côté usage réel. Considère-les comme compromis.
2. **Passer le dépôt GitHub en privé** s'il est public (à vérifier).
3. Prévoir une réécriture d'historique ou une rotation complète (le code corrigé viendra dans le Lot 0 ci-dessous).

Tant que ce point n'est pas traité, n'importe qui peut se connecter en **admin** à Club One.

---

## 0bis. 🔴 AUDIT RLS LIVE — VÉRIFIÉ le 2026-06-26 (sonde lecture seule + écritures zéro-match)

Testé directement contre `https://xsotmjnaffaibgqgookt.supabase.co` avec la clé **publishable/anon** (publique, extraite du bundle déployé). Aucune donnée réelle recopiée ; écritures testées avec un id impossible (0 ligne touchée).

| Table | Lecture anon | Lignes | PII / secret exposé | DELETE anon | PATCH anon |
|---|---|---|---|---|---|
| `staff_users` | OUI (206) | 10 | **`password` EN CLAIR** | 204 (autorisé) | 204 (autorisé) |
| `club_tables` | OUI (206) | 18 | client, téléphone, notes | 204 | 204 |
| `entry_logs` | OUI (206) | 22 | — | 204 | 204 |
| `promoter_contacts` | OUI (206) | 3 | first_name, last_name, phone | 204 | 204 |
| `promoter_guest_entries` | OUI (206) | 8 | guest_name, phone, qr_token | 204 | 204 |
| `event_archives` | OUI (vide, 0 ligne) | 0 | — (financier à venir) | 204 | 204 |

**Conclusion : aucune RLS active. Toute la base de production est lisible ET inscriptible (UPDATE/DELETE compris) par n'importe quel anonyme** muni de la clé publique présente dans le bundle. Risques : (1) dump de tous les mots de passe staff en clair ; (2) fuite RGPD des PII clients/invités ; (3) **destruction/altération de données** (un anonyme peut vider `club_tables`, `promoter_guest_entries`, etc.).

Note : le sondage multi-agents initial a connu un bug de templating (URL/clé passées comme « undefined ») ; un agent a audité par erreur une autre base. Cette matrice-ci provient d'une sonde directe unique et fiable, et corrige ce point.

### Conséquence sur l'ordre des priorités
La sécurité (Lot 0 **+ Phase 0b : identité Supabase Auth + RLS sur toutes les tables**) passe **avant le site**. Tant que l'app n'a pas d'identité réelle, les tables opérationnelles ne peuvent pas être verrouillées sans casser l'app (elle opère en anon). Seul `staff_users` peut être verrouillé immédiatement (le login a un fallback).

---

## 1. État réel de Club One

**Ce que c'est vraiment :** une application Next.js 16 / React 19 / Tailwind v4, mono-fichier. Toute la logique métier (≈ 2986 lignes) tient dans `app/page.tsx`. Une seule autre page applicative : `app/invite/[token]/page.tsx` (page publique d'invitation QR, 156 lignes).

- **Maturité :** 17 commits, du 2026-05-28 au 2026-06-18. C'est un MVP jeune, écrit vite, et **réellement fonctionnel** pour son usage actuel (gérer une salle, une soirée).
- **Stack confirmée :** `next@16.2.6`, `react@19.2.4`, `@supabase/supabase-js@2.106.2`, `lucide-react`, `qrcode.react`, `html5-qrcode` (scan QR). Tailwind v4. PWA via `manifest.json`.
- **Périmètre fonctionnel réel** (vérifié dans le code) :
  - **Auth maison par rôles** : `admin`, `manager`, `server`, `security`, `security_counter`, `promoter`. Connexion par username/password comparés (1) à une liste en dur `STAFF_FALLBACK`, (2) à la table Supabase `staff_users`. Session stockée en `localStorage`.
  - **Plan de tables** : 18 tables en dur (`INITIAL_TABLES`), zones « Espace B », « Face DJ », « Espace A », « Carré VIP ». Positions x/y, capacités. Statuts : `free / option / booked / arrived / vip`.
  - **Réservations / clients** : nom, téléphone, nb de personnes, notes, dépenses par table, regroupement de tables (`linked_tables` / `linked_group_id`), totaux par groupe et par soirée.
  - **Dépenses & stats** : CA live de la soirée, nombre de tables qui consomment, recherche client par nom/téléphone.
  - **Flux entrées/sorties** : table `entry_logs` (compteur sécurité).
  - **Module promoteurs** : contacts (`promoter_contacts`), invitations avec **QR token** (`promoter_guest_entries`), check-in à l'entrée via scan QR, statut paiement (`réglé / en attente / offert`), accès `avec/sans alcool`.
  - **Clôture de soirée** : snapshot archivé dans `event_archives` puis remise à zéro des tables.
  - **Temps réel** : un canal Supabase Realtime (`postgres_changes`) sur 4 tables (`club_tables`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`).
  - **PWA** : installable (manifest + icônes + apple-web-app).

**Tables Supabase utilisées** (déduites du code) : `club_tables`, `staff_users`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`, `event_archives`.

## 2. État réel du site L'Arche

Vérifié uniquement depuis l'extérieur (pas d'accès admin — les identifiants sont communiqués séparément et ne seront pas stockés ici).

- **En ligne et fonctionnel.** WordPress (chemins `wp-content` visibles). Adresse : 281 Rue Dejean, Amiens.
- **Réservations** : lien externe **OctoTable** (« Réserver une table »). Newsletter présente. Feed Instagram intégré.
- **Structure éditoriale du site = ANCIENNE.** Le site présente encore **« Restaurant / Rooftop (Eden) / Club (Terminus) »**. Or le cahier des charges décrit la nouvelle organisation : **EDEN (rooftop) / LE CERCLE (remplace Le Culte, ce n'est PAS un restaurant) / TERMINUS**.
  → Le site est **désynchronisé du positionnement actuel** : « Restaurant » y figure encore, « Le Cercle » est absent, « Le Culte » n'apparaît plus mais n'est pas remplacé.
- **Non vérifiable sans accès admin** (à faire) : version WP, thème, liste/versions des plugins, hébergeur, scores de performance, posture sécurité, état SEO détaillé, formulaires internes.

## 3. Ce qui fonctionne déjà (à conserver)

- L'app de soirée **marche** et couvre le cœur du besoin opérationnel.
- Le **module promoteurs + QR** (génération, page publique d'invitation, check-in anti-double-usage) est une vraie valeur, bien pensée.
- Le **temps réel** est branché (les 4 tables critiques).
- Le **modèle de regroupement de tables** et le calcul de CA par groupe/soirée sont non triviaux et déjà en place.
- La **DA nuit** (fond noir, accents orange, lisible en environnement sombre) est cohérente avec la contrainte « utilisable en soirée ».
- Le **site est indexé, en ligne, avec un canal de réservation (OctoTable) déjà opérationnel** : à ne pas jeter.

## 4. Ce qui est fragile

- **Mono-fichier de 2986 lignes** : toute la logique, l'état, l'auth, le rendu et les requêtes Supabase dans un seul composant. Difficile à faire évoluer sans régression, impossible à tester unitairement en l'état.
- **Concurrence (violation directe de la contrainte temps réel du cahier des charges)** : `saveTable` écrit **toute la ligne** via `upsert` (`toDbRow`, lignes 431–449 + 762–784), y compris le **tableau `expenses` complet**. Deux personnes qui modifient la même table en même temps → **dernier qui écrit écrase l'autre** (dépense perdue). Pour un usage multi-utilisateurs simultané pendant une soirée, c'est le risque n°1 de perte de données.
- **Realtime à rechargement total** : chaque changement déclenche un `fetch` complet de toute la table (lignes 654–688). À plusieurs éditeurs actifs, ça multiplie les requêtes et peut « rebondir ».
- **Bug de closure** : le handler realtime de `promoter_guest_entries` utilise `activeEventDate` capturé au montage (dépendances `[]`, ligne 693). Changer la soirée active ne met pas à jour ce flux en temps réel.
- **PWA sans offline** : `manifest.json` seul, **pas de service worker / cache**. En cas de coupure réseau en soirée, l'app ne fonctionne plus. Or « fiable, utilisable en mouvement » est une exigence.
- **Bug manifest** : `public/manifest.json` référence `/icon-512.png`, mais le fichier réel s'appelle `icon-512(1).png`. L'icône 512 px ne se charge pas (install PWA dégradée).
- **Pas de schéma SQL versionné** : aucune migration, aucun `.sql` dans le dépôt. Le schéma n'existe que dans Supabase → pas de source de vérité reproductible, risque en cas de perte/rebuild.

## 5. Ce qui bloque (sécurité)

- **🔴 Identifiants en clair dans le code + git** (voir §0).
- **🔴 Authentification non fiable** : mots de passe comparés en clair côté client (lignes 916–918 et 948). La table `staff_users` stocke visiblement les mots de passe en clair (`user.password`). Aucun hash, aucun vrai mécanisme d'auth (pas de Supabase Auth, pas de JWT serveur).
- **🔴 RLS très probablement permissive/désactivée** (à confirmer avec accès Supabase) : l'app fait des `insert`/`update`/`upsert` directs sur toutes les tables avec la **clé anon** publique. Si RLS n'est pas verrouillée, **n'importe qui avec l'URL + la clé anon peut lire/écrire toute la base** (clients, téléphones, CA, archives). La clé anon est par nature publique → la sécurité repose **entièrement** sur RLS, qui n'est pas vérifiable depuis le code.
- **Permissions côté client seulement** : `canAccessTable` / `canEditTable` (lignes 498–533) sont du contrôle d'accès **dans le navigateur** → contournable. La vraie barrière doit être RLS côté base.
- **Données personnelles (RGPD)** : noms + téléphones de clients et d'invités stockés ; page d'invitation publique exposant nom/téléphone à quiconque a le token. À cadrer (durée de conservation, accès, base légale).

## 6. Ce qui doit être conservé

Tout le périmètre fonctionnel du §3. **Ne rien supprimer.** Les corrections se font « sous » l'existant (auth, concurrence, RLS) sans changer l'UX de soirée.

## 7. Ce qui doit être corrigé (par ordre)

1. Identifiants/auth/RLS (Lot 0).
2. Concurrence des écritures de tables + realtime ciblé (Lot 2).
3. Bug closure realtime soirée, bug manifest icône, offline PWA (Lot 2).
4. Synchroniser le site sur les 3 univers actuels (Lot 1).

## 8. Ce qui doit être reconstruit (pas tout de suite)

- **Pas de refonte complète.** Sortir progressivement le mono-fichier en modules (auth, plan, promoteurs, stats) — refactor à iso-fonctionnel, pas réécriture.
- **Modèle « complexe » absent** : aujourd'hui Club One ne connaît qu'**une salle**. Les notions **Eden / Le Cercle / Terminus**, **événements**, **artistes/DJs**, **médias** n'existent pas. C'est la fondation manquante de la « boucle complète » du cahier des charges (événement → lieu → site → campagne → réservation → soirée → CRM). À construire en Lot 3.

## 9. Intégrations recommandées (et ce qui reste préparatoire)

- **Site ↔ Club One** : faire de Club One la **source de vérité des événements**, exposés au site via un flux léger (endpoint JSON / lecture Supabase). **Garder WordPress** comme site marketing public (il est en ligne, indexé, avec OctoTable qui marche) — reconstruire un front headless plus tard seulement si justifié. Recommandation **préliminaire** : à confirmer après audit de l'admin WP.
- **Réservations** : conserver OctoTable côté grand public dans un premier temps ; brancher la remontée vers Club One ensuite.
- **Outils créatifs (Runway, Midjourney, Adobe Express)** : **pas d'intégration API simulée.** Les agents IA produisent des **briefs / prompts / scripts / storyboards / plannings** validés par un humain, puis export manuel vers ces outils. Ne jamais faire croire à une connexion qui n'existe pas.
- **IA** : strictement en **Back Office séparé**, jamais dans le chemin temps réel de la soirée. Aucun envoi sortant autonome (mail/SMS/pub) — validation humaine obligatoire.

## 10. Données manquantes / à clarifier

- Accès admin WordPress (pour finir l'audit site).
- Accès Supabase (URL projet + voir les **politiques RLS** réelles + schéma).
- Variables d'environnement Vercel réellement configurées (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`).
- Le dépôt est-il public ou privé ?
- Modèle de données souhaité pour Eden/Cercle/Terminus + événements.

## 11. Risques de sécurité (synthèse)

| Risque | Gravité | Preuve |
|---|---|---|
| Mots de passe réels en clair dans le code + git public | Critique | `app/page.tsx` 85–96 |
| Auth sans hash, comparaison côté client | Critique | 916–918, 948 |
| RLS probablement ouverte (écritures clé anon) | Critique (à confirmer) | tous les `insert/upsert` |
| Contrôle d'accès uniquement client | Élevé | 498–533 |
| PII clients/invités sans cadrage RGPD | Élevé | `promoter_contacts`, page invite publique |

## 12. Risques de régression

- Mono-fichier sans tests : toute modif touche l'ensemble. → Avancer par **petits lots iso-fonctionnels** + vérif build/typecheck à chaque lot.
- Changer le schéma de stockage des dépenses (pour la concurrence) touche le calcul de CA → migration **avec sauvegarde** et double-lecture transitoire.
- Toute action sur RLS peut casser l'app en prod si mal cadrée → tester sur un environnement/horaire hors soirée.

## 13. Architecture proposée

**Principe : un seul écosystème, deux surfaces techniquement séparées, une base partagée.**

- **Site public (WordPress, conservé)** : marketing + 3 univers + réservation OctoTable. Lit les **événements** publiés par Club One via un flux.
- **Front Office soirée (Club One, allégé)** : l'app temps réel actuelle, durcie (auth réelle, RLS, écritures concurrentes sûres, offline). **Zéro traitement IA lourd ici.**
- **Back Office intelligent (nouveau, séparé)** : gestion événements/artistes/médias, calendrier éditorial, génération de briefs/prompts IA, CRM, stats. Partage la base mais ne ralentit jamais la soirée.
- **Base Supabase (source de vérité)** : RLS par rôle. Source de vérité par donnée :
  - Lieux, événements, artistes, médias, campagnes → **Club One / Back Office**.
  - Réservations, clients, dépenses, entrées, archives → **Club One (soirée)**.
  - Contenus marketing publiés → **Back Office → poussés vers le site**.
- **Traitements IA / fond** : jobs asynchrones hors chemin temps réel (Edge Functions / worker séparé), déclenchés par événement, résultats mis en file pour **validation humaine**.

## 14. Roadmap (lots courts, testables, non destructifs)

- **Lot 0 — Sécurité (non négociable, en premier)** : retirer `STAFF_FALLBACK` du code ; auth via mots de passe **hashés** (ou Supabase Auth) ; **activer RLS** par rôle ; rotation des identifiants compromis ; documenter migrations + variables. Livrable vérifiable : impossible de lire un mot de passe dans le bundle ; écritures refusées sans rôle.
- **Lot 1 — Site (priorité 1 du cahier des charges)** : mettre le site à jour sur **Eden / Le Cercle / Terminus** (retirer « Restaurant », intégrer « Le Cercle »), refresh visuel + mobile + vitesse, et **flux événements** lu depuis Club One. Amélioration visible et immédiate.
- **Lot 2 — Fiabilité Club One** : écritures de table **granulaires** (dépense = insertion atomique, statut = update ciblé) pour tuer les pertes concurrentes ; realtime ciblé + fix closure soirée ; fix icône manifest ; offline PWA (service worker + file d'attente d'actions).
- **Lot 3 — Modèle Lieux/Événements** : tables `venues` (Eden/Cercle/Terminus) + `events` (date, lieu, artistes, médias) ; rattachement des réservations/soirées à un lieu. Fondation de la boucle complète.
- **Lot 4 — Back Office IA + CRM** : génération de briefs/prompts/calendriers (validation humaine, **aucun envoi autonome**) ; CRM reliant site + soirées + campagnes.
- **Lot 5+ (anticipé, non développé)** : RH, pointage, stocks, achats, compta, paie, maintenance. L'architecture les prévoit sans les coder.

## 15. Premier lot de code recommandé

**Lot 0 (sécurité)** doit passer avant tout, car des mots de passe réels sont publics. Contenu proposé :
1. Supprimer `STAFF_FALLBACK` et toute comparaison de mot de passe côté client.
2. Stocker des **hash** dans `staff_users` ; vérification via une fonction/Edge Function Supabase (ou bascule Supabase Auth) — jamais le mot de passe en clair côté navigateur.
3. **Activer et écrire les politiques RLS** par rôle sur les 6 tables.
4. Migration documentée + sauvegarde préalable.
Résultat vérifiable : aucun secret dans le bundle ; tentative d'écriture sans session/rôle valide rejetée par la base ; l'app de soirée continue de fonctionner à l'identique.

> ⚠️ Tension de priorité assumée : le cahier des charges met le **site en priorité 1**, mais l'incident « mots de passe publics » impose un **Lot 0 sécurité minimal d'abord**. Recommandation : Lot 0 (court) → puis Lot 1 (site). À arbitrer par le propriétaire.
