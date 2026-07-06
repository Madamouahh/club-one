# Club One — FEUILLE DE ROUTE RESTANTE (lots indépendants)

*Découpage du reste-à-faire en 7 lots aussi indépendants que possible (périmètres de fichiers
disjoints → développables en parallèle, sauf `app/page.tsx` sérialisé). Fondé sur l'audit prouvé, pas
sur les migrations. Détail et preuves : `CLUB_ONE_MASTER_PRODUCT_GAP_AUDIT.md`.*

- **Date** : 2026-07-06 · **Branche** : `feat/club-one-launch-july-2026`
- **Aucun développement dans ce document** : c'est un plan, pas du code. Toute action à risque
  (migration, base non-prod, push, cutover) reste soumise à un GO explicite du fondateur.

---

## Principe de séquençage

1. **LOT A d'abord** (production) — rien d'autre ne « compte » tant que le socle n'est pas prouvé en prod.
2. Puis **B/C/D/G en parallèle** (exploitation interne, contrats de fichiers disjoints, ~55 % déjà faits).
3. **E puis F** (client puis marketing) : F dépend de E (contacts + consentements) et des adaptateurs.
4. Un seul intégrateur câble `app/page.tsx` (zone sérialisée) ; les squads livrent `app/_modules/<x>/` + `lib/<x>.ts`.

Dépendances dures inter-lots :
- **F (marketing auto) dépend de E** (identité client + consentements réels + `email`) **et des adaptateurs messagerie** (tâche **F-1** ; BLOCKER programme G-7).
- **E4 (résa client)** et **D3 (board résa)** partagent la même RPC (0025/0030) + le blocage **anti-abus anon** (décision fondateur).
- **G4 (budget réel)** dépend de la remontée live de G6 (stock/achats) + G3 (caisse).

> **Échelle de priorité (unique pour TOUS les lots)** : uniquement `HAUTE` / `MOYENNE` / `BASSE`. La
> notion « priorité de lancement » du LOT A (ex-P0) est portée dans la **description** des tâches, pas
> dans la valeur de priorité. Aucun code `P0`/`P1`/`P2`/`P3` ni valeur composite dans les colonnes.
>
> **Espaces de noms d'identifiants (aucune collision)** : `E1`…`G6` = *fonctionnalités* de l'audit ;
> `A-1`…`G-6` = *tâches* de cette feuille de route ; la tâche de visualisation 3D rooftop porte
> l'identifiant distinct **`G-VIZ`**. **Les slots `G-7` et `G-8` NE SONT PAS des tâches** : ce sont des
> **BLOCKERS programme** (`docs/programme-club-one/BLOCKERS.md`) — `G-7` = « adaptateurs
> SMS/email/WhatsApp/paiements » (dont la **tâche** de construction est **F-1**).

---

## LOT A — SOCLE PRODUCTION ET STABILISATION  *(P0 — porte de lancement)*

Objectif : passer du niveau 4/5 (clone) au niveau 6 (production vérifiée), avec preuves indépendantes.

