# Club One — Runbook de répétition de cutover (non-prod)

But : rejouer **fidèlement** le cutover de lancement sur un clone Supabase isolé, puis obtenir
`CLUB ONE AUTONOMOUS CUTOVER REHEARSAL PASSED`. La prod n'est jamais écrite.

Prérequis (à faire par le fondateur) : cf. section « Provisionnement ».

Niveau de preuve visé : 4 (exécution réelle sur base non-prod isolée) + 5 (front + rôles + Realtime).

---

## 0. Provisionnement (fondateur)

1. Créer un **nouveau projet Supabase non-production** (ex. `club-one-rehearsal`), région indifférente, plan dev/gratuit suffisant.
2. Re-pointer le MCP sur ce projet : remplacer `--project-ref` (ou l'entrée `.mcp.json`) par le **nouveau project_ref**, puis relancer le MCP / la session.
3. Vérif que le re-pointage a pris : `get_project_url` doit renvoyer la **nouvelle** URL (≠ `xsotmjnaffaibgqgookt`). Tant que ce n'est pas le cas, **STOP — ne rien appliquer**.

Garde-fou d'exécution : avant tout `apply_migration`, je revérifie `get_project_url`. Si l'URL == prod → abort immédiat.

---

## 1. Reproduire l'état prod (baseline ~0007) sur le clone

Objectif : partir de l'état réel de la prod pour que `0008→0051` soit un vrai cutover (idempotence sur objets existants), pas un apply à blanc.

1. `apply_migration` de `0001_auth_hashing.sql` → `0007_atomic_operations_hardening.sql` dans l'ordre.
   (`0000_inspect_schema.sql` = inspection, non structurant : appliquer seulement si nécessaire.)
2. Seed représentatif (données synthétiques, **aucune PII prod copiée**) :
   - 10 `staff_users` couvrant les 6 rôles + comptes Auth correspondants (mots de passe de test locaux, jamais ceux de prod).
   - quelques `club_tables` (18), `venues` (3), `entry_logs`, `promoter_contacts`, `promoter_guest_entries` pour tester l'isolation.
3. Snapshot baseline : `list_tables`, `pg_policies`, count par table → comparer au `backups/prod-structural-snapshot-2026-07-05.md`. Doit correspondre (8 tables, RLS `co_phase0b_*`, RPC historiques).

## 2. Cutover sous test : appliquer 0008 → 0052

Ordre = numéro croissant. **Collision 0032 RÉSOLUE** (paquet de bascule prod, cf.
`docs/MIGRATIONS_REGISTRY.md` §3) : `active_event_venue` renuméroté **`0052`** (appliqué en fin de
chaîne), `0032_produits_bar_multi_venue_carte_eden.sql` conserve `0032`. Plus aucun doublon —
application par simple ordre numérique croissant `0008 → 0052`.
(La 1ʳᵉ répétition, 2026-07-06, a appliqué la chaîne AVANT résolution — cf. `docs/CUTOVER_REHEARSAL_RESULT.md` ;
la re-répétition post-renumérotation prouve l'équivalence du schéma final.)

Pour chaque migration :
- `apply_migration` (name = nom de fichier snake_case, query = contenu).
- Si échec → consigner l'erreur, corriger **sur le clone uniquement**, relancer. Recommencer jusqu'à série complète propre.
- Après les migrations à verification associée, exécuter le fichier `supabase/verification/<n>_*.sql` correspondant (read-only) et vérifier les assertions.

Points de contrôle spéciaux :
- **0009** (cutover RLS) : exécuter `supabase/verification/0009_preflight_readonly.sql` AVANT, puis `0009`, puis `0009_postflight_readonly.sql`. Vérifier que les policies `co_phase0b_anon_*` permissives ont disparu et que `anon` perd DELETE/UPDATE/TRUNCATE.
- **0042** : vérifier que la publication `supabase_realtime` contient bien les 4 tables ciblées : `club_tables`, `entry_logs`, `promoter_contacts`, `promoter_guest_entries`.
- **0043** : vérifier révocation TRUNCATE + login legacy.
- **0044/0045** : isolation promoteur + relation server réelle.

## 3. Tests fonctionnels — 7 rôles (niveau 5)

Matrice (source de vérité : `lib/permissions.ts` + policies) sur le clone, via JWT réels par rôle :

| rôle | doit voir | doit être refusé |
|---|---|---|
| admin | tout (18 tables, QR, stats, clôture) | — |
| manager | tout | — |
| promoter | tables (selon décision isolation), ses contacts/invitations, dépenses | QR, Sécurité, Flux, Stats, clôture |
| server | tables non assignées / assignées jeremy·server, dépenses | assignation, QR, gestion globale |
| security | onglet Sécurité via `get_security_table_snapshot()`, QR | accès direct club_tables, dépenses |
| security_counter | Flux (compteur + QR) | modif résa, dépenses, Promoteurs |
| (7e : à confirmer) | selon `staff_users` réel du clone | — |

Note : la prod n'a que 6 rôles distincts (admin, manager, promoter, security, security_counter, server). Le « 7e rôle » de la mission est à clarifier avec le fondateur (variante server `jeremy` ? guest/anon public ?). Consigner la réponse ici.

Contradiction ouverte à trancher (mémoire `promoter-visibility-contradiction`) : le **code** cantonne le promoteur alors que **doc-50** dit « voit les 18 tables ». Décision fondateur requise avant de figer le test d'isolation promoteur.

## 4. Isolation promoteur + concurrence

- 2 promoteurs distincts : chacun ne voit/modifie que son périmètre (invitations/contacts), jamais ceux de l'autre.
- Concurrence dépenses : deux `add_expense_v3` simultanées sur la même table → pas de perte (anti-perte optimiste, cf. commit `81cdde5`).
- QR : `create_promoter_invitation_v2` génère le token côté Postgres (`gen_random_uuid()`), jamais fourni client.

## 5. Realtime (niveau 5)

- S'abonner (client anon+JWT) aux 4 tables publiées ; provoquer un INSERT/UPDATE ; vérifier réception temps réel par un rôle autorisé et **non-réception** par un rôle non autorisé (isolation Realtime = RLS).

## 6. Cycle de vie événementiel

- `bootstrap_club_event_v2` (première soirée, `bootstrap_completed_at IS NULL`).
- Activité (dépenses, entrées, QR).
- `close_club_event_v2` (atomique : archive + CA/entrées/sorties + reset tables + `active_event_id=null`).
- `activate_club_event_v2` (soirée suivante).
- Vérifier `get_active_event_context()` pilote bien bootstrap vs activate (jamais via message d'erreur).

## 7. Rollback documenté

- Plan de rollback prod = restauration PITR / backup managé Supabase (à confirmer selon plan) + réf structurelle `backups/prod-structural-snapshot-2026-07-05.md`.
- Sur le clone : `reset_branch` / re-création projet pour repartir propre entre deux répétitions.
- Documenter ici la procédure exacte testée avant tout GO prod.

## 8. Critères de succès (PASSED)

- [ ] Baseline prod reproduite sur clone (8 tables, RLS co_phase0b, RPC historiques).
- [ ] 0008→0051 appliquées sans erreur (collision 0032 gérée), verifications vertes.
- [ ] 0009 preflight/postflight OK ; anon verrouillé.
- [ ] 7 rôles conformes à la matrice ; refus effectifs côté RLS/RPC (pas seulement UI).
- [ ] Isolation promoteur + concurrence dépenses + QR côté serveur OK.
- [ ] Realtime : réception autorisée / non-réception non autorisée.
- [ ] Cycle bootstrap→close→activate OK et atomique.
- [ ] Rollback documenté et vérifié.
- [ ] Prod jamais écrite (chaque apply précédé du garde `get_project_url != prod`).

Statut final visé : **CLUB ONE AUTONOMOUS CUTOVER REHEARSAL PASSED** — en attente du GO CUTOVER PRODUCTION.
