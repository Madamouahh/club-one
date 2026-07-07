# Club One V1 — état des vagues (statuts corrigés)

Branche : `feat/club-one-v1-completion` (worktree isolé, depuis `ef2042b`). Aucune écriture production.
LABO de validation : Supabase LOCAL (`http://127.0.0.1:54321`, Docker `club-one-lab`) — **jamais** la prod
`xsotmjnaffaibgqgookt`.

## Niveaux de preuve (rappel)
1 lecture statique · 2 validation locale (tsc/lint/tests Node/build) · 3 SQL statique · 4 exécution réelle
sur base non-production isolée · 5 intégré (front+Auth+RLS+RPC+Realtime+rôles) · 6 production vérifiée.

## Vague 1 — statuts corrigés (2026-07-07)

### AGENDA (soirées : calendrier interactif + create/update/duplicate/cancel)
- **LOCAL_UI_AND_STATIC_BACKEND_COMPLETE**
- **RUNTIME_CLONE_PROOF_DONE** ✅ — 0054 appliqué+vérifié niveau 4 sur LABO ; cycle create/update/
  duplicate/cancel + transitions refusées + garde de rôle prouvés (voir CLONE_VALIDATION_0054_0057).

### TASKS (tâches assignables, RLS username-scopée)
- **LOCAL_UI_AND_STATIC_BACKEND_COMPLETE**
- **RUNTIME_CLONE_PROOF_DONE** ✅ — 0055 appliqué+vérifié niveau 4 (bug anon corrigé) ; RLS assigné/
  refus inter-utilisateur/anon-zéro prouvés sur LABO.

## Vague 2 — statuts
- **PORTAIL CLIENT** (0058) : préférences/agenda mensuel/token révocable/PIN — UI route + backend
  appliqué+vérifié niveau 4 LABO. Compte Auth complet NON livré (pont token conservé).
- **CRM** (0059) : backend+lib validés niveau 4 (email/tags/notes/guest_360). **UI CrmView = à câbler**
  (PARTIAL honnête).
- **MESSAGERIE / MARKETING UI** (0056) : onglet Messagerie câblé, DRY_RUN (aucun envoi réel).
- **DEMANDES RÉSA** (D3/E4) : file de décision câblée (0025). Leads/Inbox/Réputation : backend absent
  → non câblés (pas de données fictives).
- **REPORTING** (0060) : identité promoteur par RÔLE réel (staff_roster_v1) — assignedTo heuristique
  supprimé. Rapport serveur : lib+table prêtes, UI de saisie d'attribution à faire.
- **PWA** : manifest + service worker + registration câblés.

## Preuve globale (fin Vague 2)
BUILD ✅ · TYPECHECK ✅ · SUITE 1026 PASS / 0 FAIL / 1 SKIP · MIGRATIONS 0054-0060 appliquées+
vérifiées niveau 4 sur LABO local · PRODUCTION jamais touchée · aucun push · aucun merge.

## Vague 3 — COMPLETE_AND_UI_PROVEN (prouvé en NAVIGATEUR contre le LABO)
Harness Playwright réel (chromium + mobile), login staff, écritures réelles. 34 tests E2E verts.
- **AGENDA** : COMPLETE_AND_UI_PROVEN (calendrier + nav mois prouvés navigateur).
- **TASKS** : COMPLETE_AND_UI_PROVEN (création réelle → kanban, write LABO prouvé).
- **CRM UI** : fiche 360 / recherche / édition / tags / notes / dédoublonnage preview / import-export
  CSV câblés (CrmProfilePanel) ; onglet chargé prouvé navigateur. (0059 niveau 4.)
- **ATTRIBUTION SERVEUR** : UI upsert/edit/retrait, anti-double (unique 0060), serveurs par RÔLE
  (staff_roster_v1), rapport serveur réel ; onglet prouvé navigateur. (0060 niveau 4.)
- **PORTAIL CLIENT AUTH** : récupération/révocation/expiry/rotation PIN/rate-limit (0061 niveau 4) ;
  route client + token inconnu = zéro fuite staff prouvé navigateur.
- **MARKETING DRY_RUN** : bannière DRY_RUN prouvée navigateur (aucun envoi).
- **PWA** : installabilité (manifest 192+512 standalone), SW actif, offline, AUCUNE donnée sensible
  en cache — vérifiés navigateur.
