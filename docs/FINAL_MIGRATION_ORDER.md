# Club One — Ordre de migration FINAL (chaîne de cutover, déterministe)

> Source de vérité de l'ordre RÉEL appliqué au cutover. La production part de son **état réel pré-`0008`**
> (baseline). Le clone de re-rehearsal repart de cette **BASELINE RÉELLE PROD PRÉ-0008**
> (`supabase/rehearsal/baseline_prod_pre_0008.sql`, reconstruite en lecture seule depuis la prod) puis
> rejoue **exactement** cette chaîne.

## Chaîne AUTOMATIQUE (numérotée, `migrate`/apply en ordre croissant) — 46 migrations

```
BASELINE  supabase/rehearsal/baseline_prod_pre_0008.sql   (état réel prod pré-0008 ; en prod, déjà en place)
0008  event_scope_preparation
── (bootstrap manuel de la 1ʳᵉ soirée entre 0008 et 0009 — voir runbook B3) ──
0009  phase0b_rls_cutover                    ⚠ POINT DE NON-RETOUR
0010  caisse_z_stock
0011  rh_planning
0012  soiree_charges_artistes
0013  crm_clients_vip
0014  crm_funnel_qr
0015  crm_scan_porte
0016  crm_no_show_cloture
0017  octotable_import_provenance
0018  crm_guest_scores_historique
0019  crm_guest_space
0020  rh_self_confirm
0021  rh_staff_column_privacy
0022  events_format_learning
0023  incidents
0024  venue_tables
0025  table_reservation_requests
0026  internal_comms
0027  artist_checkin
0028  checklists
0029  captation
0030  resa_request_anon_hardening
0031  eden_plan_v2
0032  produits_bar_multi_venue_carte_eden    (UNE SEULE 0032 — collision levée)
0033  audit_log
0034  carte_management_rpc
0035  carte_produit_actif_rpc
0036  incidents_audit_trigger
0037  reservation_decision_audit
0038  artist_checkin_audit_trigger
0039  internal_comms_audit_trigger
0040  checklists_captation_audit_trigger
0041  rh_shift_audit_trigger
0042  enable_realtime_publication            (Realtime = 4 tables)
0043  revoke_truncate_and_legacy_login
0044  promoter_table_isolation
0045  server_scope_real_relation
0046  maintenance
0047  stock_inventory
0048  suppliers_purchasing
0049  commercial_pipeline
0050  marketing_campaigns
0051  budget_forecast
0052  active_event_venue                     (renuméroté depuis 0032 ; CREATE OR REPLACE get_active_event_context)
0053  revoke_anon_all_tables                 (défense en profondeur : anon = zéro grant de table)
```

Contiguë `0008 → 0053`, un numéro = un fichier, **aucune collision** (guard
`tests/migrationsRegistry.test.mts` vert). Bootstrap de la 1ʳᵉ soirée = **étape manuelle contrôlée**
entre `0008` et `0009` (précondition dure de `0009`).

## Action MANUELLE hors chaîne (mode B, GO fondateur)

```
supabase/manual_actions/neutralize_legacy_password.sql   (efface le mot de passe legacy en clair)
```

- **N'est PAS une migration** : hors `supabase/migrations/`, aucun `migrate up`/`db push`/runner ne
  l'exécute. Double garde : **phrase d'autorisation exacte** + **préflight bloquant** (`auth_id`).
- Purement **données** (n'affecte pas le schéma) → son exécution ou non ne change pas l'empreinte de
  schéma finale.

## Deltas de schéma attendus vs l'ancienne chaîne d'origine

| Delta | Origine | Nature | Impact schéma |
|---|---|---|---|
| position de `active_event_venue` (0032→0052) | levée de collision | réordonnancement | **nul** : seul définisseur de `get_active_event_context` (avec 0008), aucune fonction ne le référence → def finale identique |
| `0053 revoke_anon_all_tables` | durcissement | grants | anon perd tout grant de table (défense en profondeur) |
| `neutralize_legacy_password` (manuel) | sécurité | **données** | **nul** sur le schéma |

**Deltas de schéma INATTENDUS attendus : ZÉRO.** (cf. `docs/CUTOVER_REHEARSAL_RESULT.md` §Équivalence :
catégories déterministes cols/policies/grants/index/publication identiques à la référence ; corps de
fonctions issus verbatim des fichiers ; signatures+mode de sécurité (`fnsec`) stables.)

## Compteurs de schéma final (clone re-rehearsal, quiescé)

- tables 42 · fonctions 47 · policies 129 · PK 42 · FK 37 · UNIQUE 15 · CHECK 71 · triggers 10 ·
  publication Realtime 4 tables · anon 0 grant de table.