| # | Tâche | Type | Preuve visée | Priorité |
|---|---|---|---|---|
| A-1 | **GO/NO-GO cutover** (priorité de lancement) : trancher la contradiction inter-docs (GoTrue E2E / Realtime WS affirmés PASSED vs non vérifiés) — rejouer les 2 scripts et archiver la sortie | Vérif | niveau 5 re-jouable | HAUTE |
| A-2 | Exécuter le cutover `0008→0053` (priorité de lancement) sur base non-prod isolée fraîche (pas le clone déjà muté), bootstrap manuel intercalé, postflight | Migration (GO) | niveau 4 indépendant | HAUTE |
| A-3 | Ajouter un **garde-test statique** du texte SQL de 0044/0045/0053 (les 3 migrations sécu sans couverture) | Test | niveau 2 | HAUTE |
| A-4 | Corriger `rlsCutover.test.mts` qui assère les policies **0009 supersédées** (fausse confiance post-0045) | Test | niveau 2 | HAUTE |
| A-5 | Ajouter un script `npm test` **agrégé** (aujourd'hui absent → `npm test` échoue) + entrée CI | Outillage | niveau 2 | HAUTE |
| A-6 | Neutraliser la colonne mot de passe clair (action manuelle GO-gated, **en fenêtre de cutover**) + confirmer `auth_id` 100 % lié | Migration (GO) | niveau 6 | HAUTE |
| A-7 | Durcir OTP/anti-abus onboarding (dépend de E) + décision anti-abus résa anon | Décision + code | — | HAUTE |
| A-8 | Nettoyer résidus (`0054:` dans notices 0053 ; libeller cockpit=estimé) | Nettoyage | — | MOYENNE |

**Sortie de lot** : GO cutover prononcé, cutover prod exécuté et vérifié (niveau 6), suite de tests
agrégée et couvrant 0044/0045/0053.

---

## LOT B — COCKPIT DIRECTION ET PERSONNEL

Base ≈ 57 %. Le socle RH + cockpits est réel ; il reste à alimenter les tuiles et ajouter tâches/perf.

| # | Tâche | Statut de départ | Priorité |
|---|---|---|---|
| B-1 | Alimenter les 17/20 signaux « non branchés » du CommandCenter (présence, résa, checklists, leads…) depuis l'état déjà chargé — cible : COMPLETE_AND_UI_PROVEN | PARTIAL | HAUTE |
| B-2 | Câbler `ModeSoireeCockpit` en onglet réel (aujourd'hui preview) OU le retirer | FRONTEND_ONLY | MOYENNE |
| B-3 | Brancher une **marge réelle** au cockpit direction (coûts personnel/achats) au lieu de l'estimation | PARTIAL | MOYENNE |
| B-4 | Durcir la PII RH en **RLS colonne DB** (`taux_horaire`, `notes_direction`) — aujourd'hui app-side (risque PII important) | PARTIAL | MOYENNE |
| B-5 | **Tâches assignables** (nouvelle table + lib + écran) : à distinguer des checklists — décision produit | ABSENT | MOYENNE |
| B-6 | **Performance du personnel** (indice ponctualité/présence dérivé de `staff_shifts`) | ABSENT | BASSE |

---

## LOT C — AGENDA ET ORGANISATION DES SOIRÉES

Base ≈ 56 %. **Débloqueur clé = créer une soirée depuis l'UI** (C7) : plafond structurel de tout le lot.

| # | Tâche | Statut de départ | Priorité |
|---|---|---|---|
| C-1 | **Création / planification de soirée depuis l'UI** (RPC `create_event` + formulaire) — aujourd'hui SQL manuel seulement ; **débloqueur du lot** | ABSENT | HAUTE |
| C-2 | Transformer l'agenda en **vrai calendrier mensuel** (grille de mois, jours cliquables, nav mois±1) | PARTIAL | HAUTE |
| C-3 | UI de **composition des checklists** (`validateItemDraft`/`canManageChecklistItems` déjà en lib, non branchés) | PARTIAL | HAUTE |
| C-4 | UI de **création de fiche artiste** (aujourd'hui seulement `update` de lignes existantes) | PARTIAL | MOYENNE |
| C-5 | Câbler **Captation/DAM** en onglet réel + upload (aujourd'hui preview orphelin) | BACKEND_ONLY | HAUTE |

---

## LOT D — CRM ET IDENTITÉ CLIENT

Base ≈ 58 %. Socle guests/segmentation solide ; combler l'identité (email) et exposer les boards.

| # | Tâche | Statut de départ | Priorité |
|---|---|---|---|
| D-1 | Ajouter **colonne `email`** sur `guests` (aucune colonne email aujourd'hui — canal limité à WhatsApp/téléphone) — prérequis F5 | ABSENT | HAUTE |
| D-2 | **Chemin de saisie `spend_attributed`** (relier tables live `ClubTable` → `guests`) — sinon dépenses par client vides | PARTIAL | HAUTE |
| D-3 | Écran staff **fiche client → visites datées** (drill-down aujourd'hui client-only) | PARTIAL | MOYENNE |
| D-4 | Câbler le **board de demandes de réservation** staff (RPC 0025 prête, preview only) — voir tâche **E-2** (anti-abus anon partagé) | BACKEND_ONLY | HAUTE |
| D-5 | Câbler **leads / réputation / inbox triage** en onglets réels (backend + preview prêts) | FRONTEND_ONLY | HAUTE |
| D-6 | Colonne **préférences** structurée (musique/table/allergies) — partagé avec E2 | ABSENT | MOYENNE |
| D-7 | Écran d'édition directe d'une fiche guest (aucun écran d'édition aujourd'hui — création via funnel/RPC seulement) | ABSENT | BASSE |

---

## LOT E — PORTAIL CLIENT ET QR ONBOARDING

Base ≈ 36 %. L'onboarding QR marche ; **le reste du portail client est absent ou dormant.**

| # | Tâche | Statut de départ | Priorité |
|---|---|---|---|
| E-1 | **Renseigner la config consentement** (`NEXT_PUBLIC_CLUB_RAISON_SOCIALE`, cadence, URL politique) — sinon consentements **inertes/grisés** (bloquant RGPD) | PARTIAL | HAUTE |
| E-2 | **Réservation client réelle** : page anon `/resa/[slug]` appelant `request_table_reservation_v1` + **anti-abus** (captcha/OTP/jeton signé — décision fondateur) — backend prêt mais dormant | BACKEND_ONLY | HAUTE |
| E-3 | **Agenda du mois côté client** (RPC anon listant les events publiés + vue calendrier dans `/espace`) | ABSENT | HAUTE |
| E-4 | **Collecte des préférences** dans `/i/[token]` (partagé D-6) | ABSENT | MOYENNE |
| E-5 | **Durcir l'onboarding** : OTP/vérification téléphone (aucune vérification aujourd'hui — durcissement sécurité) | ABSENT | MOYENNE |
| E-6 | Décider du **compte client authentifié** vs token opaque (absent par design ; choix RGPD à documenter ; rotation/expiration du lien) | ABSENT | MOYENNE |
| E-7 | Gestion des invitations côté client (transfert, annulation, liste consolidée) | FRONTEND_ONLY | BASSE |

---

## LOT F — MARKETING AUTOMATISÉ ET FIDÉLITÉ

Base ≈ 26 %. **Le plus gros chantier de vision.** Dépend de E (identité + consentements + email) et
d'une décision fondateur sur les adaptateurs externes (coût/RGPD — tâche **F-1** ; BLOCKER programme G-7).

| # | Tâche | Statut de départ | Priorité |
|---|---|---|---|
| F-1 | **Infrastructure messagerie** : table `message_queue` + `lib/messaging/` + **adaptateurs SMS/email/WhatsApp** (Twilio/SendGrid/… — aujourd'hui ZÉRO dépendance) + tracking livraison/retry — **pièce maîtresse (linchpin) : bloque F-3 à F-7** | ABSENT | HAUTE |
| F-2 | **Scheduler** (cron/edge function) pour déclencher les relances | ABSENT | HAUTE |
| F-3 | **Relances anniversaires automatiques** (le calcul J-14 existe déjà en `crmCallList`, seul l'envoi manuel existe — l'auto manque) | PARTIAL | MOYENNE |
| F-4 | **Relances clients inactifs automatiques** (segment `dormant` déjà calculé, seul l'envoi manuel existe — l'auto manque) | PARTIAL | MOYENNE |
| F-5 | **Promo codes ciblés** : table `promo_codes` + génération/validation/redemption/limites/expiration + ciblage segment | ABSENT | HAUTE |
| F-6 | **Connecter la segmentation CRM (D6) aux campagnes** (audience/recipient table + join guests↔marketing_campaigns) | ABSENT | HAUTE |
| F-7 | **Moteur de fidélité/avantages** : table points/tiers/perks + accrual + redemption (zéro code aujourd'hui) | ABSENT | HAUTE |

> ⚠️ Prérequis RGPD/coût dur : aucun envoi automatisé sans consentement stocké et réellement recueilli
> (E-1) + décision fondateur sur les adaptateurs payants. Respecter la règle « aucun auto-envoi sans
> garde Évin/opt-out/consentement » déjà encodée dans le CRM.

---

## LOT G — FINANCE, REPORTING ET PILOTAGE GLOBAL

Base ≈ 57 %. P&L réel solide ; combler le reporting et le « réel » du budget/multi-espace.

| # | Tâche | Statut de départ | Priorité |
|---|---|---|---|
| G-1 | **Rapport promoteur correct** : remplacer la liste **codée en dur** `["mathias","quentin","lawrence"]` par un `distinct assigned_to` + brancher `lib/securityRevenue.ts` (orphelin) + agréger `promoter_guest_entries` | PARTIAL | HAUTE |
| G-2 | **Connecter le « réel » du budget** (G4) : alimenter `variance()` depuis caisse/charges/stock/maintenance (aujourd'hui « NON CONNECTÉ ») | PARTIAL | HAUTE |
| G-3 | **Rapport serveurs** (tables servies / dépenses par serveur) — inexistant | ABSENT | MOYENNE |
| G-4 | **Espace Cercle** de L'Arche (plan/seed) + vue occupation **multi-espace unifiée** temps réel | PARTIAL | HAUTE |
| G-5 | Enrichir le P&L comptable (achats/pertes/loyer) + rapprochement CA tables au niveau période | PARTIAL | MOYENNE |
| G-6 | Unifier la « vérité CA » : clarifier cockpit (dépenses tables, estimé) vs PnlView (Z réel, comptable) — consolidation partielle | PARTIAL | MOYENNE |
| G-VIZ | Câbler le rendu 3D rooftop (Eden) en prod si retenu (aujourd'hui preview) | FRONTEND_ONLY | BASSE |

---

## Synthèse d'effort (indicatif, non chiffré en €/jours sans mesure réelle)

| LOT | Reste-à-faire dominant | Poids stratégique |
|---|---|---|
| **A** | Cutover prod + preuves indépendantes + gardes tests sécu | **Bloquant lancement** |
| **B** | Alimenter tuiles + tâches/perf | Moyen |
| **C** | Créer une soirée (débloqueur) + calendrier + surfaces de création | Moyen-fort |
| **D** | email + saisie dépense + exposer boards | Moyen |
| **E** | Portail client (résa, agenda, préférences, consentements réels) | **Fort (client)** |
| **F** | Toute l'automatisation marketing + fidélité (from scratch) | **Le plus lourd** |
| **G** | Reporting correct + budget réel + multi-espace | Moyen |

**Message clé pour le fondateur** : Club One est aujourd'hui un **outil d'exploitation et de gestion
interne réel et à moitié mûr (~55 %)**, mais la **moitié « client + croissance » de la vision (portail
client, marketing automatisé, fidélité) reste largement à construire (~30 %)**, et le **socle n'est pas
encore prouvé en production**. Séquence recommandée : **A (prod) → B/C/D/G (finir l'interne) →
E (client) → F (marketing/fidélité)**.