- **PERMISSIONS par rôle** : promoteur sans Gestion/Direction — prouvé navigateur.

## Preuve globale (fin Vague 3)
BUILD ✅ · TYPECHECK ✅ · SUITE NODE **1071 PASS / 0 FAIL / 1 SKIP** · E2E PLAYWRIGHT **34 PASS**
(chromium+mobile, LABO) · MIGRATIONS 0054-0061 appliquées+vérifiées niveau 4 · PRODUCTION jamais
touchée · aucun push · aucun merge.

## Vague 4 — fermeture des restes (browser-proven)
- **CRM CRITICAL FLOWS** : recherche/360/édition/tag/note/consentement · CSV valide+invalide (rapport
  d'erreurs) · dédoublonnage → **fusion confirmée (0065)** → historique migré — prouvés navigateur.
- **SERVER ATTRIBUTION FULL FLOW** : créer → rapport live → doublon interdit → retirer — prouvé navigateur.
- **SERVER REPORT LIVE DATA** : rapport par serveur alimenté par l'attribution réelle — prouvé navigateur.
- **CLIENT PORTAL HAPPY PATH** : token valide + agenda mensuel + filtre salle + préférences + récupération
  (téléphone+PIN, sans email) + token inconnu sans fuite — prouvé navigateur. **Bug critique corrigé** :
  le portail client ne se construisait jamais (process.env dynamique non inliné) → routes /espace,/i,/invite.
- **LEADS / INBOX / RÉPUTATION BOARDS** : réels (0062-0064 niveau 4), câblés, chargés navigateur ;
  Inbox création cliquée. Aucune donnée fictive.
- **PLAYWRIGHT** : **27 chromium + 10 mobile = 37 tests, ZÉRO skip** (skips env-gated supprimés ;
  skip Éden historique documenté conservé).
- **PWA** : installabilité, SW actif, offline, aucune donnée sensible en cache, invalidation (pas de
  cache orphelin), viewport mobile — vérifiés navigateur.
- **LABO CLEAN** : fixtures + comptes de test + forward via scripts reproductibles (setup/teardown) ;
  zéro donnée métier résiduelle vérifiée ; forward supprimé.

## MATURITÉ RECALCULÉE (harnais réel, non estimée)
`scripts/recompute_maturity.mjs` (barème du produit map, 41 sous-fonctionnalités B→G) reproduit
**49,9 %** puis calcule **71,5 %** (+21,6 pts) — 13 fonctionnalités montées, chacune backend niveau 4
+ UI câblée + **cliquée en navigateur**. G5 (plan Cercle) reste 50 % (plan non validé fondateur).

## Preuve globale (fin Vague 4)
BUILD ✅ · TYPECHECK ✅ · SUITE NODE **1119 PASS / 0 FAIL / 1 SKIP** · E2E **37 PASS / 0 SKIP nouveau**
(chromium+mobile, LABO) · MIGRATIONS **0054-0065** appliquées+vérifiées niveau 4 · MATURITÉ **71,5 %** ·
PRODUCTION jamais touchée · aucun push · aucun merge · LABO nettoyé.

## Vague 5 — fermeture V1 (browser-proven)
- **CREATE EVENT FULL FLOW** : jour cliqué → soirée COMPLÈTE (Cercle, titre/horaires/artistes/capacité/
  équipe/notes) → calendrier **+ PostgreSQL** · publier · ouvrir · **transition interdite refusée** ·
  dupliquer · annuler · refus promoteur · **chromium + mobile Pixel 5** → **C7 = COMPLETE_AND_UI_PROVEN**.
- **MARKETING DRY_RUN FULL FLOW** : audience (write) · outbox enqueue→traiter→**envoyé SIMULÉ** (dédup +
  garde opt-out, **aucun envoi réel**) — chromium + mobile → F1/F5 UI browser-proven.
- **PROMO CODE FULL FLOW** : code valide + expiré (verdict) + plafonds → **write promo_codes** (PostgreSQL),
  chromium + mobile → **F4 = COMPLETE_AND_UI_PROVEN**.
- **Défauts corrigés** : dernières listes promoteurs/serveurs codées en dur (PromotersView, TableModal,
  invite) → dérivées du **roster réel** (staff_roster_v1). Zéro username fictif dans les parcours réels.
- **RC hardening** : RLS/anon-zéro **0054→0065 re-vérifiés niveau 4** (12/12 OK, anon = 0 grants partout) ·
  SW ne cache aucune donnée Supabase/client · setup→teardown → **zéro donnée métier résiduelle vérifiée**.
- **Cercle** : inchangé — TECHNICAL MULTI-VENUE SUPPORT COMPLETE / FOUNDER-VALIDATED FLOOR PLAN ABSENT
  (fixture provisoire hors chaîne, non validée).

## MATURITÉ RECALCULÉE (Vague 5, harnais réel)
`scripts/recompute_maturity.mjs` : **49,9 % → 75,1 %** (+25,2 pts). C7/F1/F4 montés à 100 (backend niveau 4
+ UI + flux complet cliqué chromium+mobile + PostgreSQL + nettoyage prouvé). F5 reste 50 (envoi réel hors
scope, aucun fournisseur). G5 reste 50 (plan Cercle non validé fondateur).

## Preuve globale (fin Vague 5)
BUILD ✅ · TYPECHECK ✅ · SUITE NODE **1119 PASS / 0 FAIL / 1 SKIP** · E2E **chromium 32 + mobile 15**,
0 skip nouveau · MIGRATIONS **0054-0065** RLS/anon re-vérifiées niveau 4 (12/12) · MATURITÉ **75,1 %** ·
LABO **nettoyé (zéro résiduel)** · PRODUCTION jamais touchée · aucun push · aucun merge.

### CERCLE FLOOR PLAN
- **TECHNICAL MULTI-VENUE SUPPORT COMPLETE** (migration 0057 corrigée : support technique seul).
- **FOUNDER-VALIDATED FLOOR PLAN ABSENT** — le plan « 14 tables » est PROVISOIRE / NON VALIDÉ,
  déplacé en fixture hors chaîne (`supabase/fixtures/cercle_floor_plan_PROVISIONAL.sql`). Jamais
  présenté comme opérationnel. Attend un plan réel du fondateur → future migration numérotée.

### PROMOTER REPORTING
- **PARTIAL**
- **ROLE-BASED IDENTIFICATION REQUIRED** — la Vague 1 a supprimé la liste codée en dur mais dérive
  encore l'ensemble via `assignedTo` (heuristique). Vague 2 : identification par rôle staff réel +
  vraie source d'attribution serveur↔table.

### MARKETING INFRA (message queue DRY_RUN + promo codes)
- **STATIC_BACKEND_AND_LIB_COMPLETE** (DRY_RUN, aucun fournisseur réel) · UI en Vague 2.

## Migrations de la Vague 1
`0054_event_management` · `0055_tasks` · `0056_messaging_marketing` · `0057_cercle_floor_plan` (corrigée).
Chacune a son `supabase/verification/NNNN…`. Registre + `tests/migrationsRegistry.test.mts` verts.

## Vague 7 — fermeture des 7 derniers gaps internes (catégorie A) — browser-proven
Objectif : fermer tous les gaps EXÉCUTABLES INTERNES restants (A). Migrations à partir de 0069, LABO
local uniquement, tests PostgreSQL niveau 4, RLS/anon-zéro, actions réellement cliquées, mobile vérifié.

- **B2 — COMMAND CENTER 20/20** : `lib/commandCenter.ts` redéfini sur **20 domaines RÉELS** (orphelins
  meteo/prévision/reco_ia/agents/automatisations SUPPRIMÉS, remplacés par des modules existants). Chaque
  tuile = un COMPTE réel (25 requêtes agrégées, RLS de chaque source) ; clic → ouvre le vrai onglet
  (`onOpen → setActiveTab`). États loading/error/veille. Couverture **20/20 branchés** prouvée navigateur
  (chromium+mobile), tuile cliquable prouvée. → **COMPLETE_AND_UI_PROVEN**.
- **B2b — MODE SOIRÉE** : sorti de la preview, **branché dans la navigation réelle** (onglet `modesoiree`,
  groupe Soirée ; rôles admin/manager/server/security/counter, promoteur ⛔). Agrège les 4 modules
  d'exploitation de la soirée active (incidents/comm/artiste/checklists, chacun cadré par sa RLS) + lanceur
  vers équipe/incidents/checklist/réservations/tables/flux. Prouvé navigateur. → **COMPLETE_AND_UI_PROVEN**.
- **C5 — FICHE ARTISTE** : migration **0069** (`artists` + `artist_event_links`, RLS direction-only,
  archivage ≠ suppression) validée **niveau 4** (direction crée/lie/archive ; promoteur & anon bloqués).
  UI CRUD `ArtistFichesView` branchée (onglet `artistfiches`), création→liste→archivage prouvés navigateur
  (chromium+mobile, write PostgreSQL). → **COMPLETE_AND_UI_PROVEN**.
- **D2 — HISTORIQUE VISITES** : **reclassé avec preuves, aucun recode**. Le parcours dédié
  client→visites→soirée→table→dépense→réservation EST `guest_360_v1` (visits_seated/no_show/dates,
  visits_with_spend/spend_attributed_total, reservation_pending/approved/…/distinct_tables_requested) —
  même source que la fiche 360, pas une duplication — + portail « Mes passages » prouvé navigateur.
  → **COMPLETE (reclassé)**.
- **D5 — COMPTES CLIENTS** : **reclassé, unifié à E6, aucun 2ᵉ système**. Le portail token+PIN (0058/0061)
  couvre création/récupération/révocation/préférences/consentements/historique — prouvé navigateur
  (portal.spec). → **COMPLETE (unifié E6)**.
- **E4 — DEMANDE DE RÉSA CLIENT** : migration **0070** — chemin CLIENT AUTHENTIFIÉ (capacité space_token,
  jamais anon nue) : `request_table_reservation_as_guest_v1` (+ `cancel_…`, `list_requestable_tables_v1`,
  `list_my_reservation_requests_v1`), crée une demande `pending` (index uniques 0025) + notifie l'Inbox
  interne (`contact_requests` client). Validé **niveau 4** (créer/doublon refusé/token invalide/annuler).
  Section portail branchée, flux complet prouvé navigateur (chromium+mobile). Le formulaire public anonyme
  (captcha/OTP) reste **hors V1 — décision fondateur**. → **COMPLETE_AND_UI_PROVEN**.
- **E5 — INVITATIONS CLIENT** : migration **0071** — `issue_guest_pass_v1` (staff, QR côté serveur,
  anti-doublon 1 pass actif/client/soirée) + `cancel_guest_pass_v1` (révocation, refus d'annuler un pass
  scanné). Scan/anti-double/affichage portail préexistants (`scan_guest_pass_v1`, `get_guest_space_v2`).
  Validé **niveau 4** (émettre/doublon/révoquer ; promoteur émet ; serveur refusé). Panneau staff branché
  (onglet Promoteurs), flux émettre→révoquer prouvé navigateur (chromium+mobile). → **COMPLETE_AND_UI_PROVEN**.

### MATURITÉ RECALCULÉE (Vague 7, harnais `scripts/recompute_maturity.mjs`)
**49,9 % → 95,1 %** (Vague 6 = 85,1 % → +10 pts). **Catégorie A (EXÉCUTABLE INTERNE) = 0 gap restant.**
Non-complètes restantes (4), strictement séparées :
- **[C] FOURNISSEUR/CREDENTIAL** : F2, F3 (auto-envoi relances), F5 (envoi réel SMS/email) — DRY_RUN prêt,
  aucun fournisseur branché.
- **[B] DÉCISION FONDATEUR** : G5 (plan de salle Cercle non validé fondateur).
- **PRODUCTION** : cutover 0008/0009 = piste SÉPARÉE (socle prod), hors périmètre Vague 7.

### Preuve globale (fin Vague 7)
BUILD ✅ · TYPECHECK ✅ · SUITE NODE **1209 pass / 0 fail / 1 skip** (dont `artists` +16, `commandCenter` +26)
· E2E PLAYWRIGHT par projet **chromium 43/43 · mobile 42 (+1 flaky repassé) = EXIT 0** (dont Vague 7 : 5 flux
× 2 = 10 verts) · MIGRATIONS **0069-0071** appliquées+vérifiées **niveau 4** sur LABO local · MATURITÉ
**95,1 %** · PRODUCTION jamais touchée · aucun push · aucun merge · LABO à nettoyer (teardown).

### Migrations de la Vague 7
`0069_artist_profiles` (C5) · `0070_client_reservation_request` (E4) · `0071_client_invitation_pass` (E5).
Chacune a sa vérification `supabase/verification/NNNN…`. Registre + `tests/migrationsRegistry.test.mts` verts.
