# Validation runtime clone — migrations 0054→0057 (niveau 4/5)

**Date** : 2026-07-07 · **Cible** : LABO Supabase LOCAL (`http://127.0.0.1:54321`, Docker
`supabase_db_club-one-lab`, Postgres 17.6, IP privée 172.18.0.5). **PAS la production**
`xsotmjnaffaibgqgookt` — aucune écriture prod. Env local = anon + creds dev locaux uniquement (aucun
service_role, aucune connexion prod).

## Portée de preuve atteinte
- **Niveau 4** : les migrations 0054-0057 s'exécutent réellement sur PostgreSQL (pas seulement lues).
- **Niveau 5 (partiel)** : RPC + RLS exercées sous vraies identités de rôle (JWT `request.jwt.claims`
  → `current_staff_role()`/`current_staff_username()`), plusieurs rôles.
- Toutes les DONNÉES de test sont insérées dans des transactions `rollback` → **zéro résiduel**. Seuls
  les objets de schéma (DDL des migrations) persistent sur le LABO (comportement voulu du clone).

## Application + vérification SQL
| Migration | Apply | Verification SQL |
|---|---|---|
| 0054_event_management | ✅ exit 0 | ✅ A/B/C/D/E OK (colonnes, contrainte statut, RPC DEFINER+search_path, grants restreints, garde transition) |
| 0055_tasks | ✅ exit 0 | ✅ A–G OK **après correctif** (voir bug ci-dessous) |
| 0056_messaging_marketing | ✅ exit 0 | ✅ A–F OK (6 tables + RLS + checks + index idempotence + grants authenticated-only, anon zéro + policies direction) |
| 0057_cercle_floor_plan (corrigée) | ✅ exit 0 | ✅ support technique présent, `venue_tables(cercle)=0` (aucun plan officiel), Éden intact |

## 🐛 Bug RÉEL trouvé par l'exécution niveau 4 (invisible en statique)
`0055_tasks` créait la table avec `grant … to authenticated` mais **sans `revoke … from anon`**. Les
DEFAULT PRIVILEGES Supabase rétablissent des grants anon sur toute nouvelle table de `public` (même
classe de brèche latente que 0053 pour 0046-0051). La vérification niveau 4 a MORDU :
`anon possède 2 grant(s) sur tasks (doit être 0)`. **Correctif** : `revoke all on public.tasks from anon;`
ajouté à 0055 (défense en profondeur ; RLS était déjà fail-closed). Re-vérifié : A–G OK.

## Tests fonctionnels (rollback, zéro résiduel)
- **Cycle de vie soirée** (admin) : CREATE ok · draft→published→open ok · **open→published REFUSÉ**
  (`invalid_transition`) · DUPLICATE ok (nouveau draft) · CANCEL ok (open→closed) ·
  **closed→published REFUSÉ** · requête calendrier (plage mois) = 2 lignes. ✅
- **Garde de rôle** : `create_event_v1` par un **promoteur** → **REFUSÉ** (`unauthorized`). ✅
- **RLS tâches** (rôles réels) : admin crée (1) · l'assigné (server) voit SA tâche (1) et **avance son
  statut** (1) · le **promoteur ne voit PAS** la tâche de l'assigné (0, refus inter-utilisateur). ✅
- **Anon zéro** : `SELECT` anon sur `tasks`, `message_queue`, `promo_codes`, `events` → **4/4 refusés**
  (`insufficient_privilege`). ✅
- **Déduplication** : 2ᵉ `message_queue` même `dedup_key` → **REFUSÉ** (`unique_violation`). ✅
- **Promo** : 2ᵉ `promo_redemptions` même `(code, guest)` → **REFUSÉ** (`unique_violation`) ; FK
  `guest_id → guests` prouvée (intégrité référentielle). ✅
- **Opt-out / DRY_RUN** : logique dans `lib/messaging` (consentGate → statut `opted_out`/`skipped`),
  couverte niveau 2 (20 tests) ; la file DB ne fait que stocker, aucun envoi réel.

## Non couvert (honnêteté)
- E2E navigateur Playwright : scaffold ajouté, exécution nécessite `@playwright/test` + binaires
  navigateurs (téléchargement) + serveur dev — étape documentée, non exécutée ici.
- Realtime multi-clients et concurrence : non exercés cette session.
- Production (niveau 6) : jamais touchée.
