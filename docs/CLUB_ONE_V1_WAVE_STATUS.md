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
- **RUNTIME_CLONE_PROOF_PENDING** → en cours de validation niveau 4 sur le LABO local.

### TASKS (tâches assignables, RLS username-scopée)
- **LOCAL_UI_AND_STATIC_BACKEND_COMPLETE**
- **RUNTIME_CLONE_PROOF_PENDING** → en cours de validation niveau 4 sur le LABO local.

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
