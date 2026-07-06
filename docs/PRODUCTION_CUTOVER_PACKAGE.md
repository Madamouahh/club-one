# Club One — Paquet de bascule production (manifeste)

> **État : PRÉPARATION. Aucune écriture production. Aucun cutover exécuté. GO NON donné.**
> Ce paquet réunit tout ce qu'exige une décision GO/NO-GO fondateur. Le cutover n'est exécuté
> qu'après un **`GO CUTOVER PRODUCTION`** explicite (aucune formulation approchante ne vaut autorisation).

## 1. Périmètre

- **Cible** : projet Supabase de production `xsotmjnaffaibgqgookt` (état actuel : **pré-`0008`**, ancien
  modèle, ancien front encore fonctionnel).
- **Objet** : appliquer la chaîne événementielle **`0008 → 0053`** (46 fichiers de migration) qui fait
  passer au nouveau front event-scoped, verrouille la RLS finale, livre les verticaux de gestion, et
  durcit la sécurité (anon zéro grant). **PLUS** une **action manuelle GO-gated** (neutralisation du mot
  de passe legacy, hors chaîne — `supabase/manual_actions/`, mode B).
- **Non inclus** : suppression de la colonne `password` (migration ultérieure différée, après période
  de sécurité — cf. `docs/LEGACY_PASSWORD_AUDIT.md`).

## 2. Chaîne de migrations (ordre numérique strict)

46 fichiers : `0008`, `0009`, `0010`→`0052` (43 fichiers ; **une seule** `0032` = produits_bar depuis
la levée de collision), `0053`. Détail complet : `docs/FINAL_MIGRATION_ORDER.md`.

| Segment | Rôle | Remarque |
|---|---|---|
| `0008` | Préparation event-scope (non destructif) | l'ancien front continue de fonctionner |
| **bootstrap** | 1ʳᵉ soirée activée (RPC `bootstrap_club_event_v2`) | **étape manuelle contrôlée**, entre 0008 et 0009 |
| `0009` | Cutover RLS final event-scoped | **POINT DE NON-RETOUR** (anon révoqué, ancien front cesse) |
| `0010`→`0052` | Verticaux (stock, RH, CRM, plan, incidents, comms, checklists, captation, carte, audit, maintenance, fournisseurs, commercial, marketing, budget, exposition venue) | additifs, RLS fail-closed |
| `0053` | anon = zéro grant de table (défense en profondeur) | correctif du harness de contrat |
| **manuel** | Neutralisation mot de passe legacy (`supabase/manual_actions/`) | **mode B, GO fondateur, HORS chaîne** ; données only |

Collision `0032` **résolue** : `active_event_venue` → `0052`. Voir `docs/MIGRATIONS_REGISTRY.md` §3.

## 3. Preuves jointes (niveaux atteints)

| Preuve | Artefact | Niveau | Résultat (clone `fhpttgtjxpzexvwtylhv`, 2026-07-06) |
|---|---|---|---|
| Chaîne renumérotée re-répétée sur clone vierge | re-run 2026-07-06 (reset→baseline→0008…0053) | 4 | ✅ 46 migrations appliquées ; 42 tables / 47 fn / 129 pol |
| Équivalence du schéma final | §5 | 4 | ✅ 5 catégories déterministes MATCH ; 0 delta structurel inattendu |
| Contrat post-cutover exécutable | `supabase/verification/cutover_contract_harness.sql` | 4 | ✅ `CONTRACT HARNESS OK` |
| Smoke fonctionnel (7 rôles/isolation/QR/lifecycle) | `supabase/verification/cutover_functional_harness.sql` | 4/5 | ✅ PASS + **zéro résidu** (rollback vérifié) |
| Login GoTrue bout-en-bout | `scripts/gotrue-e2e.mjs` | 5 | ✅ 6 rôles : login/JWT/rôle/RLS/refresh/logout, `ok:true` |
| Realtime WebSocket bout-en-bout | `scripts/realtime-e2e.mjs` | 5 | ✅ admin reçoit tout · promoter isolé (T03 oui, T05 non) · reconnexion, `ok:true` |
| Durcissement anon (0053) | régressions | 4 | ✅ anon 0 grant/0 policy · RPC publiques OK · SECDEF search_path OK |
| Audit mot de passe legacy | `docs/LEGACY_PASSWORD_AUDIT.md` | 1+4 | ✅ aucun code/RPC ne lit le clair ; login = GoTrue |
| Guard numérotation migrations | `tests/migrationsRegistry.test.mts` | 3 | ✅ 7/7 |

## 4. Documents du paquet

- `docs/PRODUCTION_PREFLIGHT_CHECKLIST.md` — à cocher AVANT (fenêtre, sauvegarde, PITR, gel écritures…).
- `docs/PRODUCTION_CUTOVER_RUNBOOK.md` — commandes exactes, ordre, point de non-retour, critères d'arrêt.
- `docs/PRODUCTION_ROLLBACK_RUNBOOK.md` — déclencheur, délai, actions PITR/code/variables, écritures entre-deux.
- `docs/PRODUCTION_POST_CUTOVER_VERIFICATION.md` — validations APRÈS (7 rôles, résa, dépense, QR, Realtime…).

## 5. Équivalence de schéma (renumérotation neutre) — PROUVÉE

Re-répétition sur clone vierge (reset → baseline réelle pré-0008 → **exacte chaîne renumérotée**
`0008…0053` + bootstrap manuel). Empreinte structurelle (md5, **données exclues**) comparée à la
référence de la 1ʳᵉ répétition.

