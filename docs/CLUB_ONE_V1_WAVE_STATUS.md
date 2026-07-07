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
