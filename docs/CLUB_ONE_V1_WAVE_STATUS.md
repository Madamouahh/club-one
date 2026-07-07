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
BUILD ✅ · TYPECHECK ✅ · SUITE 1026/1026 (+1 skip pré-existant) · MIGRATIONS 0054-0060 appliquées+
vérifiées niveau 4 sur LABO local · PRODUCTION jamais touchée · aucun push · aucun merge.

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