**Catégories DÉTERMINISTES — identiques à la référence (byte-for-byte) :**

| catégorie | md5 (référence == re-run) | verdict |
|---|---|---|
| colonnes (type/nullability/default) | `265c00c0…742b23` | ✅ MATCH |
| policies + RLS | `0650a4a0…738fbc` | ✅ MATCH |
| grants (table) | `3820e7fc…62d9c0` | ✅ MATCH |
| index (incl. PK/unique) | `30c418a1…c049bf` | ✅ MATCH |
| publication Realtime | `68695a95…c70576` | ✅ MATCH |
| **compteurs** | 42 tables · 47 fonctions · 129 policies | ✅ identiques |

**Empreinte complète autoritative** (clone re-rehearsal quiescé — inventaire de référence pour la
vérification post-cutover prod) : `pk=921c27ef` (42) · `fk=8df97f18` (37) · `unique=a412511f` (15) ·
`check=55ada275` (71) · `rls=6a44eba4` · `triggers=246d40fd` (10) · `fnsec=3de42a6c` (signatures +
mode de sécurité + search_path + type retour).

**Deltas ATTENDUS** : `0052` (get_active_event_context expose venue) · `0053` (anon 0 grant) ·
action manuelle password (données, hors schéma).
**Deltas structurels INATTENDUS : ZÉRO.**

**Note honnête sur `fns_md5` (corps de fonction sérialisé, `pg_get_functiondef` agrégé)** : montre un
résidu entre les DEUX clones de répétition. Investigué et **écarté comme non-structurel** : (a) **aucune**
fonction ne référence `get_active_event_context` → le réordonnancement ne peut pas se propager ; (b) sa
définition finale expose bien venue ; (c) les attributs structurels des fonctions (`fnsec` : signature,
SECURITY DEFINER, search_path, type retour) sont **stables et cohérents** ; (d) `pg_get_functiondef`
agrégé est **sensible à l'activité concurrente** (churn d'OID quand un agent réapplique des
`create or replace`) — la valeur n'est stable que sur un clone **quiescé**. Le corps des fonctions vient
**verbatim** des fichiers de migration identiques. → artefact de build de la 1ʳᵉ répétition (tests
manuels intensifs), pas une différence de schéma. Le clone re-rehearsal (chaîne exacte, baseline
fraîche) fait foi.

## 6. Statut — PORTE FINALE

```
CLUB ONE PRODUCTION CUTOVER PACKAGE READY FOR FOUNDER REVIEW

FINAL MIGRATION ORDER UNIQUE ............. ✅ 0008…0053 contigu, une seule 0032, guard 7/7
0052 REHEARSED ........................... ✅ active_event_venue @0052, get_active_event_context expose venue
PASSWORD NEUTRALIZATION MODE ............. ✅ EXPLICIT & SAFE — action MANUELLE (mode B), hors chaîne migrate,
                                             phrase d'autorisation exacte + préflight auth_id
0053 ANON REVOCATION VERIFIED ............ ✅ anon 0 grant / 0 policy / 0 DML ; RPC publiques intactes
FRESH-CLONE REHEARSAL PASSED ............. ✅ reset→baseline pré-0008→0008…0053 (46), 42 tables/47 fn/129 pol
EXPECTED SCHEMA DELTAS DOCUMENTED ........ ✅ 0052 (venue) / 0053 (anon) / password (données, manuel)
UNEXPECTED SCHEMA DELTAS ZERO ............ ✅ 5 catégories déterministes MATCH ; fns=artefact non-structurel
GOTRUE E2E PASSED ........................ ✅ 6 rôles : login/JWT/rôle/RLS/refresh/logout (ok:true)
REALTIME WEBSOCKET E2E PASSED ............ ✅ admin tout · promoter isolé · no leak · reconnexion (ok:true)
CONTRACT HARNESS PASSED .................. ✅ CONTRACT HARNESS OK (clone quiescé)
FUNCTIONAL HARNESS PASSED WITH ZERO RESIDUE ✅ 7 rôles/isolation/QR/lifecycle, rollback, 0 fixture résiduelle
EXECUTABLE VERIFICATION HARNESS READY .... ✅ contract + functional (pur SQL, pas de \set psql)
PITR AND BACKUP PLAN READY ............... ✅ PREFLIGHT §Sauvegarde & PITR + snapshot structurel
ROLLBACK RUNBOOK READY ................... ✅ PRODUCTION_ROLLBACK_RUNBOOK.md (déclencheur/délai/PITR/code/vars/écritures)
EXACT CUTOVER WINDOW PROPOSED ............ ✅ hors soirée, mardi/mercredi 10:00–12:00 CET
PRODUCTION NEVER WRITTEN ................. ✅ prod en lecture seule (supabase_prod_ro), 0 écriture
NO CUTOVER EXECUTED ...................... ✅ aucune migration prod appliquée
ZERO ACTIVE TASKS ........................ ✅
```

> Note de mapping (numérotation) : la demande fondateur parlait de « 0053 password » / « 0054 anon » ;
> le paquet a **sorti la neutralisation password de la chaîne** (action manuelle mode B) et **renuméroté
> l'anon-revoke en 0053**. La chaîne automatique finale est donc `0008…0053`.

**Aucun GO n'est donné. Aucune écriture prod. En attente de la phrase exacte : `GO CUTOVER PRODUCTION`.**
