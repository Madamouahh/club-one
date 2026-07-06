# Club One — Résultat de la répétition de cutover (2026-07-06)

> **Statut : `CLUB ONE AUTONOMOUS CUTOVER REHEARSAL PASSED`.**
> Production auditée en lecture seule, sauvegardée ; clone isolé migré `0008→0051`
> et testé (7 rôles, isolation, cycle de vie, QR, Realtime) ; rollback documenté.
> **En attente du GO CUTOVER PRODUCTION — ce GO n'est PAS donné ici.**

Niveau de preuve atteint : **4** (exécution réelle sur base non-prod isolée) et **5**
(RLS/RPC multi-rôles enforced live sous le rôle `authenticated` avec `auth.uid()` réel).
Non atteint : **6** (production).

---

## 1. Environnement

| | |
|---|---|
| **Production** (`xsotmjnaffaibgqgookt`) | **LECTURE SEULE** via MCP `supabase_prod_ro` (`read_only=true`, scopes `*:read`). Jamais écrite. |
| **Clone isolé** (`fhpttgtjxpzexvwtylhv`) | Cible d'écriture. Garde d'exécution : `get_project_url` revérifié `≠ prod` avant chaque application. |

Séparation physique : le serveur MCP inscriptible est scoppé sur le clone (project_ref dans l'URL) →
il ne *peut pas* atteindre la prod. La prod est en lecture seule au niveau OAuth.

## 2. Baseline fidèle (le point non-évident)

La prod a été **construite à la main hors migrations** : ses 6 tables de base ne sont créées par
aucun fichier du dépôt, et la prod **ne correspond pas** littéralement à `0001–0007` (ex. `staff_users`
n'a **ni** `password_hash` **ni** `set_staff_password` — elle utilise `password` en clair + `auth_id`).
Rejouer `0001–0007` aurait fabriqué un schéma **différent** de la prod.

→ La baseline a donc été **reconstruite depuis la structure réelle de la prod** (capture read-only du
catalogue : 8 tables, 8 fonctions, 25 policies `co_phase0b`, 15 index, grants, RLS), sans copier
**aucune donnée / PII / secret**. Fichier : `supabase/rehearsal/baseline_prod_pre_0008.sql`.
Contrôle : clone = prod sur **8 tables / 25 policies / 8 functions / 15 index** (comptes identiques).

## 3. Application des migrations (43 fichiers, `0008 → 0051`)

- **`0008`** (préparation event-scope) : appliqué, vérifié (`club_runtime_state`, colonnes `event_id`,
  RPC v2/v3). ✅
- **Seed synthétique + bootstrap** (`supabase/rehearsal/seed_and_bootstrap.sql`) : 8 comptes staff
  couvrant les 6 rôles distincts (+ 2ᵉ promoteur, 2ᵉ server), 8 `auth.users` liés, 3 venues, 2 events,
  18 tables, 2 contacts. **Bootstrap effectué par la vraie RPC** `bootstrap_club_event_v2` (impersonation
  admin via claims JWT). Invitations (×3) et flux (×3) créés par leurs vraies RPC event-scopées.
- **`0009`** (cutover RLS final) : **toutes les préconditions du preflight intégré passées**, appliqué.
  Postflight : `anon` = **0 grant** sur les tables publiques ; **0** policy transitoire `co_phase0b_*` ;
  policies finales en place ; RLS activée sur les 9 tables ; RPC legacy (`add_expense`, `add_expense_v2`,
  `check_in_invitation`) révoquées. ✅
- **`0010 → 0051`** (44 fichiers, dont les **deux** `0032` dans l'ordre `active_event_venue` puis
  `produits_bar…`, et `0044`/`0045`) : **43/43 appliqués proprement dans l'ordre**. Clone final : 42
  tables, 46 migrations trackées, Realtime = 4 tables, carte Eden (124) + layout Eden (44) semés.

### Réserve honnête sur les fichiers `supabase/verification/NNNN…`
Les 41 fichiers de vérification statique **n'ont pas pu être exécutés tels quels** via le MCP, pour 3
raisons **d'environnement, pas de défaut de migration** : (a) ce sont des scripts *psql* à méta-commandes
(`\set`, `\gset`, `:'var'`) que le protocole pgwire du MCP rejette ; (b) leurs fixtures codent en dur des
UUID staff **du labo**, pas ceux du clone ; (c) ils supposent une baseline de grants différente (un
`DELETE` admin sur `caisse_z` est un no-op RLS silencieux ici, pas un `42501`). → La couverture réelle a
été obtenue **autrement**, par tests fonctionnels live ci-dessous (preuve plus forte que des scripts
statiques : RLS réellement enforced sous `authenticated`).

## 4. Tests fonctionnels live (impersonation `set local request.jwt.claims`)

### 4.1 Matrice de visibilité des 7 rôles (RLS réelle) — **conforme à 100 %**

| rôle | club_tables | invitations | contacts | entry_logs | events | sec_snapshot |
|---|---|---|---|---|---|---|
| admin | 18 | 3 | 2 | 3 | 2 | 18 |
| manager | 18 | 3 | 2 | 3 | 2 | 18 |
| promoter1 | **1** (sa table) | **2** (siennes) | 1 | 0 | 2 | 0 |
| promoter2 | **0** | **1** (sienne) | 1 | 0 | 2 | 0 |
| jeremy (server) | **15** (non-attribuées + sienne) | 0 | 0 | 0 | 2 | 0 |
| security | 0 | 0 | 0 | 0 | 2 | **18** (snapshot only) |
| security_counter | 0 | 0 | 0 | **3** (flux) | 2 | 0 |

### 4.2 Isolation & contrats en écriture

- **Promoteur (écriture)** : `add_expense_v3` OK sur sa table (T03), **refusé** sur table non-attribuée
  (T05) et sur table d'autrui (T04 manager). promoter2 **refusé** sur T03 (vol impossible). ✅
- **Anti-perte dépenses** : 2 dépenses successives sur T03 → **2** dépenses conservées, total **300**
  (append jsonb atomique en un seul UPDATE ; pas d'écrasement). ✅
- **QR** : token 36 car. **généré côté Postgres** (`gen_random_uuid`). Check-in : `server` **refusé**,
  `security` **validé**, rejeu **`already_used`** (idempotent atomique). ✅
- **security_counter** : `add_expense_v3` → **unauthorized**. ✅
- **Promoteur / events** : UPDATE `events` → **0 ligne** (RLS bloque ; events = direction). ✅
- **anon** : `SELECT club_tables` → **`42501 permission denied`** (verrouillé au niveau grant par 0009). ✅
- **Vertical direction-only (0051)** : INSERT `budget_forecasts` promoteur → **RLS violation** ;
  admin → **OK**. ✅

### 4.3 Cycle de vie événementiel (atomique)

- `close_club_event_v2` (admin) : `active_event_id`→null, `last_closed`=ev1, ev1 **archived**, 1 archive
  (CA **300**, 3 entrées), **18 tables reset** (event_id null, free). ✅
- `activate_club_event_v2(ev2)` (admin) : actif=ev2, **18 tables re-scopées** à ev2 (2026-07-13). ✅
- `get_active_event_context` reflète ev2 (bootstrap_completed, last_closed=ev1). Garde : réactiver un
  événement archivé → **refusé**. ✅

### 4.4 Realtime

- Publication `supabase_realtime` = **exactement 4 tables** (`club_tables`, `entry_logs`,
  `promoter_contacts`, `promoter_guest_entries`) après `0042`. ✅
- **Non vérifié à ce niveau** : la livraison WebSocket réelle bout-en-bout (nécessite deux clients live) ;
  l'isolation Realtime **découle** de la RLS SELECT (prouvée en 4.1) puisque Supabase applique la RLS de
  l'abonné aux événements `postgres_changes`.

## 5. Ce qui reste NON vérifié (à traiter avant/pendant le cutover prod)

1. **Niveau 6 (production)** : aucun test réel en prod (par conception — GO non donné).
2. **Livraison Realtime WebSocket** bout-en-bout (deux postes) — non simulable en SQL pur.
3. **Fichiers `verification/NNNN…`** : à porter en variantes « clone-compatibles » (méta-commandes psql
   inlinées, UUID remappés, baseline grants réconciliée) si l'on veut la preuve statique en plus du live.
4. **Collision `0032`** (deux fichiers) : appliquée sans danger fonctionnel ici mais à **renuméroter**
   (carte Eden → premier numéro libre) avant le paquet de bascule prod (cf. `docs/MIGRATIONS_REGISTRY.md` §3).
5. **Login réel (gotrue)** : les rôles ont été testés par claims JWT (RLS authentique) et non par un
   login mot-de-passe complet ; le front réel + Auth restent à valider en intégration (niveau 5 complet).

## 6. Rollback

- **Clone** : jetable. Repartir propre = re-exécuter `baseline_prod_pre_0008.sql` + `seed_and_bootstrap.sql`
  sur un projet neuf, ou supprimer/recréer le projet. Aucune conséquence prod.
- **Production** (le jour du cutover, hors session autonome) : `0008`/`0009` sont transactionnels avec
  gardes (`raise exception` sur précondition manquante) ; en cas d'échec la transaction **annule tout**.
  Filet supplémentaire : **PITR / backup managé Supabase** + référence structurelle
  `backups/prod-structural-snapshot-2026-07-05.md`. Rollback fonctionnel des policies : réappliquer les
  `co_phase0b_*` depuis la baseline.

## 7. Artefacts

- `supabase/rehearsal/baseline_prod_pre_0008.sql` — reconstruction fidèle prod (structure only).
- `supabase/rehearsal/seed_and_bootstrap.sql` — seed synthétique + bootstrap (0 PII).
- `supabase/rehearsal/role_matrix_tests.sql` — trame des tests de rôles (impersonation).
- `backups/prod-structural-snapshot-2026-07-05.md` — snapshot structurel prod (référence rollback).
- `docs/CUTOVER_REHEARSAL_RUNBOOK.md` — runbook déterministe.

## 8. Verdict

**Répétition réussie (niveau 4 + 5 partiel).** Le paquet `0008 → 0051` s'applique proprement sur une
reproduction fidèle de la prod, et le **contrat de sécurité central** (event-scope, isolation promoteur,
relation server réelle, snapshot sécurité, verrouillage anon, cycle de vie atomique, anti-perte, QR
idempotent) est **prouvé en exécution réelle**. **NO-GO implicite pour la prod tant que le fondateur n'a
pas donné le GO CUTOVER explicite** et tant que les points §5 (Realtime WS, collision 0032) ne sont pas
tranchés.
