# 50 — Domaine Club One

## Roles et matrice d'acces (resume — source de verite : `lib/permissions.ts` + policies SQL)

- **admin / manager** : acces complet, 18 tables, tous les onglets, QR, statistiques, cloture/reset global.
- **promoter** : voit les 18 tables (modif/assignation), depenses, ses propres contacts/invitations ; pas de QR, pas de Securite, pas de Flux, pas de Stats, pas de cloture globale.
- **server** : uniquement les tables non assignees ou assignees a `jeremy`/`server` ; peut modifier ces tables et ajouter des depenses ; ne peut pas assigner ; pas de QR, pas de gestion globale.
- **security** : `canViewAllTables` reste `false` ; onglet Securite uniquement, via `get_security_table_snapshot()` (jamais d'acces direct a `club_tables`) ; QR autorise ; aucune depense/modification de reservation.
- **security_counter** : onglet Flux uniquement, compteur + QR ; aucune modification de reservation ni depense ; aucun acces Promoteurs.

## Cycle de vie evenementiel (event scope)

- Table singleton `public.club_runtime_state` : `active_event_id`, `bootstrap_completed_at`, `last_closed_event_id`.
- **Bootstrap** (`bootstrap_club_event_v2`) : uniquement si `bootstrap_completed_at IS NULL` (premier lancement jamais fait).
- **Activation** (`activate_club_event_v2`) : uniquement si `bootstrap_completed_at IS NOT NULL` et `active_event_id IS NULL` (apres une cloture).
- Le front ne choisit jamais bootstrap vs activate en analysant un message d'erreur : la decision vient du contexte serveur (`get_active_event_context()` / `chooseActiveEventLifecycleAction()`).
- Statuts d'evenement valides pour bootstrap/activation : `draft`, `published`. Toujours refuser `archived` et tout statut inconnu.
- **Cloture** (`close_club_event_v2`) : operation atomique unique (archive, calcule CA/entrees/sorties, reset des tables, `active_event_id = null`, `last_closed_event_id` renseigne). Le front n'enchaine plus manuellement insert-archive puis reset.

## RPC historiques vs versionnees

- Historiques a preserver tant que l'ancien front peut encore les utiliser : `add_expense_v2`, `check_in_invitation`, inserts directs sur `entry_logs` / `promoter_guest_entries` / `event_archives`.
- Versionnees (nouveau front, dans `0008`) : `add_expense_v3`, `check_in_invitation_v2`, `add_entry_log_v2`, `create_promoter_invitation_v2`, `bootstrap_club_event_v2`, `activate_club_event_v2`, `close_club_event_v2`, `get_active_event_context`, `list_activatable_club_events`, `get_security_table_snapshot`.
- `create_promoter_invitation_v2` genere le token QR **cote PostgreSQL** (`gen_random_uuid()`), jamais fourni par le client.
- Seule `0009` revoque l'usage `authenticated` des RPC historiques ; `0008` ne casse jamais l'ancien front.

## Statut des migrations (a tenir a jour ici et dans `docs/CLAUDE_HANDOFF.md`)

- `0003` a `0007` : appliquees manuellement sur la base operationnelle.
- `0008_event_scope_preparation.sql` : ecrite, revue statiquement, **non executee**.
- `0009_phase0b_rls_cutover.sql` : ecrite, revue statiquement, **non executee**.
- Prochaine cible : projet Supabase non-production isole, pas la base operationnelle.
